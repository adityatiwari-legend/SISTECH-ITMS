import { test } from "node:test";
import assert from "node:assert/strict";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { RoadGraph } from "../src/modules/routing/road-graph.ts";
import { RouteEngine } from "../src/modules/routing/route-engine.ts";
import { geoFromCatalog } from "../src/modules/simulation/geo.ts";
import { MobileService } from "../src/modules/mobile/mobile-service.ts";
import { createLogger } from "../src/logger.ts";
import { NETWORK_PATH } from "./helpers.ts";

test("sync_lifecycle: vehicle assignment is canonical and immutable", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);

  const mockMobileRepo = {
    getDriverById: async (id: number) => ({ id, driverCode: "DRV-802" }),
    getAssignedVehicleForDriver: async (id: number) => ({ id: 1, vehicleCode: "AMB-001", vehicleType: "ambulance" }),
    listFleetVehicles: async () => [
      { id: 1, vehicleCode: "AMB-001", vehicleType: "ambulance" },
      { id: 2, vehicleCode: "AMB-002", vehicleType: "ambulance" },
    ],
    updateVehicleStatus: async () => {},
    updateDriverStatus: async () => {},
    recordAudit: async () => {},
    createOrUpdateVerification: async () => {},
    assignVehicleToDriver: async (dId: number, vId: number) => ({ id: vId, vehicleCode: "AMB-002", vehicleType: "ambulance" }),
  };

  const mockEmergencyRepo = {
    getEventsByDriver: async () => [{ id: 10, driverId: 101, status: "active" }],
  };

  let capturedVehicleCode: string | undefined;
  const mockEmergencyService = {
    createEmergency: async (input: any) => {
      capturedVehicleCode = input.vehicleCode;
      return { id: 10, vehicleId: input.vehicleCode, status: "created" };
    },
    getEmergency: async (id: number) => ({ id, status: "created", mobile: {} }),
  };

  const mobileService = new MobileService({
    mobileRepo: mockMobileRepo as any,
    emergencyRepo: mockEmergencyRepo as any,
    catalog,
    routeEngine,
    corridorService: {} as any,
    bus: { broadcast: () => {} } as any,
    emergencyService: mockEmergencyService as any,
    aiVerificationService: {} as any,
    executionMode: "SIMULATION",
  });

  // When driver 101 is already in an active emergency, requesting a different vehicleCode must NOT re-assign
  await mobileService.createMobileEmergency(101, {
    type: "ambulance",
    priority: "critical",
    vehicleCode: "AMB-002",
    origin: "I1",
    destination: "I6",
  });

  // Should keep existing AMB-001 because emergency is ongoing
  assert.equal(capturedVehicleCode, "AMB-001", "Existing ongoing emergency must keep canonical immutable vehicleCode");
});

test("sync_lifecycle: simulation mode anchors remote GPS to Bhopal network bounds", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);

  const mockMobileRepo = {
    getDriverById: async (id: number) => ({ id, driverCode: "DRV-802" }),
    getAssignedVehicleForDriver: async () => ({ id: 1, vehicleCode: "AMB-001", vehicleType: "ambulance" }),
    updateVehicleStatus: async () => {},
    updateDriverStatus: async () => {},
    recordAudit: async () => {},
    createOrUpdateVerification: async () => {},
  };

  const mockEmergencyRepo = {
    getEventsByDriver: async () => [],
  };

  let passedInput: any;
  const mockEmergencyService = {
    createEmergency: async (input: any) => {
      passedInput = input;
      return { id: 11, vehicleId: input.vehicleCode, status: "created" };
    },
    getEmergency: async (id: number) => ({ id, status: "created", mobile: {} }),
  };

  const mobileService = new MobileService({
    mobileRepo: mockMobileRepo as any,
    emergencyRepo: mockEmergencyRepo as any,
    catalog,
    routeEngine,
    corridorService: {} as any,
    bus: { broadcast: () => {} } as any,
    emergencyService: mockEmergencyService as any,
    aiVerificationService: {} as any,
    executionMode: "SIMULATION",
  });

  // Physical phone hardware GPS located in Gwalior (26.22° N, 78.18° E)
  await mobileService.createMobileEmergency(101, {
    type: "ambulance",
    priority: "critical",
    pickupLatitude: 26.2289,
    pickupLongitude: 78.1834,
    originAddress: "Gwalior Highway",
  });

  assert.ok(passedInput !== undefined);
  assert.equal(passedInput.pickupLatitude, 23.2332, "Remote GPS latitude must be anchored to Bhopal in simulation mode");
  assert.equal(passedInput.pickupLongitude, 77.4339, "Remote GPS longitude must be anchored to Bhopal in simulation mode");
  assert.ok(passedInput.originAddress.includes("Bhopal Simulation Origin"));
});

test("sync_lifecycle: system status endpoint reflects authoritative subsystem health", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  const roadGraph = new RoadGraph(catalog);
  const routeEngine = new RouteEngine(roadGraph, catalog);

  const mockManager = {
    getStatusSnapshot: () => ({ status: "running" }),
    getVehicles: () => [{ id: "veh-1" }, { id: "AMB-001" }],
    getActiveEmergencies: () => [{ eventId: 10, vehicleId: "AMB-001" }],
    getTraCIClient: () => ({ isConnected: () => true }),
  };

  const mockDb = {
    isHealthy: async () => true,
    query: async () => ({ rows: [{ count: 1 }] }),
  };

  const mockBus = {
    getClientCount: () => 3,
    broadcast: () => {},
  };

  const mobileService = new MobileService({
    mobileRepo: {} as any,
    emergencyRepo: {} as any,
    catalog,
    routeEngine,
    corridorService: {} as any,
    bus: mockBus as any,
    emergencyService: {} as any,
    aiVerificationService: {} as any,
    manager: mockManager as any,
    db: mockDb as any,
    executionMode: "SIMULATION",
  });

  const status = await mobileService.getSystemStatus();
  assert.equal(status.systemStatus, "online");
  assert.equal(status.sumoStatus, "connected");
  assert.equal(status.traciStatus, "connected");
  assert.equal(status.databaseStatus, "connected");
  assert.equal(status.websocketStatus, "connected");
  assert.equal(status.mode, "SIMULATION");
  assert.equal(status.activeEmergencies, 1);
});

test("sync_lifecycle: out-of-order versioning prevents state reversion", () => {
  // Simulate Web store version tracking logic
  let currentVersion = 100;
  let currentPosition = { lat: 23.2332, lng: 77.4339 };

  function handleIncomingEvent(event: { version: number; position: { lat: number; lng: number } }) {
    if (event.version < currentVersion) {
      // Discard older event
      return false;
    }
    currentVersion = event.version;
    currentPosition = event.position;
    return true;
  }

  // Receive newer packet
  const accepted1 = handleIncomingEvent({ version: 105, position: { lat: 23.235, lng: 77.435 } });
  assert.equal(accepted1, true);
  assert.equal(currentPosition.lat, 23.235);

  // Receive delayed/out-of-order packet with version 102
  const accepted2 = handleIncomingEvent({ version: 102, position: { lat: 23.230, lng: 77.430 } });
  assert.equal(accepted2, false, "Out of order packet must be discarded");
  assert.equal(currentPosition.lat, 23.235, "State must not revert to older packet");
});
