import type { FastifyInstance } from "fastify";
import { AppError } from "../../errors.ts";
import type { CorridorService } from "./corridor-service.ts";

const createBodySchema = {
  type: "object",
  properties: {
    eventId: { type: "integer", minimum: 1 },
    emergencyEventId: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9]{1,12}$" },
  },
  additionalProperties: false,
} as const;

const cancelBodySchema = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 256 },
  },
  additionalProperties: false,
} as const;

/**
 * Corridor APIs (Architecture.md 15).
 */
export async function corridorRoutes(
  app: FastifyInstance,
  options: { corridorService: CorridorService },
): Promise<void> {
  const { corridorService } = options;

  app.post("/api/corridors", { schema: { body: createBodySchema } }, async (request, reply) => {
    const body = request.body as { eventId?: number; emergencyEventId?: number };
    const eventId = body.eventId ?? body.emergencyEventId;
    if (!eventId) {
      throw new AppError(400, "missing_event_id", "eventId or emergencyEventId is required.");
    }
    const detail = await corridorService.createCorridor(eventId);
    return reply.code(201).send(detail);
  });

  app.get("/api/corridors", async () => {
    return { corridors: await corridorService.listCorridors() };
  });

  app.get("/api/corridors/:id", { schema: { params: idParamSchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new AppError(400, "invalid_corridor_id", `Corridor id "${id}" is not a positive integer.`);
    }
    return corridorService.getCorridor(numericId);
  });

  app.post("/api/corridors/:id/activate", { schema: { params: idParamSchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new AppError(400, "invalid_corridor_id", `Corridor id "${id}" is not a positive integer.`);
    }
    return corridorService.activateCorridor(numericId);
  });

  app.post("/api/corridors/:id/cancel", { schema: { params: idParamSchema, body: cancelBodySchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new AppError(400, "invalid_corridor_id", `Corridor id "${id}" is not a positive integer.`);
    }
    const body = (request.body ?? {}) as { reason?: string };
    return corridorService.cancelCorridor(numericId, body.reason ?? null);
  });
}
