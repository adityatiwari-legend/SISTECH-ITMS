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
  type: "traffic:update" | "vehicle:update" | "signal:update" | "system:alert" | "emergency:created" | "emergency:update" | "route:updated";
  ts: string;
  payload: T;
}

// ---------------------------------------------------------------------------
// Phase 3 — emergency vehicle + intelligent routing types
// ---------------------------------------------------------------------------

/** Supported emergency vehicle categories (Phases.md 3). */
export type EmergencyType = "ambulance" | "fire_engine" | "police";

/** Operator-assigned priority. Corridor priority rules use this in Phase 5+. */
export type EmergencyPriority = "critical" | "high" | "normal";

/** Lifecycle of an emergency event. */
export type EmergencyStatus =
  | "created" //  event exists, vehicle spawned/pending in SUMO, not yet inserted
  | "active" //   vehicle is in the network and following the route
  | "arrived" //  vehicle reached the destination
  | "cancelled"
  | "failed"; //  could not spawn/route, or simulation ended before arrival

/** The emergency vehicle record (Phases.md 3.1). */
export interface EmergencyVehicleRecord {
  id: number;
  /** SUMO vehicle id (assigned at creation). */
  vehicleId: string;
  type: EmergencyType;
  priority: EmergencyPriority;
  status: EmergencyStatus;
  originJunction: string;
  destinationJunction: string;
  /** Live position in SUMO coordinates (null before insertion). */
  positionX: number | null;
  positionY: number | null;
  /** Live speed in m/s (null before insertion). */
  speedMps: number | null;
  createdAtIso: string;
  activatedAtIso: string | null;
  arrivedAtIso: string | null;
}

/** One edge (directed segment) of a computed route. */
export interface RouteSegmentInfo {
  sequenceIndex: number;
  segmentId: string;
  fromJunction: string;
  toJunction: string;
  lengthM: number;
  /** Cost used by A* for this edge (seconds, congestion-adjusted travel time). */
  costSeconds: number;
  congestion: CongestionLevel | null;
}

/** The computed route (Phases.md 3.6/3.7). */
export interface RouteSummary {
  id: number;
  algorithm: "astar";
  originJunction: string;
  destinationJunction: string;
  edgeCount: number;
  totalLengthM: number;
  /** Congestion-adjusted travel time estimate in seconds at routing time. */
  estimatedTravelTimeS: number;
  /** Free-flow travel time in seconds (for comparison). */
  freeFlowTravelTimeS: number;
  segments: RouteSegmentInfo[];
}

/** ETA for one upcoming controlled intersection or the destination. */
export interface EmergencyEta {
  junctionId: string;
  /** Seconds from the current simulation time. */
  etaSeconds: number;
  distanceM: number;
  /** True for the final destination entry. */
  isDestination: boolean;
}

/** Full emergency event detail (GET /api/emergency/:id). */
export interface EmergencyEventDetail {
  id: number;
  type: EmergencyType;
  priority: EmergencyPriority;
  status: EmergencyStatus;
  originJunction: string;
  destinationJunction: string;
  createdAtIso: string;
  activatedAtIso: string | null;
  arrivedAtIso: string | null;
  vehicle: EmergencyVehicleRecord | null;
  route: RouteSummary | null;
  /** ETAs recomputed from the current simulation state (null when inactive). */
  etas: EmergencyEta[] | null;
  /** Live info about the vehicle in the network (null when not active). */
  live: {
    simTimeSeconds: number;
    positionX: number;
    positionY: number;
    speedMps: number;
    roadId: string;
    laneId: string;
    /** Index of the current edge within the route (SUMO route index). */
    routeIndex: number;
    remainingDistanceM: number;
  } | null;
}

/** Body of POST /api/emergency (validated). */
export interface CreateEmergencyBody {
  type: EmergencyType;
  origin: string;
  destination: string;
  priority: EmergencyPriority;
}
