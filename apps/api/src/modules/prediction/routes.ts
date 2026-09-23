import type { FastifyInstance } from "fastify";
import type { PredictionService } from "./prediction-service.ts";

/** GET /api/predictions (Architecture.md 15). */
export async function predictionRoutes(
  app: FastifyInstance,
  options: { predictionService: PredictionService },
): Promise<void> {
  const { predictionService } = options;

  app.get("/api/predictions", async () => {
    return predictionService.getResponse();
  });
}
