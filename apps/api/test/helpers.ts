import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TraCIConnection } from "../src/modules/simulation/traci/client.ts";
import { findFreePort, startSumoProcess, type SumoProcessHandle } from "../src/modules/simulation/sumo-process.ts";
import type { SimulationScenarioId } from "@itms/types";
import pg from "pg";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const SCENARIO_PATHS: Record<SimulationScenarioId, string> = {
  baseline: resolve(REPO_ROOT, "simulation", "sumo", "scenarios", "baseline", "baseline.sumocfg"),
  emergency: resolve(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency.sumocfg"),
  emergency_low: resolve(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency-low.sumocfg"),
  emergency_high: resolve(REPO_ROOT, "simulation", "sumo", "scenarios", "emergency", "emergency-high.sumocfg"),
};

export const NETWORK_PATH = resolve(REPO_ROOT, "simulation", "sumo", "network", "itms.net.xml");

/** Test database URL (itms_test). Override with ITMS_TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.ITMS_TEST_DATABASE_URL ?? "postgres://itms:itms-dev-pw@127.0.0.1:5433/itms_test";

/** Returns false when the PostgreSQL test database is not reachable. */
export async function isDatabaseAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** Ensures the schema exists, then drops all rows and resets identity columns. */
export async function resetTestDatabase(): Promise<void> {
  const db = await createDatabasePool({ connectionString: TEST_DATABASE_URL });
  try {
    const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "database", "migrations");
    await runMigrations(db, migrationsDir, createLogger("test-migrations", "error"));
    await db.query(`
      TRUNCATE traffic_snapshots, signal_snapshots, vehicles,
               simulation_runs, signal_phases, traffic_signals,
               road_segments, roads, intersections RESTART IDENTITY CASCADE
    `);
  } finally {
    await db.close();
  }
}

export interface SumoSession {
  client: TraCIConnection;
  process: SumoProcessHandle;
  port: number;
  close(): Promise<void>;
}

const CONNECT_RETRY_INTERVAL_MS = 400;
const CONNECT_TOTAL_TIMEOUT_MS = 30_000;

/**
 * Starts a real headless SUMO process on a free port and connects a TraCI
 * client. Every test session is isolated; close() terminates SUMO.
 */
export async function startSumoSession(
  scenario: SimulationScenarioId = "baseline",
  options: { endSeconds?: number } = {},
): Promise<SumoSession> {
  const port = await findFreePort();
  const sumoProc = startSumoProcess({
    binary: process.env.SUMO_BINARY || "sumo",
    configPath: SCENARIO_PATHS[scenario],
    port,
    stepLengthSeconds: 1,
    endSeconds: options.endSeconds,
  });

  const deadline = Date.now() + CONNECT_TOTAL_TIMEOUT_MS;
  let client: TraCIConnection | null = null;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    if (sumoProc.hasExited()) {
      throw new Error(`SUMO exited during startup: ${sumoProc.stderrTail().join(" | ")}`);
    }
    try {
      client = await TraCIConnection.connect("127.0.0.1", port, { timeoutMs: 5_000 });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_INTERVAL_MS));
    }
  }
  if (client === null) {
    await sumoProc.kill();
    throw lastError ?? new Error("Could not connect to SUMO");
  }

  return {
    client,
    process: sumoProc,
    port,
    close: async () => {
      await client?.close();
      await sumoProc.kill();
    },
  };
}

/** Steps the simulation until `predicate` holds or `maxSteps` is reached. */
export async function stepUntil(
  client: TraCIConnection,
  predicate: () => Promise<boolean> | boolean,
  maxSteps: number,
): Promise<boolean> {
  for (let i = 0; i < maxSteps; i++) {
    if (await predicate()) return true;
    const time = await client.getTime();
    await client.step(time + 1);
  }
  return predicate();
}

import { createLogger } from "../src/logger.ts";
import { buildApp } from "../src/app.ts";
import { SimulationManager } from "../src/modules/simulation/simulation-manager.ts";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { RoadGraph } from "../src/modules/routing/road-graph.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { TrafficCollector } from "../src/modules/traffic/collector.ts";
import { TrafficService } from "../src/modules/traffic/traffic-service.ts";
import { EmergencyService } from "../src/modules/emergency/emergency-service.ts";
import { EmergencyRepository } from "../src/database/repositories/emergency-repository.ts";
import { PredictionService } from "../src/modules/prediction/prediction-service.ts";
import { CorridorService } from "../src/modules/corridor/corridor-service.ts";
import { CorridorRepository } from "../src/database/repositories/corridor-repository.ts";
import { ClosedLoopService } from "../src/modules/loop/closed-loop-service.ts";
import { MetricsRecorder } from "../src/modules/metrics/metrics-recorder.ts";
import { MetricsRepository } from "../src/database/repositories/metrics-repository.ts";
import { ScenarioComparisonService } from "../src/modules/scenarios/scenario-comparison-service.ts";
import { WsBus } from "../src/modules/websocket/ws-bus.ts";
import { createDatabasePool, type DatabasePool } from "../src/database/db.ts";
import { runMigrations } from "../src/database/migrate.ts";
import { AuthService } from "../src/modules/auth/auth-service.ts";
import { MobileRepository } from "../src/database/repositories/mobile-repository.ts";
import { AiVerificationService } from "../src/modules/ai/verification-service.ts";
import { MobileService } from "../src/modules/mobile/mobile-service.ts";
import { DeviceRepository } from "../src/database/repositories/device-repository.ts";
import { RoadsideDeviceService } from "../src/modules/device/device-service.ts";
import { DEFAULT_CONGESTION_THRESHOLDS } from "../src/modules/traffic/metrics.ts";
import type { AppConfig } from "../src/config.ts";
import type { FastifyInstance } from "fastify";
import type { WsBus as WsBusType } from "../src/modules/websocket/ws-bus.ts";

export interface TestAppHarness {
  app: FastifyInstance;
  manager: SimulationManager;
  trafficService: TrafficService;
  emergencyService: EmergencyService;
  predictionService: PredictionService;
  corridorService: CorridorService;
  loopService: ClosedLoopService;
  metricsRecorder: MetricsRecorder;
  metricsRepository: MetricsRepository;
  comparisonService: ScenarioComparisonService;
  routeEngine: RouteEngine;
  roadGraph: RoadGraph;
  db: DatabasePool;
  wsBus: WsBusType;
  port: number;
  close(): Promise<void>;
}

export function harnessConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "error",
    corsOrigin: ["*"],
    demoProfile: "grid",
    demoCity: "Bhopal",
    demoCenter: { lat: 23.2615, lng: 77.4092 },
    demoRadiusKm: 3,
    sumoBinary: process.env.SUMO_BINARY || "sumo",
    scenarioPaths: SCENARIO_PATHS,
    networkPath: NETWORK_PATH,
    facilitiesPath: resolve(REPO_ROOT, "simulation", "sumo", "network", "facilities.add.xml"),
    sumoStepLengthSeconds: 1,
    stepIntervalMs: 25,
    sumoConnectTimeoutMs: 5_000,
    sumoStartupTimeoutMs: 30_000,
    databaseUrl: TEST_DATABASE_URL,
    trafficPersistEveryTicks: 2,
    trafficEventIntervalMs: 200,
    trafficStaleAfterSeconds: 2,
    congestionThresholds: { ...DEFAULT_CONGESTION_THRESHOLDS },
    predictionServiceUrl: null,
    predictionIntervalMs: 250,
    predictionTimeoutMs: 500,
    // The harness steps the sim much faster than real time (25 ms wall per
    // sim second); allow a larger sim-age window so entries survive between
    // refreshes (sim age grows ~10 s per 250 ms refresh interval).
    predictionStaleAfterSeconds: 30,
    simStartHour: 8,
    simStartDayOfWeek: 2,
    corridorGreenLeadS: 5,
    corridorGreenTrailS: 12,
    corridorMinGreenWindowS: 8,
    corridorMaxGreenWindowS: 30,
    corridorMaxGreenExtensionS: 20,
    corridorMaxRedExtensionS: 45,
    corridorClearanceYellowS: 3,
    corridorEtaPlanHorizonS: 60,
    corridorReplanEtaThresholdS: 4,
    corridorDownstreamOccupancyLimit: 0.85,
    corridorMinPriority: "normal",
    loopEvalIntervalS: 3,
    routeReevalIntervalS: 5,
    routeSwitchMinImprovementS: 8,
    routeSwitchMinImprovementFraction: 0.15,
    routeSwitchCooldownS: 30,
    routeSwitchMaxPerEmergency: 3,
    routeSwitchNearDestinationGuardS: 15,
    metricsSampleIntervalS: 5,
    comparisonWarmupSeconds: 30,
    comparisonDurationCapSeconds: 480,
    ...overrides,
  };
}

/**
 * Builds the full wired application (DB + migrations + manager + traffic
 * service + websocket) exactly like main.ts, for integration tests.
 */
export async function createTestHarness(overrides: Partial<AppConfig> = {}): Promise<TestAppHarness> {
  const config = harnessConfig(overrides);
  const logger = createLogger("test", "error");
  const db = await createDatabasePool({ connectionString: config.databaseUrl });
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "database", "migrations");
  await runMigrations(db, migrationsDir, logger);
  const catalog = await loadNetworkCatalog(config.networkPath);
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);
  const manager = new SimulationManager({ config, logger });
  manager.setCatalog(catalog);
  const collector = new TrafficCollector({ catalog, thresholds: config.congestionThresholds });
  const wsBus = new WsBus(logger);
  const trafficService = new TrafficService({
    config,
    logger,
    manager,
    db,
    collector,
    catalog,
    bus: wsBus,
    roadGraph,
  });
  const controlledJunctions = new Set(catalog.signals.map((signal) => signal.id));
  const emergencyService = new EmergencyService({
    config,
    logger,
    manager,
    routeEngine,
    repository: new EmergencyRepository(db),
    bus: wsBus,
    controlledJunctions,
    getRunId: () => trafficService.getCurrentRunId(),
  });
  const predictionService = new PredictionService({
    config,
    logger,
    trafficService,
    db,
    bus: wsBus,
  });
  predictionService.start();
  const corridorService = new CorridorService({
    config,
    logger,
    manager,
    emergencyService,
    trafficService,
    predictionService,
    repository: new CorridorRepository(db),
    bus: wsBus,
    catalog,
  });
  const metricsRepository = new MetricsRepository(db);
  const metricsRecorder = new MetricsRecorder({
    config,
    logger,
    manager,
    emergencyService,
    trafficService,
    repository: metricsRepository,
  });
  const loopService = new ClosedLoopService({
    config,
    logger,
    manager,
    emergencyService,
    corridorService,
    predictionService,
    routeEngine,
    metricsRepository,
  });
  const comparisonService = new ScenarioComparisonService({
    config,
    logger,
    manager,
    emergencyService,
    corridorService,
    loopService,
    metricsRecorder,
    metricsRepository,
    trafficService,
  });
  const mobileRepo = new MobileRepository(db);
  const authService = new AuthService(mobileRepo);
  wsBus.setAuthService(authService);
  const aiVerificationService = new AiVerificationService({
    config,
    logger,
    mobileRepo,
    bus: wsBus,
    corridorService,
  });
  const mobileService = new MobileService({
    mobileRepo,
    emergencyService,
    emergencyRepo: new EmergencyRepository(db),
    corridorService,
    routeEngine,
    catalog,
    bus: wsBus,
    aiVerificationService,
  });
  const deviceRepository = new DeviceRepository(db);
  const deviceService = new RoadsideDeviceService({
    deviceRepo: deviceRepository,
    catalog,
    corridorService,
    emergencyService,
    manager,
    bus: wsBus,
    logger,
  });
  await deviceService.init();
  wsBus.setDeviceService(deviceService);

  const app = await buildApp({
    config,
    logger,
    manager,
    trafficService,
    emergencyService,
    predictionService,
    corridorService,
    loopService,
    metricsRepository,
    comparisonService,
    catalog,
    facilitiesPath: resolve(REPO_ROOT, "simulation", "sumo", "network", "facilities.add.xml"),
    db,
    wsBus,
    mobileRepo,
    authService,
    mobileService,
    aiVerificationService,
    emergencyRepo: new EmergencyRepository(db),
    deviceService,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  trafficService.startBroadcastLoop();
  return {
    app,
    manager,
    trafficService,
    emergencyService,
    predictionService,
    corridorService,
    loopService,
    metricsRecorder,
    metricsRepository,
    comparisonService,
    routeEngine,
    roadGraph,
    db,
    wsBus,
    port,
    close: async () => {
      await loopService.dispose();
      await metricsRecorder.dispose();
      await corridorService.dispose();
      await predictionService.dispose();
      await emergencyService.dispose();
      await trafficService.dispose();
      deviceService.dispose();
      await manager.stop();
      await app.close();
      await db.close();
    },
  };
}
