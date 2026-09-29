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
  driver_id?: number | null;
  fleet_vehicle_id?: number | null;
  hospital_id?: number | null;
  patient_condition?: string | null;
  severity?: string | null;
  authorization_status?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
  activated_at: Date | null;
  arrived_at: Date | null;
  driver_name?: string | null;
  driver_code?: string | null;
  driver_phone?: string | null;
  driver_license?: string | null;
  vehicle_code?: string | null;
  registration_number?: string | null;
  vehicle_model?: string | null;
  vehicle_type?: string | null;
  last_latitude?: number | null;
  last_longitude?: number | null;
  last_speed_kmh?: number | null;
  last_heading?: number | null;
  last_telemetry_at?: Date | null;
  hospital_name?: string | null;
  hospital_code?: string | null;
  hospital_address?: string | null;
  hospital_phone?: string | null;
  hospital_available_beds?: number | null;
  hospital_trauma_level?: string | null;
  origin_address?: string | null;
  destination_address?: string | null;
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
  verification_id?: number | null;
  request_id?: string | null;
  verification_status?: string | null;
  is_corridor_authorized?: boolean | null;
  verification_submitted_at?: Date | null;
  evidence_id?: number | null;
  evidence_file_name?: string | null;
  evidence_file_size?: number | null;
  evidence_uploaded_at?: Date | null;
  ai_verdict?: string | null;
  ai_confidence_score?: number | null;
  ai_reason?: string | null;
  ai_detected_features?: string[] | null;
  ai_model?: string | null;
  ai_evaluated_at?: Date | null;
  reviewer_name?: string | null;
  review_notes?: string | null;
  rejection_reason?: string | null;
  review_decided_at?: Date | null;
  has_patient_image?: boolean | null;
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
  driverId?: number | null;
  fleetVehicleId?: number | null;
  hospitalId?: number | null;
  patientCondition?: string | null;
  severity?: string | null;
  authorizationStatus?: string | null;
  originAddress?: string | null;
  destinationAddress?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
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
      // Ensure origin and destination junctions exist in intersections table (defense-in-depth against legacy FKs)
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
           (vehicle_id, origin_junction, destination_junction, priority, status,
            driver_id, fleet_vehicle_id, hospital_id, patient_condition, severity, authorization_status,
            origin_address, destination_address, pickup_latitude, pickup_longitude)
         VALUES ($1, $2, $3, $4, 'created', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          vehicle.id,
          input.originJunction,
          input.destinationJunction,
          input.priority,
          input.driverId ?? null,
          input.fleetVehicleId ?? null,
          input.hospitalId ?? null,
          input.patientCondition ?? null,
          input.severity ?? "codeRed",
          input.authorizationStatus ?? "pending",
          input.originAddress ?? null,
          input.destinationAddress ?? null,
          input.pickupLatitude ?? null,
          input.pickupLongitude ?? null,
        ],
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

        // Pre-flight safety: Ensure all referenced junctions and segments exist in tables to satisfy legacy foreign keys
        for (const edge of route.edges) {
          await tx.query(
            `INSERT INTO intersections (id, kind, controlled, x, y, geom)
             VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
             ON CONFLICT (id) DO NOTHING`,
            [edge.fromJunction],
          );
          await tx.query(
            `INSERT INTO intersections (id, kind, controlled, x, y, geom)
             VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
             ON CONFLICT (id) DO NOTHING`,
            [edge.toJunction],
          );
          await tx.query(
            `INSERT INTO roads (id, name, from_junction, to_junction)
             VALUES ($1, $1, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [edge.segmentId, edge.fromJunction, edge.toJunction],
          );
          try {
            await tx.query(
              `INSERT INTO road_segments (id, road_id, from_junction, to_junction, lane_count, length_m, max_speed_mps, geom)
               VALUES ($1, $1, $2, $3, 1, $4, 13.89, ST_GeomFromText('LINESTRING(0 0, 1 1)', 0))
               ON CONFLICT (id) DO NOTHING`,
              [edge.segmentId, edge.fromJunction, edge.toJunction, Math.max(1, edge.lengthM)],
            );
          } catch {
            // Non-fatal if road_segments constraint is relaxed or already satisfied
          }
        }

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

  private buildEventSelectQuery(whereOrOrder: string): string {
    return `SELECT e.*,
              d.name AS driver_name,
              d.driver_code,
              d.phone AS driver_phone,
              d.license_number AS driver_license,
              fv.vehicle_code,
              fv.registration_number,
              fv.model AS vehicle_model,
              fv.vehicle_type,
              fv.last_latitude,
              fv.last_longitude,
              fv.last_speed_kmh,
              fv.last_heading,
              fv.last_telemetry_at,
              h.name AS hospital_name,
              h.code AS hospital_code,
              h.address AS hospital_address,
              h.emergency_phone AS hospital_phone,
              h.available_beds AS hospital_available_beds,
              h.trauma_level AS hospital_trauma_level,
              v.id AS verification_id,
              v.request_id,
              COALESCE(v.status, 'pending') AS verification_status,
              COALESCE(v.is_corridor_authorized, false) AS is_corridor_authorized,
              v.submitted_at AS verification_submitted_at,
              ev.id AS evidence_id,
              ev.file_name AS evidence_file_name,
              ev.file_size_bytes AS evidence_file_size,
              ev.uploaded_at AS evidence_uploaded_at,
              ai.verdict AS ai_verdict,
              ai.confidence_score AS ai_confidence_score,
              ai.reason AS ai_reason,
              ai.detected_features AS ai_detected_features,
              ai.model AS ai_model,
              ai.evaluated_at AS ai_evaluated_at,
              mvd.reviewer_name,
              mvd.notes AS review_notes,
              mvd.rejection_reason,
              mvd.decided_at AS review_decided_at,
              (ev.id IS NOT NULL) AS has_patient_image
       FROM emergency_events e
       LEFT JOIN drivers d ON d.id = e.driver_id
       LEFT JOIN fleet_vehicles fv ON fv.id = e.fleet_vehicle_id
       LEFT JOIN hospitals h ON h.id = e.hospital_id
       LEFT JOIN LATERAL (
         SELECT id, request_id, status, is_corridor_authorized, submitted_at
         FROM emergency_verifications
         WHERE event_id = e.id
         ORDER BY id DESC
         LIMIT 1
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT id, file_name, file_size_bytes, uploaded_at
         FROM emergency_evidence
         WHERE event_id = e.id
         ORDER BY id DESC
         LIMIT 1
       ) ev ON true
       LEFT JOIN LATERAL (
         SELECT verdict, confidence_score, reason, detected_features, model, evaluated_at
         FROM ai_verification_results
         WHERE verification_id = v.id
         ORDER BY id DESC
         LIMIT 1
       ) ai ON true
       LEFT JOIN LATERAL (
         SELECT reviewer_name, notes, rejection_reason, decided_at
         FROM manual_verification_decisions
         WHERE verification_id = v.id
         ORDER BY id DESC
         LIMIT 1
       ) mvd ON true
       ${whereOrOrder}`;
  }

  async getEvent(id: number): Promise<EmergencyEventRow | null> {
    const result = await this.db.query<EmergencyEventRow>(
      this.buildEventSelectQuery("WHERE e.id = $1"),
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listEvents(): Promise<EmergencyEventRow[]> {
    const result = await this.db.query<EmergencyEventRow>(
      this.buildEventSelectQuery("ORDER BY e.id DESC"),
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
    /** Simulation times captured at the transition (metrics). */
    activatedSimTimeS?: number | null;
    arrivedSimTimeS?: number | null;
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
           activated_sim_time_s = COALESCE($5, activated_sim_time_s),
           arrived_sim_time_s = COALESCE($6, arrived_sim_time_s),
           last_position_x = COALESCE($7, last_position_x),
           last_position_y = COALESCE($8, last_position_y),
           last_speed_mps = COALESCE($9, last_speed_mps)
         WHERE id = $1`,
        [
          input.vehicleRowId,
          input.status,
          input.activatedAtIso,
          input.arrivedAtIso,
          input.activatedSimTimeS ?? null,
          input.arrivedSimTimeS ?? null,
          input.positionX,
          input.positionY,
          input.speedMps,
        ],
      );
    });
  }

  /** Persists a dynamic route revision and points the event at it. */
  async addRouteRevision(input: {
    eventId: number;
    originJunction: string;
    destinationJunction: string;
    edges: Array<{ segmentId: string; fromJunction: string; toJunction: string; lengthM: number; costSeconds: number; congestion: string | null }>;
    estimatedTravelTimeS: number;
    freeFlowTravelTimeS: number;
    reason: string;
    simTimeS: number;
    fromRouteId: number | null;
  }): Promise<number> {
    return this.db.transaction(async (tx) => {
      const routeResult = await tx.query<{ id: number }>(
        `INSERT INTO routes
           (event_id, algorithm, origin_junction, destination_junction, edge_count,
            total_length_m, estimated_travel_time_s, free_flow_travel_time_s)
         VALUES ($1, 'astar', $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          input.eventId,
          input.originJunction,
          input.destinationJunction,
          input.edges.length,
          input.edges.reduce((sum, edge) => sum + edge.lengthM, 0),
          input.estimatedTravelTimeS,
          input.freeFlowTravelTimeS,
        ],
      );
      const routeId = routeResult.rows[0]!.id;

      // Pre-flight safety: Ensure all referenced junctions and segments exist in tables to satisfy legacy foreign keys
      for (const edge of input.edges) {
        await tx.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
           ON CONFLICT (id) DO NOTHING`,
          [edge.fromJunction],
        );
        await tx.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
           ON CONFLICT (id) DO NOTHING`,
          [edge.toJunction],
        );
        await tx.query(
          `INSERT INTO roads (id, name, from_junction, to_junction)
           VALUES ($1, $1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [edge.segmentId, edge.fromJunction, edge.toJunction],
        );
        try {
          await tx.query(
            `INSERT INTO road_segments (id, road_id, from_junction, to_junction, lane_count, length_m, max_speed_mps, geom)
             VALUES ($1, $1, $2, $3, 1, $4, 13.89, ST_GeomFromText('LINESTRING(0 0, 1 1)', 0))
             ON CONFLICT (id) DO NOTHING`,
            [edge.segmentId, edge.fromJunction, edge.toJunction, Math.max(1, edge.lengthM)],
          );
        } catch {
          // Non-fatal if road_segments constraint is relaxed or already satisfied
        }
      }

      const values: unknown[] = [];
      const placeholders = input.edges.map((edge, index) => {
        const adjusted = index * 7;
        values.push(routeId, index, edge.segmentId, edge.fromJunction, edge.toJunction, edge.lengthM, edge.costSeconds);
        return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7})`;
      });
      await tx.query(
        `INSERT INTO route_segments
           (route_id, sequence_index, segment_id, from_junction, to_junction, length_m, cost_seconds)
         VALUES ${placeholders.join(", ")}`,
        values,
      );
      await tx.query(`UPDATE emergency_events SET route_id = $2 WHERE id = $1`, [input.eventId, routeId]);
      await tx.query(
        `INSERT INTO emergency_route_switches
           (event_id, sim_time_s, from_route_id, to_route_id, new_eta_s, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.eventId, input.simTimeS, input.fromRouteId, routeId, input.estimatedTravelTimeS, input.reason],
      );
      return routeId;
    });
  }

  async completeEmergency(eventId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      await tx.query(
        `UPDATE emergency_events
         SET status = 'completed', completed_at = $1
         WHERE id = $2`,
        [nowIso, eventId],
      );
      await tx.query(
        `UPDATE emergency_vehicles
         SET status = 'arrived', arrived_at = $1
         WHERE id = (SELECT vehicle_id FROM emergency_events WHERE id = $2)`,
        [nowIso, eventId],
      );
    });
  }

  async cancelEmergency(eventId: number, reason: string, cancelledBy = "driver"): Promise<void> {
    await this.db.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      await tx.query(
        `UPDATE emergency_events
         SET status = 'cancelled', cancelled_by = $1, cancellation_reason = $2, cancelled_at = $3
         WHERE id = $4`,
        [cancelledBy, reason, nowIso, eventId],
      );
      await tx.query(
        `UPDATE emergency_vehicles
         SET status = 'cancelled'
         WHERE id = (SELECT vehicle_id FROM emergency_events WHERE id = $1)`,
        [eventId],
      );
    });
  }

  async getEventsByDriver(driverId: number): Promise<EmergencyEventRow[]> {
    const result = await this.db.query<EmergencyEventRow & { destination_address?: string }>(
      `SELECT e.*, h.name as destination_address 
       FROM emergency_events e 
       LEFT JOIN hospitals h ON e.hospital_id = h.id 
       WHERE e.driver_id = $1 
       ORDER BY e.id DESC 
       LIMIT 50`,
      [driverId],
    );
    return result.rows;
  }
}
