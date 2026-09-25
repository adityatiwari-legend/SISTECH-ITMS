import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WsBus } from "../src/modules/websocket/ws-bus.ts";
import { RoadsideDeviceService } from "../src/modules/device/device-service.ts";
import { getJunctionMeta, generateDeviceIdForSignal } from "../src/modules/device/naming.ts";
import { createLogger } from "../src/logger.ts";
import type { RoadsideDeviceRecord, DeviceDisplayPayload } from "@itms/types";

class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  messages: any[] = [];
  OPEN = 1;

  send(data: string, cb?: (err?: Error) => void) {
    this.messages.push(JSON.parse(data));
    if (cb) cb();
  }
}

class MockDeviceRepository {
  private devices = new Map<string, RoadsideDeviceRecord>();

  async upsertDevice(device: any): Promise<RoadsideDeviceRecord> {
    const existing = this.devices.get(device.deviceId);
    const now = new Date();
    const record: RoadsideDeviceRecord = {
      id: existing ? existing.id : this.devices.size + 1,
      deviceId: device.deviceId,
      signalId: device.signalId,
      deviceName: device.deviceName,
      deviceType: device.deviceType ?? "SIMULATED_DISPLAY",
      status: device.status ?? "ONLINE",
      connected: device.connected ?? false,
      lastSeenIso: now.toISOString(),
      createdAtIso: existing ? existing.createdAtIso : now.toISOString(),
      updatedAtIso: now.toISOString(),
    };
    this.devices.set(device.deviceId, record);
    return record;
  }

  async getDeviceById(deviceId: string): Promise<RoadsideDeviceRecord | null> {
    return this.devices.get(deviceId) ?? null;
  }

  async getDeviceBySignalId(signalId: string): Promise<RoadsideDeviceRecord | null> {
    for (const d of this.devices.values()) {
      if (d.signalId === signalId) return d;
    }
    return null;
  }

  async getAllDevices(): Promise<RoadsideDeviceRecord[]> {
    return Array.from(this.devices.values());
  }

  async updateHeartbeat(deviceId: string): Promise<RoadsideDeviceRecord | null> {
    const dev = this.devices.get(deviceId);
    if (!dev) return null;
    dev.connected = true;
    dev.status = "ONLINE";
    dev.lastSeenIso = new Date().toISOString();
    return dev;
  }

  async updateConnectionStatus(deviceId: string, connected: boolean, status: any): Promise<RoadsideDeviceRecord | null> {
    const dev = this.devices.get(deviceId);
    if (!dev) return null;
    dev.connected = connected;
    dev.status = status;
    return dev;
  }

  async resetDevice(deviceId: string): Promise<RoadsideDeviceRecord | null> {
    const dev = this.devices.get(deviceId);
    if (!dev) return null;
    dev.status = "ONLINE";
    return dev;
  }
}

test("Connected Roadside Priority Display (CRPD) - Unit and Integration Tests", async (suite) => {
  const logger = createLogger("crpd-test", "error");

  await suite.test("1. Signal to Device Naming & Normalization", () => {
    // Known Bhopal signals
    const metaBhopal = getJunctionMeta("315577777");
    assert.equal(metaBhopal.code, "I-01");
    assert.ok(metaBhopal.name.length > 0);
    assert.equal(generateDeviceIdForSignal("315577777"), "CRPD-I01-01");

    // Grid signal
    const metaGrid = getJunctionMeta("I2");
    assert.equal(metaGrid.code, "I-02");
    assert.equal(generateDeviceIdForSignal("I2"), "CRPD-I02-01");

    // Fallback normalization
    const metaOther = getJunctionMeta("custom_signal_99");
    assert.ok(metaOther.code.startsWith("I-"));
    assert.ok(generateDeviceIdForSignal("custom_signal_99").startsWith("CRPD-"));
  });

  await suite.test("2. RoadsideDeviceService: Seeding & Device Management", async () => {
    const repo = new MockDeviceRepository();
    const wsBus = new WsBus(logger);

    const mockCatalog: any = {
      signals: [
        { id: "315577777", programId: "0" },
        { id: "315577785", programId: "0" },
        { id: "I2", programId: "0" },
      ],
      junctions: [],
    };

    const mockCorridorService: any = {
      getActiveRuntimes: () => [],
    };

    const mockEmergencyService: any = {
      getEmergencyRuntime: () => null,
      getEtas: () => [],
    };

    const mockManager: any = {
      onStep: () => () => {},
    };

    const deviceService = new RoadsideDeviceService({
      deviceRepo: repo as any,
      catalog: mockCatalog,
      corridorService: mockCorridorService,
      emergencyService: mockEmergencyService,
      manager: mockManager,
      bus: wsBus,
      logger,
    });

    await deviceService.init();

    // Verify seeded devices
    const devices = await deviceService.getAllDevices();
    assert.equal(devices.length, 3);

    const dev1 = await deviceService.getDevice("CRPD-I01-01");
    assert.ok(dev1);
    assert.equal(dev1?.signalId, "315577777");

    const devBySig = await deviceService.getDeviceBySignalId("I2");
    assert.ok(devBySig);
    assert.equal(devBySig?.deviceId, "CRPD-I02-01");

    const snapshot = deviceService.getDeviceSnapshot("CRPD-I01-01");
    assert.ok(snapshot);
    assert.equal(snapshot?.display.displayState, "IDLE");
    assert.equal(snapshot?.display.message, "NORMAL TRAFFIC");

    deviceService.dispose();
  });

  await suite.test("3. WebSocket Connection & City Telemetry Isolation (Section 11 & 46)", async () => {
    const repo = new MockDeviceRepository();
    const wsBus = new WsBus(logger);

    const mockCatalog: any = {
      signals: [{ id: "315577777", programId: "0" }, { id: "I2", programId: "0" }],
      junctions: [],
    };

    const deviceService = new RoadsideDeviceService({
      deviceRepo: repo as any,
      catalog: mockCatalog,
      corridorService: { getActiveRuntimes: () => [] } as any,
      emergencyService: { getEmergencyRuntime: () => null, getEtas: () => [] } as any,
      manager: { onStep: () => () => {} } as any,
      bus: wsBus,
      logger,
    });

    await deviceService.init();
    wsBus.setDeviceService(deviceService);

    const wsDeviceA = new MockWebSocket() as any;
    const wsDeviceB = new MockWebSocket() as any;
    const wsNormal = new MockWebSocket() as any;

    // Connect devices with query params
    wsBus.addClient(wsDeviceA, undefined, { deviceId: "CRPD-I01-01" });
    wsBus.addClient(wsDeviceB, undefined, { deviceId: "CRPD-I02-01" });
    wsBus.addClient(wsNormal, undefined); // normal operator browser

    // Clear initial connect greeting messages
    wsDeviceA.messages = [];
    wsDeviceB.messages = [];
    wsNormal.messages = [];

    // Broadcast standard city-wide telemetry
    wsBus.broadcast("traffic:update", { segmentId: "seg-1", speed: 45 });
    wsBus.broadcast("vehicle:update", { vehicleId: "veh-1", speed: 12 });

    // Section 11 & 46: Device clients MUST NOT receive city telemetry stream
    assert.equal(wsDeviceA.messages.length, 0, "Device A must not receive city-wide traffic updates");
    assert.equal(wsDeviceB.messages.length, 0, "Device B must not receive city-wide traffic updates");
    assert.equal(wsNormal.messages.length, 2, "Command center receives all updates");

    // Targeted device display event
    const displayPayloadA: DeviceDisplayPayload = {
      type: "device:display",
      deviceId: "CRPD-I01-01",
      signalId: "315577777",
      signalName: "Link Road Commercial Hub",
      displayState: "GREEN",
      priority: "HIGH",
      message: "PLEASE GIVE WAY",
      vehicle: {
        id: "amb-01",
        type: "ambulance",
        speedKmh: 52,
        distanceMeters: 120,
        etaSeconds: 4,
      },
      corridor: {
        id: 1,
        state: "ACTIVE",
        currentIndex: 0,
        totalSignals: 3,
      },
      timestamp: new Date().toISOString(),
    };

    wsBus.broadcast("device:display", displayPayloadA);

    // Device A receives its display message
    assert.equal(wsDeviceA.messages.length, 1);
    assert.equal(wsDeviceA.messages[0].type, "device:display");
    assert.equal(wsDeviceA.messages[0].payload.displayState, "GREEN");
    assert.equal(wsDeviceA.messages[0].payload.vehicle.speedKmh, 52);

    // Device B DOES NOT receive Device A's event (no event leakage to unrelated device)
    assert.equal(wsDeviceB.messages.length, 0, "Device B must not receive Device A's targeted display event");

    // Heartbeat updates device connected state
    wsDeviceA.emit("message", JSON.stringify({ type: "device:heartbeat", deviceId: "CRPD-I01-01" }));
    const devRecord = await deviceService.getDevice("CRPD-I01-01");
    assert.equal(devRecord?.connected, true);

    deviceService.dispose();
  });

  await suite.test("4. Authoritative Rolling Corridor State Progression", async () => {
    const repo = new MockDeviceRepository();
    const wsBus = new WsBus(logger);

    let currentCorridors: any[] = [];
    let currentEmergency: any = null;
    let currentEtas: any[] = [];
    let stepCallback: ((e: { simTimeSeconds: number }) => void) | null = null;

    const mockManager: any = {
      onStep: (cb: any) => {
        stepCallback = cb;
        return () => {};
      },
    };

    const deviceService = new RoadsideDeviceService({
      deviceRepo: repo as any,
      catalog: {
        signals: [
          { id: "sig-A", programId: "0" },
          { id: "sig-B", programId: "0" },
          { id: "sig-C", programId: "0" },
        ],
        junctions: [],
      } as any,
      corridorService: {
        getActiveRuntimes: () => currentCorridors,
      } as any,
      emergencyService: {
        getEmergencyRuntime: () => currentEmergency,
        getEtas: () => currentEtas,
      } as any,
      manager: mockManager,
      bus: wsBus,
      logger,
    });

    await deviceService.init();

    // Devices seeded: CRPD-I01-01 (sig-A), CRPD-I02-01 (sig-B), CRPD-I03-01 (sig-C)
    const devA = await deviceService.getDeviceBySignalId("sig-A");
    const devB = await deviceService.getDeviceBySignalId("sig-B");
    const devC = await deviceService.getDeviceBySignalId("sig-C");

    assert.ok(devA && devB && devC);

    // Initial state without corridor: All displays are IDLE
    assert.equal(deviceService.getDeviceSnapshot(devA!.deviceId)?.display.displayState, "IDLE");
    assert.equal(deviceService.getDeviceSnapshot(devB!.deviceId)?.display.displayState, "IDLE");
    assert.equal(deviceService.getDeviceSnapshot(devC!.deviceId)?.display.displayState, "IDLE");

    // Setup active corridor:
    // Signal A is GREEN (preempted), Signal B is PREPARING, Signal C is PREDICT
    currentEmergency = {
      eventId: 101,
      type: "ambulance",
      priority: "CRITICAL",
      live: {
        speedMps: 13.5, // ~49 km/h
        routeIndex: 0,
      },
    };

    currentEtas = [
      { junctionId: "sig-A", etaSeconds: 5, distanceM: 65 },
      { junctionId: "sig-B", etaSeconds: 22, distanceM: 320 },
      { junctionId: "sig-C", etaSeconds: 45, distanceM: 650 },
    ];

    currentCorridors = [
      {
        id: 1,
        eventId: 101,
        status: "ACTIVE",
        junctions: [
          {
            junctionId: "sig-A",
            signalId: "sig-A",
            status: "APPLIED",
            routeEdgeIndex: 2,
            clearanceAppliedAtS: 10,
            passedAtSimTimeS: null,
          },
          {
            junctionId: "sig-B",
            signalId: "sig-B",
            status: "PENDING",
            routeEdgeIndex: 5,
            clearanceAppliedAtS: null,
            reservedGreenStartS: 25,
            passedAtSimTimeS: null,
          },
          {
            junctionId: "sig-C",
            signalId: "sig-C",
            status: "PENDING",
            routeEdgeIndex: 8,
            clearanceAppliedAtS: null,
            reservedGreenStartS: null,
            passedAtSimTimeS: null,
          },
        ],
      },
    ];

    // Trigger simulation step
    stepCallback!({ simTimeSeconds: 15 });

    // Verify rolling states:
    // Device A: GREEN
    const snapA = deviceService.getDeviceSnapshot(devA!.deviceId);
    assert.equal(snapA?.display.displayState, "GREEN");
    assert.equal(snapA?.display.vehicle?.speedKmh, 49);
    assert.equal(snapA?.display.vehicle?.etaSeconds, 5);

    // Device B: PREPARING
    const snapB = deviceService.getDeviceSnapshot(devB!.deviceId);
    assert.equal(snapB?.display.displayState, "PREPARING");
    assert.equal(snapB?.display.vehicle?.etaSeconds, 22);

    // Device C: PREDICT
    const snapC = deviceService.getDeviceSnapshot(devC!.deviceId);
    assert.equal(snapC?.display.displayState, "PREDICT");
    assert.equal(snapC?.display.vehicle?.etaSeconds, 45);

    // Progression: Ambulance crosses Signal A
    currentEtas[0] = { junctionId: "sig-A", etaSeconds: 0, distanceM: 10 };
    stepCallback!({ simTimeSeconds: 20 });
    const snapAPassing = deviceService.getDeviceSnapshot(devA!.deviceId);
    assert.equal(snapAPassing?.display.displayState, "PASSING");

    // Progression: Signal A PASSED -> Signal B becomes GREEN
    currentCorridors[0].junctions[0].status = "PASSED";
    currentCorridors[0].junctions[0].passedAtSimTimeS = 22;

    currentCorridors[0].junctions[1].status = "APPLIED";
    currentEtas[1] = { junctionId: "sig-B", etaSeconds: 4, distanceM: 50 };

    stepCallback!({ simTimeSeconds: 23 });

    // Signal A enters RESTORING
    const snapARestoring = deviceService.getDeviceSnapshot(devA!.deviceId);
    assert.equal(snapARestoring?.display.displayState, "RESTORING");

    // Signal B becomes GREEN
    const snapBGreen = deviceService.getDeviceSnapshot(devB!.deviceId);
    assert.equal(snapBGreen?.display.displayState, "GREEN");

    deviceService.dispose();
  });

  await suite.test("5. Safety Isolation: Device Offline Never Breaks Traffic Control", () => {
    const wsBus = new WsBus(logger);

    // Section 45 requirement: Traffic controller preemption operates independently of device state
    assert.doesNotThrow(() => {
      wsBus.broadcast("device:display", {
        type: "device:display",
        deviceId: "CRPD-NONEXISTENT",
        signalId: "unknown",
        signalName: "Unlinked",
        displayState: "GREEN",
        priority: "HIGH",
        message: "PLEASE GIVE WAY",
        vehicle: null,
        corridor: null,
        timestamp: new Date().toISOString(),
      });
    });
  });
});
