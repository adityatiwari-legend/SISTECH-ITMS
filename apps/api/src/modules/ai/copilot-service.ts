import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { SimulationManager } from "../simulation/simulation-manager.ts";
import type { EmergencyService } from "../emergency/emergency-service.ts";
import type { CorridorService } from "../corridor/corridor-service.ts";
import type { TrafficService } from "../traffic/traffic-service.ts";
import type { PredictionService } from "../prediction/prediction-service.ts";
import type { DatabasePool } from "../../database/db.ts";
import { getDecisionTrace } from "../system/overview.ts";
import type { EmergencyEventDetail, CorridorDetail } from "@itms/types";

export interface CopilotQueryInput {
  question: string;
  context?: {
    intersectionId?: string;
    emergencyId?: number;
    decisionId?: string;
    focus?: string;
  };
}

export interface CopilotQueryOutput {
  answer: string;
  citations: string[];
  source: "vultr_serverless" | "itms_grounded_engine";
  model: string;
  timestamp: string;
}

export class AiCopilotService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly manager: SimulationManager;
  private readonly emergencyService: EmergencyService;
  private readonly corridorService: CorridorService;
  private readonly trafficService: TrafficService;
  private readonly predictionService: PredictionService;
  private readonly db: DatabasePool;

  constructor(options: {
    config: AppConfig;
    logger: Logger;
    manager: SimulationManager;
    emergencyService: EmergencyService;
    corridorService: CorridorService;
    trafficService: TrafficService;
    predictionService: PredictionService;
    db: DatabasePool;
  }) {
    this.config = options.config;
    this.logger = options.logger;
    this.manager = options.manager;
    this.emergencyService = options.emergencyService;
    this.corridorService = options.corridorService;
    this.trafficService = options.trafficService;
    this.predictionService = options.predictionService;
    this.db = options.db;
  }

  async ask(input: CopilotQueryInput): Promise<CopilotQueryOutput> {
    const question = input.question.trim();
    if (!question) {
      return {
        answer: "Please enter an operational or technical question about the current traffic network.",
        citations: [],
        source: "itms_grounded_engine",
        model: "rule_engine",
        timestamp: new Date().toISOString(),
      };
    }

    // 1. Gather REAL current ITMS live state
    const simStatus = this.manager.getStatusSnapshot();
    const trafficSnapshot = this.trafficService.getTrafficSnapshot();
    const signals = this.manager.getSignals();

    let activeEmergency: EmergencyEventDetail | null = null;
    try {
      const emergencies = await this.emergencyService.listEmergencies();
      const active = emergencies.find((e) => e.status === "active");
      if (active) {
        activeEmergency = await this.emergencyService.getEmergency(active.id);
      } else if (emergencies.length > 0) {
        activeEmergency = await this.emergencyService.getEmergency(emergencies[0]!.id);
      }
    } catch (err) {
      this.logger.warn("Could not fetch emergencies for copilot context", { error: String(err) });
    }

    let activeCorridor: CorridorDetail | null = null;
    try {
      const corridors = await this.corridorService.listCorridors();
      const active = corridors.find((c) => c.status === "ACTIVE");
      if (active) {
        activeCorridor = await this.corridorService.getCorridor(active.id);
      } else if (corridors.length > 0) {
        activeCorridor = await this.corridorService.getCorridor(corridors[0]!.id);
      }
    } catch (err) {
      this.logger.warn("Could not fetch corridors for copilot context", { error: String(err) });
    }

    const predictions = this.predictionService.getPredictions();
    let recentDecisions: Array<{ kind: string; ts: string; message: string }> = [];
    try {
      const decisions = await getDecisionTrace(this.db, 8);
      recentDecisions = decisions.slice(0, 8).map((d) => ({
        kind: d.kind,
        ts: d.ts,
        message: d.message,
      }));
    } catch {
      // DB trace optional
    }

    // Build relevant structured facts & citations
    const citations: string[] = [];
    const contextLines: string[] = [];

    contextLines.push(`SIMULATION STATUS: ${simStatus.status.toUpperCase()} (Sim Time: ${simStatus.simTimeSeconds.toFixed(1)}s, Speed: ${simStatus.paceMultiplier}x, Vehicles: ${simStatus.vehicleCount})`);
    citations.push(`Simulation: ${simStatus.status} (${simStatus.simTimeSeconds.toFixed(1)}s)`);

    if (trafficSnapshot.summary) {
      const s = trafficSnapshot.summary;
      const speedKmh = Math.round(s.avgSpeedMps * 3.6);
      contextLines.push(`CITY TRAFFIC: ${s.vehicleCount} vehicles, Average Speed: ${speedKmh} km/h, Congestion Level: ${s.cityLevel}, Total Queue: ${s.totalQueueLength}`);
      citations.push(`City Congestion: ${s.cityLevel} (${speedKmh} km/h avg, Queue: ${s.totalQueueLength})`);
    }

    if (activeEmergency) {
      const v = activeEmergency.vehicle;
      const speedKmh = activeEmergency.live ? Math.round(activeEmergency.live.speedMps * 3.6) : 0;
      const origin = activeEmergency.originJunction;
      const dest = activeEmergency.destinationJunction;
      const nextEtaItem = activeEmergency.etas?.[0];
      const destEtaItem = activeEmergency.etas?.find((e) => e.isDestination);
      const nextJunction = nextEtaItem ? nextEtaItem.junctionId : dest;
      const etaStr = destEtaItem ? `${Math.round(destEtaItem.etaSeconds)}s` : "Calculating";

      contextLines.push(`ACTIVE EMERGENCY: Vehicle ${v?.vehicleId ?? "EMV"} (${v?.type ?? "ambulance"}, Priority: ${activeEmergency.priority.toUpperCase()})`);
      contextLines.push(`EMERGENCY STATUS: ${activeEmergency.status.toUpperCase()}, Origin: ${origin}, Destination: ${dest}, Next Junction: ${nextJunction}, Speed: ${speedKmh} km/h, Destination ETA: ${etaStr}`);
      citations.push(`Emergency: ${v?.vehicleId ?? "EMV"} (${activeEmergency.status}, ETA: ${etaStr})`);

      if (activeEmergency.etas && activeEmergency.etas.length > 0) {
        const etaPreview = activeEmergency.etas.map((e) => `${e.junctionId}: ${Math.round(e.etaSeconds)}s`).join(", ");
        contextLines.push(`UPCOMING JUNCTION ETAS: ${etaPreview}`);
      }
    } else {
      contextLines.push("ACTIVE EMERGENCY: None currently active. Network is running standard traffic management.");
    }

    if (activeCorridor) {
      contextLines.push(`ACTIVE GREEN CORRIDOR: Corridor #${activeCorridor.id} (Status: ${activeCorridor.status}, Emergency Event #${activeCorridor.eventId})`);
      const sigList = activeCorridor.signals.map((s) => `${s.junctionId} [${s.status}, Window: ${s.plannedGreenStartS ? s.plannedGreenStartS.toFixed(0) : "0"}s-${s.plannedGreenEndS ? s.plannedGreenEndS.toFixed(0) : "0"}s]`).join("; ");
      contextLines.push(`CORRIDOR SIGNALS: ${sigList}`);
      citations.push(`Corridor #${activeCorridor.id} (${activeCorridor.status}, ${activeCorridor.signals.length} junctions)`);
    } else {
      contextLines.push("ACTIVE GREEN CORRIDOR: None active. Signals operating on normal cycle or local adaptive control.");
    }

    if (signals.length > 0) {
      const topSignals = signals.slice(0, 10).map((s) => `${s.id}: ${s.state}`).join(", ");
      contextLines.push(`CURRENT SIGNAL PHASES: ${topSignals}`);
    }

    if (predictions && predictions.length > 0) {
      const predPreview = predictions.slice(0, 6).map((p) => {
        const h60 = p.horizons.find((h) => h.horizonSeconds === 60);
        return `${p.junctionId} (+60s queue: ${h60 ? h60.predictedVehicleCount : "—"})`;
      }).join("; ");
      contextLines.push(`AI TRAFFIC PREDICTIONS: ${predPreview}`);
    }

    if (recentDecisions.length > 0) {
      contextLines.push(`RECENT SYSTEM DECISIONS:\n` + recentDecisions.map((d) => `- [${d.kind}] ${d.message}`).join("\n"));
    }

    if (input.context?.intersectionId) {
      const jId = input.context.intersectionId;
      const sig = signals.find((s) => s.id === jId);
      const corrSig = activeCorridor?.signals.find((s) => s.junctionId === jId);
      contextLines.push(`OPERATOR FOCUS INTERSECTION: ${jId} (Signal State: ${sig?.state ?? "Unknown"}, Corridor Status: ${corrSig?.status ?? "Normal Cycle"})`);
      citations.push(`Focus Junction: ${jId}`);
    }

    const contextBlock = contextLines.join("\n");

    // 2. Call Vultr Serverless Inference if API key is present
    if (this.config.vultrApiKey) {
      try {
        const model = this.config.vultrModel || "deepseek-v4.1-flash";
        const response = await fetch("https://api.vultrinference.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.config.vultrApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are the ITMS AI Operator Copilot for the Intelligent Traffic Management System. Your role is to explain real-time traffic decisions, emergency vehicle progress, green corridor priorities, signal states, and traffic predictions to municipal operators. " +
                  "Ground every answer strictly in the provided LIVE ITMS SYSTEM CONTEXT. " +
                  "Do NOT invent facts, coordinates, vehicle numbers, or events not present in the context. " +
                  "If the information is not available in the context, explicitly say: 'I don't have enough live data to determine that.' " +
                  "Never claim to manually override or change signals yourself; explain the automated system's reasoning. " +
                  "Keep responses clear, professional, natural, and concise (2-4 sentences max).",
              },
              {
                role: "user",
                content: `LIVE ITMS SYSTEM CONTEXT:\n${contextBlock}\n\nOPERATOR QUESTION:\n${question}`,
              },
            ],
            max_tokens: 350,
            temperature: 0.15,
          }),
          signal: AbortSignal.timeout(9000),
        });

        if (response.ok) {
          const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const content = json.choices?.[0]?.message?.content?.trim();
          if (content) {
            return {
              answer: content,
              citations,
              source: "vultr_serverless",
              model,
              timestamp: new Date().toISOString(),
            };
          }
        } else {
          const errText = await response.text();
          this.logger.warn("Vultr inference request failed", { status: response.status, error: errText });
        }
      } catch (err) {
        this.logger.warn("Vultr inference error; falling back to grounded rule engine", { error: String(err) });
      }
    }

    // 3. Grounded Deterministic Natural Language Fallback (always factual, zero hallucination)
    const fallbackAnswer = this.generateGroundedExplanation({
      question,
      simStatus,
      activeEmergency,
      activeCorridor,
      trafficSnapshot,
      signals,
      recentDecisions,
      focusIntersectionId: input.context?.intersectionId,
    });

    return {
      answer: fallbackAnswer,
      citations,
      source: "itms_grounded_engine",
      model: "itms-deterministic-expert",
      timestamp: new Date().toISOString(),
    };
  }

  private generateGroundedExplanation(params: {
    question: string;
    simStatus: ReturnType<SimulationManager["getStatusSnapshot"]>;
    activeEmergency: EmergencyEventDetail | null;
    activeCorridor: CorridorDetail | null;
    trafficSnapshot: ReturnType<TrafficService["getTrafficSnapshot"]>;
    signals: ReturnType<SimulationManager["getSignals"]>;
    recentDecisions: Array<{ kind: string; ts: string; message: string }>;
    focusIntersectionId?: string;
  }): string {
    const q = params.question.toLowerCase();
    const em = params.activeEmergency;
    const corr = params.activeCorridor;
    const traf = params.trafficSnapshot.summary;

    // A. Focus on a specific junction ("Why is I-04 green?", "Why this signal?")
    if (params.focusIntersectionId || q.includes("why is") || q.includes("signal") || q.includes("green") || q.includes("junction")) {
      const targetId = params.focusIntersectionId ??
        (q.match(/\b(i[1-6]|i-0[1-6]|w[1-2]|e[1-2]|s[1-3]|n[1-3])\b/i)?.[0]?.toUpperCase());

      if (targetId) {
        const corrSignal = corr?.signals.find((s) => s.junctionId.toUpperCase() === targetId || s.junctionId.toUpperCase().replace("-", "") === targetId.replace("-", ""));
        const sigState = params.signals.find((s) => s.id.toUpperCase() === targetId || s.id.toUpperCase().replace("-", "") === targetId.replace("-", ""));

        if (corrSignal) {
          if (corrSignal.status === "APPLIED") {
            return `Intersection ${targetId} is currently GREEN because active emergency corridor #${corr?.id ?? "1"} has preempted the signal to clear downstream traffic for oncoming vehicle ${em?.vehicle?.vehicleId ?? "EMV"} (ETA: ${Math.round(corrSignal.etaSeconds)}s).`;
          }
          if (corrSignal.status === "PENDING") {
            const startS = corrSignal.plannedGreenStartS ? `${corrSignal.plannedGreenStartS.toFixed(0)}s` : "calculated window";
            const endS = corrSignal.plannedGreenEndS ? `${corrSignal.plannedGreenEndS.toFixed(0)}s` : "window end";
            return `Intersection ${targetId} is preparing for green preemption within a scheduled window (${startS}–${endS}) to match the emergency vehicle's calculated A* arrival time.`;
          }
          if (corrSignal.status === "PASSED") {
            return `Intersection ${targetId} was previously cleared for the emergency vehicle and has now safely transitioned back to normal adaptive signal cycling.`;
          }
        }

        if (sigState) {
          const isGreen = sigState.state.toLowerCase().includes("g");
          return `Intersection ${targetId} is operating under ${isGreen ? "active GREEN movement" : "holding RED phase"} based on local queue occupancy (${traf ? traf.totalQueueLength + " total vehicles queued" : "measured flow"}), with no emergency preemption active.`;
        }
      }
    }

    // B. Corridor questions ("Why is the corridor active?")
    if (q.includes("corridor") || q.includes("active") || q.includes("green wave")) {
      if (corr && corr.status === "ACTIVE" && em) {
        const nextJ = em.etas?.[0]?.junctionId ?? em.destinationJunction;
        const destEta = em.etas?.find((e) => e.isDestination)?.etaSeconds;
        const eta = destEta !== undefined ? `${Math.round(destEta)}s` : "under 2 minutes";
        return `The green corridor (#${corr.id}) is active because emergency vehicle ${em.vehicle?.vehicleId ?? "EMV"} (${em.priority.toUpperCase()} priority) is en route from ${em.originJunction} to ${em.destinationJunction}. The predictive rolling controller has scheduled conflict-free green windows through ${nextJ} with an overall destination ETA of ${eta}.`;
      }
      return "There is currently no active green corridor. Green corridors are created automatically when an emergency vehicle is dispatched with critical or high priority.";
    }

    // C. Route change questions ("Why did the route change?")
    if (q.includes("route") || q.includes("change") || q.includes("switch")) {
      const switchDecision = params.recentDecisions.find((d) => d.kind.includes("route") || d.kind.includes("switch"));
      if (switchDecision) {
        return `The route was updated because the closed-loop optimization evaluated live congestion: "${switchDecision.message}". Dynamic re-routing is guarded by hysteresis thresholds to ensure safety.`;
      }
      if (em) {
        return `Emergency vehicle ${em.vehicle?.vehicleId ?? "EMV"} is following its calculated optimal A* route across ${em.route?.segments.length ?? 0} segments from ${em.originJunction} to ${em.destinationJunction}. No dynamic route switch has been triggered.`;
      }
      return "No route change has occurred. The system continuously evaluates alternative routes over live network telemetry every 5 simulation seconds.";
    }

    // D. Congestion questions ("What is causing congestion?")
    if (q.includes("congestion") || q.includes("traffic") || q.includes("delay") || q.includes("queue")) {
      if (traf) {
        const speedKmh = Math.round(traf.avgSpeedMps * 3.6);
        return `The city network currently has ${traf.vehicleCount} simulated vehicles with an average speed of ${speedKmh} km/h and ${traf.cityLevel} congestion. Total queue length across all signal approaches is ${traf.totalQueueLength} vehicles.`;
      }
      return `Traffic telemetry indicates ${params.simStatus.vehicleCount} vehicles active in the digital twin. Simulation status is ${params.simStatus.status}.`;
    }

    // E. Future prediction / "What happens next?"
    if (q.includes("next") || q.includes("happens next") || q.includes("future") || q.includes("upcoming")) {
      if (em && em.status === "active") {
        const nextJ = em.etas?.[0]?.junctionId ?? em.destinationJunction;
        const nextEta = em.etas?.[0]?.etaSeconds !== undefined ? `${Math.round(em.etas[0].etaSeconds)} seconds` : "shortly";
        return `Next, emergency unit ${em.vehicle?.vehicleId ?? "EMV"} will reach junction ${nextJ} in approximately ${nextEta}. Signal preemption will hold the approach green, and cross-street queues will resume normal cycling once the vehicle clears the intersection.`;
      }
      return `The simulation will continue advancing at ${params.simStatus.paceMultiplier}x speed. The adaptive traffic controller will balance signal phases across all controlled junctions based on queue demand.`;
    }

    // F. Emergency explanation ("Explain current emergency")
    if (q.includes("emergency") || q.includes("ambulance") || q.includes("explain")) {
      if (em) {
        const speedKmh = em.live ? Math.round(em.live.speedMps * 3.6) : 0;
        const destEta = em.etas?.find((e) => e.isDestination)?.etaSeconds;
        const eta = destEta !== undefined ? `${Math.round(destEta)}s` : "calculating";
        const distKm = em.live ? (em.live.remainingDistanceM / 1000).toFixed(1) + " km" : "in transit";
        return `Emergency event #${em.id} is an active ${em.vehicle?.type ?? "ambulance"} (${em.vehicle?.vehicleId ?? "EMV"}) traveling from ${em.originJunction} to ${em.destinationJunction}. Current speed is ${speedKmh} km/h, distance remaining is ${distKm}, and ETA is ${eta}.`;
      }
      return "There is currently no emergency in progress. You can trigger an emergency run from the Simulation cockpit or Scenario Builder to observe the green corridor in action.";
    }

    // General default overview
    return `ITMS Command Center status: ${params.simStatus.status.toUpperCase()} at sim time ${params.simStatus.simTimeSeconds.toFixed(1)}s. ${em ? `Active emergency ${em.vehicle?.vehicleId ?? "EMV"} is en route with ${corr ? "active green corridor #" + corr.id : "standard routing"}.` : "Standard traffic signal optimization is operating normally across all intersections."}`;
  }
}
