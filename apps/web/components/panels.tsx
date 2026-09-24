"use client";

import React from "react";
import Link from "next/link";
import type {
  EmergencyEventDetail,
  CorridorDetail,
  PredictionUpdatePayload,
  SignalSnapshot,
  DecisionEvent,
} from "@itms/types";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, KeyValue, Panel, ProgressBar, SignalLightVisual } from "./ui";
import { formatDistance, formatSpeed, simClock, vehicleLabel, wallClock } from "@/lib/format";

// ---------------------------------------------------------------------------
// 1. ACTIVE EMERGENCY PANEL (Hero Side Panel)
// ---------------------------------------------------------------------------

export function ActiveEmergencyPanel({
  emergency,
  sim,
  onViewRoute,
}: {
  emergency: EmergencyEventDetail | null;
  sim: { simTimeSeconds: number } | null;
  onViewRoute?: () => void;
}) {
  const { state } = useItms();

  if (emergency === null) {
    return (
      <Panel
        title="Active Emergency"
        subtitle="Priority Vehicle Monitoring"
        right={<Badge color="#5E6B7A">STANDBY</Badge>}
      >
        <EmptyState
          title="No Emergency Active"
          hint="Dispatch an emergency vehicle from Simulation or Emergencies page to engage predictive green corridors."
          action={
            <Link
              href="/emergencies"
              className="inline-flex rounded border border-[rgba(255,255,255,0.12)] bg-[#121A24] px-3 py-1 font-mono text-[11px] font-semibold uppercase text-[#42B8FF] hover:border-[#42B8FF] transition-colors"
            >
              Dispatch Emergency
            </Link>
          }
        />
      </Panel>
    );
  }

  const activeCorridor = state.corridors.find(
    (c) => c.eventId === emergency.id && (c.status === "ACTIVE" || c.status === "COMPLETED")
  );

  const destinationEta =
    emergency.etas?.find((eta) => eta.isDestination) ??
    emergency.etas?.[emergency.etas.length - 1] ??
    null;

  const currentJunction = emergency.live?.roadId ? emergency.live.roadId.split("_")[0] : emergency.originJunction;
  const nextJunction = destinationEta?.junctionId ?? emergency.destinationJunction;

  // Approximate route progress calculation
  const totalDist = emergency.route?.totalLengthM ?? 1;
  const remDist = emergency.live?.remainingDistanceM ?? totalDist;
  const progressPercent = Math.min(100, Math.max(0, Math.round(((totalDist - remDist) / totalDist) * 100)));

  return (
    <Panel
      title="Active Emergency Response"
      subtitle="Priority Vehicle Telemetry"
      emergency
      right={
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-ping rounded-full bg-[#FF3B4E]" />
          <Badge color="#FF3B4E" solid>
            {emergency.status}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Main Vehicle Header Card */}
        <div className="rounded-lg border border-[rgba(255,59,78,0.3)] bg-[rgba(255,59,78,0.06)] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚑</span>
              <div>
                <div className="font-mono text-base font-bold tracking-tight text-[#FF3B4E]">
                  {vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}
                </div>
                <div className="font-mono text-[10px] uppercase text-[#8D9AAA]">
                  {emergency.type.replace("_", " ")}
                </div>
              </div>
            </div>
            <div className="text-right">
              <Badge color={emergency.priority === "critical" ? "#FF3B4E" : "#FFB547"}>
                {emergency.priority}
              </Badge>
              {activeCorridor && (
                <div className="mt-1 font-mono text-[9px] font-bold text-[#8B7CFF]">
                  CORRIDOR #{activeCorridor.id} ACTIVE
                </div>
              )}
            </div>
          </div>

          {/* Route Progress Bar */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
              <span className="text-[#8D9AAA]">Route Progress</span>
              <span className="font-bold text-[#F4F7FA]">{progressPercent}%</span>
            </div>
            <ProgressBar progress={progressPercent} color="#FF3B4E" height={5} />
          </div>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Speed</div>
            <div className="mt-0.5 text-sm font-bold text-[#F4F7FA]">
              {formatSpeed(emergency.live?.speedMps ?? emergency.vehicle?.speedMps ?? null)}
            </div>
          </div>
          <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
            <div className="text-[10px] uppercase text-[#5E6B7A]">ETA (Sim)</div>
            <div className="mt-0.5 text-sm font-bold text-[#18D88B]">
              {destinationEta
                ? `${destinationEta.etaSeconds.toFixed(0)}s (${simClock(
                    sim?.simTimeSeconds ?? null,
                    destinationEta.etaSeconds
                  )})`
                : "Calculating…"}
            </div>
          </div>
          <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Current Sector</div>
            <div className="mt-0.5 font-bold text-[#F4F7FA] truncate">
              {currentJunction}
            </div>
          </div>
          <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Next Junction</div>
            <div className="mt-0.5 font-bold text-[#42B8FF] truncate">
              {nextJunction}
            </div>
          </div>
        </div>

        {/* Detailed Route Breakdown */}
        <div className="space-y-1">
          <KeyValue label="Origin">{emergency.originJunction}</KeyValue>
          <KeyValue label="Destination">{emergency.destinationJunction}</KeyValue>
          <KeyValue label="Remaining Distance">
            {formatDistance(emergency.live?.remainingDistanceM ?? null)}
          </KeyValue>
          <KeyValue label="Route Segments">
            {emergency.route?.edgeCount ? `${emergency.route.edgeCount} links (${formatDistance(emergency.route.totalLengthM)})` : "—"}
          </KeyValue>
        </div>

        {/* Action Controls */}
        <div className="mt-1 flex items-center gap-2">
          {onViewRoute && (
            <button
              onClick={onViewRoute}
              className="flex-1 rounded border border-[rgba(255,255,255,0.12)] bg-[#121A24] py-1.5 font-mono text-[11px] font-semibold uppercase text-[#F4F7FA] hover:border-[#42B8FF] hover:text-[#42B8FF] transition-colors"
            >
              Focus On Map
            </button>
          )}
          <Link
            href="/corridors"
            className="flex-1 text-center rounded border border-[rgba(139,124,255,0.4)] bg-[rgba(139,124,255,0.1)] py-1.5 font-mono text-[11px] font-semibold uppercase text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.18)] transition-colors"
          >
            Corridor Logic →
          </Link>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 2. GREEN CORRIDOR CHAIN PANEL
// ---------------------------------------------------------------------------

export function CorridorChainPanel({
  corridor,
}: {
  corridor: CorridorDetail | null;
}) {
  if (corridor === null) {
    return (
      <Panel
        title="Predictive Green Corridor"
        subtitle="Adaptive Priority Signaling"
        right={<Badge color="#5E6B7A">INACTIVE</Badge>}
      >
        <EmptyState
          title="No Corridor Active"
          hint="Corridors calculate rolling green signal waves automatically when an emergency vehicle is active."
        />
      </Panel>
    );
  }

  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const current = ordered.find((s) => s.status === "APPLIED") ?? null;
  const upcoming = ordered.filter((s) => s.status === "PENDING");
  const next = upcoming[0] ?? null;

  return (
    <Panel
      title={`Green Corridor #${corridor.id}`}
      subtitle="Rolling Emergency Wave"
      ai
      right={
        <Badge
          color={corridor.status === "ACTIVE" ? "#8B7CFF" : "#18D88B"}
          solid={corridor.status === "ACTIVE"}
        >
          {corridor.status}
        </Badge>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Quick Current / Next Intersections */}
        {(current !== null || next !== null) && (
          <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
            <div className="rounded border border-[rgba(24,216,139,0.3)] bg-[rgba(24,216,139,0.06)] p-2">
              <div className="uppercase text-[#5E6B7A]">Current Wave (Green)</div>
              <div className="mt-0.5 text-xs font-bold text-[#18D88B]">
                {current ? current.junctionId : "—"}
              </div>
            </div>
            <div className="rounded border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.06)] p-2">
              <div className="uppercase text-[#5E6B7A]">Next Up</div>
              <div className="mt-0.5 text-xs font-bold text-[#FFB547]">
                {next ? next.junctionId : "End of Route"}
              </div>
            </div>
          </div>
        )}

        {/* Visual Corridor Node Flow */}
        <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-2.5">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
            Priority Progression
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-sm">
            <span title="Origin">🚑</span>
            {ordered.map((signal) => (
              <React.Fragment key={signal.junctionId}>
                <span className="text-[#5E6B7A]">→</span>
                <span
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold"
                  style={
                    signal.status === "APPLIED"
                      ? {
                          borderColor: "rgba(24,216,139,0.5)",
                          backgroundColor: "rgba(24,216,139,0.15)",
                          color: "#18D88B",
                        }
                      : signal.status === "PASSED"
                      ? {
                          borderColor: "rgba(255,255,255,0.1)",
                          backgroundColor: "rgba(255,255,255,0.04)",
                          color: "#8D9AAA",
                        }
                      : {
                          borderColor: "rgba(255,181,71,0.3)",
                          backgroundColor: "rgba(255,181,71,0.08)",
                          color: "#FFB547",
                        }
                  }
                  title={`${signal.junctionId} — ${signal.status}`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        signal.status === "APPLIED"
                          ? "#18D88B"
                          : signal.status === "PASSED"
                          ? "#5E6B7A"
                          : "#FFB547",
                    }}
                  />
                  {signal.junctionId}
                </span>
              </React.Fragment>
            ))}
            <span className="text-[#5E6B7A]">→</span>
            <span title="Destination">🏥</span>
          </div>
        </div>

        {/* Detailed Intersection Window Schedule */}
        <div className="max-h-36 overflow-y-auto space-y-1">
          {ordered.map((signal) => (
            <div
              key={signal.sequenceIndex}
              className="flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] py-1 font-mono text-[10px] last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#F4F7FA]">{signal.junctionId}</span>
                <span className="text-[#5E6B7A]">via {signal.approachSegmentId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#8D9AAA]">
                  {signal.plannedGreenStartS !== null
                    ? `${signal.plannedGreenStartS.toFixed(0)}s–${signal.plannedGreenEndS?.toFixed(0)}s`
                    : "Rolling"}
                </span>
                <Badge
                  color={
                    signal.status === "APPLIED"
                      ? "#18D88B"
                      : signal.status === "PASSED"
                      ? "#8D9AAA"
                      : signal.status === "SKIPPED"
                      ? "#FFB547"
                      : "#42B8FF"
                  }
                >
                  {signal.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 3. COMPACT SIGNALS PANEL
// ---------------------------------------------------------------------------

export function CompactSignalsPanel({
  signals,
  max = 6,
}: {
  signals: SignalSnapshot[];
  max?: number;
}) {
  return (
    <Panel
      title="Traffic Signals"
      subtitle={`${signals.length} Signalized Intersections`}
      right={
        <Link
          href="/signals"
          className="font-mono text-[10px] uppercase font-semibold text-[#42B8FF] hover:underline"
        >
          View All →
        </Link>
      }
    >
      {signals.length === 0 ? (
        <EmptyState title="No Live Signals" hint="Start simulation to receive TraCI signal telemetry." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {signals.slice(0, max).map((signal) => (
            <div
              key={signal.id}
              className="itms-hover flex items-center justify-between rounded border border-[rgba(255,255,255,0.08)] bg-[#0E141D] p-2"
            >
              <div>
                <div className="font-mono text-xs font-semibold text-[#F4F7FA]">
                  {signal.id}
                </div>
                <div className="font-mono text-[9px] text-[#5E6B7A]">
                  Q: {signal.queueLength} veh
                </div>
              </div>
              <SignalLightVisual state={signal.state} size="sm" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 4. AI EXPLAINABILITY & DECISION TRACE PANEL
// ---------------------------------------------------------------------------

export function AiPanel({
  predictions,
  traffic,
  corridors,
  sim,
}: {
  predictions: PredictionUpdatePayload | null;
  traffic: { summary: { cityLevel: string; vehicleCount: number; congestedSegments: number } } | null;
  corridors: CorridorDetail[];
  sim: { status: string; simTimeSeconds: number } | null;
}) {
  const activeCorridor = corridors.find((c) => c.status === "ACTIVE") ?? null;
  const prediction = predictions?.predictions.find((p) => p.source === "ml") ?? predictions?.predictions[0] ?? null;

  const forecastStr = prediction
    ? `${prediction.source.toUpperCase()} · ${prediction.horizons.map((h) => h.predictedVehicleCount).join(" → ")} veh`
    : "Model inference active";

  const signalsCoordinated = activeCorridor
    ? activeCorridor.signals.filter((s) => s.status === "APPLIED" || s.status === "PASSED").length
    : 0;

  return (
    <Panel
      title="AI Decision & Forecast"
      subtitle="Neural Routing & Optimization"
      ai
      right={<Badge color="#8B7CFF">{sim?.status ?? "IDLE"}</Badge>}
    >
      <div className="space-y-1">
        <KeyValue label="Traffic Forecast">{forecastStr}</KeyValue>
        <KeyValue label="Corridor State">
          {activeCorridor ? (
            <span className="text-[#8B7CFF] font-bold">OPTIMIZED (Corridor #{activeCorridor.id})</span>
          ) : (
            "Nominal Coordination"
          )}
        </KeyValue>
        <KeyValue label="Coordinated Signals">
          {signalsCoordinated > 0 ? `${signalsCoordinated} Intersections` : "None (Idle)"}
        </KeyValue>
        <KeyValue label="City Congestion">{traffic?.summary.cityLevel ?? "NOMINAL"}</KeyValue>
        <KeyValue label="Simulation Time">
          {sim ? simClock(sim.simTimeSeconds) : "—"}
        </KeyValue>
      </div>

      {predictions?.predictions.some((p) => p.lastError !== null) && (
        <div className="mt-2.5 rounded border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] p-2 font-mono text-[10px] text-[#FFB547]">
          Deterministic estimation active (ML fallback mode).
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 5. CHRONOLOGICAL AI DECISION TIMELINE
// ---------------------------------------------------------------------------

export function AiDecisionTimeline({
  events,
  max = 6,
}: {
  events: DecisionEvent[];
  max?: number;
}) {
  return (
    <div className="space-y-1.5 font-mono text-[11px]">
      {events.slice(0, max).map((event, idx) => (
        <div
          key={`${event.ts}-${idx}`}
          className="flex items-center gap-2.5 rounded border border-[rgba(255,255,255,0.05)] bg-[#0A0F16] px-2.5 py-1.5"
        >
          <span className="text-[10px] text-[#5E6B7A] shrink-0">
            {wallClock(event.ts)}
          </span>
          <Badge
            color={
              event.kind.includes("emergency")
                ? "#FF3B4E"
                : event.kind.includes("corridor")
                ? "#8B7CFF"
                : event.kind.includes("signal")
                ? "#18D88B"
                : "#42B8FF"
            }
          >
            {event.kind}
          </Badge>
          <span className="text-[#F4F7FA] truncate">{event.message}</span>
        </div>
      ))}
    </div>
  );
}
