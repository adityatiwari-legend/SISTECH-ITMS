"use client";

import React from "react";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import { Badge, EmptyState, ErrorState, Panel } from "@/components/ui";
import { wallClock } from "@/lib/format";
import type { DecisionEvent } from "@itms/types";

const KIND_COLORS: Record<DecisionEvent["kind"], string> = {
  "emergency.created": "#FF3B30",
  "emergency.activated": "#FF3B30",
  "emergency.arrived": "#22C55E",
  "route.computed": "#38BDF8",
  "route.switched": "#38BDF8",
  "corridor.created": "#8B5CF6",
  "corridor.activated": "#8B5CF6",
  "corridor.completed": "#22C55E",
  "corridor.cancelled": "#F59E0B",
  "corridor.failed": "#EF4444",
  "signal.applied": "#8B5CF6",
  "signal.passed": "#22C55E",
};

export default function DecisionsPage() {
  const { state } = useItms();
  const [history, setHistory] = React.useState<DecisionEvent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setHistory((await api.getDecisions()).events);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  // Merge persisted history with the live WS trace (both are real events).
  const merged = React.useMemo(() => {
    const seen = new Set<string>();
    const all: DecisionEvent[] = [];
    for (const event of [...state.trace, ...(history ?? [])]) {
      const key = `${event.ts}|${event.kind}|${event.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(event);
    }
    all.sort((a, b) => b.ts.localeCompare(a.ts));
    return all.slice(0, 150);
  }, [state.trace, history]);

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="itms-title-gradient font-mono text-lg font-bold tracking-tight">AI decision trace</h1>
          <p className="mt-0.5 text-[11px] text-[#6B7385]">Real system events only — every routing, prediction, corridor and signal action, explainable</p>
        </div>
      </header>

      {error !== null && <ErrorState title="Trace unavailable" detail={error} retry={() => void load()} />}

      <Panel title="Decision timeline">
        {merged.length === 0 ? (
          <EmptyState
            title="No decisions recorded yet"
            hint="Create an emergency (Emergencies or Simulator page) — every routing/prediction/corridor action appears here."
          />
        ) : (
          <ol className="flex flex-col">
            {merged.map((event, index) => (
              <li key={`${event.ts}-${index}`} className="flex gap-3 border-b border-[#202938]/40 py-1.5 last:border-0">
                <span className="w-20 shrink-0 font-mono text-[10px] text-[#5c6675]">{wallClock(event.ts)}</span>
                <span className="w-36 shrink-0">
                  <Badge color={KIND_COLORS[event.kind]}>{event.kind}</Badge>
                </span>
                <span className="text-[11px] text-[#F4F7FA]">{event.message}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
