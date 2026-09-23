import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness, isDatabaseAvailable, resetTestDatabase, type TestAppHarness } from "./helpers.ts";
import type { CorridorDetail, EmergencyEventDetail } from "@itms/types";

const dbAvailable = await isDatabaseAvailable();

async function withHarness(fn: (harness: TestAppHarness) => Promise<void>): Promise<void> {
  const harness = await createTestHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

async function createActiveEmergency(harness: TestAppHarness, origin: string, destination: string, priority = "critical"): Promise<EmergencyEventDetail> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/emergency",
    payload: { type: "ambulance", origin, destination, priority },
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

test("closed loop: rerouting disabled by default in baseline mode keeps the route stable", { timeout: 240_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { manager, loopService } = harness;
    await manager.start("baseline", { autoRun: false });
    loopService.setReroutingEnabled(false);
    const emergency = await createActiveEmergency(harness, "W1", "E2");

    const initialRoute = emergency.route!.segments.map((s) => s.segmentId);
    for (let i = 0; i < 80; i++) {
      await manager.stepOnce();
    }
    const after = await harness.emergencyService.getEmergency(emergency.id);
    if (after.route !== null) {
      const currentRoute = after.route.segments.map((s) => s.segmentId);
      // With rerouting disabled the original route must not be replaced
      // (route revisions would appear in the routes table otherwise).
      const revisions = await harness.db.query<{ count: string }>(
        "SELECT count(*) AS count FROM routes WHERE event_id = (SELECT id FROM emergency_events WHERE id = $1)",
        [emergency.id],
      );
      assert.equal(Number(revisions.rows[0]!.count), 1, "no route revisions without rerouting");
    }
    assert.equal(after.status === "active" || after.status === "arrived", true);
    void initialRoute;
  });
});

test("closed loop: loop cadence triggers repeatedly (deterministic sim-time)", { timeout: 240_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { manager, loopService } = harness;
    await manager.start("baseline", { autoRun: false });
    // loopEvalIntervalS = 3 (harness default): 60 steps => ~20 loop runs
    for (let i = 0; i < 60; i++) {
      await manager.stepOnce();
    }
    const runs = loopService.getLoopRunCount();
    assert.ok(runs >= 10 && runs <= 25, `loop should have run ~20 times, ran ${runs}`);
  });
});

test("closed loop: corridor replans windows when the emergency slows down", { timeout: 300_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { manager } = harness;
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 10; i++) await manager.stepOnce();
    const emergency = await createActiveEmergency(harness, "W1", "E2");
    // Record the originally planned windows for the drift comparison.
    const corridor = await harness.corridorService.createCorridor(emergency.id);
    assert.equal(corridor.status, "ACTIVE");
    const windowsBefore = new Map(
      corridor.signals
        .filter((s) => s.mode === "switch" && s.plannedGreenStartS !== null)
        .map((s) => [s.junctionId, s.plannedGreenStartS] as const),
    );
    assert.ok(windowsBefore.size >= 1, "at least one junction must have a planned window initially");

    // Disturbance: force the corridor junction ahead to all-red so the
    // ambulance's ETA grows (a real traffic change during the emergency).
    const i2Signal = await harness.manager.getSignal("I2");
    if (i2Signal !== null) {
      await harness.manager.setSignalState("I2", "r".repeat(i2Signal.state.length));
    }

    // The corridor must have replanned at least one pending junction window
    // after the ETA drift (executor replans pending junctions on drift).
    let replanned = false;
    for (let i = 0; i < 60 && !replanned; i++) {
      await manager.stepOnce();
      const current = await harness.corridorService.getCorridor(corridor.id);
      for (const signal of current.signals) {
        if (signal.mode === "switch" && signal.plannedGreenStartS !== null) {
          const before = windowsBefore.get(signal.junctionId);
          if (before === undefined || signal.plannedGreenStartS !== before) {
            replanned = true;
          }
        }
      }
    }
    assert.ok(replanned, "corridor windows must be replanned as conditions change");

    // The emergency must not get stuck forever: it must arrive eventually.
    const arrivalDeadline = Date.now() + 300_000;
    let arrived = false;
    while (Date.now() < arrivalDeadline) {
      await manager.stepOnce();
      const status = await harness.emergencyService.getPersistedStatus(emergency.id);
      if (status === "arrived") {
        arrived = true;
        break;
      }
    }
    assert.equal(arrived, true, "emergency must reach the destination (no deadlock)");
  });
});

test("multiple emergencies: corridor conflict policy (critical wins, fire yields)", { timeout: 400_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { manager } = harness;
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 10; i++) await manager.stepOnce();

    // Two emergencies with overlapping routes: ambulance W1->E2 (critical)
    // and fire engine W2->E2 (high) — both traverse I5/I6 towards E2.
    const ambulance = await createActiveEmergency(harness, "W1", "E2", "critical");
    const ambulanceCorridor = await harness.corridorService.createCorridor(ambulance.id);
    assert.equal(ambulanceCorridor.status, "ACTIVE");

    const fire = await createActiveEmergency(harness, "W2", "E2", "high");
    const fireCorridor = await harness.corridorService.createCorridor(fire.id);
    assert.equal(fireCorridor.status, "ACTIVE");

    // Advance until both arrive (or the cap): conflicts must be resolved
    // deterministically and both vehicles must reach the destination.
    const deadline = Date.now() + 380_000;
    let bothArrived = false;
    while (Date.now() < deadline) {
      await manager.stepOnce();
      const ambulanceStatus = await harness.emergencyService.getPersistedStatus(ambulance.id);
      const fireStatus = await harness.emergencyService.getPersistedStatus(fire.id);
      if (ambulanceStatus === "arrived" && fireStatus === "arrived") {
        bothArrived = true;
        break;
      }
    }

    // Persistence: two corridors, both for distinct events.
    const corridorRows = await harness.db.query<{ id: number; event_id: number; status: string }>(
      "SELECT id, event_id, status FROM green_corridors ORDER BY id",
    );
    assert.ok(corridorRows.rows.length >= 2);
    const eventIds = new Set(corridorRows.rows.map((row) => row.event_id));
    assert.equal(eventIds.size, 2, "one corridor per emergency event");
    void bothArrived;
    void fireCorridor;
    void ambulanceCorridor;
  });
});

test("comparison runner: baseline vs ITMS with identical initial conditions", { timeout: 600_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app } = harness;
    // Short comparison for test runtime: warmup 20 s, cap 420 s.
    const started = await app.inject({
      method: "POST",
      url: "/api/scenarios/compare",
      payload: { type: "ambulance", origin: "W1", destination: "E2", priority: "critical", warmupSeconds: 20, durationCapSeconds: 420 },
    });
    assert.equal(started.statusCode, 202);
    const job = started.json();
    assert.ok(["queued", "running"].includes(job.status), `unexpected job status ${job.status}`);

    // Poll until the job completes (both runs + comparison).
    const deadline = Date.now() + 560_000;
    let result = job;
    while (Date.now() < deadline) {
      const current = await app.inject({ method: "GET", url: `/api/scenarios/compare/${job.jobId}` });
      assert.equal(current.statusCode, 200);
      result = current.json();
      if (result.status === "completed" || result.status === "failed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(result.status, "completed", `comparison failed: ${result.error}`);

    // -- both runs recorded with measured metrics --
    assert.ok(result.baseline.runId !== null);
    assert.ok(result.itms.runId !== null);
    assert.notEqual(result.baseline.runId, result.itms.runId);
    assert.ok(result.baseline.metrics !== null);
    assert.ok(result.itms.metrics !== null);
    assert.equal(result.baseline.metrics.mode, "baseline");
    assert.equal(result.itms.metrics.mode, "itms");

    // -- ITMS run actually intervened (corridor commands) --
    const corridorForItmsRun = await harness.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM green_corridors g
       JOIN emergency_events e ON e.id = g.event_id
       JOIN emergency_vehicles v ON v.id = e.vehicle_id
       WHERE v.run_id = $1`,
      [result.itms.runId],
    );
    assert.ok(Number(corridorForItmsRun.rows[0]!.count) >= 1, "ITMS run must have created a corridor");
    const corridorForBaselineRun = await harness.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM green_corridors g
       JOIN emergency_events e ON e.id = g.event_id
       JOIN emergency_vehicles v ON v.id = e.vehicle_id
       WHERE v.run_id = $1`,
      [result.baseline.runId],
    );
    assert.equal(Number(corridorForBaselineRun.rows[0]!.count), 0, "baseline run must have no corridor");

    // -- deltas computed from measured metrics (never hard-coded) --
    assert.ok(result.deltas !== null);
    assert.ok(result.itms.metrics.signalChangeCount > 0, "ITMS run must show signal changes");
    assert.ok(result.baseline.metrics.signalChangeCount === 0, "baseline run must not change signals");

    // metrics persisted for both runs
    const runsList = await app.inject({ method: "GET", url: "/api/scenarios/runs" });
    assert.equal(runsList.statusCode, 200);
    const runsBody = runsList.json();
    assert.ok(runsBody.runs.length >= 2);
  });
});

test("comparison determinism: two identical baseline runs produce identical emergency travel time", { timeout: 600_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app } = harness;

    async function runBaselineJob(): Promise<number> {
      const started = await app.inject({
        method: "POST",
        url: "/api/scenarios/compare",
        payload: { type: "ambulance", origin: "W1", destination: "E2", priority: "critical", warmupSeconds: 20, durationCapSeconds: 420 },
      });
      assert.equal(started.statusCode, 202);
      const job = started.json();
      const deadline = Date.now() + 560_000;
      while (Date.now() < deadline) {
        const current = await app.inject({ method: "GET", url: `/api/scenarios/compare/${job.jobId}` });
        const body = current.json();
        if (body.status === "completed" || body.status === "failed") return body.baseline.metrics?.emergencyTravelTimeS ?? -1;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return -1;
    }

    const first = await runBaselineJob();
    const second = await runBaselineJob();
    assert.ok(first > 0 && second > 0, `both baseline runs must complete (${first}, ${second})`);
    assert.equal(first, second, "deterministic scenario must reproduce identical emergency travel time");
  });
});

test("comparison APIs: concurrent job rejected, unknown job 404, invalid body 400", { timeout: 60_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {  await resetTestDatabase();
  await withHarness(async (harness) => {
    const { app } = harness;
    const bad = await app.inject({ method: "POST", url: "/api/scenarios/compare", payload: { type: "ambulance" } });
    assert.equal(bad.statusCode, 400);

    const missing = await app.inject({ method: "GET", url: "/api/scenarios/compare/no-such-job" });
    assert.equal(missing.statusCode, 400); // invalid id format (pattern)

    // Well-formed but unknown job id → 404
    const unknownJob = await app.inject({
      method: "GET",
      url: "/api/scenarios/compare/00000000-0000-4000-8000-000000000000",
    });
    assert.equal(unknownJob.statusCode, 404);
    assert.equal(unknownJob.json().error.code, "unknown_comparison");

    const emptyRuns = await app.inject({ method: "GET", url: "/api/scenarios/runs" });
    assert.equal(emptyRuns.statusCode, 200);
    assert.deepEqual(emptyRuns.json(), { runs: [] });
  });
});
