"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { EmergencyEventDetail, CorridorDetail, PredictionUpdatePayload, SignalSnapshot } from "@itms/types";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, KeyValue, Panel, StatusDot } from "./ui";
import { formatDistance, formatSpeed, simClock, vehicleLabel } from "@/lib/format";

/** Priority 1 — the active emergency. Dominant, glowing, real state only. */
export function ActiveEmergencyPanel({ emergency, sim }: { emergency: EmergencyEventDetail | null; sim: { simTimeSeconds: number } | null }) {
  if (emergency === null) {
    return (
      <Panel title="Active emergency">
        <EmptyState title="No active emergency" hint="Create one from the Simulator or Emergencies page." />
      </Panel>
    );
  }
  const destinationEta = emergency.etas?.find((eta) => eta.isDestination) ?? emergency.etas?.[emergency.etas.length - 1] ?? null;
  return (
    <Panel
      title="🚑 Active emergency"
      emergency
      right={<Badge color="#ff453a" solid>{emergency.status}</Badge>}
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-[rgba(255,69,58,0.32)] bg-[rgba(255,69,58,0.06)] p-3"
      >
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-lg font-bold tracking-wide text-[#ff453a]" style={{ textShadow: "0 0 18px rgba(255,69,58,0.45)" }}>
            {vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A9]">
            {emergency.type.replace("_", " ")} · {emergency.priority}
          </span>
        </div>
        <div className="mt-2">
          <KeyValue label="Destination">{emergency.destinationJunction}</KeyValue>
          <KeyValue label="ETA (sim)">
            {destinationEta !== null
              ? `${simClock(sim?.simTimeSeconds ?? null, destinationEta.etaSeconds)} (+${destinationEta.etaSeconds.toFixed(0)}s)`
              : "—"}
          </KeyValue>
          <KeyValue label="Remaining">{formatDistance(emergency.live?.remainingDistanceM ?? null)}</KeyValue>
          <KeyValue label="Speed">{formatSpeed(emergency.live?.speedMps ?? emergency.vehicle?.speedMps ?? null)}</KeyValue>
          <KeyValue label="Corridor"><CorridorMiniState eventRef={emergency.id} /></KeyValue>
          <KeyValue label="Route">
            {emergency.route !== null ? `${emergency.route.edgeCount} segments · ${formatDistance(emergency.route.totalLengthM)}` : "—"}
          </KeyValue>
        </div>
        <div className="mt-2.5 flex gap-2">
          <Link href="/corridors" className="rounded-lg border border-[rgba(167,139,250,0.5)] bg-[rgba(167,139,250,0.1)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#a78bfa]">
            ⇉ Corridor
          </Link>
          <Link href="/emergencies" className="rounded-lg border border-[rgba(148,163,190,0.2)] bg-[rgba(148,163,190,0.06)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8B95A9]">
            Details
          </Link>
        </div>
      </motion.div>
    </Panel>
  );
}

function CorridorMiniState({ eventRef }: { eventRef: number }) {
  const { state } = useItms();
  const corridor = state.corridors.find(
    (entry) => entry.eventId === eventRef && (entry.status === "ACTIVE" || entry.status === "COMPLETED"),
  );
  if (corridor === undefined) return <span>—</span>;
  return <Badge color={corridor.status === "ACTIVE" ? "#a78bfa" : "#8B95A9"}>{corridor.status}</Badge>;
}

/** Priority 2 — the green corridor chain: real per-signal backend statuses. */
export function CorridorChainPanel({ corridor }: { corridor: CorridorDetail | null }) {
  if (corridor === null) {
    return (
      <Panel title="Green corridor">
        <EmptyState title="No corridor" hint="Corridors activate automatically with an emergency or from the Corridors page." />
      </Panel>
    );
  }
  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const current = ordered.find((signal) => signal.status === "APPLIED") ?? null;
  const upcoming = ordered.filter((signal) => signal.status === "PENDING");
  const next = upcoming[0] ?? null;
  return (
    <Panel
      title="⇉ Active green corridor"
      ai
      right={<Badge color={corridor.status === "ACTIVE" ? "#a78bfa" : "#8B95A9"}>{corridor.status}</Badge>}
    >
      {(current !== null || next !== null) && (
        <div className="mb-2 grid grid-cols-3 gap-2 font-mono text-[10px]">
          <div className="rounded border border-[#202938] px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-[#5c6675]">Emergency</div>
            <div className="text-[#F4F7FA]">{corridor.vehicleId !== null ? vehicleLabel(corridor.vehicleId) : `event ${corridor.eventId}`}</div>
          </div>
          <div className="rounded border border-[#22c55e]/40 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-[#5c6675]">Current (green)</div>
            <div className="text-[#34d399]">{current?.junctionId ?? "—"}</div>
          </div>
          <div className="rounded border border-[#fbbf24]/30 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-[#5c6675]">Next</div>
            <div className="text-[#fbbf24]">{next?.junctionId ?? "—"}</div>
          </div>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-1.5 font-mono text-xl ${corridor.status === "ACTIVE" ? "itms-ai-glow" : ""}`} aria-label="Corridor chain">
        <span title="Emergency vehicle">🚑</span>
        {ordered.map((signal) => (
          <motion.span
            key={`${signal.junctionId}-${signal.status}`}
            initial={{ scale: 0.5, opacity: 0.15 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="inline-flex items-center gap-1"
          >
            <span className="text-[#4a5568]" aria-hidden="true">→</span>
            <SignalGlyph status={signal.status} junction={signal.junctionId} />
          </motion.span>
        ))}
        <span className="text-[#4a5568]" aria-hidden="true">→</span>
        <span title="Destination">🏥</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        {ordered.map((signal) => (
          <div key={signal.sequenceIndex} className="flex items-baseline justify-between gap-2 border-b border-[rgba(148,163,190,0.08)] py-1 font-mono text-[10px]">
            <span className="text-[#EEF2F9]">{signal.junctionId}</span>
            <span className="text-[#8B95A9]">
              {signal.status}
              {signal.plannedGreenStartS !== null ? ` ${signal.plannedGreenStartS.toFixed(0)}–${signal.plannedGreenEndS?.toFixed(0)}s` : ""}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SignalGlyph({ status, junction }: { status: string; junction: string }) {
  const [label, title] = (() => {
    switch (status) {
      case "APPLIED": return ["🟢", `Corridor green applied at ${junction}`];
      case "PASSED": return ["🟢", `${junction} passed — normal program restored`];
      case "PENDING": return ["⚪", `${junction} planned (rolling)`];
      case "NOOP": return ["🟢", `${junction}: normal program covers the ETA`];
      case "SKIPPED": return ["🟡", `${junction} skipped by safety constraints`];
      default: return ["⚪", `${junction}: ${status}`];
    }
  })();
  return (
    <span role="img" aria-label={title} title={title}>
      {label}
    </span>
  );
}

/** Priority 5 — AI explainability panel from live system state. */
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
  const activeCorridor = corridors.find((corridor) => corridor.status === "ACTIVE") ?? null;
  const worstPrediction = predictions?.predictions.find((entry) => entry.source === "ml") ?? predictions?.predictions[0] ?? null;
  const forecastLabel =
    worstPrediction !== null
      ? `${worstPrediction.source.toUpperCase()} · ${worstPrediction.horizons.map((h) => h.predictedVehicleCount).join(" → ")} veh`
      : "unavailable";
  const signalsCoordinated =
    activeCorridor !== null
      ? activeCorridor.signals.filter((signal) => signal.status === "APPLIED" || signal.status === "PASSED").length
      : 0;
  return (
    <Panel title="⌖ AI decision" ai right={<Badge color="#a78bfa">{sim?.status ?? "idle"}</Badge>}>
      <div>
        <KeyValue label="Traffic forecast">{forecastLabel}</KeyValue>
        <KeyValue label="Route status">{activeCorridor !== null ? "OPTIMIZED" : "normal"}</KeyValue>
        <KeyValue label="Signals coordinated">{signalsCoordinated > 0 ? `${signalsCoordinated} (corridor ${activeCorridor?.id})` : "0"}</KeyValue>
        <KeyValue label="City congestion">{traffic?.summary.cityLevel ?? "—"}</KeyValue>
        <KeyValue label="Sim time">{sim !== null ? simClock(sim.simTimeSeconds) : "—"}</KeyValue>
      </div>
      {predictions?.predictions.some((entry) => entry.lastError !== null) && (
        <div className="mt-3 rounded-lg border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[#fbbf24]">
          Prediction fallback active (ML unavailable) — deterministic estimate in use. Traffic control unaffected.
        </div>
      )}
    </Panel>
  );
}

/** Priority 4 — compact signals grid. */
export function CompactSignalsPanel({ signals, max = 6 }: { signals: SignalSnapshot[]; max?: number }) {
  return (
    <Panel
      title="◈ Signals"
      right={<Link href="/signals" className="font-mono text-[10px] uppercase tracking-wider text-[#67e8f9]">All →</Link>}
    >
      {signals.length === 0 ? (
        <EmptyState title="No live signals" hint="Start the simulation." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {signals.slice(0, max).map((signal) => {
            const { label, color } = dominantOf(signal.state);
            return (
              <div key={signal.id} className="itms-hover flex items-center justify-between rounded-lg border border-[rgba(148,163,190,0.12)] bg-[rgba(148,163,190,0.04)] px-2.5 py-1.5">
                <span className="font-mono text-[11px] font-semibold text-[#EEF2F9]">{signal.id}</span>
                <StatusDot color={color} label={label} />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function dominantOf(state: string): { label: string; color: string } {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return { label: "GREEN", color: "#34d399" };
  if (yellows > 0 && greens === 0) return { label: "YELLOW", color: "#fbbf24" };
  if (greens > 0) return { label: "GREEN+YEL", color: "#fbbf24" };
  return { label: "RED", color: "#f87171" };
}
