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
export type SimulationScenarioId = "baseline" | "emergency" | "emergency_low" | "emergency_high";

/** Traffic-demand variants exposed by the scenario builder (Phases.md 7.12). */
export type TrafficLevel = "low" | "medium" | "high";

export function scenarioForTrafficLevel(level: TrafficLevel): SimulationScenarioId {
  switch (level) {
    case "low":
      return "emergency_low";
    case "high":
      return "emergency_high";
    default:
      return "emergency";
  }
}

/** A single vehicle as observed in the SUMO simulation at a point in time. */
export interface VehicleSnapshot {
  id: string;
  /** SUMO vehicle type id (e.g. "car", "bus", "emergency"). */
  typeId: string;
  /** Position in SUMO network coordinates (meters). */
  positionX: number;
  positionY: number;
  /** Position in WGS84 degrees (present only for georeferenced networks). */
  lat?: number;
  lng?: number;
  /** Heading in degrees (SUMO convention: 0 = north, clockwise). */
  angle: number;
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
  /** Current pace multiplier (1 = real time; wall ms per step = 1000/pace). */
  paceMultiplier: number;
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
  type:
    | "traffic:update"
    | "vehicle:update"
    | "signal:update"
    | "system:alert"
    | "emergency:created"
    | "emergency:update"
    | "route:updated"
    | "prediction:update"
    | "corridor:created"
    | "corridor:update"
    | "route:switched"
    | "comparison:update"
    | "emergency:verification:submitted"
    | "emergency:verification:analyzing"
    | "emergency:verified"
    | "emergency:fraud-flagged"
    | "emergency:manual-review"
    | "emergency:approved"
    | "emergency:rejected"
    | "corridor:authorized"
    | "emergency:completed"
    | "emergency:cancelled"
    | "heartbeat";
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
  | "completed"
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
  /** Live position in WGS84 degrees (georeferenced networks only). */
  lat?: number;
  lng?: number;
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
    /** Live position in WGS84 degrees (georeferenced networks only). */
    lat?: number;
    lng?: number;
    /** Heading in degrees (SUMO convention: 0 = north, clockwise). */
    angle: number;
    speedMps: number;
    roadId: string;
    laneId: string;
    /** Index of the current edge within the route (SUMO route index). */
    routeIndex: number;
    remainingDistanceM: number;
  } | null;
  /** Mobile driver app integration metadata (present when initiated from driver app). */
  mobile?: MobileEmergencyMeta | null;
}

export interface MobileEmergencyMeta {
  isDriverApp: boolean;
  driverId?: number | null;
  driverName?: string | null;
  driverCode?: string | null;
  driverPhone?: string | null;
  vehicleCode?: string | null;
  registrationNumber?: string | null;
  vehicleModel?: string | null;
  hospitalId?: number | null;
  hospitalName?: string | null;
  hospitalCode?: string | null;
  patientCondition?: string | null;
  severity?: string | null;
  authorizationStatus?: string | null;
  verificationStatus?: string | null;
  isCorridorAuthorized?: boolean;
  hasPatientImage?: boolean;
}

/** Body of POST /api/emergency (validated). */
export interface CreateEmergencyBody {
  type: EmergencyType;
  origin?: string;
  destination?: string;
  priority: EmergencyPriority;
  latitude?: number;
  longitude?: number;
  destinationHospitalId?: number | string;
  patientCondition?: string;
  severity?: string;
  driverId?: number;
  vehicleId?: number | string;
}

// ---------------------------------------------------------------------------
// Phase 4 — AI traffic prediction types
// ---------------------------------------------------------------------------

/** Source of a prediction value. */
export type PredictionSource = "ml" | "fallback" | "unavailable";

/** One horizon's prediction for one junction. */
export interface PredictionHorizon {
  horizonSeconds: number;
  /** Predicted vehicle count on the junction's approaches. */
  predictedVehicleCount: number;
}

/** Current prediction state for one junction. */
export interface JunctionPrediction {
  junctionId: string;
  /** Simulation time the prediction is based on. */
  basedOnSimTimeSeconds: number | null;
  /** Wall-clock ISO time the prediction was computed. */
  computedAtIso: string | null;
  source: PredictionSource;
  modelVersion: string | null;
  horizons: PredictionHorizon[];
  /** True when the prediction is older than the configured staleness limit. */
  stale: boolean;
  /** Present when the last prediction attempt failed (with the reason). */
  lastError: { reason: string; message: string } | null;
}

/** Response of GET /api/predictions. */
export interface PredictionsResponse {
  simTimeSeconds: number;
  predictionsEnabled: boolean;
  serviceUrl: string | null;
  serviceHealthy: boolean;
  staleAfterSeconds: number;
  /** Latest model version when known. */
  modelVersion: string | null;
  predictions: JunctionPrediction[];
  system: {
    simulationStatus: SimulationStatus;
    dbConnected: boolean;
  };
}

/** WebSocket prediction:update payload. */
export interface PredictionUpdatePayload {
  simTimeSeconds: number;
  predictions: JunctionPrediction[];
}

// ---------------------------------------------------------------------------
// Phase 5 — predictive rolling green corridor types
// ---------------------------------------------------------------------------

/** Lifecycle of a green corridor (Phases.md 5). */
export type CorridorState =
  | "PLANNING"
  | "VALIDATING"
  | "ACTIVE"
  | "REPLANNING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

/** Per-junction plan mode decided by the planner. */
export type CorridorJunctionMode = "switch" | "extend" | "noop";

/** Per-junction execution status. */
export type CorridorSignalStatus = "PENDING" | "APPLIED" | "PASSED" | "SKIPPED" | "NOOP";

/** Rolling approach corridor stage for live human-centered visualization. */
export type CorridorSignalStage =
  | "NORMAL"
  | "DETECTED"
  | "PREPARING"
  | "CLEARING"
  | "GREEN"
  | "PASSED"
  | "RESTORING";

/** One junction's planned green window inside a corridor. */
export interface CorridorSignalPlanEntry {
  sequenceIndex: number;
  junctionId: string;
  signalId: string;
  /** Route edge (directed segment) leading into this junction. */
  approachSegmentId: string;
  /** Emergency ETA at this junction in seconds (relative to planning time). */
  etaSeconds: number;
  mode: CorridorJunctionMode;
  /** Rolling corridor execution stage (human-readable lifecycle). */
  stage?: CorridorSignalStage;
  distanceToEmergencyM?: number | null;
  /** Absolute simulation-time green window [start, end] (null for PENDING). */
  plannedGreenStartS: number | null;
  plannedGreenEndS: number | null;
  /** The RYG state that gives green only to the corridor approach. */
  corridorState: string | null;
  /** Traffic-light link indices of the corridor approach at this junction. */
  corridorLinkIndices: number[];
  /** True when a yellow clearance step is scheduled before corridor green. */
  requiresClearance: boolean;
  status: CorridorSignalStatus;
  skipReason: string | null;
  /** Predicted approach vehicle count closest to the ETA (null: unavailable). */
  predictedVehicleCount: number | null;
  predictedCongestion: CongestionLevel | null;
  /** Downstream segment after this junction (null at the route end). */
  downstreamSegmentId: string | null;
  downstreamOccupancy: number | null;
}

/** Explicit safety-validation outcome for a corridor plan. */
export interface CorridorValidationSummary {
  passed: boolean;
  /** Junctions skipped by safety constraints (junctionId → reason). */
  skipped: Array<{ junctionId: string; reason: string }>;
  /** Fatal problems that fail the whole corridor. */
  failures: string[];
}

/** Full corridor detail (API responses). */
export interface CorridorDetail {
  id: number;
  eventId: number;
  vehicleId: string | null;
  status: CorridorState;
  originJunction: string;
  destinationJunction: string;
  junctionCount: number;
  /** Simulation time when the plan was computed. */
  plannedAtSimTimeS: number | null;
  createdAtIso: string;
  activatedAtIso: string | null;
  completedAtIso: string | null;
  cancelledAtIso: string | null;
  failedAtIso: string | null;
  cancelReason: string | null;
  lastError: string | null;
  validation: CorridorValidationSummary | null;
  signals: CorridorSignalPlanEntry[];
  /** Live view (null when the corridor is not active). */
  live: {
    simTimeSeconds: number;
    /** Junctions not yet passed. */
    remainingJunctions: number;
    emergencyStatus: EmergencyStatus | null;
    vehicleSpeedMps: number | null;
  } | null;
}

/** Body of POST /api/corridors. */
export interface CreateCorridorBody {
  eventId: number;
}

// ---------------------------------------------------------------------------
// Phase 6 — closed-loop optimization types
// ---------------------------------------------------------------------------

/** Recorded performance metrics of one simulation run (measured, never fabricated). */
export interface SimulationMetrics {
  runId: number;
  scenario: SimulationScenarioId;
  /** baseline | itms — which control regime produced the run. */
  mode: "baseline" | "itms" | "unspecified";
  /** Emergency travel time in sim seconds (null: no completed emergency). */
  emergencyTravelTimeS: number | null;
  /** Emergency total time loss in sim seconds (null: no sample). */
  emergencyTimeLossS: number | null;
  /** Mean time loss across all vehicles (average delay). */
  avgVehicleDelayS: number | null;
  /** Mean total queue length across samples. */
  avgQueueLength: number | null;
  /** Mean city average speed (m/s) across samples. */
  avgSpeedMps: number | null;
  /** Arrived vehicles per simulated hour. */
  throughputPerHour: number | null;
  /** Number of signal state/program changes issued this run. */
  signalChangeCount: number;
  simDurationS: number;
  sampleCount: number;
  startedAtIso: string | null;
  completedAtIso: string | null;
}

/** One recorded dynamic route switch of an emergency. */
export interface RouteSwitchRecord {
  id: number;
  eventId: number;
  simTimeS: number;
  fromRouteId: number | null;
  toRouteId: number | null;
  oldEtaS: number;
  newEtaS: number;
  reason: string;
  createdAtIso: string;
}

/** Result of the baseline vs ITMS comparison. */
export interface ComparisonResult {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  stage?:
    | "preparing"
    | "running_baseline"
    | "baseline_complete"
    | "resetting"
    | "running_itms"
    | "itms_complete"
    | "comparing"
    | "completed"
    | "failed";
  stageMessage?: string;
  error: string | null;
  input: {
    type: EmergencyType;
    origin: string;
    destination: string;
    priority: EmergencyPriority;
    warmupSeconds: number;
    durationCapSeconds: number;
  };
  baseline: { runId: number | null; metrics: SimulationMetrics | null };
  itms: { runId: number | null; metrics: SimulationMetrics | null };
  /** Deltas (itms - baseline); null where metrics are missing. */
  deltas: {
    emergencyTravelTimeS: number | null;
    avgVehicleDelayS: number | null;
    avgQueueLength: number | null;
    avgSpeedMps: number | null;
    throughputPerHour: number | null;
    signalChangeCount: number | null;
  } | null;
  startedAtIso: string | null;
  completedAtIso: string | null;
}

/** Body of POST /api/scenarios/compare. */
export interface CreateComparisonBody {
  type: EmergencyType;
  origin: string;
  destination: string;
  priority: EmergencyPriority;
  warmupSeconds?: number;
  durationCapSeconds?: number;
}

// ---------------------------------------------------------------------------
// Phase 7 — command center supporting types
// ---------------------------------------------------------------------------

/** One decision-trace timeline entry (from persisted backend data only). */
export interface DecisionEvent {
  /** Wall-clock ISO timestamp of the decision. */
  ts: string;
  kind:
    | "emergency.created"
    | "emergency.activated"
    | "emergency.arrived"
    | "route.computed"
    | "route.switched"
    | "corridor.created"
    | "corridor.activated"
    | "corridor.completed"
    | "corridor.cancelled"
    | "corridor.failed"
    | "signal.applied"
    | "signal.passed";
  message: string;
  /** Structured identifiers for filtering. */
  refs: {
    emergencyEventId?: number;
    corridorId?: number;
    signalId?: string;
    runId?: number;
  };
}

/** Non-secret system overview for the Settings/System page. */
export interface SystemOverview {
  api: { host: string; port: number; nodeVersion: string };
  simulation: SimulationStatusSnapshot;
  database: { connected: boolean; lastError: string | null; postgisVersion: string | null };
  prediction: {
    configured: boolean;
    url: string | null;
    healthy: boolean;
    modelVersion: string | null;
    horizonsS: number[];
  };
  scenarios: Array<{ id: SimulationScenarioId; label: string }>;
  settingsSummary: {
    loopEvalIntervalS: number;
    routeReevalIntervalS: number;
    metricsSampleIntervalS: number;
    congestionThresholds: {
      mediumOccupancy: number;
      highOccupancy: number;
      criticalOccupancy: number;
      mediumSpeedRatio: number;
      highSpeedRatio: number;
      criticalSpeedRatio: number;
      mediumQueue: number;
      highQueue: number;
      criticalQueue: number;
    };
    corridor: {
      greenLeadS: number;
      greenTrailS: number;
      minGreenWindowS: number;
      maxGreenWindowS: number;
      maxGreenExtensionS: number;
      maxRedExtensionS: number;
      clearanceYellowS: number;
      minPriority: EmergencyPriority;
    };
  };
}

/** Measured analytics aggregates (computed from persisted runs only). */
export interface AnalyticsResponse {
  emergencyTrips: number;
  completedEmergencies: number;
  corridorsCreated: number;
  runsRecorded: number;
  /** Mean emergency travel time over runs that measured it (sim seconds). */
  avgResponseTimeS: number | null;
  /** Mean time saved per comparison (baseline − ITMS travel time, seconds). */
  avgTimeSavedS: number | null;
  avgTrafficDelayS: number | null;
  avgQueueLength: number | null;
  avgSpeedMps: number | null;
  avgThroughputPerHour: number | null;
  totalSignalChanges: number;
  /** Per-run rows for charts (chronological). */
  runs: Array<{
    runId: number;
    mode: string;
    emergencyTravelTimeS: number | null;
    avgVehicleDelayS: number | null;
    avgQueueLength: number | null;
    avgSpeedMps: number | null;
    throughputPerHour: number | null;
    signalChangeCount: number;
    completedAtIso: string | null;
  }>;
}

/** Network geometry for the live map (SUMO coordinates, meters). */
export interface NetworkGeometryResponse {
  /** True when the network carries a real geographic projection (OSM-derived). */
  geoReferenced: boolean;
  /** Demo city metadata (real-world city demo profile). */
  demoCity: string;
  demoCenter: { lat: number; lng: number };
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  /** Geographic extent in degrees (present only when geoReferenced). */
  geoExtent?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  junctions: Array<{ id: string; x: number; y: number; lat?: number; lng?: number; controlled: boolean }>;
  segments: Array<{
    id: string;
    fromJunction: string;
    toJunction: string;
    laneCount: number;
    coordinates: Array<{ x: number; y: number; lat?: number; lng?: number }>;
    /** Per-lane shapes (actual SUMO lane geometry; index 0 = rightmost). */
    lanes: Array<{ id: string; index: number; shape: Array<{ x: number; y: number }> }>;
  }>;
  facilities: Array<{ id: string; type: string; x: number; y: number; lat?: number; lng?: number }>;
}

// ---------------------------------------------------------------------------
// Phase 8 — Mobile Driver & Responder Types
// ---------------------------------------------------------------------------

export interface DriverProfile {
  id: number;
  driverCode: string;
  name: string;
  email: string;
  phone: string | null;
  role: "driver" | "admin" | "operator";
  status: "available" | "on_duty" | "off_duty" | "in_emergency";
  licenseNumber?: string | null;
  assignedVehicle: FleetVehicleRecord | null;
  currentEmergencyId: number | null;
}

export interface FleetVehicleRecord {
  id: number;
  vehicleCode: string;
  registrationNumber: string;
  vehicleType: EmergencyType;
  model: string;
  status: "available" | "assigned" | "in_emergency" | "maintenance";
  assignedDriverId: number | null;
  currentEmergencyId: number | null;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  lastHeading?: number | null;
  lastSpeedKmh?: number | null;
}

export interface HospitalRecord {
  id: number;
  name: string;
  code: string;
  address: string;
  latitude: number;
  longitude: number;
  emergencyPhone: string | null;
  availableBeds: number;
  traumaLevel: string;
  nearestJunctionId: string;
  status: "active" | "diverting" | "full";
}

export interface PoliceZoneRecord {
  id: number;
  name: string;
  zoneCode: string;
  headquartersJunctionId: string | null;
  contactPhone: string | null;
  activeOfficersCount: number;
}

export interface VerificationDetail {
  id: number;
  requestId: string;
  eventId: number;
  driverId: number | null;
  vehicleId: number | null;
  status:
    | "captured"
    | "submitted"
    | "pending"
    | "aiAnalyzing"
    | "aiApproved"
    | "aiFraudFlagged"
    | "manualReview"
    | "adminApproved"
    | "adminRejected"
    | "corridorAssigned";
  isCorridorAuthorized: boolean;
  submittedAtIso: string;
  updatedAtIso: string;
  evidence?: {
    id: number;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
    uploadedAtIso: string;
  } | null;
  aiResult?: {
    verdict: "VERIFIED" | "FRAUD_FLAGGED" | "REVIEW_REQUIRED";
    confidenceScore: number;
    reason: string;
    detectedFeatures: string[];
    isFlaggedAsFraud: boolean;
    model: string;
    evaluatedAtIso: string;
  } | null;
  adminDecision?: {
    reviewerId: string;
    reviewerName: string;
    isApproved: boolean;
    rejectionReason: string | null;
    notes: string | null;
    decidedAtIso: string;
  } | null;
}

export interface DriverTelemetryPayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speedMps?: number;
  heading?: number;
  timestamp?: string | number;
}
