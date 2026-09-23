import { test } from "node:test";
import assert from "node:assert/strict";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { NETWORK_PATH } from "./helpers.ts";
import type { CongestionLevel, CorridorSignalPlanEntry, EmergencyEta, JunctionPrediction, SignalSnapshot } from "@itms/types";
import {
  planCorridor,
  predictedCountAtEta,
  type PlannerJunctionInputs,
} from "../src/modules/corridor/corridor-planner.ts";
import {
  validateCorridorPlan,
  checkEmergencyPriority,
  checkCorridorState,
  checkDownstreamCapacity,
  type CorridorConstraints,
  type SafetyContext,
} from "../src/modules/corridor/safety-constraints.ts";

const catalog = await loadNetworkCatalog(NETWORK_PATH);
const CONSTRAINTS: CorridorConstraints = {
  minPriority: "normal",
  corridorGreenLeadS: 5,
  corridorGreenTrailS: 12,
  corridorMinGreenWindowS: 8,
  maxGreenWindowS: 30,
  maxGreenExtensionS: 20,
  maxRedExtensionS: 45,
  clearanceYellowS: 3,
  corridorEtaPlanHorizonS: 60,
  downstreamOccupancyLimit: 0.85,
};

const SIM_TIME = 100;

function signalFixture(overrides: Partial<SignalSnapshot> = {}): SignalSnapshot {
  return {
    id: "I2",
    program: "0",
    state: "GGGgrrrrGGGgrrrr",
    phaseIndex: 0,
    phaseDurationSeconds: 42,
    nextSwitchAtSeconds: SIM_TIME + 20,
    queueLength: 0,
    controlledLanes: [],
    ...overrides,
  };
}

function etaFixture(junctionId: string, etaSeconds: number): EmergencyEta {
  return { junctionId, etaSeconds, distanceM: 200, isDestination: false };
}

function predictionFixture(overrides: Partial<JunctionPrediction> = {}): JunctionPrediction {
  return {
    junctionId: "I2",
    basedOnSimTimeSeconds: SIM_TIME - 2,
    computedAtIso: new Date().toISOString(),
    source: "ml",
    modelVersion: "v1",
    horizons: [
      { horizonSeconds: 30, predictedVehicleCount: 12 },
      { horizonSeconds: 60, predictedVehicleCount: 18 },
      { horizonSeconds: 90, predictedVehicleCount: 20 },
      { horizonSeconds: 120, predictedVehicleCount: 15 },
    ],
    stale: false,
    lastError: null,
    ...overrides,
  };
}

function inputFixture(overrides: Partial<PlannerJunctionInputs> = {}): PlannerJunctionInputs {
  // i1_i2 arrives at I2; the corridor links for i1_i2 at I2 are 12..15
  // (verified from the net.xml connections).
  return {
    junctionId: "I2",
    signalId: "I2",
    sequenceIndex: 0,
    approachSegmentId: "i1_i2",
    etaSeconds: 15,
    signal: signalFixture(),
    corridorLinkIndices: [12, 13, 14, 15],
    downstreamSegmentId: "i2_i3",
    downstreamOccupancy: 0.1,
    prediction: predictionFixture(),
    priority: "critical",
    ...overrides,
  };
}

const CONTEXT = { simTimeSeconds: SIM_TIME, constraints: CONSTRAINTS };

test("planner: red approach with near ETA plans a bounded switch window", () => {
  const input = inputFixture({
    signal: signalFixture({ state: "rrrrrrrrrrrrrrrr", nextSwitchAtSeconds: SIM_TIME + 10 }),
    etaSeconds: 15,
  });
  const result = planCorridor([input], catalog, CONTEXT);
  assert.equal(result.eligible, true);
  const entry = result.entries[0]!;
  assert.equal(entry.mode, "switch");
  assert.equal(entry.status, "PENDING");
  // window: start = max(simTime, simTime + 15 - 5) = 110; end ≈ simTime + 15 + 12 = 127
  assert.equal(entry.plannedGreenStartS, 110);
  assert.ok(entry.plannedGreenEndS! <= 110 + 30, "window within max duration");
  assert.ok(entry.plannedGreenEndS! >= 110 + 8, "window at least min duration");
  assert.equal(entry.requiresClearance, false);
  // corridor state: green only on links 12..15
  assert.equal(entry.corridorState, "rrrrrrrrrrrrGGGG");
});

test("planner: ETA beyond horizon leaves the junction PENDING (rolling)", () => {
  const input = inputFixture({ etaSeconds: 120 });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.status, "PENDING");
  assert.equal(entry.plannedGreenStartS, null);
  assert.equal(entry.mode, "switch");
});

test("planner: normal green covering the arrival needs no command", () => {
  // corridor links green and nextSwitch at +60 >= eta(15) + trail(12) => noop
  const input = inputFixture({
    signal: signalFixture({ state: "rrrrrrrrrrrrGGGG", nextSwitchAtSeconds: SIM_TIME + 60 }),
  });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.mode, "noop");
  assert.equal(entry.status, "NOOP");
});

test("planner: green about to expire plans an extension", () => {
  // corridor links green; nextSwitch at +8 < eta(15) + trail(12) => extend
  const input = inputFixture({
    signal: signalFixture({ state: "rrrrrrrrrrrrGGGG", nextSwitchAtSeconds: SIM_TIME + 8 }),
  });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.mode, "extend");
  assert.equal(entry.plannedGreenStartS, SIM_TIME + 8);
  // desired end = 100+15+12 = 127; extension 19 <= max 20 OK
  assert.equal(entry.plannedGreenEndS, 127);
});

test("planner: extension beyond the limit stays PENDING for later replan", () => {
  // eta too far to cover within the extension bound
  const input = inputFixture({
    etaSeconds: 55,
    signal: signalFixture({ state: "rrrrrrrrrrrrGGGG", nextSwitchAtSeconds: SIM_TIME + 10 }),
  });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.status, "PENDING");
  assert.equal(entry.plannedGreenStartS, null);
});

test("planner: live conflicting green schedules a yellow clearance", () => {
  // conflicting links green (0..11), corridor approach red (12..15)
  const input = inputFixture({
    signal: signalFixture({ nextSwitchAtSeconds: SIM_TIME + 30 }),
    etaSeconds: 10,
  });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.mode, "switch");
  assert.equal(entry.requiresClearance, true);
});

test("planner: active yellow defers the corridor green past the switch", () => {
  const input = inputFixture({
    signal: signalFixture({ state: "yyyyrrrryyyyrrrr", nextSwitchAtSeconds: SIM_TIME + 3 }),
    etaSeconds: 10,
  });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.requiresClearance, false);
  // greenStart = max(eta-lead bound = 105, after yellow = 103) = 105
  assert.equal(entry.plannedGreenStartS, SIM_TIME + 5);
});

test("planner: priority below minimum makes the corridor ineligible", () => {
  // default min priority "normal": all three priorities are eligible
  for (const priority of ["normal", "high", "critical"] as const) {
    const result = planCorridor([inputFixture({ priority })], catalog, CONTEXT);
    assert.equal(result.eligible, true, priority);
  }
  // min "high": normal is rejected, high/critical pass
  const highMin = { ...CONTEXT, constraints: { ...CONSTRAINTS, minPriority: "high" as const } };
  assert.equal(planCorridor([inputFixture({ priority: "normal" })], catalog, highMin).eligible, false);
  assert.equal(planCorridor([inputFixture({ priority: "high" })], catalog, highMin).eligible, true);
  // min "critical": only critical passes
  const criticalMin = { ...CONTEXT, constraints: { ...CONSTRAINTS, minPriority: "critical" as const } };
  const rejected = planCorridor([inputFixture({ priority: "high" })], catalog, criticalMin);
  assert.equal(rejected.eligible, false);
  assert.match(rejected.eligibilityProblem ?? "", /priority/);
});

test("planner: predicted count at the ETA horizon is the nearest bucket", () => {
  assert.equal(predictedCountAtEta(predictionFixture(), 15), 12); // nearest: 30s
  assert.equal(predictedCountAtEta(predictionFixture(), 50), 18); // nearest: 60s
  assert.equal(predictedCountAtEta(predictionFixture({ stale: true }), 15), null);
  assert.equal(predictedCountAtEta(predictionFixture({ source: "unavailable" }), 15), null);
  assert.equal(predictedCountAtEta(null, 15), null);
});

test("planner: junction without controlled links for the approach is skipped", () => {
  const input = inputFixture({ corridorLinkIndices: [] });
  const result = planCorridor([input], catalog, CONTEXT);
  const entry = result.entries[0]!;
  assert.equal(entry.status, "SKIPPED");
  assert.match(entry.skipReason ?? "", /no traffic-light controlled links/);
});

// ---------------------------------------------------------------------------
// Safety constraint engine
// ---------------------------------------------------------------------------

const SAFETY_CONTEXT: SafetyContext = {
  simTimeSeconds: SIM_TIME,
  junctionOccupancy: new Map([
    ["I4", { corridorId: 2, priority: "critical" as const, applied: false }],
  ]),
  myPriority: "critical" as const,
  linkCountBySignal: new Map([["I2", 16]]),
  downstreamPredictedCongestion: new Map<string, CongestionLevel>(),
};

test("safety: corridor state must be exactly the link count and green-only-corridor", () => {
  const ok = inputFixture();
  const planned = planCorridor([ok], catalog, CONTEXT).entries[0]!;
  assert.equal(checkCorridorState(planned, SAFETY_CONTEXT).ok, true);

  const wrongLength = { ...planned, corridorState: "r".repeat(15) } as CorridorSignalPlanEntry;
  assert.equal(checkCorridorState(wrongLength, SAFETY_CONTEXT).ok, false);

  // A conflicting link green (all-green plan) must be rejected.
  const allGreen = { ...planned, corridorState: "G".repeat(16) } as CorridorSignalPlanEntry;
  const result = checkCorridorState(allGreen, SAFETY_CONTEXT);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /must be red/);
});

test("safety: green window bounds are enforced", () => {
  const constraints = CONSTRAINTS;
  const context = SAFETY_CONTEXT;
  const base = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  assert.equal(validateCorridorPlan([base], context, constraints).skipped.length, 0);

  const past = { ...base, mode: "switch" as const, plannedGreenStartS: SIM_TIME - 5, plannedGreenEndS: SIM_TIME + 10 } as CorridorSignalPlanEntry;
  const pastResult = validateCorridorPlan([past], context, constraints);
  assert.ok(pastResult.skipped.some((s) => /past/.test(s.reason)));

  const empty = { ...base, mode: "switch" as const, plannedGreenStartS: SIM_TIME + 10, plannedGreenEndS: SIM_TIME + 10 } as CorridorSignalPlanEntry;
  assert.ok(validateCorridorPlan([empty], context, constraints).skipped.some((s) => /empty/.test(s.reason)));

  const tooLong = { ...base, mode: "switch" as const, plannedGreenStartS: SIM_TIME + 1, plannedGreenEndS: SIM_TIME + 100 } as CorridorSignalPlanEntry;
  const tooLongResult = validateCorridorPlan([tooLong], context, constraints);
  assert.ok(tooLongResult.skipped.some((s) => /exceeds the maximum/.test(s.reason)));
});

test("safety: cross-traffic red extension bound", () => {
  // With maxGreenWindowS=60 and maxRedExtensionS=25, a 30s window is a valid
  // green window but exceeds the red extension bound.
  const entry = {
    ...planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!,
    mode: "switch" as const,
    plannedGreenStartS: SIM_TIME + 1,
    plannedGreenEndS: SIM_TIME + 31,
  } as CorridorSignalPlanEntry;
  const redBoundConfig: CorridorConstraints = { ...CONSTRAINTS, maxGreenWindowS: 60, maxRedExtensionS: 25 };
  const result = validateCorridorPlan([entry], SAFETY_CONTEXT, redBoundConfig);
  assert.ok(result.skipped.some((s) => /red extension/.test(s.reason)));
});

test("safety: downstream spillback and predicted CRITICAL block the junction", () => {
  const jammed = planCorridor(
    [inputFixture({ downstreamOccupancy: 0.9 })],
    catalog,
    CONTEXT,
  ).entries[0]!;
  const jammedResult = validateCorridorPlan([jammed], SAFETY_CONTEXT, CONSTRAINTS);
  assert.ok(jammedResult.skipped.some((s) => /spillback limit/.test(s.reason)));

  // predicted CRITICAL downstream
  const entry = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  const criticalContext: SafetyContext = {
    ...SAFETY_CONTEXT,
    downstreamPredictedCongestion: new Map([["i2_i3", "CRITICAL" as CongestionLevel]]),
  };
  const direct = checkDownstreamCapacity(entry, criticalContext, CONSTRAINTS);
  assert.equal(direct.ok, false);
  assert.match(direct.reason ?? "", /CRITICAL/);
});

test("safety: junction occupied by another corridor follows the priority policy", () => {
  // NOTE: validateCorridorPlan mutates entry.status on failure, so each case
  // plans a fresh entry.
  const appliedContext: SafetyContext = {
    ...SAFETY_CONTEXT,
    junctionOccupancy: new Map([
      ["I2", { corridorId: 2, priority: "normal" as const, applied: true }],
    ]),
  };
  const appliedEntry = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  const appliedResult = validateCorridorPlan([appliedEntry], appliedContext, CONSTRAINTS);
  assert.ok(appliedResult.skipped.some((s) => /never replaced/.test(s.reason)));

  // Pending by a HIGHER priority → yield.
  const yieldContext: SafetyContext = {
    ...SAFETY_CONTEXT,
    junctionOccupancy: new Map([
      ["I2", { corridorId: 2, priority: "critical" as const, applied: false }],
    ]),
    myPriority: "high" as const,
  };
  const yieldEntry = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  const yieldResult = validateCorridorPlan([yieldEntry], yieldContext, CONSTRAINTS);
  assert.ok(yieldResult.skipped.some((s) => /yielding/.test(s.reason)));

  // Pending by a LOWER priority (and I'm higher) → may take over.
  const preemptContext: SafetyContext = {
    ...SAFETY_CONTEXT,
    junctionOccupancy: new Map([
      ["I2", { corridorId: 2, priority: "normal" as const, applied: false }],
    ]),
    myPriority: "critical" as const,
  };
  const preemptEntry = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  const preemptResult = validateCorridorPlan([preemptEntry], preemptContext, CONSTRAINTS);
  assert.ok(preemptResult.skipped.every((s) => !/corridor/.test(s.reason)));
});

test("safety: emergency priority check", () => {
  assert.equal(checkEmergencyPriority("critical", CONSTRAINTS).ok, true);
  assert.equal(checkEmergencyPriority("high", CONSTRAINTS).ok, true);
  assert.equal(checkEmergencyPriority("normal", CONSTRAINTS).ok, true);
  assert.equal(
    checkEmergencyPriority("normal", { ...CONSTRAINTS, minPriority: "high" }).ok,
    false,
  );
});

test("safety: validateCorridorPlan skips failing junctions and passes good ones", () => {
  const good = planCorridor([inputFixture()], catalog, CONTEXT).entries[0]!;
  const bad = { ...good, sequenceIndex: 1, junctionId: "I4", plannedGreenStartS: SIM_TIME + 1, plannedGreenEndS: SIM_TIME + 200, mode: "switch" as const } as CorridorSignalPlanEntry;
  const result = validateCorridorPlan([good, bad], SAFETY_CONTEXT, CONSTRAINTS);
  assert.equal(result.failures.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]!.junctionId, "I4");
  assert.equal(good.status, "PENDING");
  assert.equal(bad.status, "SKIPPED");
});
