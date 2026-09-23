"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useItms } from "@/lib/store";
import { CityMap } from "@/components/CityMap";
import { Badge, EmptyState, ErrorState, LoadingState, Panel, Stat, StaleBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { CONGESTION_COLORS, CONGESTION_LABELS, formatSpeed } from "@/lib/format";
import type { NetworkGeometryResponse } from "@itms/types";

interface TrendPoint {
  t: number;
  vehicles: number;
  speed: number;
  queue: number;
}

export default function TrafficPage() {
  const { state, refreshAll } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const trend = React.useRef<TrendPoint[]>([]);
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    void api.getNetworkGeometry().then(setGeometry).catch(() => setGeometry(null));
  }, []);

  // Accumulate the trend from live traffic updates (real samples only).
  React.useEffect(() => {
    const traffic = state.traffic;
    if (traffic === null || traffic.collectedAtIso === null) return;
    const points = trend.current;
    const last = points[points.length - 1];
    if (last !== undefined && Math.abs(last.t - traffic.simTimeSeconds) < 0.01) return;
    points.push({
      t: traffic.simTimeSeconds,
      vehicles: traffic.summary.vehicleCount,
      speed: Math.round(traffic.summary.avgSpeedMps * 100) / 100,
      queue: traffic.summary.totalQueueLength,
    });
    if (points.length > 180) points.shift();
    setTick((value) => value + 1);
  }, [state.traffic]);

  const traffic = state.traffic;
  const congested = (traffic?.segments ?? []).filter((segment) => segment.congestion === "HIGH" || segment.congestion === "CRITICAL");

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#8B95A7]">Traffic</h1>
        {traffic?.stale && state.connection !== "offline" && <StaleBanner />}
        {state.connection === "offline" && <span className="font-mono text-[11px] text-[#EF4444]">Backend disconnected</span>}
      </header>

      {state.connection === "offline" ? (
        <Panel><ErrorState title="Backend disconnected" detail="Showing no data while offline." retry={() => void refreshAll()} /></Panel>
      ) : traffic === null ? (
        <Panel><LoadingState label="Loading traffic state" /></Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Vehicles" value={traffic.summary.vehicleCount} sub="in network" />
            <Stat label="Avg speed" value={formatSpeed(traffic.summary.avgSpeedMps)} sub="city mean" />
            <Stat label="Queue" value={traffic.summary.totalQueueLength} sub="vehicles halted" />
            <Stat
              label="Congestion"
              value={traffic.summary.cityLevel}
              color={CONGESTION_COLORS[traffic.summary.cityLevel]}
              sub={`${congested.length} segments HIGH+`}
            />
            <Stat label="Critical segs" value={traffic.summary.criticalSegments} color={traffic.summary.criticalSegments > 0 ? "#EF4444" : undefined} sub="flow blocked" />
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Traffic map">
              <CityMap
                className="h-[380px] w-full"
                highlightTraffic
                data={{
                  geometry,
                  trafficSegments: traffic.segments,
                  signals: state.signals,
                  vehicles: [],
                  emergency: null,
                  corridor: null,
                }}
              />
            </Panel>

            <div className="flex flex-col gap-2">
              <Panel title="Trend (live samples)">
                {trend.current.length < 2 ? (
                  <EmptyState title="Collecting samples" hint="Start the simulation and keep this page open." />
                ) : (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend.current} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#202938" strokeDasharray="2 4" />
                        <XAxis dataKey="t" tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(value) => `${Math.round(Number(value))}s`} />
                        <YAxis tick={{ fill: "#8B95A7", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                        <Tooltip contentStyle={{ background: "#0F141D", border: "1px solid #202938", fontSize: 11, fontFamily: "JetBrains Mono" }} />
                        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                        <Line type="monotone" dataKey="vehicles" name="Vehicles" stroke="#38BDF8" dot={false} strokeWidth={1.5} />
                        <Line type="monotone" dataKey="queue" name="Queue" stroke="#F59E0B" dot={false} strokeWidth={1.5} />
                        <Line type="monotone" dataKey="speed" name="Speed m/s" stroke="#22C55E" dot={false} strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>

              <Panel title={`Congested segments (${congested.length})`}>
                {congested.length === 0 ? (
                  <EmptyState title="No congested segments" />
                ) : (
                  <ul className="flex flex-col gap-1">
                    {congested.slice(0, 10).map((segment) => (
                      <li key={segment.segmentId} className="flex items-center justify-between rounded border border-[#202938] px-2 py-1 font-mono text-[11px]">
                        <span>
                          {segment.fromJunction} → {segment.toJunction}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-[#8B95A7]">{segment.vehicleCount} veh · {formatSpeed(segment.avgSpeedMps)}</span>
                          <Badge color={CONGESTION_COLORS[segment.congestion]}>{CONGESTION_LABELS[segment.congestion]}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>

          <Panel title="All segments">
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
              {(traffic.segments ?? []).map((segment) => (
                <div key={segment.segmentId} className="flex items-center justify-between rounded border border-[#202938]/70 px-2 py-1 font-mono text-[10px]">
                  <span className="text-[#F4F7FA]">{segment.fromJunction}→{segment.toJunction}</span>
                  <span className="text-[#8B95A7]">{segment.vehicleCount}v {formatSpeed(segment.avgSpeedMps)} q{segment.queueLength} {segment.flowRatePerHour > 0 ? `${Math.round(segment.flowRatePerHour)}/h` : ""}</span>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CONGESTION_COLORS[segment.congestion] }} aria-label={segment.congestion} />
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
