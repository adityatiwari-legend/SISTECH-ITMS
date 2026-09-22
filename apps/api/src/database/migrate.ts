import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabasePool } from "./db.ts";
import type { Logger } from "../logger.ts";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Minimal file-based migration runner.
 *
 * Migrations are plain .sql files in migrations/, applied in lexicographic
 * order and tracked in schema_migrations. Applied files are immutable:
 * schema changes require a NEW numbered migration file.
 */
export async function runMigrations(
  pool: DatabasePool,
  migrationsDir: string,
  logger: Logger,
): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const appliedRows = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.name));

  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await pool.transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    result.applied.push(file);
    logger.info("Migration applied", { migration: file });
  }
  return result;
}
