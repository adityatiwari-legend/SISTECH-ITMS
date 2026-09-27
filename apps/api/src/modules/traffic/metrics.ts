/**
 * Deterministic traffic metric calculations (Phases.md 2.2, 2.3).
 *
 * All inputs come from SUMO TraCI reads or from network metadata. No value
 * here is fabricated; every function is pure and unit-testable.
 *
 * SUMO semantics baked into these calculations (verified against SUMO
 * 1.27.1 behavior):
 * - Edge LAST_STEP_MEAN_SPEED returns the lane speed limit when the edge is
 *   empty, so average speed is only meaningful when vehicle_count > 0.
 * - LAST_STEP_VEHICLE_HALTING_NUMBER counts vehicles below 0.1 m/s.
 * - LAST_STEP_OCCUPANCY is the fraction of lane length occupied by vehicles.
 */

export type CongestionLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Configurable thresholds for congestion classification. */
export interface CongestionThresholds {
  /** Occupancy fraction (0..1) at/above which a level is reached. */
  mediumOccupancy: number;
  highOccupancy: number;
  criticalOccupancy: number;
  /** Average speed as a fraction of free-flow speed, at/below which reached. */
  mediumSpeedRatio: number;
  highSpeedRatio: number;
  criticalSpeedRatio: number;
  /** Queue length (halting vehicles) at/above which a level is reached. */
  mediumQueue: number;
  highQueue: number;
  criticalQueue: number;
}

export const DEFAULT_CONGESTION_THRESHOLDS: CongestionThresholds = {
  mediumOccupancy: 0.15,
  highOccupancy: 0.3,
  criticalOccupancy: 0.45,
  mediumSpeedRatio: 0.6,
  highSpeedRatio: 0.35,
  criticalSpeedRatio: 0.15,
  mediumQueue: 2,
  highQueue: 6,
  criticalQueue: 12,
};

export interface SegmentMetricsInput {
  segmentId: string;
  /** Vehicles currently on the segment (SUMO edge vehicle count). */
  vehicleCount: number;
  /**
   * SUMO edge mean speed in m/s. When vehicleCount is 0 SUMO reports the
   * speed limit instead of a traffic speed; pass 0 in that case.
   */
  meanSpeedMps: number;
  /** Halting vehicles (speed < 0.1 m/s) on the segment (SUMO). */
  haltingCount: number;
  /** Mean occupancy fraction 0..1 over the segment's lanes (SUMO). */
  occupancy: number;
  /** Segment length in meters (network metadata). */
  lengthM: number;
  /** Number of lanes (network metadata). */
  laneCount: number;
  /** Free-flow speed in m/s (network metadata). */
  freeFlowSpeedMps: number;
  /** Vehicles that crossed onto the next edge during the last interval. */
  vehiclesPassed: number;
  /** Interval length in seconds the vehiclesPassed value covers. */
  intervalS: number;
}

export interface SegmentMetrics {
  segmentId: string;
  vehicleCount: number;
  avgSpeedMps: number;
  queueLength: number;
  /** Occupancy fraction 0..1 (SUMO). */
  occupancy: number;
  /** Vehicles per km per lane relative to segment length. */
  vehiclesPerKm: number;
  /** Flow rate in vehicles per hour derived from edge transitions. */
  flowRatePerHour: number;
  /** Average speed as a fraction of free-flow speed (0 when empty). */
  speedRatio: number;
  congestion: CongestionLevel;
}

export interface JunctionMetricsInput {
  junctionId: string;
  controlled: boolean;
  /** Sum of halting vehicles over this junction's controlled approach lanes. */
  approachQueueLength: number;
}

export interface JunctionMetrics {
  junctionId: string;
  controlled: boolean;
  queueLength: number;
}

/**
 * Validates invariants on raw inputs. Throws on impossible values so that
 * corrupt data never silently enters the pipeline.
 */
export function validateSegmentInput(input: SegmentMetricsInput): void {
  if (input.vehicleCount < 0) throw new Error(`segment ${input.segmentId}: negative vehicle count`);
  if (input.haltingCount < 0) throw new Error(`segment ${input.segmentId}: negative halting count`);
  if (input.haltingCount > input.vehicleCount) {
    throw new Error(`segment ${input.segmentId}: halting count ${input.haltingCount} exceeds vehicle count ${input.vehicleCount}`);
  }
  if (input.occupancy < 0 || input.occupancy > 1) {
    throw new Error(`segment ${input.segmentId}: occupancy ${input.occupancy} out of range [0,1]`);
  }
  if (input.lengthM <= 0) throw new Error(`segment ${input.segmentId}: non-positive length`);
  if (input.laneCount <= 0) throw new Error(`segment ${input.segmentId}: non-positive lane count`);
  if (input.freeFlowSpeedMps <= 0) throw new Error(`segment ${input.segmentId}: non-positive free-flow speed`);
  if (input.intervalS <= 0) throw new Error(`segment ${input.segmentId}: non-positive interval`);
}

/**
 * Computes the full metric set for one segment and classifies congestion.
 * Empty segments are always LOW: no vehicles means no congestion.
 * Thresholds are passed by the caller (from configuration).
 */
export function computeSegmentMetrics(
  input: SegmentMetricsInput,
  thresholds: CongestionThresholds = DEFAULT_CONGESTION_THRESHOLDS,
): SegmentMetrics {
  validateSegmentInput(input);

  const hasTraffic = input.vehicleCount > 0;
  const avgSpeedMps = hasTraffic ? input.meanSpeedMps : 0;
  const speedRatio = hasTraffic ? avgSpeedMps / input.freeFlowSpeedMps : 0;
  const vehiclesPerKm = (input.vehicleCount / (input.lengthM / 1000)) / input.laneCount;
  const flowRatePerHour = (input.vehiclesPassed * 3600) / input.intervalS;

  const congestion = hasTraffic
    ? classifyCongestion(
        { occupancy: input.occupancy, speedRatio, queueLength: input.haltingCount },
        thresholds,
      )
    : "LOW";

  return {
    segmentId: input.segmentId,
    vehicleCount: input.vehicleCount,
    avgSpeedMps: round3(avgSpeedMps),
    queueLength: input.haltingCount,
    occupancy: round3(input.occupancy),
    vehiclesPerKm: round3(vehiclesPerKm),
    flowRatePerHour: Math.max(0, Math.round(flowRatePerHour)),
    speedRatio: round3(speedRatio),
    congestion,
  };
}

/**
 * Congestion classification. Checks the three real signals (speed ratio,
 * occupancy, queue) against configurable thresholds from the most severe
 * level down.
 *
 * Preconditions: callers only invoke this for segments WITH traffic
 * (empty segments are classified LOW by computeSegmentMetrics), so a
 * speed ratio of 0 means a genuine standstill, not an empty road.
 */
export function classifyCongestion(
  measures: { occupancy: number; speedRatio: number; queueLength: number },
  thresholds: CongestionThresholds,
): CongestionLevel {
  const { occupancy, speedRatio, queueLength } = measures;

  if (
    occupancy >= thresholds.criticalOccupancy ||
    speedRatio <= thresholds.criticalSpeedRatio ||
    queueLength >= thresholds.criticalQueue
  ) {
    return "CRITICAL";
  }
  if (
    occupancy >= thresholds.highOccupancy ||
    speedRatio <= thresholds.highSpeedRatio ||
    queueLength >= thresholds.highQueue
  ) {
    return "HIGH";
  }
  if (
    occupancy >= thresholds.mediumOccupancy ||
    speedRatio <= thresholds.mediumSpeedRatio ||
    queueLength >= thresholds.mediumQueue
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

export interface CitySummary {
  vehicleCount: number;
  avgSpeedMps: number;
  totalQueueLength: number;
  /** Congested segments by level (HIGH or CRITICAL). */
  congestedSegments: number;
  criticalSegments: number;
  /** Worst level across all segments with traffic; LOW when the city is empty. */
  cityLevel: CongestionLevel;
}

const LEVEL_ORDER: Record<CongestionLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export { LEVEL_ORDER };

/** Aggregates segment metrics into a city-level summary. */
export function computeCitySummary(
  segments: SegmentMetrics[],
  totalVehicles: number,
  vehicles?: Array<{ speed?: number }>,
): CitySummary {
  let totalQueue = 0;
  let speedWeighted = 0;
  let congested = 0;
  let critical = 0;
  let worst: CongestionLevel = "LOW";

  for (const segment of segments) {
    totalQueue += segment.queueLength;
    if (segment.vehicleCount > 0) {
      speedWeighted += segment.avgSpeedMps * segment.vehicleCount;
      if (LEVEL_ORDER[segment.congestion] > LEVEL_ORDER[worst]) {
        worst = segment.congestion;
      }
      if (segment.congestion === "HIGH" || segment.congestion === "CRITICAL") {
        congested += 1;
      }
      if (segment.congestion === "CRITICAL") {
        critical += 1;
      }
    }
  }

  let avgSpeedMps = 0;
  const count = vehicles ? vehicles.length : totalVehicles;
  if (vehicles && vehicles.length > 0) {
    const sumSpeed = vehicles.reduce((acc, v) => acc + (v.speed || 0), 0);
    avgSpeedMps = round3(sumSpeed / vehicles.length);
  } else if (totalVehicles > 0) {
    avgSpeedMps = round3(speedWeighted / totalVehicles);
  }

  return {
    vehicleCount: count,
    avgSpeedMps,
    totalQueueLength: totalQueue,
    congestedSegments: congested,
    criticalSegments: critical,
    cityLevel: worst,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
