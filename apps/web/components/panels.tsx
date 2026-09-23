"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { EmergencyEventDetail, CorridorDetail, PredictionUpdatePayload, TrafficStateResponse, SignalSnapshot } from "@itms/types";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, KeyValue, Panel, StatusDot } from "./ui";
import { formatDistance, formatSpeed, simClock, vehicleLabel } from "@/lib/format";

/** Priority 1: the active emergency. Visually dominant (Design.md §12). */
export function ActiveEmergencyPanel({ emergency }: { emergency: EmergencyEventDetail | null }) {
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
      right={<Badge color="#FF3B30" solid>{emergency.status}</Badge>}
    >
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="itms-pulse rounded border border-[#FF3B30]/30 p-2">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-base font-bold tracking-wide text-[#FF3B30]">{vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">{emergency.type.replace("_", " ")} · {emergency.priority}</span>
        </div>
        <div className="mt-2">
          <KeyValue label="Destination">{emergency.destinationJunction}</KeyValue>
          <KeyValue label="ETA (sim)">
            {destinationEta !== null
              ? `${simClock(undefined, destinationEta.etaSeconds)} (+${destinationEta.etaSeconds.toFixed(0)}s)`
              : "—"}
          </KeyValue>
          <KeyValue label="Remaining">{formatDistance(emergency.live?.remainingDistanceM ?? null)}</KeyValue>
          <KeyValue label="Speed">{formatSpeed(emergency.live?.speedMps ?? emergency.vehicle?.speedMps ?? null)}</KeyValue>
          <KeyValue label="Corridor">
            <CorridorMiniState statusRef={emergency.id} />
          </KeyValue>
          <KeyValue label="Route">{emergency.route !== null ? `${emergency.route.edgeCount} segments · ${formatDistance(emergency.route.totalLengthM)}` : "—"}</KeyValue>
        </div>
        <div className="mt-2 flex gap-2">
          <Link href="/corridors" className="rounded border border-[#8B5CF6] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8B5CF6]">Corridor</Link>
          <Link href="/emergencies" className="rounded border border-[#202938] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Details</Link>
        </div>
      </motion.div>
    </Panel>
  );
}

/** Shows the corridor state inline; the corridors slice supplies the match. */
function CorridorMiniState({ statusRef }: { statusRef: number }) {
  const { state } = useItms();
  const corridor = state.corridors.find((entry) => entry.eventId === statusRef && (entry.status === "ACTIVE" || entry.status === "COMPLETED"));
  if (corridor === undefined) return <span>—</span>;
  return <Badge color={corridor.status === "ACTIVE" ? "#8B5CF6" : "#8B95A7"}>{corridor.status}</Badge>;
}

/** Priority 2: the green corridor chain — real backend state (Design.md §17). */
export function CorridorChainPanel({ corridor }: { corridor: CorridorDetail | null }) {
  if (corridor === null) {
    return (
      <Panel title="Green corridor">
        <EmptyState title="No corridor" hint="Corridors activate automatically with an emergency or from the Corridors page." />
      </Panel>
    );
  }
  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  return (
    <Panel
      title="Green corridor"
      right={<Badge color={corridor.status === "ACTIVE" ? "#8B5CF6" : "#8B95A7"}>{corridor.status}</Badge>}
    >
      <div className="flex flex-wrap items-center gap-1 font-mono text-sm" aria-label="Corridor chain">
        <span title="Emergency vehicle">🚑</span>
        {ordered.map((signal) => (
          <React.Fragment key={signal.sequenceIndex}>
            <motion.span
              key={`${signal.junctionId}-${signal.status}`}
              initial={{ scale: 0.6, opacity: 0.2 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="inline-flex items-center gap-1"
              title={`${signal.junctionId}: ${signal.status}${signal.plannedGreenStartS !== null ? ` window ${signal.plannedGreenStartS?.toFixed(0)}–${signal.plannedGreenEndS?.toFixed(0)}s` : ""}${signal.skipReason !== null ? ` (${signal.skipReason})` : ""}`}
            >
              <span aria-hidden="true">→</span>
              <SignalGlyph status={signal.status} />
            </motion.span>
          </React.Fragment>
        ))}
        <span aria-hidden="true">→</span>
        <span title="Destination">🏥</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3">
        {ordered.map((signal) => (
          <div key={signal.sequenceIndex} className="flex items-baseline justify-between gap-1 border-b border-[#202938]/60 py-0.5 font-mono text-[10px]">
            <span className="text-[#F4F7FA]">{signal.junctionId}</span>
            <span className="text-[#8B95A7]">
              {signal.status}
              {signal.plannedGreenStartS !== null ? ` ${signal.plannedGreenStartS.toFixed(0)}–${signal.plannedGreenEndS?.toFixed(0)}s` : ""}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SignalGlyph({ status }: { status: string }) {
  const [label, title] = (() => {
    switch (status) {
      case "APPLIED": return ["🟢", "Corridor green applied"];
      case "PASSED": return ["🟢", "Passed — normal program restored"];
      case "PENDING": return ["⚪", "Planned (rolling)"];
      case "NOOP": return ["🟢", "Normal program covers the ETA"];
      case "SKIPPED": return ["🟡", "Skipped by safety constraints"];
      default: return ["⚪", status];
    }
  })();
  return (
    <span role="img" aria-label={title} title={`${title} (${label})`}>
      {label}
    </span>
  );
}

/** Priority 5: the AI panel — explainability from real system state. */
export function AiPanel({
  predictions,
  traffic,
  corridors,
  sim,
}: {
  predictions: PredictionUpdatePayload | null;
  traffic: TrafficStateResponse | null;
  corridors: CorridorDetail[];
  sim: { status: string; simTimeSeconds: number } | null;
}) {
  const activeCorridor = corridors.find((corridor) => corridor.status === "ACTIVE") ?? null;
  const worstPrediction = predictions?.predictions.find((entry) => entry.source === "ml") ?? predictions?.predictions[0] ?? null;
  const forecastLabel = worstPrediction !== null ? `${worstPrediction.source} · ${worstPrediction.horizons.map((h) => h.predictedVehicleCount).join("/")} veh` : "unavailable";
  const signalsCoordinated = activeCorridor !== null ? activeCorridor.signals.filter((signal) => signal.status === "APPLIED" || signal.status === "PASSED").length : 0;
  return (
    <Panel title="AI decision" right={<Badge color="#8B5CF6">{sim?.status ?? "idle"}</Badge>}>
      <div>
        <KeyValue label="Traffic forecast">
          {forecastLabel}
        </KeyValue>
        <KeyValue label="Route status">{activeCorridor !== null ? "OPTIMIZED" : "normal"}</KeyValue>
        <KeyValue label="Signals coordinated">{signalsCoordinated > 0 ? `${signalsCoordinated} (corridor ${activeCorridor?.id})` : "0"}</KeyValue>
        <KeyValue label="City congestion">{traffic?.summary.cityLevel ?? "—"}</KeyValue>
        <KeyValue label="Sim time">{sim !== null ? simClock(sim.simTimeSeconds) : "—"}</KeyValue>
      </div>
      {predictions?.predictions.some((entry) => entry.lastError !== null) && (
        <div className="mt-2 rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-1 font-mono text-[10px] text-[#F59E0B]">
          Prediction fallback active (ML unavailable) — deterministic estimate in use.
        </div>
      )}
    </Panel>
  );
}

/** Priority 3/4: compact traffic + signals overview. */
export function CompactSignalsPanel({ signals, max = 6 }: { signals: SignalSnapshot[]; max?: number }) {
  return (
    <Panel title="Signals" right={<Link href="/signals" className="font-mono text-[10px] uppercase text-[#38BDF8]">All</Link>}>
      {signals.length === 0 ? (
        <EmptyState title="No live signals" hint="Start the simulation." />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {signals.slice(0, max).map((signal) => {
            const { label, color } = dominantOf(signal.state);
            return (
              <div key={signal.id} className="flex items-center justify-between rounded border border-[#202938] px-2 py-1">
                <span className="font-mono text-[11px]">{signal.id}</span>
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
  if (greens > 0 && yellows === 0) return { label: "GREEN", color: "#22C55E" };
  if (yellows > 0 && greens === 0) return { label: "YELLOW", color: "#F59E0B" };
  if (greens > 0) return { label: "GREEN+YEL", color: "#F59E0B" };
  return { label: "RED", color: "#EF4444" };
}
