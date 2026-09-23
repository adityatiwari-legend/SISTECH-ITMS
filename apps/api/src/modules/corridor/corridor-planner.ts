import type {
  CongestionLevel,
  CorridorSignalPlanEntry,
  EmergencyPriority,
  JunctionPrediction,
  SignalSnapshot,
} from "@itms/types";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import type { CorridorConstraints } from "./safety-constraints.ts";
import { checkEmergencyPriority } from "./safety-constraints.ts";

/**
 * Corridor planner (Phases.md 5.1-5.4).
 *
 * Deterministic: from the emergency route it extracts the remaining
 * controlled junctions and, for each, computes a green window from
 *  - the emergency ETA (Phase 3 route engine, congestion-adjusted),
 *  - the junction's current signal state and next switch time (SUMO),
 *  - predicted traffic near the ETA horizon (Phase 4, informational +
 *    downstream checks),
 *  - the downstream segment occupancy (spillback prevention).
 *
 * Modes:
 *  - "switch": approach is red → corridor green at the window start (with a
 *    yellow clearance step when a conflicting green is live).
 *  - "extend": approach is green but the normal program would switch too
 *    early → corridor green held past the normal switch point.
 *  - "noop": normal green already covers the ETA → no command needed.
 *  - PENDING: ETA beyond the feasibility/horizon bounds → planned later
 *    when the vehicle is closer (this is what makes the corridor roll).
 */

export interface PlannerJunctionInputs {
  junctionId: string;
  signalId: string;
  sequenceIndex: number;
  approachSegmentId: string;
  etaSeconds: number;
  signal: SignalSnapshot;
  /** Traffic-light link indices of the approach at this junction. */
  corridorLinkIndices: number[];
  downstreamSegmentId: string | null;
  downstreamOccupancy: number | null;
  prediction: JunctionPrediction | null;
  priority: EmergencyPriority;
}

export interface PlannerContext {
  simTimeSeconds: number;
  constraints: CorridorConstraints;
}

export interface PlannerResult {
  eligible: boolean;
  eligibilityProblem: string | null;
  entries: CorridorSignalPlanEntry[];
}

function isGreenChar(char: string | undefined): boolean {
  return char === "g" || char === "G";
}

function isYellowChar(char: string | undefined): boolean {
  return char === "y" || char === "Y";
}

/** Predicted approach count at the horizon closest to the ETA (null: unavailable). */
export function predictedCountAtEta(prediction: JunctionPrediction | null, etaSeconds: number): number | null {
  if (prediction === null || prediction.stale || prediction.source === "unavailable") return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const horizon of prediction.horizons) {
    const distance = Math.abs(horizon.horizonSeconds - etaSeconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = horizon.predictedVehicleCount;
    }
  }
  return best;
}

/**
 * Builds the corridor plan for the given junctions (in route order).
 * Every value is computed from the inputs; nothing is hard-coded.
 */
export function planCorridor(
  junctionInputs: PlannerJunctionInputs[],
  catalog: NetworkCatalog,
  context: PlannerContext,
): PlannerResult {
  const { constraints, simTimeSeconds } = context;
  const priorityCheck =
    junctionInputs.length > 0
      ? checkEmergencyPriority(junctionInputs[0]!.priority, constraints)
      : { ok: false as const, reason: "No corridor junctions identified on the remaining route." };
  if (!priorityCheck.ok) {
    return { eligible: false, eligibilityProblem: priorityCheck.reason ?? null, entries: [] };
  }

  const entries: CorridorSignalPlanEntry[] = junctionInputs.map((input) => {
    const linkCountByState = input.signal.state.length;
    const corridorSet = new Set(input.corridorLinkIndices);
    const corridorState =
      linkCountByState > 0 && corridorSet.size > 0
        ? Array.from({ length: linkCountByState }, (_, index) => (corridorSet.has(index) ? "G" : "r")).join("")
        : null;

    const entry: CorridorSignalPlanEntry = {
      sequenceIndex: input.sequenceIndex,
      junctionId: input.junctionId,
      signalId: input.signalId,
      approachSegmentId: input.approachSegmentId,
      etaSeconds: round1(input.etaSeconds),
      mode: "switch",
      plannedGreenStartS: null,
      plannedGreenEndS: null,
      corridorState,
      corridorLinkIndices: [...input.corridorLinkIndices],
      requiresClearance: false,
      status: "PENDING",
      skipReason: null,
      predictedVehicleCount: predictedCountAtEta(input.prediction, input.etaSeconds),
      predictedCongestion: null,
      downstreamSegmentId: input.downstreamSegmentId,
      downstreamOccupancy: input.downstreamOccupancy,
    };

    if (corridorState === null) {
      entry.status = "SKIPPED";
      entry.skipReason = "The approach has no traffic-light controlled links at this junction.";
      return entry;
    }

    const state = input.signal.state;
    const approachGreen = input.corridorLinkIndices.some((index) => isGreenChar(state[index]));
    const conflictingLiveGreen = state
      .split("")
      .some((char, index) => !corridorSet.has(index) && isGreenChar(char));
    const yellowActive = state.split("").some((char) => isYellowChar(char));
    const nextSwitch = input.signal.nextSwitchAtSeconds;

    if (approachGreen) {
      const timeToSwitch = nextSwitch - simTimeSeconds;
      if (timeToSwitch >= input.etaSeconds + constraints.corridorGreenTrailS) {
        // The normal green already covers the arrival window.
        entry.mode = "noop";
        entry.status = "NOOP";
        entry.plannedGreenStartS = simTimeSeconds;
        entry.plannedGreenEndS = nextSwitch;
        return entry;
      }
      // Extend: corridor green held from the natural switch point until the
      // vehicle has passed (bounded by the extension limit).
      const extensionStart = nextSwitch;
      const desiredEnd = simTimeSeconds + input.etaSeconds + constraints.corridorGreenTrailS;
      const maxEnd = extensionStart + constraints.maxGreenExtensionS;
      if (desiredEnd > maxEnd + 1e-6) {
        // Cannot cover the arrival within the extension bound yet: plan
        // later when the vehicle is closer.
        entry.mode = "switch";
        entry.status = "PENDING";
        return entry;
      }
      entry.mode = "extend";
      entry.plannedGreenStartS = extensionStart;
      entry.plannedGreenEndS = Math.max(desiredEnd, extensionStart);
      entry.status = "PENDING";
      return entry;
    }

    // Approach not green: switch mode.
    if (input.etaSeconds > constraints.corridorEtaPlanHorizonS) {
      entry.status = "PENDING"; // planned later (rolling corridor)
      return entry;
    }

    let greenStart = Math.max(
      simTimeSeconds,
      simTimeSeconds + input.etaSeconds - constraints.corridorGreenLeadS,
    );

    if (conflictingLiveGreen) {
      if (nextSwitch > greenStart) {
        // A conflicting green is live and would be cut: schedule a yellow
        // clearance step first (never an instant cut).
        entry.requiresClearance = true;
      } else {
        // The program ends that green before the corridor green opens.
        greenStart = Math.max(greenStart, nextSwitch);
      }
    } else if (yellowActive) {
      // The program's own yellow is running; open after it completes.
      greenStart = Math.max(greenStart, nextSwitch);
    }

    const desiredEnd = simTimeSeconds + input.etaSeconds + constraints.corridorGreenTrailS;
    const minEnd = greenStart + constraints.corridorMinGreenWindowS;
    const maxEnd = greenStart + Math.min(constraints.maxGreenWindowS, constraints.maxRedExtensionS);
    if (minEnd > maxEnd + 1e-6) {
      // No feasible bounded window for this ETA yet.
      entry.status = "PENDING";
      return entry;
    }
    entry.mode = "switch";
    entry.plannedGreenStartS = round1(greenStart);
    entry.plannedGreenEndS = round1(Math.max(Math.min(desiredEnd, maxEnd), Math.min(minEnd, maxEnd)));
    entry.status = "PENDING";
    return entry;
  });

  return { eligible: true, eligibilityProblem: null, entries };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
