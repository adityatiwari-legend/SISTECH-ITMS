"use client";

import React from "react";
import { api } from "@/lib/api";
import { useItms } from "@/lib/store";
import { CityMap } from "@/components/CityMap";
import { ActiveEmergencyPanel, AiPanel, CompactSignalsPanel, CorridorChainPanel } from "@/components/panels";
import { DisconnectedBanner, StaleBanner, LoadingState } from "@/components/ui";
import type { NetworkGeometryResponse } from "@itms/types";

export default function CommandCenterPage() {
  const { state } = useItms();
  const [geometry, setGeometry] = React.useState<NetworkGeometryResponse | null>(null);
  const [geometryError, setGeometryError] = React.useState<string | null>(null);

  const loadGeometry = React.useCallback(async () => {
    setGeometryError(null);
    try {
      setGeometry(await api.getNetworkGeometry());
    } catch (err) {
      setGeometryError(err instanceof Error ? err.message : "Map geometry unavailable.");
    }
  }, []);

  React.useEffect(() => {
    void loadGeometry();
  }, [loadGeometry]);

  const activeEmergency =
    state.emergencies.find((emergency) => emergency.status === "active") ??
    state.emergencies.find((emergency) => emergency.status === "created") ??
    null;
  const activeCorridor = state.corridors.find((corridor) => corridor.status === "ACTIVE") ?? null;

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {state.connection === "offline" && <DisconnectedBanner />}
      {state.connection !== "offline" && state.traffic?.stale && state.sim?.status === "running" && <StaleBanner label="Traffic data stale." />}
      {geometryError !== null && state.connection !== "offline" && (
        <div className="rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 py-1 font-mono text-[11px] text-[#F59E0B]">
          Map geometry unavailable: {geometryError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        {/* LIVE MAP — 65% */}
        <div className="itms-panel min-h-[320px] overflow-hidden">
          <CityMap
            className="h-full min-h-[320px] w-full"
            data={{
              geometry,
              trafficSegments: state.traffic?.segments ?? [],
              signals: state.signals,
              vehicles: state.vehicles,
              emergency: activeEmergency,
              corridor: activeCorridor,
            }}
          />
        </div>

        {/* EVENT PANEL STACK */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
          {state.connection === "offline" ? (
            <div className="itms-panel p-4">
              <LoadingState label="Waiting for backend" />
            </div>
          ) : (
            <>
              <ActiveEmergencyPanel emergency={activeEmergency} />
              <CorridorChainPanel corridor={activeCorridor} />
              <CompactSignalsPanel signals={state.signals} />
              <AiPanel
                predictions={state.predictions}
                traffic={state.traffic}
                corridors={state.corridors}
                sim={state.sim !== null ? { status: state.sim.status, simTimeSeconds: state.sim.simTimeSeconds } : null}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
