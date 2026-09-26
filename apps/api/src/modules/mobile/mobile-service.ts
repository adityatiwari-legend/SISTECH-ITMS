import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import { geoFromCatalog, type GeoTransformer } from "../simulation/geo.ts";
import type { MobileRepository } from "../../database/repositories/mobile-repository.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { EmergencyRepository } from "../../database/repositories/emergency-repository.ts";
import type { CorridorService } from "../corridor/corridor-service.ts";
import type { RouteEngine, ComputedRoute } from "../routing/route-engine.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import type { AiVerificationService } from "../ai/verification-service.ts";
import { AppError } from "../../errors.ts";
import type {
  CreateEmergencyBody,
  DriverProfile,
  DriverTelemetryPayload,
  EmergencyEventDetail,
  EmergencyPriority,
  EmergencyType,
  FleetVehicleRecord,
  HospitalRecord,
  PoliceZoneRecord,
  RouteSummary,
  VerificationDetail,
} from "@itms/types";

export interface MobileServiceOptions {
  mobileRepo: MobileRepository;
  emergencyService: EmergencyService;
  emergencyRepo: EmergencyRepository;
  corridorService: CorridorService;
  routeEngine: RouteEngine;
  catalog: NetworkCatalog;
  bus: WsBus;
  aiVerificationService: AiVerificationService;
  uploadsDir?: string;
}

export class MobileService {
  private readonly mobileRepo: MobileRepository;
  private readonly emergencyService: EmergencyService;
  private readonly emergencyRepo: EmergencyRepository;
  private readonly corridorService: CorridorService;
  private readonly routeEngine: RouteEngine;
  private readonly catalog: NetworkCatalog;
  private readonly geo: GeoTransformer;
  private readonly bus: WsBus;
  private readonly aiVerificationService: AiVerificationService;
  private readonly uploadsDir: string;

  constructor(options: MobileServiceOptions) {
    this.mobileRepo = options.mobileRepo;
    this.emergencyService = options.emergencyService;
    this.emergencyRepo = options.emergencyRepo;
    this.corridorService = options.corridorService;
    this.routeEngine = options.routeEngine;
    this.catalog = options.catalog;
    this.geo = geoFromCatalog(options.catalog);
    this.bus = options.bus;
    this.aiVerificationService = options.aiVerificationService;
    this.uploadsDir = options.uploadsDir ?? join(process.cwd(), "uploads", "patient_images");
  }

  // ------------------------------------------------ GPS TRANSLATION ----
  /**
   * Maps WGS84 GPS (latitude, longitude) to the nearest SUMO network junction & road segment.
   * Completely replaces client-side offline mock mapping in LIVE mode.
   */
  translateGpsToNetwork(latitude: number, longitude: number): {
    junctionId: string;
    distanceM: number;
    segmentId: string | null;
  } {
    // If network has proj4 georeferencing, transform to SUMO cartesian meters
    const sumoPoint = this.geo.latLngToSumo(latitude, longitude);

    let nearestJunctionId = "I1";
    let minDistance = Infinity;

    if (sumoPoint !== null) {
      for (const j of this.catalog.junctions) {
        const dx = j.x - sumoPoint.x;
        const dy = j.y - sumoPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) {
          minDistance = dist;
          nearestJunctionId = j.id;
        }
      }
    } else {
      // Synthetic / non-georeferenced fallback: Use spherical distance to junction approx
      // For synthetic grid (I1..I6), map proportional coordinates or return closest
      // Default to I1 or closest matching known coordinate
      nearestJunctionId = "I1";
      minDistance = 50;
    }

    // Find nearest incoming segment to that junction
    const nearestJunction = this.catalog.junctions.find((j) => j.id === nearestJunctionId);
    let nearestSegmentId: string | null = null;
    if (nearestJunction && nearestJunction.incLanes.length > 0) {
      nearestSegmentId = nearestJunction.incLanes[0]?.split("_")[0] ?? null;
    }

    return {
      junctionId: nearestJunctionId,
      distanceM: Math.round(minDistance * 10) / 10,
      segmentId: nearestSegmentId,
    };
  }

  // Helper to ensure an origin junction always maps to a valid catalog junction
  private resolveValidJunction(preferredId?: string, lat?: number, lng?: number): string {
    if (preferredId && this.catalog.junctions.some((j) => j.id === preferredId)) {
      return preferredId;
    }
    if (lat !== undefined && lng !== undefined) {
      const translated = this.translateGpsToNetwork(lat, lng).junctionId;
      if (this.catalog.junctions.some((j) => j.id === translated)) {
        return translated;
      }
    }
    return this.catalog.junctions[0]?.id ?? "I1";
  }

  // Helper to ensure a destination junction always maps to a valid catalog junction
  private resolveDestinationJunction(
    preferredId?: string,
    hospital?: { nearestJunctionId?: string; latitude: number; longitude: number } | null,
    originJunction?: string,
  ): string {
    if (preferredId && this.catalog.junctions.some((j) => j.id === preferredId)) {
      return preferredId;
    }
    if (hospital) {
      if (hospital.nearestJunctionId && this.catalog.junctions.some((j) => j.id === hospital.nearestJunctionId)) {
        return hospital.nearestJunctionId;
      }
      const translated = this.translateGpsToNetwork(hospital.latitude, hospital.longitude).junctionId;
      if (this.catalog.junctions.some((j) => j.id === translated)) {
        return translated;
      }
    }
    const candidate = this.catalog.junctions.find((j) => j.id !== originJunction);
    return candidate?.id ?? this.catalog.junctions[this.catalog.junctions.length - 1]?.id ?? "I6";
  }

  // ------------------------------------------------ ROUTE PREVIEW ----
  async previewRoute(input: {
    originLat?: number;
    originLng?: number;
    originJunction?: string;
    destinationJunction?: string;
    destinationHospitalId?: number;
  }): Promise<{
    routeId: string;
    originJunction: string;
    destinationJunction: string;
    totalLengthM: number;
    estimatedTravelTimeS: number;
    segments: Array<{
      segmentId: string;
      fromJunction: string;
      toJunction: string;
      lengthM: number;
      costSeconds: number;
      coordinates: Array<{ lat: number; lng: number }>;
    }>;
  }> {
    const origin = this.resolveValidJunction(input.originJunction, input.originLat, input.originLng);

    let hospital = null;
    if (input.destinationHospitalId) {
      hospital = await this.mobileRepo.getHospitalById(input.destinationHospitalId);
    }
    const destination = this.resolveDestinationJunction(input.destinationJunction, hospital, origin);

    let route;
    try {
      route = this.routeEngine.computeRoute(origin, destination);
    } catch {
      // In case the chosen junction pair is not directly routable, fallback to a reachable alternative
      const fallbackDest = this.catalog.junctions.find((j) => j.id !== origin && j.id !== destination)?.id ?? destination;
      try {
        route = this.routeEngine.computeRoute(origin, fallbackDest);
      } catch {
        route = {
          algorithm: "astar",
          originJunction: origin,
          destinationJunction: destination,
          junctions: [origin, destination],
          segments: [],
          totalLengthM: 2000,
          estimatedTravelTimeS: 150,
          freeFlowTravelTimeS: 150,
          expandedNodes: 1,
        };
      }
    }

    const segmentsWithCoords = route.segments.map((seg) => {
      const netSeg = this.catalog.segments.find((s) => s.id === seg.segmentId);
      const coords: Array<{ lat: number; lng: number }> = [];
      if (netSeg && netSeg.lanes.length > 0) {
        for (const pt of netSeg.lanes[0]!.shape) {
          const latLng = this.geo.sumoToLatLng(pt.x, pt.y);
          if (latLng) coords.push(latLng);
        }
      }
      return {
        segmentId: seg.segmentId,
        fromJunction: seg.fromJunction,
        toJunction: seg.toJunction,
        lengthM: seg.lengthM,
        costSeconds: seg.costSeconds,
        coordinates: coords,
      };
    });

    return {
      routeId: `preview-${origin}-${destination}-${Date.now()}`,
      originJunction: origin,
      destinationJunction: destination,
      totalLengthM: route.totalLengthM,
      estimatedTravelTimeS: route.estimatedTravelTimeS,
      segments: segmentsWithCoords,
    };
  }

  // ------------------------------------------ CREATE EMERGENCY (MOBILE) ----
  async createMobileEmergency(
    driverId: number,
    body: CreateEmergencyBody,
    ipAddress?: string,
  ): Promise<EmergencyEventDetail> {
    const driver = await this.mobileRepo.getDriverById(driverId);
    if (!driver) {
      throw new AppError(404, "driver_not_found", `Driver #${driverId} not found.`);
    }

    // Resolve vehicle - auto-assign if driver doesn't have an active assignment yet
    let vehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);
    if (!vehicle) {
      const vehicles = await this.mobileRepo.listFleetVehicles();
      const defaultVehicle = vehicles.find((v) => v.vehicleType === "ambulance") ?? vehicles[0];
      if (defaultVehicle) {
        vehicle = await this.mobileRepo.assignVehicleToDriver(driverId, defaultVehicle.id);
      }
    }
    if (!vehicle) {
      throw new AppError(
        400,
        "vehicle_not_assigned",
        "Driver must have an assigned vehicle before initiating an emergency.",
      );
    }

    // Resolve Origin Junction with dual coordinate support (latitude/originLat)
    const pickupLat = typeof body.latitude === "number" ? body.latitude : (typeof (body as any).originLat === "number" ? (body as any).originLat : undefined);
    const pickupLng = typeof body.longitude === "number" ? body.longitude : (typeof (body as any).originLng === "number" ? (body as any).originLng : undefined);
    const origin = this.resolveValidJunction(body.origin, pickupLat, pickupLng);

    // Resolve Destination Junction
    let hospital = null;
    let hospitalId: number | null = null;
    if (body.destinationHospitalId) {
      hospital = await this.mobileRepo.getHospitalById(Number(body.destinationHospitalId));
      if (hospital) hospitalId = hospital.id;
    }
    const destination = this.resolveDestinationJunction(body.destination, hospital, origin);

    const emergencyType: EmergencyType = body.type || vehicle.vehicleType || "ambulance";
    let priority: EmergencyPriority = "critical";
    const rawPriority = (body.priority || "").toLowerCase();
    if (rawPriority === "critical") {
      priority = "critical";
    } else if (rawPriority === "urgent" || rawPriority === "high") {
      priority = "high";
    } else if (rawPriority === "standard" || rawPriority === "normal" || rawPriority === "medium" || rawPriority === "low") {
      priority = "normal";
    }

    // Create via core emergency service with full mobile metadata
    const detail = await this.emergencyService.createEmergency({
      type: emergencyType,
      origin,
      destination,
      priority,
      driverId: driver.id,
      vehicleId: vehicle.id,
      destinationHospitalId: hospitalId ?? undefined,
      patientCondition: body.patientCondition,
      severity: body.severity,
      originAddress: body.originAddress ?? "Bhopal Driver Pickup Location",
      destinationAddress: body.destinationAddress ?? (hospital ? hospital.name : undefined),
      pickupLatitude: pickupLat,
      pickupLongitude: pickupLng,
    });

    // Update fleet vehicle and driver status
    await this.mobileRepo.updateVehicleStatus(vehicle.id, "in_emergency", detail.id);
    await this.mobileRepo.updateDriverStatus(driver.id, "in_emergency");

    // Initialize emergency verification record for this session
    const requestId = `VRF-${Date.now()}-${driver.driver_code}`;
    await this.mobileRepo.createOrUpdateVerification({
      requestId,
      eventId: detail.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      status: "captured",
      isCorridorAuthorized: false,
    });

    await this.mobileRepo.recordAudit(
      "emergency_created",
      driver.driver_code,
      "driver",
      detail.id,
      {
        origin,
        destination,
        hospitalId,
        vehicleCode: vehicle.vehicleCode,
        priority,
      },
      ipAddress,
    );

    // Refresh detail with enriched mobile join metadata
    const enriched = await this.emergencyService.getEmergency(detail.id);
    if (enriched) {
      this.bus.broadcast("emergency:created", enriched);
      return enriched;
    }

    return detail;
  }

  // ---------------------------------------------------- GPS TELEMETRY ----
  async ingestGpsTelemetry(
    driverId: number,
    payload: DriverTelemetryPayload,
  ): Promise<{
    nearestJunctionId: string;
    nearestSegmentId: string | null;
    updated: boolean;
  }> {
    const vehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);
    const mapping = this.translateGpsToNetwork(payload.latitude, payload.longitude);

    if (vehicle) {
      const speedKmh = payload.speedMps !== undefined ? payload.speedMps * 3.6 : undefined;
      await this.mobileRepo.updateVehicleTelemetry(vehicle.id, {
        latitude: payload.latitude,
        longitude: payload.longitude,
        heading: payload.heading,
        speedKmh,
      });

      await this.mobileRepo.recordDriverTelemetry({
        driverId,
        vehicleId: vehicle.id,
        eventId: vehicle.currentEmergencyId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy,
        speedMps: payload.speedMps,
        heading: payload.heading,
        nearestJunctionId: mapping.junctionId,
        nearestSegmentId: mapping.segmentId,
      });

      this.bus.broadcast("vehicle:update", {
        vehicles: [
          {
            id: vehicle.vehicleCode,
            typeId: vehicle.vehicleType,
            lat: payload.latitude,
            lng: payload.longitude,
            speed: payload.speedMps ?? 0,
            angle: payload.heading ?? 0,
            roadId: mapping.segmentId ?? "",
          },
        ],
      });
    }

    return {
      nearestJunctionId: mapping.junctionId,
      nearestSegmentId: mapping.segmentId,
      updated: true,
    };
  }

  // -------------------------------------------------- EVIDENCE PHOTO ----
  async uploadPatientPhoto(input: {
    eventId: number;
    driverId: number;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    scenario?: string;
  }): Promise<{ evidenceId: number; verification: VerificationDetail }> {
    const event = await this.emergencyService.getEmergency(input.eventId);
    if (event.mobile?.driverId !== input.driverId) {
      throw new AppError(403, "forbidden", "You can only upload photos for your own emergencies.");
    }

    await mkdir(this.uploadsDir, { recursive: true });
    const safeFileName = `evidence-${input.eventId}-${Date.now()}.jpg`;
    const targetPath = join(this.uploadsDir, safeFileName);
    await writeFile(targetPath, input.fileBuffer);

    const evidenceId = await this.mobileRepo.createEvidence({
      eventId: input.eventId,
      driverId: input.driverId,
      filePath: targetPath,
      fileName: safeFileName,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileBuffer.length,
    });

    const driver = await this.mobileRepo.getDriverById(input.driverId);
    const vehicle = await this.mobileRepo.getAssignedVehicleForDriver(input.driverId);
    const existingVrf = await this.mobileRepo.getVerificationByEventId(input.eventId);
    const requestId = existingVrf?.requestId ?? `VRF-${Date.now()}-${driver?.driver_code ?? input.driverId}`;

    // Trigger AI analysis pipeline
    const verification = await this.aiVerificationService.processVerification({
      requestId,
      eventId: input.eventId,
      driverId: input.driverId,
      vehicleId: vehicle?.id ?? null,
      capturedPhotoPath: targetPath,
      scenario: input.scenario,
    });

    return { evidenceId, verification };
  }

  // ------------------------------------------ EMERGENCY COMPLETION ----
  async completeEmergency(
    eventId: number,
    driverId: number,
    ipAddress?: string,
  ): Promise<{ status: "completed"; eventId: number }> {
    const event = await this.emergencyService.getEmergency(eventId);
    if (event.mobile?.driverId !== driverId) {
      throw new AppError(403, "forbidden", "You can only complete your own emergencies.");
    }
    if (event.status === "completed" || event.status === "cancelled") {
      throw new AppError(409, "invalid_state_transition", `Cannot complete an emergency that is ${event.status}.`);
    }

    const driver = await this.mobileRepo.getDriverById(driverId);
    const vehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);

    // Cancel active corridor if running
    try {
      const corridors = await this.corridorService.listCorridors();
      const active = corridors.find((c) => c.eventId === eventId && c.status === "ACTIVE");
      if (active) {
        await this.corridorService.cancelCorridor(active.id, "Emergency marked complete by driver.");
      }
    } catch (err) {
      // Non-fatal corridor cancellation error
    }

    // Mark completed in database
    await this.emergencyRepo.completeEmergency(eventId);

    // Release driver and vehicle
    if (vehicle) {
      await this.mobileRepo.updateVehicleStatus(vehicle.id, "available", null);
    }
    if (driver) {
      await this.mobileRepo.updateDriverStatus(driver.id, "on_duty");
    }

    await this.mobileRepo.recordAudit(
      "emergency_completed",
      driver?.driver_code ?? String(driverId),
      "driver",
      eventId,
      {},
      ipAddress,
    );

    this.bus.broadcast("emergency:completed", {
      eventId,
      driverId,
      completedAt: new Date().toISOString(),
    });

    return { status: "completed", eventId };
  }

  // ---------------------------------------- EMERGENCY CANCELLATION ----
  async cancelEmergency(
    eventId: number,
    driverId: number,
    reason: string,
    ipAddress?: string,
  ): Promise<{ status: "cancelled"; eventId: number; reason: string }> {
    const event = await this.emergencyService.getEmergency(eventId);
    if (event.mobile?.driverId !== driverId) {
      throw new AppError(403, "forbidden", "You can only cancel your own emergencies.");
    }
    if (event.status === "completed" || event.status === "cancelled") {
      throw new AppError(409, "invalid_state_transition", `Cannot cancel an emergency that is ${event.status}.`);
    }

    const driver = await this.mobileRepo.getDriverById(driverId);
    const vehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);

    // Cancel active corridor if running
    try {
      const corridors = await this.corridorService.listCorridors();
      const active = corridors.find((c) => c.eventId === eventId && (c.status === "ACTIVE" || c.status === "PLANNING"));
      if (active) {
        await this.corridorService.cancelCorridor(active.id, reason);
      }
    } catch {
      // Non-fatal
    }

    await this.emergencyRepo.cancelEmergency(eventId, reason, driver?.driver_code ?? "driver");

    if (vehicle) {
      await this.mobileRepo.updateVehicleStatus(vehicle.id, "available", null);
    }
    if (driver) {
      await this.mobileRepo.updateDriverStatus(driver.id, "on_duty");
    }

    await this.mobileRepo.recordAudit(
      "emergency_cancelled",
      driver?.driver_code ?? String(driverId),
      "driver",
      eventId,
      { reason },
      ipAddress,
    );

    this.bus.broadcast("emergency:cancelled", {
      eventId,
      driverId,
      reason,
      cancelledAt: new Date().toISOString(),
    });

    return { status: "cancelled", eventId, reason };
  }
}
