"use client";

import React from "react";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  Badge,
  ErrorState,
  Panel,
  DisconnectedBanner,
} from "@/components/ui";
import {
  scenarioForTrafficLevel,
  type EmergencyPriority,
  type EmergencyType,
  type TrafficLevel,
} from "@itms/types";

interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  trafficLevel: TrafficLevel;
  type: EmergencyType;
  priority: EmergencyPriority;
  mode: "with-itms" | "no-intervention";
  badge: string;
  badgeColor: string;
}

const PRESETS: ScenarioPreset[] = [
  {
    id: "normal-flow",
    name: "Normal Traffic Flow",
    description: "Standard morning commuter volume with nominal actuated signal coordination and baseline speeds.",
    trafficLevel: "low",
    type: "ambulance",
    priority: "normal",
    mode: "with-itms",
    badge: "LOW DEMAND",
    badgeColor: "#18D88B",
  },
  {
    id: "rush-hour",
    name: "Peak Rush Hour",
    description: "Dense urban traffic with queue buildup at core intersections. Stress-tests adaptive priority waves.",
    trafficLevel: "high",
    type: "ambulance",
    priority: "critical",
    mode: "with-itms",
    badge: "HEAVY CONGESTION",
    badgeColor: "#FFB547",
  },
  {
    id: "critical-ambulance",
    name: "Critical Medical Priority",
    description: "High-urgency EMS dispatch across congested arterial corridors with proactive signal green holds.",
    trafficLevel: "medium",
    type: "ambulance",
    priority: "critical",
    mode: "with-itms",
    badge: "EMERGENCY FOCUS",
    badgeColor: "#FF3B4E",
  },
  {
    id: "fire-response",
    name: "Heavy Engine Rescue",
    description: "Multi-ton fire engine dispatch requiring extended turning clearance and broad intersection preemption.",
    trafficLevel: "medium",
    type: "fire_engine",
    priority: "critical",
    mode: "with-itms",
    badge: "SPECIAL VEHICLE",
    badgeColor: "#FF3B4E",
  },
  {
    id: "baseline-unassisted",
    name: "Unassisted Baseline Run",
    description: "Simulation without ITMS green corridor intervention. Establishes the uncoordinated control standard.",
    trafficLevel: "medium",
    type: "ambulance",
    priority: "critical",
    mode: "no-intervention",
    badge: "BASELINE REGIME",
    badgeColor: "#8D9AAA",
  },
];

const TYPES: Array<{ value: EmergencyType; label: string; icon: string }> = [
  { value: "ambulance", label: "Ambulance Unit", icon: "🚑" },
  { value: "fire_engine", label: "Fire Engine Unit", icon: "🚒" },
  { value: "police", label: "Police Patrol Unit", icon: "🚓" },
];

export default function ScenariosPage() {
  const { state, refreshAll } = useItms();
  const [selectedPreset, setSelectedPreset] = React.useState<string>("normal-flow");

  // Custom scenario state
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [trafficLevel, setTrafficLevel] = React.useState<TrafficLevel>("medium");
  const [mode, setMode] = React.useState<"with-itms" | "no-intervention">("with-itms");

  const [running, setRunning] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Authoritative junctions from signals
  const controlled = React.useMemo(
    () => (state.signals ?? []).map((s) => s.id).sort(),
    [state.signals]
  );

  React.useEffect(() => {
    if (controlled.length >= 2 && !origin) {
      setOrigin(controlled[0]!);
      setDestination(controlled[controlled.length - 1]!);
    }
  }, [controlled, origin]);

  const loadPreset = (preset: ScenarioPreset) => {
    setSelectedPreset(preset.id);
    setType(preset.type);
    setPriority(preset.priority);
    setTrafficLevel(preset.trafficLevel);
    setMode(preset.mode);
    setStatusMessage(`Loaded configuration: ${preset.name}`);
  };

  const executeScenario = async () => {
    setRunning(true);
    setError(null);
    setStatusMessage("Initializing SUMO network with scenario demand variant…");

    try {
      // 1. Reset simulation with designated demand level
      const scenarioVariant = scenarioForTrafficLevel(trafficLevel);
      await api.resetSimulation(scenarioVariant);
      await new Promise((r) => setTimeout(r, 1500));

      if (mode === "no-intervention") {
        setStatusMessage("✓ Scenario started in Unassisted Baseline Mode (No Corridor).");
        await refreshAll();
        return;
      }

      // 2. Compute emergency route over live traffic
      setStatusMessage("Dispatching emergency vehicle & calculating A* route…");
      const emergency = await api.createEmergency({
        type,
        origin: origin || controlled[0]!,
        destination: destination || controlled[controlled.length - 1]!,
        priority,
      });

      // 3. Wait for insertion and trigger predictive corridor
      setStatusMessage(`Vehicle #${emergency.id} inserted. Activating predictive green corridor…`);
      let active = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const check = await api.getEmergency(emergency.id);
        if (check.status === "active") {
          active = true;
          break;
        }
      }

      if (!active) {
        throw new Error("Vehicle insertion took longer than expected. Simulation is running.");
      }

      const corridor = await api.createCorridor({ eventId: emergency.id });
      setStatusMessage(`✓ Green Corridor #${corridor.id} ACTIVE. Autonomous wave initiated!`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      setStatusMessage(null);
    } finally {
      setRunning(false);
    }
  };

  const resetAll = async () => {
    setRunning(true);
    try {
      await api.resetSimulation();
      setStatusMessage("Simulation reset to default configuration.");
      await refreshAll();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* ================================================================== */}
      {/* 1. HEADER                                                          */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div>
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            SCENARIO STUDIO & SIMULATION BUILDER
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            CONFIGURE REPRODUCIBLE TRAFFIC STRESS-TESTS, EMERGENCY MISSIONS & BENCHMARKS
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ActionButton onClick={() => void resetAll()} disabled={running} color="#8D9AAA">
            ↻ Reset Simulation
          </ActionButton>
        </div>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}
      {error && <ErrorState title="Scenario Execution Error" detail={error} />}

      {statusMessage && (
        <div className="rounded border border-[rgba(66,184,255,0.3)] bg-[rgba(66,184,255,0.08)] p-2.5 font-mono text-xs text-[#42B8FF]">
          ℹ {statusMessage}
        </div>
      )}

      {/* ================================================================== */}
      {/* 2. PRESET SCENARIO CARDS                                           */}
      {/* ================================================================== */}
      <div>
        <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#5E6B7A]">
          Standardized Reproducible Presets
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PRESETS.map((preset) => {
            const isSelected = selectedPreset === preset.id;
            return (
              <div
                key={preset.id}
                onClick={() => loadPreset(preset)}
                className={`itms-panel itms-hover cursor-pointer p-3.5 transition-all flex flex-col justify-between ${
                  isSelected ? "border-[#42B8FF] bg-[#121A24] shadow-[0_0_15px_rgba(66,184,255,0.2)]" : ""
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <Badge color={preset.badgeColor}>{preset.badge}</Badge>
                    {isSelected && (
                      <span className="font-mono text-[9px] font-bold text-[#42B8FF]">SELECTED</span>
                    )}
                  </div>
                  <div className="mt-2 font-mono text-sm font-bold text-[#F4F7FA]">
                    {preset.name}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#8D9AAA]">
                    {preset.description}
                  </p>
                </div>

                <div className="mt-3 border-t border-[rgba(255,255,255,0.06)] pt-2 font-mono text-[10px] text-[#5E6B7A]">
                  {preset.mode === "with-itms" ? "✓ Corridor Enabled" : "✕ Baseline Only"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. CUSTOM SCENARIO CONFIGURATOR                                    */}
      {/* ================================================================== */}
      <Panel
        title="Custom Scenario Parameters"
        subtitle="Fine-tune network demand, vehicle class, and corridor intervention mode"
        right={
          <ActionButton
            onClick={() => void executeScenario()}
            disabled={running}
            color="#18D88B"
            filled
          >
            {running ? "Executing Scenario…" : "▶ Launch Scenario"}
          </ActionButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 font-mono text-xs">
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
              {controlled.map((j) => (
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
              {controlled.map((j) => (
                <option key={j} value={j}>
                  Intersection {j}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[#5E6B7A]">Civilian Traffic Demand</span>
            <select
              value={trafficLevel}
              onChange={(e) => setTrafficLevel(e.target.value as TrafficLevel)}
              className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
            >
              <option value="low">Low Density (Fluid Free-Flow)</option>
              <option value="medium">Medium Density (Moderate Queues)</option>
              <option value="high">High Density (Peak Congestion)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[#5E6B7A]">Mission Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as EmergencyPriority)}
              className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
            >
              <option value="critical">CRITICAL (Instant Preemption)</option>
              <option value="high">HIGH (Rolling Window)</option>
              <option value="normal">NORMAL (Actuated Hold)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[#5E6B7A]">Optimization Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "with-itms" | "no-intervention")}
              className="rounded border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
            >
              <option value="with-itms">ITMS Autonomous Green Corridor</option>
              <option value="no-intervention">Unassisted Baseline (No Corridor)</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-3 font-mono text-[11px] text-[#8D9AAA]">
          <span>
            Target: {origin || "—"} → {destination || "—"} · {trafficLevel.toUpperCase()} Demand
          </span>
          <ActionButton
            onClick={() => void executeScenario()}
            disabled={running}
            color="#18D88B"
            filled
          >
            {running ? "Configuring SUMO Twin…" : "▶ Execute Scenario"}
          </ActionButton>
        </div>
      </Panel>
    </div>
  );
}
