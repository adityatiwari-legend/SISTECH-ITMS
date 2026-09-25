import { test } from "node:test";
import assert from "node:assert/strict";
import { WsBus } from "../src/modules/websocket/ws-bus.ts";
import { createLogger } from "../src/logger.ts";
import { EventEmitter } from "node:events";
import { AuthService } from "../src/modules/auth/auth-service.ts";

class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  messages: any[] = [];
  OPEN = 1;

  send(data: string, cb?: (err?: Error) => void) {
    this.messages.push(JSON.parse(data));
    if (cb) cb();
  }
}

test("WebSocket authorization and filtering layer", async (t) => {
  const logger = createLogger("ws-test", "error");
  const bus = new WsBus(logger);
  const authService = new AuthService({} as any, "secret-key-12345");
  bus.setAuthService(authService);

  const driverAToken = authService.createToken({ sub: 101, code: "DRV-A", role: "driver", email: "a@test.com" });
  const adminToken = authService.createToken({ sub: 1, code: "ADM", role: "admin", email: "admin@test.com" });

  const wsDriverA = new MockWebSocket() as any;
  const wsAdmin = new MockWebSocket() as any;

  bus.addClient(wsDriverA, driverAToken);
  bus.addClient(wsAdmin, adminToken);

  // Helper to clear queues
  const clearQs = () => {
    wsDriverA.messages = [];
    wsAdmin.messages = [];
  };

  await t.test("TEST 1: Driver A connected with no subscribed emergency receives nothing", () => {
    clearQs();
    bus.broadcast("emergency:created", { eventId: 10, type: "ambulance" });
    assert.equal(wsDriverA.messages.length, 0);
    assert.equal(wsAdmin.messages.length, 1);
  });

  await t.test("TEST 2: Driver A subscribed to emergency A receives event", () => {
    wsDriverA.emit("message", JSON.stringify({ type: "subscribe", eventId: 10 }));
    clearQs();
    bus.broadcast("emergency:created", { eventId: 10, type: "ambulance" });
    assert.equal(wsDriverA.messages.length, 1);
    assert.equal(wsDriverA.messages[0].type, "emergency:created");
  });

  await t.test("TEST 3: Driver A subscribed to emergency A receives nothing for B", () => {
    clearQs();
    bus.broadcast("emergency:created", { eventId: 11, type: "ambulance" });
    assert.equal(wsDriverA.messages.length, 0);
  });

  await t.test("TEST 4: Driver A subscribed to A receives A verification event", () => {
    clearQs();
    bus.broadcast("emergency:verification:submitted", { eventId: 10, requestId: "REQ1", status: "submitted" });
    assert.equal(wsDriverA.messages.length, 1);
  });

  await t.test("TEST 5: Driver A subscribed to A receives nothing for B verification", () => {
    clearQs();
    bus.broadcast("emergency:verification:submitted", { eventId: 11, requestId: "REQ2", status: "submitted" });
    assert.equal(wsDriverA.messages.length, 0);
  });

  await t.test("TEST 6 & 7: Driver receives only relevant vehicle telemetry", () => {
    clearQs();
    // Driver A is subscribed to eventId 10.
    // Unrelated telemetry without eventId/emergencyId should be filtered.
    bus.broadcast("vehicle:update", { vehicles: [] });
    assert.equal(wsDriverA.messages.length, 0, "Driver A should not receive city-wide vehicle update");

    bus.broadcast("vehicle:update", { emergencyId: 10, vehicles: [] } as any);
    assert.equal(wsDriverA.messages.length, 1, "Driver A should receive event 10 telemetry");
  });

  await t.test("TEST 8: Driver receives only relevant signal telemetry", () => {
    clearQs();
    bus.broadcast("signal:update", { signals: [] });
    assert.equal(wsDriverA.messages.length, 0);
  });

  await t.test("TEST 9: route:updated contains usable coordinates", () => {
    clearQs();
    bus.broadcast("route:updated", {
      emergencyId: 10,
      routeId: 5,
      segments: ["edge1"],
      coordinates: [{ lat: 23.0, lng: 77.0 }],
      estimatedTravelTimeS: 100,
    } as any);
    assert.equal(wsDriverA.messages.length, 1);
    const msg = wsDriverA.messages[0].payload;
    assert.ok(Array.isArray(msg.coordinates));
    assert.equal(msg.coordinates[0].lat, 23.0);
  });

  await t.test("TEST 10: route:switched contains usable coordinates", () => {
    clearQs();
    bus.broadcast("route:switched", {
      emergencyId: 10,
      routeId: 6,
      segments: ["edge2"],
      coordinates: [{ lat: 23.1, lng: 77.1 }],
      reason: "traffic",
      estimatedTravelTimeS: 120,
      updatedAt: new Date().toISOString()
    } as any);
    assert.equal(wsDriverA.messages.length, 1);
    assert.ok(Array.isArray(wsDriverA.messages[0].payload.coordinates));
  });

  await t.test("TEST 11: corridor:update contains corridorId and usable coordinates", () => {
    clearQs();
    bus.broadcast("corridor:update", {
      emergencyId: 10,
      corridorId: 100,
      coordinates: [{ lat: 23.2, lng: 77.2 }],
      status: "ACTIVE",
      simTimeSeconds: 10,
      signals: []
    } as any);
    assert.equal(wsDriverA.messages.length, 1);
    assert.equal(wsDriverA.messages[0].payload.corridorId, 100);
  });

  await t.test("TEST 12: corridor:authorized contains specific fields", () => {
    clearQs();
    bus.broadcast("corridor:authorized", {
      emergencyId: 10,
      corridorId: null,
      status: "AUTHORIZED",
      updatedAt: "2026-09-25"
    } as any);
    assert.equal(wsDriverA.messages.length, 1);
    const p = wsDriverA.messages[0].payload;
    assert.equal(p.emergencyId, 10);
    assert.equal(p.corridorId, null);
    assert.equal(p.status, "AUTHORIZED");
    assert.ok(p.updatedAt);
  });

  await t.test("TEST 13: Driver A must not receive corridor:authorized for emergency B", () => {
    clearQs();
    bus.broadcast("corridor:authorized", {
      emergencyId: 11,
      corridorId: null,
      status: "AUTHORIZED",
      updatedAt: "2026-09-25"
    } as any);
    assert.equal(wsDriverA.messages.length, 0);
  });

  await t.test("TEST 14: Admin receives telemetry", () => {
    clearQs();
    bus.broadcast("vehicle:update", { vehicles: [] });
    assert.equal(wsAdmin.messages.length, 1);
  });

  await t.test("TEST 15: Heartbeat", () => {
    clearQs();
    bus.broadcast("heartbeat", { timestamp: Date.now() });
    assert.equal(wsDriverA.messages.length, 1);
    assert.equal(wsAdmin.messages.length, 1);
  });
});
