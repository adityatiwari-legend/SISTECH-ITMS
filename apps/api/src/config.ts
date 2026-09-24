import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { SimulationScenarioId } from "@itms/types";
import { DEFAULT_CONGESTION_THRESHOLDS, type CongestionThresholds } from "./modules/traffic/metrics.ts";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Allowed CORS origins for the browser UI (comma-separated env, "*" = all). */
  corsOrigin: string[];
  /** Demo profile: "grid" = synthetic 3x2 grid, "city" = real OSM-derived city. */
  demoProfile: "grid" | "city";
  /** Display name of the demo city (city profile). */
  demoCity: string;
  /** Demo city center + radius used by the OSM fetch/build scripts. */
  demoCenter: { lat: number; lng: number };
  demoRadiusKm: number;
  /** SUMO executable (path or PATH-resolvable name). */
  sumoBinary: string;
  /** Scenario config path per scenario id. */
  scenarioPaths: Record<SimulationScenarioId, string>;
  /** Path to the compiled SUMO network file. */
  networkPath: string;
  /** Path to the facilities (POI) additional file used for map markers. */
  facilitiesPath: string;
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

  // Phase 4 — AI traffic prediction
  /** Base URL of the Python prediction service; empty disables predictions. */
  predictionServiceUrl: string | null;
  /** Minimum wall-clock interval between prediction refreshes (ms). */
  predictionIntervalMs: number;
  /** Timeout for prediction service calls (ms). */
  predictionTimeoutMs: number;
  /** Age in SIMULATION seconds after which a prediction is stale. */
  predictionStaleAfterSeconds: number;
  /** Simulated city clock origin used for the hour/day features. */
  simStartHour: number;
  simStartDayOfWeek: number;

  // AI Copilot (Vultr Serverless Inference)
  vultrApiKey?: string | null;
  vultrModel?: string;

  // Phase 5 — predictive rolling green corridor
  /** Green window starts this many seconds before the emergency ETA. */
  corridorGreenLeadS: number;
  /** Green window extends this many seconds past the emergency ETA. */
  corridorGreenTrailS: number;
  corridorMinGreenWindowS: number;
  /** Maximum total corridor-green duration at one junction (also red bound). */
  corridorMaxGreenWindowS: number;
  /** Maximum extra green beyond the normal program's switch point. */
  corridorMaxGreenExtensionS: number;
  /** Maximum time cross-traffic approaches may be held red by the corridor. */
  corridorMaxRedExtensionS: number;
  /** Yellow clearance duration inserted before cutting a live green. */
  corridorClearanceYellowS: number;
  /** Junctions with ETA beyond this horizon are planned later (rolling). */
  corridorEtaPlanHorizonS: number;
  /** ETA change larger than this triggers a window replan (seconds). */
  corridorReplanEtaThresholdS: number;
  /** Downstream occupancy above this blocks corridor green (spillback). */
  corridorDownstreamOccupancyLimit: number;
  /** Minimum emergency priority eligible for corridors. */
  corridorMinPriority: "normal" | "high" | "critical";

  // Phase 6 — closed-loop optimization
  /** Loop evaluation cadence in SIMULATION seconds (deterministic). */
  loopEvalIntervalS: number;
  /** Route re-evaluation cadence in SIMULATION seconds. */
  routeReevalIntervalS: number;
  /** Minimum absolute improvement (sim seconds) required to switch route. */
  routeSwitchMinImprovementS: number;
  /** Minimum relative improvement (fraction of current ETA) required. */
  routeSwitchMinImprovementFraction: number;
  /** Minimum sim seconds between two switches of one emergency. */
  routeSwitchCooldownS: number;
  /** Maximum dynamic switches per emergency (oscillation guard). */
  routeSwitchMaxPerEmergency: number;
  /** No switch when the destination ETA is at/below this (sim seconds). */
  routeSwitchNearDestinationGuardS: number;

  // Phase 6 — metrics + comparison runs
  /** Metrics sampling cadence in SIMULATION seconds. */
  metricsSampleIntervalS: number;
  /** Comparison run warm-up sim seconds before the emergency is created. */
  comparisonWarmupSeconds: number;
  /** Comparison run duration cap in sim seconds. */
  comparisonDurationCapSeconds: number;
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
  // ---- demo profile selection (Rules: never mix networks silently) ----
  const demoRaw = env.ITMS_DEMO;
  const demoProfile: "grid" | "city" = demoRaw === undefined || demoRaw === "" ? "grid" : parseDemoProfile(demoRaw);
  const demoCity = env.DEMO_CITY || "Bhopal";
  const demoLat = readNumber(env, "DEMO_LAT", 23.2615, -90, 90);
  const demoLng = readNumber(env, "DEMO_LNG", 77.4092, -180, 180);
  const demoRadiusKm = readNumber(env, "DEMO_RADIUS_KM", 3, 0.2, 50);

  const cityNetworkPath = join(REPO_ROOT, "simulation", "sumo", "network", "city", "itms-city.net.xml");
  const cityScenarioDir = join(REPO_ROOT, "simulation", "sumo", "scenarios", "city");
  const cityFacilitiesPath = join(REPO_ROOT, "simulation", "sumo", "network", "city", "city-facilities.add.xml");

  let networkPath: string;
  let facilitiesPath: string;
  let scenarioPaths: Record<SimulationScenarioId, string>;
  if (demoProfile === "city") {
    // All four scenario ids map onto the city scenario variants so that
    // traffic-level scenarios and the comparison runner keep working.
    networkPath = cityNetworkPath;
    facilitiesPath = cityFacilitiesPath;
    scenarioPaths = {
      baseline: readScenarioPath(env, "ITMS_SCENARIO_BASELINE", join(cityScenarioDir, "city.sumocfg")),
      emergency: readScenarioPath(env, "ITMS_SCENARIO_EMERGENCY", join(cityScenarioDir, "city.sumocfg")),
      emergency_low: readScenarioPath(env, "ITMS_SCENARIO_EMERGENCY_LOW", join(cityScenarioDir, "city-low.sumocfg")),
      emergency_high: readScenarioPath(env, "ITMS_SCENARIO_EMERGENCY_HIGH", join(cityScenarioDir, "city-high.sumocfg")),
    };
    if (!existsSync(networkPath)) {
      throw new Error(
        `City demo network is missing: ${networkPath}. ` +
        "Run 'npm run fetch:city && npm run build:city-network' (DEMO_LAT/DEMO_LNG/DEMO_RADIUS_KM select the area).",
      );
    }
  } else {
    networkPath = readScenarioPath(env, "ITMS_NETWORK", join(REPO_ROOT, "simulation", "sumo", "network", "itms.net.xml"));
    facilitiesPath = readScenarioPath(
      env,
      "ITMS_FACILITIES",
      join(REPO_ROOT, "simulation", "sumo", "network", "facilities.add.xml"),
    );
    scenarioPaths = {
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
      emergency_low: readScenarioPath(
        env,
        "ITMS_SCENARIO_EMERGENCY_LOW",
        join(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency-low.sumocfg"),
      ),
      emergency_high: readScenarioPath(
        env,
        "ITMS_SCENARIO_EMERGENCY_HIGH",
        join(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency-high.sumocfg"),
      ),
    };
  }
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

  const predictionUrlRaw = env.PREDICTION_SERVICE_URL;
  if (predictionUrlRaw !== undefined && predictionUrlRaw !== "") {
    try {
      const url = new URL(predictionUrlRaw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("must use http(s)://");
      }
    } catch (err) {
      throw new Error(
        `Invalid PREDICTION_SERVICE_URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    host: env.HOST || "127.0.0.1",
    port: readNumber(env, "PORT", 3000, 1, 65535),
    logLevel: env.LOG_LEVEL || "info",
    corsOrigin: (env.CORS_ORIGIN || "http://localhost:3000,http://localhost:3001,http://localhost:3100,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3100")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
    demoProfile,
    demoCity,
    demoCenter: { lat: demoLat, lng: demoLng },
    demoRadiusKm,
    sumoBinary: env.SUMO_BINARY || "sumo",
    scenarioPaths,
    networkPath,
    facilitiesPath,
    sumoStepLengthSeconds: readNumber(env, "SUMO_STEP_LENGTH_S", 1, 0.001, 60),
    stepIntervalMs: readNumber(env, "SUMO_STEP_INTERVAL_MS", 1000, 0, 60_000),
    sumoConnectTimeoutMs: readNumber(env, "SUMO_CONNECT_TIMEOUT_MS", 15_000, 100, 600_000),
    sumoStartupTimeoutMs: readNumber(env, "SUMO_STARTUP_TIMEOUT_MS", 60_000, 1_000, 600_000),

    databaseUrl,
    trafficPersistEveryTicks: readNumber(env, "TRAFFIC_PERSIST_EVERY_TICKS", 5, 1, 600),
    trafficEventIntervalMs: readNumber(env, "TRAFFIC_EVENT_INTERVAL_MS", 1000, 100, 60_000),
    trafficStaleAfterSeconds: readNumber(env, "TRAFFIC_STALE_AFTER_SECONDS", 5, 1, 3600),
    congestionThresholds: readCongestionThresholds(env),

    predictionServiceUrl: predictionUrlRaw !== undefined && predictionUrlRaw !== "" ? predictionUrlRaw.replace(/\/+$/, "") : null,
    predictionIntervalMs: readNumber(env, "PREDICTION_INTERVAL_MS", 2000, 250, 60_000),
    predictionTimeoutMs: readNumber(env, "PREDICTION_TIMEOUT_MS", 2000, 50, 60_000),
    predictionStaleAfterSeconds: readNumber(env, "PREDICTION_STALE_AFTER_SECONDS", 10, 1, 3600),
    simStartHour: readNumber(env, "ITMS_SIM_START_HOUR", 8, 0, 23),
    simStartDayOfWeek: readNumber(env, "ITMS_SIM_START_DAY_OF_WEEK", 2, 0, 6),

    vultrApiKey: env.VULTR_SERVERLESS_INFERENCE_API_KEY || null,
    vultrModel: env.VULTR_INFERENCE_MODEL || "deepseek-v4.1-flash",

    corridorGreenLeadS: readNumber(env, "CORRIDOR_GREEN_LEAD_S", 5, 0, 120),
    corridorGreenTrailS: readNumber(env, "CORRIDOR_GREEN_TRAIL_S", 12, 0, 120),
    corridorMinGreenWindowS: readNumber(env, "CORRIDOR_MIN_GREEN_WINDOW_S", 8, 1, 120),
    corridorMaxGreenWindowS: readNumber(env, "CORRIDOR_MAX_GREEN_WINDOW_S", 30, 1, 300),
    corridorMaxGreenExtensionS: readNumber(env, "CORRIDOR_MAX_GREEN_EXTENSION_S", 20, 0, 300),
    corridorMaxRedExtensionS: readNumber(env, "CORRIDOR_MAX_RED_EXTENSION_S", 45, 1, 300),
    corridorClearanceYellowS: readNumber(env, "CORRIDOR_CLEARANCE_YELLOW_S", 3, 0, 30),
    corridorEtaPlanHorizonS: readNumber(env, "CORRIDOR_ETA_PLAN_HORIZON_S", 60, 1, 600),
    corridorReplanEtaThresholdS: readNumber(env, "CORRIDOR_REPLAN_ETA_THRESHOLD_S", 4, 0.5, 120),
    corridorDownstreamOccupancyLimit: readNumber(env, "CORRIDOR_DOWNSTREAM_OCCUPANCY_LIMIT", 0.85, 0.1, 1),
    corridorMinPriority: readCorridorMinPriority(env),

    loopEvalIntervalS: readNumber(env, "LOOP_EVAL_INTERVAL_S", 3, 0.5, 120),
    routeReevalIntervalS: readNumber(env, "ROUTE_REEVAL_INTERVAL_S", 5, 0.5, 600),
    routeSwitchMinImprovementS: readNumber(env, "ROUTE_SWITCH_MIN_IMPROVEMENT_S", 8, 0, 300),
    routeSwitchMinImprovementFraction: readNumber(env, "ROUTE_SWITCH_MIN_IMPROVEMENT_FRACTION", 0.15, 0, 1),
    routeSwitchCooldownS: readNumber(env, "ROUTE_SWITCH_COOLDOWN_S", 30, 0, 600),
    routeSwitchMaxPerEmergency: readNumber(env, "ROUTE_SWITCH_MAX_PER_EMERGENCY", 3, 0, 50),
    routeSwitchNearDestinationGuardS: readNumber(env, "ROUTE_SWITCH_NEAR_DESTINATION_GUARD_S", 15, 0, 300),

    metricsSampleIntervalS: readNumber(env, "METRICS_SAMPLE_INTERVAL_S", 5, 0.5, 600),
    comparisonWarmupSeconds: readNumber(env, "COMPARISON_WARMUP_SECONDS", 30, 0, 600),
    comparisonDurationCapSeconds: readNumber(env, "COMPARISON_DURATION_CAP_SECONDS", 480, 30, 7200),
  };
}

function readCorridorMinPriority(env: NodeJS.ProcessEnv): "normal" | "high" | "critical" {
  const raw = env.CORRIDOR_MIN_PRIORITY;
  if (raw === undefined || raw === "") return "normal";
  if (raw === "normal" || raw === "high" || raw === "critical") return raw;
  throw new Error('Invalid CORRIDOR_MIN_PRIORITY: allowed values are "normal", "high", "critical".');
}

function parseDemoProfile(raw: string): "grid" | "city" {
  if (raw === "grid" || raw === "city") return raw;
  throw new Error('Invalid ITMS_DEMO: allowed values are "grid", "city".');
}
