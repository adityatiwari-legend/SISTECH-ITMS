import type { FastifyInstance } from "fastify";
import type { EmergencyType, EmergencyPriority, EmergencyEventDetail } from "@itms/types";
import { AppError } from "../../errors.ts";
import type { EmergencyService } from "./emergency-service.ts";

const createBodySchema = {
  type: "object",
  required: ["type", "origin", "destination", "priority"],
  properties: {
    type: { type: "string", enum: ["ambulance", "fire_engine", "police"] },
    origin: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,15}$" },
    destination: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,15}$" },
    priority: { type: "string", enum: ["critical", "high", "normal"] },
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

/**
 * Emergency APIs (Phases.md 3.3).
 */
export async function emergencyRoutes(
  app: FastifyInstance,
  options: { emergencyService: EmergencyService },
): Promise<void> {
  const { emergencyService } = options;

  app.post("/api/emergency", { schema: { body: createBodySchema } }, async (request, reply) => {
    const body = request.body as {
      type: EmergencyType;
      origin: string;
      destination: string;
      priority: EmergencyPriority;
    };
    const detail = await emergencyService.createEmergency(body);
    return reply.code(201).send(detail);
  });

  app.get("/api/emergency", async () => {
    return { emergencies: await emergencyService.listEmergencies() };
  });

  app.get("/api/emergency/:id", { schema: { params: idParamSchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new AppError(400, "invalid_emergency_id", `Emergency id "${id}" is not a positive integer.`);
    }
    const detail: EmergencyEventDetail = await emergencyService.getEmergency(numericId);
    return detail;
  });
}
