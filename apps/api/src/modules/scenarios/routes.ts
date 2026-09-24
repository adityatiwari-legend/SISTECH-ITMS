import type { FastifyInstance } from "fastify";
import type { EmergencyType, EmergencyPriority } from "@itms/types";
import { AppError } from "../../errors.ts";
import type { ScenarioComparisonService } from "./scenario-comparison-service.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";

const compareBodySchema = {
  type: "object",
  required: ["type", "origin", "destination", "priority"],
  properties: {
    type: { type: "string", enum: ["ambulance", "fire_engine", "police"] },
    origin: { type: "string", pattern: "^[A-Za-z0-9_#][A-Za-z0-9_#.-]{0,127}$" },
    destination: { type: "string", pattern: "^[A-Za-z0-9_#][A-Za-z0-9_#.-]{0,127}$" },
    priority: { type: "string", enum: ["critical", "high", "normal"] },
    warmupSeconds: { type: "number", minimum: 0, maximum: 600 },
    durationCapSeconds: { type: "number", minimum: 30, maximum: 7200 },
  },
  additionalProperties: false,
} as const;

const jobIdParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-f-]{10,64}$" },
  },
  additionalProperties: false,
} as const;

/**
 * Phase 6 APIs: baseline vs ITMS comparison jobs and recorded run metrics.
 */
export async function scenarioRoutes(
  app: FastifyInstance,
  options: {
    comparisonService: ScenarioComparisonService;
    metricsRepository: MetricsRepository;
  },
): Promise<void> {
  const { comparisonService, metricsRepository } = options;

  app.post("/api/scenarios/compare", { schema: { body: compareBodySchema } }, async (request, reply) => {
    const body = request.body as {
      type: EmergencyType;
      origin: string;
      destination: string;
      priority: EmergencyPriority;
      warmupSeconds?: number;
      durationCapSeconds?: number;
    };
    const job = comparisonService.startComparison(body);
    return reply.code(202).send(job);
  });

  app.get("/api/scenarios/compare", async () => {
    return { comparisons: comparisonService.listJobs() };
  });

  app.get("/api/scenarios/compare/:id", { schema: { params: jobIdParamSchema } }, async (request) => {
    const { id } = request.params as { id: string };
    const job = comparisonService.getJob(id);
    if (job === null) {
      throw new AppError(404, "unknown_comparison", `Unknown comparison job ${id}.`);
    }
    return job;
  });

  app.get("/api/scenarios/runs", async () => {
    return { runs: await metricsRepository.listRunMetrics() };
  });
}
