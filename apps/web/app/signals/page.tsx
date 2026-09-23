"use client";

import React from "react";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, ErrorState, LoadingState, Panel, StatusDot, DisconnectedBanner } from "@/components/ui";
import { signalDominant } from "@/lib/format";

interface CorridorAssociation {
  corridorId: number;
  status: string;
}

export default function SignalsPage() {
  const { state, refreshAll } = useItms();
  const [corridorBySignal, setCorridorBySignal] = React.useState<Map<string, CorridorAssociation>>(new Map());
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const corridors = await api_getCorridors();
        if (cancelled) return;
        const map = new Map<string, CorridorAssociation>();
        for (const corridor of corridors) {
          if (corridor.status !== "ACTIVE" && corridor.status !== "REPLANNING" && corridor.status !== "PLANNING") continue;
          for (const signal of corridor.signals) {
            if (signal.status === "APPLIED" || signal.status === "PENDING") {
              map.set(signal.junctionId, { corridorId: corridor.id, status: signal.status });
            }
          }
        }
        setCorridorBySignal(map);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Corridor association unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const signals = state.signals;

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">Signals</h1>
          <p className="mt-0.5 text-[11px] text-[#6B7385]">Every signalized junction with live phase, timing, queue and corridor mode</p>
        </div>
        {state.connection === "offline" && <DisconnectedBanner />}
      </header>

      {state.connection === "offline" ? (
        <Panel><ErrorState title="Backend disconnected" retry={() => void refreshAll()} /></Panel>
      ) : state.sim === null ? (
        <Panel><LoadingState label="Loading signals" /></Panel>
      ) : signals.length === 0 ? (
        <Panel>
          <EmptyState title="No live signals" hint="Signals appear when the simulation is running." />
        </Panel>
      ) : (
        <Panel title={`${signals.length} signals`}>
          {loadError !== null && <div className="mb-2 font-mono text-[10px] text-[#F59E0B]">⚠ {loadError}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[#202938] text-[9px] uppercase tracking-widest text-[#5c6675]">
                  <th className="py-1.5 pr-3">Signal</th>
                  <th className="py-1.5 pr-3">Location</th>
                  <th className="py-1.5 pr-3">State</th>
                  <th className="py-1.5 pr-3">Remaining</th>
                  <th className="py-1.5 pr-3">Queue</th>
                  <th className="py-1.5 pr-3">Mode</th>
                  <th className="py-1.5 pr-3">Emergency</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal) => {
                  const dominant = signalDominant(signal.state);
                  const corridor = corridorBySignal.get(signal.id) ?? null;
                  return (
                    <tr key={signal.id} className="border-b border-[#202938]/50">
                      <td className="py-1.5 pr-3 font-semibold text-[#F4F7FA]">{signal.id}</td>
                      <td className="py-1.5 pr-3 text-[#8B95A7]">{controlledLocation(signal.controlledLanes)}</td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot color={dominant.color} label="" />
                          <span style={{ color: dominant.color }}>{dominant.label}</span>
                          <span className="text-[9px] text-[#5c6675]">{signal.state}</span>
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-[#8B95A7]">
                        {Math.max(0, signal.nextSwitchAtSeconds - (state.sim?.simTimeSeconds ?? 0)).toFixed(0)}s
                      </td>
                      <td className="py-1.5 pr-3">{signal.queueLength}</td>
                      <td className="py-1.5 pr-3">
                        {corridor !== null ? <Badge color="#8B5CF6">CORRIDOR</Badge> : <Badge color="#5c6675">NORMAL</Badge>}
                      </td>
                      <td className="py-1.5 pr-3 text-[#8B95A7]">{corridor !== null ? `corridor ${corridor.corridorId}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function controlledLocation(controlledLanes: string[]): string {
  // Derive a human location label from the controlled approach lanes.
  const approaches = new Set<string>();
  for (const lane of controlledLanes) {
    const match = /^([a-z0-9]+)_[a-z0-9]+_\d+$/.exec(lane);
    if (match !== null) {
      const edge = match[1] ?? "";
      const parts = edge.split("_");
      approaches.add((parts[0] ?? "").toUpperCase());
    }
  }
  return [...approaches].sort().join("/") || "—";
}

async function api_getCorridors() {
  const { api } = await import("@/lib/api");
  return (await api.getCorridors()).corridors;
}
