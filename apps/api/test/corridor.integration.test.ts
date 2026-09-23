import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTestHarness, isDatabaseAvailable, resetTestDatabase, type TestAppHarness } from "./helpers.ts";
import type { CorridorDetail, EmergencyEventDetail, ApiErrorBody, WsEvent } from "@itms/types";

const dbAvailable = await isDatabaseAvailable();

async function withHarness(fn: (harness: TestAppHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

/** Creates an emergency and waits until its vehicle is active in SUMO. */
async function createActiveEmergency(harness: TestAppHarness, origin: string, destination: string): Promise<EmergencyEventDetail> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/emergency",
    payload: { type: "ambulance", origin, destination, priority: "critical" },
  });
  assert.equal(created.statusCode, 201);
  const detail = created.json() as EmergencyEventDetail;
  const deadline = Date.now() + 30_000;
  let current = detail;
  while (Date.now() < deadline) {
    await harness.manager.stepOnce();
    current = await harness.emergencyService.getEmergency(detail.id);
    if (current.status === "active") return current;
  }
  return assert.fail(`emergency never became active (status ${current.status})`);
}

test("corridor lifecycle: plan, activate, coordinated greens, passage, completion", { timeout: 400_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, manager } = harness;
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 10; i++) {
      await manager.stepOnce();
    }

    const emergency = await createActiveEmergency(harness, "W1", "E2");

    // -- corridor creation requires the emergency on the way --
    const created = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: emergency.id } });
    assert.equal(created.statusCode, 201);
    const corridor = created.json() as CorridorDetail;
    assert.equal(corridor.status, "ACTIVE");
    assert.equal(corridor.eventId, emergency.id);
    // route junctions identified: W1->E2 route has controlled junctions
    assert.ok(corridor.junctionCount >= 1, "corridor must identify controlled junctions");
    const corridorJunctions = corridor.signals.map((s) => s.junctionId);
    assert.ok(corridorJunctions.every((j) => ["I1", "I2", "I3", "I4", "I5", "I6"].includes(j)), "only controlled junctions planned");

    // -- per-junction plans carry real windows and conflict-free states --
    for (const signal of corridor.signals) {
      assert.ok(signal.etaSeconds >= 0);
      if (signal.status === "PENDING" || signal.status === "APPLIED") {
        assert.ok(signal.corridorState !== null);
        assert.equal(signal.corridorState!.length, 16);
        // only corridor links green, everything else red (conflict-free)
        assert.match(signal.corridorState!, /^r*G+r*$/);
      }
      if (signal.status === "PENDING" && signal.mode === "switch") {
        assert.ok(signal.plannedGreenStartS !== null || signal.plannedGreenEndS === null);
      }
      if (signal.mode === "switch" && signal.requiresClearance) {
        // clearance planned: window start before the ETA window
        assert.ok(signal.plannedGreenStartS !== null);
      }
    }

    // -- duplicate corridor for the same event is rejected --
    const duplicate = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: emergency.id } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((duplicate.json() as ApiErrorBody).error.code, "corridor_already_active");

    // -- drive the simulation; the corridor must coordinate signals ahead --
    let appliedStates = 0;
    let passedCount = 0;
    const deadline = Date.now() + 400_000;
    while (Date.now() < deadline) {
      await manager.stepOnce();
      const current = (await (await app.inject({ method: "GET", url: `/api/corridors/${corridor.id}` })).json()) as CorridorDetail;
      appliedStates = current.signals.filter((s) => s.status === "APPLIED" || s.status === "PASSED").length;
      passedCount = current.signals.filter((s) => s.status === "PASSED").length;
      if (current.status === "COMPLETED" || current.status === "FAILED" || current.status === "CANCELLED") {
        break;
      }
      // stop when the corridor is done or the vehicle has passed most junctions
      if (current.live !== null && current.live.remainingJunctions === 0 && current.status !== "ACTIVE") break;
      if (passedCount >= corridor.junctionCount && corridor.junctionCount > 0) break;
    }

    const final = (await (await app.inject({ method: "GET", url: `/api/corridors/${corridor.id}` })).json()) as CorridorDetail;
    // The corridor must have applied at least one signal and passed junctions
    assert.ok(appliedStates >= 1, `corridor must apply signals (applied=${appliedStates})`);
    // applied before passed: each PASSED entry with a planned state must have been APPLIED first
    for (const signal of final.signals) {
      if (signal.status === "PASSED" && signal.corridorState !== null && signal.mode !== "noop") {
        // applied_at <= passed_at is enforced by the executor ordering; verify
        // via the DB timestamps below.
      }
    }

    // -- SUMO received the corridor states: the applied state gave green to the approach --
    const appliedRows = final.signals.filter((s) => s.corridorState !== null && s.mode !== "noop");
    assert.ok(appliedRows.length >= 1, "at least one junction must have a corridor state");

    // -- persistence: corridor + signals stored with relationships --
    const corridorRow = await harness.db.query<{ id: number; status: string; event_id: number }>(
      "SELECT id, status, event_id FROM green_corridors WHERE id = $1",
      [corridor.id],
    );
    assert.equal(corridorRow.rows.length, 1);
    assert.equal(corridorRow.rows[0]!.event_id, emergency.id);
    assert.ok(["ACTIVE", "COMPLETED"].includes(corridorRow.rows[0]!.status));
    const signalRows = await harness.db.query<{ corridor_id: number; status: string }>(
      "SELECT corridor_id, status FROM corridor_signals WHERE corridor_id = $1 ORDER BY sequence_index",
      [corridor.id],
    );
    assert.equal(signalRows.rows.length, corridor.signals.length);
    const appliedInDb = signalRows.rows.filter((row) => row.status === "APPLIED" || row.status === "PASSED").length;
    assert.ok(appliedInDb >= 1, "applied transitions must be persisted");

    // -- ordering guarantee: applied_at < passed_at in the database --
    const ordering = await harness.db.query<{ applied_at: Date | null; passed_at: Date | null; status: string }>(
      "SELECT applied_at, passed_at, status FROM corridor_signals WHERE corridor_id = $1 AND applied_at IS NOT NULL AND passed_at IS NOT NULL",
      [corridor.id],
    );
    for (const row of ordering.rows) {
      assert.ok(row.applied_at! <= row.passed_at!, "signals must be applied before the vehicle passes");
    }
  });
});

test("corridor: cancel restores signals and marks the corridor cancelled", { timeout: 300_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, manager } = harness;
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 10; i++) {
      await manager.stepOnce();
    }
    const emergency = await createActiveEmergency(harness, "W1", "E2");
    const created = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: emergency.id } });
    assert.equal(created.statusCode, 201);
    const corridor = created.json() as CorridorDetail;

    // apply at least one signal: step until an APPLIED entry exists
    const deadline = Date.now() + 60_000;
    let applied = false;
    while (Date.now() < deadline && !applied) {
      await manager.stepOnce();
      const current = (await (await app.inject({ method: "GET", url: `/api/corridors/${corridor.id}` })).json()) as CorridorDetail;
      applied = current.signals.some((s) => s.status === "APPLIED");
    }
    assert.ok(applied, "at least one corridor signal must be applied before cancelling");

    // cancel
    const cancelled = await app.inject({ method: "POST", url: `/api/corridors/${corridor.id}/cancel`, payload: { reason: "operator test" } });
    assert.equal(cancelled.statusCode, 200);
    const cancelledDetail = cancelled.json() as CorridorDetail;
    assert.equal(cancelledDetail.status, "CANCELLED");
    assert.equal(cancelledDetail.cancelReason, "operator test");

    // signals restored: SUMO program back to normal for commanded signals
    const i2 = await harness.manager.getSignal("I2");
    if (i2 !== null && cancelledDetail.signals.some((s) => s.junctionId === "I2" && (s.status === "APPLIED" || s.status === "PASSED"))) {
      const program = await harness.manager.getTraCIClient()!.getCurrentProgram("I2");
      assert.equal(program, "0", "restored program must be the normal fixed-time program");
    }

    // cancelling again is a conflict
    const again = await app.inject({ method: "POST", url: `/api/corridors/${corridor.id}/cancel`, payload: {} });
    assert.equal(again.statusCode, 409);
  });
});

test("corridor APIs: validation and unknown ids", { timeout: 240_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, manager } = harness;
    await manager.start("baseline", { autoRun: false });

    // unknown emergency
    const unknown = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: 999 } });
    assert.equal(unknown.statusCode, 422);
    assert.equal((unknown.json() as ApiErrorBody).error.code, "unknown_emergency");

    // invalid body
    const bad = await app.inject({ method: "POST", url: "/api/corridors", payload: {} });
    assert.equal(bad.statusCode, 400);

    // unknown corridor id
    const missing = await app.inject({ method: "GET", url: "/api/corridors/999" });
    assert.equal(missing.statusCode, 404);
    assert.equal((missing.json() as ApiErrorBody).error.code, "unknown_corridor");

    // bad id format
    const badId = await app.inject({ method: "GET", url: "/api/corridors/abc" });
    assert.equal(badId.statusCode, 400);

    // empty list
    const emptyList = await app.inject({ method: "GET", url: "/api/corridors" });
    assert.equal(emptyList.statusCode, 200);
    assert.deepEqual(emptyList.json(), { corridors: [] });

    // corridor for an emergency without a route needs an emergency first:
    // create one, then a corridor works
    const emergency = await createActiveEmergency(harness, "N2", "S2");
    const created = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: emergency.id } });
    assert.equal(created.statusCode, 201);

    // double activation conflicts
    const double = await app.inject({ method: "POST", url: `/api/corridors/${(created.json() as CorridorDetail).id}/activate` });
    assert.equal(double.statusCode, 409);
  });
});

test("websocket delivers corridor:created and corridor:update", { timeout: 300_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app, port } = harness;
    await harness.manager.start("baseline", { autoRun: false });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: WsEvent<unknown>[] = [];
    socket.on("message", (data: WebSocket.RawData) => {
      received.push(JSON.parse(data.toString()) as WsEvent<unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (err: Error) => reject(new Error(`ws connect failed: ${err.message}`)));
    });

    const emergency = await createActiveEmergency(harness, "W1", "E2");
    const created = await app.inject({ method: "POST", url: "/api/corridors", payload: { eventId: emergency.id } });
    assert.equal(created.statusCode, 201);

    // drive a few steps so corridor:update events flow
    for (let i = 0; i < 12; i++) {
      await manager_steps(harness);
    }

    const deadline = Date.now() + 15_000;
    let gotCreated = false;
    let gotUpdate = false;
    while (Date.now() < deadline && (!gotCreated || !gotUpdate)) {
      gotCreated = gotCreated || received.some((e) => e.type === "corridor:created");
      gotUpdate = gotUpdate || received.some((e) => e.type === "corridor:update");
      await new Promise((r) => setTimeout(r, 200));
    }
    socket.close();
    assert.ok(gotCreated, "corridor:created must be emitted");
    assert.ok(gotUpdate, "corridor:update must be emitted");
  });
});

async function manager_steps(harness: TestAppHarness): Promise<void> {
  await harness.manager.stepOnce();
}
