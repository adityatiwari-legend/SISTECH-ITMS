"use client";

import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  Panel,
  Badge,
} from "@/components/ui";
import { formatSeconds, formatSpeed } from "@/lib/format";
import type { AnalyticsResponse } from "@itms/types";

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setAnalytics(await api.getAnalytics());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="p-4">
        <Panel>
          <LoadingState label="Loading performance analytics aggregate" />
        </Panel>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="p-4">
        <Panel>
          <ErrorState title="Analytics Engine Unavailable" detail={error} retry={() => void load()} />
        </Panel>
      </div>
    );
  }

  if (analytics === null || analytics.runsRecorded === 0) {
    return (
      <div className="flex min-h-full flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
          <div>
            <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
              PERFORMANCE ANALYTICS
            </h1>
            <p className="font-mono text-[10px] text-[#5E6B7A]">
              MEASURED SYSTEM EFFICIENCY: BASELINE VS PREDICTIVE GREEN CORRIDOR
            </p>
          </div>
        </div>
        <Panel>
          <EmptyState
            title="No Recorded Simulation Runs Yet"
            hint="Run the Simulator or launch a baseline vs ITMS comparison benchmark. Metrics are compiled automatically upon run completion."
          />
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
            PERFORMANCE ANALYTICS
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            MEASURED SYSTEM BENCHMARKS OVER {analytics.runsRecorded} RECORDED RUNS
          </p>
        </div>
        <Badge color="#42B8FF" solid>
          {analytics.runsRecorded} RUNS COMPILED
        </Badge>
      </div>

      {/* ================================================================== */}
      {/* 2. TOP KPI ROW                                                     */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="EMERGENCY TRIPS"
          value={analytics.emergencyTrips}
          sub={`${analytics.completedEmergencies} Completed`}
          color="#FF3B4E"
        />
        <MetricCard
          label="CORRIDORS CREATED"
          value={analytics.corridorsCreated}
          sub="Preemptive Waves"
          color="#8B7CFF"
        />
        <MetricCard
          label="AVG RESPONSE TIME"
          value={formatSeconds(analytics.avgResponseTimeS)}
          sub="From Dispatch to Arrival"
          color="#18D88B"
        />
        <MetricCard
          label="TIME SAVED / RUN"
          value={analytics.avgTimeSavedS !== null ? formatSeconds(analytics.avgTimeSavedS) : "—"}
          sub="Versus Uncoordinated"
          color="#18D88B"
        />
        <MetricCard
          label="AVG TRAFFIC DELAY"
          value={formatSeconds(analytics.avgTrafficDelayS)}
          sub="Per Civilian Vehicle"
          color="#FFB547"
        />
        <MetricCard
          label="NETWORK FLOW SPEED"
          value={formatSpeed(analytics.avgSpeedMps)}
          sub="Overall City Velocity"
          color="#42B8FF"
        />
      </div>

      {/* ================================================================== */}
      {/* 3. CHARTS GRID                                                     */}
      {/* ================================================================== */}
      <div className="grid min-h-[300px] grid-cols-1 gap-3 xl:grid-cols-2">
        {/* Chart 1: Emergency Travel & Civilian Delay Evolution */}
        <Panel
          title="Emergency Travel Time & Civilian Delay (Per Run)"
          subtitle="Measured travel duration across runs"
        >
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.runs} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#121A24" strokeDasharray="3 3" />
                <XAxis dataKey="runId" tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <Tooltip contentStyle={{ backgroundColor: "#0A0F16", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                <Line
                  type="monotone"
                  dataKey="emergencyTravelTimeS"
                  name="Emergency Travel Time (s)"
                  stroke="#FF3B4E"
                  strokeWidth={2}
                  dot={{ fill: "#FF3B4E", r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="avgVehicleDelayS"
                  name="Civilian Delay (s)"
                  stroke="#FFB547"
                  strokeWidth={1.5}
                  dot={{ fill: "#FFB547", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Chart 2: Queue Length & Signal Changes */}
        <Panel
          title="Halted Queues & Preemption Interventions"
          subtitle="Impact of Corridor Priority on General Intersections"
        >
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.runs} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#121A24" strokeDasharray="3 3" />
                <XAxis dataKey="runId" tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                <Tooltip contentStyle={{ backgroundColor: "#0A0F16", borderColor: "rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                <Bar dataKey="avgQueueLength" name="Avg Queue Length" fill="#FFB547" radius={[3, 3, 0, 0]} />
                <Bar dataKey="signalChangeCount" name="Signal Preemptions" fill="#8B7CFF" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ================================================================== */}
      {/* 4. RUNS TABLE                                                      */}
      {/* ================================================================== */}
      <Panel title="Historical Simulation Runs Audit" subtitle="Full Runs Registry">
        <div className="overflow-x-auto max-h-[300px]">
          <table className="w-full text-left font-mono text-xs">
            <thead className="sticky top-0 bg-[#0A0F16]">
              <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                <th className="py-2 pr-3">Run ID</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Emergency Travel</th>
                <th className="py-2 pr-3">Civilian Delay</th>
                <th className="py-2 pr-3">Mean Queue</th>
                <th className="py-2 pr-3">Mean Speed</th>
                <th className="py-2 pr-3">Throughput</th>
                <th className="py-2">Signal Actions</th>
              </tr>
            </thead>
            <tbody>
              {analytics.runs.map((run) => (
                <tr
                  key={run.runId}
                  className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[#0E141D] transition-colors"
                >
                  <td className="py-2 pr-3 font-semibold text-[#F4F7FA]">#{run.runId}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      color={
                        run.mode === "itms"
                          ? "#8B7CFF"
                          : run.mode === "baseline"
                          ? "#8D9AAA"
                          : "#5E6B7A"
                      }
                    >
                      {run.mode}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-[#FF3B4E]">
                    {run.emergencyTravelTimeS !== null ? `${run.emergencyTravelTimeS.toFixed(1)}s` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[#FFB547]">
                    {run.avgVehicleDelayS !== null ? `${run.avgVehicleDelayS.toFixed(1)}s` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[#F4F7FA]">
                    {run.avgQueueLength !== null ? run.avgQueueLength.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[#18D88B]">
                    {run.avgSpeedMps !== null ? formatSpeed(run.avgSpeedMps) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-[#42B8FF]">
                    {run.throughputPerHour !== null ? `${Math.round(run.throughputPerHour)}/h` : "—"}
                  </td>
                  <td className="py-2 text-[#8D9AAA]">{run.signalChangeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
