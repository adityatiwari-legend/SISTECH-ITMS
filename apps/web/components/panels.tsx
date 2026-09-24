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
import { formatDistance, formatSpeed, simClock, wallClock } from "@/lib/format";
import { getJunctionMeta, getVehicleDisplay } from "@/lib/naming";

// ---------------------------------------------------------------------------
// 1. ACTIVE EMERGENCY PANEL (Human-Centered Hero Panel)
// ---------------------------------------------------------------------------

export function ActiveEmergencyPanel({
  emergency,
  sim,
  onViewRoute,
  onOpenCopilot,
}: {
  emergency: EmergencyEventDetail | null;
  sim: { simTimeSeconds: number } | null;
  onViewRoute?: () => void;
  onOpenCopilot?: (question?: string, context?: { emergencyId?: number }) => void;
}) {
  const { state } = useItms();
  const [showTechnicalDetails, setShowTechnicalDetails] = React.useState(false);

  if (emergency === null) {
    return (
      <Panel
        title="Active Emergency Response"
        subtitle="Priority Vehicle Monitoring"
        right={<Badge color="#5E6B7A">STANDBY</Badge>}
      >
        <EmptyState
          title="No Active Emergency"
          hint="The traffic network is operating normally. Dispatch an emergency unit from Simulation or Emergencies to engage predictive green corridors."
          action={
            <Link
              href="/emergencies"
              className="inline-flex rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#121A24] px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase text-[#42B8FF] hover:border-[#42B8FF] transition-colors"
            >
              Dispatch Emergency Unit
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

  const currentRaw = emergency.live?.roadId ? emergency.live.roadId.split("_")[0] : emergency.originJunction;
  const nextRaw = destinationEta?.junctionId ?? emergency.destinationJunction;

  const originMeta = getJunctionMeta(emergency.originJunction);
  const destMeta = getJunctionMeta(emergency.destinationJunction);
  const currentMeta = getJunctionMeta(currentRaw);
  const nextMeta = getJunctionMeta(nextRaw);
  const vehicleTitle = getVehicleDisplay(emergency.vehicle?.vehicleId ?? `EMV-${emergency.id}`, emergency.type);

  // Route progress calculation
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
            {emergency.status.toUpperCase()}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-3 font-sans">
        {/* Main Vehicle Header Card */}
        <div className="rounded-xl border border-[rgba(255,59,78,0.3)] bg-[rgba(255,59,78,0.06)] p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-sans text-base font-bold tracking-tight text-[#FF3B4E]">
                {vehicleTitle}
              </div>
              <div className="font-mono text-[10px] uppercase text-[#8D9AAA] tracking-wide mt-0.5">
                Priority: <span className="font-bold text-[#F4F7FA]">{emergency.priority.toUpperCase()}</span> · En Route
              </div>
            </div>
            <div className="text-right">
              {activeCorridor ? (
                <span className="rounded bg-[#8B7CFF]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#8B7CFF] border border-[#8B7CFF]/30">
                  CORRIDOR #{activeCorridor.id} ACTIVE
                </span>
              ) : (
                <span className="rounded bg-[#5E6B7A]/15 px-2 py-0.5 font-mono text-[10px] text-[#8D9AAA]">
                  STANDARD ROUTING
                </span>
              )}
            </div>
          </div>

          {/* Route Progress Bar */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
              <span className="text-[#8D9AAA]">Mission Progress</span>
              <span className="font-bold text-[#F4F7FA]">{progressPercent}%</span>
            </div>
            <ProgressBar progress={progressPercent} color="#FF3B4E" height={6} />
          </div>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Speed</div>
            <div className="mt-0.5 text-sm font-bold text-[#F4F7FA]">
              {formatSpeed(emergency.live?.speedMps ?? emergency.vehicle?.speedMps ?? null)}
            </div>
          </div>

          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Destination ETA</div>
            <div className="mt-0.5 text-sm font-bold text-[#18D88B]">
              {destinationEta
                ? `${destinationEta.etaSeconds.toFixed(0)}s (${simClock(
                    sim?.simTimeSeconds ?? null,
                    destinationEta.etaSeconds
                  )})`
                : "Calculating…"}
            </div>
          </div>

          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Current Location</div>
            <div className="mt-0.5 font-semibold text-[#F4F7FA] truncate" title={currentMeta.fullName}>
              {currentMeta.code} · {currentMeta.name}
            </div>
          </div>

          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Next Junction</div>
            <div className="mt-0.5 font-semibold text-[#42B8FF] truncate" title={nextMeta.fullName}>
              {nextMeta.code} · {nextMeta.name}
            </div>
          </div>
        </div>

        {/* Human-Readable Route Breakdown */}
        <div className="space-y-1 text-xs">
          <KeyValue label="Origin Hub">{originMeta.fullName}</KeyValue>
          <KeyValue label="Destination">{destMeta.fullName}</KeyValue>
          <KeyValue label="Distance Remaining">
            {formatDistance(emergency.live?.remainingDistanceM ?? null)}
          </KeyValue>
        </div>

        {/* Technical Data Disclosure Toggle */}
        <div>
          <button
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="text-[10px] font-mono text-[#5E6B7A] hover:text-[#8D9AAA] transition-colors"
          >
            {showTechnicalDetails ? "▼ Hide Technical Details" : "▶ Show Technical Details (SUMO IDs)"}
          </button>
          {showTechnicalDetails && (
            <div className="mt-1.5 rounded bg-[#05070B] border border-[rgba(255,255,255,0.06)] p-2 font-mono text-[10px] text-[#8D9AAA] space-y-1">
              <div>SUMO Vehicle ID: {emergency.vehicle?.vehicleId ?? "—"}</div>
              <div>Route Edges: {emergency.route?.segments.map((s) => s.segmentId).join(", ") || "—"}</div>
              <div>TraCI Road: {emergency.live?.roadId ?? "—"} (Lane: {emergency.live?.laneId ?? "—"})</div>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="mt-1 flex items-center gap-2">
          {onViewRoute && (
            <button
              onClick={onViewRoute}
              className="flex-1 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#121A24] py-1.5 font-mono text-[11px] font-semibold uppercase text-[#F4F7FA] hover:border-[#42B8FF] hover:text-[#42B8FF] transition-colors"
            >
              Focus On Map
            </button>
          )}

          {onOpenCopilot && (
            <button
              onClick={() => onOpenCopilot("Explain the current emergency progress and upcoming signals.", { emergencyId: emergency.id })}
              className="flex-1 rounded-lg border border-[#8B7CFF]/40 bg-[rgba(139,124,255,0.12)] py-1.5 font-mono text-[11px] font-semibold uppercase text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.22)] transition-colors"
            >
              Ask Copilot
            </button>
          )}

          <Link
            href="/corridors"
            className="text-center rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0E141D] px-3 py-1.5 font-mono text-[11px] text-[#8D9AAA] hover:text-[#F4F7FA] hover:bg-[#121A24] transition-colors"
          >
            Corridor →
          </Link>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 2. GREEN CORRIDOR CHAIN PANEL (Human-Centered Progression)
// ---------------------------------------------------------------------------

export function CorridorChainPanel({
  corridor,
  onOpenCopilot,
}: {
  corridor: CorridorDetail | null;
  onOpenCopilot?: (question?: string) => void;
}) {
  if (corridor === null) {
    return (
      <Panel
        title="Predictive Green Corridor"
        subtitle="Adaptive Priority Signaling"
        right={<Badge color="#5E6B7A">STANDBY</Badge>}
      >
        <EmptyState
          title="No Corridor Active"
          hint="A predictive green wave will engage automatically when an emergency vehicle is en route."
        />
      </Panel>
    );
  }

  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const current = ordered.find((s) => s.status === "APPLIED") ?? null;
  const upcoming = ordered.filter((s) => s.status === "PENDING");
  const next = upcoming[0] ?? null;

  const currentMeta = current ? getJunctionMeta(current.junctionId) : null;
  const nextMeta = next ? getJunctionMeta(next.junctionId) : null;

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
      <div className="flex flex-col gap-3 font-sans">
        {/* Current & Upcoming Node Badges */}
        {(currentMeta !== null || nextMeta !== null) && (
          <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
            <div className="rounded-lg border border-[rgba(24,216,139,0.3)] bg-[rgba(24,216,139,0.06)] p-2">
              <div className="uppercase text-[#5E6B7A]">Current Wave (Green)</div>
              <div className="mt-0.5 text-xs font-bold text-[#18D88B] truncate">
                {currentMeta ? currentMeta.fullName : "Clear Ahead"}
              </div>
            </div>
            <div className="rounded-lg border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.06)] p-2">
              <div className="uppercase text-[#5E6B7A]">Preparing Next</div>
              <div className="mt-0.5 text-xs font-bold text-[#FFB547] truncate">
                {nextMeta ? nextMeta.fullName : "Destination Base"}
              </div>
            </div>
          </div>
        )}

        {/* Visual Corridor Node Flow */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-3">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
            Priority Progression Wave
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <span title="Origin">🚑</span>
            {ordered.map((signal) => {
              const meta = getJunctionMeta(signal.junctionId);
              const isApplied = signal.status === "APPLIED";
              const isPassed = signal.status === "PASSED";

              return (
                <React.Fragment key={signal.junctionId}>
                  <span className="text-[#5E6B7A]">→</span>
                  <span
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold transition-all"
                    style={
                      isApplied
                        ? {
                            borderColor: "rgba(24,216,139,0.5)",
                            backgroundColor: "rgba(24,216,139,0.15)",
                            color: "#18D88B",
                          }
                        : isPassed
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
                    title={`${meta.fullName} — ${signal.status}`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: isApplied ? "#18D88B" : isPassed ? "#5E6B7A" : "#FFB547",
                      }}
                    />
                    {meta.code}
                  </span>
                </React.Fragment>
              );
            })}
            <span className="text-[#5E6B7A]">→</span>
            <span title="Destination">🏥</span>
          </div>
        </div>

        {/* Intersection Window Schedule */}
        <div className="max-h-36 overflow-y-auto space-y-1.5">
          {ordered.map((signal) => {
            const meta = getJunctionMeta(signal.junctionId);
            return (
              <div
                key={signal.sequenceIndex}
                className="flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] py-1 font-mono text-[10px] last:border-0"
              >
                <div>
                  <div className="font-semibold text-[#F4F7FA]">{meta.fullName}</div>
                  <div className="text-[9px] text-[#5E6B7A]">Approach: {signal.approachSegmentId}</div>
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
            );
          })}
        </div>

        {onOpenCopilot && (
          <button
            onClick={() => onOpenCopilot("Explain why the green corridor was planned with this sequence.")}
            className="w-full rounded-lg border border-[#8B7CFF]/30 bg-[rgba(139,124,255,0.1)] py-1.5 font-mono text-[10px] font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.2)] transition-colors"
          >
            Explain Corridor Logic with AI →
          </button>
        )}
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
  onOpenCopilot,
}: {
  signals: SignalSnapshot[];
  max?: number;
  onOpenCopilot?: (question?: string, context?: { intersectionId?: string }) => void;
}) {
  return (
    <Panel
      title="Traffic Signal Control"
      subtitle={`${signals.length} Signalized Intersections`}
      right={
        <Link
          href="/signals"
          className="font-mono text-[10px] uppercase font-semibold text-[#42B8FF] hover:underline"
        >
          View All Signals →
        </Link>
      }
    >
      {signals.length === 0 ? (
        <EmptyState title="No Live Signal Data" hint="Start the simulation to receive live signal telemetry." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {signals.slice(0, max).map((signal) => {
            const meta = getJunctionMeta(signal.id);
            return (
              <div
                key={signal.id}
                className="flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0E141D] p-2.5 transition-all hover:border-[rgba(255,255,255,0.15)]"
              >
                <div className="min-w-0 pr-1">
                  <div className="font-semibold text-xs text-[#F4F7FA] truncate" title={meta.fullName}>
                    {meta.fullName}
                  </div>
                  <div className="font-mono text-[9px] text-[#5E6B7A]">
                    Queue: {signal.queueLength} veh
                  </div>
                  {onOpenCopilot && (
                    <button
                      onClick={() => onOpenCopilot(`Why is ${meta.code} in this phase?`, { intersectionId: signal.id })}
                      className="mt-1 text-[9px] font-mono text-[#8B7CFF] hover:underline"
                    >
                      Why this signal?
                    </button>
                  )}
                </div>
                <SignalLightVisual state={signal.state} size="sm" />
              </div>
            );
          })}
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
  onOpenCopilot,
}: {
  predictions: PredictionUpdatePayload | null;
  traffic: { summary: { cityLevel: string; vehicleCount: number; congestedSegments: number } } | null;
  corridors: CorridorDetail[];
  sim: { status: string; simTimeSeconds: number } | null;
  onOpenCopilot?: () => void;
}) {
  const activeCorridor = corridors.find((c) => c.status === "ACTIVE") ?? null;
  const prediction = predictions?.predictions.find((p) => p.source === "ml") ?? predictions?.predictions[0] ?? null;

  const forecastStr = prediction
    ? `${prediction.source === "ml" ? "XGBoost ML" : "Prediction Engine"} · ${prediction.horizons.map((h) => h.predictedVehicleCount).join(" → ")} veh`
    : "Traffic Prediction Active";

  const signalsCoordinated = activeCorridor
    ? activeCorridor.signals.filter((s) => s.status === "APPLIED" || s.status === "PASSED").length
    : 0;

  return (
    <Panel
      title="Traffic Prediction & Decision Engine"
      subtitle="AI Traffic Intelligence"
      ai
      right={
        <div className="flex items-center gap-2">
          {onOpenCopilot && (
            <button
              onClick={onOpenCopilot}
              className="rounded bg-[#8B7CFF]/15 border border-[#8B7CFF]/30 px-2 py-0.5 font-mono text-[9px] font-bold text-[#8B7CFF] hover:bg-[#8B7CFF]/25 transition-all"
            >
              ASK COPILOT
            </button>
          )}
          <Badge color="#8B7CFF">{sim?.status ?? "IDLE"}</Badge>
        </div>
      }
    >
      <div className="space-y-1.5 font-sans text-xs">
        <KeyValue label="Traffic Prediction">{forecastStr}</KeyValue>
        <KeyValue label="Corridor State">
          {activeCorridor ? (
            <span className="text-[#8B7CFF] font-bold">Optimized Priority (Corridor #{activeCorridor.id})</span>
          ) : (
            "Standard Traffic Flow"
          )}
        </KeyValue>
        <KeyValue label="Coordinated Signals">
          {signalsCoordinated > 0 ? `${signalsCoordinated} Intersections Scheduled` : "None (Nominal)"}
        </KeyValue>
        <KeyValue label="City Congestion">{traffic?.summary.cityLevel ?? "NOMINAL"}</KeyValue>
        <KeyValue label="Simulation Time">
          {sim ? simClock(sim.simTimeSeconds) : "—"}
        </KeyValue>
      </div>

      {predictions?.predictions.some((p) => p.lastError !== null) && (
        <div className="mt-2.5 rounded-lg border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] p-2 font-mono text-[10px] text-[#FFB547]">
          Prediction Engine running in high-reliability mode.
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
  onExplainEvent,
}: {
  events: DecisionEvent[];
  max?: number;
  onExplainEvent?: (event: DecisionEvent) => void;
}) {
  return (
    <div className="space-y-1.5 font-mono text-[11px]">
      {events.slice(0, max).map((event, idx) => (
        <div
          key={`${event.ts}-${idx}`}
          className="flex items-center justify-between gap-2.5 rounded-lg border border-[rgba(255,255,255,0.05)] bg-[#0A0F16] px-3 py-2"
        >
          <div className="flex items-center gap-2.5 min-w-0">
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
              {event.kind.replace(".", " · ")}
            </Badge>
            <span className="text-[#F4F7FA] truncate">{event.message}</span>
          </div>

          {onExplainEvent && (
            <button
              onClick={() => onExplainEvent(event)}
              className="shrink-0 rounded bg-[#121A24] border border-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[9px] text-[#8B7CFF] hover:border-[#8B7CFF]/50 transition-colors"
              title="Explain this decision with AI"
            >
              Explain
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. COMPACT CORRIDOR EVENT TIMELINE (UNDER MAP)
// ---------------------------------------------------------------------------

export function CorridorEventTimeline({
  events,
  max = 8,
}: {
  events: DecisionEvent[];
  max?: number;
}) {
  const filtered = events
    .filter((e) =>
      e.kind.startsWith("signal") ||
      e.kind.startsWith("corridor") ||
      e.kind.startsWith("emergency") ||
      e.kind.startsWith("route")
    )
    .slice(0, max);

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] bg-[#070B12] px-3.5 py-2 font-mono text-[10px] text-[#5E6B7A]">
        <span>Corridor Timeline: Standby for emergency dispatch and predictive signal transitions…</span>
        <span className="text-[#8D9AAA]">SUMO · TraCI Interlock Active</span>
      </div>
    );
  }

  return (
    <div className="border-t border-[rgba(255,255,255,0.08)] bg-[#070B12] px-3 py-2">
      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[rgba(255,255,255,0.04)] font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#18D88B] animate-pulse" />
          <span className="font-bold text-[#8D9AAA]">LIVE CORRIDOR EVENT TIMELINE</span>
        </span>
        <span>PRE-CLEARING & ROLLING SIGNAL PROGRESSION</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
        {filtered.map((item, i) => {
          const time = wallClock(item.ts);
          const isGreen = item.message.includes("GREEN");
          const isClearing = item.message.includes("clearing");
          const isPrep = item.message.includes("preparation");
          const isPassed = item.message.includes("passed");
          const isRoute = item.message.includes("Route");
          const isEm = item.message.includes("Emergency");

          const badgeColor = isGreen
            ? "border-[#18D88B]/40 bg-[#18D88B]/10 text-[#18D88B]"
            : isClearing
            ? "border-[#FFB547]/40 bg-[#FFB547]/10 text-[#FFB547]"
            : isPrep
            ? "border-[#42B8FF]/40 bg-[#42B8FF]/10 text-[#42B8FF]"
            : isPassed
            ? "border-[#8D9AAA]/30 bg-[#121A24] text-[#8D9AAA]"
            : isEm
            ? "border-[#FF3B4E]/40 bg-[#FF3B4E]/10 text-[#FF3B4E]"
            : isRoute
            ? "border-[#42B8FF]/40 bg-[#42B8FF]/10 text-[#42B8FF]"
            : "border-[rgba(255,255,255,0.08)] bg-[#0E141D] text-[#8B7CFF]";

          return (
            <div
              key={`${item.ts}-${i}`}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[10px] ${badgeColor} backdrop-blur-sm`}
            >
              <span className="font-bold text-[#F4F7FA]">{time}</span>
              <span className="font-medium text-white/90">{item.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

