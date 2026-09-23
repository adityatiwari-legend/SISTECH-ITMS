import { randomUUID } from "node:crypto";
import type { ComparisonResult, CreateComparisonBody, SimulationMetrics } from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import { AppError } from "../../errors.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { CorridorService } from "../corridor/corridor-service.ts";
import type { ClosedLoopService } from "../loop/closed-loop-service.ts";
import type { MetricsRecorder } from "../metrics/metrics-recorder.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";
import type { EmergencyEventDetail } from "@itms/types";
import type { TrafficService } from "../traffic/traffic-service.ts";

/**
 * Baseline vs ITMS scenario comparison (Phases.md 6.6-6.8).
 *
 * Reproducibility strategy: both runs use the SAME scenario config
 * (deterministic SUMO seed), the SAME warm-up (manual stepping to
 * `warmupSeconds`), and an emergency created with identical parameters at
 * the same sim time. The only difference is the control regime:
 *
 *  - baseline: normal routing (no dynamic re-routing), normal signal
 *    timing (no corridor commands), no ITMS intervention,
 *  - ITMS: traffic prediction + dynamic re-routing (closed loop) + green
 *    corridor + signal optimization.
 *
 * Metrics for each run are collected automatically by the MetricsRecorder
 * and persisted; the comparison reports the deltas. Nothing is hard-coded.
 *
 * Runs are sequential (one SUMO process at a time) and serialized through
 * the manager's lifecycle chain — no concurrent optimization loops.
 */
export class ScenarioComparisonService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly emergencyService: EmergencyService;
  private readonly corridorService: CorridorService;
  private readonly loopService: ClosedLoopService;
  private readonly metricsRecorder: MetricsRecorder;
  private readonly metricsRepository: MetricsRepository;
  private readonly trafficService: TrafficService;

  private jobs = new Map<string, ComparisonResult>();
  private activeJob: string | null = null;

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    emergencyService: EmergencyService;
    corridorService: CorridorService;
    loopService: ClosedLoopService;
    metricsRecorder: MetricsRecorder;
    metricsRepository: MetricsRepository;
    trafficService: TrafficService;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.emergencyService = options.emergencyService;
    this.corridorService = options.corridorService;
    this.loopService = options.loopService;
    this.metricsRecorder = options.metricsRecorder;
    this.metricsRepository = options.metricsRepository;
    this.trafficService = options.trafficService;
  }

  listJobs(): ComparisonResult[] {
    return [...this.jobs.values()].sort((a, b) => (a.startedAtIso ?? "").localeCompare(b.startedAtIso ?? ""));
  }

  getJob(jobId: string): ComparisonResult | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** Starts a comparison job (queued; executed asynchronously). */
  startComparison(body: CreateComparisonBody): ComparisonResult {
    if (this.activeJob !== null) {
      const active = this.jobs.get(this.activeJob);
      if (active !== undefined && active.status === "running") {
        throw new AppError(409, "comparison_already_running", `Comparison job ${this.activeJob} is still running; wait for it to finish.`);
      }
    }
    // Validate endpoints up front (fail fast, before the long run).
    const problems = this.endpointProblems(body.origin, body.destination);
    if (problems !== null) {
      throw new AppError(422, "invalid_comparison_route", problems);
    }
    const job: ComparisonResult = {
      jobId: randomUUID(),
      status: "queued",
      error: null,
      input: {
        type: body.type,
        origin: body.origin,
        destination: body.destination,
        priority: body.priority,
        warmupSeconds: body.warmupSeconds ?? this.config.comparisonWarmupSeconds,
        durationCapSeconds: body.durationCapSeconds ?? this.config.comparisonDurationCapSeconds,
      },
      baseline: { runId: null, metrics: null },
      itms: { runId: null, metrics: null },
      deltas: null,
      startedAtIso: new Date().toISOString(),
      completedAtIso: null,
    };
    this.jobs.set(job.jobId, job);
    void this.executeJob(job);
    return job;
  }

  private async executeJob(job: ComparisonResult): Promise<void> {
    this.activeJob = job.jobId;
    job.status = "running";
    try {
      // ---- run 1: baseline (no ITMS intervention) ----
      this.metricsRecorder.setRunMode("baseline");
      job.baseline.runId = await this.runSingle(
        job,
        { corridor: false, rerouting: false },
      );

      // ---- run 2: ITMS (identical initial conditions) ----
      this.metricsRecorder.setRunMode("itms");
      job.itms.runId = await this.runSingle(
        job,
        { corridor: true, rerouting: true },
      );

      // ---- comparison from the persisted measured metrics ----
      const baselineMetrics = job.baseline.runId !== null ? await this.metricsRepository.getRunMetrics(job.baseline.runId) : null;
      const itmsMetrics = job.itms.runId !== null ? await this.metricsRepository.getRunMetrics(job.itms.runId) : null;
      job.baseline.metrics = baselineMetrics !== null ? toSimulationMetrics(baselineMetrics) : null;
      job.itms.metrics = itmsMetrics !== null ? toSimulationMetrics(itmsMetrics) : null;
      if (job.baseline.metrics !== null && job.itms.metrics !== null) {
        const delta = (a: number | null, b: number | null): number | null =>
          a !== null && b !== null ? Math.round((b - a) * 100) / 100 : null;
        job.deltas = {
          emergencyTravelTimeS: delta(job.baseline.metrics.emergencyTravelTimeS, job.itms.metrics.emergencyTravelTimeS),
          avgVehicleDelayS: delta(job.baseline.metrics.avgVehicleDelayS, job.itms.metrics.avgVehicleDelayS),
          avgQueueLength: delta(job.baseline.metrics.avgQueueLength, job.itms.metrics.avgQueueLength),
          avgSpeedMps: delta(job.baseline.metrics.avgSpeedMps, job.itms.metrics.avgSpeedMps),
          throughputPerHour: delta(job.baseline.metrics.throughputPerHour, job.itms.metrics.throughputPerHour),
          signalChangeCount: delta(job.baseline.metrics.signalChangeCount, job.itms.metrics.signalChangeCount),
        };
      }
      job.status = "completed";
      job.completedAtIso = new Date().toISOString();
      await this.persistComparison(job);
      this.logger.info("Comparison completed", {
        jobId: job.jobId,
        baselineRun: job.baseline.runId,
        itmsRun: job.itms.runId,
        deltas: job.deltas,
      });
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAtIso = new Date().toISOString();
      this.logger.error("Comparison failed", { jobId: job.jobId, error: job.error });
    } finally {
      this.activeJob = null;
    }
  }

  /** Executes one full run (baseline or ITMS) and returns its run id. */
  private async runSingle(
    job: ComparisonResult,
    mode: { corridor: boolean; rerouting: boolean },
  ): Promise<number> {
    // Identical starting conditions: fresh SUMO from the same scenario
    // config (fixed seed), manual stepping. Any active simulation (e.g. the
    // operator's own run) is stopped first — sequential by design.
    await this.manager.stop();
    await this.manager.start("emergency", { autoRun: false });
    const startedRunId = this.currentRunIdOrThrow();
    this.loopService.setReroutingEnabled(mode.rerouting);

    try {
      // ---- warm-up to the same sim time ----
      while (this.manager.getStatusSnapshot().simTimeSeconds < job.input.warmupSeconds) {
        await this.manager.stepOnce();
      }

      // ---- identical emergency ----
      const emergency = await this.emergencyService.createEmergency({
        type: job.input.type,
        origin: job.input.origin,
        destination: job.input.destination,
        priority: job.input.priority,
      });

      // Wait until the vehicle is in the network.
      const deadline = simDeadline(job.input.durationCapSeconds);
      let activated = false;
      while (!activated && this.manager.getStatusSnapshot().simTimeSeconds < deadline) {
        await this.manager.stepOnce();
        const status = await this.emergencyService.getPersistedStatus(emergency.id);
        activated = status === "active";
      }
      if (!activated) {
        throw new Error(`Emergency vehicle never activated (run ${startedRunId}).`);
      }

      // ---- ITMS intervention ----
      if (mode.corridor) {
        const corridor = await this.corridorService.createCorridor(emergency.id);
        this.logger.info("Comparison corridor created", { runId: startedRunId, corridorId: corridor.id });
      }

      // ---- run to arrival or the duration cap ----
      let finalStatus = await this.emergencyService.getPersistedStatus(emergency.id);
      while (finalStatus !== "arrived" && this.manager.getStatusSnapshot().simTimeSeconds < deadline) {
        await this.manager.stepOnce();
        finalStatus = await this.emergencyService.getPersistedStatus(emergency.id);
      }
      if (finalStatus !== "arrived") {
        this.logger.warn("Emergency did not arrive before the duration cap", {
          runId: startedRunId,
          status: finalStatus,
        });
      }
    } finally {
      this.loopService.setReroutingEnabled(true);
      await this.manager.stop();
    }
    return startedRunId;
  }

  private currentRunIdOrThrow(): number {
    // The comparison drives the manager directly; the run id is created by
    // the traffic service's onStarted hook.
    const runId = this.trafficService.getCurrentRunId();
    if (runId === null) {
      throw new Error("Simulation run was not registered (traffic service inactive).");
    }
    return runId;
  }

  /** Endpoint sanity for the comparison request (same rules as emergencies). */
  private endpointProblems(origin: string, destination: string): string | null {
    if (origin === destination) {
      return "Origin and destination must differ.";
    }
    return null;
  }

  /** Persists a completed comparison (measured deltas) for analytics. */
  private async persistComparison(job: ComparisonResult): Promise<void> {
    try {
      await this.metricsRepository.insertComparison({
        jobId: job.jobId,
        type: job.input.type,
        originJunction: job.input.origin,
        destinationJunction: job.input.destination,
        priority: job.input.priority,
        baselineRunId: job.baseline.runId,
        itmsRunId: job.itms.runId,
        deltas: job.deltas,
        completedAtIso: job.completedAtIso,
      });
    } catch (err) {
      this.logger.error("Could not persist comparison result", { jobId: job.jobId, error: err });
    }
  }
}

/** Sim-time deadline: manager sim time starts at 0 and only increases. */
function simDeadline(capSeconds: number): number {
  return capSeconds + 1;
}

function toSimulationMetrics(row: {
  run_id: number;
  mode: string;
  emergency_travel_time_s: number | null;
  emergency_time_loss_s: number | null;
  avg_vehicle_delay_s: number | null;
  avg_queue_length: number | null;
  avg_speed_mps: number | null;
  throughput_per_hour: number | null;
  signal_change_count: number;
  sim_duration_s: number;
  sample_count: number;
  started_at: Date | null;
  completed_at: Date | null;
}): SimulationMetrics {
  return {
    runId: row.run_id,
    scenario: "emergency",
    mode: row.mode as SimulationMetrics["mode"],
    emergencyTravelTimeS: row.emergency_travel_time_s,
    emergencyTimeLossS: row.emergency_time_loss_s,
    avgVehicleDelayS: row.avg_vehicle_delay_s,
    avgQueueLength: row.avg_queue_length,
    avgSpeedMps: row.avg_speed_mps,
    throughputPerHour: row.throughput_per_hour,
    signalChangeCount: row.signal_change_count,
    simDurationS: row.sim_duration_s,
    sampleCount: row.sample_count,
    startedAtIso: row.started_at?.toISOString() ?? null,
    completedAtIso: row.completed_at?.toISOString() ?? null,
  };
}
