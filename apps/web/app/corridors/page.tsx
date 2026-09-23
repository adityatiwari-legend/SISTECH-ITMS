"use client";

import React from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import { ActionButton, Badge, EmptyState, ErrorState, KeyValue, Panel, DisconnectedBanner, Stat } from "@/components/ui";
import { formatDistance, simClock, vehicleLabel, wallClock } from "@/lib/format";
import type { CorridorDetail } from "@itms/types";

export default function CorridorsPage() {
  const { state, refreshAll } = useItms();
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const corridors = state.corridors;

  const cancel = async (id: number): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.cancelCorridor(id, "Cancelled by operator from the Corridors page.");
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const activate = async (id: number): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.activateCorridor(id);
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = corridors.filter((corridor) => corridor.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#8B95A7]">Green corridors</h1>
        {state.connection === "offline" && <DisconnectedBanner />}
      </header>

      {actionError !== null && <ErrorState title="Action failed" detail={actionError} retry={() => setActionError(null)} />}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Active" value={activeCount} color={activeCount > 0 ? "#8B5CF6" : undefined} />
        <Stat label="Total" value={corridors.length} />
        <Stat label="Signals coordinated" value={corridors.reduce((sum, corridor) => sum + corridor.signals.filter((signal) => signal.status === "APPLIED" || signal.status === "PASSED").length, 0)} />
      </div>

      {state.connection === "offline" ? (
        <Panel><ErrorState title="Backend disconnected" retry={() => void refreshAll()} /></Panel>
      ) : corridors.length === 0 ? (
        <Panel>
          <EmptyState title="No corridors yet" hint="Corridors are created from an active emergency (Emergencies → create, or Simulator → run scenario)." />
        </Panel>
      ) : (
        corridors.map((corridor) => <CorridorCard key={corridor.id} corridor={corridor} busy={busyId === corridor.id} onCancel={() => void cancel(corridor.id)} onActivate={() => void activate(corridor.id)} />)
      )}
    </div>
  );
}

function CorridorCard({ corridor, busy, onCancel, onActivate }: { corridor: CorridorDetail; busy: boolean; onCancel: () => void; onActivate: () => void }) {
  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const canCancel = corridor.status === "ACTIVE" || corridor.status === "REPLANNING";
  const canActivate = corridor.status === "PLANNING" || corridor.status === "VALIDATING";
  return (
    <motion.div layout initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="itms-panel p-3" style={{ borderColor: corridor.status === "ACTIVE" ? "rgba(139,92,246,0.5)" : "#202938" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm font-bold text-[#F4F7FA]">CORRIDOR {corridor.id}</span>
          <Badge color={corridor.status === "ACTIVE" ? "#8B5CF6" : corridor.status === "COMPLETED" ? "#22C55E" : corridor.status === "FAILED" ? "#EF4444" : "#8B95A7"}>{corridor.status}</Badge>
          <span className="font-mono text-[10px] text-[#8B95A7]">{vehicleLabel(corridor.vehicleId ?? `event-${corridor.eventId}`)} · event {corridor.eventId}</span>
        </div>
        <div className="flex gap-2">
          {canActivate && <ActionButton onClick={onActivate} disabled={busy} color="#22C55E">Activate</ActionButton>}
          {canCancel && <ActionButton onClick={onCancel} disabled={busy} color="#EF4444">Cancel</ActionButton>}
        </div>
      </div>

      {/* The real corridor chain */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-lg" aria-label="Corridor chain">
        <span>🚑</span>
        {ordered.map((signal) => (
          <React.Fragment key={signal.sequenceIndex}>
            <span aria-hidden="true" className="text-[#5c6675]">→</span>
            <span
              role="img"
              aria-label={`${signal.junctionId}: ${signal.status}`}
              title={`${signal.junctionId} — ${signal.status}${signal.plannedGreenStartS !== null ? `, window ${signal.plannedGreenStartS.toFixed(0)}–${signal.plannedGreenEndS?.toFixed(0)}s` : ""}${signal.skipReason !== null ? `, ${signal.skipReason}` : ""}`}
            >
              {signal.status === "APPLIED" || signal.status === "NOOP" ? "🟢" : signal.status === "PASSED" ? "🟢" : signal.status === "SKIPPED" ? "🟡" : "⚪"}
            </span>
            <span className="font-mono text-[10px] text-[#8B95A7]">{signal.junctionId}</span>
          </React.Fragment>
        ))}
        <span aria-hidden="true" className="text-[#5c6675]">→</span>
        <span>🏥</span>
      </div>

      <div className="mt-2 grid gap-x-6 md:grid-cols-2">
        <div>
          <KeyValue label="Origin">{corridor.originJunction}</KeyValue>
          <KeyValue label="Destination">{corridor.destinationJunction}</KeyValue>
          <KeyValue label="Junctions">{corridor.junctionCount}</KeyValue>
        </div>
        <div>
          <KeyValue label="Planned">{wallClock(corridor.createdAtIso)}</KeyValue>
          <KeyValue label="Activated">{wallClock(corridor.activatedAtIso)}</KeyValue>
          <KeyValue label="Closed">{wallClock(corridor.completedAtIso ?? corridor.cancelledAtIso ?? corridor.failedAtIso)}</KeyValue>
        </div>
      </div>

      {corridor.signals.some((signal) => signal.skipReason !== null) && (
        <div className="mt-2 rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-1 font-mono text-[10px] text-[#F59E0B]">
          Safety skips: {corridor.signals.filter((signal) => signal.skipReason !== null).map((signal) => `${signal.junctionId} (${signal.skipReason})`).join("; ")}
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-[#38BDF8]">Signal schedule</summary>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          {ordered.map((signal) => (
            <div key={signal.sequenceIndex} className="rounded border border-[#202938] px-2 py-1 font-mono text-[10px]">
              <div className="flex justify-between">
                <span className="text-[#F4F7FA]">{signal.junctionId} <span className="text-[#5c6675]">via {signal.approachSegmentId}</span></span>
                <Badge color={signal.status === "APPLIED" ? "#8B5CF6" : signal.status === "PASSED" ? "#22C55E" : signal.status === "SKIPPED" ? "#F59E0B" : "#5c6675"}>{signal.status}</Badge>
              </div>
              <div className="text-[#8B95A7]">
                ETA {signal.etaSeconds.toFixed(1)}s
                {signal.plannedGreenStartS !== null ? ` · green ${simClock(undefined, signal.plannedGreenStartS)}–${simClock(undefined, signal.plannedGreenEndS ?? 0)} (${formatDistance(0) === "0 m" ? "" : ""}window)` : ""}
                {signal.mode !== "switch" ? ` · ${signal.mode}` : ""}
                {signal.requiresClearance ? " · yellow clearance" : ""}
              </div>
              {signal.corridorState !== null && <div className="truncate text-[9px] text-[#5c6675]">state: {signal.corridorState}</div>}
            </div>
          ))}
        </div>
      </details>
    </motion.div>
  );
}
