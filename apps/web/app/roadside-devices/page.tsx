"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getJunctionMeta } from "@/lib/naming";
import {
  Panel,
  StatusChip,
  StatusDot,
  EmptyState,
  LoadingState,
} from "@/components/ui";
import type { RoadsideDeviceRecord, DeviceStateSnapshot } from "@itms/types";

type DeviceFilter = "ALL" | "ONLINE" | "ACTIVE" | "OFFLINE";

export default function RoadsideDevicesPage() {
  const [devices, setDevices] = useState<RoadsideDeviceRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, DeviceStateSnapshot>>({});
  const [filter, setFilter] = useState<DeviceFilter>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Poll devices from backend
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const res = await api.getRoadsideDevices();
        if (cancelled) return;
        setDevices(res.devices || []);
        setLoadError(null);
        setLastRefreshed(new Date());

        // For online devices, fetch live state snapshots in parallel
        const onlineDevices = (res.devices || []).filter((d) => d.connected || d.status === "ACTIVE");
        if (onlineDevices.length > 0) {
          const snapshotPromises = onlineDevices.map((d) =>
            api
              .getRoadsideDeviceState(d.deviceId)
              .catch(() => null)
          );
          const results = await Promise.all(snapshotPromises);
          if (!cancelled) {
            const nextSnapshots: Record<string, DeviceStateSnapshot> = {};
            results.forEach((snap) => {
              if (snap?.device?.deviceId) {
                nextSnapshots[snap.device.deviceId] = snap;
              }
            });
            setSnapshots((prev) => ({ ...prev, ...nextSnapshots }));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load roadside devices");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchAll();
    const interval = setInterval(fetchAll, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleResetDevice = async (deviceId: string) => {
    try {
      setResettingId(deviceId);
      const updated = await api.resetRoadsideDevice(deviceId);
      setSnapshots((prev) => ({ ...prev, [deviceId]: updated }));
    } catch {
      // ignore error
    } finally {
      setResettingId(null);
    }
  };

  // Metrics
  const metrics = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.connected).length;
    const offline = total - online;
    const active = devices.filter((d) => {
      const snap = snapshots[d.deviceId];
      const state = snap?.display?.displayState || d.status;
      return state !== "IDLE" && d.connected;
    }).length;
    return { total, online, offline, active };
  }, [devices, snapshots]);

  // Filtered devices
  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      const snap = snapshots[d.deviceId];
      const displayState = snap?.display?.displayState || "IDLE";
      const isActive = displayState !== "IDLE" && d.connected;

      if (filter === "ONLINE") return d.connected;
      if (filter === "OFFLINE") return !d.connected;
      if (filter === "ACTIVE") return isActive;
      return true;
    });
  }, [devices, snapshots, filter]);

  // IoT App Base URL (defaults to localhost:3002 or configurable)
  const iotAppUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:3002`
      : "http://localhost:3002";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#05070B] p-4 lg:p-6 font-mono text-[#F4F7FA]">
      {/* Top Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-[rgba(255,255,255,0.08)] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-[#F4F7FA] uppercase">
              Connected Roadside Priority Displays
            </h1>
            <span className="rounded bg-[rgba(66,184,255,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[#42B8FF] border border-[rgba(66,184,255,0.25)]">
              CRPD IOT MESH
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8D9AAA]">
            Authoritative physical edge hardware attached to traffic signal controllers. Real-time green corridor public advisory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={iotAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[#06b6d4]/40 bg-[#06b6d4]/10 hover:bg-[#06b6d4]/20 px-3.5 py-1.5 text-xs font-semibold text-[#06b6d4] transition shadow-[0_0_12px_rgba(6,182,212,0.15)]"
          >
            <span>📱 Launch IoT Display App</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel className="p-4 border-l-2 border-l-[#42B8FF]">
          <span className="text-[10px] uppercase tracking-wider text-[#8D9AAA]">Total Devices</span>
          <div className="mt-1 text-2xl font-black text-[#F4F7FA]">{metrics.total}</div>
          <span className="text-[10px] text-[#5E6B7A]">Provisioned intersections</span>
        </Panel>

        <Panel className="p-4 border-l-2 border-l-[#18D88B]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#8D9AAA]">Online</span>
            <StatusDot color="#18D88B" pulse={metrics.online > 0} />
          </div>
          <div className="mt-1 text-2xl font-black text-[#18D88B]">{metrics.online}</div>
          <span className="text-[10px] text-[#5E6B7A]">Active WebSocket heartbeats</span>
        </Panel>

        <Panel className="p-4 border-l-2 border-l-[#FF3B4E]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#8D9AAA]">Corridor Active</span>
            <StatusDot color="#FF3B4E" pulse={metrics.active > 0} />
          </div>
          <div className="mt-1 text-2xl font-black text-[#FF3B4E]">{metrics.active}</div>
          <span className="text-[10px] text-[#5E6B7A]">Displaying emergency priority</span>
        </Panel>

        <Panel className="p-4 border-l-2 border-l-[#8D9AAA]">
          <span className="text-[10px] uppercase tracking-wider text-[#8D9AAA]">Offline</span>
          <div className="mt-1 text-2xl font-black text-[#8D9AAA]">{metrics.offline}</div>
          <span className="text-[10px] text-[#5E6B7A]">Standby / unlinked displays</span>
        </Panel>
      </div>

      {/* Filter and Status Bar */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-1">
          {(["ALL", "ONLINE", "ACTIVE", "OFFLINE"] as DeviceFilter[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`rounded px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
                filter === mode
                  ? "bg-[#42B8FF] text-black shadow-[0_0_10px_rgba(66,184,255,0.3)]"
                  : "text-[#8D9AAA] hover:text-[#F4F7FA]"
              }`}
            >
              {mode} ({mode === "ALL" ? metrics.total : mode === "ONLINE" ? metrics.online : mode === "ACTIVE" ? metrics.active : metrics.offline})
            </button>
          ))}
        </div>

        <div className="text-[11px] text-[#5E6B7A] flex items-center gap-2">
          <span>Synced: {lastRefreshed.toLocaleTimeString()}</span>
          <span>·</span>
          <span>Fastify /ws bus</span>
        </div>
      </div>

      {/* Main Grid / Content */}
      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <LoadingState label="Connecting to Roadside Device Mesh..." />
        </div>
      ) : loadError ? (
        <div className="mt-6 rounded-lg border border-[#FF4757]/40 bg-[#FF4757]/10 p-4 text-xs text-[#FF4757]">
          Failed to load devices: {loadError}
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No Roadside Devices Match Filter"
            hint="Adjust filter criteria or provision additional roadside hardware units."
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredDevices.map((device) => {
            const snap = snapshots[device.deviceId];
            const meta = getJunctionMeta(device.signalId);
            const isConnected = device.connected;
            const displayState = snap?.display?.displayState || "IDLE";
            const vehicle = snap?.display?.vehicle;
            const message = snap?.display?.message || "NORMAL TRAFFIC";

            // Visual theme based on display state
            const isEmergencyActive = displayState !== "IDLE" && isConnected;
            const borderColor = !isConnected
              ? "border-[rgba(255,255,255,0.06)]"
              : isEmergencyActive
              ? displayState === "GREEN" || displayState === "PASSING"
                ? "border-[#18D88B]/60 shadow-[0_0_15px_rgba(24,216,139,0.15)]"
                : "border-[#FF3B4E]/60 shadow-[0_0_15px_rgba(255,59,78,0.15)]"
              : "border-[rgba(255,255,255,0.1)]";

            return (
              <Panel
                key={device.deviceId}
                className={`relative flex flex-col justify-between p-4 transition-all duration-200 border ${borderColor} bg-[#0A0F16]`}
              >
                {/* Header */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-black text-[#F4F7FA]">
                          {device.deviceId}
                        </span>
                        <span className="text-[10px] text-[#5E6B7A] rounded bg-[#0E141D] px-1.5 py-0.5 border border-[rgba(255,255,255,0.05)]">
                          {device.deviceType}
                        </span>
                      </div>
                      <h3 className="mt-1 text-xs font-semibold text-[#8D9AAA] line-clamp-1">
                        {meta.name || device.deviceName}
                      </h3>
                      <p className="text-[10px] text-[#5E6B7A]">
                        Signal ID: <span className="text-[#8D9AAA]">{device.signalId}</span>
                      </p>
                    </div>

                    <StatusChip
                      label={isConnected ? "ONLINE" : "OFFLINE"}
                      status={isConnected ? "success" : "neutral"}
                      color={isConnected ? "#18D88B" : "#5E6B7A"}
                      pulse={isConnected}
                    />
                  </div>

                  {/* Display State Badge */}
                  <div className="mt-4 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#05070B] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-[#5E6B7A]">
                        Active State
                      </span>
                      <span
                        className={`text-xs font-black uppercase tracking-wider ${
                          displayState === "GREEN"
                            ? "text-[#18D88B]"
                            : displayState === "PASSING"
                            ? "text-[#06b6d4]"
                            : displayState === "PREPARING" || displayState === "CLEARING"
                            ? "text-[#FFB547]"
                            : displayState === "PREDICT"
                            ? "text-[#8B7CFF]"
                            : "text-[#8D9AAA]"
                        }`}
                      >
                        {displayState}
                      </span>
                    </div>

                    {/* Broadcast Message */}
                    <div className="mt-2 text-xs font-bold text-[#F4F7FA] tracking-wide flex items-center gap-2">
                      <span className="text-sm">
                        {displayState === "GREEN"
                          ? "🟢"
                          : displayState === "PASSING"
                          ? "🚑"
                          : displayState === "CLEARING"
                          ? "🟡"
                          : displayState === "PREPARING"
                          ? "⚠"
                          : "⚪"}
                      </span>
                      <span>{message}</span>
                    </div>

                    {/* Priority Telemetry (if active) */}
                    {vehicle && (
                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[rgba(255,255,255,0.06)] pt-2 text-[10px]">
                        <div>
                          <span className="text-[#5E6B7A] block">VEHICLE</span>
                          <span className="font-bold text-[#FF3B4E] uppercase">
                            {vehicle.type}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#5E6B7A] block">ETA</span>
                          <span className="font-black text-[#18D88B]">
                            {vehicle.etaSeconds}s
                          </span>
                        </div>
                        <div>
                          <span className="text-[#5E6B7A] block">SPEED</span>
                          <span className="font-bold text-[#42B8FF]">
                            {vehicle.speedKmh} km/h
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between gap-2">
                  <a
                    href={`${iotAppUrl}/display?device=${encodeURIComponent(device.deviceId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center py-1.5 px-2 rounded bg-[#0E141D] hover:bg-[#1a2332] text-[11px] font-semibold text-[#42B8FF] border border-[rgba(66,184,255,0.2)] transition"
                  >
                    Open Display ↗
                  </a>

                  <Link
                    href={`/?select=${encodeURIComponent(device.signalId)}`}
                    className="py-1.5 px-3 rounded bg-[#0E141D] hover:bg-[#1a2332] text-[11px] font-semibold text-[#8D9AAA] hover:text-[#F4F7FA] border border-[rgba(255,255,255,0.06)] transition"
                  >
                    View on Map
                  </Link>

                  {isEmergencyActive && (
                    <button
                      onClick={() => handleResetDevice(device.deviceId)}
                      disabled={resettingId === device.deviceId}
                      className="py-1.5 px-2.5 rounded bg-rose-950/30 hover:bg-rose-900/40 text-[10px] font-semibold text-rose-400 border border-rose-800/40 transition disabled:opacity-50"
                      title="Reset Display to Idle"
                    >
                      {resettingId === device.deviceId ? "..." : "Reset"}
                    </button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
