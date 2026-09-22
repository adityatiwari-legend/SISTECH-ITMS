import { loadConfig } from "./config.ts";
import { createLogger, parseLogLevel } from "./logger.ts";
import { buildApp } from "./app.ts";
import { SimulationManager } from "./modules/simulation/simulation-manager.ts";
import { loadNetworkCatalog } from "./modules/simulation/network-loader.ts";
import { RoadGraph } from "./modules/routing/road-graph.ts";
import { RouteEngine } from "./modules/routing/route-engine.ts";
import { TrafficCollector } from "./modules/traffic/collector.ts";
import { TrafficService } from "./modules/traffic/traffic-service.ts";
import { EmergencyService } from "./modules/emergency/emergency-service.ts";
import { EmergencyRepository } from "./database/repositories/emergency-repository.ts";
import { WsBus } from "./modules/websocket/ws-bus.ts";
import { createDatabasePool } from "./database/db.ts";
import { runMigrations } from "./database/migrate.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("api", parseLogLevel(config.logLevel));

  // ---- database (fail fast with a clear message when unreachable) ----
  logger.info("Connecting to PostgreSQL", { url: config.databaseUrl.replace(/:[^:@/]+@/, ":***@") });
  const db = await createDatabasePool({ connectionString: config.databaseUrl });
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "database", "migrations");
  const migrations = await runMigrations(db, migrationsDir, logger);
  logger.info("Migrations checked", { applied: migrations.applied.length, skipped: migrations.skipped.length });

  // ---- network catalog (static registry source of truth) ----
  const catalog = await loadNetworkCatalog(config.networkPath);
  logger.info("Network catalog loaded", {
    junctions: catalog.junctions.length,
    segments: catalog.segments.length,
    roads: catalog.roads.length,
    signals: catalog.signals.length,
  });

  // ---- routing (road graph + A* engine) ----
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);

  // ---- simulation + traffic intelligence + emergency ----
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
  trafficService.startBroadcastLoop();

  const emergencyRepository = new EmergencyRepository(db);
  const controlledJunctions = new Set(catalog.signals.map((signal) => signal.id));
  const emergencyService = new EmergencyService({
    config,
    logger,
    manager,
    routeEngine,
    repository: emergencyRepository,
    bus: wsBus,
    controlledJunctions,
    getRunId: () => trafficService.getCurrentRunId(),
  });

  const app = await buildApp({ config, logger, manager, trafficService, emergencyService, wsBus });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    try {
      await emergencyService.dispose();
    } catch (err) {
      logger.warn("Error while disposing emergency service", { error: err });
    }
    try {
      await trafficService.dispose();
    } catch (err) {
      logger.warn("Error while disposing traffic service", { error: err });
    }
    try {
      await manager.stop();
    } catch (err) {
      logger.warn("Error while stopping simulation during shutdown", { error: err });
    }
    try {
      await app.close();
    } catch (err) {
      logger.warn("Error while closing HTTP server during shutdown", { error: err });
    }
    try {
      await db.close();
    } catch (err) {
      logger.warn("Error while closing database pool", { error: err });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { error: reason });
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception; exiting", { error: err });
    void shutdown("uncaughtException");
  });

  await app.listen({ port: config.port, host: config.host });
  logger.info("ITMS API listening", { host: config.host, port: config.port });
}

main().catch((err) => {
  console.error("Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
