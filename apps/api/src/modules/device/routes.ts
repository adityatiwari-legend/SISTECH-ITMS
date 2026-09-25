import type { FastifyInstance } from "fastify";
import type { RoadsideDeviceService } from "./device-service.ts";
import { AppError } from "../../errors.ts";

export async function deviceRoutes(
  app: FastifyInstance,
  options: { deviceService: RoadsideDeviceService }
): Promise<void> {
  const { deviceService } = options;

  // GET /api/devices — List all registered devices
  app.get("/api/devices", async () => {
    const devices = await deviceService.getAllDevices();
    return { devices };
  });

  // GET /api/devices/signal/:signalId — Find device by controlled signal ID
  app.get("/api/devices/signal/:signalId", async (request) => {
    const { signalId } = request.params as { signalId: string };
    const device = await deviceService.getDeviceBySignalId(signalId);
    if (!device) {
      throw new AppError(404, "device_not_found", `No roadside device mapped to signal "${signalId}".`);
    }
    const snapshot = deviceService.getDeviceSnapshot(device.deviceId);
    return snapshot ?? { device };
  });

  // GET /api/devices/:deviceId — Get specific device
  app.get("/api/devices/:deviceId", async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    const device = await deviceService.getDevice(deviceId);
    if (!device) {
      throw new AppError(404, "device_not_found", `Roadside device "${deviceId}" not found.`);
    }
    return device;
  });

  // GET /api/devices/:deviceId/state — Authoritative state snapshot for instant sync upon reconnect
  app.get("/api/devices/:deviceId/state", async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    const device = await deviceService.getDevice(deviceId);
    if (!device) {
      throw new AppError(404, "device_not_found", `Roadside device "${deviceId}" is not registered.`);
    }
    const snapshot = deviceService.getDeviceSnapshot(device.deviceId);
    if (!snapshot) {
      throw new AppError(500, "state_unavailable", `Could not retrieve state snapshot for "${deviceId}".`);
    }
    return snapshot;
  });

  // POST /api/devices/register — Register/configure device
  app.post("/api/devices/register", async (request, reply) => {
    const body = request.body as {
      deviceId?: string;
      signalId?: string;
      deviceName?: string;
      deviceType?: "SIMULATED_DISPLAY" | "PHYSICAL_DISPLAY";
    };

    if (!body?.deviceId || !body?.signalId) {
      throw new AppError(400, "invalid_request", "Both deviceId and signalId are required.");
    }

    const device = await deviceService.registerDevice({
      deviceId: body.deviceId.trim(),
      signalId: body.signalId.trim(),
      deviceName: body.deviceName?.trim(),
      deviceType: body.deviceType,
    });

    const snapshot = deviceService.getDeviceSnapshot(device.deviceId);
    return reply.code(201).send(snapshot ?? { device });
  });

  // POST /api/devices/:deviceId/heartbeat — Device heartbeat
  app.post("/api/devices/:deviceId/heartbeat", async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    await deviceService.handleDeviceHeartbeat(deviceId);
    return { ok: true, timestamp: new Date().toISOString() };
  });

  // POST /api/devices/:deviceId/reset — Dev / demo reset to idle
  app.post("/api/devices/:deviceId/reset", async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    const resetResult = await deviceService.resetDevice(deviceId);
    if (!resetResult) {
      throw new AppError(404, "device_not_found", `Roadside device "${deviceId}" not found.`);
    }
    return resetResult;
  });
}
