import type {
  IntersectionInfo,
  IntersectionTraffic,
  RoadInfo,
  SegmentTraffic,
  SimulationScenarioId,
  SimulationStatusSnapshot,
  TrafficStateResponse,
  CityTrafficSummary,
  SignalSnapshot,
  VehicleSnapshot,
} from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { WsBus } from "../websocket/ws-bus.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import { TrafficCollector, type TrafficState } from "./collector.ts";
import type { DatabasePool } from "../../database/db.ts";
import { NetworkRepository, type IntersectionRow } from "../../database/repositories/network-repository.ts";
import { RunRepository } from "../../database/repositories/run-repository.ts";
import { TrafficRepository } from "../../database/repositories/traffic-repository.ts";
import { LEVEL_ORDER, type CongestionLevel, type SegmentMetrics } from "./metrics.ts";
import type { RoadGraph } from "../routing/road-graph.ts";

/**
 * Traffic intelligence orchestration (Phases.md 2.x):
 *
 *   SUMO step → collector → in-memory latest state
 *                                  ├→ PostgreSQL (throttled persistence)
 *                                  └→ WebSocket events (paced broadcast)
 *
 * The service never fabricates values: everything comes from the collector
 * (TraCI reads) or the static network catalog. Database failures are
 * captured and exposed without breaking the live collection pipeline.
 */
export class TrafficService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly db: DatabasePool;
  private readonly collector: TrafficCollector;
  private readonly networkRepo: NetworkRepository;
  private readonly runRepo: RunRepository;
  private readonly trafficRepo: TrafficRepository;
  private readonly bus: WsBus;
  private readonly catalog: NetworkCatalog;
  private readonly roadGraph: RoadGraph;

  private segmentInfo: Array<{ id: string; roadId: string; from: string; to: string }>;
  private currentRunId: number | null = null;
  private latest: TrafficState | null = null;
  private tickCount = 0;
  private revision = 0;
  private broadcastRevision = 0;
  private lastPersistError: string | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private eventListeners: Array<() => void> = [];

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    db: DatabasePool;
    collector: TrafficCollector;
    catalog: NetworkCatalog;
    bus: WsBus;
    /** Live road graph whose edge weights are refreshed per step (routing). */
    roadGraph: RoadGraph;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.db = options.db;
    this.collector = options.collector;
    this.catalog = options.catalog;
    this.bus = options.bus;
    this.roadGraph = options.roadGraph;
    this.networkRepo = new NetworkRepository(options.db);
    this.runRepo = new RunRepository(options.db);
    this.trafficRepo = new TrafficRepository();

    this.segmentInfo = options.catalog.segments.map((segment) => ({
      id: segment.id,
      roadId: roadIdOf(options.catalog, segment.id),
      from: segment.fromJunction,
      to: segment.toJunction,
    }));

    this.eventListeners.push(
      options.manager.onStarted((event) => this.handleSimStarted(event.scenario, event.sumoVersion)),
      // In-lockstep collection: the manager awaits this promise, so the
      // in-memory state is exactly at the step just simulated.
      options.manager.onStep((event) => this.collectAtStep(event.simTimeSeconds)),
      options.manager.onStopped((event) => this.handleSimStopped(event.reason)),
    );
  }

  /** Starts the paced WebSocket broadcast timer. */
  startBroadcastLoop(): void {
    if (this.broadcastTimer !== null) return;
    this.broadcastTimer = setInterval(() => this.broadcastIfNew(), this.config.trafficEventIntervalMs);
  }

  /** Current simulation run id, or null when no run is active. */
  getCurrentRunId(): number | null {
    return this.currentRunId;
  }

  stopBroadcastLoop(): void {
    if (this.broadcastTimer !== null) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  async dispose(): Promise<void> {
    this.stopBroadcastLoop();
    for (const off of this.eventListeners) off();
    this.eventListeners = [];
    await this.persistChain.catch(() => undefined);
  }

  // ------------------------------------------------------------------
  // Simulation lifecycle handlers
  // ------------------------------------------------------------------

  private async handleSimStarted(scenario: SimulationScenarioId, sumoVersion: string | null): Promise<void> {
    this.logger.info("Traffic collection starting for new simulation run", { scenario });
    try {
      await this.networkRepo.syncCatalog(this.catalog);
      this.currentRunId = await this.runRepo.createRun({
        scenario,
        sumoVersion,
        stepLengthSeconds: this.config.sumoStepLengthSeconds,
      });
      this.collector.reset();
      this.tickCount = 0;
      this.revision = 0;
      this.broadcastRevision = 0;
      this.lastPersistError = null;
      this.logger.info("Simulation run registered", { runId: this.currentRunId, scenario });
    } catch (err) {
      this.captureDbError(err, "registering simulation run");
    }
  }

  /**
   * Collects traffic for the step that just completed. Runs inside the
   * simulation step (the manager awaits it); a failure is logged and does
   * not break the step loop.
   */
  private async collectAtStep(simTimeSeconds: number): Promise<void> {
    const client = this.manager.getTraCIClient();
    if (client === null || this.currentRunId === null) {
      return;
    }
    try {
      const state = await this.collector.collect({
        client,
        simTimeSeconds,
        intervalSeconds: this.config.sumoStepLengthSeconds,
        vehicles: this.manager.getVehicles(),
        signals: this.manager.getSignals(),
      });
      this.latest = state;
      this.tickCount += 1;
      this.revision += 1;
      // Refresh routing weights with the freshest measured traffic. The
      // collector's SegmentMetrics carry the same per-segment measurements
      // the API surfaces use; map them onto the graph edge fields.
      this.roadGraph.applyTrafficState(
        state.segments.map((segment) => ({
          segmentId: segment.segmentId,
          roadId: "",
          fromJunction: "",
          toJunction: "",
          vehicleCount: segment.vehicleCount,
          avgSpeedMps: segment.avgSpeedMps,
          queueLength: segment.queueLength,
          occupancy: segment.occupancy,
          vehiclesPerKm: segment.vehiclesPerKm,
          flowRatePerHour: segment.flowRatePerHour,
          congestion: segment.congestion,
        })),
      );
      if (this.tickCount % this.config.trafficPersistEveryTicks === 0) {
        this.enqueuePersist(state);
      }
    } catch (err) {
      // Collection failure must not break the simulation loop.
      this.logger.error("Traffic collection failed", {
        simTime: simTimeSeconds,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSimStopped(reason: "stopped" | "simulation_ended" | "disconnected"): Promise<void> {
    const runId = this.currentRunId;
    this.currentRunId = null;
    if (runId !== null) {
      const failed = reason === "disconnected";
      try {
        await this.runRepo.completeRun(runId, failed);
        this.logger.info("Simulation run finalized", { runId, reason });
      } catch (err) {
        this.captureDbError(err, "finalizing simulation run");
      }
    }
    if (reason === "disconnected") {
      this.bus.broadcast("system:alert", {
        severity: "critical",
        code: "simulation_disconnected",
        message: "Lost connection to the SUMO simulation. Signal commands are suspended.",
      });
    }
  }

  // ------------------------------------------------------------------
  // Persistence (throttled, serialized)
  // ------------------------------------------------------------------

  private enqueuePersist(state: TrafficState): void {
    const runId = this.currentRunId;
    if (runId === null) return;
    // Junction congestion (worst arriving-segment level) is part of the
    // persisted signal snapshot.
    const worstByJunction = this.worstLevelByJunction(state.segments);
    this.persistChain = this.persistChain.then(async () => {
      try {
        await this.db.transaction(async (tx) => {
          const segmentRows = state.segments.map((segment) => ({
            runId,
            simTimeSeconds: state.simTimeSeconds,
            segment,
          }));
          const signalRows = state.junctions
            .filter((junction) => junction.controlled)
            .map((junction) => ({
              runId,
              simTimeSeconds: state.simTimeSeconds,
              junction,
              congestion: worstByJunction.get(junction.junctionId) ?? ("LOW" as const),
            }));
          await this.trafficRepo.insertSegmentSnapshots(tx, segmentRows);
          await this.trafficRepo.insertSignalSnapshots(tx, signalRows);
          await this.trafficRepo.upsertVehicles(tx, runId, state.vehicles);
        });
        this.lastPersistError = null;
      } catch (err) {
        this.captureDbError(err, "persisting traffic snapshot");
      }
    });
  }

  private captureDbError(err: unknown, what: string): void {
    const message = err instanceof Error ? err.message : String(err);
    this.lastPersistError = `${what}: ${message}`;
    this.logger.error("Database operation failed", { what, error: message });
    this.bus.broadcast("system:alert", {
      severity: "warning",
      code: "database_unavailable",
      message: `Database problem while ${what}. Live collection continues; persistence is impaired.`,
    });
  }

  // ------------------------------------------------------------------
  // WebSocket broadcast
  // ------------------------------------------------------------------

  private broadcastIfNew(): void {
    const state = this.latest;
    if (state === null || this.revision === this.broadcastRevision) {
      return;
    }
    this.broadcastRevision = this.revision;
    const signals: SignalSnapshot[] = this.manager.getSignals();
    const vehicles: VehicleSnapshot[] = state.vehicles;
    const traffic = this.buildTrafficResponse(state, this.manager.getStatusSnapshot());
    this.bus.broadcast("vehicle:update", { simTimeSeconds: state.simTimeSeconds, vehicles });
    this.bus.broadcast("signal:update", { simTimeSeconds: state.simTimeSeconds, signals });
    this.bus.broadcast("traffic:update", {
      simTimeSeconds: traffic.simTimeSeconds,
      collectedAtIso: traffic.collectedAtIso,
      stale: traffic.stale,
      summary: traffic.summary,
      segments: traffic.segments,
      intersections: traffic.intersections,
    });
  }

  // ------------------------------------------------------------------
  // Query surfaces (API)
  // ------------------------------------------------------------------

  getTrafficSnapshot(): TrafficStateResponse {
    const status = this.manager.getStatusSnapshot();
    if (this.latest === null) {
      // No live data yet: report the static empty city honestly.
      const emptySegments: SegmentTraffic[] = this.segmentInfo.map((info) => ({
        segmentId: info.id,
        roadId: info.roadId,
        fromJunction: info.from,
        toJunction: info.to,
        vehicleCount: 0,
        avgSpeedMps: 0,
        queueLength: 0,
        occupancy: 0,
        vehiclesPerKm: 0,
        flowRatePerHour: 0,
        congestion: "LOW" as const,
      }));
      const summary: CityTrafficSummary = {
        vehicleCount: 0,
        avgSpeedMps: 0,
        totalQueueLength: 0,
        congestedSegments: 0,
        criticalSegments: 0,
        cityLevel: "LOW" as const,
      };
      return {
        simTimeSeconds: 0,
        collectedAtIso: null,
        ageSeconds: null,
        stale: true,
        summary,
        segments: emptySegments,
        intersections: this.catalog.junctions.map((junction) => ({
          junctionId: junction.id,
          controlled: this.catalog.signals.some((s) => s.id === junction.id),
          queueLength: 0,
          signal: null,
        })),
        system: this.systemInfo(status),
      };
    }
    return this.buildTrafficResponse(this.latest, status);
  }

  private buildTrafficResponse(state: TrafficState, status: SimulationStatusSnapshot): TrafficStateResponse {
    const collectedAtMs = Date.parse(state.collectedAtIso);
    const ageSeconds = Number.isFinite(collectedAtMs)
      ? Math.max(0, Math.round(((Date.now() - collectedAtMs) / 1000) * 10) / 10)
      : null;
    const stale = ageSeconds === null || ageSeconds > this.config.trafficStaleAfterSeconds;

    const segments: SegmentTraffic[] = state.segments.map((segment) => {
      const info = this.segmentInfo.find((s) => s.id === segment.segmentId);
      return {
        segmentId: segment.segmentId,
        roadId: info?.roadId ?? "",
        fromJunction: info?.from ?? "",
        toJunction: info?.to ?? "",
        vehicleCount: segment.vehicleCount,
        avgSpeedMps: segment.avgSpeedMps,
        queueLength: segment.queueLength,
        occupancy: segment.occupancy,
        vehiclesPerKm: segment.vehiclesPerKm,
        flowRatePerHour: segment.flowRatePerHour,
        congestion: segment.congestion,
      };
    });

    const intersections: IntersectionTraffic[] = state.junctions.map((junction) => ({
      junctionId: junction.junctionId,
      controlled: junction.controlled,
      queueLength: junction.queueLength,
      signal:
        junction.signal !== undefined
          ? {
              id: junction.signal.id,
              program: junction.signal.program,
              state: junction.signal.state,
              phaseIndex: junction.signal.phaseIndex,
              phaseDurationSeconds: junction.signal.phaseDurationSeconds,
              nextSwitchAtSeconds: junction.signal.nextSwitchAtSeconds,
            }
          : null,
    }));

    return {
      simTimeSeconds: state.simTimeSeconds,
      collectedAtIso: state.collectedAtIso,
      ageSeconds,
      stale,
      summary: state.summary,
      segments,
      intersections,
      system: this.systemInfo(status),
    };
  }

  /** Worst congestion level among segments arriving at each junction. */
  private worstLevelByJunction(segments: SegmentMetrics[]): Map<string, CongestionLevel> {
    const bySegment = new Map(this.segmentInfo.map((info) => [info.id, info.to] as const));
    const worst = new Map<string, CongestionLevel>();
    for (const segment of segments) {
      if (segment.vehicleCount === 0) continue;
      const junctionId = bySegment.get(segment.segmentId);
      if (junctionId === undefined) continue;
      const current = worst.get(junctionId);
      if (current === undefined || LEVEL_ORDER[segment.congestion] > LEVEL_ORDER[current]) {
        worst.set(junctionId, segment.congestion);
      }
    }
    return worst;
  }

  private systemInfo(status: SimulationStatusSnapshot): TrafficStateResponse["system"] {
    return {
      simulationStatus: status.status,
      simulationError: status.lastError,
      dbConnected: this.db.isHealthy(),
      lastDbError: this.db.lastError(),
      lastPersistError: this.lastPersistError,
    };
  }

  async getRoads(): Promise<RoadInfo[]> {
    const roads = await this.networkRepo.getRoads();
    return roads.map((road) => ({
      id: road.id,
      name: road.name,
      fromJunction: road.from_junction,
      toJunction: road.to_junction,
      segments: road.segments.map((segment) => ({
        id: segment.id,
        laneCount: segment.lane_count,
        lengthM: segment.length_m,
        maxSpeedMps: segment.max_speed_mps,
      })),
    }));
  }

  async getIntersections(): Promise<IntersectionInfo[]> {
    const rows = await this.networkRepo.getIntersections();
    const latest = this.latest;
    const queueByJunction = new Map<string, number>();
    const worstByJunction =
      latest !== null ? this.worstLevelByJunction(latest.segments) : new Map<string, CongestionLevel>();
    if (latest !== null) {
      for (const junction of latest.junctions) {
        queueByJunction.set(junction.junctionId, junction.queueLength);
      }
    }
    return rows.map((row: IntersectionRow) => {
      const congestion = worstByJunction.get(row.id) ?? null;
      return {
        id: row.id,
        kind: row.kind,
        controlled: row.controlled,
        x: row.x,
        y: row.y,
        signalId: row.signal_id,
        traffic:
          row.controlled && queueByJunction.has(row.id)
            ? { queueLength: queueByJunction.get(row.id) ?? 0, congestion }
            : null,
      };
    });
  }
}

function roadIdOf(catalog: NetworkCatalog, segmentId: string): string {
  const road = catalog.roads.find((r) => r.segmentIds.includes(segmentId));
  return road?.id ?? "";
}
