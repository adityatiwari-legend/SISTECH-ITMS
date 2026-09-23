import type { AnalyticsResponse, DecisionEvent, SystemOverview } from "@itms/types";
import type { DatabasePool } from "../../database/db.ts";
import type { AppConfig } from "../../config.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { PredictionService } from "../prediction/prediction-service.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";

/**
 * Phase 7 supporting APIs, all computed from PERSISTED, measured data:
 *  - GET /api/analytics: aggregates over simulation_metrics + comparisons
 *    + emergency_events + green_corridors (never hard-coded),
 *  - GET /api/decisions: the real decision timeline merged from
 *    emergency_events, emergency_route_switches, green_corridors and
 *    corridor_signals rows (explainability without fabrication),
 *  - GET /api/system: non-secret system overview + component health.
 */

export async function getAnalytics(db: DatabasePool): Promise<AnalyticsResponse> {
  const metrics = await db.query<{
    run_id: number;
    mode: string;
    emergency_travel_time_s: number | null;
    avg_vehicle_delay_s: number | null;
    avg_queue_length: number | null;
    avg_speed_mps: number | null;
    throughput_per_hour: number | null;
    signal_change_count: number;
    completed_at: Date | null;
  }>(
    `SELECT m.run_id, m.mode, m.emergency_travel_time_s, m.avg_vehicle_delay_s,
            m.avg_queue_length, m.avg_speed_mps, m.throughput_per_hour,
            m.signal_change_count, m.completed_at
     FROM simulation_metrics m ORDER BY m.run_id`,
  );
  const comparisons = await db.query<{ delta_travel_time_s: number | null }>(
    `SELECT delta_travel_time_s FROM comparisons WHERE completed_at IS NOT NULL AND delta_travel_time_s IS NOT NULL`,
  );
  const emergencyCounts = await db.query<{ total: string; completed: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'arrived') AS completed
     FROM emergency_events`,
  );
  const corridorCount = await db.query<{ count: string }>(`SELECT count(*) AS count FROM green_corridors`);

  const rows = metrics.rows;
  const avg = (values: Array<number | null | undefined>): number | null => {
    const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (finite.length === 0) return null;
    return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 100) / 100;
  };
  const timeSavedValues = comparisons.rows
    .map((row) => row.delta_travel_time_s)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((delta) => -delta); // delta = itms − baseline (negative ⇒ time saved)

  return {
    emergencyTrips: Number(emergencyCounts.rows[0]?.total ?? 0),
    completedEmergencies: Number(emergencyCounts.rows[0]?.completed ?? 0),
    corridorsCreated: Number(corridorCount.rows[0]?.count ?? 0),
    runsRecorded: rows.length,
    avgResponseTimeS: avg(rows.map((row) => row.emergency_travel_time_s)),
    avgTimeSavedS: timeSavedValues.length > 0 ? avg(timeSavedValues) : null,
    avgTrafficDelayS: avg(rows.map((row) => row.avg_vehicle_delay_s)),
    avgQueueLength: avg(rows.map((row) => row.avg_queue_length)),
    avgSpeedMps: avg(rows.map((row) => row.avg_speed_mps)),
    avgThroughputPerHour: avg(rows.map((row) => row.throughput_per_hour)),
    totalSignalChanges: rows.reduce((sum, row) => sum + Number(row.signal_change_count ?? 0), 0),
    runs: rows.map((row) => ({
      runId: row.run_id,
      mode: row.mode,
      emergencyTravelTimeS: row.emergency_travel_time_s,
      avgVehicleDelayS: row.avg_vehicle_delay_s,
      avgQueueLength: row.avg_queue_length,
      avgSpeedMps: row.avg_speed_mps,
      throughputPerHour: row.throughput_per_hour,
      signalChangeCount: row.signal_change_count,
      completedAtIso: row.completed_at?.toISOString() ?? null,
    })),
  };
}

export async function getDecisionTrace(db: DatabasePool, limit = 200): Promise<DecisionEvent[]> {
  const events: DecisionEvent[] = [];

  const emergencies = await db.query<{
    id: number;
    status: string;
    type: string;
    priority: string;
    origin: string;
    destination: string;
    created_at: Date;
    activated_at: Date | null;
    arrived_at: Date | null;
  }>(
    `SELECT e.id, e.status, v.type, e.priority, e.origin_junction AS origin, e.destination_junction AS destination,
            e.created_at, e.activated_at, e.arrived_at
     FROM emergency_events e
     JOIN emergency_vehicles v ON v.id = e.vehicle_id
     ORDER BY e.id DESC LIMIT ${Math.min(100, limit)}`,
  );
  for (const row of emergencies.rows) {
    events.push({
      ts: row.created_at.toISOString(),
      kind: "emergency.created",
      message: `Emergency event ${row.id} created (${row.type}, ${row.priority}, ${row.origin} → ${row.destination}).`,
      refs: { emergencyEventId: row.id },
    });
    if (row.activated_at !== null) {
      events.push({
        ts: row.activated_at.toISOString(),
        kind: "emergency.activated",
        message: `Emergency vehicle for event ${row.id} is en route.`,
        refs: { emergencyEventId: row.id },
      });
    }
    if (row.arrived_at !== null) {
      events.push({
        ts: row.arrived_at.toISOString(),
        kind: "emergency.arrived",
        message: `Emergency event ${row.id} arrived at ${row.destination}.`,
        refs: { emergencyEventId: row.id },
      });
    }
  }

  const switches = await db.query<{
    id: number;
    event_id: number;
    sim_time_s: number;
    reason: string;
    created_at: Date;
  }>(
    `SELECT id, event_id, sim_time_s, reason, created_at
     FROM emergency_route_switches ORDER BY id DESC LIMIT ${Math.min(100, limit)}`,
  );
  for (const row of switches.rows) {
    events.push({
      ts: row.created_at.toISOString(),
      kind: "route.switched",
      message: `Route switched for event ${row.id}: ${row.reason}.`,
      refs: { emergencyEventId: row.event_id },
    });
  }

  const corridors = await db.query<{
    id: number;
    event_id: number;
    status: string;
    junction_count: number;
    planned_at: Date;
    activated_at: Date | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    failed_at: Date | null;
    cancel_reason: string | null;
    last_error: string | null;
  }>(
    `SELECT id, event_id, status, junction_count, planned_at, activated_at, completed_at,
            cancelled_at, failed_at, cancel_reason, last_error
     FROM green_corridors ORDER BY id DESC LIMIT ${Math.min(100, limit)}`,
  );
  for (const row of corridors.rows) {
    events.push({
      ts: row.planned_at.toISOString(),
      kind: "corridor.created",
      message: `Green corridor ${row.id} planned for event ${row.id === row.event_id ? "" : row.event_id} with ${row.junction_count} junction(s).`,
      refs: { corridorId: row.id, emergencyEventId: row.event_id },
    });
    if (row.activated_at !== null) {
      events.push({
        ts: row.activated_at.toISOString(),
        kind: "corridor.activated",
        message: `Green corridor ${row.id} activated (${row.junction_count} signals).`,
        refs: { corridorId: row.id, emergencyEventId: row.event_id },
      });
    }
    if (row.completed_at !== null) {
      events.push({
        ts: row.completed_at.toISOString(),
        kind: "corridor.completed",
        message: `Green corridor ${row.id} completed.`,
        refs: { corridorId: row.id, emergencyEventId: row.event_id },
      });
    }
    if (row.cancelled_at !== null) {
      events.push({
        ts: row.cancelled_at.toISOString(),
        kind: "corridor.cancelled",
        message: `Green corridor ${row.id} cancelled: ${row.cancel_reason ?? "operator request"}.`,
        refs: { corridorId: row.id, emergencyEventId: row.event_id },
      });
    }
    if (row.failed_at !== null) {
      events.push({
        ts: row.failed_at.toISOString(),
        kind: "corridor.failed",
        message: `Green corridor ${row.id} failed: ${row.last_error ?? row.cancel_reason ?? "unknown"}.`,
        refs: { corridorId: row.id, emergencyEventId: row.event_id },
      });
    }
  }

  const signalRows = await db.query<{
    signal_id: string;
    corridor_id: number;
    status: string;
    applied_at: Date | null;
    passed_at: Date | null;
  }>(
    `SELECT signal_id, corridor_id, status, applied_at, passed_at
     FROM corridor_signals
     WHERE applied_at IS NOT NULL OR passed_at IS NOT NULL
     ORDER BY id DESC LIMIT ${Math.min(200, limit)}`,
  );
  for (const row of signalRows.rows) {
    if (row.applied_at !== null) {
      events.push({
        ts: row.applied_at.toISOString(),
        kind: "signal.applied",
        message: `Corridor green applied at signal ${row.signal_id} (corridor ${row.corridor_id}).`,
        refs: { signalId: row.signal_id, corridorId: row.corridor_id },
      });
    }
    if (row.passed_at !== null) {
      events.push({
        ts: row.passed_at.toISOString(),
        kind: "signal.passed",
        message: `Emergency vehicle passed signal ${row.signal_id}; normal program restored.`,
        refs: { signalId: row.signal_id, corridorId: row.corridor_id },
      });
    }
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts));
  return events.slice(0, limit);
}

export async function getSystemOverview(
  config: AppConfig,
  manager: SimulationManager,
  db: DatabasePool,
  predictionService: PredictionService,
): Promise<SystemOverview> {
  let postgisVersion: string | null = null;
  try {
    const result = await db.query<{ version: string }>(`SELECT postgis_version() AS version`);
    postgisVersion = result.rows[0]?.version ?? null;
  } catch {
    postgisVersion = null;
  }
  return {
    api: { host: config.host, port: config.port, nodeVersion: process.version },
    simulation: manager.getStatusSnapshot(),
    database: {
      connected: db.isHealthy(),
      lastError: db.lastError(),
      postgisVersion,
    },
    prediction: {
      configured: config.predictionServiceUrl !== null,
      url: config.predictionServiceUrl,
      healthy: predictionService.getServiceHealthy(),
      modelVersion: predictionService.getModelVersion(),
      horizonsS: [30, 60, 90, 120],
    },
    scenarios: [
      { id: "baseline", label: "Baseline traffic" },
      { id: "emergency", label: "Emergency scenario (medium demand)" },
      { id: "emergency_low", label: "Emergency scenario (low demand)" },
      { id: "emergency_high", label: "Emergency scenario (high demand)" },
    ],
    settingsSummary: {
      loopEvalIntervalS: config.loopEvalIntervalS,
      routeReevalIntervalS: config.routeReevalIntervalS,
      metricsSampleIntervalS: config.metricsSampleIntervalS,
      congestionThresholds: config.congestionThresholds,
      corridor: {
        greenLeadS: config.corridorGreenLeadS,
        greenTrailS: config.corridorGreenTrailS,
        minGreenWindowS: config.corridorMinGreenWindowS,
        maxGreenWindowS: config.corridorMaxGreenWindowS,
        maxGreenExtensionS: config.corridorMaxGreenExtensionS,
        maxRedExtensionS: config.corridorMaxRedExtensionS,
        clearanceYellowS: config.corridorClearanceYellowS,
        minPriority: config.corridorMinPriority,
      },
    },
  };
}
