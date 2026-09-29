import type { DatabasePool } from "../db.ts";
import type {
  DriverProfile,
  FleetVehicleRecord,
  HospitalRecord,
  PoliceZoneRecord,
  VerificationDetail,
} from "@itms/types";

export interface DriverRow {
  id: number;
  driver_code: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: "driver" | "admin" | "operator";
  status: "available" | "on_duty" | "off_duty" | "in_emergency";
  license_number: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FleetVehicleRow {
  id: number;
  vehicle_code: string;
  registration_number: string;
  vehicle_type: "ambulance" | "fire_engine" | "police";
  model: string;
  status: "available" | "assigned" | "in_emergency" | "maintenance";
  assigned_driver_id: number | null;
  current_emergency_id: number | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_heading: number | null;
  last_speed_kmh: number | null;
  last_telemetry_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface HospitalRow {
  id: number;
  name: string;
  code: string;
  address: string;
  latitude: number;
  longitude: number;
  emergency_phone: string | null;
  available_beds: number;
  trauma_level: string;
  nearest_junction_id: string;
  status: "active" | "diverting" | "full";
  created_at: Date;
}

export interface PoliceZoneRow {
  id: number;
  name: string;
  zone_code: string;
  headquarters_junction_id: string | null;
  contact_phone: string | null;
  active_officers_count: number;
  created_at: Date;
}

export interface VerificationRow {
  id: number;
  request_id: string;
  event_id: number;
  driver_id: number | null;
  vehicle_id: number | null;
  status: VerificationDetail["status"];
  is_corridor_authorized: boolean;
  submitted_at: Date;
  updated_at: Date;
}

export class MobileRepository {
  private readonly db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  // ------------------------------------------------------------- DRIVERS ----
  async getDriverByEmail(email: string): Promise<DriverRow | null> {
    const res = await this.db.query<DriverRow>(
      "SELECT * FROM drivers WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email.trim()],
    );
    return res.rows[0] ?? null;
  }

  async getDriverById(id: number): Promise<DriverRow | null> {
    const res = await this.db.query<DriverRow>(
      "SELECT * FROM drivers WHERE id = $1 LIMIT 1",
      [id],
    );
    return res.rows[0] ?? null;
  }

  async updateDriverStatus(id: number, status: DriverRow["status"]): Promise<void> {
    await this.db.query(
      "UPDATE drivers SET status = $1, updated_at = now() WHERE id = $2",
      [status, id],
    );
  }

  // ------------------------------------------------------ FLEET VEHICLES ----
  async listFleetVehicles(): Promise<FleetVehicleRecord[]> {
    const res = await this.db.query<FleetVehicleRow>(
      "SELECT * FROM fleet_vehicles ORDER BY vehicle_type, vehicle_code ASC",
    );
    return res.rows.map(this.mapFleetVehicle);
  }

  async getFleetVehicleById(id: number): Promise<FleetVehicleRecord | null> {
    const res = await this.db.query<FleetVehicleRow>(
      "SELECT * FROM fleet_vehicles WHERE id = $1 LIMIT 1",
      [id],
    );
    return res.rows[0] ? this.mapFleetVehicle(res.rows[0]) : null;
  }

  async getFleetVehicleByCode(code: string): Promise<FleetVehicleRecord | null> {
    const res = await this.db.query<FleetVehicleRow>(
      "SELECT * FROM fleet_vehicles WHERE vehicle_code = $1 LIMIT 1",
      [code],
    );
    return res.rows[0] ? this.mapFleetVehicle(res.rows[0]) : null;
  }

  async getAssignedVehicleForDriver(driverId: number): Promise<FleetVehicleRecord | null> {
    const res = await this.db.query<FleetVehicleRow>(
      "SELECT * FROM fleet_vehicles WHERE assigned_driver_id = $1 LIMIT 1",
      [driverId],
    );
    return res.rows[0] ? this.mapFleetVehicle(res.rows[0]) : null;
  }

  async assignVehicleToDriver(driverId: number, vehicleId: number): Promise<FleetVehicleRecord> {
    return this.db.transaction(async (tx) => {
      // 1. Unassign any current active vehicle assignment for this driver
      await tx.query(
        "UPDATE fleet_vehicles SET assigned_driver_id = NULL, status = 'available', updated_at = now() WHERE assigned_driver_id = $1",
        [driverId],
      );
      await tx.query(
        "UPDATE driver_vehicle_assignments SET is_active = false, unassigned_at = now() WHERE driver_id = $1 AND is_active = true",
        [driverId],
      );

      // 2. Assign target vehicle
      const res = await tx.query<FleetVehicleRow>(
        `UPDATE fleet_vehicles
         SET assigned_driver_id = $1, status = 'assigned', updated_at = now()
         WHERE id = $2 RETURNING *`,
        [driverId, vehicleId],
      );
      const vehicle = res.rows[0]!;

      // 3. Record assignment history
      await tx.query(
        "INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, is_active) VALUES ($1, $2, true)",
        [driverId, vehicleId],
      );

      return this.mapFleetVehicle(vehicle);
    });
  }

  async updateVehicleStatus(
    vehicleId: number,
    status: FleetVehicleRow["status"],
    currentEmergencyId: number | null = null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE fleet_vehicles
       SET status = $1, current_emergency_id = $2, updated_at = now()
       WHERE id = $3`,
      [status, currentEmergencyId, vehicleId],
    );
  }

  async updateVehicleTelemetry(
    vehicleId: number,
    telemetry: {
      latitude: number;
      longitude: number;
      heading?: number;
      speedKmh?: number;
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE fleet_vehicles
       SET last_latitude = $1,
           last_longitude = $2,
           last_heading = COALESCE($3, last_heading),
           last_speed_kmh = COALESCE($4, last_speed_kmh),
           last_telemetry_at = now(),
           updated_at = now()
       WHERE id = $5`,
      [
        telemetry.latitude,
        telemetry.longitude,
        telemetry.heading ?? null,
        telemetry.speedKmh ?? null,
        vehicleId,
      ],
    );
  }

  // ----------------------------------------------------------- HOSPITALS ----
  async listHospitals(): Promise<HospitalRecord[]> {
    const res = await this.db.query<HospitalRow>(
      "SELECT * FROM hospitals ORDER BY name ASC",
    );
    return res.rows.map(this.mapHospital);
  }

  async getHospitalById(id: number): Promise<HospitalRecord | null> {
    const res = await this.db.query<HospitalRow>(
      "SELECT * FROM hospitals WHERE id = $1 LIMIT 1",
      [id],
    );
    return res.rows[0] ? this.mapHospital(res.rows[0]) : null;
  }

  // -------------------------------------------------------- POLICE ZONES ----
  async listPoliceZones(): Promise<PoliceZoneRecord[]> {
    const res = await this.db.query<PoliceZoneRow>(
      "SELECT * FROM police_zones ORDER BY name ASC",
    );
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      zoneCode: row.zone_code,
      headquartersJunctionId: row.headquarters_junction_id,
      contactPhone: row.contact_phone,
      activeOfficersCount: row.active_officers_count,
    }));
  }

  // -------------------------------------------------- EVIDENCE & PHOTOS ----
  async createEvidence(input: {
    eventId: number;
    driverId?: number | null;
    filePath: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<number> {
    const res = await this.db.query<{ id: number }>(
      `INSERT INTO emergency_evidence
         (event_id, driver_id, file_path, file_name, mime_type, file_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.eventId,
        input.driverId ?? null,
        input.filePath,
        input.fileName,
        input.mimeType,
        input.fileSizeBytes,
      ],
    );
    return res.rows[0]!.id;
  }

  async getEvidenceByEventId(eventId: number): Promise<{
    id: number;
    filePath: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    uploadedAt: Date;
  } | null> {
    const res = await this.db.query<{
      id: number;
      file_path: string;
      file_name: string;
      mime_type: string;
      file_size_bytes: number;
      uploaded_at: Date;
    }>(
      "SELECT * FROM emergency_evidence WHERE event_id = $1 ORDER BY id DESC LIMIT 1",
      [eventId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      filePath: row.file_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSizeBytes: row.file_size_bytes,
      uploadedAt: row.uploaded_at,
    };
  }

  // ------------------------------------------------------- VERIFICATIONS ----
  async createOrUpdateVerification(input: {
    requestId: string;
    eventId: number;
    driverId?: number | null;
    vehicleId?: number | null;
    status: VerificationDetail["status"];
    isCorridorAuthorized: boolean;
  }): Promise<number> {
    const res = await this.db.query<{ id: number }>(
      `INSERT INTO emergency_verifications
         (request_id, event_id, driver_id, vehicle_id, status, is_corridor_authorized)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (request_id) DO UPDATE
       SET status = EXCLUDED.status,
           is_corridor_authorized = EXCLUDED.is_corridor_authorized,
           updated_at = now()
       RETURNING id`,
      [
        input.requestId,
        input.eventId,
        input.driverId ?? null,
        input.vehicleId ?? null,
        input.status,
        input.isCorridorAuthorized,
      ],
    );
    return res.rows[0]!.id;
  }

  async updateVerificationStatus(
    verificationId: number,
    status: VerificationDetail["status"],
    isCorridorAuthorized: boolean,
  ): Promise<void> {
    await this.db.query(
      `UPDATE emergency_verifications
       SET status = $1, is_corridor_authorized = $2, updated_at = now()
       WHERE id = $3`,
      [status, isCorridorAuthorized, verificationId],
    );
  }

  async getVerificationByEventId(eventId: number): Promise<VerificationDetail | null> {
    const res = await this.db.query<VerificationRow>(
      "SELECT * FROM emergency_verifications WHERE event_id = $1 ORDER BY id DESC LIMIT 1",
      [eventId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.buildVerificationDetail(row);
  }

  async getVerificationByRequestId(requestId: string): Promise<VerificationDetail | null> {
    const res = await this.db.query<VerificationRow>(
      "SELECT * FROM emergency_verifications WHERE request_id = $1 LIMIT 1",
      [requestId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.buildVerificationDetail(row);
  }

  async listVerifications(status?: string): Promise<VerificationDetail[]> {
    let query = "SELECT * FROM emergency_verifications";
    const values: unknown[] = [];
    if (status) {
      query += " WHERE status = $1";
      values.push(status);
    }
    query += " ORDER BY id DESC LIMIT 50";
    const res = await this.db.query<VerificationRow>(query, values);
    const details: VerificationDetail[] = [];
    for (const row of res.rows) {
      details.push(await this.buildVerificationDetail(row));
    }
    return details;
  }

  async recordAiResult(input: {
    verificationId: number;
    verdict: "VERIFIED" | "FRAUD_FLAGGED" | "REVIEW_REQUIRED";
    confidenceScore: number;
    reason: string;
    detectedFeatures: string[];
    isFlaggedAsFraud: boolean;
    model: string;
    source?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_verification_results
         (verification_id, verdict, confidence_score, reason, detected_features, is_flagged_as_fraud, model, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.verificationId,
        input.verdict,
        input.confidenceScore,
        input.reason,
        JSON.stringify(input.detectedFeatures),
        input.isFlaggedAsFraud,
        input.model,
        input.source ?? "server_ai",
      ],
    );
  }

  async recordManualDecision(input: {
    verificationId: number;
    reviewerId: string;
    reviewerName: string;
    isApproved: boolean;
    rejectionReason?: string | null;
    notes?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO manual_verification_decisions
         (verification_id, reviewer_id, reviewer_name, is_approved, rejection_reason, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.verificationId,
        input.reviewerId,
        input.reviewerName,
        input.isApproved,
        input.rejectionReason ?? null,
        input.notes ?? null,
      ],
    );
  }

  async isCorridorAuthorizedForEvent(eventId: number): Promise<boolean> {
    const res = await this.db.query<{ is_corridor_authorized: boolean }>(
      "SELECT is_corridor_authorized FROM emergency_verifications WHERE event_id = $1 LIMIT 1",
      [eventId],
    );
    if (!res.rows[0]) return false; // Fixed fail-open: deny by default if no verification workflow was registered
    return res.rows[0].is_corridor_authorized;
  }

  async adminApproveTransaction(input: {
    verificationId: number;
    reviewerId: string;
    reviewerName: string;
    notes?: string | null;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO manual_verification_decisions
           (verification_id, reviewer_id, reviewer_name, is_approved, notes)
         VALUES ($1, $2, $3, true, $4)`,
        [input.verificationId, input.reviewerId, input.reviewerName, input.notes ?? null],
      );
      await tx.query(
        `UPDATE emergency_verifications
         SET status = 'adminApproved', is_corridor_authorized = true, updated_at = now()
         WHERE id = $1`,
        [input.verificationId],
      );
    });
  }

  async adminRejectTransaction(input: {
    verificationId: number;
    reviewerId: string;
    reviewerName: string;
    rejectionReason: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO manual_verification_decisions
           (verification_id, reviewer_id, reviewer_name, is_approved, rejection_reason)
         VALUES ($1, $2, $3, false, $4)`,
        [input.verificationId, input.reviewerId, input.reviewerName, input.rejectionReason],
      );
      await tx.query(
        `UPDATE emergency_verifications
         SET status = 'adminRejected', is_corridor_authorized = false, updated_at = now()
         WHERE id = $1`,
        [input.verificationId],
      );
    });
  }

  // ------------------------------------------------------------ TELEMETRY ----
  async recordDriverTelemetry(input: {
    driverId: number;
    vehicleId?: number | null;
    eventId?: number | null;
    latitude: number;
    longitude: number;
    accuracy?: number;
    speedMps?: number;
    heading?: number;
    nearestJunctionId?: string | null;
    nearestSegmentId?: string | null;
  }): Promise<void> {
    try {
      if (input.nearestJunctionId) {
        await this.db.query(
          `INSERT INTO intersections (id, kind, controlled, x, y, geom)
           VALUES ($1, 'priority', false, 0, 0, ST_GeomFromText('POINT(0 0)', 0))
           ON CONFLICT (id) DO NOTHING`,
          [input.nearestJunctionId],
        );
      }
      if (input.nearestSegmentId) {
        await this.db.query(
          `INSERT INTO roads (id, name, from_junction, to_junction)
           VALUES ($1, $1, COALESCE($2, 'I1'), COALESCE($2, 'I1'))
           ON CONFLICT (id) DO NOTHING`,
          [input.nearestSegmentId, input.nearestJunctionId],
        );
        try {
          await this.db.query(
            `INSERT INTO road_segments (id, road_id, from_junction, to_junction, lane_count, length_m, max_speed_mps, geom)
             VALUES ($1, $1, COALESCE($2, 'I1'), COALESCE($2, 'I1'), 1, 10, 13.89, ST_GeomFromText('LINESTRING(0 0, 1 1)', 0))
             ON CONFLICT (id) DO NOTHING`,
            [input.nearestSegmentId, input.nearestJunctionId],
          );
        } catch {
          // Non-fatal if road_segments constraint is relaxed or already satisfied
        }
      }
      await this.db.query(
        `INSERT INTO driver_telemetry
           (driver_id, vehicle_id, event_id, latitude, longitude, accuracy, speed_mps, heading, nearest_junction_id, nearest_segment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.driverId,
          input.vehicleId ?? null,
          input.eventId ?? null,
          input.latitude,
          input.longitude,
          input.accuracy ?? null,
          input.speedMps ?? null,
          input.heading ?? null,
          input.nearestJunctionId ?? null,
          input.nearestSegmentId ?? null,
        ],
      );
    } catch {
      // Non-blocking telemetry persistence
    }
  }

  // ---------------------------------------------------------- AUDIT LOGS ----
  async recordAudit(
    action: string,
    actorId: string | null,
    actorType: "driver" | "admin" | "operator" | "system",
    eventId: number | null,
    details: Record<string, unknown> = {},
    ipAddress?: string,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_events (action, actor_id, actor_type, event_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action, actorId, actorType, eventId, JSON.stringify(details), ipAddress ?? null],
      );
    } catch {
      // Non-blocking audit failure
    }
  }

  // ------------------------------------------------------------- MAPPING ----
  private mapFleetVehicle(row: FleetVehicleRow): FleetVehicleRecord {
    return {
      id: row.id,
      vehicleCode: row.vehicle_code,
      registrationNumber: row.registration_number,
      vehicleType: row.vehicle_type,
      model: row.model,
      status: row.status,
      assignedDriverId: row.assigned_driver_id,
      currentEmergencyId: row.current_emergency_id,
      lastLatitude: row.last_latitude,
      lastLongitude: row.last_longitude,
      lastHeading: row.last_heading,
      lastSpeedKmh: row.last_speed_kmh,
    };
  }

  private mapHospital(row: HospitalRow): HospitalRecord {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      emergencyPhone: row.emergency_phone,
      availableBeds: row.available_beds,
      traumaLevel: row.trauma_level,
      nearestJunctionId: row.nearest_junction_id,
      status: row.status,
    };
  }

  private async buildVerificationDetail(row: VerificationRow): Promise<VerificationDetail> {
    const evidence = await this.getEvidenceByEventId(row.event_id);
    const aiRes = await this.db.query<{
      verdict: "VERIFIED" | "FRAUD_FLAGGED" | "REVIEW_REQUIRED";
      confidence_score: number;
      reason: string;
      detected_features: unknown;
      is_flagged_as_fraud: boolean;
      model: string;
      evaluated_at: Date;
    }>(
      "SELECT * FROM ai_verification_results WHERE verification_id = $1 ORDER BY id DESC LIMIT 1",
      [row.id],
    );
    const adminRes = await this.db.query<{
      reviewer_id: string;
      reviewer_name: string;
      is_approved: boolean;
      rejection_reason: string | null;
      notes: string | null;
      decided_at: Date;
    }>(
      "SELECT * FROM manual_verification_decisions WHERE verification_id = $1 ORDER BY id DESC LIMIT 1",
      [row.id],
    );

    const aiRow = aiRes.rows[0];
    const adminRow = adminRes.rows[0];

    return {
      id: row.id,
      requestId: row.request_id,
      eventId: row.event_id,
      driverId: row.driver_id,
      vehicleId: row.vehicle_id,
      status: row.status,
      isCorridorAuthorized: row.is_corridor_authorized,
      submittedAtIso: row.submitted_at.toISOString(),
      updatedAtIso: row.updated_at.toISOString(),
      evidence: evidence
        ? {
            id: evidence.id,
            fileName: evidence.fileName,
            fileSizeBytes: evidence.fileSizeBytes,
            mimeType: evidence.mimeType,
            uploadedAtIso: evidence.uploadedAt.toISOString(),
          }
        : null,
      aiResult: aiRow
        ? {
            verdict: aiRow.verdict,
            confidenceScore: aiRow.confidence_score,
            reason: aiRow.reason,
            detectedFeatures: Array.isArray(aiRow.detected_features)
              ? aiRow.detected_features as string[]
              : [],
            isFlaggedAsFraud: aiRow.is_flagged_as_fraud,
            model: aiRow.model,
            evaluatedAtIso: aiRow.evaluated_at.toISOString(),
          }
        : null,
      adminDecision: adminRow
        ? {
            reviewerId: adminRow.reviewer_id,
            reviewerName: adminRow.reviewer_name,
            isApproved: adminRow.is_approved,
            rejectionReason: adminRow.rejection_reason,
            notes: adminRow.notes,
            decidedAtIso: adminRow.decided_at.toISOString(),
          }
        : null,
    };
  }
}
