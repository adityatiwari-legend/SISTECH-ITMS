/**
 * Shared types for ITMS (Intelligent Traffic Management System).
 *
 * Phase 1 scope: simulation status, vehicle and traffic-signal snapshots
 * read from SUMO via TraCI, plus the API error envelope.
 */

/** Lifecycle status of the simulation manager. */
export type SimulationStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "stopping"
  | "error"
  | "completed";

/** Scenario identifiers. Each maps to its own SUMO configuration file. */
export type SimulationScenarioId = "baseline" | "emergency";

/** A single vehicle as observed in the SUMO simulation at a point in time. */
export interface VehicleSnapshot {
  id: string;
  /** SUMO vehicle type id (e.g. "car", "bus", "emergency"). */
  typeId: string;
  /** Position in SUMO network coordinates (meters). */
  positionX: number;
  positionY: number;
  /** Current speed in m/s. */
  speed: number;
  /** Current road (edge) id. */
  roadId: string;
  /** Current lane id. */
  laneId: string;
  /** Position along the current lane in meters. */
  lanePosition: number;
}

/**
 * A traffic signal as observed in the SUMO simulation.
 *
 * Field semantics follow SUMO TraCI (traffic light domain):
 * - `phaseDurationSeconds` is the TOTAL duration of the current phase.
 * - `nextSwitchAtSeconds` is the ABSOLUTE simulation time of the next switch.
 * - `state` is the red/yellow/green string, one char per controlled link.
 */
export interface SignalSnapshot {
  id: string;
  program: string;
  state: string;
  phaseIndex: number;
  phaseDurationSeconds: number;
  nextSwitchAtSeconds: number;
  /**
   * Number of halted vehicles across the distinct approach lanes controlled
   * by this signal, as measured by SUMO in the last simulation step.
   */
  queueLength: number;
  controlledLanes: string[];
}

/** Aggregated status of the simulation manager. */
export interface SimulationStatusSnapshot {
  status: SimulationStatus;
  scenario: SimulationScenarioId | null;
  simTimeSeconds: number;
  stepLengthSeconds: number;
  vehicleCount: number;
  signalCount: number;
  departedVehicleCount: number | null;
  arrivedVehicleCount: number | null;
  sumoVersion: string | null;
  traciApiVersion: number | null;
  startedAtIso: string | null;
  lastError: string | null;
}

/** Consistent error body returned by all API endpoints. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — traffic intelligence types
// ---------------------------------------------------------------------------

export type CongestionLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Processed traffic metrics for one directed road segment. */
export interface SegmentTraffic {
  segmentId: string;
  roadId: string;
  fromJunction: string;
  toJunction: string;
  vehicleCount: number;
  avgSpeedMps: number;
  queueLength: number;
  occupancy: number;
  vehiclesPerKm: number;
  flowRatePerHour: number;
  congestion: CongestionLevel;
}

/** Processed traffic metrics for one intersection. */
export interface IntersectionTraffic {
  junctionId: string;
  controlled: boolean;
  queueLength: number;
  signal: {
    id: string;
    program: string;
    state: string;
    phaseIndex: number;
    phaseDurationSeconds: number;
    nextSwitchAtSeconds: number;
  } | null;
}

/** City-wide aggregate. */
export interface CityTrafficSummary {
  vehicleCount: number;
  avgSpeedMps: number;
  totalQueueLength: number;
  congestedSegments: number;
  criticalSegments: number;
  cityLevel: CongestionLevel;
}

/** Static road registry entry (from the SUMO network, stored in PostgreSQL). */
export interface RoadInfo {
  id: string;
  name: string;
  fromJunction: string;
  toJunction: string;
  segments: Array<{
    id: string;
    laneCount: number;
    lengthM: number;
    maxSpeedMps: number;
  }>;
}

/** Static intersection registry entry. */
export interface IntersectionInfo {
  id: string;
  kind: string;
  controlled: boolean;
  x: number;
  y: number;
  signalId: string | null;
  /** Latest live traffic for this junction (null when nothing collected yet). */
  traffic: { queueLength: number; congestion: CongestionLevel | null } | null;
}

/** Response of GET /api/traffic. */
export interface TrafficStateResponse {
  simTimeSeconds: number;
  collectedAtIso: string | null;
  ageSeconds: number | null;
  stale: boolean;
  summary: CityTrafficSummary;
  segments: SegmentTraffic[];
  intersections: IntersectionTraffic[];
  system: {
    simulationStatus: SimulationStatus;
    simulationError: string | null;
    dbConnected: boolean;
    lastDbError: string | null;
    lastPersistError: string | null;
  };
}

/** WebSocket event envelope. */
export interface WsEvent<T> {
  type: "traffic:update" | "vehicle:update" | "signal:update" | "system:alert";
  ts: string;
  payload: T;
}
