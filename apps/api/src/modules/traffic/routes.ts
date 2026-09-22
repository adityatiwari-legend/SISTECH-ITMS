import type { FastifyInstance } from "fastify";
import { AppError } from "../../errors.ts";
import type { TrafficService } from "./traffic-service.ts";

const API_BASE = "/api/traffic";

/**
 * Phase 2 traffic APIs. Responses are typed; the service surfaces both live
 * simulation state and system health (simulation status, DB connectivity,
 * staleness).
 */
export async function trafficRoutes(app: FastifyInstance, options: { trafficService: TrafficService }): Promise<void> {
  const { trafficService } = options;

  app.get(`${API_BASE}`, async () => {
    return trafficService.getTrafficSnapshot();
  });

  app.get(`${API_BASE}/roads`, async () => {
    try {
      return { roads: await trafficService.getRoads() };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, "db_unavailable", "Road registry is unavailable (database error).");
    }
  });

  app.get(`${API_BASE}/intersections`, async () => {
    try {
      return { intersections: await trafficService.getIntersections() };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, "db_unavailable", "Intersection registry is unavailable (database error).");
    }
  });
}
