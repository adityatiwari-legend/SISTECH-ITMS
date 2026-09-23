"use client";

import React from "react";
import { api } from "@/lib/api";
import { useItms } from "@/lib/store";
import { CityMap } from "@/components/CityMap";
import { ActiveEmergencyPanel, AiPanel, CompactSignalsPanel, CorridorChainPanel } from "@/components/panels";
  import { DisconnectedBanner, LoadingState, StaleBanner, StatusDot } from "@/components/ui";
import { formatSpeed } from "@/lib/format";
import type { NetworkGeometryResponse } from "@itms/types";

export default function CommandCenterPage() {
  const { state } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [geometryError, setGeometryError] = React.useState<string | null>(null);

  const loadGeometry = React.useCallback(async (): Promise<void> => {
    setGeometryError(null);
    try {
      setGeometry(await api.getNetworkGeometry());
      cacheGeometryRef.current = true;
    } catch (err) {
      setGeometryError(err instanceof Error ? err.message : "Map geometry unavailable.");
    }
  }, []);

  React.useEffect(() => {
    void loadGeometry();
  }, [loadGeometry]);

  const activeEmergency =
    state.emergencies.find((emergency) => emergency.status === "active") ??
    state.emergencies.find((emergency) => emergency.status === "created") ??
    null;
  const activeCorridor = state.corridors.find((corridor) => corridor.status === "ACTIVE") ?? null;

  const mapReady = geometry !== null && geometryError === null && hasGoogleKey();

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* ---------- STATUS CHIPS ROW ---------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[rgba(148,163,190,0.12)] bg-[rgba(13,17,25,0.7)] px-4 py-2.5 font-mono text-[11px] backdrop-blur">
        <span className="font-mono text-[12px] font-black tracking-widest text-[#EEF2F9]">ITMS</span>
        <span className="hidden text-[9px] uppercase tracking-widest text-[#5c6675] md:inline">
          INTELLIGENT TRAFFIC MANAGEMENT SYSTEM
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <StatusDot color={state.systemOnline ? "#34d399" : "#f87171"} label={`SYSTEM ${state.systemOnline ? "ONLINE" : "DEGRADED"}`} pulse={!state.systemOnline} />
          <StatusDot color={state.backendConnected === "online" ? "#34d399" : state.backendConnected === "connecting" ? "#fbbf24" : "#f87171"} label={`BACKEND ${state.backendConnected === "online" ? "CONNECTED" : state.backendConnected === "connecting" ? "…" : "DISCONNECTED"}`} />
          <StatusDot color={state.websocketConnected === "online" ? "#34d399" : state.websocketConnected === "connecting" ? "#fbbf24" : "#f87171"} label={`WEBSOCKET ${state.websocketConnected === "online" ? "CONNECTED" : state.websocketConnected === "connecting" ? "…" : "OFF"}`} />
          <StatusDot color={state.sumoConnected ? "#34d399" : "#8B95A9"} label={`SUMO ${state.sumoConnected ? "CONNECTED" : "IDLE"}`} />
          <StatusDot color={state.sim?.status === "running" ? "#34d399" : state.sim === null ? "#8B95A9" : "#fbbf24"} label={`SIMULATION ${state.sim?.status ?? "—"}`.toUpperCase()} />
          <StatusDot color={mapReady ? "#34d399" : geometryError !== null ? "#f87171" : "#fbbf24"} label={`MAP ${mapReady ? "READY" : geometryError !== null ? "ERROR" : "…"}`} />
        </span>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}
      {state.connection !== "offline" && state.traffic?.stale === true && state.sim?.status === "running" && (
        <StaleBanner label="Traffic data stale — waiting for the next simulation step." />
      )}
      {geometryError !== null && state.connection !== "offline" && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#fbbf24]" role="alert">
          ⚠ Map geometry unavailable: {geometryError}
        </div>
      )}
      {state.lastError !== null && state.connection !== "offline" && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] px-3 py-1.5 font-mono text-[11px] text-[#f87171]" role="alert">
          ⚠ {state.lastError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        {/* ---------- LARGE GOOGLE MAP (~65%) ---------- */}
        <div className="itms-panel min-h-[340px] overflow-hidden">
          <CityMap
            className="h-full min-h-[320px] w-full"
            data={{
              geometry,
              trafficSegments: state.traffic?.segments ?? [],
              signals: state.signals,
              vehicles: state.vehicles,
              emergency: activeEmergency,
              corridor: activeCorridor,
            }}
          />
        </div>

        {/* ---------- RIGHT PANEL STACK ---------- */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
          {state.connection === "offline" ? (
            <div className="itms-panel p-4">
              <LoadingState label="Waiting for backend" />
            </div>
          ) : (
            <>
              <ActiveEmergencyPanel emergency={activeEmergency} sim={state.sim !== null ? { simTimeSeconds: state.sim.simTimeSeconds } : null} />
              <CorridorChainPanel corridor={activeCorridor} />
              <CompactSignalsPanel signals={state.signals} />
              <AiPanel
                predictions={state.predictions}
                traffic={state.traffic}
                corridors={state.corridors}
                sim={state.sim !== null ? { status: state.sim.status, simTimeSeconds: state.sim.simTimeSeconds } : null}
              />
            </>
          )}
        </div>
      </div>

      {/* ---------- BOTTOM METRICS BAR ---------- */}
      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MiniMetric label="TRAFFIC" value={state.traffic ? `${state.traffic.summary.congestedSegments} congested` : "—"} sub={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : undefined} />
        <MiniMetric label="AVG SPEED" value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"} />
        <MiniMetric label="QUEUE" value={state.traffic ? String(state.traffic.summary.totalQueueLength) : "—"} />
        <MiniMetric label="SIGNALS" value={state.signals.length > 0 ? String(state.signals.length) : "—"} />
        <MiniMetric label="CORRIDOR" value={activeCorridor !== null ? "ACTIVE" : "NONE"} color={activeCorridor !== null ? "#a78bfa" : undefined} />
        <MiniMetric label="ETA" value={destinationEtaLabel(activeEmergency, state.sim)} color="#ff453a" />
      </div>
    </div>
  );
}

function hasGoogleKey(): boolean {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "") !== "";
}

const cacheGeometryRef = { current: false };

function destinationEtaLabel(
  emergency: { status: string; etas: { etaSeconds: number; isDestination: boolean }[] | null } | null,
  sim: { simTimeSeconds: number } | null,
): string {
  if (emergency === null || emergency.etas === null) return "—";
  const destination = emergency.etas.find((eta) => eta.isDestination) ?? emergency.etas[emergency.etas.length - 1];
  if (destination === undefined) return "—";
  if (sim !== null) {
    const total = Math.floor(sim.simTimeSeconds + destination.etaSeconds);
    const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return `+${destination.etaSeconds.toFixed(0)}s`;
}

function MiniMetric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="itms-panel itms-hover px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-[#5c6675]">{label}</div>
      <div className="mt-0.5 font-mono text-base leading-tight" style={{ color: color ?? "#EEF2F9" }}>
        {value}
      </div>
      {sub !== undefined && <div className="text-[10px] text-[#6B7385]">{sub}</div>}
    </div>
  );
}
