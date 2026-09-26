import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, maskConnectionString } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { createLogger } from "../logger.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// Auto-load .env if DATABASE_URL is not already set
if (!process.env.DATABASE_URL) {
  const candidateEnvPaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "apps", "api", ".env"),
    resolve(__dirname, "..", "..", ".env"),
    resolve(REPO_ROOT, ".env"),
    resolve(REPO_ROOT, "apps", "api", ".env"),
  ];

  for (const envPath of candidateEnvPaths) {
    if (existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
        if (process.env.DATABASE_URL) {
          console.log(`Loaded environment from: ${envPath}`);
          break;
        }
      } catch {
        // Continue checking next candidate
      }
    }
  }
}

// Allow CLI argument override: node run-migrate.ts "postgres://..."
const dbUrlArg = process.argv.slice(2).find((arg) => arg.startsWith("postgres://") || arg.startsWith("postgresql://"));
const databaseUrl = dbUrlArg || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ ERROR: DATABASE_URL is not set.");
  console.error("Please set DATABASE_URL in your environment or in apps/api/.env");
  console.error("Example: DATABASE_URL=postgres://itms:itms-dev-pw@127.0.0.1:5433/itms");
  process.exit(1);
  throw new Error("DATABASE_URL is not set.");
}

const targetDbUrl: string = databaseUrl;
const logger = createLogger("migrate", "info");

async function main(): Promise<void> {
  console.log("==================================================");
  console.log("🗄️  ITMS Database Migration Runner");
  console.log(`📡 Target: ${maskConnectionString(targetDbUrl)}`);
  console.log("==================================================");

  const migrationsDir = join(__dirname, "migrations");
  let pool;

  try {
    pool = await createDatabasePool({ connectionString: targetDbUrl });
    const result = await runMigrations(pool, migrationsDir, logger);

    console.log("--------------------------------------------------");
    console.log("📊 Migration Summary:");
    console.log(`   ✅ Applied: ${result.applied.length}`);
    if (result.applied.length > 0) {
      for (const m of result.applied) {
        console.log(`      + ${m}`);
      }
    }
    console.log(`   ⏭️  Skipped (already up to date): ${result.skipped.length}`);
    console.log("--------------------------------------------------");
    console.log("🎉 Database schema is fully up to date!");
    console.log("==================================================");
    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error("--------------------------------------------------");
    console.error("❌ Migration failed with error:");
    console.error(err instanceof Error ? err.message : String(err));
    console.error("--------------------------------------------------");
    if (pool) {
      await pool.close().catch(() => undefined);
    }
    process.exit(1);
  }
}

main();
