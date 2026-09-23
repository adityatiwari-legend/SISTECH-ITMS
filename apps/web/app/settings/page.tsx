"use client";

import React from "react";
import { api, ApiError } from "@/lib/api";
import { useItms } from "@/lib/store";
import { Badge, ErrorState, KeyValue, LoadingState, Panel, StatusDot } from "@/components/ui";
import type { SystemOverview } from "@itms/types";

export default function SettingsPage() {
  const { state, refreshAll } = useItms();
  const [overview, setOverview] = React.useState<SystemOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setOverview(await api.getSystem());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  if (error !== null && overview === null) {
    return (
      <div className="p-3">
        <Panel><ErrorState title="System overview unavailable" detail={error} retry={() => void load()} /></Panel>
      </div>
    );
  }
  if (overview === null) {
    return <Panel className="m-3"><LoadingState label="Loading system overview" /></Panel>;
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#8B95A7]">Settings / System</h1>
        <button
          onClick={() => void refreshAll()}
          className="rounded border border-[#202938] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8B95A7] hover:border-[#38BDF8] hover:text-[#38BDF8]"
        >
          Refresh
        </button>
      </header>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel title="Components">
          <KeyValue label="API endpoint">
            {`${overview.api.host}:${overview.api.port}`} (Node {overview.api.nodeVersion})
          </KeyValue>
          <KeyValue label="Simulation">
            <span className="inline-flex items-center gap-2">
              <StatusDot color={overview.simulation.status === "running" ? "#22C55E" : overview.simulation.status === "error" ? "#EF4444" : "#F59E0B"} label={overview.simulation.status} />
            </span>
          </KeyValue>
          <KeyValue label="SUMO">{overview.simulation.sumoVersion ?? "not running"}</KeyValue>
          <KeyValue label="TraCI API version">{overview.simulation.traciApiVersion ?? "—"}</KeyValue>
          <KeyValue label="PostgreSQL / PostGIS">
            <span className="inline-flex items-center gap-2">
              <StatusDot color={overview.database.connected ? "#22C55E" : "#EF4444"} label={overview.database.connected ? "connected" : "down"} />
              {overview.database.postgisVersion !== null && <span className="text-[#8B95A7]">PostGIS {overview.database.postgisVersion}</span>}
            </span>
          </KeyValue>
          {overview.database.lastError !== null && <KeyValue label="DB error">{overview.database.lastError}</KeyValue>}
          <KeyValue label="Prediction service">
            <span className="inline-flex items-center gap-2">
              <StatusDot
                color={!overview.prediction.configured ? "#5c6675" : overview.prediction.healthy ? "#22C55E" : "#F59E0B"}
                label={!overview.prediction.configured ? "disabled" : overview.prediction.healthy ? "healthy" : "unavailable"}
              />
              {overview.prediction.modelVersion !== null && <span className="text-[#8B95A7]">model {overview.prediction.modelVersion.slice(0, 19)}</span>}
            </span>
          </KeyValue>
          <KeyValue label="Frontend connection">{state.connection}</KeyValue>
        </Panel>

        <Panel title="Scenarios">
          <ul className="flex flex-col gap-1">
            {overview.scenarios.map((scenario) => (
              <li key={scenario.id} className="flex items-center justify-between rounded border border-[#202938] px-2 py-1 font-mono text-[11px]">
                <span className="text-[#F4F7FA]">{scenario.id}</span>
                <span className="text-[#8B95A7]">{scenario.label}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Closed-loop settings (environment-configured, read-only)">
          <KeyValue label="Loop evaluation interval">{overview.settingsSummary.loopEvalIntervalS} s (sim time)</KeyValue>
          <KeyValue label="Route re-evaluation interval">{overview.settingsSummary.routeReevalIntervalS} s (sim time)</KeyValue>
          <KeyValue label="Metrics sampling interval">{overview.settingsSummary.metricsSampleIntervalS} s (sim time)</KeyValue>
          <KeyValue label="Congestion thresholds">
            occupancy {overview.settingsSummary.congestionThresholds.mediumOccupancy}/{overview.settingsSummary.congestionThresholds.highOccupancy}/{overview.settingsSummary.congestionThresholds.criticalOccupancy} ·
            queue {overview.settingsSummary.congestionThresholds.mediumQueue}/{overview.settingsSummary.congestionThresholds.highQueue}/{overview.settingsSummary.congestionThresholds.criticalQueue}
          </KeyValue>
        </Panel>

        <Panel title="Corridor safety bounds (read-only)">
          <KeyValue label="Green lead / trail">{overview.settingsSummary.corridor.greenLeadS}s / {overview.settingsSummary.corridor.greenTrailS}s</KeyValue>
          <KeyValue label="Window min / max">{overview.settingsSummary.corridor.minGreenWindowS}s / {overview.settingsSummary.corridor.maxGreenWindowS}s</KeyValue>
          <KeyValue label="Max green extension">{overview.settingsSummary.corridor.maxGreenExtensionS}s</KeyValue>
          <KeyValue label="Max red extension (cross traffic)">{overview.settingsSummary.corridor.maxRedExtensionS}s</KeyValue>
          <KeyValue label="Clearance yellow">{overview.settingsSummary.corridor.clearanceYellowS}s</KeyValue>
          <KeyValue label="Minimum emergency priority"><Badge color="#8B5CF6">{overview.settingsSummary.corridor.minPriority}</Badge></KeyValue>
        </Panel>
      </div>

      <Panel title="Notes">
        <ul className="flex flex-col gap-1 text-[11px] text-[#8B95A7]">
          <li>• All dashboard values come from the running SUMO simulation, PostgreSQL, or the ML prediction service. No fabricated data is displayed anywhere.</li>
          <li>• The displayed city is the SUMO digital twin (6 signalized intersections, 3×2 grid). It is not geo-referenced; map coordinates are a display transform.</li>
          <li>• Secrets (DATABASE_URL credentials, prediction URL host) are kept in environment files and are never displayed here.</li>
        </ul>
      </Panel>
    </div>
  );
}
