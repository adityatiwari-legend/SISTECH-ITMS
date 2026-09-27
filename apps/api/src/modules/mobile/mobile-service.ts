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
   * Distance from point P to line segment AB squared (in cartesian meters).
   */
  private distToSegmentSquared(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): { distSq: number; t: number; projX: number; projY: number } {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) {
      return {
        distSq: (px - x1) * (px - x1) + (py - y1) * (py - y1),
        t: 0,
        projX: x1,
        projY: y1,
      };
    }
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
    return { distSq, t, projX, projY };
  }

  /**
   * Snaps a WGS84 GPS coordinate (latitude, longitude) to the nearest drivable road
   * segment in the SUMO road network, returning candidate graph junctions and snapped coordinates.
   */
  snapGpsToDrivableRoad(
    latitude: number,
    longitude: number,
    role: "origin" | "destination" = "origin",
  ): {
    candidateJunctions: string[];
    nearestSegmentId: string | null;
    distanceM: number;
    snappedLatLng: { lat: number; lng: number } | null;
  } {
    // 1. Geographic bounds validation (Bhopal Metropolitan Area)
    if (latitude < 23.10 || latitude > 23.40 || longitude < 77.25 || longitude > 77.60) {
      throw new AppError(
        400,
        "out_of_bounds",
        `GPS coordinate (${latitude}, ${longitude}) is outside the operational Bhopal service area.`,
      );
    }

    const sumoPoint = this.geo.latLngToSumo(latitude, longitude);
    if (sumoPoint === null) {
      throw new AppError(
        400,
        "projection_error",
        `Failed to project GPS coordinate (${latitude}, ${longitude}) into Bhopal metric CRS.`,
      );
    }

    const graph = this.routeEngine.getGraph();
    interface SegmentCandidate {
      segmentId: string;
      fromJunction: string;
      toJunction: string;
      distanceM: number;
      projX: number;
      projY: number;
      t: number;
    }

    const candidates: SegmentCandidate[] = [];

    for (const seg of this.catalog.segments) {
      if (!graph.hasNode(seg.fromJunction) || !graph.hasNode(seg.toJunction)) {
        continue;
      }
      for (const lane of seg.lanes) {
        for (let i = 0; i < lane.shape.length - 1; i++) {
          const p1 = lane.shape[i]!;
          const p2 = lane.shape[i + 1]!;
          const res = this.distToSegmentSquared(sumoPoint.x, sumoPoint.y, p1.x, p1.y, p2.x, p2.y);
          const distM = Math.sqrt(res.distSq);
          candidates.push({
            segmentId: seg.id,
            fromJunction: seg.fromJunction,
            toJunction: seg.toJunction,
            distanceM: distM,
            projX: res.projX,
            projY: res.projY,
            t: res.t,
          });
        }
      }
    }

    candidates.sort((a, b) => a.distanceM - b.distanceM);

    if (candidates.length === 0) {
      throw new AppError(422, "road_snap_failed", "No drivable road segments found in network.");
    }

    const best = candidates[0]!;
    const snappedLatLng = this.geo.sumoToLatLng(best.projX, best.projY);

    // Extract ordered candidate junctions for routing
    const junctionSet = new Set<string>();
    const topSegments = candidates.slice(0, 15);

    for (const c of topSegments) {
      if (role === "origin") {
        junctionSet.add(c.toJunction);
        junctionSet.add(c.fromJunction);
      } else {
        junctionSet.add(c.fromJunction);
        junctionSet.add(c.toJunction);
      }
    }

    return {
      candidateJunctions: Array.from(junctionSet),
      nearestSegmentId: best.segmentId,
      distanceM: Math.round(best.distanceM * 10) / 10,
      snappedLatLng,
    };
  }

  translateGpsToNetwork(latitude: number, longitude: number): {
    junctionId: string;
    distanceM: number;
    segmentId: string | null;
  } {
    try {
      const snapped = this.snapGpsToDrivableRoad(latitude, longitude, "origin");
      return {
        junctionId: snapped.candidateJunctions[0] ?? "I1",
        distanceM: snapped.distanceM,
        segmentId: snapped.nearestSegmentId,
      };
    } catch {
      return {
        junctionId: this.catalog.junctions[0]?.id ?? "I1",
        distanceM: 999,
        segmentId: null,
      };
    }
  }

  // ------------------------------------------------ ROUTE PREVIEW ----
  async previewRoute(input: {
    originLat?: number;
    originLng?: number;
    originJunction?: string;
    destinationJunction?: string;
    destinationHospitalId?: number;
    destinationLat?: number;
    destinationLng?: number;
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
    signals: Array<{
      id: string;
      type: string;
      isTrafficLight: boolean;
      lat: number;
      lng: number;
    }>;
  }> {
    const graph = this.routeEngine.getGraph();

    let originCandidates: string[] = [];
    if (typeof input.originLat === "number" && typeof input.originLng === "number") {
      const snap = this.snapGpsToDrivableRoad(input.originLat, input.originLng, "origin");
      originCandidates = snap.candidateJunctions;
    } else if (input.originJunction && graph.hasNode(input.originJunction)) {
      originCandidates = [input.originJunction];
    } else {
      originCandidates = [this.catalog.junctions[0]?.id ?? "I1"];
    }

    let destCandidates: string[] = [];
    if (typeof input.destinationLat === "number" && typeof input.destinationLng === "number") {
      const snap = this.snapGpsToDrivableRoad(input.destinationLat, input.destinationLng, "destination");
      destCandidates = snap.candidateJunctions;
    } else if (input.destinationHospitalId) {
      const hospital = await this.mobileRepo.getHospitalById(input.destinationHospitalId);
      if (hospital) {
        const snap = this.snapGpsToDrivableRoad(hospital.latitude, hospital.longitude, "destination");
        destCandidates = snap.candidateJunctions;
      }
    } else if (input.destinationJunction && graph.hasNode(input.destinationJunction)) {
      destCandidates = [input.destinationJunction];
    }

    if (destCandidates.length === 0) {
      destCandidates = [this.catalog.junctions[this.catalog.junctions.length - 1]?.id ?? "I6"];
    }

    // Attempt A* computation across candidate pairs to find the fastest valid connected road path
    let route: ComputedRoute | null = null;
    let chosenOrigin = originCandidates[0]!;
    let chosenDest = destCandidates[0]!;

    for (const oJ of originCandidates) {
      for (const dJ of destCandidates) {
        if (oJ === dJ) continue;
        try {
          const r = this.routeEngine.computeRoute(oJ, dJ);
          if (r.segments.length > 0) {
            if (!route || r.estimatedTravelTimeS < route.estimatedTravelTimeS) {
              route = r;
              chosenOrigin = oJ;
              chosenDest = dJ;
            }
          }
        } catch {
          // Continue testing next candidate pair
        }
      }
      if (route !== null) break;
    }

    if (route === null || route.segments.length === 0) {
      throw new AppError(
        422,
        "route_unreachable",
        "No drivable road route found connecting origin and destination through the Bhopal road network. DO NOT fall back to a straight line.",
      );
    }

    // Validate route connectivity and structure
    const routeProblems = this.routeEngine.validateRoute(route);
    if (routeProblems.length > 0) {
      throw new AppError(
        422,
        "invalid_route_connectivity",
        `Route failed topological connectivity validation: ${JSON.stringify(routeProblems)}`,
      );
    }

    // Extract exact road edge geometry preserving turns, curves, intersections, and road shape
    const segmentsWithCoords = route.segments.map((seg) => {
      const netSeg = this.catalog.segments.find((s) => s.id === seg.segmentId);
      const coords: Array<{ lat: number; lng: number }> = [];
      if (netSeg && netSeg.lanes.length > 0) {
        for (const pt of netSeg.lanes[0]!.shape) {
          const latLng = this.geo.sumoToLatLng(pt.x, pt.y);
          if (latLng) {
            if (latLng.lat >= 23.10 && latLng.lat <= 23.40 && latLng.lng >= 77.25 && latLng.lng <= 77.60) {
              coords.push(latLng);
            }
          }
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

    // Real traffic signals / intersections along the traversed route edges in order
    const routeJunctionIds: string[] = [];
    if (route.junctions.length > 0) {
      routeJunctionIds.push(route.junctions[0]!);
    }
    for (const seg of route.segments) {
      if (!routeJunctionIds.includes(seg.toJunction)) {
        routeJunctionIds.push(seg.toJunction);
      }
    }

    const routeJunctions = routeJunctionIds
      .map((jId) => this.catalog.junctions.find((j) => j.id === jId))
      .filter((j): j is typeof this.catalog.junctions[number] => j !== undefined);

    const trafficLightJunctions = routeJunctions.filter(
      (j) => j.kind === "traffic_light" || this.catalog.signals.some((s) => s.id === j.id),
    );

    const candidateJunctions = trafficLightJunctions.length >= 2 ? trafficLightJunctions : routeJunctions;

    const signals = candidateJunctions
      .map((j, idx) => {
        const latLng = this.geo.sumoToLatLng(j.x, j.y);
        const seq = String(idx + 1).padStart(2, "0");
        return {
          id: `S${seq}`,
          junctionId: j.id,
          name: `Signal S${seq} (${j.id})`,
          type: j.kind,
          isTrafficLight: j.kind === "traffic_light" || this.catalog.signals.some((s) => s.id === j.id),
          lat: latLng ? Math.round(latLng.lat * 1e6) / 1e6 : 0,
          lng: latLng ? Math.round(latLng.lng * 1e6) / 1e6 : 0,
          sequenceIndex: idx,
        };
      })
      .filter((s) => s.lat !== 0 && s.lng !== 0);

    return {
      routeId: `route-${chosenOrigin}-${chosenDest}-${Date.now()}`,
      originJunction: chosenOrigin,
      destinationJunction: chosenDest,
      totalLengthM: route.totalLengthM,
      estimatedTravelTimeS: route.estimatedTravelTimeS,
      segments: segmentsWithCoords,
      signals,
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

    let originCandidates: string[] = [];
    if (pickupLat !== undefined && pickupLng !== undefined) {
      const snap = this.snapGpsToDrivableRoad(pickupLat, pickupLng, "origin");
      originCandidates = snap.candidateJunctions;
    } else if (body.origin && this.catalog.junctions.some((j) => j.id === body.origin)) {
      originCandidates = [body.origin];
    } else {
      originCandidates = [this.catalog.junctions[0]?.id ?? "I1"];
    }

    // Resolve Destination Junction
    let hospital = null;
    let hospitalId: number | null = null;
    let destCandidates: string[] = [];
    if (body.destinationHospitalId) {
      hospital = await this.mobileRepo.getHospitalById(Number(body.destinationHospitalId));
      if (hospital) {
        hospitalId = hospital.id;
        const snap = this.snapGpsToDrivableRoad(hospital.latitude, hospital.longitude, "destination");
        destCandidates = snap.candidateJunctions;
      }
    } else if (body.destination && this.catalog.junctions.some((j) => j.id === body.destination)) {
      destCandidates = [body.destination];
    }

    if (destCandidates.length === 0) {
      destCandidates = [this.catalog.junctions[this.catalog.junctions.length - 1]?.id ?? "I6"];
    }

    let origin = originCandidates[0]!;
    let destination = destCandidates[0]!;
    let routeFound = false;

    for (const oJ of originCandidates) {
      for (const dJ of destCandidates) {
        if (oJ === dJ) continue;
        try {
          const r = this.routeEngine.computeRoute(oJ, dJ);
          if (r.segments.length > 0) {
            origin = oJ;
            destination = dJ;
            routeFound = true;
            break;
          }
        } catch {}
      }
      if (routeFound) break;
    }

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
