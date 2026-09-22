import type {
  CreateEmergencyBody,
  EmergencyEta,
  EmergencyEventDetail,
  EmergencyVehicleRecord,
  RouteSummary,
  VehicleSnapshot,
} from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { AppError } from "../../errors.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { ComputedRoute, RouteEngine } from "../routing/route-engine.ts";
import { RouteError, describeRouteProblem } from "../routing/route-engine.ts";
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
      throw new AppError(
        409,
        "simulation_not_running",
        `An emergency requires a running simulation (current status: ${status.status}).`,
      );
    }

    const endpointProblem = this.routeEngine.validateEndpoints(body.origin, body.destination);
    if (endpointProblem !== null) {
      throw new AppError(422, "invalid_emergency_route", describeRouteProblem(endpointProblem));
    }

    let route: ComputedRoute;
    try {
      route = this.routeEngine.computeRoute(body.origin, body.destination);
    } catch (err) {
      if (err instanceof RouteError) {
        throw new AppError(422, "invalid_emergency_route", err.message);
      }
      throw err;
    }
    const routeProblems = this.routeEngine.validateRoute(route);
    if (routeProblems.length > 0) {
      throw new AppError(500, "route_validation_failed", describeRouteProblem(routeProblems[0]!));
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
          originJunction: body.origin,
          destinationJunction: body.destination,
          vehicleId,
          runId: this.getRunId(),
        },
        {
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
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(503, "database_error", `Could not store the emergency: ${message}`);
    }

    const sumoRouteId = `route-emv-${persisted.event.id}`;
    try {
      await this.manager.addVehicleRoute(sumoRouteId, route.segments.map((segment) => segment.segmentId));
      await this.manager.addVehicle({
        vehicleId,
        routeId: sumoRouteId,
        typeId: TYPE_IDS[body.type],
        departSpeed: "0",
      });
    } catch (err) {
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

    this.active.set(persisted.event.id, {
      eventId: persisted.event.id,
      vehicleRowId: persisted.vehicle.id,
      vehicleId,
      routeRowId: persisted.route?.id ?? null,
      status: "created",
      routeEdges: route.segments.map((segment) => segment.segmentId),
      destinationJunction: body.destination,
      routeLengths: route.segments.map((segment) => segment.lengthM),
    });

    this.bus.broadcast("emergency:created", {
      eventId: persisted.event.id,
      type: body.type,
      priority: body.priority,
      origin: body.origin,
      destination: body.destination,
    });
    this.bus.broadcast("route:updated", {
      eventId: persisted.event.id,
      routeId: sumoRouteId,
      segments: route.segments.map((segment) => segment.segmentId),
      estimatedTravelTimeS: round1(route.estimatedTravelTimeS),
    });
    this.logger.info("Emergency created", {
      eventId: persisted.event.id,
      type: body.type,
      priority: body.priority,
      routeEdges: route.segments.length,
      estimatedTravelTimeS: round1(route.estimatedTravelTimeS),
    });

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

  /** Simulation stopped/ended/disconnected: any unfinished emergency failed. */
  private async handleSimStopped(reason: "stopped" | "simulation_ended" | "disconnected"): Promise<void> {
    for (const emergency of this.active.values()) {
      if (emergency.status !== "created" && emergency.status !== "active") continue;
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
      vehicle: this.mapVehicle(vehicle, liveVehicle),
      route: routeRow !== null ? this.mapRoute(routeRow, segmentRows) : null,
      etas:
        emergency !== null && liveVehicle !== null && (event.status === "active" || event.status === "created")
          ? this.computeEtas(emergency, liveVehicle)
          : null,
      live: emergency !== null && liveVehicle !== null ? this.mapLive(emergency, liveVehicle) : null,
    };
  }

  private mapVehicle(vehicle: EmergencyVehicleRow, live: VehicleSnapshot | null): EmergencyVehicleRecord {
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
      speedMps: live?.speed ?? vehicle.last_speed_mps,
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
    const routeIndex = live.roadId.startsWith(":")
      ? -1
      : emergency.routeEdges.indexOf(live.roadId);
    return {
      simTimeSeconds: this.manager.getStatusSnapshot().simTimeSeconds,
      positionX: live.positionX,
      positionY: live.positionY,
      speedMps: live.speed,
      roadId: live.roadId,
      laneId: live.laneId,
      routeIndex,
      remainingDistanceM: round1(this.remainingDistance(emergency, routeIndex, live)),
    };
  }

  private remainingDistance(emergency: ActiveEmergency, routeIndex: number, live: VehicleSnapshot): number {
    if (routeIndex < 0) {
      // Unknown position within the route (internal edge or off-route):
      // report the full route distance as a conservative estimate.
      return emergency.routeLengths.reduce((sum, length) => sum + length, 0);
    }
    const segmentId = emergency.routeEdges[routeIndex]!;
    const edge = this.routeEngine.getGraph().getEdge(segmentId);
    const positionOnEdge = edge !== null ? Math.min(live.lanePosition, edge.distanceM) : 0;
    let remaining = edge !== null ? Math.max(0, edge.distanceM - positionOnEdge) : 0;
    for (let index = routeIndex + 1; index < emergency.routeLengths.length; index++) {
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
    const routeIndex = live.roadId.startsWith(":")
      ? -1
      : emergency.routeEdges.indexOf(live.roadId);
    if (routeIndex < 0) {
      // Position within the route unknown (crossing an intersection):
      // fall back to full-route ETAs from the origin side is misleading;
      // report ETAs starting at the first route edge instead.
      return this.fullRouteEtas(emergency);
    }

    const etas: EmergencyEta[] = [];
    let time = 0;
    let distance = 0;

    // Partial progress on the current edge.
    const currentSegmentId = emergency.routeEdges[routeIndex]!;
    const currentEdge = graph.getEdge(currentSegmentId);
    if (currentEdge === null) {
      return this.fullRouteEtas(emergency);
    }
    const positionOnEdge = Math.min(live.lanePosition, currentEdge.distanceM);
    const remainingM = Math.max(0, currentEdge.distanceM - positionOnEdge);
    const currentCost = this.routeEngine.edgeCost(currentSegmentId);
    const secondsPerMeter = currentCost.costSeconds / Math.max(1, currentEdge.distanceM);
    time += remainingM * secondsPerMeter;
    distance += remainingM;
    this.pushEtaIfRelevant(etas, graph, emergency, currentEdge.toJunction, time, distance);

    for (let index = routeIndex + 1; index < emergency.routeEdges.length; index++) {
      const segmentId = emergency.routeEdges[index]!;
      const cost = this.routeEngine.edgeCost(segmentId);
      time += cost.costSeconds;
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
