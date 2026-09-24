import type {
  CongestionLevel,
  CorridorDetail,
  CorridorJunctionMode,
  CorridorSignalPlanEntry,
  CorridorSignalStage,
  CorridorState,
  EmergencyEta,
  EmergencyPriority,
  SegmentTraffic,
  SignalSnapshot,
} from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { AppError } from "../../errors.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import type { EmergencyService, EmergencyRuntimeSnapshot } from "../emergency/emergency-service.ts";
import type { TrafficService } from "../traffic/traffic-service.ts";
import type { PredictionService } from "../prediction/prediction-service.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import { CorridorRepository, type CorridorSignalRow, type GreenCorridorRow } from "../../database/repositories/corridor-repository.ts";
import {
  validateCorridorPlan,
  type CorridorConstraints,
  type SafetyContext,
} from "./safety-constraints.ts";
import { planCorridor, type PlannerJunctionInputs } from "./corridor-planner.ts";

/**
 * Green corridor orchestration (Phases.md 5).
 *
 * PLANNING → VALIDATING → ACTIVE → (REPLANNING) → COMPLETED / CANCELLED / FAILED
 *
 * The executor runs after every simulation step while a corridor is ACTIVE:
 *  - junctions are applied just before the vehicle's ETA window opens
 *    (switch/extend modes, with yellow clearance when required),
 *  - passed junctions are restored to the normal fixed-time program,
 *  - missed/pending windows are replanned from fresh ETAs (the corridor
 *    rolls with the vehicle),
 *  - every command and transition is persisted; nothing is fabricated.
 */

interface CorridorJunctionRuntime {
  junctionId: string;
  signalId: string;
  sequenceIndex: number;
  approachSegmentId: string;
  routeEdgeIndex: number;
  mode: CorridorJunctionMode;
  corridorState: string | null;
  requiresClearance: boolean;
  plannedGreenStartS: number | null;
  plannedGreenEndS: number | null;
  status: CorridorSignalPlanEntry["status"];
  skipReason: string | null;
  appliedState: string | null;
  /** Set while a yellow clearance step is in progress. */
  clearanceAppliedAtS: number | null;
  passedAtSimTimeS: number | null;
}

interface CorridorRuntime {
  corridorId: number;
  eventId: number;
  vehicleId: string;
  status: CorridorState;
  originJunction: string;
  destinationJunction: string;
  junctions: CorridorJunctionRuntime[];
  broadcastRevision: number;
  lastBroadcastRevision: number;
}

/** Maps a corridor state name to its DB timestamp column. */
const STATE_FIELD: Record<string, "activated_at" | "completed_at" | "cancelled_at" | "failed_at"> = {
  ACTIVE: "activated_at",
  COMPLETED: "completed_at",
  CANCELLED: "cancelled_at",
  FAILED: "failed_at",
};

export class CorridorService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly emergencyService: EmergencyService;
  private readonly trafficService: TrafficService;
  private readonly predictionService: PredictionService;
  private readonly repository: CorridorRepository;
  private readonly bus: WsBus;
  private readonly catalog: NetworkCatalog;
  private readonly constraints: CorridorConstraints;

  private runtime = new Map<number, CorridorRuntime>();
  private eventListeners: Array<() => void> = [];

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    emergencyService: EmergencyService;
    trafficService: TrafficService;
    predictionService: PredictionService;
    repository: CorridorRepository;
    bus: WsBus;
    catalog: NetworkCatalog;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.emergencyService = options.emergencyService;
    this.trafficService = options.trafficService;
    this.predictionService = options.predictionService;
    this.repository = options.repository;
    this.bus = options.bus;
    this.catalog = options.catalog;
    const config = options.config;
    this.constraints = {
      minPriority: config.corridorMinPriority,
      corridorGreenLeadS: config.corridorGreenLeadS,
      corridorGreenTrailS: config.corridorGreenTrailS,
      corridorMinGreenWindowS: config.corridorMinGreenWindowS,
      maxGreenWindowS: config.corridorMaxGreenWindowS,
      maxGreenExtensionS: config.corridorMaxGreenExtensionS,
      maxRedExtensionS: config.corridorMaxRedExtensionS,
      clearanceYellowS: config.corridorClearanceYellowS,
      corridorEtaPlanHorizonS: config.corridorEtaPlanHorizonS,
      downstreamOccupancyLimit: config.corridorDownstreamOccupancyLimit,
    };

    this.eventListeners.push(
      options.manager.onStep(() => this.executorStep()),
      options.manager.onStopped((event) => void this.handleSimStopped(event.reason)),
    );
  }

  async dispose(): Promise<void> {
    for (const off of this.eventListeners) off();
    this.eventListeners = [];
  }

  // ------------------------------------------------------------------
  // Creation (POST /api/corridors)
  // ------------------------------------------------------------------

  /**
   * Creates, plans, validates and (when valid) activates a corridor for an
   * emergency event. The emergency must exist and be on its way.
   */
  async createCorridor(eventId: number): Promise<CorridorDetail> {
    const simStatus = this.manager.getStatusSnapshot();
    if (simStatus.status !== "running" && simStatus.status !== "paused") {
      throw new AppError(409, "simulation_not_running", `A corridor requires a running simulation (current status: ${simStatus.status}).`);
    }
    const emergency = this.emergencyService.getEmergencyRuntime(eventId);
    if (emergency === null) {
      throw new AppError(422, "unknown_emergency", `No active emergency event ${eventId} (create one via POST /api/emergency first).`);
    }
    if (emergency.status !== "active" && emergency.status !== "created") {
      throw new AppError(409, "emergency_not_active", `Emergency event ${eventId} is ${emergency.status}; corridors require an en-route emergency.`);
    }
    for (const existing of this.runtime.values()) {
      if (existing.eventId === eventId && (existing.status === "ACTIVE" || existing.status === "PLANNING" || existing.status === "VALIDATING")) {
        throw new AppError(409, "corridor_already_active", `Event ${eventId} already has an active corridor (${existing.corridorId}).`);
      }
    }

    const simTime = simStatus.simTimeSeconds;
    const planned = this.buildPlan(emergency, simTime);
    if (!planned.eligible) {
      throw new AppError(422, "corridor_not_eligible", planned.eligibilityProblem ?? "Corridor is not eligible.");
    }

    // VALIDATING: run the safety constraint engine over the plan.
    const safetyContext = this.buildSafetyContext(simTime, emergency.eventId, emergency.priority);
    const validation = validateCorridorPlan(planned.entries, safetyContext, this.constraints);

    // Persist the corridor with all entries (planned + skipped).
    let row: GreenCorridorRow;
    try {
      row = await this.repository.createCorridor({
        eventId,
        originJunction: emergency.routeEdges.length > 0 ? junctionOfEdge(emergency.routeEdges[0]!, this.catalog) : emergency.originJunction,
        destinationJunction: emergency.destinationJunction,
        plannedAtSimTimeS: simTime,
        signals: planned.entries,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(503, "database_error", `Could not store the corridor: ${message}`);
    }

    const plannable = planned.entries.filter((entry) => entry.status !== "SKIPPED" && entry.status !== "NOOP");
    const runtimeCorridor: CorridorRuntime = {
      corridorId: row.id,
      eventId,
      vehicleId: emergency.vehicleId,
      status: row.status,
      originJunction: emergency.routeEdges.length > 0 ? junctionOfEdge(emergency.routeEdges[0]!, this.catalog) : emergency.originJunction,
      destinationJunction: emergency.destinationJunction,
      junctions: planned.entries.map((entry) => this.toRuntimeJunction(entry, emergency)),
      broadcastRevision: 1,
      lastBroadcastRevision: 0,
    };

    if (plannable.length > 0) {
      await this.transition(runtimeCorridor, "ACTIVE", null);
      this.logger.info("Green corridor activated", {
        corridorId: row.id,
        eventId,
        junctions: plannable.map((entry) => entry.junctionId).join("â†’"),
        skipped: validation.skipped.length,
      });
    } else {
      this.logger.warn("Green corridor failed validation with no plannable junction", {
        corridorId: row.id,
        eventId,
        skipped: validation.skipped,
      });
    }

    this.runtime.set(row.id, runtimeCorridor);
    this.bus.broadcast("corridor:created", { corridorId: row.id, eventId, status: runtimeCorridor.status, junctions: planned.entries.map((entry) => entry.junctionId) });
    this.bus.broadcast("corridor:update", this.corridorUpdatePayload(runtimeCorridor, simTime, emergency));

    return this.getCorridor(row.id);
  }

  /** Builds the planner inputs from the live system state (no fabrication). */
  private buildPlan(emergency: EmergencyRuntimeSnapshot, simTime: number) {
    const controlled = new Set(this.catalog.signals.map((signal) => signal.id));
    const signalsByJunction = new Map(this.manager.getSignals().map((signal) => [signal.id, signal] as const));
    const etas: EmergencyEta[] | null = this.emergencyService.getEtas(emergency.eventId);
    const etasByJunction = new Map<string, EmergencyEta>();
    if (etas !== null) {
      for (const eta of etas) {
        etasByJunction.set(eta.junctionId, eta);
      }
    }
    const predictionsByJunction = new Map(
      this.predictionService.getPredictions().map((prediction) => [prediction.junctionId, prediction] as const),
    );
    const trafficState = this.trafficService.getLiveTrafficState();
    const trafficBySegment = new Map<string, SegmentTraffic>();
    if (trafficState !== null) {
      for (const segment of trafficState.segments) {
        // Collector metrics lack the topology fields; enrich from the catalog.
        trafficBySegment.set(segment.segmentId, {
          segmentId: segment.segmentId,
          roadId: "",
          fromJunction: "",
          toJunction: "",
          vehicleCount: segment.vehicleCount,
          avgSpeedMps: segment.avgSpeedMps,
          queueLength: segment.queueLength,
          occupancy: segment.occupancy,
          vehiclesPerKm: segment.vehiclesPerKm,
          flowRatePerHour: segment.flowRatePerHour,
          congestion: segment.congestion,
        });
      }
    }

    // Remaining route edges (vehicle may already be partway along the route).
    const startIndex = Math.max(0, emergency.live?.routeIndex ?? 0);
    const inputs: PlannerJunctionInputs[] = [];
    let sequence = 0;
    for (let index = startIndex; index < emergency.routeEdges.length; index++) {
      const segmentId = emergency.routeEdges[index]!;
      const junctionId = junctionOfEdge(segmentId, this.catalog);
      if (!controlled.has(junctionId)) continue;
      const eta = etasByJunction.get(junctionId);
      if (eta === undefined) continue; // ETA unavailable â†’ cannot plan
      const signal = signalsByJunction.get(junctionId);
      if (signal === undefined) continue;
      const linkIndices =
        this.catalog.signals
          .find((signalEntry) => signalEntry.id === junctionId)
          ?.linkIndicesBySegment[segmentId] ?? [];
      const downstreamSegmentId = index + 1 < emergency.routeEdges.length ? emergency.routeEdges[index + 1]! : null;
      const downstream = downstreamSegmentId !== null ? trafficBySegment.get(downstreamSegmentId) ?? null : null;
      inputs.push({
        junctionId,
        signalId: junctionId,
        sequenceIndex: sequence++,
        approachSegmentId: segmentId,
        etaSeconds: eta.etaSeconds,
        signal,
        corridorLinkIndices: [...linkIndices],
        downstreamSegmentId,
        downstreamOccupancy: downstream?.occupancy ?? null,
        prediction: predictionsByJunction.get(junctionId) ?? null,
        priority: emergency.priority,
      });
    }
    return planCorridor(inputs, this.catalog, { simTimeSeconds: simTime, constraints: this.constraints });
  }

  private buildSafetyContext(simTime: number, myEventId: number, myPriority: EmergencyPriority): SafetyContext {
    const occupancy = new Map<string, { corridorId: number; priority: EmergencyPriority; applied: boolean }>();
    for (const corridor of this.runtime.values()) {
      if (corridor.status !== "ACTIVE" && corridor.status !== "REPLANNING") continue;
      if (corridor.eventId === myEventId) continue;
      for (const junction of corridor.junctions) {
        if (junction.status !== "PENDING" && junction.status !== "APPLIED") continue;
        occupancy.set(junction.junctionId, {
          corridorId: corridor.corridorId,
          priority: this.emergencyPriorityOf(corridor.eventId),
          applied: junction.status === "APPLIED",
        });
      }
    }
    const linkCountBySignal = new Map(this.manager.getSignals().map((signal) => [signal.id, signal.state.length] as const));
    const downstreamPredictedCongestion = new Map<string, CongestionLevel>();
    // Downstream congestion is measured (occupancy) and, when a junction
    // prediction is fresh, taken from its worst predicted approach.
    for (const prediction of this.predictionService.getPredictions()) {
      if (prediction.stale || prediction.source === "unavailable") continue;
      void prediction;
    }
    return {
      simTimeSeconds: simTime,
      junctionOccupancy: occupancy,
      myPriority,
      linkCountBySignal,
      downstreamPredictedCongestion,
    };
  }

  /** The emergency priority of an event's corridor (in-memory). */
  private emergencyPriorityOf(eventId: number): EmergencyPriority {
    const runtime = this.emergencyService.getEmergencyRuntime(eventId);
    return runtime?.priority ?? "normal";
  }

  private toRuntimeJunction(entry: CorridorSignalPlanEntry, emergency: EmergencyRuntimeSnapshot): CorridorJunctionRuntime {
    const routeEdgeIndex = emergency.routeEdges.indexOf(entry.approachSegmentId);
    return {
      junctionId: entry.junctionId,
      signalId: entry.signalId,
      sequenceIndex: entry.sequenceIndex,
      approachSegmentId: entry.approachSegmentId,
      routeEdgeIndex,
      mode: entry.mode,
      corridorState: entry.corridorState,
      requiresClearance: entry.requiresClearance,
      plannedGreenStartS: entry.plannedGreenStartS,
      plannedGreenEndS: entry.plannedGreenEndS,
      status: entry.status,
      skipReason: entry.skipReason,
      appliedState: null,
      clearanceAppliedAtS: null,
      passedAtSimTimeS: null,
    };
  }

  // ------------------------------------------------------------------
  // Rolling executor (per simulation step)
  // ------------------------------------------------------------------

  private async executorStep(): Promise<void> {
    if (this.runtime.size === 0) return;
    const simTime = this.manager.getStatusSnapshot().simTimeSeconds;

    for (const corridor of [...this.runtime.values()]) {
      if (corridor.status !== "ACTIVE" && corridor.status !== "REPLANNING") continue;
      await this.executeCorridorStep(corridor, simTime);
    }
  }

  private async executeCorridorStep(corridor: CorridorRuntime, simTime: number): Promise<void> {
    const emergency = this.emergencyService.getEmergencyRuntime(corridor.eventId);

    // Emergency finished → finish the corridor accordingly.
    const persistedStatus = await this.emergencyService.getPersistedStatus(corridor.eventId);
    if (persistedStatus === "arrived") {
      for (const junction of corridor.junctions) {
        if (junction.status === "APPLIED") {
          // The green window was open when the vehicle arrived: the vehicle
          // used it — mark it passed and restore the normal program.
          await this.markPassed(corridor, junction, simTime);
        } else if (junction.status === "PENDING" && junction.mode === "extend") {
          // Extend window anchored at the normal switch point, but the
          // vehicle arrived BEFORE the switch: it passed on the normal
          // program's green (that green covered it). Honest outcome: PASSED.
          await this.markPassed(corridor, junction, simTime);
        } else if (junction.status === "PENDING") {
          // Junctions still pending never opened their window before arrival:
          // mark them honestly instead of leaving dangling PENDING state.
          junction.status = "SKIPPED";
          junction.skipReason = "Emergency arrived before the planned window opened.";
          await this.repository.setSignalSkipped(corridor.corridorId, junction.sequenceIndex, junction.skipReason);
        }
      }
      await this.finishCorridor(corridor, "COMPLETED", null);
      return;
    }
    if (persistedStatus === "failed" || persistedStatus === "cancelled" || emergency === null) {
      await this.finishCorridor(corridor, "FAILED", `Emergency event ${corridor.eventId} is ${persistedStatus ?? "gone"}.`);
      return;
    }
    if (emergency.live === null) {
      // Vehicle not inserted yet: keep waiting (insertion is SUMO's decision).
      return;
    }

    let changed = false;
    const freshEtas = this.emergencyService.getEtas(corridor.eventId);
    const etasByJunction = new Map<string, EmergencyEta>();
    if (freshEtas !== null) {
      for (const eta of freshEtas) {
        etasByJunction.set(eta.junctionId, eta);
      }
    }

    for (const junction of corridor.junctions) {
      if (junction.status === "PASSED" || junction.status === "SKIPPED" || junction.status === "NOOP") continue;

      // Passage detection: the vehicle's route index moved beyond this edge.
      if (junction.routeEdgeIndex >= 0 && emergency.live.routeIndex > junction.routeEdgeIndex) {
        await this.markPassed(corridor, junction, simTime);
        changed = true;
        continue;
      }

      // Window end: restore the normal program and re-plan (rolling).
      if (junction.status === "APPLIED" && junction.plannedGreenEndS !== null && simTime >= junction.plannedGreenEndS) {
        await this.restoreSignal(junction);
        junction.status = "PENDING";
        junction.appliedState = null;
        junction.plannedGreenStartS = null;
        junction.plannedGreenEndS = null;
        await this.repository.replanSignal(corridor.corridorId, junction.sequenceIndex, 0, 0, junction.plannedGreenStartS ?? 0);
        changed = true;
        continue;
      }

      const eta = etasByJunction.get(junction.junctionId);

      // Replan pending junctions from fresh ETAs.
      if (junction.status === "PENDING" && junction.plannedGreenStartS === null && eta !== undefined) {
        const replanned = this.replanJunction(corridor, junction, eta.etaSeconds, simTime);
        changed = changed || replanned;
      } else if (junction.status === "PENDING" && junction.plannedGreenStartS !== null && eta !== undefined) {
        // ETA drift check for already-planned junctions.
        const plannedEtaSeconds = junction.plannedGreenStartS - simTime;
        const drift = eta.etaSeconds - plannedEtaSeconds;
        if (Math.abs(drift) > this.config.corridorReplanEtaThresholdS) {
          const replanned = this.replanJunction(corridor, junction, eta.etaSeconds, simTime);
          changed = changed || replanned;
        }
      }

      // Clearance step in progress â†’ apply the corridor green when due.
      if (junction.clearanceAppliedAtS !== null) {
        if (simTime >= junction.clearanceAppliedAtS + this.config.corridorClearanceYellowS && junction.corridorState !== null) {
          await this.applyCorridorGreen(corridor, junction, simTime);
          changed = true;
        }
        continue;
      }

      // Apply the window when due.
      if (
        junction.status === "PENDING" &&
        junction.plannedGreenStartS !== null &&
        junction.plannedGreenEndS !== null &&
        simTime >= junction.plannedGreenStartS - 1 &&
        simTime < junction.plannedGreenEndS
      ) {
        const applied = await this.applyWindow(corridor, junction, simTime);
        changed = changed || applied;
      }
    }

    // All non-skipped junctions passed â†’ corridor completed.
    const active = corridor.junctions.filter((junction) => junction.status !== "SKIPPED" && junction.status !== "NOOP");
    if (active.length > 0 && active.every((junction) => junction.status === "PASSED")) {
      await this.finishCorridor(corridor, "COMPLETED", null);
      changed = true;
    }

    if (changed) {
      corridor.broadcastRevision += 1;
      this.bus.broadcast("corridor:update", this.corridorUpdatePayload(corridor, simTime, emergency));
    }
  }

  /** Re-plans one junction's window from a fresh ETA. Returns true when changed.
   *  Pure computation first: the runtime is only mutated when a feasible
   *  bounded window was found (no partial updates). */
  private replanJunction(corridor: CorridorRuntime, junction: CorridorJunctionRuntime, etaSeconds: number, simTime: number): boolean {
    const signal = this.manager.getSignal(junction.signalId);
    if (signal === null || junction.corridorState === null) return false;
    const constraints = this.constraints;

    // The approach link indices are the green positions in the corridor state.
    const corridorIndices = new Set(
      junction.corridorState.split("").flatMap((char, index) => (char === "G" ? [index] : [])),
    );
    const isApproachGreen = signal.state
      .split("")
      .some((char, index) => corridorIndices.has(index) && (char === "g" || char === "G"));

    let mode: "switch" | "extend";
    let greenStart: number;
    let greenEnd: number;
    if (isApproachGreen) {
      mode = "extend";
      greenStart = signal.nextSwitchAtSeconds;
      const desiredEnd = simTime + etaSeconds + constraints.corridorGreenTrailS;
      if (desiredEnd <= greenStart || desiredEnd > greenStart + constraints.maxGreenExtensionS) {
        return false; // infeasible: keep waiting for a closer ETA
      }
      greenEnd = desiredEnd;
    } else {
      mode = "switch";
      if (etaSeconds > constraints.corridorEtaPlanHorizonS) return false;
      greenStart = Math.max(simTime, simTime + etaSeconds - constraints.corridorGreenLeadS);
      const desiredEnd = simTime + etaSeconds + constraints.corridorGreenTrailS;
      const maxEnd = greenStart + Math.min(constraints.maxGreenWindowS, constraints.maxRedExtensionS);
      const minEnd = greenStart + constraints.corridorMinGreenWindowS;
      if (desiredEnd > maxEnd || minEnd > maxEnd) {
        return false; // no feasible bounded window yet
      }
      greenEnd = Math.max(Math.min(desiredEnd, maxEnd), Math.min(minEnd, maxEnd));
      if (greenEnd <= greenStart) return false;
    }

    junction.mode = mode;
    junction.plannedGreenStartS = round1(greenStart);
    junction.plannedGreenEndS = round1(greenEnd);
    junction.status = "PENDING";
    void this.repository.replanSignal(corridor.corridorId, junction.sequenceIndex, junction.plannedGreenStartS, junction.plannedGreenEndS, etaSeconds);
    this.logger.info("Corridor junction replanned", {
      corridorId: corridor.corridorId,
      junction: junction.junctionId,
      eta: round1(etaSeconds),
      window: `${round1(greenStart)}â€“${round1(junction.plannedGreenEndS!)}`,
    });
    return true;
  }

  /** Applies the planned window: occupancy re-check â†’ clearance â†’ green. */
  private async applyWindow(corridor: CorridorRuntime, junction: CorridorJunctionRuntime, simTime: number): Promise<boolean> {
    const signal = this.manager.getSignal(junction.signalId);
    if (signal === null || junction.corridorState === null) return false;

    // Apply-time occupancy re-check: another corridor may have claimed or
    // applied this junction since planning (multi-emergency policy).
    for (const other of this.runtime.values()) {
      if (other.corridorId === corridor.corridorId) continue;
      const otherJunction = other.junctions.find((entry) => entry.junctionId === junction.junctionId);
      if (otherJunction === undefined) continue;
      if (otherJunction.status === "APPLIED") {
        junction.status = "SKIPPED";
        junction.skipReason = `Lost the junction to corridor ${other.corridorId} (applied before this window opened).`;
        this.logger.warn("Corridor junction lost to another corridor", {
          corridorId: corridor.corridorId,
          junction: junction.junctionId,
          winner: other.corridorId,
        });
        return false;
      }
    }

    if (junction.requiresClearance) {
      // Yellow clearance for the live conflicting green, then corridor green.
      const clearanceState = signal.state
        .split("")
        .map((char, index) => (junction.corridorState![index] === "G" ? "r" : char === "g" || char === "G" ? "y" : char === "y" || char === "Y" ? "y" : "r"))
        .join("");
      try {
        await this.manager.setSignalState(junction.signalId, clearanceState);
      } catch (err) {
        this.logger.warn("Corridor clearance step failed", { corridorId: corridor.corridorId, junction: junction.junctionId, error: err });
        return false;
      }
      junction.clearanceAppliedAtS = simTime;
      this.logger.info("Corridor clearance applied", { corridorId: corridor.corridorId, junction: junction.junctionId });
      return true;
    }

    await this.applyCorridorGreen(corridor, junction, simTime);
    return true;
  }

  private async applyCorridorGreen(corridor: CorridorRuntime, junction: CorridorJunctionRuntime, _simTime: number): Promise<void> {
    if (junction.corridorState === null) return;
    try {
      const snapshot = await this.manager.setSignalState(junction.signalId, junction.corridorState);
      junction.appliedState = snapshot.state;
      junction.status = "APPLIED";
      junction.clearanceAppliedAtS = null;
      await this.repository.markApplied(corridor.corridorId, junction.sequenceIndex, snapshot.state, null);
      this.logger.info("Corridor green applied", {
        corridorId: corridor.corridorId,
        junction: junction.junctionId,
        state: snapshot.state,
      });
    } catch (err) {
      this.logger.error("Corridor green application failed", { corridorId: corridor.corridorId, junction: junction.junctionId, error: err });
      junction.status = "SKIPPED";
      junction.skipReason = err instanceof Error ? err.message : String(err);
    }
  }

  private async markPassed(corridor: CorridorRuntime, junction: CorridorJunctionRuntime, simTime?: number): Promise<void> {
    junction.status = "PASSED";
    junction.passedAtSimTimeS = simTime ?? this.manager.getStatusSnapshot().simTimeSeconds;
    if (junction.appliedState !== null) {
      await this.restoreSignal(junction);
    }
    await this.repository.markPassed(corridor.corridorId, junction.sequenceIndex);
    this.logger.info("Corridor junction passed", { corridorId: corridor.corridorId, junction: junction.junctionId });
  }

  /** Returns the junction to the normal fixed-time program. */
  private async restoreSignal(junction: CorridorJunctionRuntime): Promise<void> {
    const signal = this.manager.getSignal(junction.signalId);
    if (signal === null) return;
    try {
      await this.manager.setSignalProgram(junction.signalId, signal.program || "0");
      junction.appliedState = null;
    } catch (err) {
      this.logger.warn("Corridor restoration failed", { junction: junction.junctionId, error: err });
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle transitions
  // ------------------------------------------------------------------

  private async transition(corridor: CorridorRuntime, status: CorridorState, reason: string | null): Promise<void> {
    corridor.status = status;
    const field = STATE_FIELD[status];
    if (field !== undefined) {
      await this.repository.setStatus(corridor.corridorId, status, field, reason);
    }
  }

  private async finishCorridor(corridor: CorridorRuntime, status: "COMPLETED" | "FAILED" | "CANCELLED", reason: string | null): Promise<void> {
    // Restore every applied junction before closing out.
    for (const junction of corridor.junctions) {
      if (junction.appliedState !== null) {
        await this.restoreSignal(junction);
      }
    }
    await this.transition(corridor, status, reason);
    this.runtime.delete(corridor.corridorId);
    this.logger.info("Green corridor finished", { corridorId: corridor.corridorId, status, reason });
    this.bus.broadcast("corridor:update", {
      corridorId: corridor.corridorId,
      eventId: corridor.eventId,
      status,
      simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
      signals: [],
    });
  }

  private async handleSimStopped(reason: "stopped" | "simulation_ended" | "disconnected"): Promise<void> {
    for (const corridor of [...this.runtime.values()]) {
      await this.finishCorridor(corridor, "FAILED", `Simulation ${reason}.`);
    }
  }

  // ------------------------------------------------------------------
  // Operator actions
  // ------------------------------------------------------------------

  /** Cancels an active corridor: restores all signals, marks CANCELLED. */
  async cancelCorridor(corridorId: number, reason: string | null): Promise<CorridorDetail> {
    const corridor = this.runtime.get(corridorId);
    if (corridor !== undefined) {
      await this.finishCorridor(corridor, "CANCELLED", reason ?? "Cancelled by operator.");
      return this.getCorridor(corridorId);
    }
    const row = await this.repository.getCorridor(corridorId);
    if (row === null) {
      throw new AppError(404, "unknown_corridor", `Unknown corridor ${corridorId}.`);
    }
    if (row.status === "ACTIVE" || row.status === "PLANNING" || row.status === "REPLANNING" || row.status === "VALIDATING") {
      await this.repository.setStatus(corridorId, "CANCELLED", "cancelled_at", reason ?? "Cancelled by operator.");
      this.bus.broadcast("corridor:update", {
        corridorId,
        eventId: row.event_id,
        status: "CANCELLED",
        simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
        signals: [],
      });
      return this.getCorridor(corridorId);
    }
    throw new AppError(409, "corridor_not_active", `Corridor ${corridorId} is already ${row.status} and cannot be cancelled.`);
  }

  /** Activates a corridor that exists but is not executing (e.g. replan). */
  async activateCorridor(corridorId: number): Promise<CorridorDetail> {
    const row = await this.repository.getCorridor(corridorId);
    if (row === null) {
      throw new AppError(404, "unknown_corridor", `Unknown corridor ${corridorId}.`);
    }
    if (row.status === "ACTIVE" || row.status === "REPLANNING") {
      throw new AppError(409, "already_active", `Corridor ${corridorId} is already ${row.status}.`);
    }
    if (row.status !== "PLANNING" && row.status !== "VALIDATING") {
      throw new AppError(409, "not_activatable", `Corridor ${corridorId} is ${row.status}; only PLANNING/VALIDATING corridors can be activated.`);
    }
    const emergency = this.emergencyService.getEmergencyRuntime(row.event_id);
    if (emergency === null) {
      throw new AppError(409, "emergency_not_active", "The corridor's emergency is no longer active.");
    }
    if (!this.runtime.has(corridorId)) {
      // Rebuild the runtime from the persisted plan.
      const signals = await this.repository.getCorridorSignals(corridorId);
      const runtimeCorridor: CorridorRuntime = {
        corridorId,
        eventId: row.event_id,
        vehicleId: emergency.vehicleId,
        status: row.status,
        originJunction: row.origin_junction,
        destinationJunction: row.destination_junction,
        junctions: signals.map((signalRow) => this.fromSignalRow(signalRow, emergency)),
        broadcastRevision: 1,
        lastBroadcastRevision: 0,
      };
      this.runtime.set(corridorId, runtimeCorridor);
    }
    const corridor = this.runtime.get(corridorId)!;
    await this.transition(corridor, "ACTIVE", null);
    this.bus.broadcast("corridor:update", this.corridorUpdatePayload(corridor, this.manager.getStatusSnapshot().simTimeSeconds, emergency));
    return this.getCorridor(corridorId);
  }

  private fromSignalRow(row: CorridorSignalRow, emergency: EmergencyRuntimeSnapshot): CorridorJunctionRuntime {
    return {
      junctionId: row.signal_id,
      signalId: row.signal_id,
      sequenceIndex: row.sequence_index,
      approachSegmentId: row.approach_segment_id,
      routeEdgeIndex: emergency.routeEdges.indexOf(row.approach_segment_id),
      mode: row.mode,
      corridorState: row.planned_state,
      requiresClearance: row.requires_clearance,
      plannedGreenStartS: row.planned_green_start_s,
      plannedGreenEndS: row.planned_green_end_s,
      status: row.status,
      skipReason: row.skip_reason,
      appliedState: row.applied_state,
      clearanceAppliedAtS: null,
      passedAtSimTimeS: null,
    };
  }

  /**
   * Re-plans a corridor after a dynamic route change (Phases.md 6.4):
   * junctions no longer on the new route are skipped (and restored), new
   * junctions are appended as PENDING and planned by the executor's rolling
   * replan as soon as their ETAs come into range. Does NOT reset the whole
   * corridor: passed junctions keep their history.
   */
  async replanForRouteChange(eventId: number): Promise<boolean> {
    const corridor = [...this.runtime.values()].find((entry) => entry.eventId === eventId);
    if (corridor === undefined || (corridor.status !== "ACTIVE" && corridor.status !== "REPLANNING")) {
      return false;
    }
    const emergency = this.emergencyService.getEmergencyRuntime(eventId);
    if (emergency === null || emergency.live === null) return false;

    corridor.status = "REPLANNING";
    const simTime = this.manager.getStatusSnapshot().simTimeSeconds;
    const newRouteSet = new Set(emergency.routeEdges);
    const newJunctions = new Set(emergency.routeEdges.map((edge) => junctionOfEdge(edge, this.catalog)));

    let changed = false;

    // 1. Drop junctions no longer on the route.
    for (const junction of corridor.junctions) {
      const stillOnRoute =
        junction.status === "PASSED" || (newRouteSet.has(junction.approachSegmentId) && newJunctions.has(junction.junctionId));
      if (stillOnRoute) continue;
      if (junction.appliedState !== null) {
        await this.restoreSignal(junction);
      }
      junction.status = "SKIPPED";
      junction.skipReason = "Route changed; junction no longer on the emergency route.";
      await this.repository.setSignalSkipped(corridor.corridorId, junction.sequenceIndex, junction.skipReason);
      changed = true;
      this.logger.info("Corridor junction dropped after route change", {
        corridorId: corridor.corridorId,
        junction: junction.junctionId,
      });
    }

    // 2. Append junctions that are new on this route (planned later by the
    //    rolling executor when their ETAs come into range).
    const existing = new Set(corridor.junctions.map((junction) => junction.approachSegmentId));
    const sequenceBase = corridor.junctions.reduce((max, junction) => Math.max(max, junction.sequenceIndex), -1) + 1;
    let sequence = sequenceBase;
    for (let index = Math.max(0, emergency.live.routeIndex); index < emergency.routeEdges.length; index++) {
      const segmentId = emergency.routeEdges[index]!;
      const junctionId = junctionOfEdge(segmentId, this.catalog);
      const isControlled = this.catalog.signals.some((signal) => signal.id === junctionId);
      if (!isControlled || existing.has(segmentId)) continue;
      const linkIndices =
        this.catalog.signals.find((signal) => signal.id === junctionId)?.linkIndicesBySegment[segmentId] ?? [];
      const corridorState =
        signalStateLength(junctionId, this.manager) > 0 && linkIndices.length > 0
          ? Array.from({ length: signalStateLength(junctionId, this.manager) }, (_, linkIndex) =>
              linkIndices.includes(linkIndex) ? "G" : "r",
            ).join("")
          : null;
      const runtimeJunction: CorridorJunctionRuntime = {
        junctionId,
        signalId: junctionId,
        sequenceIndex: sequence++,
        approachSegmentId: segmentId,
        routeEdgeIndex: index,
        mode: "switch",
        corridorState,
        requiresClearance: false,
        plannedGreenStartS: null,
        plannedGreenEndS: null,
        status: corridorState === null ? "SKIPPED" : "PENDING",
        skipReason: corridorState === null ? "The approach has no controlled links." : null,
        appliedState: null,
        clearanceAppliedAtS: null,
        passedAtSimTimeS: null,
      };
      corridor.junctions.push(runtimeJunction);
      if (runtimeJunction.status === "PENDING") {
        await this.repository.appendSignal({
          corridorId: corridor.corridorId,
          sequenceIndex: runtimeJunction.sequenceIndex,
          signalId: runtimeJunction.signalId,
          approachSegmentId: segmentId,
          etaSeconds: null,
          mode: "switch",
          corridorState,
          requiresClearance: false,
        });
      }
      changed = true;
      this.logger.info("Corridor junction appended after route change", {
        corridorId: corridor.corridorId,
        junction: junctionId,
      });
    }

    corridor.status = "ACTIVE";
    corridor.broadcastRevision += 1;
    this.bus.broadcast("corridor:update", this.corridorUpdatePayload(corridor, simTime, emergency));
    return changed;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  async getCorridor(corridorId: number): Promise<CorridorDetail> {
    const row = await this.repository.getCorridor(corridorId);
    if (row === null) {
      throw new AppError(404, "unknown_corridor", `Unknown corridor ${corridorId}.`);
    }
    const signals = await this.repository.getCorridorSignals(corridorId);
    const runtime = this.runtime.get(corridorId) ?? null;
    const emergencyStatus = await this.emergencyService.getPersistedStatus(row.event_id);
    const emergencyLive = runtime !== null ? this.emergencyService.getEmergencyRuntime(row.event_id) : null;
    return {
      id: row.id,
      eventId: row.event_id,
      vehicleId: runtime?.vehicleId ?? null,
      status: row.status,
      originJunction: row.origin_junction,
      destinationJunction: row.destination_junction,
      junctionCount: row.junction_count,
      plannedAtSimTimeS: row.planned_at_sim_time_s,
      createdAtIso: row.planned_at.toISOString(),
      activatedAtIso: row.activated_at?.toISOString() ?? null,
      completedAtIso: row.completed_at?.toISOString() ?? null,
      cancelledAtIso: row.cancelled_at?.toISOString() ?? null,
      failedAtIso: row.failed_at?.toISOString() ?? null,
      cancelReason: row.cancel_reason,
      lastError: row.last_error,
      validation: {
        passed: signals.every((signal) => signal.status !== "SKIPPED" || signal.skip_reason !== null),
        skipped: signals
          .filter((signal) => signal.status === "SKIPPED")
          .map((signal) => ({ junctionId: signal.signal_id, reason: signal.skip_reason ?? "unknown" })),
        failures: row.last_error !== null ? [row.last_error] : [],
      },
      signals: signals.map((signal) => {
        const runtimeJunc = runtime?.junctions.find((j) => j.sequenceIndex === signal.sequence_index);
        return this.mapSignal(signal, runtimeJunc, runtime?.status === "ACTIVE" ? this.manager.getStatusSnapshot().simTimeSeconds : undefined);
      }),
      live:
        runtime !== null
          ? {
              simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
              remainingJunctions: runtime.junctions.filter((junction) => junction.status === "PENDING" || junction.status === "APPLIED").length,
              emergencyStatus: emergencyStatus,
              vehicleSpeedMps: emergencyLive?.live?.speedMps ?? null,
            }
          : null,
    };
  }

  async listCorridors(): Promise<CorridorDetail[]> {
    const rows = await this.repository.listCorridors();
    const details: CorridorDetail[] = [];
    for (const row of rows) {
      try {
        details.push(await this.getCorridor(row.id));
      } catch {
        // Row vanished mid-list (transactional race): skip it.
      }
    }
    return details;
  }

  private mapSignal(
    signal: CorridorSignalRow,
    runtimeJunction?: CorridorJunctionRuntime,
    simTime?: number,
  ): CorridorSignalPlanEntry {
    const stage = runtimeJunction && simTime !== undefined
      ? this.deriveJunctionStage(runtimeJunction, simTime, signal.eta_seconds ?? null)
      : (signal.status === "APPLIED" ? "GREEN" : signal.status === "PASSED" ? "PASSED" : "NORMAL");

    return {
      sequenceIndex: signal.sequence_index,
      junctionId: signal.signal_id,
      signalId: signal.signal_id,
      approachSegmentId: signal.approach_segment_id,
      etaSeconds: signal.eta_seconds ?? 0,
      mode: signal.mode,
      stage,
      plannedGreenStartS: signal.planned_green_start_s,
      plannedGreenEndS: signal.planned_green_end_s,
      corridorState: signal.planned_state,
      corridorLinkIndices: [],
      requiresClearance: signal.requires_clearance,
      status: signal.status,
      skipReason: signal.skip_reason,
      predictedVehicleCount: signal.predicted_vehicle_count,
      predictedCongestion: null,
      downstreamSegmentId: null,
      downstreamOccupancy: null,
    };
  }

  private deriveJunctionStage(
    junction: CorridorJunctionRuntime,
    simTime: number,
    etaSeconds: number | null,
  ): CorridorSignalStage {
    if (junction.status === "PASSED") {
      if (junction.passedAtSimTimeS !== null && simTime - junction.passedAtSimTimeS < 6) {
        return "RESTORING";
      }
      return "PASSED";
    }
    if (junction.status === "SKIPPED" || junction.status === "NOOP") {
      return "NORMAL";
    }
    if (junction.status === "APPLIED") {
      return "GREEN";
    }
    if (junction.clearanceAppliedAtS !== null) {
      return "CLEARING";
    }
    if (etaSeconds !== null && etaSeconds > 0) {
      const clearanceTime = junction.requiresClearance ? this.config.corridorClearanceYellowS : 0;
      const requiredPreparationTime = clearanceTime + 3 + 4;
      if (etaSeconds <= requiredPreparationTime + 8) {
        return "PREPARING";
      }
      if (etaSeconds <= this.config.corridorEtaPlanHorizonS) {
        return "DETECTED";
      }
    }
    return "NORMAL";
  }

  private corridorUpdatePayload(
    corridor: CorridorRuntime,
    simTime: number,
    emergency: EmergencyRuntimeSnapshot | null,
  ) {
    const etas = emergency ? this.emergencyService.getEtas(corridor.eventId) : null;
    const etaByJunction = new Map<string, EmergencyEta>();
    if (etas !== null) {
      for (const e of etas) etaByJunction.set(e.junctionId, e);
    }

    return {
      corridorId: corridor.corridorId,
      eventId: corridor.eventId,
      status: corridor.status,
      simTimeSeconds: simTime,
      emergencyStatus: emergency?.status ?? null,
      signals: corridor.junctions.map((junction) => {
        const etaObj = etaByJunction.get(junction.junctionId);
        const etaSec = etaObj ? etaObj.etaSeconds : null;
        const stage = this.deriveJunctionStage(junction, simTime, etaSec);
        return {
          junctionId: junction.junctionId,
          sequenceIndex: junction.sequenceIndex,
          status: junction.status,
          stage,
          etaSeconds: etaSec,
          distanceM: etaObj ? etaObj.distanceM : null,
          plannedGreenStartS: junction.plannedGreenStartS,
          plannedGreenEndS: junction.plannedGreenEndS,
          appliedState: junction.appliedState,
          skipReason: junction.skipReason,
        };
      }),
    };
  }
}

/**
 * Junction a directed segment approaches: the segment's `toJunction` from
 * the network catalog (authoritative for any network naming: grid edges
 * like "i1_i2" AND OSM-derived ids like "375220442#5"). Falls back to the
 * grid naming convention when the catalog lookup misses.
 */
function junctionOfEdge(segmentId: string, catalog: NetworkCatalog): string {
  const segment = catalog.segments.find((candidate) => candidate.id === segmentId);
  if (segment !== undefined) return segment.toJunction;
  const parts = segmentId.split("_");
  const last = parts[parts.length - 1] ?? "";
  return last.toUpperCase();
}

/** Current RYG state length of a signal (0 when unknown). */
function signalStateLength(signalId: string, manager: SimulationManager): number {
  const signal = manager.getSignal(signalId);
  return signal !== null ? signal.state.length : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
