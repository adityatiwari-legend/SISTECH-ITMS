import type { DatabasePool } from "../db.ts";
import type { NetworkCatalog } from "../../modules/simulation/network-loader.ts";

/**
 * Persists and reads the static network registry (junctions, roads,
 * segments, signals, phases). The SUMO network files are the source of
 * truth; this repository synchronizes them into PostgreSQL/PostGIS.
 */

export interface RoadRow {
  id: string;
  name: string;
  from_junction: string;
  to_junction: string;
}

export interface SegmentRow {
  id: string;
  road_id: string;
  from_junction: string;
  to_junction: string;
  lane_count: number;
  length_m: number;
  max_speed_mps: number;
}

export interface IntersectionRow {
  id: string;
  kind: string;
  controlled: boolean;
  x: number;
  y: number;
  signal_id: string | null;
}

export class NetworkRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  /** Idempotently syncs the network catalog into the registry tables. */
  async syncCatalog(catalog: NetworkCatalog): Promise<void> {
    await this.db.transaction(async (client) => {
      for (const junction of catalog.junctions) {
        const signal = catalog.signals.find((s) => s.id === junction.id) ?? null;
        await client.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 0))
           ON CONFLICT (id) DO UPDATE SET
             kind = EXCLUDED.kind, controlled = EXCLUDED.controlled,
             x = EXCLUDED.x, y = EXCLUDED.y, geom = EXCLUDED.geom`,
          [
            junction.id,
            junction.kind,
            signal !== null,
            junction.x,
            junction.y,
            `POINT(${junction.x} ${junction.y})`,
          ],
        );
      }

      for (const road of catalog.roads) {
        await client.query(
          `INSERT INTO roads (id, name, from_junction, to_junction)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
          [road.id, road.id, road.fromJunction, road.toJunction],
        );
      }

      for (const segment of catalog.segments) {
        if (segment.lanes.length === 0) continue;
        // Geometry from the first lane's shape (all lanes share the line).
        const shape = segment.lanes[0]!.shape;
        const lineText =
          shape.length >= 2
            ? `LINESTRING(${shape.map((p) => `${p.x} ${p.y}`).join(", ")})`
            : null;
        if (lineText === null) continue;
        const laneCount = segment.lanes.length;
        const lengthM = Math.max(...segment.lanes.map((lane) => lane.lengthM));
        const maxSpeed = Math.max(...segment.lanes.map((lane) => lane.speedMps));
        await client.query(
          `INSERT INTO road_segments
             (id, road_id, from_junction, to_junction, lane_count, length_m, max_speed_mps, geom)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromText($8, 0))
           ON CONFLICT (id) DO UPDATE SET
             road_id = EXCLUDED.road_id,
             from_junction = EXCLUDED.from_junction,
             to_junction = EXCLUDED.to_junction,
             lane_count = EXCLUDED.lane_count,
             length_m = EXCLUDED.length_m,
             max_speed_mps = EXCLUDED.max_speed_mps,
             geom = EXCLUDED.geom`,
          [
            segment.id,
            roadIdForSegment(catalog, segment.id),
            segment.fromJunction,
            segment.toJunction,
            laneCount,
            lengthM,
            maxSpeed,
            lineText,
          ],
        );
      }

      for (const signal of catalog.signals) {
        await client.query(
          `INSERT INTO traffic_signals (id, intersection_id, program_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET program_id = EXCLUDED.program_id`,
          [signal.id, signal.id, signal.programId],
        );
        for (const phase of signal.phases) {
          await client.query(
            `INSERT INTO signal_phases (signal_id, program_id, phase_index, duration_s, state)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (signal_id, program_id, phase_index) DO UPDATE SET
               duration_s = EXCLUDED.duration_s, state = EXCLUDED.state`,
            [signal.id, signal.programId, phase.index, phase.durationS, phase.state],
          );
        }
      }
    });
  }

  async getRoads(): Promise<Array<RoadRow & { segments: SegmentRow[] }>> {
    const roads = await this.db.query<RoadRow>(
      `SELECT id, name, from_junction, to_junction FROM roads ORDER BY id`,
    );
    const segments = await this.db.query<SegmentRow>(
      `SELECT id, road_id, from_junction, to_junction, lane_count, length_m, max_speed_mps
       FROM road_segments ORDER BY id`,
    );
    const byRoad = new Map<string, SegmentRow[]>();
    for (const segment of segments.rows) {
      const list = byRoad.get(segment.road_id) ?? [];
      list.push(segment);
      byRoad.set(segment.road_id, list);
    }
    return roads.rows.map((road) => ({
      ...road,
      segments: byRoad.get(road.id) ?? [],
    }));
  }

  async getIntersections(): Promise<IntersectionRow[]> {
    const result = await this.db.query<IntersectionRow & { signal_id: string | null }>(
      `SELECT i.id, i.kind, i.controlled, i.x, i.y, s.id AS signal_id
       FROM intersections i
       LEFT JOIN traffic_signals s ON s.intersection_id = i.id
       ORDER BY i.id`,
    );
    return result.rows;
  }
}

function roadIdForSegment(catalog: NetworkCatalog, segmentId: string): string {
  const road = catalog.roads.find((r) => r.segmentIds.includes(segmentId));
  if (road === undefined) {
    throw new Error(`Segment ${segmentId} has no parent road in the network catalog`);
  }
  return road.id;
}
