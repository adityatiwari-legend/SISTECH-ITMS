import type { FastifyInstance } from "fastify";
import type { WsBus } from "./ws-bus.ts";

/**
 * WebSocket endpoint for real-time events (Phases.md 2.6).
 *
 * Clients connect to /ws and receive the broadcast events
 * (traffic:update, vehicle:update, signal:update, system:alert).
 * The broadcast pace is controlled by the traffic service; this module
 * only manages connections.
 */
export async function websocketRoutes(app: FastifyInstance, options: { bus: WsBus }): Promise<void> {
  const { bus } = options;

  app.get("/ws", { websocket: true }, (socket, request) => {
    const token = (request.query as { token?: string })?.token;
    bus.addClient(socket, token);
  });
}
