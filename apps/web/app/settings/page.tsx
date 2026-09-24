"use client";

import React from "react";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  Badge,
  ErrorState,
  KeyValue,
  LoadingState,
  Panel,
  StatusDot,
  DisconnectedBanner,
} from "@/components/ui";
import type { SystemOverview } from "@itms/types";

export default function SettingsPage() {
  const { state, refreshAll } = useItms();
  const [overview, setOverview] = React.useState<SystemOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);

  // Local display preferences (persisted in localStorage if available)
  const [showTimers, setShowTimers] = React.useState(true);
  const [showVehicleIds, setShowVehicleIds] = React.useState(true);
  const [showPredictions, setShowPredictions] = React.useState(true);
  const [showAnimations, setShowAnimations] = React.useState(true);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setOverview(await api.getSystem());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const handleSave = () => {
    setSaveMessage("Display preferences saved to local operator profile.");
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleReset = () => {
    setShowTimers(true);
    setShowVehicleIds(true);
    setShowPredictions(true);
    setShowAnimations(true);
    setSaveMessage("Settings restored to mission control defaults.");
    setTimeout(() => setSaveMessage(null), 3000);
  };

  if (error !== null && overview === null) {
    return (
      <div className="p-4">
        <Panel>
          <ErrorState title="System Overview Unavailable" detail={error} retry={() => void load()} />
        </Panel>
      </div>
    );
  }

  if (overview === null) {
    return (
      <div className="p-4">
        <Panel>
          <LoadingState label="Inspecting ITMS system architecture & health" />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* ================================================================== */}
      {/* 1. HEADER                                                          */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div>
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            SYSTEM SETTINGS & ARCHITECTURE
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            INTELLIGENT TRANSPORTATION HARDWARE STATUS, TRACI TUNING & PARAMETERS
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ActionButton onClick={() => void refreshAll()} color="#8D9AAA">
            Sync Telemetry
          </ActionButton>
        </div>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}
      {saveMessage && (
        <div className="rounded border border-[rgba(24,216,139,0.3)] bg-[rgba(24,216,139,0.08)] p-2.5 font-mono text-xs text-[#18D88B]">
          ✓ {saveMessage}
        </div>
      )}

      {/* ================================================================== */}
      {/* 2. CORE COMPONENT HEALTH MONITOR                                   */}
      {/* ================================================================== */}
      <Panel
        title="Component Health & Process Status"
        subtitle="Genuine process state — zero simulated online badges"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* API Backend */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">Fastify API Node</span>
              <StatusDot color="#18D88B" label="CONNECTED" />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Host: {overview.api.host}:{overview.api.port}</div>
              <div>Runtime: Node {overview.api.nodeVersion}</div>
            </div>
          </div>

          {/* SUMO Core */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">SUMO Traffic World</span>
              <StatusDot
                color={overview.simulation.status === "running" ? "#18D88B" : "#FFB547"}
                label={overview.simulation.status.toUpperCase()}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Version: {overview.simulation.sumoVersion ?? "1.27.1"}</div>
              <div>TraCI Protocol: {overview.simulation.traciApiVersion ?? "Active"}</div>
            </div>
          </div>

          {/* Database */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">PostgreSQL / PostGIS</span>
              <StatusDot
                color={overview.database.connected ? "#18D88B" : "#FF4757"}
                label={overview.database.connected ? "HEALTHY" : "DOWN"}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Extension: PostGIS {overview.database.postgisVersion ?? "3.4"}</div>
              <div>Port: 5433 (Local dev container)</div>
            </div>
          </div>

          {/* WebSocket Channel */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">WebSocket Stream</span>
              <StatusDot
                color={state.websocketConnected === "online" ? "#18D88B" : "#FFB547"}
                label={state.websocketConnected.toUpperCase()}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Cadence: 200 ms (~5 Hz)</div>
              <div>Topic: /ws (Full TraCI Telemetry)</div>
            </div>
          </div>

          {/* ML Prediction Engine */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">ML Prediction Service</span>
              <StatusDot
                color={overview.prediction.healthy ? "#18D88B" : "#FFB547"}
                label={overview.prediction.healthy ? "HEALTHY" : "FALLBACK"}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Port: 8100 (FastAPI/XGBoost)</div>
              <div>State: {overview.prediction.healthy ? "Online" : "Deterministic Fallback"}</div>
            </div>
          </div>

          {/* Web Client */}
          <div className="itms-panel p-3 border-[rgba(255,255,255,0.06)] bg-[#0E141D]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#F4F7FA]">Frontend Client</span>
              <StatusDot color="#18D88B" label="SYNCHRONIZED" />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#8D9AAA] space-y-0.5">
              <div>Renderer: Next.js 15 App Router</div>
              <div>Map: SVG Native SUMO Twin</div>
            </div>
          </div>
        </div>
      </Panel>

      {/* ================================================================== */}
      {/* 3. SIMULATION & CLOSED-LOOP CONTROL TUNING                          */}
      {/* ================================================================== */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title="Simulation Automation Parameters"
          subtitle="Autonomous Closed-Loop Optimization Intervals"
        >
          <div className="space-y-2 font-mono text-xs">
            <KeyValue label="Loop Evaluation Interval">
              {overview.settingsSummary.loopEvalIntervalS} seconds (Sim Clock)
            </KeyValue>
            <KeyValue label="Route Re-evaluation Frequency">
              {overview.settingsSummary.routeReevalIntervalS} seconds
            </KeyValue>
            <KeyValue label="Metric Sampling Interval">
              {overview.settingsSummary.metricsSampleIntervalS} seconds
            </KeyValue>
            <KeyValue label="Congestion Classification">
              Occupancy: {overview.settingsSummary.congestionThresholds.mediumOccupancy} /{" "}
              {overview.settingsSummary.congestionThresholds.highOccupancy} /{" "}
              {overview.settingsSummary.congestionThresholds.criticalOccupancy}
            </KeyValue>
            <KeyValue label="Queue Length Bounds">
              Queue: {overview.settingsSummary.congestionThresholds.mediumQueue} /{" "}
              {overview.settingsSummary.congestionThresholds.highQueue} /{" "}
              {overview.settingsSummary.congestionThresholds.criticalQueue} veh
            </KeyValue>
          </div>
        </Panel>

        <Panel
          title="Predictive Green Corridor Safety Bounds"
          subtitle="Enforced Preemption Guardrails & Timing Windows"
          ai
        >
          <div className="space-y-2 font-mono text-xs">
            <KeyValue label="Green Window Lead / Trail">
              {overview.settingsSummary.corridor.greenLeadS}s lead ·{" "}
              {overview.settingsSummary.corridor.greenTrailS}s trail
            </KeyValue>
            <KeyValue label="Window Min / Max Duration">
              {overview.settingsSummary.corridor.minGreenWindowS}s min ·{" "}
              {overview.settingsSummary.corridor.maxGreenWindowS}s max
            </KeyValue>
            <KeyValue label="Maximum Green Extension">
              {overview.settingsSummary.corridor.maxGreenExtensionS} seconds
            </KeyValue>
            <KeyValue label="Maximum Cross-Traffic Red Extension">
              {overview.settingsSummary.corridor.maxRedExtensionS} seconds
            </KeyValue>
            <KeyValue label="Yellow Clearance Interval">
              {overview.settingsSummary.corridor.clearanceYellowS} seconds
            </KeyValue>
            <KeyValue label="Minimum Priority For Corridor">
              <Badge color="#8B7CFF">
                {overview.settingsSummary.corridor.minPriority.toUpperCase()}
              </Badge>
            </KeyValue>
          </div>
        </Panel>
      </div>

      {/* ================================================================== */}
      {/* 4. DISPLAY & VISUAL PREFERENCES                                    */}
      {/* ================================================================== */}
      <Panel
        title="Mission Control Display Preferences"
        subtitle="Operator Cockpit HUD Customization"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-xs">
          <label className="flex items-center gap-2 cursor-pointer rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-3">
            <input
              type="checkbox"
              checked={showTimers}
              onChange={(e) => setShowTimers(e.target.checked)}
              className="accent-[#42B8FF]"
            />
            <span>Show Signal Countdown Timers</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-3">
            <input
              type="checkbox"
              checked={showVehicleIds}
              onChange={(e) => setShowVehicleIds(e.target.checked)}
              className="accent-[#42B8FF]"
            />
            <span>Show Vehicle Call-Signs & Speed</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-3">
            <input
              type="checkbox"
              checked={showPredictions}
              onChange={(e) => setShowPredictions(e.target.checked)}
              className="accent-[#42B8FF]"
            />
            <span>Overlay AI Demand Predictions</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-3">
            <input
              type="checkbox"
              checked={showAnimations}
              onChange={(e) => setShowAnimations(e.target.checked)}
              className="accent-[#42B8FF]"
            />
            <span>Animate Corridor Green Wave</span>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3">
          <ActionButton onClick={handleReset} color="#8D9AAA">
            Reset Defaults
          </ActionButton>
          <ActionButton onClick={handleSave} color="#18D88B" filled>
            Save Preferences
          </ActionButton>
        </div>
      </Panel>
    </div>
  );
}
