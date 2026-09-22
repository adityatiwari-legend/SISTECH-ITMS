import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppConfig } from "./config.ts";
import { AppError } from "./errors.ts";
import type { Logger } from "./logger.ts";
import { simulationRoutes } from "./modules/simulation/routes.ts";
import { trafficRoutes } from "./modules/traffic/routes.ts";
import { websocketRoutes } from "./modules/websocket/routes.ts";
import type { SimulationManager } from "./modules/simulation/simulation-manager.ts";
import type { TrafficService } from "./modules/traffic/traffic-service.ts";

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  manager: SimulationManager;
  trafficService: TrafficService;
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

  await app.register(simulationRoutes, { manager: deps.manager });
  await app.register(trafficRoutes, { trafficService: deps.trafficService });
  await app.register(websocketRoutes, { bus: deps.wsBus });

  return app;
}
