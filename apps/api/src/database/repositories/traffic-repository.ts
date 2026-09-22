import type { QueryClient } from "../db.ts";
import type { VehicleSnapshot } from "@itms/types";
import type { SegmentMetrics } from "../../modules/traffic/metrics.ts";
import type { JunctionState } from "../../modules/traffic/collector.ts";

/**
 * Persists traffic snapshots, signal snapshots and the vehicle registry.
 * All writes are batched: one collection tick produces at most a few
 * multi-row statements, keeping write volume proportional to network size.
 *
 * Every method takes the query client explicitly so callers decide whether
 * writes run standalone (pool) or inside a transaction.
 */

export interface SegmentSnapshotRow {
  runId: number;
  simTimeSeconds: number;
  segment: SegmentMetrics;
}

export interface SignalSnapshotRow {
  runId: number;
  simTimeSeconds: number;
  junction: JunctionState;
  /** Congestion of the junction's approaches at this tick. */
  congestion: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export class TrafficRepository {
  /** Inserts one tick's segment snapshots in a single multi-row statement. */
  async insertSegmentSnapshots(
    client: QueryClient,
    rows: SegmentSnapshotRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders = rows.map((row, index) => {
      const adjusted = index * 9;
      values.push(
        row.runId,
        row.segment.segmentId,
        row.simTimeSeconds,
        row.segment.vehicleCount,
        row.segment.avgSpeedMps,
        row.segment.queueLength,
        row.segment.occupancy,
        row.segment.flowRatePerHour,
        row.segment.congestion,
      );
      return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7}, $${adjusted + 8}, $${adjusted + 9})`;
    });
    await client.query(
      `INSERT INTO traffic_snapshots
         (run_id, segment_id, sim_time_s, vehicle_count, avg_speed_mps, queue_length, occupancy, flow_rate_per_h, congestion)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  /** Inserts one tick's signal snapshots in a single multi-row statement. */
  async insertSignalSnapshots(
    client: QueryClient,
    rows: SignalSnapshotRow[],
  ): Promise<void> {
    const withSignal = rows.filter((row): row is SignalSnapshotRow & { junction: JunctionState & { signal: NonNullable<JunctionState["signal"]> } } =>
      row.junction.signal !== undefined,
    );
    if (withSignal.length === 0) return;
    const values: unknown[] = [];
    const placeholders = withSignal.map((row, index) => {
      const adjusted = index * 10;
      const signal = row.junction.signal;
      values.push(
        row.runId,
        row.junction.signal.id,
        row.simTimeSeconds,
        signal.program,
        signal.phaseIndex,
        signal.state,
        signal.phaseDurationSeconds,
        signal.nextSwitchAtSeconds,
        row.junction.queueLength,
        row.congestion,
      );
      return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7}, $${adjusted + 8}, $${adjusted + 9}, $${adjusted + 10})`;
    });
    await client.query(
      `INSERT INTO signal_snapshots
         (run_id, signal_id, sim_time_s, program_id, phase_index, state, phase_duration_s, next_switch_s, queue_length, congestion)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  /** Upserts the vehicle registry for one tick in a single statement. */
  async upsertVehicles(
    client: QueryClient,
    runId: number,
    vehicles: VehicleSnapshot[],
  ): Promise<void> {
    if (vehicles.length === 0) return;
    const values: unknown[] = [];
    const placeholders = vehicles.map((vehicle, index) => {
      const adjusted = index * 8;
      values.push(
        runId,
        vehicle.id,
        vehicle.typeId,
        vehicle.roadId,
        vehicle.laneId,
        vehicle.positionX,
        vehicle.positionY,
        vehicle.speed,
      );
      return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7}, $${adjusted + 8})`;
    });
    await client.query(
      `INSERT INTO vehicles (run_id, vehicle_id, type_id, edge_id, lane_id, position_x, position_y, speed_mps)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (run_id, vehicle_id) DO UPDATE SET
         type_id = EXCLUDED.type_id,
         edge_id = EXCLUDED.edge_id,
         lane_id = EXCLUDED.lane_id,
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         speed_mps = EXCLUDED.speed_mps,
         last_seen_at = now()`,
      values,
    );
  }
}
