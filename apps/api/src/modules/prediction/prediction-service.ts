import type { JunctionPrediction, PredictionHorizon, PredictionSource, PredictionsResponse } from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { PredictionClient, horizonResultToType, type PredictionServiceInput, type PredictionServiceResult } from "./prediction-client.ts";
import type { TrafficService } from "../traffic/traffic-service.ts";
import type { WsBus } from "../websocket/ws-bus.ts";
import type { DatabasePool } from "../../database/db.ts";

/**
 * Prediction orchestration (Phases.md 4.8):
 *
 *   live traffic state (collector) → per controlled junction →
 *   prediction service (XGBoost) → validated predictions →
 *   cache → DB persistence → WebSocket prediction:update
 *
 * Fallback rules (Rules.md 9):
 * - ML prediction unavailable → reuse the most recent valid prediction,
 * - no valid prediction yet → deterministic fallback estimate from the
 *   measured current state and its recent trend,
 * - traffic control is never crashed by prediction failures.
 */

interface CacheEntry {
  junctionId: string;
  basedOnSimTimeSeconds: number;
  computedAtIso: string;
  source: PredictionSource;
  modelVersion: string | null;
  horizons: PredictionHorizon[];
  /** Inputs the prediction was based on (for deterministic refresh checks). */
  inputFingerprint: string;
}

/** Builds the deterministic fallback estimate (no ML). */
export function computeFallbackPrediction(input: {
  vehicleCount: number;
  countLag10s: number | null;
}): PredictionHorizon[] {
  // Trend from the measured 10 s lag, extrapolated linearly to each horizon
  // and damped with distance (farther horizons are less certain), clamped
  // at >= 0 and rounded. Fully deterministic from measured values.
  const ratePerSecond = input.countLag10s !== null ? (input.vehicleCount - input.countLag10s) / 10 : 0;
  const damp = (seconds: number) => 1 / (1 + seconds / 120);
  return [30, 60, 90, 120].map((horizonSeconds) => {
    const raw = input.vehicleCount + ratePerSecond * horizonSeconds * damp(horizonSeconds);
    return { horizonSeconds, predictedVehicleCount: Math.max(0, Math.round(raw)) };
  });
}

export class PredictionService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly trafficService: TrafficService;
  private readonly db: DatabasePool | null;
  private readonly bus: WsBus;
  private readonly client: PredictionClient | null;

  private cache = new Map<string, CacheEntry>();
  private lastPredictAtMs = 0;
  private modelVersion: string | null = null;
  private serviceHealthy = false;
  private lastErrorByJunction = new Map<string, { reason: string; message: string }>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  /** History of counts per junction for lag features (junction → [(simTime, count)]). */
  private countHistory = new Map<string, Array<[number, number]>>();
  private queueHistory = new Map<string, Array<[number, number]>>();

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    trafficService: TrafficService;
    db: DatabasePool | null;
    bus: WsBus;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.trafficService = options.trafficService;
    this.db = options.db;
    this.bus = options.bus;
    this.client = options.config.predictionServiceUrl
      ? new PredictionClient({
          baseUrl: options.config.predictionServiceUrl,
          timeoutMs: options.config.predictionTimeoutMs,
        })
      : null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), Math.max(250, this.config.predictionIntervalMs));
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.refreshPredictions();
    } catch (err) {
      // Prediction problems must never break traffic control (Rules.md 9).
      this.logger.warn("Prediction tick failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.inFlight = false;
    }
  }

  /** Runs one prediction refresh for all controlled junctions. */
  async refreshPredictions(): Promise<void> {
    if (this.client === null) return; // predictions disabled by configuration

    const state = this.trafficService.getLiveTrafficState();
    if (state === null) return;
    this.recordHistory(state);

    // Health check first: when the service is down, apply fallbacks and stop.
    const health = await this.client.health();
    this.serviceHealthy = health.ok;
    if (!health.ok) {
      this.applyFallbackForAll(state, "unavailable", "Prediction service is not reachable.");
      return;
    }

    const now = Date.now();
    if (now - this.lastPredictAtMs < this.config.predictionIntervalMs) {
      return;
    }
    this.lastPredictAtMs = now;

    let anyNew = false;
    for (const junction of state.junctions) {
      if (!junction.controlled || junction.signal === undefined) continue;
      const input = this.buildInput(junction, state);
      const fingerprint = this.fingerprintOf(input);
      const cached = this.cache.get(junction.junctionId);
      if (cached !== undefined && cached.inputFingerprint === fingerprint && !this.isStale(cached, state.simTimeSeconds)) {
        continue;
      }

      const result: PredictionServiceResult = await this.client.predict(input);
      if (result.ok) {
        this.cache.set(junction.junctionId, {
          junctionId: junction.junctionId,
          basedOnSimTimeSeconds: state.simTimeSeconds,
          computedAtIso: new Date().toISOString(),
          source: "ml",
          modelVersion: result.modelVersion,
          horizons: horizonResultToType(result.predictions),
          inputFingerprint: fingerprint,
        });
        this.modelVersion = result.modelVersion;
        this.lastErrorByJunction.delete(junction.junctionId);
        anyNew = true;
        void this.persistPredictions(junction.junctionId, state.simTimeSeconds, "ml", result.modelVersion, horizonResultToType(result.predictions));
      } else {
        const message =
          result.reason === "invalid_input" || result.reason === "invalid_response"
            ? result.message
            : REASON_TEXT[result.reason] ?? "Prediction failed.";
        this.lastErrorByJunction.set(junction.junctionId, { reason: result.reason, message });
        this.applyFallbackForJunction(junction.junctionId, state, result.reason, message);
        anyNew = true;
      }
    }
    if (anyNew) {
      this.bus.broadcast("prediction:update", {
        simTimeSeconds: state.simTimeSeconds,
        predictions: this.getPredictions(),
      });
    }
  }

  /** Applies fallback for one junction (most recent valid, else deterministic). */
  private applyFallbackForJunction(
    junctionId: string,
    state: NonNullable<ReturnType<TrafficService["getLiveTrafficState"]>>,
    reason: string,
    message: string,
  ): void {
    const existing = this.cache.get(junctionId);
    if (existing !== undefined && existing.source === "ml" && !this.isStale(existing, state.simTimeSeconds)) {
      // Rule 9: reuse the most recent valid prediction; keep it, mark error info.
      return;
    }
    const lag = this.lagFor(junctionId, state.simTimeSeconds, 10);
    const fallback = computeFallbackPrediction({
      vehicleCount: this.currentCountFor(junctionId, state),
      countLag10s: lag,
    });
    this.cache.set(junctionId, {
      junctionId,
      basedOnSimTimeSeconds: state.simTimeSeconds,
      computedAtIso: new Date().toISOString(),
      source: "fallback",
      modelVersion: null,
      horizons: fallback,
      inputFingerprint: "",
    });
    void this.persistPredictions(junctionId, state.simTimeSeconds, "fallback", null, fallback);
  }

  private applyFallbackForAll(
    state: NonNullable<ReturnType<TrafficService["getLiveTrafficState"]>>,
    reason: string,
    message: string,
  ): void {
    let anyFallback = false;
    for (const junction of state.junctions) {
      if (!junction.controlled) continue;
      const before = this.cache.get(junction.junctionId);
      this.applyFallbackForJunction(junction.junctionId, state, reason, message);
      const after = this.cache.get(junction.junctionId);
      if (after !== undefined && (before === undefined || before !== after)) {
        anyFallback = true;
      }
    }
    if (anyFallback) {
      this.bus.broadcast("prediction:update", {
        simTimeSeconds: state.simTimeSeconds,
        predictions: this.getPredictions(),
      });
    }
  }

  // ------------------------------------------------------------------
  // Inputs from live traffic state
  // ------------------------------------------------------------------

  private buildInput(
    junction: { junctionId: string; queueLength: number; signal?: { state: string; phaseIndex: number } },
    state: NonNullable<ReturnType<TrafficService["getLiveTrafficState"]>>,
  ): PredictionServiceInput {
    // Aggregate the junction's approach segments (segments ending here).
    let count = 0;
    let speedSum = 0;
    let speedWeight = 0;
    let densitySum = 0;
    let densityN = 0;
    let flowSum = 0;
    for (const segment of state.segments) {
      if (this.trafficService.toJunctionOf(segment.segmentId) !== junction.junctionId) continue;
      count += segment.vehicleCount;
      flowSum += segment.flowRatePerHour;
      densitySum += segment.occupancy;
      densityN += 1;
      if (segment.vehicleCount > 0) {
        speedSum += segment.avgSpeedMps * segment.vehicleCount;
        speedWeight += segment.vehicleCount;
      }
    }
    const lag10 = this.lagFor(junction.junctionId, state.simTimeSeconds, 10);
    const lag30 = this.lagFor(junction.junctionId, state.simTimeSeconds, 30);
    const queueLag10 = this.lagFrom(this.queueHistory.get(junction.junctionId) ?? [], state.simTimeSeconds, 10);
    return {
      intersectionId: junction.junctionId,
      vehicleCount: count,
      speedMps: speedWeight > 0 ? speedSum / speedWeight : 0,
      queueLength: junction.queueLength,
      density: densityN > 0 ? densitySum / densityN : 0,
      flowRatePerHour: flowSum,
      signalPhase: junction.signal?.phaseIndex ?? 0,
      signalState: junction.signal?.state ?? "",
      cyclePositionSeconds: state.simTimeSeconds % 90,
      hour: this.config.simStartHour + Math.floor(state.simTimeSeconds / 3600) % 24,
      dayOfWeek: this.config.simStartDayOfWeek,
      countLag10s: lag10,
      countLag30s: lag30,
      queueLag10s: queueLag10,
    };
  }

  private currentCountFor(
    junctionId: string,
    state: NonNullable<ReturnType<TrafficService["getLiveTrafficState"]>>,
  ): number {
    let sum = 0;
    for (const segment of state.segments) {
      if (this.trafficService.toJunctionOf(segment.segmentId) === junctionId) {
        sum += segment.vehicleCount;
      }
    }
    return sum;
  }

  /** Measured count at (simTime - lag) from the collector history. */
  private lagFor(junctionId: string, simTimeSeconds: number, lagSeconds: number): number | null {
    return this.lagFrom(this.countHistory.get(junctionId) ?? [], simTimeSeconds, lagSeconds);
  }

  private lagFrom(history: Array<[number, number]>, simTimeSeconds: number, lagSeconds: number): number | null {
    let value: number | null = null;
    for (const [time, count] of history) {
      if (time <= simTimeSeconds - lagSeconds + 1e-9) {
        value = count;
      } else {
        break;
      }
    }
    return value;
  }

  private recordHistory(state: NonNullable<ReturnType<TrafficService["getLiveTrafficState"]>>): void {
    for (const junction of state.junctions) {
      if (!junction.controlled) continue;
      const count = this.currentCountFor(junction.junctionId, state);
      const history = this.countHistory.get(junction.junctionId) ?? [];
      history.push([state.simTimeSeconds, count]);
      this.countHistory.set(junction.junctionId, history);
      const queueHistory = this.queueHistory.get(junction.junctionId) ?? [];
      queueHistory.push([state.simTimeSeconds, junction.queueLength]);
      this.queueHistory.set(junction.junctionId, queueHistory);
    }
    // Keep ~2 minutes of history.
    const cutoff = state.simTimeSeconds - 130;
    for (const map of [this.countHistory, this.queueHistory]) {
      for (const [junctionId, history] of map) {
        while (history.length > 0 && history[0]![0] < cutoff) history.shift();
        if (history.length === 0) map.delete(junctionId);
      }
    }
  }

  private fingerprintOf(input: PredictionServiceInput): string {
    return JSON.stringify([
      input.intersectionId,
      input.vehicleCount,
      input.speedMps,
      input.queueLength,
      input.density,
      input.flowRatePerHour,
      input.signalPhase,
      input.signalState,
      input.cyclePositionSeconds,
      input.hour,
      input.countLag10s,
      input.countLag30s,
      input.queueLag10s,
    ]);
  }

  private isStale(entry: CacheEntry, currentSimTime: number): boolean {
    return currentSimTime - entry.basedOnSimTimeSeconds > this.config.predictionStaleAfterSeconds;
  }

  // ------------------------------------------------------------------
  // Public query surface
  // ------------------------------------------------------------------

  /** GET /api/predictions response assembly. */
  getResponse(): PredictionsResponse {
    const status = this.trafficService.managerStatus();
    return {
      simTimeSeconds: status.simTimeSeconds,
      predictionsEnabled: this.client !== null,
      serviceUrl: this.config.predictionServiceUrl,
      serviceHealthy: this.serviceHealthy,
      staleAfterSeconds: this.config.predictionStaleAfterSeconds,
      modelVersion: this.modelVersion,
      predictions: this.getPredictions(),
      system: {
        simulationStatus: status.status,
        dbConnected: this.db?.isHealthy() ?? false,
      },
    };
  }

  /** Latest predictions (for the API and WebSocket). */
  getPredictions(): JunctionPrediction[] {    const state = this.trafficService.getLiveTrafficState();
    const simTime = state?.simTimeSeconds ?? 0;
    const junctions = this.trafficService.getControlledJunctionIds();
    const staleAfter = this.config.predictionStaleAfterSeconds;
    return junctions.map((junctionId) => {
      const entry = this.cache.get(junctionId);
      if (entry === undefined) {
        return {
          junctionId,
          basedOnSimTimeSeconds: null,
          computedAtIso: null,
          source: (this.client === null ? "unavailable" : "unavailable") as PredictionSource,
          modelVersion: null,
          horizons: emptyHorizons(),
          stale: true,
          lastError: this.lastErrorByJunction.get(junctionId) ?? null,
        };
      }
      const stale = this.isStale(entry, simTime) || Date.parse(entry.computedAtIso) < Date.now() - staleAfter * 1000 * 10;
      return {
        junctionId,
        basedOnSimTimeSeconds: entry.basedOnSimTimeSeconds,
        computedAtIso: entry.computedAtIso,
        source: entry.source,
        modelVersion: entry.modelVersion,
        horizons: entry.horizons,
        stale,
        lastError: this.lastErrorByJunction.get(junctionId) ?? null,
      };
    });
  }

  /** Called by the traffic service after each collection tick. */
  onTrafficStateUpdate(): void {
    const state = this.trafficService.getLiveTrafficState();
    if (state !== null) {
      this.recordHistory(state);
    }
  }

  async dispose(): Promise<void> {
    this.stop();
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Exposed for the system overview (non-secret). */
  getServiceHealthy(): boolean {
    return this.serviceHealthy;
  }

  getModelVersion(): string | null {
    return this.modelVersion;
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  private async persistPredictions(
    junctionId: string,
    simTimeSeconds: number,
    source: "ml" | "fallback",
    modelVersion: string | null,
    horizons: PredictionHorizon[],
  ): Promise<void> {
    if (this.db === null) return;
    const runId = this.trafficService.getCurrentRunId();
    if (runId === null) return;
    try {
      const values: unknown[] = [];
      const placeholders = horizons.map((horizon, index) => {
        const adjusted = index * 7;
        values.push(runId, junctionId, simTimeSeconds, horizon.horizonSeconds, horizon.predictedVehicleCount, source, modelVersion);
        return `($${adjusted + 1}, $${adjusted + 2}, $${adjusted + 3}, $${adjusted + 4}, $${adjusted + 5}, $${adjusted + 6}, $${adjusted + 7})`;
      });
      await this.db.query(
        `INSERT INTO traffic_predictions
           (run_id, junction_id, sim_time_s, horizon_s, predicted_vehicle_count, source, model_version)
         VALUES ${placeholders.join(", ")}`,
        values,
      );
    } catch (err) {
      // Persistence problems are logged and exposed but never fatal.
      this.logger.warn("Could not persist predictions", {
        junction: junctionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const REASON_TEXT: Record<string, string> = {
  unavailable: "Prediction service is not reachable.",
  timeout: "Prediction service timed out.",
  no_model: "Prediction service has no trained model.",
  invalid_input: "Prediction service rejected the input.",
  invalid_response: "Prediction service returned an invalid response.",
};

function emptyHorizons(): PredictionHorizon[] {
  return [30, 60, 90, 120].map((horizonSeconds) => ({ horizonSeconds, predictedVehicleCount: 0 }));
}
