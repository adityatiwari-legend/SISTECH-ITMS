"use client";

import React from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useItms } from "@/lib/store";
import { SimulationMap } from "@/components/SimulationMap";
import {
  ActiveEmergencyPanel,
  AiPanel,
  CompactSignalsPanel,
  CorridorChainPanel,
  AiDecisionTimeline,
} from "@/components/panels";
import {
  DisconnectedBanner,
  MetricCard,
  Panel,
  StaleBanner,
} from "@/components/ui";
import { AiCopilotModal } from "@/components/AiCopilotModal";
import { formatSpeed, simClock } from "@/lib/format";
import type { NetworkGeometryResponse, DecisionEvent } from "@itms/types";

export default function CommandCenterPage() {
  const { state } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [geometryError, setGeometryError] = React.useState<string | null>(null);
  const [decisions, setDecisions] = React.useState<DecisionEvent[]>([]);

  // AI Copilot state
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [copilotQuestion, setCopilotQuestion] = React.useState<string | undefined>(undefined);
  const [copilotContext, setCopilotContext] = React.useState<
    { intersectionId?: string; emergencyId?: number; decisionId?: string } | undefined
  >(undefined);

  const openCopilot = (
    question?: string,
    context?: { intersectionId?: string; emergencyId?: number; decisionId?: string }
  ) => {
    setCopilotQuestion(question);
    setCopilotContext(context);
    setCopilotOpen(true);
  };

  // Authoritative geometry fetch
  React.useEffect(() => {
    let cancelled = false;
    api
      .getNetworkGeometry()
      .then((geo) => {
        if (!cancelled) setGeometry(geo);
      })
      .catch((err) => {
        if (!cancelled) setGeometryError(err instanceof Error ? err.message : "Geometry unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch real AI decision trace
  React.useEffect(() => {
    let cancelled = false;
    const fetchDecisions = async () => {
      try {
        const res = await api.getDecisions();
        if (!cancelled) setDecisions(res.events);
      } catch {
        // Handled silently
      }
    };
    void fetchDecisions();
    const interval = setInterval(fetchDecisions, 3500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Merged live trace + API events
  const mergedTrace = React.useMemo(() => {
    const seen = new Set<string>();
    const all: DecisionEvent[] = [];
    for (const item of [...state.trace, ...decisions]) {
      const key = `${item.ts}|${item.kind}|${item.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(item);
      }
    }
    all.sort((a, b) => b.ts.localeCompare(a.ts));
    return all.slice(0, 8);
  }, [state.trace, decisions]);

  const activeEmergency =
    state.emergencies.find((e) => e.status === "active") ??
    state.emergencies.find((e) => e.status === "created") ??
    null;

  const activeCorridor = state.corridors.find((c) => c.status === "ACTIVE") ?? null;
  const sim = state.sim;

  // Destination ETA calculation
  const destinationEtaSeconds = activeEmergency?.etas?.find((e) => e.isDestination)?.etaSeconds ?? null;

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 font-sans">
      {/* ================================================================== */}
      {/* 1. TOP SYSTEM BAR                                                  */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-[#18D88B] shadow-[0_0_8px_#18D88B]" />
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
              Command Center
            </h1>
            <p className="text-[11px] text-[#8D9AAA]">
              Intelligent Operations & Emergency Priority
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px]">
          <div className="flex items-center gap-2 rounded-lg bg-[#0E141D] px-2.5 py-1 border border-[rgba(255,255,255,0.06)]">
            <span className="text-[#5E6B7A]">SIMULATION:</span>
            <span
              className="font-bold uppercase"
              style={{ color: sim?.status === "running" ? "#18D88B" : "#FFB547" }}
            >
              {sim?.status ?? "OFFLINE"}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-[#0E141D] px-2.5 py-1 border border-[rgba(255,255,255,0.06)]">
            <span className="text-[#5E6B7A]">CITY TWIN:</span>
            <span className="font-bold text-[#42B8FF]">
              {geometry?.demoCity?.toUpperCase() ?? "BHOPAL"}
            </span>
          </div>

          {/* AI Copilot Trigger Button */}
          <button
            onClick={() => openCopilot()}
            className="flex items-center gap-1.5 rounded-lg border border-[#8B7CFF]/40 bg-[rgba(139,124,255,0.12)] px-3 py-1 font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.22)] transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>AI COPILOT</span>
          </button>

          <Link
            href="/simulator"
            className="flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0E141D] px-3 py-1 text-[#8D9AAA] hover:text-[#F4F7FA] hover:bg-[#121A24] transition-colors"
          >
            <span>Simulator</span>
            <span>→</span>
          </Link>
        </div>
      </div>

      {/* Warning/Alert Banners */}
      {state.connection === "offline" && <DisconnectedBanner />}
      {state.traffic?.stale && sim?.status === "running" && (
        <StaleBanner label="Simulation telemetry updating…" />
      )}
      {geometryError && (
        <div className="rounded-lg border border-[rgba(255,71,87,0.3)] bg-[rgba(255,71,87,0.08)] p-2.5 text-xs text-[#FF4757]">
          ⚠ Traffic Network Unavailable: Unable to load live simulation geometry.
        </div>
      )}

      {/* ================================================================== */}
      {/* 2. MAIN COCKPIT: LIVE TRAFFIC MAP + OPERATIONAL PANELS             */}
      {/* ================================================================== */}
      <div className="grid min-h-[520px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.95fr)_minmax(0,1fr)]">
        {/* LEFT / CENTER: Authoritative Live Simulation Map */}
        <div className="itms-panel min-h-[460px] overflow-hidden flex flex-col rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2.5 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#18D88B]" />
              <span className="font-semibold text-[#F4F7FA] uppercase tracking-wider">LIVE TRAFFIC SIMULATION</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[#8D9AAA]">
              <span>TraCI Sync: 5 Hz</span>
              <span>·</span>
              <span>Vector SVG World</span>
            </div>
          </div>

          <div className="relative flex-1 min-h-[420px]">
            <SimulationMap
              className="absolute inset-0 h-full w-full"
              highlightTraffic
              onOpenCopilot={openCopilot}
              data={{
                geometry,
                trafficSegments: state.traffic?.segments ?? [],
                signals: state.signals,
                vehicles: state.vehicles,
                emergency: activeEmergency,
                corridor: activeCorridor,
                simTimeSeconds: sim?.simTimeSeconds,
              }}
            />
          </div>
        </div>

        {/* RIGHT: Operational Side Panels */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {/* 1. Active Emergency Priority Panel */}
          <ActiveEmergencyPanel
            emergency={activeEmergency}
            sim={sim}
            onOpenCopilot={(q, ctx) => openCopilot(q, ctx)}
          />

          {/* 2. Predictive Green Corridor Progression */}
          <CorridorChainPanel
            corridor={activeCorridor}
            onOpenCopilot={(q) => openCopilot(q)}
          />

          {/* 3. Traffic Signals Control Grid */}
          <CompactSignalsPanel
            signals={state.signals}
            max={6}
            onOpenCopilot={(q, ctx) => openCopilot(q, ctx)}
          />

          {/* 4. Traffic Prediction & Decision Summary */}
          <AiPanel
            predictions={state.predictions}
            traffic={state.traffic}
            corridors={state.corridors}
            sim={sim}
            onOpenCopilot={() => openCopilot("Explain the current traffic prediction and signal coordination strategy.")}
          />
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. LIVE METRICS ROW                                                */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 font-mono">
        <MetricCard
          label="TRAFFIC VOLUME"
          value={state.traffic ? `${state.traffic.summary.vehicleCount}` : "—"}
          sub={`${state.traffic?.summary.congestedSegments ?? 0} Congested Links`}
          color="#F4F7FA"
        />
        <MetricCard
          label="AVERAGE SPEED"
          value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"}
          sub="City-Wide Average"
          color="#18D88B"
        />
        <MetricCard
          label="TOTAL QUEUE"
          value={state.traffic ? `${state.traffic.summary.totalQueueLength}` : "—"}
          sub="Waiting Vehicles"
          color={state.traffic && state.traffic.summary.totalQueueLength > 50 ? "#FFB547" : "#F4F7FA"}
        />
        <MetricCard
          label="ACTIVE SIGNALS"
          value={state.signals.length > 0 ? `${state.signals.length}` : "—"}
          sub="TraCI Managed"
          color="#42B8FF"
        />
        <MetricCard
          label="GREEN CORRIDOR"
          value={activeCorridor ? "ACTIVE" : "STANDBY"}
          sub={activeCorridor ? `Corridor #${activeCorridor.id}` : "Ready to engage"}
          color={activeCorridor ? "#8B7CFF" : "#5E6B7A"}
        />
        <MetricCard
          label="EMERGENCY ETA"
          value={
            destinationEtaSeconds !== null
              ? `+${destinationEtaSeconds.toFixed(0)}s`
              : activeEmergency
              ? "Calculating"
              : "—"
          }
          sub={
            destinationEtaSeconds !== null && sim
              ? simClock(sim.simTimeSeconds, destinationEtaSeconds)
              : "No Active Emergency"
          }
          color={destinationEtaSeconds !== null ? "#FF3B4E" : "#8D9AAA"}
        />
      </div>

      {/* ================================================================== */}
      {/* 4. AI DECISION TRACE TIMELINE                                      */}
      {/* ================================================================== */}
      <Panel
        title="AI Decision Trace"
        subtitle="Chronological Autonomous Traffic Actions"
        ai
        right={
          <div className="flex items-center gap-3">
            <button
              onClick={() => openCopilot("Summarize the recent autonomous traffic decisions and explains why they were taken.")}
              className="text-[10px] font-mono text-[#8B7CFF] hover:underline"
            >
              Explain Decisions with AI →
            </button>
            <Link
              href="/ai"
              className="font-mono text-[10px] font-semibold uppercase text-[#8D9AAA] hover:text-[#F4F7FA]"
            >
              Full History →
            </Link>
          </div>
        }
      >
        {mergedTrace.length === 0 ? (
          <div className="py-4 text-center font-mono text-xs text-[#5E6B7A]">
            No automated decisions triggered yet. Start the simulation or dispatch an emergency unit to observe real-time A* routing, queue prediction, and signal priority actions.
          </div>
        ) : (
          <AiDecisionTimeline
            events={mergedTrace}
            max={6}
            onExplainEvent={(ev) =>
              openCopilot(`Explain why this automated decision occurred: "${ev.message}"`, {
                decisionId: ev.kind,
              })
            }
          />
        )}
      </Panel>

      {/* ================================================================== */}
      {/* 5. AI COPILOT MODAL                                                */}
      {/* ================================================================== */}
      <AiCopilotModal
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialQuestion={copilotQuestion}
        context={copilotContext}
      />
    </div>
  );
}
