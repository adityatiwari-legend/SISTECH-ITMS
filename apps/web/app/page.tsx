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
import { formatSpeed, simClock } from "@/lib/format";
import type { NetworkGeometryResponse, DecisionEvent } from "@itms/types";

export default function CommandCenterPage() {
  const { state } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [geometryError, setGeometryError] = React.useState<string | null>(null);
  const [decisions, setDecisions] = React.useState<DecisionEvent[]>([]);

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
    <div className="flex min-h-full flex-col gap-3 p-4">
      {/* ================================================================== */}
      {/* 1. TOP SYSTEM COCKPIT HEADER                                       */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#18D88B] shadow-[0_0_8px_#18D88B]" />
          <div>
            <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
              COMMAND CENTER
            </h1>
            <p className="font-mono text-[10px] text-[#5E6B7A]">
              AUTONOMOUS REAL-TIME CORRIDOR & TRAFFIC DISPATCH
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <div className="flex items-center gap-2 rounded bg-[#0E141D] px-2.5 py-1 border border-[rgba(255,255,255,0.06)]">
            <span className="text-[#5E6B7A]">SIMULATION:</span>
            <span
              className="font-bold uppercase"
              style={{ color: sim?.status === "running" ? "#18D88B" : "#FFB547" }}
            >
              {sim?.status ?? "OFFLINE"}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded bg-[#0E141D] px-2.5 py-1 border border-[rgba(255,255,255,0.06)]">
            <span className="text-[#5E6B7A]">NETWORK:</span>
            <span className="font-bold text-[#42B8FF]">
              {geometry?.demoCity?.toUpperCase() ?? "SUMO GRID"}
            </span>
          </div>

          <Link
            href="/simulator"
            className="flex items-center gap-1 rounded border border-[rgba(66,184,255,0.3)] bg-[rgba(66,184,255,0.1)] px-3 py-1 font-semibold text-[#42B8FF] hover:bg-[rgba(66,184,255,0.2)] transition-colors"
          >
            <span>Simulation Controls</span>
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
        <div className="rounded border border-[rgba(255,71,87,0.3)] bg-[rgba(255,71,87,0.08)] p-2 font-mono text-[11px] text-[#FF4757]">
          ⚠ SUMO Network Geometry Error: {geometryError}
        </div>
      )}

      {/* ================================================================== */}
      {/* 2. MAIN COCKPIT GRID: LIVE SUMO MAP + HERO OPERATION PANELS       */}
      {/* ================================================================== */}
      <div className="grid min-h-[500px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.95fr)_minmax(0,1fr)]">
        {/* LEFT / CENTER: Authoritative Live SUMO Simulation Map */}
        <div className="itms-panel min-h-[460px] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#18D88B]" />
              <span className="font-semibold text-[#F4F7FA]">SUMO AUTHORITATIVE LIVE TWIN</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[#8D9AAA]">
              <span>TraCI Sync: 5 Hz (200ms)</span>
              <span>·</span>
              <span>Vector SVG</span>
            </div>
          </div>

          <div className="relative flex-1 min-h-[400px]">
            <SimulationMap
              className="absolute inset-0 h-full w-full"
              highlightTraffic
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

        {/* RIGHT: Operational Control Panels */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {/* 1. Active Emergency Panel */}
          <ActiveEmergencyPanel emergency={activeEmergency} sim={sim} />

          {/* 2. Predictive Green Corridor Chain */}
          <CorridorChainPanel corridor={activeCorridor} />

          {/* 3. Compact Signal Grid */}
          <CompactSignalsPanel signals={state.signals} max={6} />

          {/* 4. AI Decision & Forecast Summary */}
          <AiPanel
            predictions={state.predictions}
            traffic={state.traffic}
            corridors={state.corridors}
            sim={sim}
          />
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. LIVE METRICS ROW (6 KPIs)                                       */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="TRAFFIC DENSITY"
          value={state.traffic ? `${state.traffic.summary.vehicleCount}` : "—"}
          sub={`${state.traffic?.summary.congestedSegments ?? 0} Congested Segments`}
          color="#F4F7FA"
        />
        <MetricCard
          label="AVG VEHICLE SPEED"
          value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"}
          sub="City-Wide Velocity"
          color="#18D88B"
        />
        <MetricCard
          label="TOTAL QUEUE"
          value={state.traffic ? `${state.traffic.summary.totalQueueLength}` : "—"}
          sub="Halted Vehicles"
          color={state.traffic && state.traffic.summary.totalQueueLength > 50 ? "#FFB547" : "#F4F7FA"}
        />
        <MetricCard
          label="SIGNALS COORDINATED"
          value={state.signals.length > 0 ? `${state.signals.length}` : "—"}
          sub="TraCI Managed TLS"
          color="#42B8FF"
        />
        <MetricCard
          label="GREEN CORRIDOR"
          value={activeCorridor ? "ACTIVE" : "STANDBY"}
          sub={activeCorridor ? `Corridor #${activeCorridor.id}` : "Awaiting Dispatch"}
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
              : "No Active Priority"
          }
          color={destinationEtaSeconds !== null ? "#FF3B4E" : "#8D9AAA"}
        />
      </div>

      {/* ================================================================== */}
      {/* 4. AI DECISION TRACE TIMELINE                                      */}
      {/* ================================================================== */}
      <Panel
        title="AI Decision Trace (Live System Actions)"
        subtitle="Zero Mock Data · Explainable Autonomous Traffic Engineering"
        ai
        right={
          <Link
            href="/ai"
            className="font-mono text-[10px] font-semibold uppercase text-[#8B7CFF] hover:underline"
          >
            Detailed Intelligence →
          </Link>
        }
      >
        {mergedTrace.length === 0 ? (
          <div className="py-4 text-center font-mono text-xs text-[#5E6B7A]">
            No automated decisions triggered yet. Start the simulation or dispatch an emergency vehicle to view real-time A* routing, ETA calibration, and signal priority actions.
          </div>
        ) : (
          <AiDecisionTimeline events={mergedTrace} max={6} />
        )}
      </Panel>
    </div>
  );
}
