import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { SCENARIO_PATHS, NETWORK_PATH, TEST_DATABASE_URL } from "./helpers.ts";

test("config: defaults load with valid env", () => {
  const config = loadConfig({
    DATABASE_URL: TEST_DATABASE_URL,
    SUMO_BINARY: "sumo",
  });
  assert.equal(config.networkPath, NETWORK_PATH);
  assert.equal(config.trafficPersistEveryTicks, 5);
  assert.equal(config.trafficEventIntervalMs, 1000);
  assert.equal(config.trafficStaleAfterSeconds, 5);
  assert.equal(config.congestionThresholds.mediumOccupancy, 0.15);
  assert.equal(config.congestionThresholds.criticalQueue, 12);
});

test("config: DATABASE_URL is required", () => {
  assert.throws(
    () => loadConfig({}),
    /DATABASE_URL is required/,
  );
});

test("config: DATABASE_URL must be a postgres URL", () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: "mysql://x/y" }),
    /postgres/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: "not-a-url" }),
    /Invalid DATABASE_URL/,
  );
});

test("config: congestion thresholds are overridable", () => {
  const config = loadConfig({
    DATABASE_URL: TEST_DATABASE_URL,
    TRAFFIC_CONGESTION_MEDIUM_OCCUPANCY: "0.1",
    TRAFFIC_CONGESTION_HIGH_QUEUE: "9",
    TRAFFIC_CONGESTION_CRITICAL_SPEED_RATIO: "0.05",
  });
  assert.equal(config.congestionThresholds.mediumOccupancy, 0.1);
  assert.equal(config.congestionThresholds.highQueue, 9);
  assert.equal(config.congestionThresholds.criticalSpeedRatio, 0.05);
});

test("config: congestion threshold monotonicity is enforced", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: TEST_DATABASE_URL,
        TRAFFIC_CONGESTION_MEDIUM_OCCUPANCY: "0.5",
        TRAFFIC_CONGESTION_HIGH_OCCUPANCY: "0.3",
      }),
    /non-decreasing/,
  );
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: TEST_DATABASE_URL,
        TRAFFIC_CONGESTION_MEDIUM_SPEED_RATIO: "0.2",
        TRAFFIC_CONGESTION_HIGH_SPEED_RATIO: "0.4",
      }),
    /non-increasing/,
  );
});

test("config: invalid traffic settings are rejected", () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: TEST_DATABASE_URL, TRAFFIC_PERSIST_EVERY_TICKS: "0" }),
    /TRAFFIC_PERSIST_EVERY_TICKS/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: TEST_DATABASE_URL, TRAFFIC_EVENT_INTERVAL_MS: "banana" }),
    /not a number/,
  );
});

test("config: scenario paths are validated against the repo layout", () => {
  const config = loadConfig({ DATABASE_URL: TEST_DATABASE_URL });
  assert.equal(config.scenarioPaths.baseline, SCENARIO_PATHS.baseline);
  assert.equal(config.scenarioPaths.emergency, SCENARIO_PATHS.emergency);
});
