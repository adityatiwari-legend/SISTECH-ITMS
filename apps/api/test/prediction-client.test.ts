import { test } from "node:test";
import assert from "node:assert/strict";
import { PredictionClient, horizonResultToType, type PredictionServiceInput } from "../src/modules/prediction/prediction-client.ts";
import { computeFallbackPrediction } from "../src/modules/prediction/prediction-service.ts";

/** Deterministic fetch stub bound to a queue of outcomes. */
function stubFetch(outcomes: Array<() => unknown>): { client: PredictionClient; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    calls.push(String(url));
    const outcome = outcomes[Math.min(index, outcomes.length - 1)]!;
    index += 1;
    return outcome() as Response;
  }) as typeof fetch;
  return {
    calls,
    client: new PredictionClient({ baseUrl: "http://stub:9", timeoutMs: 200 }),
  };
}

const validInput: PredictionServiceInput = {
  intersectionId: "I2",
  vehicleCount: 10,
  speedMps: 8,
  queueLength: 3,
  density: 0.2,
  flowRatePerHour: 900,
  signalPhase: 0,
  signalState: "GGGgrrrrGGGgrrrr",
  cyclePositionSeconds: 12,
  hour: 8,
  dayOfWeek: 2,
  countLag10s: 8,
  countLag30s: 6,
  queueLag10s: 2,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("prediction client: success maps all horizons", async () => {
  const { client, calls } = stubFetch([
    () =>
      jsonResponse(200, {
        predictions: { "30s": 12, "60s": 14, "90s": 15, "120s": 16 },
        model_version: "v1",
        inference_ms: 1.5,
      }),
  ]);
  const result = await client.predict(validInput);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.predictions["30s"], 12);
    assert.equal(result.predictions["120s"], 16);
    assert.equal(result.modelVersion, "v1");
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /\/predict$/);
});

test("prediction client: timeout maps to typed timeout", async () => {
  const { client } = stubFetch([
    () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    },
  ]);
  const result = await client.predict(validInput);
  assert.deepEqual(result, { ok: false, reason: "timeout" });
});

test("prediction client: unreachable maps to unavailable", async () => {
  const { client } = stubFetch([() => { throw new Error("ECONNREFUSED"); }]);
  const result = await client.predict(validInput);
  assert.deepEqual(result, { ok: false, reason: "unavailable" });
});

test("prediction client: 503 maps to no_model", async () => {
  const { client } = stubFetch([() => jsonResponse(503, { detail: "no model" })]);
  const result = await client.predict(validInput);
  assert.deepEqual(result, { ok: false, reason: "no_model" });
});

test("prediction client: 422 maps to invalid_input with message", async () => {
  const { client } = stubFetch([() => jsonResponse(422, { detail: "density out of range" })]);
  const result = await client.predict(validInput);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_input");
    assert.match(result.message, /density/);
  }
});

test("prediction client: malformed body maps to invalid_response", async () => {
  const { client } = stubFetch([
    () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
  ]);
  const result = await client.predict(validInput);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_response");
  }
});

test("prediction client: missing horizon maps to invalid_response", async () => {
  const { client } = stubFetch([
    () => jsonResponse(200, { predictions: { "30s": 5, "60s": 5, "90s": 5 }, model_version: "v1" }),
  ]);
  const result = await client.predict(validInput);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_response");
    assert.match(result.message, /120s/);
  }
});

test("prediction client: negative horizon value maps to invalid_response", async () => {
  const { client } = stubFetch([
    () => jsonResponse(200, { predictions: { "30s": -2, "60s": 5, "90s": 5, "120s": 5 }, model_version: "v1" }),
  ]);
  const result = await client.predict(validInput);
  assert.equal(result.ok, false);
  if (!result.ok && result.reason === "invalid_response") {
    assert.match(result.message, /30s/);
  }
});

test("prediction client: health maps ready/unready", async () => {
  const ready = stubFetch([() => jsonResponse(200, { status: "ready" })]);
  assert.deepEqual(await ready.client.health(), { ok: true, status: "ready" });
  const down = stubFetch([() => { throw new Error("down"); }]);
  assert.equal((await down.client.health()).ok, false);
});

test("horizon result shaping is ordered and typed", () => {
  const horizons = horizonResultToType({ "30s": 1, "60s": 2, "90s": 3, "120s": 4 });
  assert.deepEqual(
    horizons.map((h) => h.horizonSeconds),
    [30, 60, 90, 120],
  );
  assert.equal(horizons[3]!.predictedVehicleCount, 4);
});

test("deterministic fallback: rising trend extrapolates damped", () => {
  const horizons = computeFallbackPrediction({ vehicleCount: 10, countLag10s: 5 });
  // rate = (10-5)/10 = 0.5/s; damp(h) = 1/(1+h/120)
  // h=30: 10 + 0.5*30*0.8   = 22
  // h=60: 10 + 0.5*60*(2/3) = 30
  // h=90: 10 + 0.5*90*(4/7) = 35.71 -> 36
  // h=120: 10 + 0.5*120*0.5 = 40
  assert.deepEqual(horizons.map((h) => h.predictedVehicleCount), [22, 30, 36, 40]);
});

test("deterministic fallback: flat trend keeps the count; negative clamps at 0", () => {
  const flat = computeFallbackPrediction({ vehicleCount: 7, countLag10s: 7 });
  assert.deepEqual(flat.map((h) => h.predictedVehicleCount), [7, 7, 7, 7]);
  const dropping = computeFallbackPrediction({ vehicleCount: 2, countLag10s: 12 });
  assert.ok(dropping.every((h) => h.predictedVehicleCount >= 0));
  const noHistory = computeFallbackPrediction({ vehicleCount: 9, countLag10s: null });
  assert.deepEqual(noHistory.map((h) => h.predictedVehicleCount), [9, 9, 9, 9]);
});
