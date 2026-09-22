import type { FastifyInstance } from "fastify";
import type { SimulationScenarioId } from "@itms/types";
import type { SimulationManager } from "./simulation-manager.ts";
import { AppError } from "../../errors.ts";

const SCENARIOS: SimulationScenarioId[] = ["baseline", "emergency"];

const startBodySchema = {
  type: "object",
  properties: {
    scenario: { type: "string", enum: SCENARIOS },
  },
  additionalProperties: false,
} as const;

const signalStateBodySchema = {
  type: "object",
  required: ["state"],
  properties: {
    state: { type: "string", pattern: "^[rRyYgGoOsU]{1,128}$" },
  },
  additionalProperties: false,
} as const;

const signalIdParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,64}$" },
  },
  additionalProperties: false,
} as const;

/**
 * Phase 1 REST surface: simulation control plus read access to vehicles and
 * traffic signals, and the ability to set a signal's red/yellow/green state.
 */
export async function simulationRoutes(
  app: FastifyInstance,
  options: { manager: SimulationManager },
): Promise<void> {
  const { manager } = options;

  const requireActive = () => {
    const snapshot = manager.getStatusSnapshot();
    if (snapshot.status !== "running" && snapshot.status !== "paused") {
      const detail = snapshot.lastError ? ` Last error: ${snapshot.lastError}` : "";
      throw new AppError(409, "simulation_not_running", `Simulation is ${snapshot.status}.${detail}`);
    }
    return snapshot;
  };

  app.post("/api/simulation/start", { schema: { body: startBodySchema } }, async (request, reply) => {
    const body = (request.body ?? {}) as { scenario?: SimulationScenarioId };
    const snapshot = await manager.start(body.scenario ?? "baseline");
    return reply.code(200).send(snapshot);
  });

  app.post("/api/simulation/stop", async () => {
    return manager.stop();
  });

  app.post("/api/simulation/pause", async () => {
    return manager.pause();
  });

  app.post("/api/simulation/resume", async () => {
    return manager.resume();
  });

  app.get("/api/simulation/state", async () => {
    return manager.getStatusSnapshot();
  });

  app.get("/api/vehicles", async () => {
    requireActive();
    return { vehicles: manager.getVehicles() };
  });

  app.get("/api/signals", async () => {
    requireActive();
    return { signals: manager.getSignals() };
  });

  app.get("/api/signals/:id", { schema: { params: signalIdParamSchema } }, async (request) => {
    requireActive();
    const { id } = request.params as { id: string };
    const signal = manager.getSignal(id);
    if (signal === null) {
      throw new AppError(404, "unknown_signal", `Unknown traffic signal "${id}".`);
    }
    return signal;
  });

  app.post(
    "/api/signals/:id/state",
    { schema: { params: signalIdParamSchema, body: signalStateBodySchema } },
    async (request) => {
      requireActive();
      const { id } = request.params as { id: string };
      const { state } = request.body as { state: string };
      return manager.setSignalState(id, state);
    },
  );
}
