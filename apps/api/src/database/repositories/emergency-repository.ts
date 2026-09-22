import type { DatabasePool, QueryClient } from "../db.ts";
import type { EmergencyType, EmergencyPriority, EmergencyStatus } from "@itms/types";

/**
 * Persistence for emergency vehicles, events, routes and route segments.
 * Transitions (created → active → arrived/failed) are updated as they
 * happen; live position/speed stay in memory and are flushed to the
 * vehicle record on transitions.
 */

export interface EmergencyVehicleRow {
  id: number;
  vehicle_id: string;
  type: EmergencyType;
  priority: EmergencyPriority;
  status: EmergencyStatus;
  run_id: number | null;
  origin_junction: string;
  destination_junction: string;
  last_position_x: number | null;
  last_position_y: number | null;
  last_speed_mps: number | null;
  created_at: Date;
  activated_at: Date | null;
  arrived_at: Date | null;
}

export interface EmergencyEventRow {
  id: number;
  vehicle_id: number;
  route_id: number | null;
  origin_junction: string;
  destination_junction: string;
  priority: EmergencyPriority;
  status: EmergencyStatus;
  created_at: Date;
  activated_at: Date | null;
  arrived_at: Date | null;
}

export interface RouteRow {
  id: number;
  event_id: number | null;
  algorithm: string;
  origin_junction: string;
  destination_junction: string;
  edge_count: number;
  total_length_m: number;
  estimated_travel_time_s: number;
  free_flow_travel_time_s: number;
  created_at: Date;
}

export interface RouteSegmentRow {
  id: number;
  route_id: number;
  sequence_index: number;
  segment_id: string;
  from_junction: string;
  to_junction: string;
  length_m: number;
  cost_seconds: number;
}

export interface NewEmergencyInput {
  type: EmergencyType;
  priority: EmergencyPriority;
  originJunction: string;
  destinationJunction: string;
  vehicleId: string;
  runId: number | null;
}

export interface NewRouteInput {
  edges: Array<{
    segmentId: string;
    fromJunction: string;
    toJunction: string;
    lengthM: number;
    costSeconds: number;
    congestion: string | null;
  }>;
  estimatedTravelTimeS: number;
  freeFlowTravelTimeS: number;
}

export class EmergencyRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  /** Creates vehicle + event + route + route segments in one transaction. */
  async createEmergency(input: NewEmergencyInput, route: NewRouteInput | null): Promise<{
    vehicle: EmergencyVehicleRow;
    event: EmergencyEventRow;
    route: RouteRow | null;
  }> {
    return this.db.transaction(async (tx) => {
      const vehicleResult = await tx.query<EmergencyVehicleRow>(
        `INSERT INTO emergency_vehicles
           (vehicle_id, type, priority, status, run_id, origin_junction, destination_junction)
         VALUES ($1, $2, $3, 'created', $4, $5, $6) RETURNING *`,
        [
          input.vehicleId,
          input.type,
          input.priority,
          input.runId,
          input.originJunction,
          input.destinationJunction,
        ],
      );
      const vehicle = vehicleResult.rows[0]!;

      const eventResult = await tx.query<EmergencyEventRow>(
        `INSERT INTO emergency_events
           (vehicle_id, origin_junction, destination_junction, priority, status)
         VALUES ($1, $2, $3, $4, 'created') RETURNING *`,
        [vehicle.id, input.originJunction, input.destinationJunction, input.priority],
      );
      const event = eventResult.rows[0]!;

      let routeRow: RouteRow | null = null;
      if (route !== null) {
        const routeResult = await tx.query<RouteRow>(
          `INSERT INTO routes
             (event_id, algorithm, origin_junction, destination_junction, edge_count,
              total_length_m, estimated_travel_time_s, free_flow_travel_time_s)
           VALUES ($1, 'astar', $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            event.id,
            input.originJunction,
            input.destinationJunction,
            route.edges.length,
            route.edges.reduce((sum, edge) => sum + edge.lengthM, 0),
            route.estimatedTravelTimeS,
            route.freeFlowTravelTimeS,
          ],
        );
        routeRow = routeResult.rows[0]!;
        const segmentValues: unknown[] = [];
        const sevenPlaceholders = route.edges.map((edge, index) => {
          const adjusted = index * 7;
          segmentValues.push(
            routeRow!.id,
            index,
            edge.segmentId,
            edge.fromJunction,
            edge.toJunction,
            edge.lengthM,
            edge.costSeconds,
          );
          return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7})`;
        });
        await tx.query(
          `INSERT INTO route_segments
             (route_id, sequence_index, segment_id, from_junction, to_junction, length_m, cost_seconds)
           VALUES ${sevenPlaceholders.join(", ")}`,
          segmentValues,
        );
        await tx.query(`UPDATE emergency_events SET route_id = $2 WHERE id = $1`, [event.id, routeRow.id]);
        event.route_id = routeRow.id;
      }

      return { vehicle, event, route: routeRow };
    });
  }

  async getEvent(id: number): Promise<EmergencyEventRow | null> {
    const result = await this.db.query<EmergencyEventRow>(
      `SELECT * FROM emergency_events WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listEvents(): Promise<EmergencyEventRow[]> {
    const result = await this.db.query<EmergencyEventRow>(
      `SELECT * FROM emergency_events ORDER BY id DESC`,
    );
    return result.rows;
  }

  async getVehicle(id: number): Promise<EmergencyVehicleRow | null> {
    const result = await this.db.query<EmergencyVehicleRow>(
      `SELECT * FROM emergency_vehicles WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getVehicleByVehicleId(vehicleId: string): Promise<EmergencyVehicleRow | null> {
    const result = await this.db.query<EmergencyVehicleRow>(
      `SELECT * FROM emergency_vehicles WHERE vehicle_id = $1`,
      [vehicleId],
    );
    return result.rows[0] ?? null;
  }

  async getRoute(id: number): Promise<RouteRow | null> {
    const result = await this.db.query<RouteRow>(`SELECT * FROM routes WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async getRouteSegments(routeId: number): Promise<RouteSegmentRow[]> {
    const result = await this.db.query<RouteSegmentRow>(
      `SELECT * FROM route_segments WHERE route_id = $1 ORDER BY sequence_index`,
      [routeId],
    );
    return result.rows;
  }

  /** Applies a status transition to event + vehicle and flushes live state. */
  async applyTransition(input: {
    eventId: number;
    vehicleRowId: number;
    status: EmergencyStatus;
    activatedAtIso: string | null;
    arrivedAtIso: string | null;
    positionX: number | null;
    positionY: number | null;
    speedMps: number | null;
  }): Promise<void> {
    await this.db.transaction(async (tx: QueryClient) => {
      const eventUpdate = await tx.query(
        `UPDATE emergency_events SET status = $2,
           activated_at = COALESCE($3, activated_at),
           arrived_at = COALESCE($4, arrived_at)
         WHERE id = $1`,
        [input.eventId, input.status, input.activatedAtIso, input.arrivedAtIso],
      );
      if (eventUpdate.rowCount === 0) {
        throw new Error(`Emergency event ${input.eventId} disappeared during transition`);
      }
      await tx.query(
        `UPDATE emergency_vehicles SET status = $2,
           activated_at = COALESCE($3, activated_at),
           arrived_at = COALESCE($4, arrived_at),
           last_position_x = COALESCE($5, last_position_x),
           last_position_y = COALESCE($6, last_position_y),
           last_speed_mps = COALESCE($7, last_speed_mps)
         WHERE id = $1`,
        [
          input.vehicleRowId,
          input.status,
          input.activatedAtIso,
          input.arrivedAtIso,
          input.positionX,
          input.positionY,
          input.speedMps,
        ],
      );
    });
  }
}
