import type { DatabasePool } from "../db.ts";
import type {
  CorridorSignalPlanEntry,
  CorridorSignalStatus,
  CorridorState,
  EmergencyPriority,
} from "@itms/types";

/**
 * Persistence for green corridors and their per-signal plans. Transitions
 * (activation, application, passage, completion/cancel/failure) are written
 * as they happen.
 */

export interface GreenCorridorRow {
  id: number;
  event_id: number;
  status: CorridorState;
  origin_junction: string;
  destination_junction: string;
  junction_count: number;
  planned_at_sim_time_s: number | null;
  planned_at: Date;
  activated_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  failed_at: Date | null;
  cancel_reason: string | null;
  last_error: string | null;
}

export interface CorridorSignalRow {
  id: number;
  corridor_id: number;
  signal_id: string;
  sequence_index: number;
  approach_segment_id: string;
  eta_seconds: number | null;
  planned_green_start_s: number | null;
  planned_green_end_s: number | null;
  planned_state: string | null;
  applied_state: string | null;
  mode: "switch" | "extend" | "noop";
  requires_clearance: boolean;
  status: CorridorSignalStatus;
  skip_reason: string | null;
  predicted_vehicle_count: number | null;
  applied_at: Date | null;
  passed_at: Date | null;
}

export interface NewCorridorInput {
  eventId: number;
  originJunction: string;
  destinationJunction: string;
  plannedAtSimTimeS: number;
  signals: CorridorSignalPlanEntry[];
}

export class CorridorRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  /** Persists a corridor with all planned signal entries in one transaction. */
  async createCorridor(input: NewCorridorInput): Promise<GreenCorridorRow> {
    const plannedEntries = input.signals.filter((entry) => entry.status !== "SKIPPED");
    const skipped = input.signals.filter((entry) => entry.status === "SKIPPED");
    const corridor = await this.db.transaction(async (tx) => {
      if (input.originJunction) {
        await tx.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
           ON CONFLICT (id) DO NOTHING`,
          [input.originJunction],
        ).catch(() => undefined);
      }
      if (input.destinationJunction) {
        await tx.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
           ON CONFLICT (id) DO NOTHING`,
          [input.destinationJunction],
        ).catch(() => undefined);
      }

      const result = await tx.query<GreenCorridorRow>(
        `INSERT INTO green_corridors
           (event_id, status, origin_junction, destination_junction, junction_count, planned_at_sim_time_s)
         VALUES ($1, 'PLANNING', $2, $3, $4, $5) RETURNING *`,
        [input.eventId, input.originJunction, input.destinationJunction, plannedEntries.length, input.plannedAtSimTimeS],
      );
      const corridorRow = result.rows[0]!;
      const all = [...plannedEntries, ...skipped];
      if (all.length > 0) {
        const values: unknown[] = [];
        const placeholders = all.map((entry, index) => {
          const adjusted = index * 12;
          values.push(
            corridorRow.id,
            entry.sequenceIndex,
            entry.signalId,
            entry.approachSegmentId,
            entry.etaSeconds,
            entry.plannedGreenStartS,
            entry.plannedGreenEndS,
            entry.corridorState,
            entry.mode,
            entry.requiresClearance,
            entry.status,
            entry.skipReason,
          );
          return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7}, $${adjusted + 8}, $${adjusted + 9}, $${adjusted + 10}, $${adjusted + 11}, $${adjusted + 12})`;
        });
        await tx.query(
          `INSERT INTO corridor_signals
             (corridor_id, sequence_index, signal_id, approach_segment_id, eta_seconds,
              planned_green_start_s, planned_green_end_s, planned_state, mode,
              requires_clearance, status, skip_reason)
           VALUES ${placeholders.join(", ")}`,
          values,
        );
      }
      // A corridor with no plannable junctions fails immediately.
      if (plannedEntries.length === 0) {
        const failed = await tx.query<GreenCorridorRow>(
          `UPDATE green_corridors SET status = 'FAILED', failed_at = now(), last_error = $2
           WHERE id = $1 RETURNING *`,
          [corridorRow.id, "No junction passed the safety validation"],
        );
        return failed.rows[0]!;
      }
      return corridorRow;
    });
    return corridor;
  }

  async getCorridor(id: number): Promise<GreenCorridorRow | null> {
    const result = await this.db.query<GreenCorridorRow>(
      `SELECT * FROM green_corridors WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listCorridors(): Promise<GreenCorridorRow[]> {
    const result = await this.db.query<GreenCorridorRow>(
      `SELECT * FROM green_corridors ORDER BY id DESC`,
    );
    return result.rows;
  }

  async getCorridorSignals(corridorId: number): Promise<CorridorSignalRow[]> {
    const result = await this.db.query<CorridorSignalRow>(
      `SELECT * FROM corridor_signals WHERE corridor_id = $1 ORDER BY sequence_index`,
      [corridorId],
    );
    return result.rows;
  }

  async setStatus(
    corridorId: number,
    status: CorridorState,
    field: "activated_at" | "completed_at" | "cancelled_at" | "failed_at",
    reason: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE green_corridors SET status = $2, ${field} = now(),
         cancel_reason = COALESCE($3, cancel_reason),
         last_error = CASE WHEN $2 = 'FAILED' THEN COALESCE($3, last_error) ELSE last_error END
       WHERE id = $1`,
      [corridorId, status, reason],
    );
  }

  async markApplied(
    corridorId: number,
    sequenceIndex: number,
    appliedState: string,
    predictedCount: number | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE corridor_signals SET status = 'APPLIED', applied_state = $3, applied_at = now(),
         predicted_vehicle_count = COALESCE($4, predicted_vehicle_count)
       WHERE corridor_id = $1 AND sequence_index = $2`,
      [corridorId, sequenceIndex, appliedState, predictedCount],
    );
  }

  async markPassed(corridorId: number, sequenceIndex: number): Promise<void> {
    await this.db.query(
      `UPDATE corridor_signals SET status = 'PASSED', passed_at = now()
       WHERE corridor_id = $1 AND sequence_index = $2`,
      [corridorId, sequenceIndex],
    );
  }

  /** Rolls a corridor's planned windows forward after a replan. */
  async replanSignal(
    corridorId: number,
    sequenceIndex: number,
    plannedGreenStartS: number,
    plannedGreenEndS: number,
    etaSeconds: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE corridor_signals SET planned_green_start_s = $3, planned_green_end_s = $4, eta_seconds = $5,
         status = CASE WHEN status = 'APPLIED' THEN 'APPLIED' ELSE 'PENDING' END
       WHERE corridor_id = $1 AND sequence_index = $2`,
      [corridorId, sequenceIndex, plannedGreenStartS, plannedGreenEndS, etaSeconds],
    );
  }

  /** Marks a corridor signal skipped with a reason (e.g. route change). */
  async setSignalSkipped(corridorId: number, sequenceIndex: number, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE corridor_signals SET status = 'SKIPPED', skip_reason = $3
       WHERE corridor_id = $1 AND sequence_index = $2`,
      [corridorId, sequenceIndex, reason],
    );
  }

  /** Appends a junction entry to a persisted corridor plan. */
  async appendSignal(input: {
    corridorId: number;
    sequenceIndex: number;
    signalId: string;
    approachSegmentId: string;
    etaSeconds: number | null;
    mode: "switch" | "extend" | "noop";
    corridorState: string | null;
    requiresClearance: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO corridor_signals
         (corridor_id, sequence_index, signal_id, approach_segment_id, eta_seconds,
          mode, planned_state, requires_clearance, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
      [
        input.corridorId,
        input.sequenceIndex,
        input.signalId,
        input.approachSegmentId,
        input.etaSeconds,
        input.mode,
        input.corridorState,
        input.requiresClearance,
      ],
    );
  }
}

/** Priority ranking used by the corridor eligibility check. */
export function priorityRank(priority: EmergencyPriority): number {
  switch (priority) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "normal":
      return 1;
  }
}
