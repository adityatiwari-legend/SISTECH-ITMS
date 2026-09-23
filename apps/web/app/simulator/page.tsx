"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import { ActionButton, EmptyState, ErrorState, LoadingState, Panel, DisconnectedBanner, StatusDot } from "@/components/ui";
import { SimulationMap } from "@/components/SimulationMap";
import { simClock } from "@/lib/format";
import { scenarioForTrafficLevel, type CreateComparisonBody, type EmergencyPriority, type EmergencyType, type TrafficLevel, type ComparisonResult, type NetworkGeometryResponse } from "@itms/types";

const TYPES: Array<{ value: EmergencyType; label: string; icon: string }> = [
  { value: "ambulance", label: "Ambulance", icon: "🚑" },
  { value: "fire_engine", label: "Fire engine", icon: "🚒" },
  { value: "police", label: "Police", icon: "🚓" },
];
const SPEEDS = [1, 2, 5, 10];

export default function SimulatorPage() {
  const { state, refreshAll } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sim = state.sim;
  const activeEmergency =
    state.emergencies.find((emergency) => emergency.status === "active") ??
    state.emergencies.find((emergency) => emergency.status === "created") ??
    null;
  const activeCorridor = state.corridors.find((corridor) => corridor.status === "ACTIVE") ?? null;

  React.useEffect(() => {
    void api.getNetworkGeometry().then(setGeometry).catch(() => setGeometry(null));
  }, []);

  const control = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">Simulator</h1>
          <p className="mt-0.5 text-[11px] text-[#6B7385]">Simulation controls, scenario builder and baseline-vs-ITMS measurement</p>
        </div>
        {state.connection === "offline" && <DisconnectedBanner />}
      </header>

      {error !== null && <ErrorState title="Command failed" detail={error} retry={() => setError(null)} />}

      {/* ---------- SIMULATION CONTROL ---------- */}
      <Panel title="Simulation control">
        {sim === null ? (
          <LoadingState label="Connecting" />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
              <span className="flex items-center gap-2">
                <StatusDot
                  color={sim.status === "running" ? "#34d399" : sim.status === "error" ? "#f87171" : sim.status === "paused" ? "#fbbf24" : "#8B95A9"}
                  label={sim.status.toUpperCase()}
                  pulse={sim.status === "running"}
                />
              </span>
              <span className="text-[#8B95A7]">
                Time: <span className="text-[#F4F7FA]">{simClock(sim.simTimeSeconds)}</span>
              </span>
              <span className="text-[#8B95A7]">
                Speed: <span className="text-[#F4F7FA]">{sim.paceMultiplier}×</span>
              </span>
              <span className="text-[#8B95A7]">
                SUMO: <span className="text-[#F4F7FA]">{sim.sumoVersion !== null ? "CONNECTED" : "—"}</span>
              </span>
              <span className="text-[#8B95A7]">
                Vehicles: <span className="text-[#F4F7FA]">{state.vehicles.length}</span>
              </span>
              <span className="text-[#8B95A7]">
                Arrived: <span className="text-[#F4F7FA]">{sim.arrivedVehicleCount ?? "—"}</span>
              </span>
              {sim.lastError !== null && <span className="text-[#EF4444]">⚠ {sim.lastError}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton onClick={() => void control(() => api.startSimulation())} disabled={busy || sim.status === "running"} color="#22C55E">▶ Start</ActionButton>
              <ActionButton onClick={() => void control(() => api.pauseSimulation())} disabled={busy || sim.status !== "running"} color="#F59E0B">⏸ Pause</ActionButton>
              <ActionButton onClick={() => void control(() => api.resumeSimulation())} disabled={busy || sim.status !== "paused"} color="#38BDF8">Resume</ActionButton>
              <ActionButton onClick={() => void control(() => api.resetSimulation())} disabled={busy} color="#8B95A7">↻ Reset</ActionButton>
              <ActionButton onClick={() => void control(() => api.stopSimulation())} disabled={busy || sim.status === "idle"} color="#EF4444">■ Stop</ActionButton>
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-[#5c6675]">Speed</span>
              {SPEEDS.map((multiplier) => (
                <ActionButton
                  key={multiplier}
                  onClick={() => void control(() => api.setSimulationSpeed(multiplier))}
                  disabled={busy}
                  color={sim.paceMultiplier === multiplier ? "#22C55E" : "#8B95A7"}
                >
                  {multiplier}x
                </ActionButton>
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* ---------- LIVE SIMULATION (PRIMARY) ---------- */}
      <div className="itms-panel min-h-[420px] flex-1 overflow-hidden">
        <SimulationMap
          className="h-full min-h-[400px] w-full"
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

      {/* ---------- LIVE METRICS ---------- */}
      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <MiniMetric label="VEHICLES" value={state.vehicles.length > 0 ? String(state.vehicles.length) : "—"} />
        <MiniMetric label="AVG SPEED" value={state.traffic ? formatSpeedKmh(state.traffic.summary.avgSpeedMps) : "—"} />
        <MiniMetric label="QUEUE" value={state.traffic ? String(state.traffic.summary.totalQueueLength) : "—"} />
        <MiniMetric label="CONGESTION" value={state.traffic ? state.traffic.summary.cityLevel : "—"} color={state.traffic ? congestionColor(state.traffic.summary.cityLevel) : undefined} />
        <MiniMetric label="EMERGENCIES" value={String(activeEmergency !== null ? 1 : 0)} color={activeEmergency !== null ? "#ff453a" : undefined} />
        <MiniMetric label="CORRIDOR" value={activeCorridor !== null ? "ACTIVE" : "NONE"} color={activeCorridor !== null ? "#22c55e" : undefined} />
        <MiniMetric label="SIGNALS" value={state.signals.length > 0 ? String(state.signals.length) : "—"} />
      </div>

      <ScenarioBuilder />
      <ComparisonRunner />
    </div>
  );
}

function formatSpeedKmh(mps: number): string {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function congestionColor(level: string): string {
  if (level === "CRITICAL") return "#f87171";
  if (level === "HIGH") return "#fb923c";
  if (level === "MEDIUM") return "#fbbf24";
  return "#34d399";
}

function MiniMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="itms-panel itms-hover px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-[#5c6675]">{label}</div>
      <div className="mt-0.5 font-mono text-sm leading-tight" style={{ color: color ?? "#EEF2F9" }}>
        {value}
      </div>
    </div>
  );
}

function ScenarioBuilder() {
  const { state, refreshAll } = useItms();
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [trafficLevel, setTrafficLevel] = React.useState<TrafficLevel>("medium");
  const [mode, setMode] = React.useState<"with-itms" | "no-intervention">("with-itms");
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const defaulted = React.useRef(false);

  // Junction options come from the ACTUAL network (no hardcoded grid ids).
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

  const runScenario = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setStatus("Starting simulation…");
    try {
      // 1. Reset with the demand level as the scenario variant.
      const scenario = scenarioForTrafficLevel(trafficLevel);
      await api.resetSimulation(scenario);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (mode === "no-intervention") {
        setStatus("Running WITHOUT ITMS intervention (baseline regime). The emergency is not routed or assisted.");
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await refreshAll();
        return;
      }

      // 2. Create the emergency (ITMS: route + prediction + ETA).
      setStatus("Creating emergency — computing A* route over live traffic…");
      const emergency = await api.createEmergency({ type, origin, destination, priority });
      setStatus(`Event ${emergency.id}: route computed (${emergency.route?.edgeCount ?? "?"} segments). Waiting for vehicle insertion…`);

      // 3. Wait until active, then create the corridor.
      let active = false;
      for (let attempt = 0; attempt < 60 && !active; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const detail = await api.getEmergency(emergency.id);
        active = detail.status === "active";
      }
      if (!active) throw new Error("Emergency vehicle did not activate.");
      setStatus("Vehicle en route — activating green corridor…");
      const corridor = await api.createCorridor({ eventId: emergency.id });
      setStatus(`Corridor ${corridor.id} ACTIVE — watch the map.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel title="Scenario builder">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Emergency type</span>
          <select value={type} onChange={(event) => setType(event.target.value as EmergencyType)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {TYPES.map((option) => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Origin</span>
          <select value={origin} onChange={(event) => setOrigin(event.target.value)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {(controlled.length > 0 ? controlled : [origin]).map((junction) => <option key={junction} value={junction}>{junction}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Destination</span>
          <select value={destination} onChange={(event) => setDestination(event.target.value)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {(controlled.length > 0 ? controlled : [destination]).map((junction) => <option key={junction} value={junction}>{junction}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as EmergencyPriority)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            {["critical", "high", "normal"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Traffic level</span>
          <select value={trafficLevel} onChange={(event) => setTrafficLevel(event.target.value as TrafficLevel)} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B95A7]">Scenario mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as "with-itms" | "no-intervention")} className="itms-panel bg-transparent px-2 py-1.5 font-mono text-xs">
            <option value="with-itms">ITMS full assist</option>
            <option value="no-intervention">No intervention</option>
          </select>
        </label>
      </div>
      {status !== null && (
        <div className="mt-2 rounded border border-[#38BDF8]/40 bg-[#38BDF8]/10 px-2 py-1 font-mono text-[11px] text-[#38BDF8]" role="status">
          {status}
        </div>
      )}
      {error !== null && <ErrorState title="Scenario failed" detail={error} />}
      <div className="mt-2 flex justify-end">
        <ActionButton onClick={() => void runScenario()} disabled={running} color="#8B5CF6">
          {running ? "Running…" : "Run scenario"}
        </ActionButton>
      </div>
    </Panel>
  );
}

function ComparisonRunner() {
  const [job, setJob] = React.useState<ComparisonResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { state, refreshAll } = useItms();

  // Endpoints from the ACTUAL network's signalized junctions (no hardcoded ids).
  const controlled = React.useMemo(
    () => (state.signals ?? []).map((signal) => signal.id).sort(),
    [state.signals],
  );

  const start = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      if (controlled.length < 2) {
        throw new Error("Simulation signals not loaded yet — start the simulation first.");
      }
      const body: CreateComparisonBody = {
        type: "ambulance",
        origin: controlled[0]!,
        destination: controlled[controlled.length - 1]!,
        priority: "critical",
      };
      const started = await api.startComparison(body);
      setJob(started);
      // poll until finished
      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const current = await api.getComparison(started.jobId);
        setJob(current);
        if (current.status === "completed" || current.status === "failed") break;
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setRunning(false);
    }
  };

  const comparisonData = React.useMemo(() => {
    if (job === null || job.baseline.metrics === null || job.itms.metrics === null) return null;
    const metrics = (mode: "baseline" | "itms", field: string): number | null => {
      const value = (job[mode].metrics as unknown as Record<string, number | null>)[field];
      return typeof value === "number" ? value : null;
    };
    return [
      { metric: "Emergency travel (s)", baseline: metrics("baseline", "emergencyTravelTimeS"), itms: metrics("itms", "emergencyTravelTimeS") },
      { metric: "Avg vehicle delay (s)", baseline: metrics("baseline", "avgVehicleDelayS"), itms: metrics("itms", "avgVehicleDelayS") },
      { metric: "Avg queue", baseline: metrics("baseline", "avgQueueLength"), itms: metrics("itms", "avgQueueLength") },
      { metric: "Avg speed (m/s)", baseline: metrics("baseline", "avgSpeedMps"), itms: metrics("itms", "avgSpeedMps") },
      { metric: "Throughput (/h)", baseline: metrics("baseline", "throughputPerHour"), itms: metrics("itms", "throughputPerHour") },
      { metric: "Signal changes", baseline: metrics("baseline", "signalChangeCount"), itms: metrics("itms", "signalChangeCount") },
    ];
  }, [job]);

  return (
    <Panel
      title="Baseline vs ITMS (measured)"
      right={<ActionButton onClick={() => void start()} disabled={running} color="#22C55E">{running ? "Running comparison…" : "Run comparison"}</ActionButton>}
    >
      {error !== null && <ErrorState title="Comparison failed" detail={error} />}
      {running && job?.status !== "completed" && (
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-[#38BDF8]">
          <LoadingState label={`Comparison ${job?.status ?? "queued"} — baseline run, then ITMS run (this takes ~1 min)`} />
        </div>
      )}
      {job !== null && job.status === "failed" && <ErrorState title="Comparison failed" detail={job.error} />}
      {comparisonData !== null && job?.status === "completed" ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[#202938] text-[9px] uppercase tracking-widest text-[#5c6675]">
                  <th className="py-1.5 pr-3">Metric</th>
                  <th className="py-1.5 pr-3 text-[#8B95A7]">Baseline</th>
                  <th className="py-1.5 pr-3 text-[#8B5CF6]">ITMS</th>
                  <th className="py-1.5 pr-3">Δ (itms − baseline)</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row) => {
                  const delta = row.baseline !== null && row.itms !== null ? Math.round((row.itms - row.baseline) * 100) / 100 : null;
                  const better = delta !== null && row.metric !== "Signal changes" ? delta < 0 : null;
                  return (
                    <tr key={row.metric} className="border-b border-[#202938]/50">
                      <td className="py-1.5 pr-3 text-[#F4F7FA]">{row.metric}</td>
                      <td className="py-1.5 pr-3 text-[#8B95A7]">{row.baseline === null ? "—" : row.baseline.toFixed(2)}</td>
                      <td className="py-1.5 pr-3" style={{ color: "#A78BFA" }}>{row.itms === null ? "—" : row.itms.toFixed(2)}</td>
                      <td className="py-1.5 pr-3" style={{ color: delta === null ? "#5c6675" : better === true ? "#22C55E" : delta > 0 ? "#F59E0B" : "#8B95A7" }}>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData.filter((row) => row.baseline !== null && row.itms !== null)}>
                <CartesianGrid stroke="#202938" strokeDasharray="2 4" />
                <XAxis dataKey="metric" tick={{ fill: "#8B95A7", fontSize: 9, fontFamily: "JetBrains Mono" }} interval={0} />
                <YAxis tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ background: "#0F141D", border: "1px solid #202938", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Bar dataKey="baseline" name="Baseline" fill="#8B95A7" radius={[2, 2, 0, 0]} />
                <Bar dataKey="itms" name="ITMS" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 font-mono text-[10px] text-[#5c6675]">
            Runs: baseline #{job.baseline.runId} · ITMS #{job.itms.runId}. Values are measured from the two sequential deterministic simulations.
          </div>
        </>
      ) : running || job === null ? (
        <EmptyState title="No comparison yet" hint="Run a comparison to measure baseline vs ITMS from real simulations." />
      ) : null}
    </Panel>
  );
}
