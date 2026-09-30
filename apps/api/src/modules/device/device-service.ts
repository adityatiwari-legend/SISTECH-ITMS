import type { WebSocket } from "ws";
import type {
  RoadsideDeviceRecord,
  RoadsideDeviceStatus,
  RoadsideDeviceType,
  DeviceDisplayPayload,
  DeviceDisplayState,
  DeviceStateSnapshot,
  EmergencyType,
  CorridorState,
} from "@itms/types";
import type { Logger } from "../../logger.ts";
import type { DeviceRepository } from "../../database/repositories/device-repository.ts";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import type { CorridorService, CorridorRuntime } from "../corridor/corridor-service.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import { getJunctionMeta } from "./naming.ts";

export interface RoadsideDeviceServiceOptions {
  deviceRepo: DeviceRepository;
  catalog: NetworkCatalog;
  corridorService: CorridorService;
  emergencyService: EmergencyService;
  manager: SimulationManager;
  bus: WsBus;
  logger: Logger;
}

export class RoadsideDeviceService {
  private readonly deviceRepo: DeviceRepository;
  private readonly catalog: NetworkCatalog;
  private readonly corridorService: CorridorService;
  private readonly emergencyService: EmergencyService;
  private readonly manager: SimulationManager;
  private readonly bus: WsBus;
  private readonly logger: Logger;

  /** Active sockets mapped by deviceId */
  private deviceSockets = new Map<string, Set<WebSocket>>();
  /** Reverse lookup: socket -> deviceId */
  private socketDeviceMap = new Map<WebSocket, string>();
  /** In-memory cache of current display state per deviceId */
  private currentDisplayState = new Map<string, DeviceDisplayPayload>();
  /** Previous display state per deviceId (for transition logging) */
  private previousDisplayState = new Map<string, DeviceDisplayState>();
  /** Fast lookup: signalId -> deviceId */
  private signalToDevice = new Map<string, string>();
  /** Device record cache */
  private deviceCache = new Map<string, RoadsideDeviceRecord>();

  /** Sim-time when each emergency vehicle was first seen (for 3s delay threshold) */
  private emergencyFirstSeen = new Map<string, number>();

  private stepUnsubscribe: (() => void) | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(options: RoadsideDeviceServiceOptions) {
    this.deviceRepo = options.deviceRepo;
    this.catalog = options.catalog;
    this.corridorService = options.corridorService;
    this.emergencyService = options.emergencyService;
    this.manager = options.manager;
    this.bus = options.bus;
    this.logger = options.logger;
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Seed / sync logical devices for all controlled signals in the network catalog
    const controlledSignals = this.catalog.signals.length > 0
      ? this.catalog.signals
      : this.catalog.junctions.filter((j) => j.kind === "traffic_light").map((j) => ({ id: j.id, programId: "0" }));

    for (const sig of controlledSignals) {
      const meta = getJunctionMeta(sig.id);
      const normalizedCode = meta.code.replace(/[^A-Za-z0-9]/g, "");
      const deviceId = `CRPD-${normalizedCode}-01`;
      const deviceName = `${meta.name} Roadside Priority Display`;

      const record = await this.deviceRepo.upsertDevice({
        deviceId,
        signalId: sig.id,
        deviceName,
        deviceType: "SIMULATED_DISPLAY",
        status: "ONLINE",
        connected: false,
      });

      this.deviceCache.set(record.deviceId, record);
      this.signalToDevice.set(sig.id, record.deviceId);
      // Also map raw normalizedCode for convenient URL resolution
      this.signalToDevice.set(normalizedCode, record.deviceId);
    }

    // 2. Load all existing devices into memory
    const existing = await this.deviceRepo.getAllDevices();
    for (const dev of existing) {
      this.deviceCache.set(dev.deviceId, dev);
      this.signalToDevice.set(dev.signalId, dev.deviceId);
      this.initIdleDisplay(dev);
    }

    // 3. Register simulation step listener to drive real-time display updates
    this.stepUnsubscribe = this.manager.onStep(({ simTimeSeconds }) => {
      this.processStep(simTimeSeconds);
    });

    // 4. Stale connection checker every 10 seconds
    this.heartbeatInterval = setInterval(() => {
      this.checkStaleConnections();
    }, 10_000);
    this.heartbeatInterval.unref();

    this.isInitialized = true;
    this.logger.info("RoadsideDeviceService initialized", {
      totalDevices: this.deviceCache.size,
      controlledSignals: controlledSignals.length,
    });
  }

  dispose(): void {
    if (this.stepUnsubscribe) {
      this.stepUnsubscribe();
      this.stepUnsubscribe = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Device Lookup & Registration
  // ---------------------------------------------------------------------------

  async getAllDevices(): Promise<RoadsideDeviceRecord[]> {
    return [...this.deviceCache.values()];
  }

  async getDevice(deviceIdOrSignal: string): Promise<RoadsideDeviceRecord | null> {
    // 1. Direct deviceId match
    if (this.deviceCache.has(deviceIdOrSignal)) {
      return this.deviceCache.get(deviceIdOrSignal)!;
    }
    // 2. Direct signalId mapping
    const mappedDeviceId = this.signalToDevice.get(deviceIdOrSignal);
    if (mappedDeviceId && this.deviceCache.has(mappedDeviceId)) {
      return this.deviceCache.get(mappedDeviceId)!;
    }
    // 3. Normalized upper match (e.g. "crpd-i01-01" -> "CRPD-I01-01")
    const upper = deviceIdOrSignal.toUpperCase();
    for (const [key, dev] of this.deviceCache.entries()) {
      if (key.toUpperCase() === upper) return dev;
    }
    // 4. Query DB directly as fallback
    const fromDb = await this.deviceRepo.getDeviceById(deviceIdOrSignal);
    if (fromDb) {
      this.deviceCache.set(fromDb.deviceId, fromDb);
      this.signalToDevice.set(fromDb.signalId, fromDb.deviceId);
      return fromDb;
    }
    return null;
  }

  async getDeviceBySignalId(signalId: string): Promise<RoadsideDeviceRecord | null> {
    const mapped = this.signalToDevice.get(signalId);
    if (mapped) return this.deviceCache.get(mapped) ?? null;
    return this.deviceRepo.getDeviceBySignalId(signalId);
  }

  async registerDevice(input: {
    deviceId: string;
    signalId: string;
    deviceName?: string;
    deviceType?: RoadsideDeviceType;
  }): Promise<RoadsideDeviceRecord> {
    const meta = getJunctionMeta(input.signalId);
    const name = input.deviceName || `${meta.name} Roadside Priority Display`;

    const record = await this.deviceRepo.upsertDevice({
      deviceId: input.deviceId,
      signalId: input.signalId,
      deviceName: name,
      deviceType: input.deviceType ?? "SIMULATED_DISPLAY",
      status: "ONLINE",
      connected: true,
    });

    this.deviceCache.set(record.deviceId, record);
    this.signalToDevice.set(input.signalId, record.deviceId);
    this.initIdleDisplay(record);

    this.logger.info("Roadside device registered", {
      deviceId: record.deviceId,
      signalId: record.signalId,
      name: record.deviceName,
    });

    return record;
  }

  // ---------------------------------------------------------------------------
  // Connection & Heartbeat
  // ---------------------------------------------------------------------------

  async handleDeviceConnect(socket: WebSocket, deviceId: string): Promise<DeviceStateSnapshot | null> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      this.logger.warn("Unknown device attempted connection", { deviceId });
      return null;
    }

    // Associate socket
    if (!this.deviceSockets.has(device.deviceId)) {
      this.deviceSockets.set(device.deviceId, new Set());
    }
    this.deviceSockets.get(device.deviceId)!.add(socket);
    this.socketDeviceMap.set(socket, device.deviceId);

    // Update connection status
    device.connected = true;
    device.status = "ONLINE";
    device.lastSeenIso = new Date().toISOString();
    device.updatedAtIso = new Date().toISOString();
    this.deviceCache.set(device.deviceId, device);

    void this.deviceRepo.updateConnectionStatus(device.deviceId, true, "ONLINE");

    this.logger.info("DEVICE_CONNECTED", {
      deviceId: device.deviceId,
      signalId: device.signalId,
      connectedClients: this.deviceSockets.get(device.deviceId)?.size ?? 1,
    });

    const simTime = typeof this.manager?.getStatusSnapshot === "function"
      ? (this.manager.getStatusSnapshot()?.simTimeSeconds ?? 0)
      : 0;
    this.evaluateDeviceState(device, simTime);

    const snapshot = this.getDeviceSnapshot(device.deviceId);
    if (snapshot) {
      // Send immediate snapshot back on connection
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(snapshot.display));
      }
      // Broadcast device:connected to web command center
      this.bus.broadcast("device:connected", {
        deviceId: device.deviceId,
        signalId: device.signalId,
        connected: true,
      });
    }

    return snapshot;
  }

  async handleDeviceHeartbeat(deviceId: string): Promise<void> {
    const device = await this.getDevice(deviceId);
    if (!device) return;

    device.connected = true;
    device.lastSeenIso = new Date().toISOString();
    this.deviceCache.set(device.deviceId, device);

    void this.deviceRepo.updateHeartbeat(device.deviceId);
  }

  handleSocketDisconnect(socket: WebSocket): void {
    const deviceId = this.socketDeviceMap.get(socket);
    if (!deviceId) return;

    this.socketDeviceMap.delete(socket);
    const sockets = this.deviceSockets.get(deviceId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.deviceSockets.delete(deviceId);
        const device = this.deviceCache.get(deviceId);
        if (device) {
          device.connected = false;
          device.status = "OFFLINE";
          this.deviceCache.set(deviceId, device);
          void this.deviceRepo.updateConnectionStatus(deviceId, false, "OFFLINE");

          this.logger.info("DEVICE_DISCONNECTED", {
            deviceId,
            signalId: device.signalId,
          });

          this.bus.broadcast("device:disconnected", {
            deviceId,
            signalId: device.signalId,
            connected: false,
          });
        }
      }
    }
  }

  private checkStaleConnections(): void {
    const now = Date.now();
    for (const [deviceId, device] of this.deviceCache.entries()) {
      if (device.connected) {
        const lastSeenMs = new Date(device.lastSeenIso).getTime();
        if (now - lastSeenMs > 45_000) {
          device.connected = false;
          device.status = "OFFLINE";
          this.deviceCache.set(deviceId, device);
          void this.deviceRepo.updateConnectionStatus(deviceId, false, "OFFLINE");
          this.logger.warn("Device marked OFFLINE due to heartbeat timeout", { deviceId });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Authoritative State Snapshot
  // ---------------------------------------------------------------------------

  getDeviceSnapshot(deviceId: string): DeviceStateSnapshot | null {
    const device = this.deviceCache.get(deviceId);
    if (!device) return null;

    let display = this.currentDisplayState.get(deviceId);
    if (!display) {
      display = this.createIdleDisplay(device);
      this.currentDisplayState.set(deviceId, display);
    }

    return {
      device,
      display,
    };
  }

  async resetDevice(deviceId: string): Promise<DeviceStateSnapshot | null> {
    const device = await this.getDevice(deviceId);
    if (!device) return null;

    const display = this.createIdleDisplay(device);
    this.currentDisplayState.set(device.deviceId, display);
    this.previousDisplayState.set(device.deviceId, "IDLE");

    await this.deviceRepo.resetDevice(device.deviceId);
    this.sendTargetedDisplay(device.deviceId, display);

    return { device, display };
  }

  // ---------------------------------------------------------------------------
  // Step Loop & Authoritative State Derivation
  // ---------------------------------------------------------------------------

  private detectActiveEmergencyVehicle(): {
    vehicleId: string;
    type: EmergencyType;
    priority: "CRITICAL" | "HIGH" | "NORMAL";
    speedMps: number;
    positionX: number;
    positionY: number;
    destinationJunction?: string;
    eventId?: number;
  } | null {
    // 1. Check emergencyService active sessions
    const activeEmergencies = typeof this.emergencyService?.getActiveEmergencies === "function"
      ? this.emergencyService.getActiveEmergencies()
      : [];

    for (const ae of activeEmergencies) {
      const snap = this.emergencyService.getEmergencyRuntime(ae.eventId);
      if (snap && snap.live) {
        return {
          vehicleId: snap.vehicleId,
          type: snap.type ?? "ambulance",
          priority: (snap.priority?.toUpperCase() as any) ?? "HIGH",
          speedMps: snap.live.speedMps,
          positionX: snap.live.positionX,
          positionY: snap.live.positionY,
          destinationJunction: snap.destinationJunction,
          eventId: snap.eventId,
        };
      }
    }

    // 2. Direct fallback: check simulation manager vehicles for any emergency/ambulance
    if (typeof this.manager?.getVehicles === "function") {
      const vehicles = this.manager.getVehicles();
      const ev = vehicles.find(
        (v) =>
          v.typeId === "emergency" ||
          v.id.startsWith("AMB") ||
          v.id.toLowerCase().includes("amb") ||
          v.id.toLowerCase().includes("emerg")
      );
      if (ev) {
        return {
          vehicleId: ev.id,
          type: "ambulance",
          priority: "HIGH",
          speedMps: ev.speed,
          positionX: ev.positionX,
          positionY: ev.positionY,
        };
      }
    }

    return null;
  }

  evaluateDeviceState(
    device: RoadsideDeviceRecord,
    simTime: number,
    activeJunctionMap?: Map<string, { corridor: CorridorRuntime; junction: CorridorRuntime["junctions"][0] }>,
    activeEmergencyVehicle?: ReturnType<typeof this.detectActiveEmergencyVehicle>
  ): void {
    let juncMap = activeJunctionMap;
    if (!juncMap) {
      juncMap = new Map();
      const activeCorridors = this.corridorService.getActiveRuntimes();
      for (const corridor of activeCorridors) {
        if (
          corridor.status !== "ACTIVE" &&
          corridor.status !== "REPLANNING" &&
          corridor.status !== "PLANNING" &&
          corridor.status !== "VALIDATING"
        ) {
          continue;
        }
        for (const junction of corridor.junctions) {
          const meta = getJunctionMeta(junction.junctionId);
          const sigMeta = getJunctionMeta(junction.signalId);

          juncMap.set(junction.junctionId, { corridor, junction });
          juncMap.set(junction.signalId, { corridor, junction });
          juncMap.set(meta.code, { corridor, junction });
          juncMap.set(meta.code.replace(/[^A-Za-z0-9]/g, ""), { corridor, junction });
          juncMap.set(meta.rawId, { corridor, junction });
          juncMap.set(sigMeta.code, { corridor, junction });
          juncMap.set(sigMeta.code.replace(/[^A-Za-z0-9]/g, ""), { corridor, junction });
          juncMap.set(sigMeta.rawId, { corridor, junction });
        }
      }
    }

    const ev = activeEmergencyVehicle !== undefined ? activeEmergencyVehicle : this.detectActiveEmergencyVehicle();

    const meta = getJunctionMeta(device.signalId);
    const activeMatch =
      juncMap.get(device.signalId) ??
      juncMap.get(meta.code) ??
      juncMap.get(meta.code.replace(/[^A-Za-z0-9]/g, "")) ??
      juncMap.get(meta.rawId) ??
      juncMap.get(device.deviceId);

    if (activeMatch) {
      // Device IS part of active green corridor -> authoritative corridor stage!
      const { corridor, junction } = activeMatch;
      this.transitionToCorridorStage(device, corridor, junction, simTime);
    } else if (ev) {
      // Emergency vehicle active in the network: check duration threshold
      const firstSeen = this.emergencyFirstSeen.get(ev.vehicleId) ?? simTime;
      const elapsedSeconds = simTime - firstSeen;

      // User requirement: after 3-5 seconds of starting emergency, any display shows alert and stats
      if (elapsedSeconds >= 3) {
        this.transitionToCitywideEmergencyAlert(device, ev, simTime);
      } else {
        this.transitionToIdle(device);
      }
    } else {
      // No active corridor, no emergency vehicle -> IDLE
      this.transitionToIdle(device);
    }
  }

  private processStep(simTime: number): void {
    const activeCorridors = this.corridorService.getActiveRuntimes();

    // Map of active corridor signal junctionId -> corridor info
    const activeJunctionMap = new Map<
      string,
      {
        corridor: CorridorRuntime;
        junction: CorridorRuntime["junctions"][0];
      }
    >();

    for (const corridor of activeCorridors) {
      if (
        corridor.status !== "ACTIVE" &&
        corridor.status !== "REPLANNING" &&
        corridor.status !== "PLANNING" &&
        corridor.status !== "VALIDATING"
      ) {
        continue;
      }
      for (const junction of corridor.junctions) {
        const meta = getJunctionMeta(junction.junctionId);
        const sigMeta = getJunctionMeta(junction.signalId);

        activeJunctionMap.set(junction.junctionId, { corridor, junction });
        activeJunctionMap.set(junction.signalId, { corridor, junction });
        activeJunctionMap.set(meta.code, { corridor, junction });
        activeJunctionMap.set(meta.code.replace(/[^A-Za-z0-9]/g, ""), { corridor, junction });
        activeJunctionMap.set(meta.rawId, { corridor, junction });
        activeJunctionMap.set(sigMeta.code, { corridor, junction });
        activeJunctionMap.set(sigMeta.code.replace(/[^A-Za-z0-9]/g, ""), { corridor, junction });
        activeJunctionMap.set(sigMeta.rawId, { corridor, junction });
      }
    }

    const activeEmergencyVehicle = this.detectActiveEmergencyVehicle();
    if (activeEmergencyVehicle) {
      if (!this.emergencyFirstSeen.has(activeEmergencyVehicle.vehicleId)) {
        this.emergencyFirstSeen.set(activeEmergencyVehicle.vehicleId, simTime);
      }
    } else {
      this.emergencyFirstSeen.clear();
    }

    // Process all devices
    for (const [deviceId, device] of this.deviceCache.entries()) {
      this.evaluateDeviceState(device, simTime, activeJunctionMap, activeEmergencyVehicle);
    }
  }

  private transitionToCitywideEmergencyAlert(
    device: RoadsideDeviceRecord,
    emergency: {
      vehicleId: string;
      type: EmergencyType;
      priority: "CRITICAL" | "HIGH" | "NORMAL";
      speedMps: number;
      positionX: number;
      positionY: number;
      destinationJunction?: string;
      eventId?: number;
    },
    simTime: number
  ): void {
    const meta = getJunctionMeta(device.signalId);
    const junc = this.catalog.junctions.find(
      (j) =>
        j.id === device.signalId ||
        j.id === meta.rawId ||
        j.id === meta.code ||
        j.id === meta.code.replace(/[^A-Za-z0-9]/g, "")
    );

    let distanceMeters = 220;
    if (junc && typeof junc.x === "number" && typeof junc.y === "number") {
      const dx = emergency.positionX - junc.x;
      const dy = emergency.positionY - junc.y;
      distanceMeters = Math.max(0, Math.round(Math.hypot(dx, dy)));
    }

    const speedKmh = Math.max(Math.round(emergency.speedMps * 3.6), 35);
    const effectiveSpeedMps = Math.max(emergency.speedMps, 11); // ~40 km/h minimum for ETA
    const etaSeconds = Math.max(1, Math.round(distanceMeters / effectiveSpeedMps));

    let displayState: DeviceDisplayState = "PREPARING";
    let message = `PRIORITY CORRIDOR ACTIVE · ${emergency.vehicleId} EN ROUTE`;

    if (distanceMeters <= 35 || etaSeconds <= 3) {
      displayState = "PASSING";
      message = "HIGH PRIORITY VEHICLE PASSING NOW · KEEP CLEAR";
    } else if (distanceMeters <= 180 || etaSeconds <= 15) {
      displayState = "GREEN";
      message = "EMERGENCY CORRIDOR GREEN · YIELD ALL LANES";
    } else if (distanceMeters <= 450 || etaSeconds <= 35) {
      displayState = "CLEARING";
      message = "CLEAR INTERSECTION · EMERGENCY VEHICLE APPROACHING";
    } else {
      displayState = "PREPARING";
      message = `EMERGENCY VEHICLE IN TRANSIT · BE PREPARED TO CLEAR`;
    }

    const currentSignal = typeof this.manager?.getSignal === "function"
      ? this.manager.getSignal(device.signalId)
      : null;
    const signalState = currentSignal?.state ?? (displayState === "GREEN" || displayState === "PASSING" ? "G" : "r");

    const payload: DeviceDisplayPayload = {
      type: "device:display",
      deviceId: device.deviceId,
      signalId: device.signalId,
      signalName: device.deviceName,
      displayState,
      priority: emergency.priority,
      vehicle: {
        id: emergency.vehicleId,
        type: emergency.type,
        speedKmh,
        distanceMeters,
        etaSeconds,
      },
      corridor: null,
      message,
      signalState,
      timestamp: new Date().toISOString(),
    };

    this.updateAndBroadcast(device, payload, undefined, emergency.eventId);
  }

  private transitionToIdle(device: RoadsideDeviceRecord): void {
    const prev = this.currentDisplayState.get(device.deviceId);
    if (prev && prev.displayState === "IDLE") return; // already idle

    // If it was just passed or cancelling, give 5 seconds restore message
    if (prev && (prev.displayState === "PASSING" || prev.displayState === "GREEN")) {
      const restoringPayload: DeviceDisplayPayload = {
        type: "device:display",
        deviceId: device.deviceId,
        signalId: device.signalId,
        signalName: device.deviceName,
        displayState: "RESTORING",
        message: "VEHICLE PASSED · NORMAL TRAFFIC RESUMING",
        timestamp: new Date().toISOString(),
      };
      this.updateAndBroadcast(device, restoringPayload);
      return;
    }

    const idlePayload = this.createIdleDisplay(device);
    this.updateAndBroadcast(device, idlePayload);
  }

  private transitionToCorridorStage(
    device: RoadsideDeviceRecord,
    corridor: CorridorRuntime,
    junction: CorridorRuntime["junctions"][0],
    simTime: number
  ): void {
    const emergency = this.emergencyService.getEmergencyRuntime(corridor.eventId);
    const etas = emergency ? this.emergencyService.getEtas(corridor.eventId) : null;
    const meta = getJunctionMeta(junction.junctionId);
    const eta = etas?.find(
      (e) =>
        e.junctionId === junction.junctionId ||
        e.junctionId === junction.signalId ||
        e.junctionId === meta.code ||
        e.junctionId === meta.rawId ||
        e.junctionId === device.signalId
    );

    const etaSeconds = eta !== undefined && eta.etaSeconds != null ? Math.max(0, Math.round(eta.etaSeconds)) : null;
    const distanceMeters = eta !== undefined && eta.distanceM != null ? Math.max(0, Math.round(eta.distanceM)) : null;
    const speedKmh = emergency?.live ? Math.round(emergency.live.speedMps * 3.6) : 0;
    const vehicleType: EmergencyType = emergency?.type ?? "ambulance";
    const priority = (emergency?.priority?.toUpperCase() as "CRITICAL" | "HIGH" | "NORMAL") ?? "HIGH";

    const currentSignal = typeof this.manager?.getSignal === "function"
      ? (this.manager.getSignal(device.signalId) ?? this.manager.getSignal(junction.signalId))
      : null;
    const signalState = currentSignal?.state ?? (junction.status === "APPLIED" ? "G" : "r");

    const isPassingNow =
      (distanceMeters !== null && distanceMeters <= 35) ||
      (etaSeconds !== null && etaSeconds <= 2) ||
      (emergency?.live != null && junction.routeEdgeIndex >= 0 && emergency.live.routeIndex === junction.routeEdgeIndex);

    let displayState: DeviceDisplayState = "IDLE";
    let message = "NORMAL TRAFFIC";

    if (junction.status === "PASSED") {
      const timeSincePassed = junction.passedAtSimTimeS !== null ? simTime - junction.passedAtSimTimeS : 0;
      if (timeSincePassed < 6) {
        displayState = "RESTORING";
        message = "VEHICLE PASSED · NORMAL TRAFFIC RESUMING";
      } else {
        displayState = "IDLE";
        message = "NORMAL TRAFFIC";
      }
    } else if (isPassingNow) {
      displayState = "PASSING";
      message = "HIGH PRIORITY VEHICLE PASSING NOW · KEEP CLEAR";
    } else if (junction.status === "APPLIED") {
      displayState = "GREEN";
      message = "GREEN CORRIDOR ACTIVE · PLEASE GIVE WAY";
    } else if (junction.clearanceAppliedAtS !== null) {
      displayState = "CLEARING";
      message = "EMERGENCY APPROACHING · CLEAR INTERSECTION";
    } else if (junction.status === "PENDING" || corridor.status === "PLANNING" || corridor.status === "VALIDATING") {
      if (etaSeconds !== null && etaSeconds <= 25) {
        displayState = "PREPARING";
        message = "AMBULANCE APPROACHING · PREPARE TO GIVE WAY";
      } else {
        displayState = "PREDICT";
        message = "PRIORITY VEHICLE DETECTED · PREPARE TO GIVE WAY";
      }
    }

    const payload: DeviceDisplayPayload = {
      type: "device:display",
      deviceId: device.deviceId,
      signalId: device.signalId,
      signalName: device.deviceName,
      displayState,
      priority,
      vehicle: {
        id: emergency?.vehicleId ?? corridor.vehicleId,
        type: vehicleType,
        speedKmh,
        distanceMeters: distanceMeters ?? 0,
        etaSeconds: etaSeconds ?? 0,
      },
      corridor: {
        id: corridor.corridorId,
        state: corridor.status,
        currentIndex: junction.sequenceIndex + 1,
        totalSignals: corridor.junctions.length,
      },
      message,
      signalState,
      timestamp: new Date().toISOString(),
    };

    this.updateAndBroadcast(device, payload, corridor.corridorId, corridor.eventId);
  }

  private updateAndBroadcast(
    device: RoadsideDeviceRecord,
    payload: DeviceDisplayPayload,
    corridorId?: number,
    emergencyId?: number
  ): void {
    const prevState = this.previousDisplayState.get(device.deviceId);
    const hasChanged = prevState !== payload.displayState;

    if (hasChanged) {
      this.previousDisplayState.set(device.deviceId, payload.displayState);
      this.logger.info("DISPLAY_STATE_CHANGED", {
        deviceId: device.deviceId,
        signalId: device.signalId,
        corridorId: corridorId ?? null,
        emergencyId: emergencyId ?? null,
        displayState: payload.displayState,
      });

      // Update device status in record
      device.status = payload.displayState === "IDLE" ? "ONLINE" : "ACTIVE";
      this.deviceCache.set(device.deviceId, device);
    }

    this.currentDisplayState.set(device.deviceId, payload);

    // 1. Deliver targeted event to the connected device socket(s)
    this.sendTargetedDisplay(device.deviceId, payload);

    // 2. Broadcast to WsBus so Command Center UI / map receives real-time device updates
    if (hasChanged || payload.displayState !== "IDLE") {
      this.bus.broadcast("device:display", payload);
    }
  }

  private sendTargetedDisplay(deviceId: string, payload: DeviceDisplayPayload): void {
    const sockets = this.deviceSockets.get(deviceId);
    if (!sockets || sockets.size === 0) return;

    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message, (err) => {
          if (err) {
            this.logger.warn("Failed to send display payload to device", { deviceId, error: err.message });
          }
        });
      }
    }
  }

  private createIdleDisplay(device: RoadsideDeviceRecord): DeviceDisplayPayload {
    const liveSig = typeof this.manager?.getSignal === "function" ? this.manager.getSignal(device.signalId) : null;
    return {
      type: "device:display",
      deviceId: device.deviceId,
      signalId: device.signalId,
      signalName: device.deviceName,
      displayState: "IDLE",
      message: "NORMAL TRAFFIC",
      vehicle: null,
      corridor: null,
      signalState: liveSig?.state ?? "G",
      timestamp: new Date().toISOString(),
    };
  }

  private initIdleDisplay(device: RoadsideDeviceRecord): void {
    if (!this.currentDisplayState.has(device.deviceId)) {
      this.currentDisplayState.set(device.deviceId, this.createIdleDisplay(device));
      this.previousDisplayState.set(device.deviceId, "IDLE");
    }
  }
}
