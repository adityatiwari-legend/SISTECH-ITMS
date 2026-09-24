import type { FastifyInstance } from "fastify";
import type { SimulationScenarioId } from "@itms/types";
import type { SimulationManager } from "./simulation-manager.ts";
import { AppError } from "../../errors.ts";

const SCENARIOS: SimulationScenarioId[] = ["baseline", "emergency", "emergency_low", "emergency_high"];

const startBodySchema = {
  type: "object",
  properties: {
    scenario: { type: "string", enum: SCENARIOS },
  },
  additionalProperties: false,
} as const;

const resetBodySchema = {
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

  const paceBodySchema = {
    type: "object",
    required: ["multiplier"],
    properties: {
      multiplier: { type: "number", enum: [1, 2, 5, 10] },
    },
    additionalProperties: false,
  } as const;

  app.post("/api/simulation/speed", { schema: { body: paceBodySchema } }, async (request) => {
    const { multiplier } = request.body as { multiplier: number };
    return manager.setPace(multiplier);
  });

  /** Reset = stop the current simulation and start it again (same scenario
   *  when one is/was active, otherwise the default). Deterministic: a fresh
   *  SUMO process reloads the scenario from the beginning. */
  app.post("/api/simulation/reset", { schema: { body: resetBodySchema } }, async (request) => {
    const body = (request.body ?? {}) as { scenario?: SimulationScenarioId };
    const previous = manager.getStatusSnapshot();
    const target = body.scenario ?? previous.scenario ?? "baseline";
    await manager.stop();
    return manager.start(target, { autoRun: true });
  });

  app.get("/api/simulation/state", async () => {
    return manager.getStatusSnapshot();
  });

  app.get("/api/vehicles", async () => {
    return { vehicles: manager.getVehicles() };
  });

  app.get("/api/signals", async () => {
    const live = manager.getSignals();
    if (live.length > 0) {
      return { signals: live };
    }
    const catalog = manager.getCatalog();
    if (catalog !== null && catalog.signals.length > 0) {
      return {
        signals: catalog.signals.map((sig) => ({
          id: sig.id,
          program: sig.programId || "0",
          state: sig.phases[0]?.state ?? "G",
          phaseIndex: 0,
          phaseDurationSeconds: sig.phases[0]?.durationS ?? 30,
          nextSwitchAtSeconds: sig.phases[0]?.durationS ?? 30,
          queueLength: 0,
          controlledLanes: [],
        })),
      };
    }
    return { signals: [] };
  });

  app.get("/api/signals/:id", { schema: { params: signalIdParamSchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const signal = manager.getSignal(id);
    if (signal !== null) {
      return signal;
    }
    const catalogSig = manager.getCatalog()?.signals.find((s) => s.id === id);
    if (catalogSig) {
      return {
        id: catalogSig.id,
        program: catalogSig.programId || "0",
        state: catalogSig.phases[0]?.state ?? "G",
        phaseIndex: 0,
        phaseDurationSeconds: catalogSig.phases[0]?.durationS ?? 30,
        nextSwitchAtSeconds: catalogSig.phases[0]?.durationS ?? 30,
        queueLength: 0,
        controlledLanes: [],
      };
    }
    throw new AppError(404, "unknown_signal", `Unknown traffic signal "${id}".`);
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
