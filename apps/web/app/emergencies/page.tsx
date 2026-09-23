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

  const emergencies = state.emergencies;

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#8B95A7]">Emergencies</h1>
        {state.connection === "offline" && <DisconnectedBanner />}
      </header>

      {state.connection === "offline" ? (
        <Panel><ErrorState title="Backend disconnected" retry={() => void refreshAll()} /></Panel>
      ) : emergencies.length === 0 ? (
        <Panel>
          <EmptyState title="No emergencies" hint="Create one below — requires a running simulation." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {emergencies.map((emergency) => {
            const destinationEta = emergency.etas?.find((eta) => eta.isDestination) ?? null;
            return (
              <motion.button
                key={emergency.id}
                layout
                onClick={() => setSelected(emergency.id)}
                className={`itms-panel p-3 text-left transition-colors ${
                  emergency.status === "active" || emergency.status === "created" ? "itms-pulse" : ""
                }`}
                style={{
                  borderColor: emergency.status === "active" ? "rgba(255,59,48,0.5)" : "#202938",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-[#F4F7FA]">
                    {TYPES.find((type) => type.value === emergency.type)?.icon ?? "🚨"} {vehicleLabel(emergency.vehicle?.vehicleId ?? `event-${emergency.id}`)}
                  </span>
                  <Badge color={emergency.status === "arrived" ? "#22C55E" : emergency.status === "active" || emergency.status === "created" ? "#FF3B30" : "#8B95A7"}>
                    {emergency.status}
                  </Badge>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[10px] text-[#8B95A7]">
                  <span>{emergency.type.replace("_", " ").toUpperCase()}</span>
                  <span className="text-right uppercase">{emergency.priority}</span>
                  <span>{emergency.originJunction} → {emergency.destinationJunction}</span>
                  <span className="text-right">{destinationEta !== null ? `ETA +${destinationEta.etaSeconds.toFixed(0)}s` : emergency.status === "arrived" ? "arrived" : "…"}</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

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

      <NewEmergencyForm onCreated={(id) => setSelected(id)} />
    </div>
  );
}

function NewEmergencyForm({ onCreated }: { onCreated: (id: number) => void }) {
  const { state, refreshAll } = useItms();
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("W1");
  const [destination, setDestination] = React.useState("E2");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const junctions = ["W1", "W2", "E1", "E2", "S1", "S2", "S3", "N1", "N2", "N3", "I1", "I2", "I3", "I4", "I5", "I6"];

  const canSubmit = state.sim?.status === "running" || state.sim?.status === "paused";

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
          The simulation must be running (start it on the Simulator page).
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
            {junctions.map((junction) => <option key={junction} value={junction}>{junction}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Destination</span>
          <select value={destination} onChange={(event) => setDestination(event.target.value)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {junctions.map((junction) => <option key={junction} value={junction}>{junction}</option>)}
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
