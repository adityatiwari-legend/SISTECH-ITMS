import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTestHarness,
  isDatabaseAvailable,
  resetTestDatabase,
  type TestAppHarness,
} from "./helpers.ts";
import type { EmergencyEventDetail } from "@itms/types";

const dbAvailable = await isDatabaseAvailable();

async function withHarness(fn: (harness: TestAppHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

/** Steps the simulation until the emergency is active (vehicle inserted). */
async function waitForActive(harness: TestAppHarness, eventId: number, timeoutMs = 20_000): Promise<EmergencyEventDetail> {
  const deadline = Date.now() + timeoutMs;
  let detail: EmergencyEventDetail | null = null;
  while (Date.now() < deadline) {
    await harness.manager.stepOnce();
    detail = await harness.emergencyService.getEmergency(eventId);
    if (detail.status === "active") return detail;
  }
  return detail!;
}

/** Steps the simulation until the emergency arrives or the timeout expires. */
async function waitForArrival(harness: TestAppHarness, eventId: number, timeoutMs = 120_000): Promise<EmergencyEventDetail> {
  const deadline = Date.now() + timeoutMs;
  let detail = await harness.emergencyService.getEmergency(eventId);
  while (Date.now() < deadline) {
    await harness.manager.stepOnce();
    detail = await harness.emergencyService.getEmergency(eventId);
    if (detail.status === "arrived" || detail.status === "failed") return detail;
  }
  return detail;
}

test("emergency lifecycle: create, spawn, follow route, ETA, arrival", { timeout: 300_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, manager } = harness;

    // -- creation without a running simulation is rejected --
    const premature = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "ambulance", origin: "W1", destination: "E2", priority: "critical" },
    });
    assert.equal(premature.statusCode, 409);
    assert.equal(premature.json().error.code, "simulation_not_running");

    // -- start the baseline scenario (emergencies are dynamic now) --
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 10; i++) {
      await manager.stepOnce();
    }

    // -- create the emergency --
    const created = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "ambulance", origin: "W1", destination: "E2", priority: "critical" },
    });
    assert.equal(created.statusCode, 201);
    const detail = created.json() as EmergencyEventDetail;
    assert.equal(detail.type, "ambulance");
    assert.equal(detail.priority, "critical");
    assert.equal(detail.originJunction, "W1");
    assert.equal(detail.destinationJunction, "E2");
    assert.equal(detail.status === "created" || detail.status === "active", true);

    // -- route validity: starts at origin, ends at destination, connected --
    const route = detail.route!;
    assert.equal(route.algorithm, "astar");
    assert.equal(route.originJunction, "W1");
    assert.equal(route.destinationJunction, "E2");
    assert.ok(route.segments.length >= 2);
    assert.equal(route.segments[0]!.fromJunction, "W1");
    for (let i = 1; i < route.segments.length; i++) {
      assert.equal(route.segments[i]!.fromJunction, route.segments[i - 1]!.toJunction, `segment ${i} connectivity`);
    }
    assert.equal(route.segments[route.segments.length - 1]!.toJunction, "E2");
    // all segments exist in the SUMO network (cross-check via road graph)
    for (const segment of route.segments) {
      assert.ok(harness.roadGraph.getEdge(segment.segmentId) !== null, `segment ${segment.segmentId} in network`);
    }

    // -- vehicle appears in SUMO with the emergency vType --
    const active = await waitForActive(harness, detail.id);
    assert.equal(active.status, "active");
    assert.equal(active.vehicle!.type, "ambulance");
    assert.ok(active.live !== null);
    assert.ok(active.live!.speedMps >= 0);

    // -- the vehicle's route in SUMO is the computed route --
    const sumoRouteEdges = await harness.manager.getTraCIClient()!.getRouteEdges(`route-emv-${detail.id}`);
    assert.deepEqual(sumoRouteEdges, route.segments.map((segment) => segment.segmentId));

    // -- position updates between steps --
    const firstPos = active.live!;
    await harness.manager.stepOnce();
    const secondDetail = await harness.emergencyService.getEmergency(detail.id);
    const secondPos = secondDetail.live!;
    const moved =
      Math.abs(secondPos.positionX - firstPos.positionX) > 0.01 ||
      Math.abs(secondPos.positionY - firstPos.positionY) > 0.01 ||
      secondPos.routeIndex !== firstPos.routeIndex ||
      secondPos.remainingDistanceM !== firstPos.remainingDistanceM;
    assert.ok(moved, "emergency vehicle must move between steps");

    // -- ETA calculated for upcoming controlled intersections + destination --
    assert.ok(secondDetail.etas !== null);
    assert.ok(secondDetail.etas!.length >= 1, "at least the destination ETA must exist");
    const destinationEta = secondDetail.etas!.find((eta) => eta.isDestination);
    assert.ok(destinationEta !== undefined, "destination ETA must be present");
    assert.equal(destinationEta!.junctionId, "E2");
    assert.ok(destinationEta!.etaSeconds > 0);
    assert.ok(destinationEta!.distanceM > 0);
    // ETAs are non-decreasing along the route
    for (let i = 1; i < secondDetail.etas!.length; i++) {
      assert.ok(secondDetail.etas![i]!.etaSeconds >= secondDetail.etas![i - 1]!.etaSeconds - 0.05);
    }
    // ETAs only include controlled junctions or the destination
    for (const eta of secondDetail.etas!) {
      const isControlled = ["I1", "I2", "I3", "I4", "I5", "I6"].includes(eta.junctionId);
      assert.ok(isControlled || eta.isDestination, `ETA junction ${eta.junctionId} must be controlled or destination`);
    }

    // -- vehicle follows the route until arrival --
    const final = await waitForArrival(harness, detail.id, 180_000);
    assert.equal(final.status, "arrived", `expected arrival, got ${final.status}`);
    assert.ok(final.arrivedAtIso !== null);

    // -- persistence: event, vehicle, route, route_segments stored --
    const eventRow = await harness.db.query<{ status: string; arrived_at: Date | null }>(
      "SELECT status, arrived_at FROM emergency_events WHERE id = $1",
      [detail.id],
    );
    assert.equal(eventRow.rows[0]!.status, "arrived");
    assert.ok(eventRow.rows[0]!.arrived_at !== null);
    const vehicleRow = await harness.db.query<{ vehicle_id: string; type: string; status: string }>(
      "SELECT vehicle_id, type, status FROM emergency_vehicles WHERE id = $1",
      [detail.vehicle!.id],
    );
    assert.equal(vehicleRow.rows[0]!.type, "ambulance");
    assert.equal(vehicleRow.rows[0]!.status, "arrived");
    const routeRow = await harness.db.query<{ algorithm: string; edge_count: number }>(
      "SELECT algorithm, edge_count FROM routes WHERE id = $1",
      [route.id],
    );
    assert.equal(routeRow.rows[0]!.algorithm, "astar");
    const segmentCount = await harness.db.query<{ count: string }>(
      "SELECT count(*) AS count FROM route_segments WHERE route_id = $1",
      [route.id],
    );
    assert.equal(Number(segmentCount.rows[0]!.count), route.edgeCount);
  });
});

test("emergency APIs: list, detail, 404, validation errors", { timeout: 180_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, manager } = harness;
    await manager.start("baseline", { autoRun: false });

    // empty list before any emergency
    const empty = await app.inject({ method: "GET", url: "/api/emergency" });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), { emergencies: [] });

    // create one
    const created = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "fire_engine", origin: "W2", destination: "E1", priority: "high" },
    });
    assert.equal(created.statusCode, 201);
    const detail = created.json() as EmergencyEventDetail;
    assert.equal(detail.type, "fire_engine");
    assert.equal(detail.priority, "high");

    // list contains it
    const list = await app.inject({ method: "GET", url: "/api/emergency" });
    assert.equal(list.statusCode, 200);
    const listBody = list.json() as { emergencies: EmergencyEventDetail[] };
    assert.equal(listBody.emergencies.length, 1);
    assert.equal(listBody.emergencies[0]!.id, detail.id);

    // detail by id
    const got = await app.inject({ method: "GET", url: `/api/emergency/${detail.id}` });
    assert.equal(got.statusCode, 200);
    assert.equal((got.json() as EmergencyEventDetail).id, detail.id);

    // unknown id -> 404
    const missing = await app.inject({ method: "GET", url: "/api/emergency/999" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "unknown_emergency");

    // invalid id format -> 400
    const badId = await app.inject({ method: "GET", url: "/api/emergency/abc" });
    assert.equal(badId.statusCode, 400);

    // invalid type -> 400 (schema enum)
    const badType = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "dragon", origin: "W1", destination: "E2", priority: "high" },
    });
    assert.equal(badType.statusCode, 400);

    // unknown origin -> 422
    const badOrigin = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "police", origin: "ZZ", destination: "E2", priority: "normal" },
    });
    assert.equal(badOrigin.statusCode, 422);
    assert.equal(badOrigin.json().error.code, "invalid_emergency_route");

    // same origin/destination -> 422
    const sameJ = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "police", origin: "W1", destination: "W1", priority: "normal" },
    });
    assert.equal(sameJ.statusCode, 422);

    // police vehicle can be created (all three types supported)
    const police = await app.inject({
      method: "POST",
      url: "/api/emergency",
      payload: { type: "police", origin: "N2", destination: "S2", priority: "normal" },
    });
    assert.equal(police.statusCode, 201);
    assert.equal((police.json() as EmergencyEventDetail).type, "police");
  });
});
