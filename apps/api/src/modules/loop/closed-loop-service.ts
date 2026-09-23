import type { EmergencyPriority } from "@itms/types";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { CorridorService } from "../corridor/corridor-service.ts";
import type { PredictionService } from "../prediction/prediction-service.ts";
import type { RouteEngine } from "../routing/route-engine.ts";
import type { MetricsRepository } from "../../database/repositories/metrics-repository.ts";

/**
 * Closed-loop control scheduler (Phases.md 6).
 *
 * Runs the adaptive loop after every simulation step (serialized with all
 * other step listeners — no concurrent loops), but only performs work every
 * `loopEvalIntervalS` SIMULATION seconds (configurable; deterministic in
 * reproducible runs):
 *
 *   traffic state → emergency position → predictions → route/ETA re-eval
 *     → (route switch, with safeguards) → corridor re-plan → signals
 *
 * Route re-optimization (Phases.md 6.3): every `routeReevalIntervalS` sim
 * seconds an A* candidate route from the vehicle's current edge to the
 * destination is computed over the live congestion-adjusted graph and
 * compared with the remaining current route. The route is switched ONLY
 * when the candidate is meaningfully better:
 *
 *   improvement >= max(minImprovementS, currentEta * minImprovementFraction)
 *
 * Safeguards against oscillation (all configurable):
 *  - cooldown between switches per emergency (routeSwitchCooldownS),
 *  - maximum switches per emergency (routeSwitchMaxPerEmergency),
 *  - no switch close to the destination (routeSwitchNearDestinationGuardS),
 *  - no switch while the vehicle crosses an intersection (routeIndex < 0),
 *  - candidate must actually differ from the remaining route.
 */
export class ClosedLoopService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly emergencyService: EmergencyService;
  private readonly corridorService: CorridorService;
  private readonly predictionService: PredictionService;
  private readonly routeEngine: RouteEngine;
  private readonly metricsRepository: MetricsRepository | null;

  private lastEvalSimTime = -Infinity;
  private lastReevalSimTime = -Infinity;
  private reroutingEnabled = true;
  private loopRuns = 0;
  private eventListeners: Array<() => void> = [];

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    emergencyService: EmergencyService;
    corridorService: CorridorService;
    predictionService: PredictionService;
    routeEngine: RouteEngine;
    metricsRepository: MetricsRepository | null;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.emergencyService = options.emergencyService;
    this.corridorService = options.corridorService;
    this.predictionService = options.predictionService;
    this.routeEngine = options.routeEngine;
    this.metricsRepository = options.metricsRepository;

    this.eventListeners.push(options.manager.onStep((event) => this.onStep(event.simTimeSeconds)));
  }

  /** Disables dynamic re-routing (baseline comparison mode). */
  setReroutingEnabled(enabled: boolean): void {
    this.reroutingEnabled = enabled;
  }

  getLoopRunCount(): number {
    return this.loopRuns;
  }

  async dispose(): Promise<void> {
    for (const off of this.eventListeners) off();
    this.eventListeners = [];
  }

  /** Step hook: serialized with all other step listeners. */
  private async onStep(simTimeSeconds: number): Promise<void> {
    if (simTimeSeconds - this.lastEvalSimTime < this.config.loopEvalIntervalS) {
      return;
    }
    this.lastEvalSimTime = simTimeSeconds;
    this.loopRuns += 1;

    try {
      await this.predictionService.refreshPredictions();
    } catch (err) {
      this.logger.warn("Loop prediction refresh failed", { error: err });
    }

    if (!this.reroutingEnabled) return;
    if (simTimeSeconds - this.lastReevalSimTime < this.config.routeReevalIntervalS) return;
    this.lastReevalSimTime = simTimeSeconds;

    for (const eventId of this.emergencyService.getActiveEventIds()) {
      try {
        await this.evaluateRouteSwitch(eventId, simTimeSeconds);
      } catch (err) {
        this.logger.error("Route re-evaluation failed", { eventId, error: err });
      }
    }
  }

  /**
   * One route re-evaluation with hysteresis + safeguards. Returns true when
   * the route was switched.
   */
  async evaluateRouteSwitch(eventId: number, simTimeSeconds: number): Promise<boolean> {
    const emergency = this.emergencyService.getEmergencyRuntime(eventId);
    if (emergency === null || emergency.status !== "active" || emergency.live === null) {
      return false;
    }
    const live = emergency.live;

    // Safeguard: only switch while on a known route edge (not internal).
    if (live.routeIndex < 0) return false;
    const currentEdgeId = emergency.routeEdges[live.routeIndex];
    if (currentEdgeId === undefined) return false;
    const currentEdge = this.routeEngine.getGraph().getEdge(currentEdgeId);
    if (currentEdge === null) return false;

    // Safeguard: never switch right before the destination.
    const destinationEtas = this.emergencyService.getEtas(eventId);
    const destinationEta = destinationEtas?.find((eta) => eta.isDestination)?.etaSeconds ?? null;
    if (destinationEta !== null && destinationEta <= this.config.routeSwitchNearDestinationGuardS) {
      return false;
    }

    // Safeguard: cooldown between switches.
    const lastSwitchSimTime =
      this.metricsRepository !== null ? await this.metricsRepository.lastSwitchSimTime(eventId) : null;
    if (lastSwitchSimTime !== null && simTimeSeconds - lastSwitchSimTime < this.config.routeSwitchCooldownS) {
      return false;
    }

    // Safeguard: maximum switches per emergency.
    const switchCount = this.metricsRepository !== null ? await this.metricsRepository.countRouteSwitches(eventId) : 0;
    if (switchCount >= this.config.routeSwitchMaxPerEmergency) {
      return false;
    }

    // Current remaining ETA (destination eta from the live route/ETA calc).
    if (destinationEta === null) return false;

    // Candidate: A* from the current edge's end junction to the destination
    // over the live congestion-adjusted graph.
    let candidate;
    try {
      candidate = this.routeEngine.computeRoute(currentEdge.toJunction, emergency.destinationJunction);
    } catch {
      return false; // no candidate (e.g. unreachable) — keep the current route
    }
    const candidateEdges = [currentEdgeId, ...candidate.segments.map((segment) => segment.segmentId)];
    const remainingCurrent = emergency.routeEdges.slice(live.routeIndex);

    // Candidate must differ from what remains.
    if (sameEdges(candidateEdges, remainingCurrent)) {
      return false;
    }

    // Fair comparison: both sides include the current edge's remainder.
    const currentEdgeCost = this.routeEngine.edgeCost(currentEdgeId);
    // Remainder estimate: use the emergency's live remaining distance and
    // the current edge's cost-per-meter.
    const currentEdgeLength = Math.max(1, currentEdge.distanceM);
    const remainingDistanceM = destinationEtas?.[destinationEtas.length - 1]?.distanceM ?? 0;
    const remainderSeconds = (remainingDistanceM / currentEdgeLength) * currentEdgeCost.costSeconds;
    const candidateEta = remainderSeconds + candidate.estimatedTravelTimeS;

    // Hysteresis: switch only on meaningful improvement.
    const threshold = Math.max(
      this.config.routeSwitchMinImprovementS,
      destinationEta * this.config.routeSwitchMinImprovementFraction,
    );
    const improvement = destinationEta - candidateEta;
    if (improvement < threshold) {
      return false;
    }

    const result = await this.emergencyService.rerouteEmergency({
      eventId,
      edges: candidateEdges,
      reason: `Closed loop: candidate route saves ${improvement.toFixed(1)}s (threshold ${threshold.toFixed(1)}s)`,
      oldEtaS: destinationEta,
      newEtaS: candidateEta,
    });
    if (!result.switched) {
      this.logger.warn("Route switch rejected", { eventId, error: result.error });
      return false;
    }

    // Corridor re-plans from the new route (remaining junctions).
    await this.corridorService.replanForRouteChange(eventId);
    return true;
  }
}

function sameEdges(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
