"use client";

import React from "react";
import { motion } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, ErrorState, Panel, ActionButton, KeyValue, DisconnectedBanner } from "@/components/ui";
import { formatDistance, formatSpeed, vehicleLabel, wallClock } from "@/lib/format";
import type { CreateEmergencyBody, EmergencyEventDetail, EmergencyPriority, EmergencyType } from "@itms/types";

const TYPES: Array<{ value: EmergencyType; label: string; icon: string }> = [
  { value: "ambulance", label: "Ambulance", icon: "🚑" },
  { value: "fire_engine", label: "Fire engine", icon: "🚒" },
  { value: "police", label: "Police", icon: "🚓" },
];
const PRIORITIES: EmergencyPriority[] = ["critical", "high", "normal"];

export default function EmergenciesPage() {
  const { state, refreshAll } = useItms();
  const [selected, setSelected] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<EmergencyEventDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (selected === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await api.getEmergency(selected);
        if (!cancelled) {
          setDetail(next);
          setDetailError(null);
        }
      } catch (err) {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Detail unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected]);

  // Part 13: ACTIVE emergencies are the primary content; history is separated
  // below and must never dominate the screen.
  const active = state.emergencies.filter((emergency) => emergency.status === "active" || emergency.status === "created");
  const history = state.emergencies
    .filter((emergency) => emergency.status !== "active" && emergency.status !== "created")
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">Emergencies</h1>
          <p className="mt-0.5 text-[11px] text-[#6B7385]">Dispatch, routing and live tracking of emergency vehicles</p>
        </div>
        {state.connection === "offline" && <DisconnectedBanner />}
      </header>

      {state.connection === "offline" && (
        <Panel><ErrorState title="Backend disconnected" retry={() => void refreshAll()} /></Panel>
      )}

      {/* ---------- ACTIVE EMERGENCIES (primary) ---------- */}
      <Panel title={`Active emergencies (${active.length})`}>
        {active.length === 0 ? (
          <EmptyState
            title={state.sim?.status === "running" || state.sim?.status === "paused" ? "No active emergency" : "No active emergency"}
            hint={
              state.sim?.status === "running" || state.sim?.status === "paused"
                ? "Create one below — the vehicle will appear on the live map."
                : "Start the simulation, then create an emergency."
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {active.map((emergency) => {
              return (
                <motion.button
                  key={emergency.id}
                  layout
                  onClick={() => setSelected(emergency.id)}
                  className="itms-panel itms-pulse p-3 text-left"
                  style={{ borderColor: "rgba(255,59,48,0.5)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-[#F4F7FA]">
                      {TYPES.find((type) => type.value === emergency.type)?.icon ?? "🚨"} {vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge color="#FF3B30">{emergency.status.toUpperCase()}</Badge>
                      <Badge color={emergency.priority === "critical" ? "#EF4444" : emergency.priority === "high" ? "#F59E0B" : "#8B95A7"}>{emergency.priority.toUpperCase()}</Badge>
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[10px] text-[#8B95A7]">
                    <span>{emergency.type.replace("_", " ").toUpperCase()}</span>
                    <span className="text-right">{emergency.originJunction} → {emergency.destinationJunction}</span>
                    <span>Speed: {formatSpeed(emergency.live?.speedMps ?? null)}</span>
                    <span className="text-right">{emergency.etas?.find((eta) => eta.isDestination) !== undefined ? `ETA +${emergency.etas.find((eta) => eta.isDestination)!.etaSeconds.toFixed(0)}s` : "…"}</span>
                    <span>Current road: {emergency.live?.roadId ?? "—"}</span>
                    <span className="text-right">Remaining: {formatDistance(emergency.live?.remainingDistanceM ?? null)}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ---------- DETAIL (selected) ---------- */}
      {detail !== null && (
        <Panel title={`Event ${detail.id} — ${vehicleLabel(detail.vehicle?.vehicleId ?? "")}`} right={<ActionButton onClick={() => setSelected(null)} color="#8B95A7">Close</ActionButton>}>
          {detailError !== null && <ErrorState title="Detail error" detail={detailError} />}
          <div className="grid gap-x-6 md:grid-cols-2">
            <div>
              <KeyValue label="Type">{detail.type}</KeyValue>
              <KeyValue label="Priority">{detail.priority}</KeyValue>
              <KeyValue label="Status">{detail.status}</KeyValue>
              <KeyValue label="Created">{wallClock(detail.createdAtIso)}</KeyValue>
              <KeyValue label="Activated">{wallClock(detail.activatedAtIso)}</KeyValue>
              <KeyValue label="Arrived">{wallClock(detail.arrivedAtIso)}</KeyValue>
            </div>
            <div>
              <KeyValue label="Speed">{formatSpeed(detail.live?.speedMps ?? detail.vehicle?.speedMps ?? null)}</KeyValue>
              <KeyValue label="Position">{detail.live !== null ? `(${detail.live.positionX.toFixed(0)}, ${detail.live.positionY.toFixed(0)})` : "—"}</KeyValue>
              <KeyValue label="Route edge">{detail.live !== null ? `${detail.live.roadId} [${detail.live.routeIndex}]` : "—"}</KeyValue>
              <KeyValue label="Remaining">{formatDistance(detail.live?.remainingDistanceM ?? null)}</KeyValue>
            </div>
          </div>

          {detail.etas !== null && detail.etas.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">ETA per upcoming junction (sim clock + offset)</div>
              <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
                {detail.etas.map((eta) => (
                  <div key={eta.junctionId} className={`rounded border px-2 py-1 font-mono text-[11px] ${eta.isDestination ? "border-[#FF3B30]/50 text-[#FF3B30]" : "border-[#202938] text-[#F4F7FA]"}`}>
                    <div>{eta.isDestination ? "🏥 " : "◈ "}{eta.junctionId}</div>
                    <div className="text-[#8B95A7]">+{eta.etaSeconds.toFixed(0)}s · {formatDistance(eta.distanceM)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.route !== null && (
            <div className="mt-3">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">
                Route ({detail.route.algorithm} · {detail.route.edgeCount} segments · {formatDistance(detail.route.totalLengthM)} · est {detail.route.estimatedTravelTimeS.toFixed(0)}s vs free-flow {detail.route.freeFlowTravelTimeS.toFixed(0)}s)
              </div>
              <div className="font-mono text-[11px] text-[#38BDF8]">
                {detail.route.segments.map((segment) => segment.segmentId).join(" → ")}
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ---------- HISTORY (secondary, capped) ---------- */}
      <Panel title={`History (${history.length})`}>
        {history.length === 0 ? (
          <EmptyState title="No completed emergencies yet" hint="Arrived/failed events are listed here." />
        ) : (
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {history.map((emergency) => {
              return (
                <button
                  key={emergency.id}
                  onClick={() => setSelected(emergency.id)}
                  className="itms-panel itms-hover flex items-center justify-between p-2 text-left"
                >
                  <span className="font-mono text-[11px] text-[#F4F7FA]">
                    {TYPES.find((type) => type.value === emergency.type)?.icon ?? "🚨"} {vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[10px] text-[#8B95A7]">
                    <span>{emergency.originJunction}→{emergency.destinationJunction}</span>
                    <Badge color={emergency.status === "arrived" ? "#22C55E" : emergency.status === "failed" ? "#EF4444" : "#8B95A7"}>{emergency.status}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <NewEmergencyForm onCreated={(id) => setSelected(id)} />
    </div>
  );
}

function NewEmergencyForm({ onCreated }: { onCreated: (id: number) => void }) {
  const { state, refreshAll } = useItms();
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const defaulted = React.useRef(false);

  // Junction options from the ACTUAL network's signalized junctions.
  const controlled = React.useMemo(
    () => (state.signals ?? []).map((signal) => signal.id).sort(),
    [state.signals],
  );
  React.useEffect(() => {
    if (defaulted.current || controlled.length === 0) return;
    setOrigin(controlled[0]!);
    setDestination(controlled[controlled.length - 1]!);
    defaulted.current = true;
  }, [controlled]);

  const canSubmit = (state.sim?.status === "running" || state.sim?.status === "paused") && origin !== "" && destination !== "";

  const submit = async (): Promise<void> => {
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

  return (
    <Panel title="New emergency">
      {!canSubmit && (
        <div className="mb-2 rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-1 font-mono text-[10px] text-[#F59E0B]">
          {state.sim?.status === "running" || state.sim?.status === "paused"
            ? "Loading junction options from the SUMO network…"
            : "The simulation must be running (start it on the Simulator page)."}
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Type</span>
          <select value={type} onChange={(event) => setType(event.target.value as EmergencyType)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.icon} {option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Origin</span>
          <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {(controlled.length > 0 ? controlled : origin !== "" ? [origin] : []).map((junction) => <option key={junction} value={junction}>{junction}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Destination</span>
          <select value={destination} onChange={(event) => setDestination(event.target.value)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {(controlled.length > 0 ? controlled : destination !== "" ? [destination] : []).map((junction) => <option key={junction} value={junction}>{junction}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as EmergencyPriority)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {error !== null && <ErrorState title="Creation failed" detail={error} />}
      <div className="mt-2 flex justify-end">
        <ActionButton onClick={() => void submit()} disabled={!canSubmit || submitting} color="#FF3B30">
          {submitting ? "Creating…" : "Create emergency"}
        </ActionButton>
      </div>
    </Panel>
  );
}
