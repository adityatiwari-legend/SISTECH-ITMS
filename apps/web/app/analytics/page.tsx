"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import { api, ApiError } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, Panel, Stat } from "@/components/ui";
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

  if (loading) return <Panel className="m-3"><LoadingState label="Loading analytics" /></Panel>;
  if (error !== null) return <Panel className="m-3"><ErrorState title="Analytics unavailable" detail={error} retry={() => void load()} /></Panel>;
  if (analytics === null) return <Panel className="m-3"><EmptyState title="No analytics" /></Panel>;

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#8B95A7]">Analytics</h1>
        <span className="font-mono text-[10px] text-[#5c6675]">All values measured from recorded simulation runs</span>
      </header>

      {analytics.runsRecorded === 0 ? (
        <Panel>
          <EmptyState
            title="No recorded runs yet"
            hint="Run the Simulator (or a baseline vs ITMS comparison) — metrics are recorded automatically when runs finish."
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Emergency trips" value={analytics.emergencyTrips} />
            <Stat label="Completed" value={analytics.completedEmergencies} color="#22C55E" />
            <Stat label="Corridors created" value={analytics.corridorsCreated} color="#8B5CF6" />
            <Stat label="Avg response" value={formatSeconds(analytics.avgResponseTimeS)} />
            <Stat label="Avg time saved" value={analytics.avgTimeSavedS !== null ? formatSeconds(analytics.avgTimeSavedS) : "—"} color={analytics.avgTimeSavedS !== null && analytics.avgTimeSavedS > 0 ? "#22C55E" : undefined} sub="per comparison" />
            <Stat label="Avg delay" value={formatSeconds(analytics.avgTrafficDelayS)} />
            <Stat label="Avg speed" value={formatSpeed(analytics.avgSpeedMps)} />
            <Stat label="Signal changes" value={analytics.totalSignalChanges} />
          </div>

          <Panel title="Per-run metrics">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.runs} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="#202938" strokeDasharray="2 4" />
                  <XAxis dataKey="runId" tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Tooltip contentStyle={{ background: "#0F141D", border: "1px solid #202938", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Line type="monotone" dataKey="emergencyTravelTimeS" name="Emergency travel (s)" stroke="#FF3B30" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="avgVehicleDelayS" name="Avg delay (s)" stroke="#F59E0B" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="avgSpeedMps" name="Avg speed (m/s)" stroke="#22C55E" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="throughputPerHour" name="Throughput (/h)" stroke="#38BDF8" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            <Panel title="Queue length & signal changes per run">
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.runs} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid stroke="#202938" strokeDasharray="2 4" />
                    <XAxis dataKey="runId" tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                    <YAxis tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                    <Tooltip contentStyle={{ background: "#0F141D", border: "1px solid #202938", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                    <Bar dataKey="avgQueueLength" name="Avg queue" fill="#F59E0B" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="signalChangeCount" name="Signal changes" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Runs table">
              <div className="max-h-[220px] overflow-y-auto">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead className="sticky top-0 bg-[#0F141D]">
                    <tr className="border-b border-[#202938] text-[9px] uppercase tracking-widest text-[#5c6675]">
                      <th className="py-1 pr-2">Run</th>
                      <th className="py-1 pr-2">Mode</th>
                      <th className="py-1 pr-2">Travel</th>
                      <th className="py-1 pr-2">Delay</th>
                      <th className="py-1 pr-2">Queue</th>
                      <th className="py-1 pr-2">Speed</th>
                      <th className="py-1 pr-2">Thr/h</th>
                      <th className="py-1">Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.runs.map((run) => (
                      <tr key={run.runId} className="border-b border-[#202938]/40">
                        <td className="py-1 pr-2 text-[#F4F7FA]">#{run.runId}</td>
                        <td className="py-1 pr-2" style={{ color: run.mode === "itms" ? "#A78BFA" : run.mode === "baseline" ? "#8B95A7" : "#5c6675" }}>{run.mode}</td>
                        <td className="py-1 pr-2">{run.emergencyTravelTimeS === null ? "—" : `${run.emergencyTravelTimeS.toFixed(0)}s`}</td>
                        <td className="py-1 pr-2">{run.avgVehicleDelayS === null ? "—" : `${run.avgVehicleDelayS.toFixed(1)}s`}</td>
                        <td className="py-1 pr-2">{run.avgQueueLength === null ? "—" : run.avgQueueLength.toFixed(1)}</td>
                        <td className="py-1 pr-2">{run.avgSpeedMps === null ? "—" : formatSpeed(run.avgSpeedMps)}</td>
                        <td className="py-1 pr-2">{run.throughputPerHour === null ? "—" : run.throughputPerHour.toFixed(0)}</td>
                        <td className="py-1">{run.signalChangeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
