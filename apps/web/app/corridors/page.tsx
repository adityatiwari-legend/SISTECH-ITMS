"use client";

import React from "react";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  ProgressBar,
  DisconnectedBanner,
  Stat,
} from "@/components/ui";
import { simClock, vehicleLabel, wallClock } from "@/lib/format";
import type { CorridorDetail } from "@itms/types";

export default function CorridorsPage() {
  const { state, refreshAll } = useItms();
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const corridors = state.corridors;
  const activeCorridor = corridors.find((c) => c.status === "ACTIVE") ?? null;
  const historyCorridors = corridors.filter((c) => c.status !== "ACTIVE");

  const cancel = async (id: number): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.cancelCorridor(id, "Operator override from Green Corridor control room.");
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

  const activeCount = corridors.filter((c) => c.status === "ACTIVE").length;
  const signalsCoordinated = corridors.reduce(
    (sum, c) =>
      sum +
      c.signals.filter((s) => s.status === "APPLIED" || s.status === "PASSED").length,
    0
  );

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* ================================================================== */}
      {/* 1. HEADER & KPI OVERVIEW                                           */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div>
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            PREDICTIVE GREEN CORRIDOR
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            ADAPTIVE MULTI-INTERSECTION EMERGENCY PRIORITY & WAVE CLEARANCE
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeCorridor && (
            <Badge color="#8B7CFF" solid>
              CORRIDOR #{activeCorridor.id} ACTIVE
            </Badge>
          )}
        </div>
      </div>

      {actionError && <ErrorState title="Corridor Command Failed" detail={actionError} />}
      {state.connection === "offline" && <DisconnectedBanner />}

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="ACTIVE CORRIDORS"
          value={activeCount}
          color={activeCount > 0 ? "#8B7CFF" : undefined}
          sub="Live Priority Waves"
        />
        <Stat
          label="TOTAL CORRIDORS"
          value={corridors.length}
          sub="Executed Missions"
        />
        <Stat
          label="SIGNALS COORDINATED"
          value={signalsCoordinated}
          color="#18D88B"
          sub="Junction Preemptions"
        />
        <Stat
          label="ALGORITHM"
          value="ROLLING A*"
          color="#42B8FF"
          sub="Dynamic TraCI Windows"
        />
      </div>

      {/* ================================================================== */}
      {/* 2. ACTIVE CORRIDOR SHOWCASE (Project USP)                          */}
      {/* ================================================================== */}
      {activeCorridor ? (
        <ActiveCorridorShowcase
          corridor={activeCorridor}
          busy={busyId === activeCorridor.id}
          onCancel={() => void cancel(activeCorridor.id)}
        />
      ) : (
        <Panel title="Active Green Corridor Wave" subtitle="Real-time Multi-junction Lock">
          <EmptyState
            title="No Active Green Corridor"
            hint="Corridors engage automatically when an emergency vehicle is dispatched. You can trigger one from the Emergencies or Simulator page."
          />
        </Panel>
      )}

      {/* ================================================================== */}
      {/* 3. CORRIDOR MISSION HISTORY & ARCHIVE                              */}
      {/* ================================================================== */}
      <Panel
        title={`Corridor Mission History (${historyCorridors.length})`}
        subtitle="Completed and Archived Signal Waves"
      >
        {historyCorridors.length === 0 ? (
          <div className="py-6 text-center font-mono text-xs text-[#5E6B7A]">
            No previous corridor runs recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {historyCorridors.map((c) => (
              <CorridorArchiveCard
                key={c.id}
                corridor={c}
                busy={busyId === c.id}
                onActivate={() => void activate(c.id)}
                onCancel={() => void cancel(c.id)}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ActiveCorridorShowcase({
  corridor,
  busy,
  onCancel,
}: {
  corridor: CorridorDetail;
  busy: boolean;
  onCancel: () => void;
}) {
  const { state } = useItms();
  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const current = ordered.find((s) => s.status === "APPLIED") ?? null;
  const passedCount = ordered.filter((s) => s.status === "PASSED").length;
  const progressPercent = Math.min(
    100,
    Math.round(((passedCount + (current ? 0.5 : 0)) / ordered.length) * 100)
  );

  const activeEmergency = state.emergencies.find((e) => e.id === corridor.eventId);
  const etaSeconds = activeEmergency?.etas?.find((e) => e.isDestination)?.etaSeconds ?? 0;

  return (
    <Panel
      title={`Active Green Corridor #${corridor.id}`}
      subtitle="Dynamic Multi-Intersection Priority Progression"
      ai
      right={
        <div className="flex items-center gap-2">
          <ActionButton onClick={onCancel} disabled={busy} color="#FF4757">
            Abort Corridor
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Top Summary Banner */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 rounded-lg border border-[rgba(139,124,255,0.3)] bg-[rgba(139,124,255,0.06)] p-3 font-mono text-xs">
          <div>
            <span className="text-[10px] uppercase text-[#5E6B7A]">Target Vehicle</span>
            <div className="mt-0.5 text-sm font-bold text-[#FF3B4E]">
              {vehicleLabel(corridor.vehicleId ?? `event-${corridor.eventId}`)}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase text-[#5E6B7A]">Route Progression</span>
            <div className="mt-0.5 text-sm font-bold text-[#8B7CFF]">{progressPercent}%</div>
          </div>
          <div>
            <span className="text-[10px] uppercase text-[#5E6B7A]">Estimated Arrival</span>
            <div className="mt-0.5 text-sm font-bold text-[#18D88B]">
              +{etaSeconds.toFixed(0)}s ({simClock(state.sim?.simTimeSeconds ?? null, etaSeconds)})
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase text-[#5E6B7A]">Origin → Destination</span>
            <div className="mt-0.5 font-semibold text-[#F4F7FA] truncate">
              {corridor.originJunction} → {corridor.destinationJunction}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <ProgressBar progress={progressPercent} color="#8B7CFF" height={6} />
        </div>

        {/* ============================================================== */}
        {/* VISUAL CORRIDOR TIMELINE PROGRESSION                          */}
        {/* ============================================================== */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#070A0F] p-4">
          <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-[#5E6B7A]">
            Green Corridor Wave Progression
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 font-mono">
            {/* Origin Node */}
            <div className="flex flex-col items-center">
              <span className="text-xl">🚑</span>
              <span className="mt-1 text-[10px] font-semibold text-[#8D9AAA]">DISPATCH</span>
              <span className="text-[9px] text-[#5E6B7A]">{corridor.originJunction}</span>
            </div>

            {/* Intermediate Signal Nodes */}
            {ordered.map((signal, index) => {
              const isApplied = signal.status === "APPLIED";
              const isPassed = signal.status === "PASSED";
              const isSkipped = signal.status === "SKIPPED";

              return (
                <React.Fragment key={signal.junctionId}>
                  <div className="flex flex-col items-center flex-1 min-w-[60px]">
                    <div className="flex items-center w-full">
                      <div
                        className={`h-0.5 w-full ${
                          isPassed || isApplied
                            ? "bg-[#18D88B]"
                            : "bg-[rgba(255,255,255,0.1)]"
                        }`}
                      />
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                          isApplied
                            ? "border-[#18D88B] bg-[#18D88B]/20 text-[#18D88B] shadow-[0_0_12px_#18D88B]"
                            : isPassed
                            ? "border-[rgba(255,255,255,0.2)] bg-[#121A24] text-[#8D9AAA]"
                            : isSkipped
                            ? "border-[#FFB547] bg-[#FFB547]/20 text-[#FFB547]"
                            : "border-[rgba(255,255,255,0.1)] bg-[#0E141D] text-[#5E6B7A]"
                        }`}
                      >
                        {isPassed ? "✓" : isApplied ? "🟢" : index + 1}
                      </span>
                      <div
                        className={`h-0.5 w-full ${
                          isPassed ? "bg-[#18D88B]" : "bg-[rgba(255,255,255,0.1)]"
                        }`}
                      />
                    </div>
                    <div className="mt-1.5 text-center">
                      <div className="text-[11px] font-bold text-[#F4F7FA]">
                        {signal.junctionId}
                      </div>
                      <Badge
                        color={
                          isApplied
                            ? "#18D88B"
                            : isPassed
                            ? "#8D9AAA"
                            : isSkipped
                            ? "#FFB547"
                            : "#42B8FF"
                        }
                      >
                        {isApplied ? "CURRENT" : signal.status}
                      </Badge>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* Destination Node */}
            <div className="flex flex-col items-center">
              <span className="text-xl">🏥</span>
              <span className="mt-1 text-[10px] font-semibold text-[#8D9AAA]">FACILITY</span>
              <span className="text-[9px] text-[#5E6B7A]">{corridor.destinationJunction}</span>
            </div>
          </div>
        </div>

        {/* Detailed Intersection Window Schedule */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                <th className="py-2 pr-3">Seq</th>
                <th className="py-2 pr-3">Junction</th>
                <th className="py-2 pr-3">Approach Road</th>
                <th className="py-2 pr-3">Estimated Window</th>
                <th className="py-2 pr-3">Control Mode</th>
                <th className="py-2 pr-3">Signal State</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((sig) => (
                <tr key={sig.sequenceIndex} className="border-b border-[rgba(255,255,255,0.04)]">
                  <td className="py-2 pr-3 text-[#5E6B7A]">{sig.sequenceIndex + 1}</td>
                  <td className="py-2 pr-3 font-bold text-[#F4F7FA]">{sig.junctionId}</td>
                  <td className="py-2 pr-3 text-[#8D9AAA]">{sig.approachSegmentId}</td>
                  <td className="py-2 pr-3 text-[#18D88B]">
                    {sig.plannedGreenStartS !== null
                      ? `${sig.plannedGreenStartS.toFixed(0)}s – ${sig.plannedGreenEndS?.toFixed(0)}s`
                      : "Rolling ETA"}
                  </td>
                  <td className="py-2 pr-3 text-[#8D9AAA] uppercase text-[10px]">{sig.mode}</td>
                  <td className="py-2 pr-3 text-[#42B8FF]">{sig.corridorState ?? "G"}</td>
                  <td className="py-2">
                    <Badge
                      color={
                        sig.status === "APPLIED"
                          ? "#18D88B"
                          : sig.status === "PASSED"
                          ? "#8D9AAA"
                          : sig.status === "SKIPPED"
                          ? "#FFB547"
                          : "#42B8FF"
                      }
                      solid={sig.status === "APPLIED"}
                    >
                      {sig.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function CorridorArchiveCard({
  corridor,
  busy,
  onActivate,
  onCancel,
}: {
  corridor: CorridorDetail;
  busy: boolean;
  onActivate: () => void;
  onCancel: () => void;
}) {
  const ordered = [...corridor.signals].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const canActivate = corridor.status === "PLANNING" || corridor.status === "VALIDATING";
  const canCancel = corridor.status === "ACTIVE" || corridor.status === "REPLANNING";

  return (
    <div className="itms-panel p-3.5 border-[rgba(255,255,255,0.06)] bg-[#0A0F16]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-[#F4F7FA]">
            CORRIDOR #{corridor.id}
          </span>
          <Badge
            color={
              corridor.status === "COMPLETED"
                ? "#18D88B"
                : corridor.status === "FAILED"
                ? "#FF4757"
                : "#8D9AAA"
            }
          >
            {corridor.status}
          </Badge>
          <span className="font-mono text-xs text-[#8D9AAA]">
            {vehicleLabel(corridor.vehicleId ?? `event-${corridor.eventId}`)} · Event #{corridor.eventId}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canActivate && (
            <ActionButton onClick={onActivate} disabled={busy} color="#18D88B">
              Activate
            </ActionButton>
          )}
          {canCancel && (
            <ActionButton onClick={onCancel} disabled={busy} color="#FF4757">
              Cancel
            </ActionButton>
          )}
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-3 font-mono text-xs text-[#8D9AAA]">
        <div>
          Origin → Destination:{" "}
          <span className="text-[#F4F7FA]">
            {corridor.originJunction} → {corridor.destinationJunction}
          </span>
        </div>
        <div>
          Junctions Coordinated:{" "}
          <span className="text-[#42B8FF]">{corridor.junctionCount} Intersections</span>
        </div>
        <div>
          Time Activated:{" "}
          <span className="text-[#F4F7FA]">{wallClock(corridor.activatedAtIso)}</span>
        </div>
      </div>

      {/* Signal chain nodes preview */}
      <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[11px] text-[#5E6B7A]">
        <span>Route:</span>
        {ordered.map((s) => (
          <span key={s.junctionId} className="rounded bg-[#0E141D] px-1.5 py-0.5 text-[#8D9AAA]">
            {s.junctionId} ({s.status})
          </span>
        ))}
      </div>
    </div>
  );
}
