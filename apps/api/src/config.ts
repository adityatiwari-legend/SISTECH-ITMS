import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { SimulationScenarioId } from "@itms/types";
import { DEFAULT_CONGESTION_THRESHOLDS, type CongestionThresholds } from "./modules/traffic/metrics.ts";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  /** SUMO executable (path or PATH-resolvable name). */
  sumoBinary: string;
  /** Scenario config path per scenario id. */
  scenarioPaths: Record<SimulationScenarioId, string>;
  /** Path to the compiled SUMO network file. */
  networkPath: string;
  sumoStepLengthSeconds: number;
  stepIntervalMs: number;
  sumoConnectTimeoutMs: number;
  sumoStartupTimeoutMs: number;

  // Phase 2 — traffic intelligence
  databaseUrl: string;
  /** Persist snapshots every N collection ticks (1 = every step). */
  trafficPersistEveryTicks: number;
  /** Minimum wall-clock interval between WebSocket broadcasts (ms). */
  trafficEventIntervalMs: number;
  /** Age (seconds) after which traffic data is reported stale. */
  trafficStaleAfterSeconds: number;
  /** Congestion classification thresholds. */
  congestionThresholds: CongestionThresholds;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a number.`);
  }
  if (value < min || value > max) {
    throw new Error(`Invalid ${name}: ${value} is outside the allowed range [${min}, ${max}].`);
  }
  return value;
}

function readScenarioPath(env: NodeJS.ProcessEnv, envName: string, defaultPath: string): string {
  const raw = env[envName];
  if (raw === undefined || raw === "") return defaultPath;
  const resolved = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  if (!existsSync(resolved)) {
    throw new Error(`${envName} points to a missing file: ${resolved}`);
  }
  return resolved;
}

/**
 * Loads congestion thresholds from environment variables with validated
 * defaults. Occupancy/speed-ratio values are fractions in [0, 1]; queue
 * lengths are vehicle counts >= 0. Monotonicity across levels is enforced.
 */
function readCongestionThresholds(env: NodeJS.ProcessEnv): CongestionThresholds {
  const thresholds: CongestionThresholds = {
    mediumOccupancy: readNumber(env, "TRAFFIC_CONGESTION_MEDIUM_OCCUPANCY", DEFAULT_CONGESTION_THRESHOLDS.mediumOccupancy, 0, 1),
    highOccupancy: readNumber(env, "TRAFFIC_CONGESTION_HIGH_OCCUPANCY", DEFAULT_CONGESTION_THRESHOLDS.highOccupancy, 0, 1),
    criticalOccupancy: readNumber(env, "TRAFFIC_CONGESTION_CRITICAL_OCCUPANCY", DEFAULT_CONGESTION_THRESHOLDS.criticalOccupancy, 0, 1),
    mediumSpeedRatio: readNumber(env, "TRAFFIC_CONGESTION_MEDIUM_SPEED_RATIO", DEFAULT_CONGESTION_THRESHOLDS.mediumSpeedRatio, 0, 1),
    highSpeedRatio: readNumber(env, "TRAFFIC_CONGESTION_HIGH_SPEED_RATIO", DEFAULT_CONGESTION_THRESHOLDS.highSpeedRatio, 0, 1),
    criticalSpeedRatio: readNumber(env, "TRAFFIC_CONGESTION_CRITICAL_SPEED_RATIO", DEFAULT_CONGESTION_THRESHOLDS.criticalSpeedRatio, 0, 1),
    mediumQueue: readNumber(env, "TRAFFIC_CONGESTION_MEDIUM_QUEUE", DEFAULT_CONGESTION_THRESHOLDS.mediumQueue, 0, 10_000),
    highQueue: readNumber(env, "TRAFFIC_CONGESTION_HIGH_QUEUE", DEFAULT_CONGESTION_THRESHOLDS.highQueue, 0, 10_000),
    criticalQueue: readNumber(env, "TRAFFIC_CONGESTION_CRITICAL_QUEUE", DEFAULT_CONGESTION_THRESHOLDS.criticalQueue, 0, 10_000),
  };
  const { mediumOccupancy, highOccupancy, criticalOccupancy, mediumSpeedRatio, highSpeedRatio, criticalSpeedRatio, mediumQueue, highQueue, criticalQueue } = thresholds;
  if (!(mediumOccupancy <= highOccupancy && highOccupancy <= criticalOccupancy)) {
    throw new Error("TRAFFIC_CONGESTION_*_OCCUPANCY must be non-decreasing (medium <= high <= critical).");
  }
  if (!(mediumSpeedRatio >= highSpeedRatio && highSpeedRatio >= criticalSpeedRatio)) {
    throw new Error("TRAFFIC_CONGESTION_*_SPEED_RATIO must be non-increasing (medium >= high >= critical).");
  }
  if (!(mediumQueue <= highQueue && highQueue <= criticalQueue)) {
    throw new Error("TRAFFIC_CONGESTION_*_QUEUE must be non-decreasing (medium <= high <= critical).");
  }
  return thresholds;
}

/**
 * Loads configuration from environment variables with validated defaults.
 * Throws a descriptive error for invalid values (fail fast on startup).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const scenarioPaths: Record<SimulationScenarioId, string> = {
    baseline: readScenarioPath(
      env,
      "ITMS_SCENARIO_BASELINE",
      join(REPO_ROOT, "simulation", "sumo", "scenarios", "baseline", "baseline.sumocfg"),
    ),
    emergency: readScenarioPath(
      env,
      "ITMS_SCENARIO_EMERGENCY",
      join(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency.sumocfg"),
    ),
  };
  for (const [id, path] of Object.entries(scenarioPaths)) {
    if (!existsSync(path)) {
      throw new Error(
        `Default scenario file for "${id}" is missing: ${path}. Run 'npm run build:network' and verify the repository layout.`,
      );
    }
  }

  const databaseUrlRaw = env.DATABASE_URL;
  if (databaseUrlRaw === undefined || databaseUrlRaw === "") {
    throw new Error(
      "DATABASE_URL is required (Phase 2 persists traffic data). Example: postgres://user:password@127.0.0.1:5432/itms",
    );
  }
  let databaseUrl: string;
  try {
    const url = new URL(databaseUrlRaw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("DATABASE_URL must use the postgres:// scheme.");
    }
    databaseUrl = url.toString();
  } catch (err) {
    throw new Error(
      `Invalid DATABASE_URL: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const networkPath = readScenarioPath(
    env,
    "ITMS_NETWORK",
    join(REPO_ROOT, "simulation", "sumo", "network", "itms.net.xml"),
  );

  return {
    host: env.HOST || "127.0.0.1",
    port: readNumber(env, "PORT", 3000, 1, 65535),
    logLevel: env.LOG_LEVEL || "info",
    sumoBinary: env.SUMO_BINARY || "sumo",
    scenarioPaths,
    networkPath,
    sumoStepLengthSeconds: readNumber(env, "SUMO_STEP_LENGTH_S", 1, 0.001, 60),
    stepIntervalMs: readNumber(env, "SUMO_STEP_INTERVAL_MS", 1000, 0, 60_000),
    sumoConnectTimeoutMs: readNumber(env, "SUMO_CONNECT_TIMEOUT_MS", 15_000, 100, 600_000),
    sumoStartupTimeoutMs: readNumber(env, "SUMO_STARTUP_TIMEOUT_MS", 60_000, 1_000, 600_000),

    databaseUrl,
    trafficPersistEveryTicks: readNumber(env, "TRAFFIC_PERSIST_EVERY_TICKS", 5, 1, 600),
    trafficEventIntervalMs: readNumber(env, "TRAFFIC_EVENT_INTERVAL_MS", 1000, 100, 60_000),
    trafficStaleAfterSeconds: readNumber(env, "TRAFFIC_STALE_AFTER_SECONDS", 5, 1, 3600),
    congestionThresholds: readCongestionThresholds(env),
  };
}
