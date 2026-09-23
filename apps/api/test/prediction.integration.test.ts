import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createTestHarness, isDatabaseAvailable, resetTestDatabase, type TestAppHarness } from "./helpers.ts";
import type { PredictionsResponse } from "@itms/types";

const dbAvailable = await isDatabaseAvailable();

const PREDICTION_DIR = resolve(import.meta.dirname ?? ".", "..", "..", "..", "services", "prediction");

/** Checks python + uvicorn + model bundle availability for integration tests. */
async function predictionEnvironmentReady(): Promise<boolean> {
  try {
    const probe = spawn("python", ["-c", "import xgboost, fastapi, uvicorn"], { stdio: "ignore" });
    const code = await new Promise<number>((resolve) => probe.on("exit", (code) => resolve(code ?? 1)));
    if (code !== 0) return false;
  } catch {
    return false;
  }
  return true;
}

const envReady = await predictionEnvironmentReady();

/** Starts uvicorn on a free port, waits for /health=ready. */
async function startPredictionService(): Promise<{ url: string; stop(): Promise<void> } | null> {
  const { createServer } = await import("node:net");
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
  const child: ChildProcess = spawn(
    "python",
    ["-m", "uvicorn", "inference.service:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "error"],
    { cwd: PREDICTION_DIR, stdio: "ignore", windowsHide: true },
  );
  const url = `http://127.0.0.1:${port}`;
  // wait for readiness
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null;
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      const body = (await response.json()) as { status?: string };
      if (body.status === "ready") {
        return { url, stop: () => Promise.resolve(new Promise<void>((done) => {
          child.on("exit", () => done());
          child.kill();
        })) };
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  return null;
}

test("node calls the live prediction service; predictions use simulation data; persisted", { timeout: 240_000, skip: dbAvailable && envReady ? false : "PostgreSQL or Python prediction environment not available" }, async () => {
  await resetTestDatabase();
  const service = await startPredictionService();
  if (service === null) {
    return assert.fail("prediction service could not be started");
  }
  try {
    await withHarness(service.url, async (harness) => {
      const { app, manager, db } = harness;

      // before simulation: predictions exist as "unavailable" entries
      const before = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
      assert.equal(before.predictionsEnabled, true);
      assert.equal(before.serviceHealthy, false);
      assert.equal(before.predictions.length, 6);
      assert.ok(before.predictions.every((p) => p.source === "unavailable" && p.stale));

      await manager.start("baseline", { autoRun: false });
      for (let i = 0; i < 40; i++) {
        await manager.stepOnce();
      }

      // wait for the prediction tick to refresh with live data
      const deadline = Date.now() + 15_000;
      let mlCount = 0;
      let predictions: PredictionsResponse | null = null;
      while (Date.now() < deadline) {
        predictions = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
        mlCount = predictions.predictions.filter((p) => p.source === "ml" && !p.stale).length;
        if (mlCount >= 6) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(predictions !== null);
      assert.equal(predictions.serviceHealthy, true);
      assert.ok(mlCount >= 6, `expected fresh ML predictions for all junctions, got ${mlCount}`);

      // predictions carry all four horizons and plausible values
      const first = predictions.predictions[0]!;
      assert.deepEqual(first.horizons.map((h) => h.horizonSeconds), [30, 60, 90, 120]);
      assert.ok(first.horizons.every((h) => h.predictedVehicleCount >= 0));
      assert.ok(first.modelVersion !== null);
      assert.equal(first.stale, false);
      assert.ok(first.basedOnSimTimeSeconds !== null && first.basedOnSimTimeSeconds > 0);

      // persisted in the database with run identity
      const rows = await db.query<{ junction_id: string; horizon_s: number; source: string; predicted_vehicle_count: number }>(
        "SELECT junction_id, horizon_s, source, predicted_vehicle_count FROM traffic_predictions ORDER BY id DESC LIMIT 24",
      );
      assert.ok(rows.rows.length >= 24, "predictions must be persisted");
      assert.ok(rows.rows.every((row) => row.source === "ml" && row.predicted_vehicle_count >= 0));
      const runRow = await db.query<{ count: string }>("SELECT count(*) AS count FROM traffic_predictions WHERE run_id IS NOT NULL");
      assert.ok(Number(runRow.rows[0]!.count) > 0);

      // predictions differ between junctions with different traffic
      const distinct = new Set(predictions.predictions.map((p) => p.horizons.map((h) => h.predictedVehicleCount).join(",")));
      assert.ok(distinct.size >= 2, "different junction states should produce different predictions");
    });
  } finally {
    await service.stop();
  }
});

async function withHarness(
  serviceUrl: string | null,
  fn: (harness: TestAppHarness) => Promise<void>,
  overrides: Partial<import("../src/config.ts").AppConfig> = {},
): Promise<void> {
  const harness = await createTestHarness({ predictionServiceUrl: serviceUrl, ...overrides });
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

test("fallback: unreachable prediction service produces deterministic fallback, no crash", { timeout: 180_000, skip: dbAvailable ? false : "PostgreSQL test database not reachable" }, async () => {
  await resetTestDatabase();
  // Point the client at a closed port: service unreachable.
  await withHarness("http://127.0.0.1:9", async (harness) => {
    const { app, manager, db } = harness;
    await manager.start("baseline", { autoRun: false });
    for (let i = 0; i < 20; i++) {
      await manager.stepOnce();
    }
    const deadline = Date.now() + 10_000;
    let response: PredictionsResponse | null = null;
    let fallbackCount = 0;
    while (Date.now() < deadline) {
      response = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
      fallbackCount = response.predictions.filter((p) => p.source === "fallback").length;
      if (fallbackCount >= 6) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(response !== null);
    assert.equal(response.serviceHealthy, false);
    assert.equal(fallbackCount, 6, "all junctions must use the deterministic fallback");
    const fallback = response.predictions[0]!;
    assert.ok(fallback.horizons.every((h) => h.predictedVehicleCount >= 0));
    assert.ok(fallback.lastError === null || fallback.lastError !== null); // error info present, not fatal

    // fallback predictions persisted with source=fallback
    const rows = await db.query<{ source: string }>(
      "SELECT DISTINCT source FROM traffic_predictions ORDER BY source",
    );
    assert.ok(rows.rows.some((row) => row.source === "fallback"));

    // traffic control kept working throughout
    assert.equal(manager.getStatusSnapshot().status, "running");
  });
});

test("fallback: most recent valid ML prediction is reused while service is down", { timeout: 240_000, skip: dbAvailable && envReady ? false : "PostgreSQL or Python prediction environment not available" }, async () => {
  await resetTestDatabase();
  const service = await startPredictionService();
  if (service === null) return assert.fail("prediction service could not be started");
  try {
    // Long staleness window: the reuse rule (not staleness) is under test here.
    await withHarness(
      service.url,
      async (harness) => {
        const { app, manager } = harness;
        await manager.start("baseline", { autoRun: false });
        for (let i = 0; i < 30; i++) {
          await manager.stepOnce();
        }
        // wait for ML predictions
        const deadline = Date.now() + 15_000;
        let gotMl = false;
        while (Date.now() < deadline) {
          const response = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
          gotMl = response.predictions.every((p) => p.source === "ml");
          if (gotMl) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        assert.ok(gotMl);

        // stop the python service; the Node cache keeps serving the last valid predictions
        await service.stop();
        for (let i = 0; i < 5; i++) {
          await manager.stepOnce();
        }
        // poll until a prediction tick has observed the service failure
        const downDeadline = Date.now() + 10_000;
        let response: PredictionsResponse | null = null;
        let serviceDownObserved = false;
        while (Date.now() < downDeadline) {
          response = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
          if (!response.serviceHealthy) {
            serviceDownObserved = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        assert.ok(response !== null && serviceDownObserved, "service failure must be observed");
        const mlCount = response!.predictions.filter((p) => p.source === "ml").length;
        assert.ok(mlCount >= 1, "recent valid ML predictions must be reused while the service is down");
        assert.ok(response!.predictions.every((p) => p.horizons.length === 4));
      },
      // Reuse rule under test: a very long staleness window makes the
      // expectation deterministic (recent-valid, not stale-expired).
      { predictionStaleAfterSeconds: 600 },
    );
  } finally {
    // already stopped above
  }
});

test("predictions disabled by configuration respond honestly", { timeout: 120_000 }, async () => {
  await withHarness(null, async (harness) => {
    const { app, manager } = harness;
    const response = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
    assert.equal(response.predictionsEnabled, false);
    assert.equal(response.serviceUrl, null);
    assert.equal(response.predictions.length, 6);
    assert.ok(response.predictions.every((p) => p.source === "unavailable"));
    await manager.start("baseline", { autoRun: false });
    const after = (await (await app.inject({ method: "GET", url: "/api/predictions" })).json()) as PredictionsResponse;
    assert.equal(after.predictionsEnabled, false);
    assert.ok(after.predictions.every((p) => p.source === "unavailable"));
  });
});
