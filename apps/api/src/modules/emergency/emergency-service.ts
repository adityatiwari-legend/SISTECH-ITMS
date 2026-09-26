import type {
  CreateEmergencyBody,
  EmergencyEta,
  EmergencyEventDetail,
  EmergencyType,
  EmergencyVehicleRecord,
  MobileEmergencyMeta,
  RouteSummary,
  VehicleSnapshot,
} from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { AppError } from "../../errors.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { ComputedRoute, RouteEngine } from "../routing/route-engine.ts";
import { RouteError, describeRouteProblem } from "../routing/route-engine.ts";
import { geoFromCatalog, extractRouteGeometry } from "../simulation/geo.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import {
  EmergencyRepository,
  type EmergencyEventRow,
  type EmergencyVehicleRow,
  type RouteRow,
  type RouteSegmentRow,
} from "../../database/repositories/emergency-repository.ts";

/**
 * Emergency management (Phases.md 3).
 *
 * Workflow: operator creates an emergency (type/origin/destination/priority)
 * → route computed with A* over live traffic → persisted → emergency vehicle
 * spawned in SUMO with that route → per-step tracking (position/speed come
 * from the simulation snapshots) → ETA per upcoming controlled intersection
 * → arrival detection via SUMO's arrived-vehicle list.
 *
 * No movement is simulated here: SUMO is the single source of truth for
 * vehicle motion.
 */

/** SUMO vType ids per emergency type (defined in emergency-fleet.add.xml). */
const TYPE_IDS: Record<CreateEmergencyBody["type"], string> = {
  ambulance: "emergency.ambulance",
  fire_engine: "emergency.fireengine",
  police: "emergency.police",
};

interface ActiveEmergency {
  eventId: number;
  vehicleRowId: number;
  vehicleId: string;
  routeRowId: number | null;
  status: EmergencyEventDetail["status"];
  routeEdges: string[];
  destinationJunction: string;
  routeLengths: number[];
  /** Sim times captured at transitions (metrics). */
  activatedSimTimeS: number | null;
  arrivedSimTimeS: number | null;
  /** Dynamic route switches so far (safeguard). */
  switchCount: number;
  /** Last recognized non-internal route edge index (survives intersection internal edges). */
  lastKnownRouteIndex: number;
}

/** In-memory runtime snapshot of an emergency (no database access). */
export interface EmergencyRuntimeSnapshot {
  eventId: number;
  status: EmergencyEventDetail["status"];
  type: EmergencyType;
  vehicleId: string;
  priority: EmergencyEventDetail["priority"];
  originJunction: string;
  destinationJunction: string;
  routeEdges: string[];
  routeLengths: number[];
  live: {
    simTimeSeconds: number;
    positionX: number;
    positionY: number;
    speedMps: number;
    roadId: string;
    laneId: string;
    routeIndex: number;
  } | null;
}

export class EmergencyService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly routeEngine: RouteEngine;
  private readonly repository: EmergencyRepository;
  private readonly bus: WsBus;
  /** Junctions with traffic lights (from the network catalog). */
  private readonly controlledJunctions: Set<string>;
  /** Live run id accessor (owned by the traffic service). */
  private readonly getRunId: () => number | null;

  private active = new Map<number, ActiveEmergency>();
  private sequence = 0;
  private eventListeners: Array<() => void> = [];
  /** Priority, vehicle type and last persisted status per event (corridor service reads). */
  private priorityByEvent = new Map<number, EmergencyEventDetail["priority"]>();
  private typeByEvent = new Map<number, EmergencyType>();
  private persistedStatusByEvent = new Map<number, EmergencyEventDetail["status"]>();
  /** Sim-time transition bookkeeping kept after the runtime is removed. */
  private transitionSimTimesByEvent = new Map<number, { activatedSimTimeS: number | null; arrivedSimTimeS: number | null }>();

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    routeEngine: RouteEngine;
    repository: EmergencyRepository;
    bus: WsBus;
    controlledJunctions: Set<string>;
    getRunId: () => number | null;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.routeEngine = options.routeEngine;
    this.repository = options.repository;
    this.bus = options.bus;
    this.controlledJunctions = options.controlledJunctions;
    this.getRunId = options.getRunId;

    this.eventListeners.push(
      options.manager.onStep(() => this.trackingStep()),
      options.manager.onStopped((event) => this.handleSimStopped(event.reason)),
    );
  }

  async dispose(): Promise<void> {
    for (const off of this.eventListeners) off();
    this.eventListeners = [];
  }

  // ------------------------------------------------------------------
  // Runtime access for dependent services (corridor engine, Phase 5+)
  // ------------------------------------------------------------------

  /** In-memory runtime snapshot; null when the event is unknown/inactive. */
  getEmergencyRuntime(eventId: number): EmergencyRuntimeSnapshot | null {
    const emergency = this.active.get(eventId);
    if (emergency === undefined) return null;
    const liveVehicle = this.manager.getVehicles().find((v) => v.id === emergency.vehicleId) ?? null;
    // The origin junction is the first approached junction: the first route
    // edge's toJunction via the road graph (network-naming independent).
    const firstEdge = this.routeEngine.getGraph().getEdge(emergency.routeEdges[0] ?? "");
    const originJunction =
      firstEdge !== null
        ? firstEdge.toJunction
        : emergency.routeEdges[0]?.split("_")[0]?.toUpperCase() ?? "";
    return {
      eventId: emergency.eventId,
      status: emergency.status,
      type: this.typeByEvent.get(eventId) ?? "ambulance",
      vehicleId: emergency.vehicleId,
      priority: this.priorityByEvent.get(eventId) ?? "normal",
      originJunction,
      destinationJunction: emergency.destinationJunction,
      routeEdges: [...emergency.routeEdges],
      routeLengths: [...emergency.routeLengths],
      live:
        liveVehicle !== null
          ? {
              simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
              positionX: liveVehicle.positionX,
              positionY: liveVehicle.positionY,
              speedMps: liveVehicle.speed,
              roadId: liveVehicle.roadId,
              laneId: liveVehicle.laneId,
              routeIndex: liveVehicle.roadId.startsWith(":")
                ? emergency.lastKnownRouteIndex
                : (() => {
                    const idx = emergency.routeEdges.indexOf(liveVehicle.roadId);
                    if (idx >= 0) emergency.lastKnownRouteIndex = idx;
                    return emergency.lastKnownRouteIndex;
                  })(),
            }
          : null,
    };
  }

  /** Last known persisted status of an event (in-memory mirror of the DB). */
  getPersistedStatus(eventId: number): EmergencyEventDetail["status"] | null {
    return this.persistedStatusByEvent.get(eventId) ?? null;
  }

  /** Ids of all in-memory active emergencies (created/active). */
  getActiveEventIds(): number[] {
    return [...this.active.keys()];
  }

  /** ETAs for the upcoming controlled junctions + destination (in-memory). */
  getEtas(eventId: number): EmergencyEta[] | null {
    const emergency = this.active.get(eventId);
    if (emergency === undefined) return null;
    const live = this.manager.getVehicles().find((v) => v.id === emergency.vehicleId) ?? null;
    if (live === null) return null;
    return this.computeEtas(emergency, live);
  }

  /**
   * Dynamically re-routes an active emergency (closed loop, Phases.md 6.3):
   * SUMO gets the new edge list (current edge first), a route revision is
   * persisted (routes + emergency_route_switches), and the runtime state is
   * updated. The caller decides WHEN to switch (hysteresis/safeguards);
   * this method performs the switch atomically.
   */
  async rerouteEmergency(input: {
    eventId: number;
    /** Full new edge list; the FIRST edge must be the vehicle's current edge. */
    edges: string[];
    reason: string;
    oldEtaS: number;
    newEtaS: number;
  }): Promise<{ switched: boolean; routeId: number | null; error: string | null }> {
    const emergency = this.active.get(input.eventId);
    if (emergency === undefined) {
      return { switched: false, routeId: null, error: `Emergency event ${input.eventId} is not active.` };
    }
    if (input.edges[0] === undefined) {
      return { switched: false, routeId: null, error: "New route is empty." };
    }

    // 1. Update SUMO (source of truth for movement).
    try {
      await this.manager.setVehicleRouteEdges(emergency.vehicleId, input.edges);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("SUMO rejected the emergency reroute", { eventId: input.eventId, error: message });
      return { switched: false, routeId: null, error: message };
    }

    // 2. Persist the route revision + switch record.
    const simTime = this.manager.getStatusSnapshot().simTimeSeconds;
    let routeId: number | null = null;
    try {
      routeId = await this.repository.addRouteRevision({
        eventId: input.eventId,
        originJunction: (() => {
          const firstEdge = this.routeEngine.getGraph().getEdge(emergency.routeEdges[0] ?? input.edges[0] ?? "");
          return firstEdge !== null ? firstEdge.toJunction : emergency.destinationJunction;
        })(),
        destinationJunction: emergency.destinationJunction,
        edges: input.edges.map((segmentId) => {
          const edge = this.routeEngine.getGraph().getEdge(segmentId);
          if (edge === null) {
            throw new Error(`New route edge ${segmentId} is not in the network`);
          }
          return {
            segmentId,
            fromJunction: edge.fromJunction,
            toJunction: edge.toJunction,
            lengthM: edge.distanceM,
            costSeconds: this.routeEngine.edgeCost(segmentId).costSeconds,
            congestion: edge.congestion,
          };
        }),
        estimatedTravelTimeS: input.newEtaS,
        freeFlowTravelTimeS: input.edges.reduce((sum, segmentId) => {
          const edge = this.routeEngine.getGraph().getEdge(segmentId);
          return sum + (edge !== null ? edge.distanceM / edge.freeFlowSpeedMps : 0);
        }, 0),
        reason: input.reason,
        simTimeS: simTime,
        fromRouteId: emergency.routeRowId,
      });
    } catch (err) {
      // SUMO already has the route; persistence problems must not revert it.
      this.logger.error("Could not persist route revision", { eventId: input.eventId, error: err });
    }

    // 3. Update the runtime state to the new route.
    emergency.routeEdges = [...input.edges];
    emergency.routeLengths = input.edges.map((segmentId) => {
      const edge = this.routeEngine.getGraph().getEdge(segmentId);
      return edge !== null ? edge.distanceM : 0;
    });
    if (routeId !== null) {
      emergency.routeRowId = routeId;
    }
    emergency.switchCount += 1;
    emergency.lastKnownRouteIndex = 0;

    const catalog = this.routeEngine.getCatalog();
    const geo = geoFromCatalog(catalog);
    this.bus.broadcast("route:switched", {
      emergencyId: input.eventId,
      routeId: routeId,
      simTimeSeconds: simTime,
      reason: input.reason,
      oldEtaS: round1(input.oldEtaS),
      newEtaS: round1(input.newEtaS),
      segments: input.edges,
      coordinates: extractRouteGeometry(input.edges, catalog, geo),
      updatedAt: new Date().toISOString(),
    });
    this.logger.info("Emergency rerouted", {
      eventId: input.eventId,
      switch: emergency.switchCount,
      reason: input.reason,
      oldEta: round1(input.oldEtaS),
      newEta: round1(input.newEtaS),
    });
    return { switched: true, routeId, error: null };
  }

  /** Runtime route-switch count (safeguard for the closed loop). */
  getSwitchCount(eventId: number): number | null {
    return this.active.get(eventId)?.switchCount ?? null;
  }

  /** Sim-time transition record for metrics (null when not captured yet). */
  getTransitionSimTimes(eventId: number): { activatedSimTimeS: number | null; arrivedSimTimeS: number | null } | null {
    const emergency = this.active.get(eventId);
    if (emergency !== undefined) {
      return { activatedSimTimeS: emergency.activatedSimTimeS, arrivedSimTimeS: emergency.arrivedSimTimeS };
    }
    // The event may have arrived already (runtime deleted after a step).
    return this.transitionSimTimesByEvent.get(eventId) ?? null;
  }

  // ------------------------------------------------------------------
  // Creation workflow (Phases.md 3.4)
  // ------------------------------------------------------------------

  /**
   * Creates an emergency: validates input, computes the A* route, persists
   * vehicle+event+route, and spawns the vehicle in SUMO. Requires a running
   * simulation (spawning and live traffic are impossible otherwise).
   */
  async createEmergency(body: CreateEmergencyBody): Promise<EmergencyEventDetail> {
    const status = this.manager.getStatusSnapshot();
    if (status.status !== "running" && status.status !== "paused") {
      if (!body.driverId) {
        throw new AppError(
          409,
          "simulation_not_running",
          `An emergency requires a running simulation (current status: ${status.status}).`,
        );
      }
      this.logger.warn("Simulation unavailable for mobile driver emergency - running in GPS telemetry mode");
    }

    const origin = body.origin ?? "I1";
    const destination = body.destination ?? "I6";

    let route: ComputedRoute | null = null;
    const endpointProblem = this.routeEngine.validateEndpoints(origin, destination);
    if (endpointProblem === null) {
      try {
        const computed = this.routeEngine.computeRoute(origin, destination);
        const routeProblems = this.routeEngine.validateRoute(computed);
        if (routeProblems.length === 0) {
          route = computed;
        }
      } catch (err) {
        if (!body.driverId && status.status === "running") {
          if (err instanceof RouteError) {
            throw new AppError(422, "invalid_emergency_route", err.message);
          }
          throw err;
        }
        this.logger.warn("Route compute skipped for driver app emergency", { origin, destination });
      }
    } else if (!body.driverId && status.status === "running") {
      throw new AppError(422, "invalid_emergency_route", describeRouteProblem(endpointProblem));
    }

    this.sequence += 1;
    const vehicleId = `emv-${status.scenario ?? "sim"}-${this.sequence}-${Date.now() % 10000}`;
    let persisted: {
      vehicle: EmergencyVehicleRow;
      event: EmergencyEventRow;
      route: RouteRow | null;
    };
    try {
      persisted = await this.repository.createEmergency(
        {
          type: body.type,
          priority: body.priority,
          originJunction: origin,
          destinationJunction: destination,
          vehicleId,
          runId: this.getRunId(),
          driverId: body.driverId ?? null,
          fleetVehicleId: body.vehicleId ? Number(body.vehicleId) : null,
          hospitalId: body.destinationHospitalId ? Number(body.destinationHospitalId) : null,
          patientCondition: body.patientCondition ?? null,
          severity: body.severity ?? "codeRed",
          originAddress: body.originAddress ?? null,
          destinationAddress: body.destinationAddress ?? null,
          pickupLatitude: body.pickupLatitude ?? null,
          pickupLongitude: body.pickupLongitude ?? null,
        },
        route
          ? {
              edges: route.segments.map((segment) => ({
                segmentId: segment.segmentId,
                fromJunction: segment.fromJunction,
                toJunction: segment.toJunction,
                lengthM: segment.lengthM,
                costSeconds: segment.costSeconds,
                congestion: segment.congestion,
              })),
              estimatedTravelTimeS: route.estimatedTravelTimeS,
              freeFlowTravelTimeS: route.freeFlowTravelTimeS,
            }
          : null,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(503, "database_error", `Could not store the emergency: ${message}`);
    }

    const sumoRouteId = `route-emv-${persisted.event.id}`;
    if (this.manager.getStatusSnapshot().status === "running" && route !== null && route.segments.length > 0) {
      try {
        await this.manager.addVehicleRoute(sumoRouteId, route.segments.map((segment) => segment.segmentId));
        await this.manager.addVehicle({
          vehicleId,
          routeId: sumoRouteId,
          typeId: TYPE_IDS[body.type],
          departSpeed: "0",
        });
      } catch (err) {
        if (!body.driverId) {
          this.logger.error("Emergency vehicle spawn failed", { eventId: persisted.event.id, error: err });
          try {
            await this.repository.applyTransition({
              eventId: persisted.event.id,
              vehicleRowId: persisted.vehicle.id,
              status: "failed",
              activatedAtIso: null,
              arrivedAtIso: null,
              positionX: null,
              positionY: null,
              speedMps: null,
            });
          } catch (dbErr) {
            this.logger.error("Could not persist failed spawn", { error: dbErr });
          }
          throw err;
        }
        this.logger.warn("SUMO vehicle spawn skipped for driver app emergency", { error: err });
      }
    }

    this.active.set(persisted.event.id, {
      eventId: persisted.event.id,
      vehicleRowId: persisted.vehicle.id,
      vehicleId,
      routeRowId: persisted.route?.id ?? null,
      status: "created",
      routeEdges: route ? route.segments.map((segment) => segment.segmentId) : [],
      destinationJunction: destination,
      routeLengths: route ? route.segments.map((segment) => segment.lengthM) : [],
      activatedSimTimeS: null,
      arrivedSimTimeS: null,
      switchCount: 0,
      lastKnownRouteIndex: 0,
    });
    this.priorityByEvent.set(persisted.event.id, body.priority);
    this.typeByEvent.set(persisted.event.id, body.type);
    this.persistedStatusByEvent.set(persisted.event.id, "created");

    this.bus.broadcast("emergency:created", {
      eventId: persisted.event.id,
      type: body.type,
      priority: body.priority,
      origin,
      destination,
    });
    if (route) {
      const segmentIds = route.segments.map((segment) => segment.segmentId);
      const catalog = this.routeEngine.getCatalog();
      const geo = geoFromCatalog(catalog);
      this.bus.broadcast("route:updated", {
        emergencyId: persisted.event.id,
        routeId: sumoRouteId,
        segments: segmentIds,
        coordinates: extractRouteGeometry(segmentIds, catalog, geo),
        estimatedTravelTimeS: round1(route.estimatedTravelTimeS),
      });
      this.logger.info("Emergency created", {
        eventId: persisted.event.id,
        type: body.type,
        priority: body.priority,
        routeEdges: route.segments.length,
        estimatedTravelTimeS: round1(route.estimatedTravelTimeS),
      });
    } else {
      this.logger.info("Emergency created (mobile telemetry mode)", {
        eventId: persisted.event.id,
        type: body.type,
        priority: body.priority,
      });
    }

    // Re-read the persisted record so the response reflects the database
    // (including the route with its segments).
    const [eventRow, vehicleRow] = await Promise.all([
      this.repository.getEvent(persisted.event.id),
      this.repository.getVehicle(persisted.vehicle.id),
    ]);
    if (eventRow === null || vehicleRow === null) {
      throw new AppError(500, "emergency_corrupt", "Emergency could not be read back after creation.");
    }
    const routeRow = eventRow.route_id !== null ? await this.repository.getRoute(eventRow.route_id) : null;
    const segmentRows = routeRow !== null ? await this.repository.getRouteSegments(routeRow.id) : [];
    return this.buildDetail(eventRow, vehicleRow, routeRow, segmentRows);
  }

  // ------------------------------------------------------------------
  // Per-step tracking (statuses + transitions + WS updates)
  // ------------------------------------------------------------------

  private async trackingStep(): Promise<void> {
    if (this.active.size === 0) return;

    const arrivedIds = await this.manager.getArrivedVehicleIds();
    const arrivedSet = new Set(arrivedIds);
    const vehicleById = new Map(this.manager.getVehicles().map((vehicle) => [vehicle.id, vehicle] as const));

    for (const emergency of [...this.active.values()]) {
      // Keep the sim-time bookkeeping reachable after the runtime is deleted.
      this.transitionSimTimesByEvent.set(emergency.eventId, {
        activatedSimTimeS: emergency.activatedSimTimeS,
        arrivedSimTimeS: emergency.arrivedSimTimeS,
      });

      if (emergency.status === "arrived" || emergency.status === "failed" || emergency.status === "cancelled") {
        this.active.delete(emergency.eventId);
        continue;
      }

      if (arrivedSet.has(emergency.vehicleId)) {
        await this.markArrived(emergency, vehicleById.get(emergency.vehicleId) ?? null);
        continue;
      }

      const live = vehicleById.get(emergency.vehicleId);
      if (live === undefined) {
        // Not in the network yet: SUMO defers insertion when the departure
        // edge is blocked; the event stays "created".
        continue;
      }
      if (emergency.status === "created") {
        await this.markActive(emergency, live);
      }
    }
  }

  private async markActive(emergency: ActiveEmergency, live: VehicleSnapshot): Promise<void> {
    emergency.status = "active";
    this.persistedStatusByEvent.set(emergency.eventId, "active");
    if (emergency.activatedSimTimeS === null) {
      emergency.activatedSimTimeS = this.manager.getStatusSnapshot().simTimeSeconds;
    }
    this.updateTransitionBookkeeping(emergency);
    const nowIso = new Date().toISOString();
    try {
      await this.repository.applyTransition({
        eventId: emergency.eventId,
        vehicleRowId: emergency.vehicleRowId,
        status: "active",
        activatedAtIso: nowIso,
        arrivedAtIso: null,
        positionX: live.positionX,
        positionY: live.positionY,
        speedMps: live.speed,
        activatedSimTimeS: emergency.activatedSimTimeS,
      });
    } catch (err) {
      this.logger.error("Could not persist emergency activation", { eventId: emergency.eventId, error: err });
    }
    this.bus.broadcast("emergency:update", {
      eventId: emergency.eventId,
      status: "active",
      vehicleId: emergency.vehicleId,
      positionX: live.positionX,
      positionY: live.positionY,
      speedMps: live.speed,
    });
  }

  private async markArrived(emergency: ActiveEmergency, live: VehicleSnapshot | null): Promise<void> {
    emergency.status = "arrived";
    this.persistedStatusByEvent.set(emergency.eventId, "arrived");
    if (emergency.arrivedSimTimeS === null) {
      emergency.arrivedSimTimeS = this.manager.getStatusSnapshot().simTimeSeconds;
    }
    this.updateTransitionBookkeeping(emergency);
    const nowIso = new Date().toISOString();
    try {
      await this.repository.applyTransition({
        eventId: emergency.eventId,
        vehicleRowId: emergency.vehicleRowId,
        status: "arrived",
        activatedAtIso: null,
        arrivedAtIso: nowIso,
        positionX: live?.positionX ?? null,
        positionY: live?.positionY ?? null,
        speedMps: 0,
        activatedSimTimeS: emergency.activatedSimTimeS,
        arrivedSimTimeS: emergency.arrivedSimTimeS,
      });
    } catch (err) {
      this.logger.error("Could not persist emergency arrival", { eventId: emergency.eventId, error: err });
    }
    this.bus.broadcast("emergency:update", {
      eventId: emergency.eventId,
      status: "arrived",
      vehicleId: emergency.vehicleId,
      positionX: live?.positionX ?? null,
      positionY: live?.positionY ?? null,
      speedMps: 0,
    });
    this.logger.info("Emergency vehicle arrived", {
      eventId: emergency.eventId,
      vehicleId: emergency.vehicleId,
    });
  }

  /** Keeps the sim-time bookkeeping current at every transition point. */
  private updateTransitionBookkeeping(emergency: ActiveEmergency): void {
    this.transitionSimTimesByEvent.set(emergency.eventId, {
      activatedSimTimeS: emergency.activatedSimTimeS,
      arrivedSimTimeS: emergency.arrivedSimTimeS,
    });
  }

  /** Simulation stopped/ended/disconnected: any unfinished emergency failed. */
  private async handleSimStopped(reason: "stopped" | "simulation_ended" | "disconnected"): Promise<void> {
    for (const emergency of this.active.values()) {
      if (emergency.status !== "created" && emergency.status !== "active") continue;
      this.persistedStatusByEvent.set(emergency.eventId, "failed");
      try {
        await this.repository.applyTransition({
          eventId: emergency.eventId,
          vehicleRowId: emergency.vehicleRowId,
          status: "failed",
          activatedAtIso: null,
          arrivedAtIso: null,
          positionX: null,
          positionY: null,
          speedMps: null,
        });
      } catch (err) {
        this.logger.error("Could not persist emergency failure on sim stop", {
          eventId: emergency.eventId,
          error: err,
        });
      }
      this.bus.broadcast("emergency:update", {
        eventId: emergency.eventId,
        status: "failed",
        vehicleId: emergency.vehicleId,
        positionX: null,
        positionY: null,
        speedMps: null,
      });
    }
    this.active.clear();
    void reason;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  async getEmergency(id: number): Promise<EmergencyEventDetail> {
    const event = await this.repository.getEvent(id);
    if (event === null) {
      throw new AppError(404, "unknown_emergency", `Unknown emergency event ${id}.`);
    }
    const vehicle = await this.repository.getVehicle(event.vehicle_id);
    if (vehicle === null) {
      throw new AppError(500, "emergency_corrupt", `Emergency event ${id} has no vehicle record.`);
    }
    const routeRow = event.route_id !== null ? await this.repository.getRoute(event.route_id) : null;
    const segmentRows = routeRow !== null ? await this.repository.getRouteSegments(routeRow.id) : [];
    return this.buildDetail(event, vehicle, routeRow, segmentRows);
  }

  async listEmergencies(): Promise<EmergencyEventDetail[]> {    const events = await this.repository.listEvents();
    const details: EmergencyEventDetail[] = [];
    for (const event of events) {
      const vehicle = await this.repository.getVehicle(event.vehicle_id);
      if (vehicle === null) continue;
      const routeRow = event.route_id !== null ? await this.repository.getRoute(event.route_id) : null;
      const segmentRows = routeRow !== null ? await this.repository.getRouteSegments(routeRow.id) : [];
      details.push(this.buildDetail(event, vehicle, routeRow, segmentRows));
    }
    return details;
  }

  // ------------------------------------------------------------------
  // Detail assembly
  // ------------------------------------------------------------------

  private buildDetail(
    event: EmergencyEventRow,
    vehicle: EmergencyVehicleRow,
    routeRow: RouteRow | null,
    segmentRows: RouteSegmentRow[],
  ): EmergencyEventDetail {
    const emergency = this.active.get(event.id) ?? null;
    const liveVehicle =
      emergency !== null
        ? this.manager.getVehicles().find((v) => v.id === emergency.vehicleId) ?? null
        : null;

    const isMobile =
      (event.driver_id !== null && event.driver_id !== undefined) ||
      (event.fleet_vehicle_id !== null && event.fleet_vehicle_id !== undefined) ||
      Boolean(event.driver_name) ||
      Boolean(event.patient_condition) ||
      Boolean(event.origin_address);

    const mobile: MobileEmergencyMeta | null = isMobile
      ? {
          isDriverApp: true,
          driverId: event.driver_id ?? null,
          driverName: event.driver_name ?? null,
          driverCode: event.driver_code ?? null,
          driverPhone: event.driver_phone ?? null,
          driverLicense: event.driver_license ?? null,
          vehicleCode: event.vehicle_code ?? null,
          registrationNumber: event.registration_number ?? null,
          vehicleModel: event.vehicle_model ?? null,
          vehicleType: event.vehicle_type ?? null,
          lastLatitude: event.last_latitude ?? null,
          lastLongitude: event.last_longitude ?? null,
          lastSpeedKmh: event.last_speed_kmh ?? null,
          lastHeading: event.last_heading ?? null,
          lastTelemetryAtIso: event.last_telemetry_at?.toISOString() ?? null,
          hospitalId: event.hospital_id ?? null,
          hospitalName: event.hospital_name ?? null,
          hospitalCode: event.hospital_code ?? null,
          hospitalAddress: event.hospital_address ?? null,
          hospitalPhone: event.hospital_phone ?? null,
          hospitalAvailableBeds: event.hospital_available_beds ?? null,
          hospitalTraumaLevel: event.hospital_trauma_level ?? null,
          originAddress: event.origin_address ?? null,
          destinationAddress: event.destination_address ?? null,
          pickupLatitude: event.pickup_latitude ?? null,
          pickupLongitude: event.pickup_longitude ?? null,
          patientCondition: event.patient_condition ?? null,
          severity: event.severity ?? null,
          authorizationStatus: event.authorization_status ?? "pending",
          verificationStatus: event.verification_status ?? "pending",
          isCorridorAuthorized: event.is_corridor_authorized ?? false,
          hasPatientImage: Boolean(event.has_patient_image),
          evidenceId: event.evidence_id ?? null,
          evidenceFileName: event.evidence_file_name ?? null,
          evidenceUploadedAtIso: event.evidence_uploaded_at?.toISOString() ?? null,
          requestId: event.request_id ?? null,
          aiVerdict: event.ai_verdict ?? null,
          aiConfidenceScore: event.ai_confidence_score ?? null,
          aiReason: event.ai_reason ?? null,
          aiDetectedFeatures: event.ai_detected_features ?? [],
          aiModel: event.ai_model ?? null,
          reviewerName: event.reviewer_name ?? null,
          reviewNotes: event.review_notes ?? null,
          rejectionReason: event.rejection_reason ?? null,
          reviewDecidedAtIso: event.review_decided_at?.toISOString() ?? null,
        }
      : null;

    return {
      id: event.id,
      type: vehicle.type,
      priority: event.priority,
      status: event.status,
      originJunction: event.origin_junction,
      destinationJunction: event.destination_junction,
      createdAtIso: event.created_at.toISOString(),
      activatedAtIso: event.activated_at?.toISOString() ?? null,
      arrivedAtIso: event.arrived_at?.toISOString() ?? null,
      vehicle: this.mapVehicle(vehicle, liveVehicle, event),
      route: routeRow !== null ? this.mapRoute(routeRow, segmentRows) : null,
      etas:
        emergency !== null && liveVehicle !== null && (event.status === "active" || event.status === "created")
          ? this.computeEtas(emergency, liveVehicle)
          : null,
      live: emergency !== null && liveVehicle !== null ? this.mapLive(emergency, liveVehicle) : null,
      mobile,
    };
  }

  private mapVehicle(
    vehicle: EmergencyVehicleRow,
    live: VehicleSnapshot | null,
    event?: EmergencyEventRow,
  ): EmergencyVehicleRecord {
    const lat = live?.lat ?? (event?.last_latitude ? Number(event.last_latitude) : (event?.pickup_latitude ? Number(event.pickup_latitude) : undefined));
    const lng = live?.lng ?? (event?.last_longitude ? Number(event.last_longitude) : (event?.pickup_longitude ? Number(event.pickup_longitude) : undefined));
    const liveSpeed = live?.speed ?? (event?.last_speed_kmh ? Number(event.last_speed_kmh) / 3.6 : vehicle.last_speed_mps);

    return {
      id: vehicle.id,
      vehicleId: vehicle.vehicle_id,
      type: vehicle.type,
      priority: vehicle.priority,
      status: vehicle.status,
      originJunction: vehicle.origin_junction,
      destinationJunction: vehicle.destination_junction,
      positionX: live?.positionX ?? vehicle.last_position_x,
      positionY: live?.positionY ?? vehicle.last_position_y,
      ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
      speedMps: liveSpeed,
      createdAtIso: vehicle.created_at.toISOString(),
      activatedAtIso: vehicle.activated_at?.toISOString() ?? null,
      arrivedAtIso: vehicle.arrived_at?.toISOString() ?? null,
    };
  }

  private mapRoute(route: RouteRow, segments: RouteSegmentRow[]): RouteSummary {
    return {
      id: route.id,
      algorithm: "astar",
      originJunction: route.origin_junction,
      destinationJunction: route.destination_junction,
      edgeCount: route.edge_count,
      totalLengthM: route.total_length_m,
      estimatedTravelTimeS: route.estimated_travel_time_s,
      freeFlowTravelTimeS: route.free_flow_travel_time_s,
      segments: segments.map((segment) => ({
        sequenceIndex: segment.sequence_index,
        segmentId: segment.segment_id,
        fromJunction: segment.from_junction,
        toJunction: segment.to_junction,
        lengthM: segment.length_m,
        costSeconds: segment.cost_seconds,
        congestion: null,
      })),
    };
  }

  private mapLive(emergency: ActiveEmergency, live: VehicleSnapshot): EmergencyEventDetail["live"] {
    let routeIndex = emergency.lastKnownRouteIndex;
    if (!live.roadId.startsWith(":")) {
      const idx = emergency.routeEdges.indexOf(live.roadId);
      if (idx >= 0) {
        emergency.lastKnownRouteIndex = idx;
        routeIndex = idx;
      }
    }
    return {
      simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
      positionX: live.positionX,
      positionY: live.positionY,
      ...(live.lat !== undefined && live.lng !== undefined ? { lat: live.lat, lng: live.lng } : {}),
      angle: live.angle,
      speedMps: live.speed,
      roadId: live.roadId,
      laneId: live.laneId,
      routeIndex,
      remainingDistanceM: round1(this.remainingDistance(emergency, routeIndex, live)),
    };
  }

  private remainingDistance(emergency: ActiveEmergency, routeIndex: number, live: VehicleSnapshot): number {
    const isInternal = live.roadId.startsWith(":");
    const effectiveIndex = Math.max(0, Math.min(emergency.routeEdges.length - 1, routeIndex));
    let remaining = 0;
    if (!isInternal) {
      const segmentId = emergency.routeEdges[effectiveIndex]!;
      const edge = this.routeEngine.getGraph().getEdge(segmentId);
      const positionOnEdge = edge !== null ? Math.min(live.lanePosition, edge.distanceM) : 0;
      remaining = edge !== null ? Math.max(0, edge.distanceM - positionOnEdge) : 0;
    }
    for (let index = effectiveIndex + 1; index < emergency.routeLengths.length; index++) {
      remaining += emergency.routeLengths[index]!;
    }
    return remaining;
  }

  /**
   * ETA per upcoming controlled intersection plus the destination,
   * computed from the vehicle's current position and the same
   * congestion-adjusted cost model used for routing (Architecture.md 11).
   */
  private computeEtas(emergency: ActiveEmergency, live: VehicleSnapshot): EmergencyEta[] {
    const graph = this.routeEngine.getGraph();
    let routeIndex = emergency.lastKnownRouteIndex;
    if (!live.roadId.startsWith(":")) {
      const idx = emergency.routeEdges.indexOf(live.roadId);
      if (idx >= 0) {
        emergency.lastKnownRouteIndex = idx;
        routeIndex = idx;
      }
    }

    const etas: EmergencyEta[] = [];
    let time = 0;
    let distance = 0;
    const isInternal = live.roadId.startsWith(":");

    // Partial progress on the current edge.
    if (!isInternal && routeIndex < emergency.routeEdges.length) {
      const currentSegmentId = emergency.routeEdges[routeIndex]!;
      const currentEdge = graph.getEdge(currentSegmentId);
      if (currentEdge !== null) {
        const positionOnEdge = Math.min(live.lanePosition, currentEdge.distanceM);
        const remainingM = Math.max(0, currentEdge.distanceM - positionOnEdge);
        const liveSecondsPerMeter = live.speed > 0.5 ? 1 / live.speed : null;
        const currentCost = this.routeEngine.edgeCost(currentSegmentId);
        const secondsPerMeter = liveSecondsPerMeter ?? currentCost.costSeconds / Math.max(1, currentEdge.distanceM);
        time += remainingM * secondsPerMeter;
        distance += remainingM;
        this.pushEtaIfRelevant(etas, graph, emergency, currentEdge.toJunction, time, distance);
      }
    }

    const currentSegmentId = emergency.routeEdges[routeIndex];
    const currentCost = currentSegmentId ? this.routeEngine.edgeCost(currentSegmentId) : null;
    const currentEdge = currentSegmentId ? graph.getEdge(currentSegmentId) : null;
    const liveSecondsPerMeter = live.speed > 0.5 ? 1 / live.speed : null;
    const costSpeed =
      currentCost && currentCost.costSeconds > 0 && currentEdge && currentEdge.distanceM > 0
        ? currentEdge.distanceM / currentCost.costSeconds
        : 0;
    const progressFactor =
      liveSecondsPerMeter !== null && costSpeed > 0.1
        ? Math.min(Math.max(costSpeed / live.speed, 0.5), 1.0)
        : 1.0;

    for (let index = routeIndex + 1; index < emergency.routeEdges.length; index++) {
      const segmentId = emergency.routeEdges[index]!;
      const cost = this.routeEngine.edgeCost(segmentId);
      const scaled = Math.max(cost.costSeconds * progressFactor, cost.freeFlowSeconds);
      time += scaled;
      distance += cost.lengthM;
      this.pushEtaIfRelevant(etas, graph, emergency, cost.toJunction, time, distance);
    }
    return etas;
  }

  /** ETAs from the start of the route (used when position is between edges). */
  private fullRouteEtas(emergency: ActiveEmergency): EmergencyEta[] {
    const graph = this.routeEngine.getGraph();
    const etas: EmergencyEta[] = [];
    let time = 0;
    let distance = 0;
    for (const segmentId of emergency.routeEdges) {
      const cost = this.routeEngine.edgeCost(segmentId);
      time += cost.costSeconds;
      distance += cost.lengthM;
      this.pushEtaIfRelevant(etas, graph, emergency, cost.toJunction, time, distance);
    }
    return etas;
  }

  private pushEtaIfRelevant(
    etas: EmergencyEta[],
    graph: import("../routing/road-graph.ts").RoadGraph,
    emergency: ActiveEmergency,
    junctionId: string,
    timeSeconds: number,
    distanceM: number,
  ): void {
    const isDestination = junctionId === emergency.destinationJunction;
    const controlled = this.controlledJunctions.has(junctionId) && graph.getNode(junctionId) !== null;
    if (isDestination || controlled) {
      etas.push({
        junctionId,
        etaSeconds: round1(timeSeconds),
        distanceM: round1(distanceM),
        isDestination,
      });
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
