import type { FastifyInstance } from "fastify";
import { AppError } from "../../errors.ts";
import type { DatabasePool } from "../../database/db.ts";
import type { AppConfig } from "../../config.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { PredictionService } from "../prediction/prediction-service.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";
import { getAnalytics, getDecisionTrace, getSystemOverview } from "./overview.ts";
import { getNetworkGeometry } from "./geometry.ts";

/**
 * Phase 7 system endpoints: analytics, decision trace, system overview,
 * map geometry. All data comes from the database / network files / live
 * services — nothing is fabricated.
 */
export async function systemRoutes(
  app: FastifyInstance,
  options: {
    config: AppConfig;
    manager: SimulationManager;
    db: DatabasePool;
    predictionService: PredictionService;
    metricsRepository: MetricsRepository;
    catalog: import("../simulation/network-loader.ts").NetworkCatalog;
    facilitiesPath: string;
  },
): Promise<void> {
  const { config, manager, db, predictionService, metricsRepository, catalog, facilitiesPath } = options;

  app.get("/api/network/geometry", async () => {
    return getNetworkGeometry(catalog, facilitiesPath);
  });

  app.get("/api/analytics", async () => {
    return getAnalytics(db);
  });

  app.get("/api/decisions", async () => {
    return { events: await getDecisionTrace(db) };
  });

  app.get("/api/system", async () => {
    return getSystemOverview(config, manager, db, predictionService);
  });
}

/** Guard for typed callers that need a strict failure envelope. */
export function systemUnavailable(err: unknown): AppError {
  return new AppError(503, "system_unavailable", err instanceof Error ? err.message : "System data unavailable.");
}
