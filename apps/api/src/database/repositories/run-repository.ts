import type { DatabasePool } from "../db.ts";
import type { SimulationScenarioId } from "@itms/types";

/**
 * Simulation run identity (Rules.md 10: every persisted simulation record
 * must be identifiable by scenario and run).
 */

export interface SimulationRunRow {
  id: number;
  scenario: SimulationScenarioId;
  status: "running" | "completed" | "failed";
  sumo_version: string | null;
  started_at: Date;
  ended_at: Date | null;
}

export class RunRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async createRun(input: {
    scenario: SimulationScenarioId;
    sumoVersion: string | null;
    stepLengthSeconds: number;
  }): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO simulation_runs (scenario, status, sumo_version, step_length_s)
       VALUES ($1, 'running', $2, $3) RETURNING id`,
      [input.scenario, input.sumoVersion, input.stepLengthSeconds],
    );
    return result.rows[0]!.id;
  }

  async completeRun(runId: number, failed: boolean): Promise<void> {
    await this.db.query(
      `UPDATE simulation_runs SET status = $2, ended_at = now() WHERE id = $1`,
      [runId, failed ? "failed" : "completed"],
    );
  }
}
