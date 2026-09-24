import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.ts";
import { AppError } from "./errors.ts";
import type { Logger } from "./logger.ts";
import { simulationRoutes } from "./modules/simulation/routes.ts";
import { trafficRoutes } from "./modules/traffic/routes.ts";
import { emergencyRoutes } from "./modules/emergency/routes.ts";
import { predictionRoutes } from "./modules/prediction/routes.ts";
import { corridorRoutes } from "./modules/corridor/routes.ts";
import { scenarioRoutes } from "./modules/scenarios/routes.ts";
import { systemRoutes } from "./modules/system/routes.ts";
import { websocketRoutes } from "./modules/websocket/routes.ts";
import { aiRoutes } from "./modules/ai/routes.ts";
import { AiCopilotService } from "./modules/ai/copilot-service.ts";
import type { SimulationManager } from "./modules/simulation/simulation-manager.ts";
import type { TrafficService } from "./modules/traffic/traffic-service.ts";
import type { EmergencyService } from "./modules/emergency/emergency-service.ts";
import type { PredictionService } from "./modules/prediction/prediction-service.ts";
import type { CorridorService } from "./modules/corridor/corridor-service.ts";

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  manager: SimulationManager;
  trafficService: TrafficService;
  emergencyService: EmergencyService;
  predictionService: PredictionService;
  corridorService: CorridorService;
  loopService: import("./modules/loop/closed-loop-service.ts").ClosedLoopService;
  metricsRepository: import("./database/repositories/metrics-repository.ts").MetricsRepository;
  comparisonService: import("./modules/scenarios/scenario-comparison-service.ts").ScenarioComparisonService;
  catalog: import("./modules/simulation/network-loader.ts").NetworkCatalog;
  facilitiesPath: string;
  db: import("./database/db.ts").DatabasePool;
  wsBus: import("./modules/websocket/ws-bus.ts").WsBus;
}

/** Builds the Fastify app with consistent error handling and routes. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 64,
    ajv: {
      customOptions: {
        // Strict validation: unknown properties must fail instead of being
        // silently stripped by Ajv's default removeAdditional behavior.
        removeAdditional: false,
      },
    },
  });

  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // CORS: the browser UI (apps/web) calls this API cross-origin. Preflight
  // OPTIONS requests must be answered here or the browser blocks everything.
  // Origins: CORS_ORIGIN env var (comma-separated, "*" allows all);
  // default covers the local dev frontends. @fastify/cors accepts arrays
  // natively (reflects the request origin on match).
  const corsOriginRaw = deps.config.corsOrigin;
  const corsOrigin: boolean | string[] = corsOriginRaw.includes("*") ? true : corsOriginRaw;
  await app.register(cors, {
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type"],
    credentials: false,
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const validation = (error as { validation?: unknown }).validation;
    if (validation !== undefined) {
      const message = error instanceof Error ? error.message : "Invalid request.";
      return reply.code(400).send({
        error: { code: "validation_error", message },
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : "Request failed.";
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: "request_error", message },
      });
    }
    deps.logger.error("Unhandled request error", {
      method: request.method,
      url: request.url,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return reply.code(500).send({
      error: { code: "internal_error", message: "Internal server error." },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: { code: "not_found", message: `Route ${request.method} ${request.url} not found.` },
    });
  });

  /** Simple health probe (Phase 6 of the repair prompt). */
  app.get("/health", async () => {
    return { status: "ok", service: "itms-backend", timestamp: new Date().toISOString() };
  });

  await app.register(simulationRoutes, { manager: deps.manager });
  await app.register(trafficRoutes, { trafficService: deps.trafficService });
  await app.register(emergencyRoutes, { emergencyService: deps.emergencyService });
  await app.register(predictionRoutes, { predictionService: deps.predictionService });
  await app.register(corridorRoutes, { corridorService: deps.corridorService });
  await app.register(scenarioRoutes, {
    comparisonService: deps.comparisonService,
    metricsRepository: deps.metricsRepository,
  });
  await app.register(systemRoutes, {
    config: deps.config,
    manager: deps.manager,
    db: deps.db!,
    predictionService: deps.predictionService,
    metricsRepository: deps.metricsRepository,
    catalog: deps.catalog,
    facilitiesPath: deps.facilitiesPath!,
  });
  await app.register(websocketRoutes, { bus: deps.wsBus });

  const copilotService = new AiCopilotService({
    config: deps.config,
    logger: deps.logger,
    manager: deps.manager,
    emergencyService: deps.emergencyService,
    corridorService: deps.corridorService,
    trafficService: deps.trafficService,
    predictionService: deps.predictionService,
    db: deps.db,
  });
  await app.register(aiRoutes, { copilotService });

  return app;
}
