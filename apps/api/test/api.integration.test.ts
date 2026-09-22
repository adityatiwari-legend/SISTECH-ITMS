import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import {
  createTestHarness,
  isDatabaseAvailable,
  resetTestDatabase,
  type TestAppHarness,
} from "./helpers.ts";
import type { SignalSnapshot, SimulationStatusSnapshot, ApiErrorBody, TrafficStateResponse, RoadInfo, IntersectionInfo, WsEvent } from "@itms/types";

async function withHarness(fn: (harness: TestAppHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

// ---------------------------------------------------------------------------
// Phase 1 API contract (unchanged behavior over the new wiring)
// ---------------------------------------------------------------------------

test("simulation lifecycle API contract holds", { timeout: 150_000 }, async () => {
  await withHarness(async (harness) => {
    const { app, manager } = harness;

    const start = await app.inject({ method: "POST", url: "/api/simulation/start", payload: {} });
    assert.equal(start.statusCode, 200);
    const startBody = start.json() as SimulationStatusSnapshot;
    assert.equal(startBody.status, "running");

    const conflict = await app.inject({ method: "POST", url: "/api/simulation/start", payload: {} });
    assert.equal(conflict.statusCode, 409);
    assert.equal((conflict.json() as ApiErrorBody).error.code, "simulation_already_active");

    const signals = await app.inject({ method: "GET", url: "/api/signals" });
    assert.equal(signals.statusCode, 200);
    assert.equal((signals.json() as { signals: SignalSnapshot[] }).signals.length, 6);

    const unknown = await app.inject({ method: "GET", url: "/api/signals/XYZ" });
    assert.equal(unknown.statusCode, 404);
    assert.equal((unknown.json() as ApiErrorBody).error.code, "unknown_signal");

    const setState = await app.inject({
      method: "POST",
      url: "/api/signals/I2/state",
      payload: { state: "r".repeat(16) },
    });
    assert.equal(setState.statusCode, 200);
    assert.equal((setState.json() as SignalSnapshot).state, "r".repeat(16));

    const badLength = await app.inject({
      method: "POST",
      url: "/api/signals/I2/state",
      payload: { state: "r" },
    });
    assert.equal(badLength.statusCode, 422);

    const stopped = await app.inject({ method: "POST", url: "/api/simulation/stop" });
    assert.equal(stopped.statusCode, 200);
    assert.equal((stopped.json() as SimulationStatusSnapshot).status, "idle");
  });
});

// ---------------------------------------------------------------------------
// Phase 2 traffic APIs
// ---------------------------------------------------------------------------

test("traffic APIs return consistent typed data before and during simulation", { timeout: 150_000, skip: (await isDatabaseAvailable()) ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app } = harness;

    // -- before any simulation: honest empty state --
    const before = await app.inject({ method: "GET", url: "/api/traffic" });
    assert.equal(before.statusCode, 200);
    const beforeBody = before.json() as TrafficStateResponse;
    assert.equal(beforeBody.collectedAtIso, null);
    assert.equal(beforeBody.stale, true);
    assert.equal(beforeBody.segments.length, 34);
    assert.ok(beforeBody.segments.every((s) => s.vehicleCount === 0 && s.congestion === "LOW"));
    assert.equal(beforeBody.system.dbConnected, true);

    const roadsEmpty = await app.inject({ method: "GET", url: "/api/traffic/roads" });
    assert.equal(roadsEmpty.statusCode, 200);
    assert.equal((roadsEmpty.json() as { roads: unknown[] }).roads.length, 0);

    // -- start and collect --
    await app.inject({ method: "POST", url: "/api/simulation/start", payload: { scenario: "baseline" } });
    // paced loop collects quickly; wait for live data
    const deadline = Date.now() + 15_000;
    let live = false;
    while (Date.now() < deadline) {
      const current = (await (await app.inject({ method: "GET", url: "/api/traffic" })).json()) as TrafficStateResponse;
      if (current.collectedAtIso !== null && !current.stale) {
        live = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(live, "traffic state should become fresh after simulation start");

    const traffic = (await (await app.inject({ method: "GET", url: "/api/traffic" })).json()) as TrafficStateResponse;
    assert.equal(traffic.system.simulationStatus, "running");
    assert.ok(traffic.summary.vehicleCount >= 0);
    assert.equal(traffic.segments.length, 34);
    for (const segment of traffic.segments) {
      assert.ok(segment.roadId.length > 0, "segments carry their road id");
      assert.ok(segment.congestion in { LOW: 1, MEDIUM: 1, HIGH: 1, CRITICAL: 1 });
    }

    const roads = await app.inject({ method: "GET", url: "/api/traffic/roads" });
    assert.equal(roads.statusCode, 200);
    const roadList = (roads.json() as { roads: RoadInfo[] }).roads;
    assert.equal(roadList.length, 17);
    assert.ok(roadList.every((r) => r.segments.length >= 1 && r.segments.every((s) => s.laneCount >= 1 && s.lengthM > 0 && s.maxSpeedMps > 0)));

    const intersections = await app.inject({ method: "GET", url: "/api/traffic/intersections" });
    assert.equal(intersections.statusCode, 200);
    const intersectionList = (intersections.json() as { intersections: IntersectionInfo[] }).intersections;
    assert.equal(intersectionList.length, 16);
    const i2 = intersectionList.find((i) => i.id === "I2")!;
    assert.equal(i2.controlled, true);
    assert.ok(i2.traffic !== null, "I2 has live traffic overlay");
  });
});

// ---------------------------------------------------------------------------
// WebSocket events
// ---------------------------------------------------------------------------

test("websocket emits traffic, vehicle, signal and emergency events", { timeout: 200_000, skip: (await isDatabaseAvailable()) ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, port } = harness;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: WsEvent<unknown>[] = [];
    socket.on("message", (data: WebSocket.RawData) => {
      try {
        received.push(JSON.parse(data.toString()) as WsEvent<unknown>);
      } catch {
        assert.fail("websocket messages must be valid JSON");
      }
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (err: Error) => reject(new Error(`ws connect failed: ${err.message}`)));
    });

    await app.inject({ method: "POST", url: "/api/simulation/start", payload: { scenario: "baseline" } });

    // Phase 3: also create an emergency so its events flow through /ws.
    const emergency = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "ambulance", origin: "W1", destination: "E2", priority: "critical" },
    });
    assert.equal(emergency.statusCode, 201);

    const deadline = Date.now() + 30_000;
    const wanted = new Set(["traffic:update", "vehicle:update", "signal:update", "emergency:created", "route:updated"]);
    while (Date.now() < deadline && wanted.size > 0) {
      for (const event of received) {
        if (wanted.has(event.type)) {
          wanted.delete(event.type);
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    socket.close();
    assert.deepEqual(
      [...wanted],
      [],
      `all event types must arrive; received ${received.map((e) => e.type).join(",")}`,
    );

    // -- payload contents come from the live simulation --
    const trafficEvent = received.find((e) => e.type === "traffic:update") as WsEvent<TrafficStateResponse>;
    assert.ok(trafficEvent.payload.segments.length === 34);
    assert.ok(typeof trafficEvent.payload.summary.vehicleCount === "number");
    const vehicleEvent = received.find((e) => e.type === "vehicle:update") as WsEvent<{ vehicles: unknown[] }>;
    assert.ok(Array.isArray(vehicleEvent.payload.vehicles));
    const signalEvent = received.find((e) => e.type === "signal:update") as WsEvent<{ signals: unknown[] }>;
    assert.equal((signalEvent.payload.signals as unknown[]).length, 6);

    // -- emergency events carry the new event and route --
    const createdEvent = received.find((e) => e.type === "emergency:created") as WsEvent<{ eventId: number; type: string }>;
    assert.ok(createdEvent.payload.eventId >= 1);
    assert.equal(createdEvent.payload.type, "ambulance");
    const routeEvent = received.find((e) => e.type === "route:updated") as WsEvent<{ segments: string[] }>;
    assert.ok(routeEvent.payload.segments.length >= 2);
  });
});

// ---------------------------------------------------------------------------
// Error behavior
// ---------------------------------------------------------------------------

test("API validation and error envelope remain consistent", { timeout: 60_000 }, async () => {
  await withHarness(async (harness) => {
    const { app } = harness;
    const notFound = await app.inject({ method: "GET", url: "/api/nope" });
    assert.equal(notFound.statusCode, 404);
    assert.deepEqual(notFound.json(), { error: { code: "not_found", message: "Route GET /api/nope not found." } });

    const badBody = await app.inject({ method: "POST", url: "/api/simulation/start", payload: { scenario: "mars" } });
    assert.equal(badBody.statusCode, 400);
  });
});
