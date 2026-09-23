import type { WebSocket } from "ws";
import type { Logger } from "../../logger.ts";
import type { WsEvent } from "@itms/types";

/**
 * WebSocket event bus (Phases.md 2.6).
 *
 * Broadcasts typed events to all connected clients. Clients must never
 * receive unbounded high-frequency traffic: the traffic service controls
 * the broadcast interval and only sends when new data exists.
 */
export class WsBus {
  private clients = new Set<WebSocket>();
  private readonly logger: Logger;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  addClient(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
    this.logger.info("WebSocket client connected", { clients: this.clients.size });
  }

  clientCount(): number {
    return this.clients.size;
  }

  /** Periodic heartbeat so clients can detect silent dead connections. */
  startHeartbeat(intervalMs = 15_000): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      this.broadcast("heartbeat", { timestamp: Date.now() });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  broadcast<T>(type: WsEvent<T>["type"], payload: T): void {
    const event: WsEvent<T> = { type, ts: new Date().toISOString(), payload };
    const message = JSON.stringify(event);
    for (const socket of [...this.clients]) {
      if (socket.readyState !== socket.OPEN) {
        this.clients.delete(socket);
        continue;
      }
      socket.send(message, (err) => {
        if (err) {
          this.clients.delete(socket);
          this.logger.warn("WebSocket send failed; client dropped", { error: err.message });
        }
      });
    }
  }
}
