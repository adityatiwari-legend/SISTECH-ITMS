import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSegmentMetrics,
  classifyCongestion,
  computeCitySummary,
  DEFAULT_CONGESTION_THRESHOLDS,
  type SegmentMetricsInput,
} from "../src/modules/traffic/metrics.ts";

function input(overrides: Partial<SegmentMetricsInput> = {}): SegmentMetricsInput {
  return {
    segmentId: "i1_i2",
    vehicleCount: 10,
    meanSpeedMps: 8.0,
    haltingCount: 3,
    occupancy: 0.2,
    lengthM: 200,
    laneCount: 2,
    freeFlowSpeedMps: 13.89,
    vehiclesPassed: 5,
    intervalS: 1,
    ...overrides,
  };
}

test("segment metrics: vehicle count passes through", () => {
  const metrics = computeSegmentMetrics(input({ vehicleCount: 7 }));
  assert.equal(metrics.vehicleCount, 7);
});

test("segment metrics: average speed is computed only with traffic", () => {
  const occupied = computeSegmentMetrics(input({ vehicleCount: 4, meanSpeedMps: 9.5 }));
  assert.equal(occupied.avgSpeedMps, 9.5);
  const empty = computeSegmentMetrics(input({ vehicleCount: 0, meanSpeedMps: 13.89, haltingCount: 0 }));
  assert.equal(empty.avgSpeedMps, 0);
  assert.equal(empty.congestion, "LOW");
});

test("segment metrics: queue length equals halting count", () => {
  const metrics = computeSegmentMetrics(input({ haltingCount: 5 }));
  assert.equal(metrics.queueLength, 5);
});

test("segment metrics: density derived from length and lanes", () => {
  const metrics = computeSegmentMetrics(input({ vehicleCount: 10, lengthM: 200, laneCount: 2 }));
  // 10 vehicles / 0.2 km / 2 lanes = 25 vehicles per km per lane
  assert.equal(metrics.vehiclesPerKm, 25);
});

test("segment metrics: flow rate from edge transitions", () => {
  const metrics = computeSegmentMetrics(input({ vehiclesPassed: 5, intervalS: 1 }));
  // 5 vehicles in 1 s => 18000 veh/h
  assert.equal(metrics.flowRatePerHour, 18000);
  const slow = computeSegmentMetrics(input({ vehiclesPassed: 1, intervalS: 4 }));
  assert.equal(slow.flowRatePerHour, 900);
  assert.equal(computeSegmentMetrics(input({ vehiclesPassed: 0 })).flowRatePerHour, 0);
});

test("segment metrics: speed ratio is avg speed / free-flow", () => {
  const metrics = computeSegmentMetrics(input({ meanSpeedMps: 6.945 }));
  assert.ok(Math.abs(metrics.speedRatio - 0.5) < 0.001);
});

test("congestion classification: thresholds produce the four levels", () => {
  const t = DEFAULT_CONGESTION_THRESHOLDS;
  assert.equal(classifyCongestion({ occupancy: 0.02, speedRatio: 1.0, queueLength: 0 }, t), "LOW");
  assert.equal(classifyCongestion({ occupancy: 0.2, speedRatio: 0.9, queueLength: 3 }, t), "MEDIUM");
  assert.equal(classifyCongestion({ occupancy: 0.35, speedRatio: 0.5, queueLength: 7 }, t), "HIGH");
  assert.equal(classifyCongestion({ occupancy: 0.5, speedRatio: 0.3, queueLength: 13 }, t), "CRITICAL");
});

test("congestion classification: any single signal can trigger a level", () => {
  const t = DEFAULT_CONGESTION_THRESHOLDS;
  // occupancy alone
  assert.equal(classifyCongestion({ occupancy: 0.5, speedRatio: 1.0, queueLength: 0 }, t), "CRITICAL");
  // speed ratio alone
  assert.equal(classifyCongestion({ occupancy: 0.0, speedRatio: 0.1, queueLength: 0 }, t), "CRITICAL");
  // queue alone
  assert.equal(classifyCongestion({ occupancy: 0.0, speedRatio: 1.0, queueLength: 14 }, t), "CRITICAL");
});

test("congestion classification: zero speed with traffic is critical", () => {
  assert.equal(
    classifyCongestion({ occupancy: 0.1, speedRatio: 0, queueLength: 10 }, DEFAULT_CONGESTION_THRESHOLDS),
    "CRITICAL",
  );
});

test("segment metrics validate impossible inputs", () => {
  assert.throws(() => computeSegmentMetrics(input({ vehicleCount: -1 })));
  assert.throws(() => computeSegmentMetrics(input({ haltingCount: 11, vehicleCount: 10 })));
  assert.throws(() => computeSegmentMetrics(input({ occupancy: 1.5 })));
  assert.throws(() => computeSegmentMetrics(input({ lengthM: 0 })));
  assert.throws(() => computeSegmentMetrics(input({ laneCount: 0 })));
  assert.throws(() => computeSegmentMetrics(input({ freeFlowSpeedMps: 0 })));
});

test("city summary aggregates segments", () => {
  const segments = [
    computeSegmentMetrics(input({ segmentId: "a", vehicleCount: 10, meanSpeedMps: 10, haltingCount: 0, occupancy: 0.1 })),
    computeSegmentMetrics(input({ segmentId: "b", vehicleCount: 10, meanSpeedMps: 2, haltingCount: 8, occupancy: 0.4 })),
    computeSegmentMetrics(input({ segmentId: "c", vehicleCount: 0, haltingCount: 0 })),
  ];
  const summary = computeCitySummary(segments, 20);
  assert.equal(summary.vehicleCount, 20);
  assert.equal(summary.totalQueueLength, 8);
  // weighted speed: (10*10 + 2*10) / 20 = 6
  assert.ok(Math.abs(summary.avgSpeedMps - 6) < 0.001);
  assert.equal(summary.criticalSegments, 1);
  assert.equal(summary.congestedSegments, 1);
  assert.equal(summary.cityLevel, "CRITICAL");
});

test("city summary with no traffic is LOW", () => {
  const summary = computeCitySummary(
    [computeSegmentMetrics(input({ vehicleCount: 0, haltingCount: 0, meanSpeedMps: 13.89 }))],
    0,
  );
  assert.equal(summary.cityLevel, "LOW");
  assert.equal(summary.avgSpeedMps, 0);
});
