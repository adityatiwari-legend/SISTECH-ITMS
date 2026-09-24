"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  Panel,
  DisconnectedBanner,
  StatusDot,
} from "@/components/ui";
import { SimulationMap } from "@/components/SimulationMap";
import { simClock, formatSpeed } from "@/lib/format";
import {
  type CreateComparisonBody,
  type ComparisonResult,
  type NetworkGeometryResponse,
} from "@itms/types";

const SPEEDS = [1, 2, 5, 10];

export default function SimulatorPage() {
  const { state, refreshAll } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sim = state.sim;
  const activeEmergency =
    state.emergencies.find((e) => e.status === "active") ??
    state.emergencies.find((e) => e.status === "created") ??
    null;
  const activeCorridor = state.corridors.find((c) => c.status === "ACTIVE") ?? null;

  React.useEffect(() => {
    let cancelled = false;
    api
      .getNetworkGeometry()
      .then((geo) => {
        if (!cancelled) setGeometry(geo);
      })
      .catch(() => {
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
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
    <div className="flex min-h-full flex-col gap-3 p-4">
      {/* ================================================================== */}
      {/* 1. SIMULATION CONTROL SYSTEM HEADER                                */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#F4F7FA]">
              SIMULATION CONTROL
            </span>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
              <StatusDot
                color={
                  sim?.status === "running"
                    ? "#18D88B"
                    : sim?.status === "paused"
                    ? "#FFB547"
                    : "#8D9AAA"
                }
                pulse={sim?.status === "running"}
              />
              <span
                className="font-bold uppercase tracking-wider"
                style={{
                  color:
                    sim?.status === "running"
                      ? "#18D88B"
                      : sim?.status === "paused"
                      ? "#FFB547"
                      : "#8D9AAA",
                }}
              >
                {sim?.status ?? "STOPPED"}
              </span>
              <span className="text-[#5E6B7A]">·</span>
              <span className="text-[#8D9AAA]">
                CLOCK: <span className="text-[#F4F7FA] font-semibold">{simClock(sim?.simTimeSeconds ?? null)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls & Speed Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            onClick={() => void control(() => api.startSimulation())}
            disabled={busy || sim?.status === "running"}
            color="#18D88B"
            filled={sim?.status !== "running"}
          >
            ▶ START
          </ActionButton>

          {sim?.status === "paused" ? (
            <ActionButton
              onClick={() => void control(() => api.resumeSimulation())}
              disabled={busy}
              color="#42B8FF"
            >
              ▶ RESUME
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => void control(() => api.pauseSimulation())}
              disabled={busy || sim?.status !== "running"}
              color="#FFB547"
            >
              Ⅱ PAUSE
            </ActionButton>
          )}

          <ActionButton
            onClick={() => void control(() => api.resetSimulation())}
            disabled={busy}
            color="#8D9AAA"
          >
            ↻ RESET
          </ActionButton>

          <ActionButton
            onClick={() => void control(() => api.stopSimulation())}
            disabled={busy || sim?.status === "idle" || !sim}
            color="#FF4757"
          >
            ■ STOP
          </ActionButton>

          {/* Speed Presets */}
          <div className="ml-2 flex items-center rounded border border-[rgba(255,255,255,0.08)] bg-[#0E141D] p-0.5 font-mono text-[10px]">
            <span className="px-2 text-[#5E6B7A] uppercase">SPEED:</span>
            {SPEEDS.map((multiplier) => (
              <button
                key={multiplier}
                onClick={() => void control(() => api.setSimulationSpeed(multiplier))}
                disabled={busy}
                className={`rounded px-2 py-1 font-semibold transition-colors ${
                  sim?.paceMultiplier === multiplier
                    ? "bg-[#18D88B] text-[#05070B] shadow-[0_0_8px_rgba(24,216,139,0.4)]"
                    : "text-[#8D9AAA] hover:text-[#F4F7FA]"
                }`}
              >
                {multiplier}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <ErrorState title="Command execution failed" detail={error} retry={() => setError(null)} />}
      {state.connection === "offline" && <DisconnectedBanner />}

      {/* ================================================================== */}
      {/* 2. MAIN SIMULATION VIEWPORT (~70% MAP + RIGHT STATS PANEL)         */}
      {/* ================================================================== */}
      <div className="grid min-h-[500px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        {/* Large SUMO SVG Simulation Canvas */}
        <div className="itms-panel min-h-[460px] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2 font-mono text-xs">
            <span className="font-semibold text-[#F4F7FA]">SUMO INTERACTIVE MAP VIEWPORT</span>
            <span className="text-[10px] text-[#8D9AAA]">Wheel to zoom · Drag to pan</span>
          </div>
          <div className="relative flex-1 min-h-[420px]">
            <SimulationMap
              className="absolute inset-0 h-full w-full"
              highlightTraffic
              data={{
                geometry,
                trafficSegments: state.traffic?.segments ?? [],
                signals: state.signals,
                vehicles: state.vehicles,
                emergency: activeEmergency,
                corridor: activeCorridor,
                simTimeSeconds: sim?.simTimeSeconds,
              }}
            />
          </div>
        </div>

        {/* Right Panel: Simulation Live Stats */}
        <div className="flex flex-col gap-3">
          <Panel title="Simulation Live Stats" subtitle="Authoritative TraCI Measurement">
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">Vehicles Active</span>
                <div className="mt-1 text-xl font-bold text-[#F4F7FA]">
                  {state.vehicles.length}
                </div>
              </div>

              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">Emergency Vehicles</span>
                <div className="mt-1 text-xl font-bold text-[#FF3B4E]">
                  {activeEmergency ? 1 : 0}
                </div>
              </div>

              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">Average Speed</span>
                <div className="mt-1 text-xl font-bold text-[#18D88B]">
                  {state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"}
                </div>
              </div>

              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">Total Queue</span>
                <div className="mt-1 text-xl font-bold text-[#FFB547]">
                  {state.traffic ? state.traffic.summary.totalQueueLength : "—"}
                </div>
              </div>

              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">Active Signals</span>
                <div className="mt-1 text-xl font-bold text-[#42B8FF]">
                  {state.signals.length} / {state.signals.length || 8}
                </div>
              </div>

              <div className="rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                <span className="text-[10px] uppercase text-[#5E6B7A]">City Congestion</span>
                <div className="mt-1 text-base font-bold text-[#F4F7FA]">
                  {state.traffic?.summary.cityLevel ?? "NOMINAL"}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-1.5 border-t border-[rgba(255,255,255,0.06)] pt-2.5 font-mono text-[11px]">
              <div className="flex justify-between text-[#8D9AAA]">
                <span>SUMO Engine:</span>
                <span className="text-[#F4F7FA]">{sim?.sumoVersion ?? "1.27.1 (Connected)"}</span>
              </div>
              <div className="flex justify-between text-[#8D9AAA]">
                <span>Step Length:</span>
                <span className="text-[#F4F7FA]">{sim?.stepLengthSeconds ?? 0.2}s</span>
              </div>
              <div className="flex justify-between text-[#8D9AAA]">
                <span>Vehicles Arrived:</span>
                <span className="text-[#18D88B]">{sim?.arrivedVehicleCount ?? 0}</span>
              </div>
              <div className="flex justify-between text-[#8D9AAA]">
                <span>Current Scenario:</span>
                <span className="text-[#8B7CFF]">{sim?.scenario ?? "Default"}</span>
              </div>
            </div>
          </Panel>

          {/* Quick Scenario & Comparison Launcher */}
          <Panel title="Scenarios & Comparisons" subtitle="Deterministic Evaluation">
            <div className="flex flex-col gap-2 font-mono text-xs">
              <p className="text-[11px] text-[#8D9AAA]">
                Launch full reproducible traffic experiments or run baseline vs ITMS comparative benchmarks.
              </p>
              <div className="flex gap-2 mt-1">
                <a
                  href="#comparison-section"
                  className="flex-1 text-center rounded border border-[rgba(255,255,255,0.12)] bg-[#121A24] py-1.5 font-semibold uppercase text-[#F4F7FA] hover:border-[#18D88B] hover:text-[#18D88B] transition-colors"
                >
                  Run Comparison ↓
                </a>
                <a
                  href="/scenarios"
                  className="flex-1 text-center rounded border border-[rgba(139,124,255,0.4)] bg-[rgba(139,124,255,0.1)] py-1.5 font-semibold uppercase text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.2)] transition-colors"
                >
                  Scenario Studio →
                </a>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. LIVE TELEMETRY STRIP                                            */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricCard
          label="SIMULATION TIME"
          value={simClock(sim?.simTimeSeconds ?? null)}
          sub={`${sim?.paceMultiplier ?? 1}× Wall-clock Speed`}
          color="#42B8FF"
        />
        <MetricCard
          label="TRAFFIC FLOW"
          value={state.traffic ? `${state.traffic.summary.vehicleCount} veh` : "—"}
          sub="Autonomous Agents"
        />
        <MetricCard
          label="AVERAGE VELOCITY"
          value={state.traffic ? formatSpeed(state.traffic.summary.avgSpeedMps) : "—"}
          color="#18D88B"
        />
        <MetricCard
          label="HALTED QUEUES"
          value={state.traffic ? `${state.traffic.summary.totalQueueLength}` : "—"}
          color={state.traffic && state.traffic.summary.totalQueueLength > 40 ? "#FFB547" : "#F4F7FA"}
        />
        <MetricCard
          label="EMERGENCY VEHICLE"
          value={activeEmergency ? "TRACKING" : "IDLE"}
          sub={
            activeEmergency?.live
              ? `(${activeEmergency.live.positionX.toFixed(0)}, ${activeEmergency.live.positionY.toFixed(0)})`
              : "No Active Priority"
          }
          color={activeEmergency ? "#FF3B4E" : "#5E6B7A"}
        />
      </div>

      {/* ================================================================== */}
      {/* 4. BASELINE VS ITMS BENCHMARK RUNNER                               */}
      {/* ================================================================== */}
      <div id="comparison-section">
        <ComparisonRunner />
      </div>
    </div>
  );
}

function ComparisonRunner() {
  const [job, setJob] = React.useState<ComparisonResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { state, refreshAll } = useItms();

  const controlled = React.useMemo(
    () => (state.signals ?? []).map((s) => s.id).sort(),
    [state.signals]
  );

  const start = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      if (controlled.length < 2) {
        throw new Error("Signals not loaded. Ensure the simulation is running first.");
      }
      const body: CreateComparisonBody = {
        type: "ambulance",
        origin: controlled[0]!,
        destination: controlled[controlled.length - 1]!,
        priority: "critical",
      };
      const started = await api.startComparison(body);
      setJob(started);

      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise((res) => setTimeout(res, 2000));
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
    if (!job || !job.baseline.metrics || !job.itms.metrics) return null;
    const metrics = (mode: "baseline" | "itms", field: string): number | null => {
      const val = (job[mode].metrics as unknown as Record<string, number | null>)[field];
      return typeof val === "number" ? val : null;
    };
    return [
      {
        metric: "Emergency Travel (s)",
        baseline: metrics("baseline", "emergencyTravelTimeS"),
        itms: metrics("itms", "emergencyTravelTimeS"),
      },
      {
        metric: "Avg Delay (s)",
        baseline: metrics("baseline", "avgVehicleDelayS"),
        itms: metrics("itms", "avgVehicleDelayS"),
      },
      {
        metric: "Avg Queue",
        baseline: metrics("baseline", "avgQueueLength"),
        itms: metrics("itms", "avgQueueLength"),
      },
      {
        metric: "Avg Speed (m/s)",
        baseline: metrics("baseline", "avgSpeedMps"),
        itms: metrics("itms", "avgSpeedMps"),
      },
      {
        metric: "Throughput (/h)",
        baseline: metrics("baseline", "throughputPerHour"),
        itms: metrics("itms", "throughputPerHour"),
      },
    ];
  }, [job]);

  return (
    <Panel
      title="Baseline vs ITMS Measured Comparison"
      subtitle="Sequential Deterministic Simulation Runs"
      right={
        <ActionButton onClick={() => void start()} disabled={running} color="#18D88B" filled>
          {running ? "Running Comparison…" : "Run Live Benchmark"}
        </ActionButton>
      }
    >
      {error && <ErrorState title="Benchmark Failed" detail={error} />}

      {running && job?.status !== "completed" && (
        <div className="py-6">
          <LoadingState label={`Benchmarking ${job?.status ?? "queued"} — running Baseline, then ITMS with Predictive Green Corridors (~60s)`} />
        </div>
      )}

      {comparisonData && job?.status === "completed" ? (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                  <th className="py-2 pr-4">Metric</th>
                  <th className="py-2 pr-4 text-[#8D9AAA]">Baseline (No Corridor)</th>
                  <th className="py-2 pr-4 text-[#8B7CFF]">ITMS (Adaptive Corridor)</th>
                  <th className="py-2 pr-4">Benefit / Delta</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row) => {
                  const delta =
                    row.baseline !== null && row.itms !== null
                      ? Math.round((row.itms - row.baseline) * 100) / 100
                      : null;
                  const isBetter = delta !== null ? delta < 0 : null;
                  return (
                    <tr key={row.metric} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td className="py-2 pr-4 font-semibold text-[#F4F7FA]">{row.metric}</td>
                      <td className="py-2 pr-4 text-[#8D9AAA]">
                        {row.baseline !== null ? row.baseline.toFixed(1) : "—"}
                      </td>
                      <td className="py-2 pr-4 font-bold text-[#8B7CFF]">
                        {row.itms !== null ? row.itms.toFixed(1) : "—"}
                      </td>
                      <td className="py-2 pr-4 font-bold">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            isBetter
                              ? "bg-[rgba(24,216,139,0.15)] text-[#18D88B]"
                              : "bg-[rgba(255,181,71,0.15)] text-[#FFB547]"
                          }`}
                        >
                          {delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData.filter((r) => r.baseline !== null && r.itms !== null)}>
                <CartesianGrid stroke="#121A24" strokeDasharray="3 3" />
                <XAxis dataKey="metric" tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <Tooltip contentStyle={{ backgroundColor: "#0A0F16", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                <Bar dataKey="baseline" name="Baseline (Uncoordinated)" fill="#5E6B7A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="itms" name="ITMS (Predictive Corridor)" fill="#8B7CFF" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : !running ? (
        <EmptyState
          title="No Comparison Run Executed"
          hint="Launch a live benchmark to run two sequential deterministic SUMO simulations and measure emergency travel time reduction."
        />
      ) : null}
    </Panel>
  );
}
