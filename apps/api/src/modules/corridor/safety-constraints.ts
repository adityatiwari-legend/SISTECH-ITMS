import type {
  CongestionLevel,
  CorridorSignalPlanEntry,
  CorridorValidationSummary,
  EmergencyPriority,
} from "@itms/types";
import { priorityRank } from "../../database/repositories/corridor-repository.ts";

/**
 * Safety constraint engine (Phases.md 5.5, Architecture.md 13, Rules.md 7/8).
 *
 * Every corridor signal plan must pass these explicit, deterministic checks
 * before any signal command is issued. Checks are pure functions over the
 * plan + measured/predicted context. A failing junction is SKIPPED (keeps
 * its normal program); a failing emergency-eligibility check fails the
 * whole corridor. The engine never invents signal states and never allows
 * unrestricted green.
 */

export interface CorridorConstraints {
  /** Minimum emergency priority eligible for corridors. */
  minPriority: EmergencyPriority;
  /** Green window opens this many seconds before the ETA. */
  corridorGreenLeadS: number;
  /** Green window extends this many seconds past the ETA. */
  corridorGreenTrailS: number;
  corridorMinGreenWindowS: number;
  /** Maximum total corridor-green duration at one junction. */
  maxGreenWindowS: number;
  /** Maximum extra green beyond the normal program's switch point. */
  maxGreenExtensionS: number;
  /** Maximum time cross-traffic approaches may be held red. */
  maxRedExtensionS: number;
  /** Yellow clearance duration inserted before cutting a live green. */
  clearanceYellowS: number;
  /** Junctions with ETA beyond this horizon are planned later (rolling). */
  corridorEtaPlanHorizonS: number;
  /** Downstream occupancy above which corridor green is blocked. */
  downstreamOccupancyLimit: number;
}

export interface SafetyContext {
  simTimeSeconds: number;
  /**
   * Junctions currently claimed by another ACTIVE corridor (pending or
   * applied), with that corridor's emergency priority. The conflict policy
   * (explicit, documented):
   *  - APPLIED by another corridor → always skip (never override a live
   *    signal override),
   *  - PENDING by another corridor with HIGHER priority → skip (yield),
   *  - PENDING by another corridor with lower/equal priority → may take
   *    over; the other corridor re-checks occupancy at apply time.
   */
  junctionOccupancy: Map<string, { corridorId: number; priority: EmergencyPriority; applied: boolean }>;
  /** Priority of the emergency this plan belongs to. */
  myPriority: EmergencyPriority;
  /** Traffic-light link count per signal (state length must match). */
  linkCountBySignal: Map<string, number>;
  /**
   * Predicted congestion of the downstream segment at the relevant horizon
   * (null: prediction unavailable — check falls back to measured occupancy).
   */
  downstreamPredictedCongestion: Map<string, CongestionLevel>;
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

/** 1. Emergency eligibility: the emergency must have sufficient priority. */
export function checkEmergencyPriority(
  priority: EmergencyPriority,
  constraints: CorridorConstraints,
): CheckResult {
  if (priorityRank(priority) >= priorityRank(constraints.minPriority)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Emergency priority "${priority}" is below the corridor minimum "${constraints.minPriority}".`,
  };
}

/** 2. Green window bounds per mode (switch/extend/noop). */
export function checkGreenWindow(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
  constraints: CorridorConstraints,
): CheckResult {
  if (entry.mode === "noop" || entry.status === "NOOP") return { ok: true };
  if (entry.plannedGreenStartS === null || entry.plannedGreenEndS === null) {
    // PENDING entries are planned later; they are valid interim states.
    return { ok: true };
  }
  if (entry.plannedGreenStartS < context.simTimeSeconds - 1e-6) {
    return { ok: false, reason: "Green window starts in the past." };
  }
  if (entry.plannedGreenEndS <= entry.plannedGreenStartS) {
    return { ok: false, reason: "Green window is empty." };
  }
  const duration = entry.plannedGreenEndS - entry.plannedGreenStartS;
  if (duration > constraints.maxGreenWindowS + 1e-6) {
    return {
      ok: false,
      reason: `Corridor green window (${duration.toFixed(1)}s) exceeds the maximum (${constraints.maxGreenWindowS}s).`,
    };
  }
  if (entry.mode === "extend") {
    // Extension is measured beyond the normal program's switch point; the
    // planner encodes nextSwitch in the window start for extend mode.
    const extension = entry.plannedGreenEndS - entry.plannedGreenStartS;
    if (extension > constraints.maxGreenExtensionS + 1e-6) {
      return {
        ok: false,
        reason: `Green extension (${extension.toFixed(1)}s) exceeds the maximum (${constraints.maxGreenExtensionS}s).`,
      };
    }
  }
  return { ok: true };
}

/** 3. Maximum red extension for cross-traffic approaches. */
export function checkRedExtension(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
  constraints: CorridorConstraints,
): CheckResult {
  if (entry.mode === "noop" || entry.status === "NOOP") return { ok: true };
  if (entry.plannedGreenStartS === null || entry.plannedGreenEndS === null) return { ok: true };
  const redDuration = entry.plannedGreenEndS - entry.plannedGreenStartS;
  if (redDuration > constraints.maxRedExtensionS + 1e-6) {
    return {
      ok: false,
      reason: `Cross-traffic red extension (${redDuration.toFixed(1)}s) exceeds the maximum (${constraints.maxRedExtensionS}s).`,
    };
  }
  return { ok: true };
}

/**
 * 4. Clearance transition: cutting a live conflicting green requires a
 * yellow clearance step (never an instant G→r jump for cross traffic).
 */
export function checkClearance(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
  constraints: CorridorConstraints,
): CheckResult {
  if (entry.mode !== "switch" || entry.status === "NOOP") return { ok: true };
  if (!entry.requiresClearance) return { ok: true };
  if (constraints.clearanceYellowS < 1) {
    return { ok: false, reason: "Clearance required but the configured yellow time is below 1s." };
  }
  return { ok: true };
}

/**
 * 5. Corridor state sanity: the planned RYG string must have exactly the
 * signal's link count and give green ONLY to the corridor approach links
 * (all other movements red). This makes the plan conflict-free by
 * construction and forbids "all green" plans.
 */
export function checkCorridorState(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
): CheckResult {
  if (entry.mode === "noop" || entry.status === "NOOP") return { ok: true };
  if (entry.corridorState === null) {
    if (entry.status === "PENDING") return { ok: true };
    return { ok: false, reason: "Planned corridor state is missing." };
  }
  const linkCount = context.linkCountBySignal.get(entry.signalId);
  if (linkCount === undefined) {
    return { ok: false, reason: `Unknown traffic light "${entry.signalId}".` };
  }
  if (entry.corridorState.length !== linkCount) {
    return {
      ok: false,
      reason: `Corridor state length ${entry.corridorState.length} does not match the signal's ${linkCount} links.`,
    };
  }
  const corridorSet = new Set(entry.corridorLinkIndices);
  if (corridorSet.size === 0) {
    return { ok: false, reason: "Corridor approach has no controlled links." };
  }
  for (let index = 0; index < entry.corridorState.length; index++) {
    const char = entry.corridorState[index]!;
    if (corridorSet.has(index)) {
      if (char !== "G" && char !== "g") {
        return { ok: false, reason: `Corridor link ${index} is not green in the planned state.` };
      }
    } else if (char !== "r") {
      return {
        ok: false,
        reason: `Non-corridor link ${index} must be red in the corridor state (got "${char}"); conflicting movements may never be green.`,
      };
    }
  }
  return { ok: true };
}

/**
 * 6. Queue spillback / downstream capacity: corridor green may not push
 * traffic into a jammed downstream segment.
 */
export function checkDownstreamCapacity(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
  constraints: CorridorConstraints,
): CheckResult {
  if (entry.mode === "noop" || entry.status === "NOOP") return { ok: true };
  if (entry.downstreamSegmentId === null) return { ok: true }; // route end
  if (entry.downstreamOccupancy !== null && entry.downstreamOccupancy > constraints.downstreamOccupancyLimit) {
    return {
      ok: false,
      reason: `Downstream segment ${entry.downstreamSegmentId} occupancy ${(entry.downstreamOccupancy * 100).toFixed(0)}% exceeds the spillback limit.`,
    };
  }
  const predicted = context.downstreamPredictedCongestion.get(entry.downstreamSegmentId);
  if (predicted === "CRITICAL") {
    return {
      ok: false,
      reason: `Downstream segment ${entry.downstreamSegmentId} is predicted CRITICAL congested.`,
    };
  }
  return { ok: true };
}

/** 7. Corridor conflict: explicit priority policy (see SafetyContext). */
export function checkCorridorConflict(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
): CheckResult {
  const occupancy = context.junctionOccupancy.get(entry.junctionId);
  if (occupancy === undefined) return { ok: true };
  if (occupancy.applied) {
    return {
      ok: false,
      reason: `Junction ${entry.junctionId} is actively commanded by corridor ${occupancy.corridorId}; a live override is never replaced.`,
    };
  }
  if (priorityRank(occupancy.priority) > priorityRank(context.myPriority)) {
    return {
      ok: false,
      reason: `Junction ${entry.junctionId} is claimed by the higher-priority emergency of corridor ${occupancy.corridorId} (${occupancy.priority}); yielding.`,
    };
  }
  // Pending claim of equal/lower priority: this corridor may take over;
  // the other corridor re-checks occupancy before applying.
  return { ok: true };
}

/**
 * 8. Pedestrian / off-program fairness bound: while the corridor overrides
 * the junction's normal program, cross-traffic and pedestrian-equivalent
 * service is delayed. The override must be bounded (window within the red
 * extension limit) and the corridor always restores the normal program
 * (which contains the clearance phases) at window end or on passage.
 * This network currently models no pedestrian signals (documented); the
 * check enforces the bounded-override guarantee that pedestrian phases
 * would rely on.
 */
export function checkPedestrianAccommodation(
  entry: CorridorSignalPlanEntry,
  context: SafetyContext,
  constraints: CorridorConstraints,
): CheckResult {
  if (entry.mode === "noop" || entry.status === "NOOP") return { ok: true };
  if (entry.plannedGreenStartS === null || entry.plannedGreenEndS === null) return { ok: true };
  // The junction is off-program for the override window (start → end) plus
  // the restoration clearance.
  const offProgramS = entry.plannedGreenEndS - Math.max(entry.plannedGreenStartS, context.simTimeSeconds) + constraints.clearanceYellowS;
  if (offProgramS > constraints.maxRedExtensionS + constraints.clearanceYellowS + 1e-6) {
    return {
      ok: false,
      reason: `Junction ${entry.junctionId} would stay off-program for ${offProgramS.toFixed(1)}s, exceeding the safety bound.`,
    };
  }
  return { ok: true };
}

/** Runs all per-junction checks; returns the validation summary. */
export function validateCorridorPlan(
  entries: CorridorSignalPlanEntry[],
  context: SafetyContext,
  constraints: CorridorConstraints,
): CorridorValidationSummary {
  const skipped: Array<{ junctionId: string; reason: string }> = [];
  const failures: string[] = [];
  for (const entry of entries) {
    const checks: Array<() => CheckResult> = [
      () => checkGreenWindow(entry, context, constraints),
      () => checkRedExtension(entry, context, constraints),
      () => checkClearance(entry, context, constraints),
      () => checkCorridorState(entry, context),
      () => checkDownstreamCapacity(entry, context, constraints),
      () => checkCorridorConflict(entry, context),
      () => checkPedestrianAccommodation(entry, context, constraints),
    ];
    for (const check of checks) {
      const result = check();
      if (!result.ok) {
        if (entry.status !== "SKIPPED") {
          entry.status = "SKIPPED";
          entry.skipReason = result.reason ?? "Safety constraint violated";
        }
        break;
      }
    }
    if (entry.status === "SKIPPED" && entry.skipReason !== null) {
      skipped.push({ junctionId: entry.junctionId, reason: entry.skipReason });
    }
  }
  return { passed: failures.length === 0, skipped, failures };
}
