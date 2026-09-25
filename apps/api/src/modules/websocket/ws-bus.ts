import type { WebSocket } from "ws";
import type { Logger } from "../../logger.ts";
import type { WsEvent } from "@itms/types";
import type { AuthService, AuthTokenPayload } from "../auth/auth-service.ts";

export interface ClientMetadata {
  socket: WebSocket;
  isDriverClient: boolean;
  driverId?: number;
  driverCode?: string;
  role?: string;
  subscribedEventId?: number;
  subscribedCorridorId?: number;
  subscribedVehicleCode?: string;
}

/**
 * WebSocket event bus with role-based channel filtering and authentication (Phases.md 2.6, Phase 18).
 *
 * Broadcasts typed events to connected clients.
 * Web dashboard / operators receive full city-wide telemetry.
 * Authenticated mobile driver clients receive filtered streams matching their active emergency, vehicle, and corridor.
 */
export class WsBus {
  private clients = new Map<WebSocket, ClientMetadata>();
  private readonly logger: Logger;
  private authService: AuthService | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  setAuthService(authService: AuthService): void {
    this.authService = authService;
  }

  addClient(socket: WebSocket, token?: string): void {
    let authPayload: AuthTokenPayload | null = null;
    if (token && this.authService) {
      try {
        authPayload = this.authService.verifyToken(token);
      } catch (err) {
        socket.close(1008, "Invalid token");
        return;
      }
    }

    const meta: ClientMetadata = {
      socket,
      isDriverClient: authPayload?.role === "driver",
      driverId: authPayload?.sub,
      driverCode: authPayload?.code,
      role: authPayload?.role ?? "anonymous",
    };

    this.clients.set(socket, meta);

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth" && typeof msg.token === "string" && this.authService) {
          try {
            const p = this.authService.verifyToken(msg.token);
            meta.isDriverClient = p.role === "driver";
            meta.driverId = p.sub;
            meta.driverCode = p.code;
            meta.role = p.role;
            socket.send(JSON.stringify({ type: "auth:success", driverId: p.sub, role: p.role }));
          } catch (err) {
            socket.send(JSON.stringify({ type: "auth:failed", error: "Invalid token" }));
          }
        } else if (msg.type === "subscribe" && typeof msg.eventId === "number") {
          meta.subscribedEventId = msg.eventId;
          if (msg.vehicleCode) meta.subscribedVehicleCode = String(msg.vehicleCode);
          socket.send(JSON.stringify({ type: "subscribed", eventId: msg.eventId }));
        }
      } catch {
        // non-json frame ignored
      }
    });

    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
    this.logger.info("WebSocket client connected", {
      clients: this.clients.size,
      role: meta.role,
      isDriver: meta.isDriverClient,
    });
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

    for (const [socket, meta] of [...this.clients.entries()]) {
      if (socket.readyState !== socket.OPEN) {
        this.clients.delete(socket);
        continue;
      }

      // Check whether this message should be filtered for a driver mobile client
      if (meta.isDriverClient) {
        const filteredPayload = this.filterPayloadForDriver(type, payload, meta);
        if (filteredPayload === null) continue; // Suppress
        const driverEvent = { type, ts: new Date().toISOString(), payload: filteredPayload };
        socket.send(JSON.stringify(driverEvent), (err) => {
          if (err) {
            this.clients.delete(socket);
            this.logger.warn("WebSocket send failed; client dropped", { error: err.message });
          }
        });
      } else {
        socket.send(message, (err) => {
          if (err) {
            this.clients.delete(socket);
            this.logger.warn("WebSocket send failed; client dropped", { error: err.message });
          }
        });
      }
    }
  }

  private filterPayloadForDriver(type: string, payload: any, meta: ClientMetadata): any {
    if (type === "heartbeat" || type === "system:alert") {
      return payload;
    }

    if (type === "vehicle:update") {
      // Driver A receives only relevant vehicle telemetry (if emergencyId is matched)
      if (typeof payload?.emergencyId === "number" && payload.emergencyId === meta.subscribedEventId) {
        return payload;
      }
      return null;
    }

    if (type === "signal:update" || type === "prediction:update" || type === "traffic:update") {
      if (typeof payload?.emergencyId === "number" && payload.emergencyId === meta.subscribedEventId) {
        return payload;
      }
      return null; // suppress city-wide telemetry
    }

    const targetEventId = payload?.eventId ?? payload?.emergencyId;
    if (typeof targetEventId === "number") {
      if (meta.subscribedEventId === targetEventId) return payload;
      return null;
    }

    return null;
  }
}
