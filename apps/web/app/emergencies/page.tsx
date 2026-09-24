"use client";

import React from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  Badge,
  EmptyState,
  ErrorState,
  KeyValue,
  Panel,
  ProgressBar,
  DisconnectedBanner,
} from "@/components/ui";
import { formatDistance, formatSpeed, vehicleLabel, wallClock } from "@/lib/format";
import type { CreateEmergencyBody, EmergencyEventDetail, EmergencyPriority, EmergencyType } from "@itms/types";

const TYPES: Array<{ value: EmergencyType; label: string; icon: string }> = [
  { value: "ambulance", label: "Ambulance", icon: "🚑" },
  { value: "fire_engine", label: "Fire Engine", icon: "🚒" },
  { value: "police", label: "Police Patrol", icon: "🚓" },
];

const PRIORITIES: EmergencyPriority[] = ["critical", "high", "normal"];

export default function EmergenciesPage() {
  const { state } = useItms();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<EmergencyEventDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [showDispatch, setShowDispatch] = React.useState(false);

  // Poll detail if selected
  React.useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      try {
        const next = await api.getEmergency(selectedId);
        if (!cancelled) {
          setDetail(next);
          setDetailError(null);
        }
      } catch (err) {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Detail unavailable");
      }
    };
    void loadDetail();
    const timer = setInterval(loadDetail, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);

  const activeEmergencies = state.emergencies.filter(
    (e) => e.status === "active" || e.status === "created"
  );
  const historyEmergencies = state.emergencies.filter(
    (e) => e.status !== "active" && e.status !== "created"
  );

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* ================================================================== */}
      {/* 1. HEADER & ACTION STRIP                                           */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div>
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            EMERGENCY MANAGEMENT
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            LIVE VEHICLE DISPATCH, A* ROUTING & PROACTIVE CORRIDOR RESERVATION
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ActionButton
            onClick={() => setShowDispatch(!showDispatch)}
            color="#FF3B4E"
            filled
          >
            {showDispatch ? "Hide Dispatch Form" : "+ Dispatch Emergency"}
          </ActionButton>
        </div>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}

      {/* Dispatch Form Drawer / Section */}
      {showDispatch && (
        <NewEmergencyDrawer
          onCreated={(id) => {
            setSelectedId(id);
            setShowDispatch(false);
          }}
        />
      )}

      {/* ================================================================== */}
      {/* 2. SECTION 1: ACTIVE EMERGENCIES (Primary Hierarchy)               */}
      {/* ================================================================== */}
      <div className="space-y-2">
        <div className="flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FF3B4E] animate-ping" />
            <span className="font-bold text-[#FF3B4E] uppercase tracking-wider">
              Active Priority Vehicles ({activeEmergencies.length})
            </span>
          </div>
          <span className="text-[10px] text-[#5E6B7A]">Autonomous TraCI Stream</span>
        </div>

        {activeEmergencies.length === 0 ? (
          <Panel>
            <EmptyState
              title="No Active Emergencies in Network"
              hint="All priority vehicles have completed their missions. Dispatch an emergency to clear green corridors."
              action={
                <button
                  onClick={() => setShowDispatch(true)}
                  className="rounded border border-[rgba(255,59,78,0.4)] bg-[rgba(255,59,78,0.12)] px-3 py-1 font-mono text-xs font-semibold text-[#FF3B4E] hover:bg-[rgba(255,59,78,0.2)]"
                >
                  Dispatch Priority Vehicle
                </button>
              }
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {activeEmergencies.map((emg) => {
              const destinationEta = emg.etas?.find((eta) => eta.isDestination) ?? null;
              const totalDist = emg.route?.totalLengthM ?? 1;
              const remDist = emg.live?.remainingDistanceM ?? totalDist;
              const progress = Math.min(100, Math.max(0, Math.round(((totalDist - remDist) / totalDist) * 100)));

              return (
                <div
                  key={emg.id}
                  className="itms-panel itms-hover flex flex-col justify-between p-4 border-[rgba(255,59,78,0.35)] bg-[#0C1019]"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🚑</span>
                        <div>
                          <div className="font-mono text-base font-bold text-[#FF3B4E]">
                            {vehicleLabel(emg.vehicle?.vehicleId ?? `event-${emg.id}`)}
                          </div>
                          <div className="font-mono text-[10px] uppercase text-[#8D9AAA]">
                            {emg.type.replace("_", " ")}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge color="#FF3B4E" solid>
                          ● {emg.status}
                        </Badge>
                        <Badge color={emg.priority === "critical" ? "#FF3B4E" : "#FFB547"}>
                          {emg.priority}
                        </Badge>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between font-mono text-[10px]">
                        <span className="text-[#8D9AAA]">Route Progress</span>
                        <span className="font-bold text-[#F4F7FA]">{progress}%</span>
                      </div>
                      <ProgressBar progress={progress} color="#FF3B4E" height={5} />
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                      <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Origin → Dest</span>
                        <div className="mt-0.5 font-semibold text-[#F4F7FA] truncate">
                          {emg.originJunction} → {emg.destinationJunction}
                        </div>
                      </div>
                      <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">ETA to Destination</span>
                        <div className="mt-0.5 font-bold text-[#18D88B]">
                          {destinationEta ? `+${destinationEta.etaSeconds.toFixed(0)}s` : "Calculating…"}
                        </div>
                      </div>
                      <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Current Velocity</span>
                        <div className="mt-0.5 font-bold text-[#F4F7FA]">
                          {formatSpeed(emg.live?.speedMps ?? null)}
                        </div>
                      </div>
                      <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Distance Remaining</span>
                        <div className="mt-0.5 font-bold text-[#42B8FF]">
                          {formatDistance(emg.live?.remainingDistanceM ?? null)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-3">
                    <Link
                      href="/"
                      className="rounded border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase text-[#F4F7FA] hover:border-[#42B8FF] hover:text-[#42B8FF] transition-colors"
                    >
                      View on Map
                    </Link>
                    <button
                      onClick={() => setSelectedId(selectedId === emg.id ? null : emg.id)}
                      className="rounded border border-[rgba(139,124,255,0.4)] bg-[rgba(139,124,255,0.12)] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.22)] transition-colors"
                    >
                      {selectedId === emg.id ? "Close Details" : "Inspect Route"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Emergency Detailed Inspector */}
      {detail && (
        <Panel
          title={`Emergency Event #${detail.id} — ${vehicleLabel(detail.vehicle?.vehicleId ?? "")}`}
          subtitle="Real-time Waypoint and Corridor Analysis"
          right={
            <ActionButton onClick={() => setSelectedId(null)} color="#8D9AAA">
              Close
            </ActionButton>
          }
        >
          {detailError && <ErrorState title="Detail fetch error" detail={detailError} />}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 font-mono text-xs">
              <KeyValue label="Vehicle ID">{detail.vehicle?.vehicleId ?? "Unassigned"}</KeyValue>
              <KeyValue label="Type">{detail.type}</KeyValue>
              <KeyValue label="Priority">{detail.priority}</KeyValue>
              <KeyValue label="Lifecycle Status">{detail.status}</KeyValue>
              <KeyValue label="Dispatched">{wallClock(detail.createdAtIso)}</KeyValue>
              <KeyValue label="Activated">{wallClock(detail.activatedAtIso)}</KeyValue>
              <KeyValue label="Arrival">{wallClock(detail.arrivedAtIso)}</KeyValue>
            </div>
            <div className="space-y-1 font-mono text-xs">
              <KeyValue label="Live Velocity">{formatSpeed(detail.live?.speedMps ?? null)}</KeyValue>
              <KeyValue label="Position">
                {detail.live ? `(${detail.live.positionX.toFixed(1)}, ${detail.live.positionY.toFixed(1)})` : "—"}
              </KeyValue>
              <KeyValue label="Current Road Link">{detail.live?.roadId ?? "—"}</KeyValue>
              <KeyValue label="Remaining Distance">{formatDistance(detail.live?.remainingDistanceM ?? null)}</KeyValue>
              <KeyValue label="Route Segments">
                {detail.route ? `${detail.route.edgeCount} links (${formatDistance(detail.route.totalLengthM)})` : "—"}
              </KeyValue>
            </div>
          </div>

          {/* Upcoming Junction ETAs */}
          {detail.etas && detail.etas.length > 0 && (
            <div className="mt-4 border-t border-[rgba(255,255,255,0.06)] pt-3">
              <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#5E6B7A]">
                Upcoming Signalized Intersections ETA
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {detail.etas.map((eta) => (
                  <div
                    key={eta.junctionId}
                    className={`rounded border p-2 font-mono text-xs ${
                      eta.isDestination
                        ? "border-[rgba(255,59,78,0.5)] bg-[rgba(255,59,78,0.1)] text-[#FF3B4E]"
                        : "border-[rgba(255,255,255,0.08)] bg-[#0E141D] text-[#F4F7FA]"
                    }`}
                  >
                    <div className="font-bold">
                      {eta.isDestination ? "🏥 " : "◈ "}
                      {eta.junctionId}
                    </div>
                    <div className="text-[11px] text-[#8D9AAA]">
                      +{eta.etaSeconds.toFixed(0)}s · {formatDistance(eta.distanceM)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ================================================================== */}
      {/* 3. SECTION 2: EMERGENCY HISTORY (Secondary Compact Table)          */}
      {/* ================================================================== */}
      <Panel
        title={`Completed Mission History (${historyEmergencies.length})`}
        subtitle="Archived Emergency Runs"
      >
        {historyEmergencies.length === 0 ? (
          <div className="py-6 text-center font-mono text-xs text-[#5E6B7A]">
            No completed emergency runs archived yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                  <th className="py-2 pr-3">Event ID</th>
                  <th className="py-2 pr-3">Vehicle</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Origin → Dest</th>
                  <th className="py-2 pr-3">Priority</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Dispatched</th>
                  <th className="py-2">Arrival</th>
                </tr>
              </thead>
              <tbody>
                {historyEmergencies.map((emg) => (
                  <tr
                    key={emg.id}
                    onClick={() => setSelectedId(emg.id)}
                    className="cursor-pointer border-b border-[rgba(255,255,255,0.04)] hover:bg-[#0E141D] transition-colors"
                  >
                    <td className="py-2 pr-3 font-semibold text-[#F4F7FA]">#{emg.id}</td>
                    <td className="py-2 pr-3 text-[#42B8FF]">
                      {vehicleLabel(emg.vehicle?.vehicleId ?? `event-${emg.id}`)}
                    </td>
                    <td className="py-2 pr-3 text-[#8D9AAA] uppercase text-[10px]">{emg.type}</td>
                    <td className="py-2 pr-3 text-[#F4F7FA]">
                      {emg.originJunction} → {emg.destinationJunction}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge color={emg.priority === "critical" ? "#FF3B4E" : "#FFB547"}>
                        {emg.priority}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge color={emg.status === "arrived" ? "#18D88B" : "#8D9AAA"}>
                        {emg.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-[10px] text-[#5E6B7A]">{wallClock(emg.createdAtIso)}</td>
                    <td className="py-2 text-[10px] text-[#5E6B7A]">
                      {emg.arrivedAtIso ? wallClock(emg.arrivedAtIso) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function NewEmergencyDrawer({ onCreated }: { onCreated: (id: number) => void }) {
  const { state, refreshAll } = useItms();
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Derive junctions from authoritative signals
  const junctions = React.useMemo(
    () => (state.signals ?? []).map((s) => s.id).sort(),
    [state.signals]
  );

  React.useEffect(() => {
    if (junctions.length >= 2 && !origin) {
      setOrigin(junctions[0]!);
      setDestination(junctions[junctions.length - 1]!);
    }
  }, [junctions, origin]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateEmergencyBody = { type, origin, destination, priority };
      const created = await api.createEmergency(body);
      onCreated(created.id);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isRunning = state.sim?.status === "running";

  return (
    <Panel
      title="Dispatch Priority Vehicle"
      subtitle="Instantiate Real-time TraCI Agent"
      emergency
    >
      {!isRunning && (
        <div className="mb-3 rounded border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] p-2.5 font-mono text-xs text-[#FFB547]">
          ⚠ The SUMO simulation must be running to insert vehicles. Start the simulation from the top bar or Simulator page.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Vehicle Unit Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EmergencyType)}
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Origin Intersection</span>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {junctions.map((j) => (
              <option key={j} value={j}>
                Intersection {j}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Destination Facility</span>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {junctions.map((j) => (
              <option key={j} value={j}>
                Intersection {j}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Priority Level</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as EmergencyPriority)}
            className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="mt-3 font-mono text-xs text-[#FF4757]">⚠ {error}</div>}

      <div className="mt-4 flex justify-end">
        <ActionButton
          onClick={() => void submit()}
          disabled={submitting || !isRunning || !origin || !destination}
          color="#FF3B4E"
          filled
        >
          {submitting ? "Dispatching…" : "Engage Emergency Dispatch"}
        </ActionButton>
      </div>
    </Panel>
  );
}
