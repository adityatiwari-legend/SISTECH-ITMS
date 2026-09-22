import type { NetworkCatalog } from "../simulation/network-loader.ts";
import type { TraCIConnection } from "../simulation/traci/client.ts";
import { TRACI } from "../simulation/traci/constants.ts";
import { FatalTraCIError } from "../simulation/traci/errors.ts";
import type { VehicleSnapshot, SignalSnapshot } from "@itms/types";
import {
  computeSegmentMetrics,
  computeCitySummary,
  type SegmentMetrics,
  type CitySummary,
  type CongestionThresholds,
} from "./metrics.ts";

/**
 * Traffic collector (Phases.md 2.1).
 *
 * Reads per-segment traffic metrics from the running SUMO simulation via
 * TraCI at a fixed interval (one simulation step) and produces a fully
 * processed TrafficState (Phases.md 2.2/2.3). Values are never fabricated:
 * counts, halting numbers, occupancy and mean speeds are SUMO edge-domain
 * reads; flow rate is derived from observed vehicle edge transitions.
 */

export interface JunctionState {
  junctionId: string;
  controlled: boolean;
  queueLength: number;
  /** Present only for controlled junctions. */
  signal?: {
    id: string;
    program: string;
    state: string;
    phaseIndex: number;
    phaseDurationSeconds: number;
    nextSwitchAtSeconds: number;
  };
}

export interface TrafficState {
  simTimeSeconds: number;
  collectedAtIso: string;
  intervalSeconds: number;
  segments: SegmentMetrics[];
  junctions: JunctionState[];
  summary: CitySummary;
  /** Raw vehicle list for vehicle:update events (from the simulation manager). */
  vehicles: VehicleSnapshot[];
}

interface SegmentContext {
  id: string;
  fromJunction: string;
  toJunction: string;
  laneIds: string[];
  lengthM: number;
  laneCount: number;
  maxSpeedMps: number;
}

interface JunctionContext {
  junctionId: string;
  controlled: boolean;
  signalId: string | null;
  approachLaneIds: string[];
}

const LANE_VARS = [
  TRACI.LAST_STEP_VEHICLE_NUMBER,
  TRACI.LAST_STEP_VEHICLE_HALTING_NUMBER,
  TRACI.LAST_STEP_MEAN_SPEED,
  TRACI.LAST_STEP_OCCUPANCY,
] as const;

export class TrafficCollector {
  private readonly catalog: NetworkCatalog;
  private readonly thresholds: CongestionThresholds;

  private segments: SegmentContext[] = [];
  private junctions: JunctionContext[] = [];

  /** Vehicle edge assignments from the previous collection (flow diffing). */
  private previousVehicleEdges = new Map<string, string>();
  private hadPreviousTick = false;

  constructor(options: { catalog: NetworkCatalog; thresholds: CongestionThresholds }) {
    this.catalog = options.catalog;
    this.thresholds = options.thresholds;
    this.buildContexts(options.catalog);
  }

  private buildContexts(catalog: NetworkCatalog): void {
    this.segments = catalog.segments.map((segment) => ({
      id: segment.id,
      fromJunction: segment.fromJunction,
      toJunction: segment.toJunction,
      laneIds: segment.lanes.map((lane) => lane.id),
      lengthM: segment.lanes.reduce((max, lane) => Math.max(max, lane.lengthM), 0),
      laneCount: segment.lanes.length,
      maxSpeedMps: segment.lanes.reduce((max, lane) => Math.max(max, lane.speedMps), 0),
    }));

    const controlledByJunction = new Map<string, string>();
    for (const signal of catalog.signals) {
      controlledByJunction.set(signal.id, signal.id);
    }
    this.junctions = catalog.junctions.map((junction) => {
      const signalId = controlledByJunction.get(junction.id) ?? null;
      // For signalized junctions the controlled approaches are the lanes in
      // the incLanes set that are also traffic-light controlled.
      const approachLaneIds = junction.incLanes.filter((laneId) => !laneId.startsWith(":"));
      return {
        junctionId: junction.id,
        controlled: signalId !== null,
        signalId,
        approachLaneIds,
      };
    });
  }

  getSegmentIds(): string[] {
    return this.segments.map((segment) => segment.id);
  }

  getApproachLaneIds(): string[] {
    const lanes = new Set<string>();
    for (const junction of this.junctions) {
      for (const laneId of junction.approachLaneIds) {
        lanes.add(laneId);
      }
    }
    return [...lanes];
  }

  /**
   * Performs one collection tick against SUMO and returns the processed
   * traffic state. Must be called right after a simulation step completes.
   */
  async collect(options: {
    client: TraCIConnection;
    simTimeSeconds: number;
    intervalSeconds: number;
    vehicles: VehicleSnapshot[];
    signals: SignalSnapshot[];
  }): Promise<TrafficState> {
    const { client } = options;

    // ---- lane-level reads for approach queues (junction-level) ----
    const approachLaneIds = this.getApproachLaneIds();
    const laneRequests = approachLaneIds.flatMap((laneId) =>
      LANE_VARS.map((varId) => ({ getCmdId: TRACI.CMD_GET_LANE_VARIABLE, varId, objId: laneId })),
    );

    // ---- edge-level reads for segment metrics ----
    const edgeRequests = this.segments.flatMap((segment) =>
      LANE_VARS.map((varId) => ({ getCmdId: TRACI.CMD_GET_EDGE_VARIABLE, varId, objId: segment.id })),
    );

    const laneValues = approachLaneIds.length > 0 ? await client.getValues(laneRequests) : [];
    const edgeValues = await client.getValues(edgeRequests);

    // ---- process lane values into junction approach queues ----
    const haltingByLane = new Map<string, number>();
    approachLaneIds.forEach((laneId, index) => {
      const base = index * LANE_VARS.length;
      const halting = laneValues[base + 1];
      haltingByLane.set(laneId, typeof halting === "number" ? halting : 0);
    });

    // ---- process edge values into segment metrics ----
    const edgeCountByVehicles = new Map<string, string[]>();
    for (const vehicle of options.vehicles) {
      const list = edgeCountByVehicles.get(vehicle.roadId) ?? [];
      list.push(vehicle.id);
      edgeCountByVehicles.set(vehicle.roadId, list);
    }

    // flow: count vehicles whose edge changed since the previous tick
    const passed = new Map<string, number>();
    if (this.hadPreviousTick) {
      for (const vehicle of options.vehicles) {
        const previous = this.previousVehicleEdges.get(vehicle.id);
        if (previous !== undefined && previous !== vehicle.roadId) {
          passed.set(previous, (passed.get(previous) ?? 0) + 1);
        }
      }
    }
    this.previousVehicleEdges = new Map(options.vehicles.map((vehicle) => [vehicle.id, vehicle.roadId]));
    this.hadPreviousTick = true;

    const segmentMetrics: SegmentMetrics[] = this.segments.map((segment, index) => {
      const base = index * LANE_VARS.length;
      const count = requireNumber(edgeValues[base], `edge ${segment.id} count`);
      const halting = requireNumber(edgeValues[base + 1], `edge ${segment.id} halting`);
      const rawMeanSpeed = requireNumber(edgeValues[base + 2], `edge ${segment.id} mean speed`);
      const occupancy = requireNumber(edgeValues[base + 3], `edge ${segment.id} occupancy`);
      // Verified SUMO semantics: edge occupancy is already the mean over the
      // edge's lanes; edge count/halting are lane sums; edge mean speed is
      // the vehicle-weighted mean (speed limit when the edge is empty).
      return computeSegmentMetrics(
        {
          segmentId: segment.id,
          vehicleCount: count,
          // SUMO reports the speed limit for empty edges; gate on count > 0.
          meanSpeedMps: count > 0 ? rawMeanSpeed : 0,
          haltingCount: halting,
          occupancy: clamp01(occupancy),
          lengthM: segment.lengthM,
          laneCount: segment.laneCount,
          freeFlowSpeedMps: segment.maxSpeedMps,
          vehiclesPassed: passed.get(segment.id) ?? 0,
          intervalS: options.intervalSeconds,
        },
        this.thresholds,
      );
    });

    // ---- junction state: queue from approach lanes + signal snapshot ----
    const signalById = new Map(options.signals.map((signal) => [signal.id, signal]));
    const junctionStates: JunctionState[] = this.junctions.map((junction) => {
      const queueLength = junction.approachLaneIds.reduce(
        (sum, laneId) => sum + (haltingByLane.get(laneId) ?? 0),
        0,
      );
      const signal = junction.signalId !== null ? signalById.get(junction.signalId) : undefined;
      return {
        junctionId: junction.junctionId,
        controlled: junction.controlled,
        queueLength,
        ...(signal !== undefined
          ? {
              signal: {
                id: signal.id,
                program: signal.program,
                state: signal.state,
                phaseIndex: signal.phaseIndex,
                phaseDurationSeconds: signal.phaseDurationSeconds,
                nextSwitchAtSeconds: signal.nextSwitchAtSeconds,
              },
            }
          : {}),
      };
    });

    return {
      simTimeSeconds: options.simTimeSeconds,
      collectedAtIso: new Date().toISOString(),
      intervalSeconds: options.intervalSeconds,
      segments: segmentMetrics,
      junctions: junctionStates,
      summary: computeCitySummary(segmentMetrics, options.vehicles.length),
      vehicles: options.vehicles,
    };
  }

  /** Drops flow-diff history when the simulation restarts. */
  reset(): void {
    this.previousVehicleEdges.clear();
    this.hadPreviousTick = false;
  }
}

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FatalTraCIError(`Malformed traffic data: ${what} is not a finite number`);
  }
  return value;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
