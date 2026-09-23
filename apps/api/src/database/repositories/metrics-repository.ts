import type { DatabasePool } from "../db.ts";
import type { SimulationMetrics } from "@itms/types";

/**
 * Persistence for per-run measured metrics and emergency route switches.
 * Values are recorded from the running simulation only; nothing is
 * fabricated or hard-coded.
 */

export interface SimulationMetricsRow {
  run_id: number;
  mode: string;
  emergency_travel_time_s: number | null;
  emergency_time_loss_s: number | null;
  avg_vehicle_delay_s: number | null;
  avg_queue_length: number | null;
  avg_speed_mps: number | null;
  throughput_per_hour: number | null;
  signal_change_count: number;
  sim_duration_s: number;
  sample_count: number;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface RouteSwitchRow {
  id: number;
  event_id: number;
  sim_time_s: number;
  from_route_id: number | null;
  to_route_id: number | null;
  old_eta_s: number | null;
  new_eta_s: number | null;
  reason: string;
  created_at: Date;
}

export class MetricsRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async upsertRunMetrics(metrics: SimulationMetrics): Promise<void> {
    await this.db.query(
      `INSERT INTO simulation_metrics
         (run_id, mode, emergency_travel_time_s, emergency_time_loss_s, avg_vehicle_delay_s,
          avg_queue_length, avg_speed_mps, throughput_per_hour, signal_change_count,
          sim_duration_s, sample_count, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (run_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         emergency_travel_time_s = EXCLUDED.emergency_travel_time_s,
         emergency_time_loss_s = EXCLUDED.emergency_time_loss_s,
         avg_vehicle_delay_s = EXCLUDED.avg_vehicle_delay_s,
         avg_queue_length = EXCLUDED.avg_queue_length,
         avg_speed_mps = EXCLUDED.avg_speed_mps,
         throughput_per_hour = EXCLUDED.throughput_per_hour,
         signal_change_count = EXCLUDED.signal_change_count,
         sim_duration_s = EXCLUDED.sim_duration_s,
         sample_count = EXCLUDED.sample_count,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at`,
      [
        metrics.runId,
        metrics.mode,
        metrics.emergencyTravelTimeS,
        metrics.emergencyTimeLossS,
        metrics.avgVehicleDelayS,
        metrics.avgQueueLength,
        metrics.avgSpeedMps,
        metrics.throughputPerHour,
        metrics.signalChangeCount,
        metrics.simDurationS,
        metrics.sampleCount,
        metrics.startedAtIso,
        metrics.completedAtIso,
      ],
    );
  }

  async getRunMetrics(runId: number): Promise<SimulationMetricsRow | null> {
    const result = await this.db.query<SimulationMetricsRow>(
      `SELECT * FROM simulation_metrics WHERE run_id = $1`,
      [runId],
    );
    return result.rows[0] ?? null;
  }

  async listRunMetrics(): Promise<SimulationMetricsRow[]> {
    const result = await this.db.query<SimulationMetricsRow>(
      `SELECT m.* FROM simulation_metrics m ORDER BY m.run_id DESC`,
    );
    return result.rows;
  }

  async insertRouteSwitch(row: {
    eventId: number;
    simTimeS: number;
    fromRouteId: number | null;
    toRouteId: number | null;
    oldEtaS: number;
    newEtaS: number;
    reason: string;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO emergency_route_switches
         (event_id, sim_time_s, from_route_id, to_route_id, old_eta_s, new_eta_s, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [row.eventId, row.simTimeS, row.fromRouteId, row.toRouteId, row.oldEtaS, row.newEtaS, row.reason],
    );
    return result.rows[0]!.id;
  }

  async countRouteSwitches(eventId: number): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM emergency_route_switches WHERE event_id = $1`,
      [eventId],
    );
    return Number(result.rows[0]!.count);
  }

  async lastSwitchSimTime(eventId: number): Promise<number | null> {
    const result = await this.db.query<{ sim_time_s: number | null }>(
      `SELECT sim_time_s FROM emergency_route_switches WHERE event_id = $1 ORDER BY id DESC LIMIT 1`,
      [eventId],
    );
    return result.rows[0]?.sim_time_s ?? null;
  }

  // ------------------------------------------------------------------
  // Persisted comparisons (analytics)
  // ------------------------------------------------------------------

  async insertComparison(input: {
    jobId: string;
    type: string;
    originJunction: string;
    destinationJunction: string;
    priority: string;
    baselineRunId: number | null;
    itmsRunId: number | null;
    deltas: {
      emergencyTravelTimeS: number | null;
      avgVehicleDelayS: number | null;
      avgQueueLength: number | null;
      avgSpeedMps: number | null;
      throughputPerHour: number | null;
      signalChangeCount: number | null;
    } | null;
    completedAtIso: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO comparisons
         (job_id, type, origin_junction, destination_junction, priority,
          baseline_run_id, itms_run_id,
          delta_travel_time_s, delta_avg_delay_s, delta_avg_queue,
          delta_avg_speed_mps, delta_throughput_per_h, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.jobId,
        input.type,
        input.originJunction,
        input.destinationJunction,
        input.priority,
        input.baselineRunId,
        input.itmsRunId,
        input.deltas?.emergencyTravelTimeS ?? null,
        input.deltas?.avgVehicleDelayS ?? null,
        input.deltas?.avgQueueLength ?? null,
        input.deltas?.avgSpeedMps ?? null,
        input.deltas?.throughputPerHour ?? null,
        input.completedAtIso,
      ],
    );
  }

  async listCompletedComparisons(): Promise<Array<{
    job_id: string;
    delta_travel_time_s: number | null;
    delta_avg_delay_s: number | null;
    delta_avg_queue: number | null;
    delta_avg_speed_mps: number | null;
    delta_throughput_per_h: number | null;
    completed_at: Date | null;
  }>> {
    const result = await this.db.query<{
      job_id: string;
      delta_travel_time_s: number | null;
      delta_avg_delay_s: number | null;
      delta_avg_queue: number | null;
      delta_avg_speed_mps: number | null;
      delta_throughput_per_h: number | null;
      completed_at: Date | null;
    }>(
      `SELECT job_id, delta_travel_time_s, delta_avg_delay_s, delta_avg_queue,
              delta_avg_speed_mps, delta_throughput_per_h, completed_at
       FROM comparisons WHERE completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 100`,
    );
    return result.rows;
  }
}
