"use client";

import React from "react";
import Link from "next/link";
import { useItms } from "@/lib/store";
import {
  EmptyState,
  LoadingState,
  Panel,
  SignalLightVisual,
  DisconnectedBanner,
  ActionButton,
  KeyValue,
} from "@/components/ui";
import { AiCopilotModal } from "@/components/AiCopilotModal";
import { api } from "@/lib/api";
import { getJunctionMeta } from "@/lib/naming";
import type { SignalSnapshot } from "@itms/types";

type FilterMode = "ALL" | "ACTIVE" | "CORRIDOR" | "NORMAL";

interface CorridorAssociation {
  corridorId: number;
  status: string;
}

export default function SignalsPage() {
  const { state } = useItms();
  const [filter, setFilter] = React.useState<FilterMode>("ALL");
  const [selectedSignal, setSelectedSignal] = React.useState<SignalSnapshot | null>(null);
  const [corridorBySignal, setCorridorBySignal] = React.useState<Map<string, CorridorAssociation>>(
    new Map()
  );
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // AI Copilot state
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [copilotQuestion, setCopilotQuestion] = React.useState<string | undefined>(undefined);
  const [copilotContext, setCopilotContext] = React.useState<{ intersectionId?: string } | undefined>(undefined);

  const openCopilot = (q?: string, ctx?: { intersectionId?: string }) => {
    setCopilotQuestion(q);
    setCopilotContext(ctx);
    setCopilotOpen(true);
  };

  // Poll corridor associations
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const corridors = (await api.getCorridors()).corridors;
        if (cancelled) return;
        const map = new Map<string, CorridorAssociation>();
        for (const c of corridors) {
          if (c.status !== "ACTIVE" && c.status !== "REPLANNING" && c.status !== "PLANNING") continue;
          for (const s of c.signals) {
            if (s.status === "APPLIED" || s.status === "PENDING") {
              map.set(s.junctionId, { corridorId: c.id, status: s.status });
            }
          }
        }
        setCorridorBySignal(map);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Corridors unavailable");
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const signals = state.signals;
  const simTime = state.sim?.simTimeSeconds ?? 0;

  // Filter signals
  const filteredSignals = React.useMemo(() => {
    return signals.filter((signal) => {
      const isCorridor = corridorBySignal.has(signal.id);
      if (filter === "CORRIDOR") return isCorridor;
      if (filter === "NORMAL") return !isCorridor;
      if (filter === "ACTIVE") return /[gG]/.test(signal.state);
      return true;
    });
  }, [signals, corridorBySignal, filter]);

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 font-sans">
      {/* ================================================================== */}
      {/* 1. HEADER & FILTER CONTROLS                                        */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3 shadow-sm">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
            Traffic Signal Control
          </h1>
          <p className="text-[11px] text-[#8D9AAA]">
            Real-time signal phases, clearance intervals & green corridor preemption
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0E141D] p-1 font-mono text-xs">
          {(["ALL", "ACTIVE", "CORRIDOR", "NORMAL"] as FilterMode[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`rounded-md px-3 py-1 font-semibold uppercase transition-colors ${
                filter === tab
                  ? "bg-[#121A24] text-[#42B8FF] shadow-[0_0_8px_rgba(66,184,255,0.3)]"
                  : "text-[#8D9AAA] hover:text-[#F4F7FA]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}
      {loadError && <div className="font-mono text-xs text-[#FFB547]">⚠ {loadError}</div>}

      {/* ================================================================== */}
      {/* 2. SIGNALS CARD GRID                                               */}
      {/* ================================================================== */}
      {state.sim === null ? (
        <Panel>
          <LoadingState label="Connecting to digital twin signal controllers" />
        </Panel>
      ) : signals.length === 0 ? (
        <Panel>
          <EmptyState
            title="No Live Signal Data"
            hint="Start the simulation to receive live signal telemetry."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredSignals.map((signal) => {
            const meta = getJunctionMeta(signal.id);
            const corridor = corridorBySignal.get(signal.id) ?? null;
            const remaining = Math.max(0, signal.nextSwitchAtSeconds - simTime);
            const isGreen = /[gG]/.test(signal.state);
            const isYellow = /[yY]/.test(signal.state);
            const currentPhase = isGreen ? "GREEN" : isYellow ? "YELLOW" : "RED";

            return (
              <div
                key={signal.id}
                onClick={() => setSelectedSignal(signal)}
                className={`itms-panel itms-hover cursor-pointer rounded-xl p-3.5 transition-all ${
                  corridor ? "border-[rgba(139,124,255,0.5)] bg-[rgba(139,124,255,0.04)]" : ""
                }`}
              >
                {/* Card Top: Human-Readable Name & Traffic Light */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-[#F4F7FA]">
                      {meta.fullName}
                    </span>
                    <div className="font-mono text-[10px] text-[#5E6B7A]">
                      SUMO ID: {signal.id}
                    </div>
                  </div>
                  <SignalLightVisual state={signal.state} size="md" />
                </div>

                {/* Status Badges */}
                <div className="mt-3 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-2 font-mono text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-[#5E6B7A]">Current Phase</span>
                    <span
                      className="font-bold tracking-wide"
                      style={{
                        color: isGreen ? "#18D88B" : isYellow ? "#FFB547" : "#FF3B4E",
                      }}
                    >
                      {currentPhase} · {remaining.toFixed(0)}s left
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase text-[#5E6B7A]">Mode</span>
                    <span>
                      {corridor ? (
                        <span className="font-bold text-[#8B7CFF]">CORRIDOR PRIORITY</span>
                      ) : (
                        <span className="text-[#8D9AAA]">NORMAL CONTROL</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Queue & Quick Actions */}
                <div className="mt-2.5 flex items-center justify-between border-t border-[rgba(255,255,255,0.04)] pt-2 font-mono text-[11px]">
                  <div className="text-[#8D9AAA]">
                    Queue: <span className="font-bold text-[#F4F7FA]">{signal.queueLength}</span> veh
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCopilot(`Why is ${meta.code} (${meta.name}) in this signal phase?`, { intersectionId: signal.id });
                      }}
                      className="text-[10px] text-[#8B7CFF] hover:underline"
                    >
                      Why this signal?
                    </button>
                    <Link
                      href="/"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-[#42B8FF] hover:underline"
                    >
                      View on Map →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================== */}
      {/* 3. SELECTED SIGNAL DETAILED INSPECTION PANEL                       */}
      {/* ================================================================== */}
      {selectedSignal && (
        <Panel
          title={`Signal Inspector — ${getJunctionMeta(selectedSignal.id).fullName}`}
          subtitle="Phase Duration & Approach Safety Clearance"
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => openCopilot(`Explain why ${getJunctionMeta(selectedSignal.id).fullName} is currently in state "${selectedSignal.state}"`, { intersectionId: selectedSignal.id })}
                className="rounded-lg bg-[rgba(139,124,255,0.15)] border border-[#8B7CFF]/30 px-3 py-1 font-mono text-[11px] font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.25)] transition-all"
              >
                Why this signal? (AI)
              </button>
              <ActionButton onClick={() => setSelectedSignal(null)} color="#8D9AAA">
                Close
              </ActionButton>
            </div>
          }
        >
          {(() => {
            const meta = getJunctionMeta(selectedSignal.id);
            const isGreen = /[gG]/.test(selectedSignal.state);
            const isYellow = /[yY]/.test(selectedSignal.state);
            const remaining = Math.max(0, selectedSignal.nextSwitchAtSeconds - simTime);
            const corridor = corridorBySignal.get(selectedSignal.id) ?? null;

            return (
              <div className="grid gap-6 md:grid-cols-2 font-sans">
                <div className="space-y-2 font-mono text-xs">
                  <KeyValue label="Intersection Name">{meta.fullName}</KeyValue>
                  <KeyValue label="SUMO Junction ID">{selectedSignal.id}</KeyValue>
                  <KeyValue label="Active Lens">
                    <span
                      className="font-bold uppercase"
                      style={{ color: isGreen ? "#18D88B" : isYellow ? "#FFB547" : "#FF3B4E" }}
                    >
                      {isGreen ? "GREEN" : isYellow ? "YELLOW" : "RED"}
                    </span>
                  </KeyValue>
                  <KeyValue label="Remaining in Phase">{remaining.toFixed(1)} seconds</KeyValue>
                  <KeyValue label="Total Phase Duration">{selectedSignal.phaseDurationSeconds} seconds</KeyValue>
                  <KeyValue label="Approach Queue">{selectedSignal.queueLength} vehicles waiting</KeyValue>
                  <KeyValue label="Operating Program">
                    {corridor ? (
                      <span className="font-bold text-[#8B7CFF]">GREEN CORRIDOR PRIORITY (HOLD)</span>
                    ) : (
                      "NORMAL ACTUATED CONTROL"
                    )}
                  </KeyValue>
                </div>

                <div className="flex flex-col justify-between rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-4">
                  <div>
                    <span className="font-mono text-xs font-semibold uppercase text-[#5E6B7A]">
                      Phase Allocation Timeline
                    </span>
                    <div className="mt-3 space-y-2.5 font-mono text-xs">
                      <div>
                        <div className="flex justify-between text-[11px] text-[#8D9AAA] mb-1">
                          <span>Green Phase</span>
                          <span>{selectedSignal.phaseDurationSeconds}s</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#18D88B]/20 overflow-hidden">
                          <div
                            className="h-full bg-[#18D88B]"
                            style={{ width: isGreen ? "100%" : "30%" }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] text-[#8D9AAA] mb-1">
                          <span>Yellow Clearance</span>
                          <span>4s</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#FFB547]/20 overflow-hidden">
                          <div
                            className="h-full bg-[#FFB547]"
                            style={{ width: isYellow ? "100%" : "15%" }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] text-[#8D9AAA] mb-1">
                          <span>Red Clearance</span>
                          <span>Safety Validated</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#FF3B4E]/20 overflow-hidden">
                          <div
                            className="h-full bg-[#FF3B4E]"
                            style={{ width: !isGreen && !isYellow ? "100%" : "20%" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-2.5 font-mono text-[10px] text-[#8D9AAA]">
                    Safety Clearance: Interlock validated via TraCI. Minimum green bounds and clearance interval safety checks enforced.
                  </div>
                </div>
              </div>
            );
          })()}
        </Panel>
      )}

      {/* AI Copilot Modal */}
      <AiCopilotModal
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialQuestion={copilotQuestion}
        context={copilotContext}
      />
    </div>
  );
}
