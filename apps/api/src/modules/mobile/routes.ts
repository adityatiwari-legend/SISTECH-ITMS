import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AppError } from "../../errors.ts";
import type { AuthService } from "../auth/auth-service.ts";
import type { MobileService } from "./mobile-service.ts";
import type { MobileRepository } from "../../database/repositories/mobile-repository.ts";
import type { AiVerificationService } from "../ai/verification-service.ts";
import type { EmergencyRepository } from "../../database/repositories/emergency-repository.ts";

export interface MobileRoutesOptions {
  authService: AuthService;
  mobileService: MobileService;
  mobileRepo: MobileRepository;
  aiVerificationService: AiVerificationService;
  emergencyRepo: EmergencyRepository;
}

export async function mobileRoutes(
  app: FastifyInstance,
  options: MobileRoutesOptions,
): Promise<void> {
  const { authService, mobileService, mobileRepo, aiVerificationService, emergencyRepo } = options;

  // ------------------------------------------------------------- AUTH ----
  app.post("/api/auth/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      throw new AppError(400, "missing_credentials", "Email and password are required.");
    }
    const ip = request.ip;
    const result = await authService.login(body.email, body.password, ip);
    return reply.code(200).send(result);
  });

  app.post("/api/auth/refresh", {
    schema: {
      body: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (!body.refreshToken) {
      throw new AppError(400, "missing_refresh_token", "refreshToken is required.");
    }
    const result = await authService.refresh(body.refreshToken);
    return reply.code(200).send(result);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = authService.authenticate(request);
    await authService.logout(auth.sub, request.ip);
    return reply.code(200).send({ success: true, message: "Logged out successfully." });
  });

  // --------------------------------------------------- DRIVER PROFILE ----
  app.get("/api/driver/profile", async (request) => {
    const auth = authService.authenticate(request);
    return authService.getDriverProfile(auth.sub);
  });

  app.put("/api/driver/status", {
    schema: {
      body: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["available", "on_duty", "off_duty", "in_emergency"] }
        }
      }
    }
  }, async (request) => {
    const auth = authService.authenticate(request);
    const body = request.body as { status?: "available" | "on_duty" | "off_duty" | "in_emergency" };
    if (!body.status) {
      throw new AppError(400, "missing_status", "status field is required.");
    }
    await mobileRepo.updateDriverStatus(auth.sub, body.status);
    return authService.getDriverProfile(auth.sub);
  });

  // -------------------------------------------------- FLEET VEHICLES ----
  app.get("/api/vehicles/available", async (request) => {
    authService.authenticate(request);
    const vehicles = await mobileRepo.listFleetVehicles();
    return { vehicles };
  });

  app.get("/api/driver/vehicle", async (request) => {
    const auth = authService.authenticate(request);
    const vehicle = await mobileRepo.getAssignedVehicleForDriver(auth.sub);
    return { vehicle };
  });

  app.post("/api/driver/select-vehicle", {
    schema: {
      body: {
        type: "object",
        anyOf: [
          { required: ["vehicleId"] },
          { required: ["vehicleCode"] }
        ],
        properties: {
          vehicleId: { type: "integer", minimum: 1 },
          vehicleCode: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const auth = authService.authenticate(request);
    const body = request.body as { vehicleId?: number; vehicleCode?: string };
    let vehicleId = body.vehicleId;
    if (!vehicleId && body.vehicleCode) {
      const v = await mobileRepo.getFleetVehicleByCode(body.vehicleCode);
      if (v) vehicleId = v.id;
    }
    if (!vehicleId) {
      throw new AppError(400, "missing_vehicle", "vehicleId or vehicleCode is required.");
    }

    const assigned = await mobileRepo.assignVehicleToDriver(auth.sub, vehicleId);
    return reply.code(200).send({ success: true, vehicle: assigned });
  });

  // ---------------------------------------------------- GPS TELEMETRY ----
  app.post("/api/driver/location", {
    schema: {
      body: {
        type: "object",
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
          accuracy: { type: "number" },
          speedMps: { type: "number" },
          heading: { type: "number" },
          timestamp: { type: ["string", "number"] }
        }
      }
    }
  }, async (request, reply) => {
    const auth = authService.authenticate(request);
    const body = request.body as {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      speedMps?: number;
      heading?: number;
      timestamp?: string | number;
    };
    if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
      throw new AppError(400, "invalid_coordinates", "latitude and longitude numbers are required.");
    }

    const result = await mobileService.ingestGpsTelemetry(auth.sub, {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      speedMps: body.speedMps,
      heading: body.heading,
      timestamp: body.timestamp,
    });
    return reply.code(200).send(result);
  });

  // --------------------------------------------------- ROUTE PREVIEW ----
  app.post("/api/routes/preview", {
    schema: {
      body: {
        type: "object",
        properties: {
          originLat: { type: "number" },
          originLng: { type: "number" },
          originJunction: { type: "string" },
          destinationJunction: { type: "string" },
          destinationHospitalId: { type: "integer", minimum: 1 },
          destinationLat: { type: "number" },
          destinationLng: { type: "number" }
        }
      }
    }
  }, async (request) => {
    const body = request.body as {
      originLat?: number;
      originLng?: number;
      originJunction?: string;
      destinationJunction?: string;
      destinationHospitalId?: number;
      destinationLat?: number;
      destinationLng?: number;
    };
    return mobileService.previewRoute(body);
  });

  // -------------------------------------------------------- HOSPITALS ----
  app.get("/api/hospitals", async () => {
    const hospitals = await mobileRepo.listHospitals();
    return { hospitals };
  });

  app.get("/api/hospitals/:id", async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new AppError(400, "invalid_id", "Hospital id must be a positive integer.");
    }
    const hospital = await mobileRepo.getHospitalById(numericId);
    if (!hospital) {
      throw new AppError(404, "hospital_not_found", `Hospital #${id} not found.`);
    }
    return hospital;
  });

  // ----------------------------------------------------- POLICE ZONES ----
  app.get("/api/police/zones", async () => {
    const zones = await mobileRepo.listPoliceZones();
    return { zones };
  });

  // ------------------------------------ MOBILE EMERGENCY INITIATION ----
  app.post("/api/driver/emergency", {
    schema: {
      body: {
        type: "object",
        properties: {
          type: { type: "string" },
          priority: { type: "string" },
          originLat: { type: "number" },
          originLng: { type: "number" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          destinationLat: { type: "number" },
          destinationLng: { type: "number" },
          destinationHospitalId: { type: ["integer", "string"] },
          patientCondition: { type: "string" },
          severity: { type: "string" },
          originAddress: { type: "string" },
          destinationAddress: { type: "string" },
          origin: { type: "string" },
          destination: { type: "string" }
        },
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    const auth = authService.authenticate(request);
    const driverId = auth.sub;
    const body = request.body as any;
    const detail = await mobileService.createMobileEmergency(driverId, body, request.ip);
    return reply.code(201).send(detail);
  });

  // --------------------------------- EMERGENCY PATIENT PHOTO EVIDENCE ----
  app.post("/api/emergency/:id/patient-image", async (request, reply) => {
    const auth = authService.authenticate(request);
    const driverId = auth.sub;
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new AppError(400, "invalid_id", "Emergency id must be a positive integer.");
    }

    let fileBuffer: Buffer | null = null;
    let fileName = `patient-${eventId}.jpg`;
    let mimeType = "image/jpeg";
    let scenario: string | undefined;

    // Check if multipart form upload
    if (request.isMultipart()) {
      const part = await request.file();
      if (part) {
        fileBuffer = await part.toBuffer();
        fileName = part.filename || fileName;
        mimeType = part.mimetype || mimeType;
        if (part.fields && (part.fields as any).scenario) {
          scenario = ((part.fields as any).scenario as any).value;
        }
      }
    } else {
      // Support base64 JSON payload (supports both imageBase64 AND imageData from Flutter app)
      const body = (request.body ?? {}) as {
        imageBase64?: string;
        imageData?: string;
        fileName?: string;
        mimeType?: string;
        scenario?: string;
      };
      const rawBase64 = body.imageBase64 || body.imageData;
      if (rawBase64 && rawBase64.trim().length > 0) {
        const cleaned = rawBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        fileBuffer = Buffer.from(cleaned, "base64");
      }
      if (body.fileName) fileName = body.fileName;
      if (body.mimeType) mimeType = body.mimeType;
      if (body.scenario) scenario = body.scenario;
    }

    if (!fileBuffer || fileBuffer.length < 12) {
      throw new AppError(400, "invalid_image", "File must be a valid image.");
    }

    if (fileBuffer.length > 15 * 1024 * 1024) {
      throw new AppError(413, "photo_too_large", "Photo file size exceeds maximum 15MB limit.");
    }

    const buf = fileBuffer as Buffer;
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;

    if (!isJpeg && !isPng && !isWebp) {
      throw new AppError(400, "INVALID_IMAGE_FORMAT", "File must be a valid JPEG, PNG, or WEBP image.");
    }

    const result = await mobileService.uploadPatientPhoto({
      eventId,
      driverId,
      fileBuffer,
      fileName,
      mimeType,
      scenario,
    });

    return reply.code(201).send({
      ...result,
      status: result.verification.status,
      isCorridorAuthorized: result.verification.isCorridorAuthorized,
      requestId: result.verification.requestId,
    });
  });

  app.get("/api/emergency/:id/patient-image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new AppError(400, "invalid_id", "Emergency id must be a positive integer.");
    }

    const query = (request.query ?? {}) as { token?: string };
    let auth: { sub: number; role: string } | null = null;
    try {
      if (query.token) {
        auth = authService.verifyToken(query.token);
      } else {
        auth = authService.authenticate(request);
      }
    } catch {
      // Allow image loading for operator dashboard / authorized previews
    }

    if (auth && auth.role !== "admin" && auth.role !== "operator") {
      const event = await options.emergencyRepo.getEvent(eventId);
      if (event && event.driver_id && event.driver_id !== auth.sub) {
        throw new AppError(403, "forbidden", "You can only view patient images for your own emergencies.");
      }
    }

    const evidence = await mobileRepo.getEvidenceByEventId(eventId);
    if (!evidence || !existsSync(evidence.filePath)) {
      throw new AppError(404, "photo_not_found", `Patient evidence photo for emergency #${id} not found.`);
    }

    const buffer = await readFile(evidence.filePath);
    return reply.type(evidence.mimeType).send(buffer);
  });

  // ------------------------------------ VERIFICATION QUERY & STATUS ----
  app.get("/api/emergency/:id/verification", async (request) => {
    authService.authenticate(request);
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    const v = await mobileRepo.getVerificationByEventId(eventId);
    if (!v) {
      throw new AppError(404, "verification_not_found", `No verification record for emergency #${id}.`);
    }
    return v;
  });

  // --------------------------------- EMERGENCY COMPLETION & CANCEL ----
  app.post("/api/emergency/:id/complete", async (request, reply) => {
    let auth: { sub: number; role: string } | null = null;
    try {
      auth = authService.authenticate(request);
    } catch {
      // Allow unauthenticated/operator dashboard call
    }
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new AppError(400, "invalid_id", "Emergency id must be a positive integer.");
    }
    const result = await mobileService.completeEmergency(eventId, auth?.sub ?? 0, request.ip, auth?.role);
    return reply.code(200).send(result);
  });

  app.post("/api/emergency/:id/cancel", {
    schema: {
      body: {
        type: "object",
        properties: {
          reason: { type: "string" }
        }
      }
    }
  }, async (request, reply) => {
    let auth: { sub: number; role: string } | null = null;
    try {
      auth = authService.authenticate(request);
    } catch {
      // Allow unauthenticated/operator dashboard call
    }
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new AppError(400, "invalid_id", "Emergency id must be a positive integer.");
    }
    const body = request.body as { reason?: string } | null;
    const reason = (body && body.reason) ? body.reason : "Cancelled via application.";
    const result = await mobileService.cancelEmergency(eventId, auth?.sub ?? 0, reason, request.ip, auth?.role);
    return reply.code(200).send(result);
  });

  app.get("/api/driver/emergencies", async (request) => {
    const auth = authService.authenticate(request);
    const events = await options.emergencyRepo.getEventsByDriver(auth.sub);
    return { emergencies: events };
  });

  // ---------------------------------- ADMIN VERIFICATION REVIEW ----
  app.get("/api/admin/verifications", async (request) => {
    const auth = authService.authenticate(request);
    if (auth.role !== "admin" && auth.role !== "operator") {
      throw new AppError(403, "forbidden", "Only admins or operators can access verification reviews.");
    }
    const verifications = await mobileRepo.listVerifications();
    return { verifications };
  });

  app.get("/api/admin/verifications/:id", async (request) => {
    const auth = authService.authenticate(request);
    if (auth.role !== "admin" && auth.role !== "operator") {
      throw new AppError(403, "forbidden", "Only admins or operators can access verification reviews.");
    }
    const { id } = request.params as { id: string };
    const vId = Number(id);
    const list = await mobileRepo.listVerifications();
    const target = list.find((v) => v.id === vId);
    if (!target) {
      throw new AppError(404, "not_found", `Verification #${id} not found.`);
    }
    return target;
  });

  app.post("/api/admin/verifications/:id/approve", {
    schema: {
      body: {
        type: "object",
        properties: {
          notes: { type: "string" }
        }
      }
    }
  }, async (request, reply) => {
    const auth = authService.authenticate(request);
    if (auth.role !== "admin" && auth.role !== "operator") {
      throw new AppError(403, "forbidden", "Only admins or operators can approve verifications.");
    }
    const approverCode = auth.code;
    const { id } = request.params as { id: string };
    const body = request.body as { notes?: string };
    const result = await aiVerificationService.adminApprove(
      Number(id),
      approverCode,
      approverCode,
      body.notes,
    );
    return reply.code(200).send(result);
  });

  app.post("/api/admin/verifications/:id/reject", {
    schema: {
      body: {
        type: "object",
        required: ["reason"],
        properties: {
          reason: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const auth = authService.authenticate(request);
    if (auth.role !== "admin" && auth.role !== "operator") {
      throw new AppError(403, "forbidden", "Only admins or operators can reject verifications.");
    }
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    if (!body.reason) {
      throw new AppError(400, "missing_reason", "Rejection reason is required.");
    }
    const result = await aiVerificationService.adminReject(
      Number(id),
      auth.code,
      auth.code,
      body.reason,
    );
    return reply.code(200).send(result);
  });

  app.get("/api/system/status", async (_request, reply) => {
    const status = await mobileService.getSystemStatus();
    return reply.code(200).send(status);
  });
}
