import type { SimulationMetrics } from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { TrafficService } from "../traffic/traffic-service.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";
import { TRACI } from "../simulation/traci/constants.ts";
import type { SimulationScenarioId } from "@itms/types";

/**
 * Automatic metrics collection (Phases.md 6.6-6.8).
 *
 * Samples the live simulation at a fixed sim-time interval and, when the
 * run ends, records measured aggregates into simulation_metrics:
 *  - emergency travel time (activation → arrival in sim seconds),
 *  - emergency time loss (last sample before arrival),
 *  - average vehicle delay (mean SUMO timeLoss per sample),
 *  - average queue length / average speed (city summary per sample),
 *  - throughput (arrived vehicles per sim hour),
 *  - signal change count (manager counter).
 *
 * All values are measured from the simulation; nothing is fabricated.
 */
export class MetricsRecorder {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly emergencyService: EmergencyService;
  private readonly trafficService: TrafficService;
  private readonly repository: MetricsRepository;

  private currentRunId: number | null = null;
  private runStartedAtIso: string | null = null;
  private lastSampleSimTime = -Infinity;
  private sampleCount = 0;
  private queueSum = 0;
  private speedSum = 0;
  private delaySum = 0;
  private emergencyTimeLoss = new Map<string, number>();
  private seenEventIds = new Set<number>();
  private eventListeners: Array<() => void> = [];

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    emergencyService: EmergencyService;
    trafficService: TrafficService;
    repository: MetricsRepository;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.emergencyService = options.emergencyService;
    this.trafficService = options.trafficService;
    this.repository = options.repository;

    this.eventListeners.push(
      options.manager.onStarted(() => {
        // Traffic service's onStarted listener is registered first, so the
        // run id exists here.
        this.currentRunId = options.trafficService.getCurrentRunId();
        this.runStartedAtIso = new Date().toISOString();
        this.lastSampleSimTime = -Infinity;
        this.sampleCount = 0;
        this.queueSum = 0;
        this.speedSum = 0;
        this.delaySum = 0;
        this.emergencyTimeLoss.clear();
        this.seenEventIds.clear();
        this.lastScenario = null;
        this.lastArrivedCount = null;
        this.signalChangeCountForRun = 0;
      }),
      options.manager.onStep((event) => this.onStep(event.simTimeSeconds)),
      // Registered after the traffic service's own stop listener; the run id
      // is kept locally from onStarted, so finalization is unaffected.
      options.manager.onStopped(() => void this.finalizeRun()),
    );
  }

  async dispose(): Promise<void> {
    for (const off of this.eventListeners) off();
    this.eventListeners = [];
  }

  private async onStep(simTimeSeconds: number): Promise<void> {
    // Capture end-of-run values every step (cheap, no TraCI calls).
    const status = this.manager.getStatusSnapshot();
    this.lastScenario = status.scenario;
    this.lastArrivedCount = status.arrivedVehicleCount;
    this.signalChangeCountForRun = this.manager.getSignalChangeCount();

    // Track emergencies (travel time source) — in-memory only, no DB churn.
    for (const eventId of this.emergencyService.getActiveEventIds()) {
      this.seenEventIds.add(eventId);
    }

    if (simTimeSeconds - this.lastSampleSimTime < this.config.metricsSampleIntervalS) {
      return;
    }
    this.lastSampleSimTime = simTimeSeconds;

    const state = this.trafficService.getLiveTrafficState();
    if (state === null) return;
    this.sampleCount += 1;
    this.queueSum += state.summary.totalQueueLength;
    this.speedSum += state.summary.avgSpeedMps;

    // Per-vehicle time loss (delay) — batched read every sample.
    const client = this.manager.getTraCIClient();
    if (client !== null && state.vehicles.length > 0) {
      try {
        const values = await client.getValues(
          state.vehicles.map((vehicle) => ({
            getCmdId: TRACI.CMD_GET_VEHICLE_VARIABLE,
            varId: TRACI.VAR_TIMELOSS,
            objId: vehicle.id,
          })),
        );
        let sum = 0;
        let counted = 0;
        state.vehicles.forEach((vehicle, index) => {
          const value = values[index];
          if (typeof value === "number" && Number.isFinite(value)) {
            sum += value;
            counted += 1;
            this.emergencyTimeLoss.set(vehicle.id, value);
          }
        });
        if (counted > 0) {
          this.delaySum += sum / counted;
        }
      } catch (err) {
        this.logger.warn("Time loss sampling failed", { simTime: simTimeSeconds, error: err });
      }
    }
  }

  /** Persists the measured metrics of the run that just ended. */
  private async finalizeRun(): Promise<void> {
    const runId = this.currentRunId;
    this.currentRunId = null;
    if (runId === null) return;

    const simDuration = this.manager.getStatusSnapshot().simTimeSeconds;
    const signalChangeCount = this.signalChangeCountForRun;
    const completedAtIso = new Date().toISOString();

    // Emergency travel time: activation → arrival sim time of the events
    // seen during this run (query the persisted bookkeeping).
    let emergencyTravelTimeS: number | null = null;
    let emergencyTimeLossS: number | null = null;
    for (const eventId of this.seenEventIds) {
      const times = this.emergencyService.getTransitionSimTimes(eventId);
      if (times === null) continue;
      const { activatedSimTimeS, arrivedSimTimeS } = times;
      if (activatedSimTimeS !== null && arrivedSimTimeS !== null) {
        emergencyTravelTimeS = round2(arrivedSimTimeS - activatedSimTimeS);
        break; // comparison runs use a single emergency
      }
    }
    // The emergency vehicle's last recorded time loss: find via runtime or
    // the last sample (vehicle id unknown post-arrival; the emergency
    // service runtime exposes the vehicleId while present).
    for (const [vehicleId, timeLoss] of this.emergencyTimeLoss) {
      if (vehicleId.startsWith("emv-")) {
        emergencyTimeLossS = round2(timeLoss);
      }
    }

    const metrics: SimulationMetrics = {
      runId,
      scenario: this.lastScenario ?? "baseline",
      mode: this.runMode,
      emergencyTravelTimeS,
      emergencyTimeLossS,
      avgVehicleDelayS: this.sampleCount > 0 ? round2(this.delaySum / this.sampleCount) : null,
      avgQueueLength: this.sampleCount > 0 ? round2(this.queueSum / this.sampleCount) : null,
      avgSpeedMps: this.sampleCount > 0 ? round2(this.speedSum / this.sampleCount) : null,
      throughputPerHour:
        simDuration > 0 && this.lastArrivedCount !== null
          ? round2((this.lastArrivedCount / (simDuration / 3600)))
          : null,
      signalChangeCount,
      simDurationS: round2(simDuration),
      sampleCount: this.sampleCount,
      startedAtIso: this.runStartedAtIso,
      completedAtIso,
    };

    try {
      await this.repository.upsertRunMetrics(metrics);
      this.logger.info("Run metrics recorded", {
        runId,
        mode: metrics.mode,
        emergencyTravelTimeS: metrics.emergencyTravelTimeS,
        avgVehicleDelayS: metrics.avgVehicleDelayS,
        avgQueueLength: metrics.avgQueueLength,
        avgSpeedMps: metrics.avgSpeedMps,
        throughputPerHour: metrics.throughputPerHour,
        signalChanges: metrics.signalChangeCount,
      });
    } catch (err) {
      this.logger.error("Could not persist run metrics", { runId, error: err });
    }
  }

  /** Scenario/mode/arrived-count capture for finalization. */
  private lastScenario: SimulationScenarioId | null = null;
  private runMode: SimulationMetrics["mode"] = "unspecified";
  private lastArrivedCount: number | null = null;
  private signalChangeCountForRun = 0;

  /** Declares the control regime of the current/next run (compare runner). */
  setRunMode(mode: SimulationMetrics["mode"]): void {
    this.runMode = mode;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
