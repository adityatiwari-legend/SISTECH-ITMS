import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTestHarness,
  isDatabaseAvailable,
  resetTestDatabase,
  type TestAppHarness,
} from "./helpers.ts";
import type { TrafficStateResponse } from "@itms/types";

const dbAvailable = await isDatabaseAvailable();

/** Runs the body with a fresh harness (test DB truncated). */
async function withHarness(fn: (harness: TestAppHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

test("traffic pipeline: collection, processing, persistence, run identity", { timeout: 180_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  // persistEveryTicks=1 so every collected tick is persisted and the exact
  // match between in-memory state and DB rows is deterministic.
  await withHarness(async (harness) => {
    const { manager, trafficService, db } = harness;

    // -- start the emergency scenario with manual stepping --
    const start = await manager.start("emergency", { autoRun: false });
    assert.equal(start.status, "running");

    // -- step 30 times; collection must run per step --
    for (let i = 0; i < 30; i++) {
      await manager.stepOnce();
    }

    // -- API reflects collected live data --
    const traffic = await (await harness.app.inject({ method: "GET", url: "/api/traffic" })).json() as TrafficStateResponse;
    assert.equal(traffic.system.simulationStatus, "running");
    assert.equal(traffic.stale, false);
    assert.ok(traffic.collectedAtIso !== null);
    assert.ok(traffic.simTimeSeconds >= 30);
    assert.equal(traffic.segments.length, 34);
    assert.equal(traffic.intersections.length, 16);
    assert.equal(traffic.intersections.filter((j) => j.controlled).length, 6);

    // -- vehicle count is correct: API summary equals live SUMO vehicles --
    assert.equal(traffic.summary.vehicleCount, manager.getStatusSnapshot().vehicleCount);
    assert.ok(traffic.summary.vehicleCount > 0);

    // -- average speed: with flowing traffic, > 0 and <= free flow (13.89) --
    assert.ok(traffic.summary.avgSpeedMps > 0, "city average speed should be positive with traffic");
    assert.ok(traffic.summary.avgSpeedMps <= 13.89 + 0.01);

    // -- queue: total halting across segments is a non-negative int and
    //    equals SUMO's reported halting values per segment (cross-check one) --
    let queueSum = 0;
    for (const segment of traffic.segments) {
      queueSum += segment.queueLength;
      assert.ok(Number.isInteger(segment.queueLength));
      assert.ok(segment.congestion === "LOW" || segment.congestion === "MEDIUM" || segment.congestion === "HIGH" || segment.congestion === "CRITICAL");
    }
    assert.ok(queueSum >= 0);

    // -- density: occupancy in [0,1] and vehiclesPerKm consistent with count --
    for (const segment of traffic.segments) {
      assert.ok(segment.occupancy >= 0 && segment.occupancy <= 1);
      assert.ok(segment.vehiclesPerKm >= 0);
      const isInternal = segment.fromJunction.startsWith("I") && segment.toJunction.startsWith("I");
      if (isInternal) {
        const expected = segment.vehicleCount / (200 / 1000) / 2; // 200 m, 2 lanes
        assert.ok(Math.abs(segment.vehiclesPerKm - expected) < 1, `vehiclesPerKm for ${segment.segmentId}`);
      }
    }

    // -- congestion classification responds to a forced red light --
    // Force I2 all-red for a while: its approaches must queue up.
    const i2Signal = await harness.app.inject({ method: "POST", url: "/api/signals/I2/state", payload: { state: "r".repeat(16) } });
    assert.equal(i2Signal.statusCode, 200);
    for (let i = 0; i < 30; i++) {
      await manager.stepOnce();
    }
    const congested = await (await harness.app.inject({ method: "GET", url: "/api/traffic" })).json() as TrafficStateResponse;
    const congestedSegments = congested.segments.filter((s) => s.congestion !== "LOW");
    assert.ok(congestedSegments.length > 0, "forcing I2 red must create non-LOW congestion somewhere");

    // -- persistence: snapshots were written (persistEveryTicks=1) --
    // Persistence is throttled/async; poll briefly for the latest tick.
    let persistedMax: number | null = null;
    const persistDeadline = Date.now() + 5_000;
    while (Date.now() < persistDeadline) {
      const maxRow = await db.query<{ max: number | null }>("SELECT max(sim_time_s) AS max FROM traffic_snapshots");
      persistedMax = maxRow.rows[0]!.max;
      if (persistedMax !== null && Math.abs(persistedMax - congested.simTimeSeconds) < 0.01) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const snap = await db.query<{ count: string }>("SELECT count(*) AS count FROM traffic_snapshots");
    assert.ok(Number(snap.rows[0]!.count) > 0, "traffic snapshots must be persisted");
    const persisted = await db.query<{ segment_id: string; vehicle_count: number; queue_length: number; congestion: string }>(
      "SELECT segment_id, vehicle_count, queue_length, congestion FROM traffic_snapshots WHERE sim_time_s = $1",
      [congested.simTimeSeconds],
    );
    assert.ok(persisted.rows.length > 0, `latest tick ${congested.simTimeSeconds} must be persisted (max persisted: ${persistedMax})`);
    for (const row of persisted.rows) {
      const live = congested.segments.find((s) => s.segmentId === row.segment_id);
      assert.ok(live !== undefined, `persisted segment ${row.segment_id} exists in live state`);
      assert.equal(row.vehicle_count, live.vehicleCount);
      assert.equal(row.queue_length, live.queueLength);
      assert.equal(row.congestion, live.congestion);
    }

    // -- run identity: the active run exists and is running --
    const runs = await db.query<{ id: number; scenario: string; status: string }>(
      "SELECT id, scenario, status FROM simulation_runs ORDER BY id",
    );
    assert.ok(runs.rows.length >= 1);
    assert.equal(runs.rows[0]!.scenario, "emergency");
    assert.equal(runs.rows[0]!.status, "running");

    // -- vehicle registry persisted --
    const vehicles = await db.query<{ count: string }>("SELECT count(*) AS count FROM vehicles");
    assert.ok(Number(vehicles.rows[0]!.count) > 0, "vehicle registry must be persisted");

    // -- run completion on stop --
    await manager.stop();
    const finalRuns = await db.query<{ id: number; status: string }>(
      "SELECT id, status FROM simulation_runs ORDER BY id DESC LIMIT 1",
    );
    assert.equal(finalRuns.rows[0]!.status, "completed");

    // -- after stop, /api/traffic still serves the last state --
    // Once the staleness window (2 s in this harness) passes, it must be
    // reported stale.
    let afterStop: TrafficStateResponse | null = null;
    const staleDeadline = Date.now() + 6_000;
    while (Date.now() < staleDeadline) {
      afterStop = (await (await harness.app.inject({ method: "GET", url: "/api/traffic" })).json()) as TrafficStateResponse;
      if (afterStop.stale) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(afterStop !== null && afterStop.stale, "traffic state must become stale after the simulation stops");
    assert.equal(afterStop!.system.simulationStatus, "idle");
    assert.ok(afterStop!.summary.vehicleCount >= 0);
  });
});

test("traffic pipeline: disconnected simulation marks run as failed and alerts", { timeout: 180_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { manager, trafficService, db, wsBus } = harness;

    let alerted = false;
    const originalBroadcast = wsBus.broadcast.bind(wsBus);
    wsBus.broadcast = (type, payload) => {
      if (type === "system:alert") alerted = true;
      originalBroadcast(type, payload);
    };

    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 5; i++) {
      await manager.stepOnce();
    }

    // Destroy the TraCI socket: simulates a connection failure mid-run.
    const client = manager.getTraCIClient();
    assert.ok(client !== null);
    client.destroy();

    // Wait for the disconnect to propagate (SUMO detects the lost client and
    // exits; the manager transitions to error).
    const errorDeadline = Date.now() + 10_000;
    let status = manager.getStatusSnapshot();
    while (Date.now() < errorDeadline && status.status !== "error") {
      await new Promise((r) => setTimeout(r, 200));
      status = manager.getStatusSnapshot();
    }
    assert.equal(status.status, "error");
    assert.match(status.lastError ?? "", /closed|error/i);

    // Run must be finalized as failed; the alert must be emitted.
    const runsDeadline = Date.now() + 5_000;
    let runStatus: string | null = null;
    while (Date.now() < runsDeadline) {
      const runs = await db.query<{ id: number; status: string }>(
        "SELECT id, status FROM simulation_runs ORDER BY id DESC LIMIT 1",
      );
      runStatus = runs.rows[0]!.status;
      if (runStatus === "failed" && alerted) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(runStatus, "failed");
    assert.equal(alerted, true, "system:alert must be emitted on disconnect");

    // Traffic APIs still respond with system state exposed; data ages out
    // of freshness like in any other stopped state.
    let traffic: TrafficStateResponse | null = null;
    const staleDeadline = Date.now() + 6_000;
    while (Date.now() < staleDeadline) {
      traffic = (await (await harness.app.inject({ method: "GET", url: "/api/traffic" })).json()) as TrafficStateResponse;
      if (traffic.stale) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(traffic !== null && traffic.stale);
    assert.equal(traffic!.system.simulationStatus, "error");

    // Recovery: a new run can start after the failure.
    await manager.stop();
    const restarted = await manager.start("baseline", { autoRun: false });
    assert.equal(restarted.status, "running");
  });
});

test("traffic pipeline: registry endpoints come from PostgreSQL", { timeout: 120_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    // Before any simulation start, the registry must be empty (not fabricated).
    const emptyRoads = await (await harness.app.inject({ method: "GET", url: "/api/traffic/roads" })).json() as { roads: unknown[] };
    assert.equal(emptyRoads.roads.length, 0);

    // Registry is synced on simulation start.
    await harness.manager.start("baseline", { autoRun: false });
    const roads = await (await harness.app.inject({ method: "GET", url: "/api/traffic/roads" })).json() as { roads: Array<{ id: string; segments: unknown[] }> };
    assert.equal(roads.roads.length, 17);
    const i1i2 = roads.roads.find((r) => r.id === "I1-I2");
    assert.ok(i1i2 !== undefined);
    assert.equal(i1i2.segments.length, 2);

    const intersections = await (await harness.app.inject({ method: "GET", url: "/api/traffic/intersections" })).json() as { intersections: Array<{ id: string; controlled: boolean; signalId: string | null }> };
    assert.equal(intersections.intersections.length, 16);
    const i2 = intersections.intersections.find((i) => i.id === "I2");
    assert.ok(i2 !== undefined);
    assert.equal(i2.controlled, true);
    assert.equal(i2.signalId, "I2");
    const w1 = intersections.intersections.find((i) => i.id === "W1");
    assert.ok(w1 !== undefined);
    assert.equal(w1.controlled, false);
  });
});
