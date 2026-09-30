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
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { DatabasePool } from "../../database/db.ts";
import { AppError } from "../../errors.ts";
import { createLogger, type Logger } from "../../logger.ts";
import type {
  CreateEmergencyBody,
  DriverProfile,
  DriverTelemetryPayload,
  EmergencyEventDetail,
  EmergencyPriority,
  EmergencyType,
  ExecutionMode,
  FleetVehicleRecord,
  HospitalRecord,
  PoliceZoneRecord,
  RouteSummary,
  SystemStatusResponse,
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
  manager?: SimulationManager;
  db?: DatabasePool;
  executionMode?: ExecutionMode;
  logger?: Logger;
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
  private readonly manager?: SimulationManager;
  private readonly db?: DatabasePool;
  private readonly executionMode: ExecutionMode;
  private readonly logger: Logger;
  private version = 0;

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
    this.manager = options.manager;
    this.db = options.db;
    this.executionMode = options.executionMode ?? "SIMULATION";
    this.logger = options.logger ?? createLogger("mobile-service");
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
      if (!this.geo.geoReferenced) {
        const juncs = this.catalog.junctions.map((j) => j.id);
        return {
          candidateJunctions: role === "origin" ? [juncs[0] ?? "I1"] : [juncs[juncs.length - 1] ?? "I6"],
          nearestSegmentId: this.catalog.segments[0]?.id ?? null,
          distanceM: 0,
          snappedLatLng: { lat: latitude, lng: longitude },
        };
      }
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

    // Resolve vehicle - auto-assign or switch if requested and not in active emergency
    let vehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);
    if (body.vehicleCode && (!vehicle || vehicle.vehicleCode !== body.vehicleCode)) {
      const driverEvents = await this.emergencyRepo.getEventsByDriver(driverId);
      const driverActive = driverEvents.find((e) => e.status === "active" || e.status === "created");
      if (!driverActive) {
        const vehicles = await this.mobileRepo.listFleetVehicles();
        const matched = vehicles.find((v) => v.vehicleCode === body.vehicleCode);
        if (matched) {
          vehicle = await this.mobileRepo.assignVehicleToDriver(driverId, matched.id);
        }
      }
    }
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

    // In SIMULATION mode, guard against mixing remote hardware GPS (e.g. Gwalior 26.2°N) with Bhopal road network (23.2°N)
    const rawBody = body as unknown as Record<string, unknown>;
    const rawLat = (body.pickupLatitude ?? rawBody.pickupLat ?? rawBody.originLat ?? rawBody.latitude) as number | undefined;
    const rawLng = (body.pickupLongitude ?? rawBody.pickupLng ?? rawBody.originLng ?? rawBody.longitude) as number | undefined;
    const pickupLat = typeof rawLat === "number" && !isNaN(rawLat) ? rawLat : undefined;
    const pickupLng = typeof rawLng === "number" && !isNaN(rawLng) ? rawLng : undefined;

    const isOutsideBhopal =
      pickupLat !== undefined &&
      pickupLng !== undefined &&
      (pickupLat < 23.0 || pickupLat > 23.5 || pickupLng < 77.1 || pickupLng > 77.7);

    let originCandidates: string[] = [];
    if (!isOutsideBhopal && pickupLat !== undefined && pickupLng !== undefined) {
      const snap = this.snapGpsToDrivableRoad(pickupLat, pickupLng, "origin");
      originCandidates = snap.candidateJunctions;
    } else if (body.origin) {
      const resolved = this.routeEngine.resolveJunctionId(body.origin);
      if (this.catalog.junctions.some((j) => j.id === resolved)) {
        originCandidates = [resolved];
      }
    }

    if (originCandidates.length === 0) {
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
    } else if (body.destination) {
      const resolved = this.routeEngine.resolveJunctionId(body.destination);
      if (this.catalog.junctions.some((j) => j.id === resolved)) {
        destCandidates = [resolved];
      }
    }

    const rawDestLat = (rawBody.destinationLat ?? rawBody.destLat) as number | undefined;
    const rawDestLng = (rawBody.destinationLng ?? rawBody.destLng) as number | undefined;
    if (destCandidates.length === 0 && typeof rawDestLat === "number" && typeof rawDestLng === "number") {
      const snap = this.snapGpsToDrivableRoad(rawDestLat, rawDestLng, "destination");
      destCandidates = snap.candidateJunctions;
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

    // Create via core emergency service with full mobile metadata and canonical vehicleCode
    const detail = await this.emergencyService.createEmergency({
      type: emergencyType,
      origin,
      destination,
      priority,
      driverId: driver.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.vehicleCode,
      destinationHospitalId: hospitalId ?? undefined,
      patientCondition: body.patientCondition,
      severity: body.severity,
      originAddress: isOutsideBhopal ? "Bhopal Simulation Origin (MP Nagar)" : (body.originAddress ?? "Bhopal Driver Pickup Location"),
      destinationAddress: body.destinationAddress ?? (hospital ? hospital.name : undefined),
      pickupLatitude: isOutsideBhopal ? 23.2332 : pickupLat,
      pickupLongitude: isOutsideBhopal ? 77.4339 : pickupLng,
    });

    // Update fleet vehicle and driver status
    await this.mobileRepo.updateVehicleStatus(vehicle.id, "in_emergency", detail.id);
    await this.mobileRepo.updateDriverStatus(driver.id, "in_emergency");

    // Initialize emergency verification record for this session (unauthorized, awaiting photo and webapp approval)
    const requestId = `VRF-${Date.now()}-${driver.driver_code}`;
    await this.mobileRepo.createOrUpdateVerification({
      requestId,
      eventId: detail.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      status: "submitted",
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
      this.version += 1;
      this.bus.broadcast("emergency:created", {
        ...enriched,
        version: this.version,
        emergencyId: enriched.id,
        vehicleId: vehicle.vehicleCode,
      });
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

      const simStatus = this.manager?.getStatusSnapshot().status;
      const isSimRunning = simStatus === "running" || simStatus === "paused";
      const isOutsideBhopal = payload.latitude < 23.0 || payload.latitude > 23.5 || payload.longitude < 77.1 || payload.longitude > 77.7;

      // In SIMULATION mode with active SUMO, SUMO TraCI is authoritative for vehicle movement in Bhopal.
      // Do not corrupt the Bhopal SUMO ambulance position on Web with physical phone GPS from Gwalior!
      if (!isSimRunning || !isOutsideBhopal || this.executionMode === "REAL_GPS") {
        const sumoPt = this.geo.latLngToSumo(payload.latitude, payload.longitude);
        const junc = mapping.junctionId ? this.catalog.junctions.find((j) => j.id === mapping.junctionId) : null;
        const posX = sumoPt?.x ?? junc?.x ?? 0;
        const posY = sumoPt?.y ?? junc?.y ?? 0;

        // Only broadcast if mapped into the network
        if (posX > 0 || posY > 0) {
          this.bus.broadcast("vehicle:update", {
            simTimeSeconds: this.manager?.getStatusSnapshot().simTimeSeconds ?? 0,
            vehicles: [
              {
                id: vehicle.vehicleCode,
                typeId: vehicle.vehicleType,
                lat: payload.latitude,
                lng: payload.longitude,
                speed: payload.speedMps ?? 0,
                angle: payload.heading ?? 0,
                roadId: mapping.segmentId ?? "",
                laneId: "",
                lanePosition: 0,
                positionX: posX,
                positionY: posY,
              },
            ],
          });
        }
      }
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

    if (verification.isCorridorAuthorized) {
      try {
        await this.corridorService.createCorridor(input.eventId);
        this.logger.info("[CORRIDOR_CREATED] Green corridor activated on AI verification", { eventId: input.eventId });
      } catch (err) {
        // Already active or planned
      }
    }

    return { evidenceId, verification };
  }

  // ------------------------------------------ EMERGENCY COMPLETION ----
  async completeEmergency(
    eventId: number,
    driverId: number,
    ipAddress?: string,
    callerRole?: string,
  ): Promise<{ status: "completed"; eventId: number }> {
    const event = await this.emergencyService.getEmergency(eventId);
    if (event.status === "completed") {
      return { status: "completed", eventId };
    }
    const isAuthorized =
      callerRole === "operator" ||
      callerRole === "admin" ||
      !event.mobile?.driverId ||
      event.mobile.driverId === driverId ||
      driverId === 0;

    if (!isAuthorized) {
      throw new AppError(403, "forbidden", "You can only complete your own emergencies.");
    }
    if (event.status === "cancelled") {
      throw new AppError(409, "invalid_state_transition", `Cannot complete an emergency that is ${event.status}.`);
    }

    const effectiveDriverId = event.mobile?.driverId ?? (driverId > 0 ? driverId : null);
    const driver = effectiveDriverId ? await this.mobileRepo.getDriverById(effectiveDriverId) : null;
    const vehicle = effectiveDriverId ? await this.mobileRepo.getAssignedVehicleForDriver(effectiveDriverId) : null;

    // Cancel active corridor if running
    try {
      const corridors = await this.corridorService.listCorridors();
      const active = corridors.find((c) => c.eventId === eventId && (c.status === "ACTIVE" || c.status === "PLANNING"));
      if (active) {
        await this.corridorService.cancelCorridor(active.id, "Emergency marked complete.");
      }
    } catch (err) {
      // Non-fatal corridor cancellation error
    }

    // If vehicle was spawned in SUMO, remove it cleanly so ID is immediately free
    try {
      const vehicleCode = vehicle?.vehicleCode ?? event.vehicle?.vehicleId;
      if (vehicleCode && this.manager?.getStatusSnapshot().status === "running") {
        await this.manager.removeVehicle(vehicleCode);
      }
    } catch {}

    // Mark completed in database
    await this.emergencyRepo.completeEmergency(eventId);

    // Release driver and vehicle
    if (vehicle) {
      await this.mobileRepo.updateVehicleStatus(vehicle.id, "available", null);
    }
    if (driver) {
      await this.mobileRepo.updateDriverStatus(driver.id, "on_duty");
    }

    const actorRole: "driver" | "admin" | "operator" | "system" =
      callerRole === "admin" ? "admin" : callerRole === "operator" ? "operator" : "driver";

    await this.mobileRepo.recordAudit(
      "emergency_completed",
      driver?.driver_code ?? (callerRole ?? (driverId ? String(driverId) : "operator")),
      actorRole,
      eventId,
      {},
      ipAddress,
    );

    this.version += 1;
    this.bus.broadcast("emergency:completed", {
      eventId,
      emergencyId: eventId,
      driverId: effectiveDriverId ?? 0,
      vehicleId: vehicle?.vehicleCode ?? event.vehicle?.vehicleId ?? "AMB-001",
      status: "completed",
      version: this.version,
      completedAt: new Date().toISOString(),
    });

    this.logger.info(`[EMERGENCY_COMPLETE] Emergency marked completed`, {
      emergencyId: eventId,
      vehicleId: vehicle?.vehicleCode ?? event.vehicle?.vehicleId ?? "AMB-001",
      version: this.version,
      timestamp: new Date().toISOString(),
    });

    return { status: "completed", eventId };
  }

  // ---------------------------------------- EMERGENCY CANCELLATION ----
  async cancelEmergency(
    eventId: number,
    driverId: number,
    reason: string,
    ipAddress?: string,
    callerRole?: string,
  ): Promise<{ status: "cancelled"; eventId: number; reason: string }> {
    const event = await this.emergencyService.getEmergency(eventId);
    if (event.status === "cancelled") {
      return { status: "cancelled", eventId, reason };
    }
    const isAuthorized =
      callerRole === "operator" ||
      callerRole === "admin" ||
      !event.mobile?.driverId ||
      event.mobile.driverId === driverId ||
      driverId === 0;

    if (!isAuthorized) {
      throw new AppError(403, "forbidden", "You can only cancel your own emergencies.");
    }
    if (event.status === "completed") {
      throw new AppError(409, "invalid_state_transition", `Cannot cancel an emergency that is ${event.status}.`);
    }

    const effectiveDriverId = event.mobile?.driverId ?? (driverId > 0 ? driverId : null);
    const driver = effectiveDriverId ? await this.mobileRepo.getDriverById(effectiveDriverId) : null;
    const vehicle = effectiveDriverId ? await this.mobileRepo.getAssignedVehicleForDriver(effectiveDriverId) : null;

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

    // Clean up vehicle in SUMO
    try {
      const vehicleCode = vehicle?.vehicleCode ?? event.vehicle?.vehicleId;
      if (vehicleCode && this.manager?.getStatusSnapshot().status === "running") {
        await this.manager.removeVehicle(vehicleCode);
      }
    } catch {}

    await this.emergencyRepo.cancelEmergency(eventId, reason, driver?.driver_code ?? (callerRole ?? "operator"));

    if (vehicle) {
      await this.mobileRepo.updateVehicleStatus(vehicle.id, "available", null);
    }
    if (driver) {
      await this.mobileRepo.updateDriverStatus(driver.id, "on_duty");
    }

    const cancelActorRole: "driver" | "admin" | "operator" | "system" =
      callerRole === "admin" ? "admin" : callerRole === "operator" ? "operator" : "driver";

    await this.mobileRepo.recordAudit(
      "emergency_cancelled",
      driver?.driver_code ?? (callerRole ?? (driverId ? String(driverId) : "operator")),
      cancelActorRole,
      eventId,
      { reason },
      ipAddress,
    );

    this.version += 1;
    this.bus.broadcast("emergency:cancelled", {
      eventId,
      emergencyId: eventId,
      driverId: effectiveDriverId ?? 0,
      vehicleId: vehicle?.vehicleCode ?? event.vehicle?.vehicleId ?? "AMB-001",
      status: "cancelled",
      reason,
      version: this.version,
      cancelledAt: new Date().toISOString(),
    });

    this.logger.info(`[EMERGENCY_CANCEL] Emergency marked cancelled`, {
      emergencyId: eventId,
      vehicleId: vehicle?.vehicleCode ?? event.vehicle?.vehicleId ?? "AMB-001",
      reason,
      version: this.version,
      timestamp: new Date().toISOString(),
    });

    return { status: "cancelled", eventId, reason };
  }

  // ---------------------------------------- SYSTEM STATUS ----
  async getSystemStatus(): Promise<SystemStatusResponse> {
    const simStatus = this.manager?.getStatusSnapshot();
    const isSumoRunning = simStatus?.status === "running" || simStatus?.status === "paused";
    const traciConnected = Boolean(this.manager?.getTraCIClient());
    const dbConnected = this.db ? this.db.isHealthy() : true;

    let systemStatus: "online" | "degraded" | "offline" = "online";
    if (!dbConnected || !traciConnected) {
      systemStatus = "degraded";
    }
    if (!dbConnected && !isSumoRunning) {
      systemStatus = "offline";
    }

    const activeEmergencies =
      (this.emergencyService?.getActiveEmergencies ? this.emergencyService.getActiveEmergencies().length : null) ??
      (this.emergencyService?.getActiveEventIds ? this.emergencyService.getActiveEventIds().length : null) ??
      ((this.manager as any)?.getActiveEmergencies ? (this.manager as any).getActiveEmergencies().length : 0);
    let activeCorridors = 0;
    try {
      const corridors = await this.corridorService.listCorridors();
      activeCorridors = corridors.filter((c) => c.status === "ACTIVE").length;
    } catch {}

    return {
      systemStatus,
      sumoStatus: isSumoRunning ? "connected" : "disconnected",
      traciStatus: traciConnected ? "connected" : "disconnected",
      databaseStatus: dbConnected ? "connected" : "disconnected",
      websocketStatus: "connected",
      mode: this.executionMode,
      activeEmergencies,
      activeCorridors,
      timestamp: new Date().toISOString(),
    };
  }
}
