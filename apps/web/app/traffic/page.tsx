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
} from "recharts";
import { useItms } from "@/lib/store";
import { SimulationMap } from "@/components/SimulationMap";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  Panel,
  DisconnectedBanner,
  StaleBanner,
} from "@/components/ui";
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
  const [trend, setTrend] = React.useState<TrendPoint[]>([]);

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

  React.useEffect(() => {
    const traffic = state.traffic;
    if (traffic === null || traffic.collectedAtIso === null) return;
    setTrend((points) => {
      const last = points[points.length - 1];
      if (last !== undefined && Math.abs(last.t - traffic.simTimeSeconds) < 0.01) {
        return points;
      }
      const next = [
        ...points,
        {
          t: traffic.simTimeSeconds,
          vehicles: traffic.summary.vehicleCount,
          speed: Math.round(traffic.summary.avgSpeedMps * 3.6 * 10) / 10, // km/h
          queue: traffic.summary.totalQueueLength,
        },
      ];
      if (next.length > 180) next.shift();
      return next;
    });
  }, [state.traffic]);

  const traffic = state.traffic;
  const congested = (traffic?.segments ?? []).filter(
    (segment) => segment.congestion === "HIGH" || segment.congestion === "CRITICAL"
  );

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* ================================================================== */}
      {/* 1. HEADER & STATUS                                                 */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
        <div>
          <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            TRAFFIC INTELLIGENCE
          </h1>
          <p className="font-mono text-[10px] text-[#5E6B7A]">
            CITY-WIDE MACRO DENSITY, BOTTLENECK LOCALIZATION & LINK CONGESTION
          </p>
        </div>

        <div className="flex items-center gap-3">
          {traffic?.stale && state.connection !== "offline" && <StaleBanner />}
          {state.connection === "offline" && <DisconnectedBanner />}
        </div>
      </div>

      {state.connection === "offline" ? (
        <Panel>
          <ErrorState
            title="Backend Disconnected"
            detail="Traffic link state unavailable while disconnected."
            retry={() => void refreshAll()}
          />
        </Panel>
      ) : traffic === null ? (
        <Panel>
          <LoadingState label="Collecting city road network telemetry" />
        </Panel>
      ) : (
        <>
          {/* ============================================================== */}
          {/* 2. TOP KPI ROW                                                 */}
          {/* ============================================================== */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricCard
              label="NETWORK CONGESTION"
              value={traffic.summary.cityLevel}
              color={CONGESTION_COLORS[traffic.summary.cityLevel]}
              sub={`${congested.length} critical bottleneck links`}
            />
            <MetricCard
              label="TOTAL VEHICLES"
              value={traffic.summary.vehicleCount}
              sub="Active in simulation"
              color="#F4F7FA"
            />
            <MetricCard
              label="AVERAGE SPEED"
              value={formatSpeed(traffic.summary.avgSpeedMps)}
              sub="City-wide flow velocity"
              color="#18D88B"
            />
            <MetricCard
              label="TOTAL QUEUE LENGTH"
              value={`${traffic.summary.totalQueueLength} veh`}
              sub="Stopped at signal approaches"
              color={traffic.summary.totalQueueLength > 50 ? "#FFB547" : "#42B8FF"}
            />
          </div>

          {/* ============================================================== */}
          {/* 3. TRAFFIC MAP & LIVE FLOW TREND                               */}
          {/* ============================================================== */}
          <div className="grid min-h-[460px] grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            {/* Traffic Map Viewport */}
            <div className="itms-panel min-h-[420px] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0A0F16] px-4 py-2 font-mono text-xs">
                <span className="font-semibold text-[#F4F7FA]">CONGESTION MAP OVERLAY</span>
                <span className="text-[10px] text-[#8D9AAA]">Real-time per-lane measurements</span>
              </div>
              <div className="relative flex-1 min-h-[380px]">
                <SimulationMap
                  className="absolute inset-0 h-full w-full"
                  highlightTraffic
                  data={{
                    geometry,
                    trafficSegments: traffic.segments,
                    signals: state.signals,
                    vehicles: state.vehicles,
                    emergency: null,
                    corridor: null,
                    simTimeSeconds: state.sim?.simTimeSeconds,
                  }}
                />
              </div>
            </div>

            {/* Live Flow Trend Chart */}
            <div className="flex flex-col gap-3">
              <Panel
                title="Traffic Trend (Live Rolling Window)"
                subtitle="Measured Velocity & Queue Evolution"
              >
                {trend.length < 2 ? (
                  <EmptyState
                    title="Sampling TraCI Telemetry"
                    hint="Start simulation to plot real-time vehicle density and velocity trends."
                  />
                ) : (
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#121A24" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="t"
                          tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }}
                          tickFormatter={(v) => `${Math.round(Number(v))}s`}
                        />
                        <YAxis tick={{ fill: "#8D9AAA", fontSize: 10, fontFamily: "monospace" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0A0F16",
                            borderColor: "rgba(255,255,255,0.1)",
                            fontSize: 11,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                        <Line
                          type="monotone"
                          dataKey="vehicles"
                          name="Vehicles"
                          stroke="#42B8FF"
                          dot={false}
                          strokeWidth={1.5}
                        />
                        <Line
                          type="monotone"
                          dataKey="queue"
                          name="Queue"
                          stroke="#FFB547"
                          dot={false}
                          strokeWidth={1.5}
                        />
                        <Line
                          type="monotone"
                          dataKey="speed"
                          name="Speed (km/h)"
                          stroke="#18D88B"
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>

              {/* Congested Segments Focus */}
              <Panel
                title={`Bottleneck Segments (${congested.length})`}
                subtitle="High & Critical Congestion Links"
              >
                {congested.length === 0 ? (
                  <div className="py-4 text-center font-mono text-xs text-[#18D88B]">
                    ✓ All network links operating at nominal flow speeds.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {congested.map((seg) => (
                      <div
                        key={seg.segmentId}
                        className="flex items-center justify-between rounded border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2 font-mono text-xs"
                      >
                        <div>
                          <div className="font-semibold text-[#F4F7FA]">
                            {seg.fromJunction} → {seg.toJunction}
                          </div>
                          <div className="text-[10px] text-[#5E6B7A]">
                            {seg.vehicleCount} vehicles · Queue: {seg.queueLength}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#8D9AAA]">{formatSpeed(seg.avgSpeedMps)}</span>
                          <Badge color={CONGESTION_COLORS[seg.congestion]}>
                            {CONGESTION_LABELS[seg.congestion]}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>

          {/* ============================================================== */}
          {/* 4. TRAFFIC BY ROAD SEGMENT DATA TABLE                          */}
          {/* ============================================================== */}
          <Panel
            title={`Road Network Segment Inventory (${traffic.segments.length} Links)`}
            subtitle="Full Link-by-Link Velocity, Queue, and Flow Breakdown"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                    <th className="py-2 pr-4">Road Segment</th>
                    <th className="py-2 pr-4">From → To</th>
                    <th className="py-2 pr-4">Vehicles</th>
                    <th className="py-2 pr-4">Mean Velocity</th>
                    <th className="py-2 pr-4">Queue</th>
                    <th className="py-2 pr-4">Hourly Flow</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.segments.map((seg) => (
                    <tr
                      key={seg.segmentId}
                      className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[#0E141D] transition-colors"
                    >
                      <td className="py-2 pr-4 font-semibold text-[#F4F7FA]">{seg.segmentId}</td>
                      <td className="py-2 pr-4 text-[#8D9AAA]">
                        {seg.fromJunction} → {seg.toJunction}
                      </td>
                      <td className="py-2 pr-4 text-[#F4F7FA]">{seg.vehicleCount}</td>
                      <td className="py-2 pr-4 text-[#18D88B]">{formatSpeed(seg.avgSpeedMps)}</td>
                      <td className="py-2 pr-4 text-[#FFB547]">{seg.queueLength}</td>
                      <td className="py-2 pr-4 text-[#8D9AAA]">
                        {seg.flowRatePerHour > 0 ? `${Math.round(seg.flowRatePerHour)} veh/h` : "—"}
                      </td>
                      <td className="py-2">
                        <Badge color={CONGESTION_COLORS[seg.congestion]}>
                          {CONGESTION_LABELS[seg.congestion]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
