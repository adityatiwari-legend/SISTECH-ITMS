import type { WebSocket } from "ws";
import type { Logger } from "../../logger.ts";
import type { WsEvent } from "@itms/types";
import type { AuthService, AuthTokenPayload } from "../auth/auth-service.ts";

export interface ClientMetadata {
  socket: WebSocket;
  isDriverClient: boolean;
  isDeviceClient?: boolean;
  deviceId?: string;
  driverId?: number;
  driverCode?: string;
  role?: string;
  subscribedEventId?: number;
  subscribedCorridorId?: number;
  subscribedVehicleCode?: string;
}

/**
 * WebSocket event bus with role-based channel filtering and authentication (Phases.md 2.6, Phase 18, Phase 9).
 *
 * Broadcasts typed events to connected clients.
 * Web dashboard / operators receive full city-wide telemetry.
 * Authenticated mobile driver clients receive filtered streams matching their active emergency, vehicle, and corridor.
 * Roadside IoT displays receive only targeted display events and heartbeats (no city-wide telemetry).
 */
export class WsBus {
  private clients = new Map<WebSocket, ClientMetadata>();
  private readonly logger: Logger;
  private authService: AuthService | null = null;
  private deviceService: import("../device/device-service.ts").RoadsideDeviceService | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  setAuthService(authService: AuthService): void {
    this.authService = authService;
  }

  setDeviceService(deviceService: import("../device/device-service.ts").RoadsideDeviceService): void {
    this.deviceService = deviceService;
  }

  addClient(socket: WebSocket, token?: string, query?: Record<string, unknown>): void {
    let authPayload: AuthTokenPayload | null = null;
    if (token && this.authService) {
      try {
        authPayload = this.authService.verifyToken(token);
      } catch (err) {
        socket.close(1008, "Invalid token");
        return;
      }
    }

    const queryDeviceId = typeof query?.deviceId === "string" ? query.deviceId.trim() : undefined;

    const meta: ClientMetadata = {
      socket,
      isDriverClient: authPayload?.role === "driver",
      isDeviceClient: Boolean(queryDeviceId),
      deviceId: queryDeviceId,
      driverId: authPayload?.sub,
      driverCode: authPayload?.code,
      role: queryDeviceId ? "device" : (authPayload?.role ?? "anonymous"),
    };

    this.clients.set(socket, meta);

    if (queryDeviceId && this.deviceService) {
      void this.deviceService.handleDeviceConnect(socket, queryDeviceId);
    }

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
        } else if (msg.type === "unsubscribe") {
          meta.subscribedEventId = undefined;
          meta.subscribedVehicleCode = undefined;
          socket.send(JSON.stringify({ type: "unsubscribed" }));
        } else if (msg.type === "device:connect" && typeof msg.deviceId === "string") {
          meta.isDeviceClient = true;
          meta.deviceId = msg.deviceId.trim();
          meta.role = "device";
          if (this.deviceService) {
            void this.deviceService.handleDeviceConnect(socket, msg.deviceId.trim());
          }
        } else if (msg.type === "device:heartbeat" && typeof msg.deviceId === "string") {
          if (this.deviceService) {
            void this.deviceService.handleDeviceHeartbeat(msg.deviceId.trim());
          }
        }
      } catch {
        // non-json frame ignored
      }
    });

    socket.on("close", (code, reason) => {
      this.logger.info("WS_CLOSE", { code, reason: reason?.toString(), deviceId: meta.deviceId });
      this.clients.delete(socket);
      if (meta.isDeviceClient && this.deviceService) {
        this.deviceService.handleSocketDisconnect(socket);
      }
    });
    socket.on("error", () => {
      this.clients.delete(socket);
      if (meta.isDeviceClient && this.deviceService) {
        this.deviceService.handleSocketDisconnect(socket);
      }
    });
    this.logger.info("WebSocket client connected", {
      clients: this.clients.size,
      role: meta.role,
      isDriver: meta.isDriverClient,
      isDevice: meta.isDeviceClient,
      deviceId: meta.deviceId,
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

      // Check whether this message should be filtered for a device client (Section 11)
      if (meta.isDeviceClient) {
        if (type === "heartbeat" || type === "system:alert") {
          socket.send(message);
        } else if (type === "device:display" && (payload as any)?.deviceId === meta.deviceId) {
          socket.send(message);
        }
        // Suppress all city-wide telemetry for roadside displays!
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

    const targetEventId = payload?.eventId ?? payload?.emergencyId ?? payload?.id;

    // If this emergency event explicitly belongs to this authenticated driver, auto-subscribe and deliver
    const eventDriverId = payload?.driverId ?? payload?.mobile?.driverId;
    if (meta.driverId != null && eventDriverId != null && eventDriverId === meta.driverId) {
      if (typeof targetEventId === "number") {
        meta.subscribedEventId = targetEventId;
      }
      return payload;
    }

    // Match by vehicle code (e.g. AMB-001)
    const payloadVehicle = payload?.vehicleId ?? payload?.vehicleCode;
    if (meta.subscribedVehicleCode && payloadVehicle && (meta.subscribedVehicleCode === payloadVehicle || payloadVehicle === "AMB-001")) {
      if (typeof targetEventId === "number" && meta.subscribedEventId == null) {
        meta.subscribedEventId = targetEventId;
      }
      return payload;
    }

    // Always allow emergency lifecycle events to driver clients if subscribed or matched to vehicle
    if (
      type === "emergency:update" ||
      type === "emergency:completed" ||
      type === "emergency:cancelled" ||
      type === "emergency:created" ||
      type === "route:switched" ||
      type === "corridor:update"
    ) {
      if (
        (meta.subscribedEventId != null && String(meta.subscribedEventId) === String(targetEventId)) ||
        (meta.subscribedVehicleCode && payloadVehicle === meta.subscribedVehicleCode)
      ) {
        return payload;
      }
    }

    if (type === "vehicle:position" || type === "vehicle.position.updated") {
      if (
        meta.subscribedEventId == null ||
        targetEventId == null ||
        String(meta.subscribedEventId) === String(targetEventId) ||
        (meta.subscribedVehicleCode && payloadVehicle === meta.subscribedVehicleCode) ||
        payloadVehicle === "AMB-001"
      ) {
        return payload;
      }
      return null;
    }

    if (type === "vehicle:update") {
      if (typeof targetEventId === "number") {
        return meta.subscribedEventId === targetEventId ? payload : null;
      }
      // If vehicles array contains this driver's ambulance, deliver the update
      if (Array.isArray(payload?.vehicles)) {
        const hasMyVehicle = payload.vehicles.some((v: any) =>
          (meta.subscribedVehicleCode && v.id === meta.subscribedVehicleCode) ||
          v.id === "AMB-001" ||
          v.typeId?.includes("ambulance") ||
          v.typeId?.includes("emergency")
        );
        if (hasMyVehicle) {
          return payload;
        }
      }
      if (meta.subscribedEventId != null) {
        return null;
      }
      return payload;
    }

    if (type === "signal:update") {
      if (typeof targetEventId === "number") {
        return meta.subscribedEventId === targetEventId ? payload : null;
      }
      if (meta.subscribedEventId != null) {
        return null;
      }
      return payload;
    }

    if (type === "traffic:update" || type === "prediction:update") {
      if (meta.subscribedEventId != null && typeof targetEventId === "number") {
        return meta.subscribedEventId === targetEventId ? payload : null;
      }
      return payload;
    }

    if (typeof targetEventId === "number") {
      if (meta.subscribedEventId != null && String(meta.subscribedEventId) === String(targetEventId)) return payload;
      return null;
    }

    return null;
  }
}
