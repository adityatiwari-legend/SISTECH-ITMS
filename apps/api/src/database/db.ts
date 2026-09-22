import pg from "pg";
import { AppError } from "../errors.ts";

/**
 * Thin wrapper around a pg Pool.
 *
 * Adds transaction support, health tracking, and typed query results.
 * All database access in the application goes through this module.
 */

export interface QueryClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>>;
}

export interface DatabasePool extends QueryClient {
  transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T>;
  isHealthy(): boolean;
  lastError(): string | null;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  connectionString: string;
  /** Max attempts for the initial connectivity check. */
  connectTimeoutMs?: number;
}

export async function createDatabasePool(options: DatabaseOptions): Promise<DatabasePool> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectTimeoutMs ?? 5_000,
  });
  // Fail fast on startup with a clear error instead of mysterious per-query failures.
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not connect to PostgreSQL (${maskConnectionString(options.connectionString)}): ${message}`,
    );
  }

  let healthy = true;
  let lastErrorMessage: string | null = null;

  pool.on("error", (err) => {
    healthy = false;
    lastErrorMessage = err.message;
  });

  return {
    async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<pg.QueryResult<T>> {
      try {
        const result = await pool.query<T>(text, values);
        healthy = true;
        lastErrorMessage = null;
        return result;
      } catch (err) {
        healthy = false;
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        if (err instanceof pg.DatabaseError && err.code) {
          throw new AppError(503, "database_error", `Database query failed (${err.code}): ${err.message}`);
        }
        throw new AppError(503, "database_unavailable", `Database is not available: ${lastErrorMessage}`);
      }
    },
    async transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const wrapped: QueryClient = {
          query: async (text, values) => {
            try {
              return await client.query(text, values);
            } catch (err) {
              healthy = false;
              lastErrorMessage = err instanceof Error ? err.message : String(err);
              throw err;
            }
          },
        };
        const result = await work(wrapped);
        await client.query("COMMIT");
        healthy = true;
        lastErrorMessage = null;
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof pg.DatabaseError) {
          throw new AppError(503, "database_error", `Database transaction failed (${err.code}): ${err.message}`);
        }
        throw err;
      } finally {
        client.release();
      }
    },
    isHealthy: () => healthy,
    lastError: () => lastErrorMessage,
    close: async () => {
      await pool.end();
    },
  };
}

/** Masks the password in a connection string for logs/messages. */
export function maskConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "postgres://***";
  }
}
