"use client";

import React from "react";
import Link from "next/link";
import { api, ApiError, patientImageUrl } from "@/lib/api";
import { useItms } from "@/lib/store";
import {
  ActionButton,
  Badge,
  EmptyState,
  ErrorState,
  KeyValue,
  Panel,
  ProgressBar,
  DisconnectedBanner,
} from "@/components/ui";
import { AiCopilotModal } from "@/components/AiCopilotModal";
import { formatDistance, formatSpeed, wallClock } from "@/lib/format";
import { getJunctionMeta, getVehicleDisplay } from "@/lib/naming";
import type { CreateEmergencyBody, EmergencyEventDetail, EmergencyPriority, EmergencyType } from "@itms/types";

const TYPES: Array<{ value: EmergencyType; label: string; icon: string }> = [
  { value: "ambulance", label: "Ambulance", icon: "🚑" },
  { value: "fire_engine", label: "Fire Engine", icon: "🚒" },
  { value: "police", label: "Police Patrol", icon: "🚓" },
];

const PRIORITIES: EmergencyPriority[] = ["critical", "high", "normal"];

export default function EmergenciesPage() {
  const { state, refreshAll } = useItms();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<EmergencyEventDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [showDispatch, setShowDispatch] = React.useState(false);
  const [authorizingId, setAuthorizingId] = React.useState<number | null>(null);
  const [previewImage, setPreviewImage] = React.useState<{
    id: number;
    url: string;
    condition?: string;
    driverName?: string;
    verificationStatus?: string;
  } | null>(null);

  // AI Copilot state
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [copilotQuestion, setCopilotQuestion] = React.useState<string | undefined>(undefined);
  const [copilotContext, setCopilotContext] = React.useState<{ emergencyId?: number } | undefined>(undefined);

  const openCopilot = (q?: string, ctx?: { emergencyId?: number }) => {
    setCopilotQuestion(q);
    setCopilotContext(ctx);
    setCopilotOpen(true);
  };

  const handleAuthorizeCorridor = async (emergencyId: number) => {
    setAuthorizingId(emergencyId);
    try {
      await api.createCorridor({ eventId: emergencyId });
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to authorize green wave corridor.");
    } finally {
      setAuthorizingId(null);
    }
  };

  // Poll detail if selected
  React.useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      try {
        const next = await api.getEmergency(selectedId);
        if (!cancelled) {
          setDetail(next);
          setDetailError(null);
        }
      } catch (err) {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Detail unavailable");
      }
    };
    void loadDetail();
    const timer = setInterval(loadDetail, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);

  // Deduplicate emergencies by unique id
  const uniqueEmergencies = React.useMemo(() => {
    const seen = new Set<number>();
    return state.emergencies.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [state.emergencies]);

  // Categorize emergencies
  const driverAppEmergencies = uniqueEmergencies.filter(
    (e) => Boolean(e.mobile?.isDriverApp) || Boolean(e.mobile?.driverId) || Boolean(e.mobile?.driverName)
  );
  const activeDriverEmergencies = driverAppEmergencies.filter(
    (e) => e.status === "active" || e.status === "created"
  );

  const simulationEmergencies = uniqueEmergencies.filter(
    (e) => !e.mobile?.isDriverApp && !e.mobile?.driverId
  );
  const activeSimulationEmergencies = simulationEmergencies.filter(
    (e) => e.status === "active" || e.status === "created"
  );

  const historyEmergencies = uniqueEmergencies.filter(
    (e) => e.status !== "active" && e.status !== "created"
  );

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 font-sans">
      {/* ================================================================== */}
      {/* 1. HEADER & ACTION STRIP                                           */}
      {/* ================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3.5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold uppercase tracking-wider text-[#F4F7FA]">
              Emergency Operations & Dispatch
            </h1>
            {activeDriverEmergencies.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-[#18D88B]/40 bg-[rgba(24,216,139,0.12)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#18D88B]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#18D88B] animate-ping" />
                {activeDriverEmergencies.length} DRIVER APP DISPATCH
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#8D9AAA]">
            Authoritative ITMS command center · Field mobile responders, AI triage verification & Green Corridors
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => openCopilot("Explain the emergency response protocol and corridor routing logic.")}
            className="flex items-center gap-1.5 rounded-lg border border-[#8B7CFF]/40 bg-[rgba(139,124,255,0.12)] px-3 py-1.5 font-mono text-xs font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.22)] transition-all"
          >
            <span>Ask Copilot</span>
          </button>
          <ActionButton
            onClick={() => setShowDispatch(!showDispatch)}
            color="#FF3B4E"
            filled
          >
            {showDispatch ? "Hide Dispatch Form" : "+ Dispatch Emergency"}
          </ActionButton>
        </div>
      </div>

      {state.connection === "offline" && <DisconnectedBanner />}

      {/* Dispatch Form Drawer / Section */}
      {showDispatch && (
        <NewEmergencyDrawer
          onCreated={(id) => {
            setSelectedId(id);
            setShowDispatch(false);
          }}
        />
      )}

      {/* ================================================================== */}
      {/* 2. DEDICATED SECTION: EMERGENCIES FROM DRIVER APP                  */}
      {/* ================================================================== */}
      <div className="space-y-3 rounded-2xl border-2 border-[rgba(24,216,139,0.25)] bg-[rgba(10,15,22,0.95)] p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] pb-3 font-mono text-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#18D88B]/40 bg-[rgba(24,216,139,0.15)] text-base">
              📱
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider text-[#18D88B]">
                  Emergencies from Driver App
                </span>
                <span className="rounded bg-[rgba(24,216,139,0.15)] px-2 py-0.5 text-[10px] font-bold text-[#18D88B] border border-[rgba(24,216,139,0.3)]">
                  {driverAppEmergencies.length} RUNS ({activeDriverEmergencies.length} ACTIVE)
                </span>
              </div>
              <p className="text-[10px] text-[#8D9AAA] font-sans">
                Live field dispatches created directly by ambulance drivers via the SISTECH-APP mobile client
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#5E6B7A]">
            <span className="h-2 w-2 rounded-full bg-[#18D88B]" />
            Authoritative Mobile Ingestion Active
          </div>
        </div>

        {driverAppEmergencies.length === 0 ? (
          <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0C1019] p-6 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(24,216,139,0.1)] text-xl">
              📱
            </div>
            <div className="font-mono text-xs font-bold text-[#F4F7FA]">
              No Active Driver App Emergencies Yet
            </div>
            <div className="mt-1 font-mono text-[11px] text-[#8D9AAA] max-w-md mx-auto">
              Initiate an emergency run from the connected mobile app (SISTECH-APP) to see it appear here in real time with driver profile, patient photo evidence, AI verification, and rolling green wave controls.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {driverAppEmergencies.map((emg) => {
              const mobile = emg.mobile;
              const destinationEta = emg.etas?.find((eta) => eta.isDestination) ?? null;
              const totalDist = emg.route?.totalLengthM ?? 1;
              const remDist = emg.live?.remainingDistanceM ?? totalDist;
              const progress = Math.min(100, Math.max(0, Math.round(((totalDist - remDist) / totalDist) * 100)));
              const originMeta = getJunctionMeta(emg.originJunction);
              const destMeta = getJunctionMeta(emg.destinationJunction);
              const hospitalTitle = mobile?.hospitalName ?? destMeta.fullName;

              const isAuthorized = mobile?.isCorridorAuthorized;
              const isAiApproved = mobile?.verificationStatus === "aiApproved";
              const isFraudFlagged = mobile?.verificationStatus === "aiFraudFlagged";

              return (
                <div
                  key={emg.id}
                  className="flex flex-col justify-between rounded-xl border border-[rgba(24,216,139,0.35)] bg-[#0D131D] p-4 shadow-md transition-all hover:border-[#18D88B]/60"
                >
                  <div className="space-y-3">
                    {/* Header: Driver & Vehicle Badges */}
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] pb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(24,216,139,0.15)] text-xl">
                          🚑
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-[#18D88B]">
                              {mobile?.driverName || "Ambulance Driver"}
                            </span>
                            <span className="rounded bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#F4F7FA]">
                              {mobile?.driverCode || "DRV-802"}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-[#8D9AAA]">
                            Unit: <span className="font-semibold text-[#F4F7FA]">{mobile?.vehicleCode || emg.vehicle?.vehicleId || "AMB-001"}</span> · {mobile?.registrationNumber || "MP-04-EA-1080"}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 font-mono">
                        <div className="flex items-center gap-1.5">
                          <Badge color={emg.status === "active" ? "#18D88B" : (emg.status === "created" ? "#FFB547" : "#8D9AAA")} solid>
                            ● {emg.status.toUpperCase()}
                          </Badge>
                          <Badge color="#FF3B4E">
                            {mobile?.severity?.toUpperCase() || emg.priority.toUpperCase()}
                          </Badge>
                        </div>
                        <span className="text-[9px] text-[#5E6B7A]">Mission #{emg.id}</span>
                      </div>
                    </div>

                    {/* Triage & Medical Details Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-2.5">
                        <span className="text-[9px] uppercase tracking-wider text-[#5E6B7A]">Patient Triage</span>
                        <div className="mt-0.5 font-semibold text-[#FF3B4E] truncate" title={mobile?.patientCondition ?? undefined}>
                          {mobile?.patientCondition || "Critical Emergency Triage"}
                        </div>
                        <div className="text-[10px] text-[#8D9AAA]">Priority: {emg.priority.toUpperCase()}</div>
                      </div>

                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-2.5">
                        <span className="text-[9px] uppercase tracking-wider text-[#5E6B7A]">Target Hospital</span>
                        <div className="mt-0.5 font-semibold text-[#42B8FF] truncate" title={hospitalTitle}>
                          {hospitalTitle}
                        </div>
                        <div className="text-[10px] text-[#8D9AAA]">Code: {mobile?.hospitalCode || destMeta.code} · Level 1 Trauma</div>
                      </div>

                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-2.5">
                        <span className="text-[9px] uppercase tracking-wider text-[#5E6B7A]">AI Verification</span>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {isAiApproved ? (
                            <span className="font-bold text-[#18D88B]">✓ AI VERIFIED</span>
                          ) : isFraudFlagged ? (
                            <span className="font-bold text-[#FF3B4E]">⚠ FRAUD FLAGGED</span>
                          ) : (
                            <span className="font-bold text-[#FFB547]">● {mobile?.verificationStatus || "PENDING"}</span>
                          )}
                          {mobile?.hasPatientImage && (
                            <button
                              onClick={() =>
                                setPreviewImage({
                                  id: emg.id,
                                  url: patientImageUrl(emg.id),
                                  condition: mobile?.patientCondition || undefined,
                                  driverName: mobile?.driverName || undefined,
                                  verificationStatus: mobile?.verificationStatus || undefined,
                                })
                              }
                              className="ml-auto rounded bg-[rgba(66,184,255,0.15)] border border-[rgba(66,184,255,0.3)] px-1.5 py-0.5 text-[9px] font-semibold text-[#42B8FF] hover:bg-[rgba(66,184,255,0.25)]"
                            >
                              📷 View Photo
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-2.5">
                        <span className="text-[9px] uppercase tracking-wider text-[#5E6B7A]">Green Corridor Status</span>
                        <div className="mt-0.5 flex items-center justify-between">
                          <span
                            className="font-bold"
                            style={{ color: isAuthorized ? "#18D88B" : "#FFB547" }}
                          >
                            {isAuthorized ? "🟢 AUTHORIZED" : "🟡 PENDING"}
                          </span>
                          {!isAuthorized && (
                            <button
                              onClick={() => void handleAuthorizeCorridor(emg.id)}
                              disabled={authorizingId === emg.id}
                              className="rounded bg-[rgba(24,216,139,0.15)] border border-[#18D88B]/40 px-2 py-0.5 text-[9px] font-bold text-[#18D88B] hover:bg-[rgba(24,216,139,0.25)] disabled:opacity-50"
                            >
                              {authorizingId === emg.id ? "Authorizing…" : "⚡ Authorize Wave"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Progress & Speed */}
                    <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#070A0F] p-2.5">
                      <div className="mb-1 flex justify-between font-mono text-[10px]">
                        <span className="text-[#8D9AAA]">
                          Route: {originMeta.code} → {destMeta.code}
                        </span>
                        <span className="font-bold text-[#F4F7FA]">
                          Speed: {formatSpeed(emg.live?.speedMps ?? null)} · ETA: {destinationEta ? `+${destinationEta.etaSeconds.toFixed(0)}s` : "Calculating…"}
                        </span>
                      </div>
                      <ProgressBar progress={progress} color="#18D88B" height={5} />
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                    <Link
                      href="/"
                      className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase text-[#F4F7FA] hover:border-[#18D88B] hover:text-[#18D88B] transition-colors"
                    >
                      🗺️ View on Map
                    </Link>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openCopilot(`Analyze driver mobile emergency #${emg.id} for driver ${mobile?.driverName || 'driver'} headed to ${hospitalTitle}.`, { emergencyId: emg.id })}
                        className="rounded-lg border border-[#8B7CFF]/30 bg-[rgba(139,124,255,0.1)] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.2)] transition-colors"
                      >
                        Explain (AI)
                      </button>
                      <button
                        onClick={() => setSelectedId(selectedId === emg.id ? null : emg.id)}
                        className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#8D9AAA] hover:text-[#F4F7FA] transition-colors"
                      >
                        {selectedId === emg.id ? "Hide Details" : "Mission Inspector"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* 3. SECTION: CENTRAL SIMULATION EMERGENCIES                         */}
      {/* ================================================================== */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FF3B4E] animate-ping" />
            <span className="font-bold text-[#FF3B4E] uppercase tracking-wider">
              Central Simulation Priority Vehicles ({activeSimulationEmergencies.length})
            </span>
          </div>
          <span className="text-[10px] text-[#5E6B7A]">Real-Time TraCI Telemetry</span>
        </div>

        {activeSimulationEmergencies.length === 0 ? (
          <Panel>
            <EmptyState
              title="No Active Central Simulation Emergencies"
              hint="All synthetic simulation priority vehicles have completed their runs."
              action={
                <button
                  onClick={() => setShowDispatch(true)}
                  className="rounded-lg border border-[rgba(255,59,78,0.4)] bg-[rgba(255,59,78,0.12)] px-3.5 py-1.5 font-mono text-xs font-semibold text-[#FF3B4E] hover:bg-[rgba(255,59,78,0.2)]"
                >
                  Dispatch Priority Vehicle
                </button>
              }
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {activeSimulationEmergencies.map((emg) => {
              const destinationEta = emg.etas?.find((eta) => eta.isDestination) ?? null;
              const nextEtaItem = emg.etas?.[0];
              const totalDist = emg.route?.totalLengthM ?? 1;
              const remDist = emg.live?.remainingDistanceM ?? totalDist;
              const progress = Math.min(100, Math.max(0, Math.round(((totalDist - remDist) / totalDist) * 100)));

              const originMeta = getJunctionMeta(emg.originJunction);
              const destMeta = getJunctionMeta(emg.destinationJunction);
              const nextMeta = nextEtaItem ? getJunctionMeta(nextEtaItem.junctionId) : destMeta;
              const vehicleTitle = getVehicleDisplay(emg.vehicle?.vehicleId ?? `EMV-${emg.id}`, emg.type);

              return (
                <div
                  key={emg.id}
                  className="itms-panel flex flex-col justify-between p-4 rounded-xl border-[rgba(255,59,78,0.35)] bg-[#0C1019]"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🚑</span>
                        <div>
                          <div className="text-base font-bold text-[#FF3B4E]">
                            {vehicleTitle}
                          </div>
                          <div className="font-mono text-[10px] uppercase text-[#8D9AAA]">
                            Mission #{emg.id} · {emg.type.replace("_", " ")}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 font-mono">
                        <Badge color="#FF3B4E" solid>
                          ● {emg.status.toUpperCase()}
                        </Badge>
                        <Badge color={emg.priority === "critical" ? "#FF3B4E" : "#FFB547"}>
                          {emg.priority.toUpperCase()}
                        </Badge>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between font-mono text-[10px]">
                        <span className="text-[#8D9AAA]">Route Progress</span>
                        <span className="font-bold text-[#F4F7FA]">{progress}%</span>
                      </div>
                      <ProgressBar progress={progress} color="#FF3B4E" height={6} />
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Origin Facility</span>
                        <div className="mt-0.5 font-semibold text-[#F4F7FA] truncate" title={originMeta.fullName}>
                          {originMeta.code} · {originMeta.name}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Destination Base</span>
                        <div className="mt-0.5 font-semibold text-[#F4F7FA] truncate" title={destMeta.fullName}>
                          {destMeta.code} · {destMeta.name}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Current Speed</span>
                        <div className="mt-0.5 font-bold text-[#F4F7FA]">
                          {formatSpeed(emg.live?.speedMps ?? null)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0E141D] p-2.5">
                        <span className="text-[10px] uppercase text-[#5E6B7A]">Destination ETA</span>
                        <div className="mt-0.5 font-bold text-[#18D88B]">
                          {destinationEta ? `+${destinationEta.etaSeconds.toFixed(0)}s` : "Calculating…"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-xs font-mono text-[#8D9AAA]">
                      Approaching Next: <span className="font-bold text-[#42B8FF]">{nextMeta.fullName}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-3">
                    <Link
                      href="/"
                      className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-3 py-1.5 font-mono text-[11px] font-semibold uppercase text-[#F4F7FA] hover:border-[#42B8FF] hover:text-[#42B8FF] transition-colors"
                    >
                      View on Map
                    </Link>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openCopilot(`Explain the status and ETA calculation for emergency mission #${emg.id}.`, { emergencyId: emg.id })}
                        className="rounded-lg border border-[#8B7CFF]/30 bg-[rgba(139,124,255,0.1)] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.2)] transition-colors"
                      >
                        Explain with AI
                      </button>
                      <button
                        onClick={() => setSelectedId(selectedId === emg.id ? null : emg.id)}
                        className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#8D9AAA] hover:text-[#F4F7FA] transition-colors"
                      >
                        {selectedId === emg.id ? "Hide Details" : "Mission Inspector"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Emergency Inspector Drawer */}
      {selectedId !== null && detail && (
        <Panel
          title={`Mission Inspector — ${getVehicleDisplay(detail.vehicle?.vehicleId, detail.type)}`}
          subtitle={`Emergency Event #${detail.id} · A* Route & Signal ETAs`}
          emergency
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => openCopilot(`Explain why this vehicle took this route from ${detail.originJunction} to ${detail.destinationJunction}.`, { emergencyId: detail.id })}
                className="rounded-lg bg-[rgba(139,124,255,0.15)] border border-[#8B7CFF]/30 px-3 py-1 font-mono text-[11px] font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.25)] transition-all"
              >
                Explain Route (AI)
              </button>
              <ActionButton onClick={() => setSelectedId(null)} color="#8D9AAA">
                Close
              </ActionButton>
            </div>
          }
        >
          {detailError && <ErrorState title="Telemetry Error" detail={detailError} />}
          <div className="grid gap-6 md:grid-cols-2 text-xs">
            <div className="space-y-2 font-mono">
              <KeyValue label="Vehicle ID">{detail.vehicle?.vehicleId ?? `EMV-${detail.id}`}</KeyValue>
              <KeyValue label="Unit Type">{detail.type.replace("_", " ").toUpperCase()}</KeyValue>
              <KeyValue label="Mission Priority">
                <span className="font-bold text-[#FF3B4E]">{detail.priority.toUpperCase()}</span>
              </KeyValue>
              <KeyValue label="Origin Hub">{getJunctionMeta(detail.originJunction).fullName}</KeyValue>
              <KeyValue label="Destination">{getJunctionMeta(detail.destinationJunction).fullName}</KeyValue>
              <KeyValue label="Speed">{formatSpeed(detail.live?.speedMps ?? null)}</KeyValue>
              <KeyValue label="Distance Remaining">
                {formatDistance(detail.live?.remainingDistanceM ?? null)}
              </KeyValue>
            </div>

            <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#070A0F] p-4">
              <span className="font-mono text-xs font-semibold uppercase text-[#5E6B7A]">
                Upcoming Intersection ETAs
              </span>
              <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs">
                {(detail.etas ?? []).map((eta) => {
                  const meta = getJunctionMeta(eta.junctionId);
                  return (
                    <div
                      key={eta.junctionId}
                      className="flex items-center justify-between border-b border-[rgba(255,255,255,0.04)] py-1 last:border-0"
                    >
                      <div>
                        <span className="font-bold text-[#F4F7FA]">{meta.fullName}</span>
                        {eta.isDestination && (
                          <span className="ml-1 text-[9px] text-[#18D88B]">(DESTINATION)</span>
                        )}
                      </div>
                      <span className="font-bold text-[#18D88B]">+{Math.round(eta.etaSeconds)}s</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ================================================================== */}
      {/* 3. SECTION 2: EMERGENCY HISTORY (Compact Table)                    */}
      {/* ================================================================== */}
      {/* ================================================================== */}
      {/* 4. SECTION: EMERGENCY HISTORY (Compact Table)                      */}
      {/* ================================================================== */}
      <Panel
        title={`Emergency Mission History (${historyEmergencies.length})`}
        subtitle="Completed and Archived Emergency Runs (Field Mobile & Central Dispatch)"
      >
        {historyEmergencies.length === 0 ? (
          <div className="py-6 text-center font-mono text-xs text-[#5E6B7A]">
            No previous emergency dispatches recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase text-[#5E6B7A]">
                  <th className="py-2.5 pr-3">ID</th>
                  <th className="py-2.5 pr-3">Source</th>
                  <th className="py-2.5 pr-3">Unit / Driver</th>
                  <th className="py-2.5 pr-3">Route (Origin → Dest)</th>
                  <th className="py-2.5 pr-3">Priority</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 pr-3">Dispatched</th>
                  <th className="py-2">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {historyEmergencies.map((emg) => (
                  <tr key={emg.id} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[#0E141D]/50">
                    <td className="py-2.5 pr-3 text-[#5E6B7A]">#{emg.id}</td>
                    <td className="py-2.5 pr-3">
                      {emg.mobile?.isDriverApp ? (
                        <span className="rounded bg-[rgba(24,216,139,0.15)] border border-[rgba(24,216,139,0.3)] px-1.5 py-0.5 text-[9px] font-bold text-[#18D88B]">
                          📱 Driver App
                        </span>
                      ) : (
                        <span className="rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[9px] font-semibold text-[#8D9AAA]">
                          🚦 Central Sim
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-[#F4F7FA]">
                      {emg.mobile?.driverName ? (
                        <div>
                          <div>{emg.mobile.driverName}</div>
                          <div className="text-[10px] text-[#8D9AAA]">{emg.mobile.vehicleCode || emg.vehicle?.vehicleId}</div>
                        </div>
                      ) : (
                        getVehicleDisplay(emg.vehicle?.vehicleId, emg.type)
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-[#8D9AAA]">
                      {getJunctionMeta(emg.originJunction).code} → {getJunctionMeta(emg.destinationJunction).code}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge color={emg.priority === "critical" ? "#FF3B4E" : "#FFB547"}>
                        {emg.priority}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge color={emg.status === "arrived" ? "#18D88B" : "#8D9AAA"}>
                        {emg.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-[10px] text-[#5E6B7A]">{wallClock(emg.createdAtIso)}</td>
                    <td className="py-2.5 text-[10px] text-[#18D88B]">
                      {emg.arrivedAtIso ? wallClock(emg.arrivedAtIso) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Patient Evidence Photo Modal */}
      {previewImage !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-[rgba(24,216,139,0.3)] bg-[#0C1019] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📷</span>
                <div>
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-[#F4F7FA]">
                    Patient Photo Evidence
                  </h3>
                  <p className="font-mono text-[10px] text-[#8D9AAA]">
                    Emergency #{previewImage.id} · Field Evidence Telemetry
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="rounded-lg p-1 text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA]"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.1)] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImage.url}
                alt="Patient Evidence"
                className="h-64 w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Ctext x='50%25' y='50%25' fill='%238D9AAA' font-family='sans-serif' font-size='8' text-anchor='middle' dominant-baseline='middle'%3EEvidence Photo Loading / Processed%3C/text%3E%3C/svg%3E";
                }}
              />
            </div>

            <div className="mt-3 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between border-b border-[rgba(255,255,255,0.04)] py-1 text-[11px]">
                <span className="text-[#5E6B7A]">Reporting Driver:</span>
                <span className="font-semibold text-[#F4F7FA]">{previewImage.driverName || "Field Responder"}</span>
              </div>
              <div className="flex justify-between border-b border-[rgba(255,255,255,0.04)] py-1 text-[11px]">
                <span className="text-[#5E6B7A]">Patient Triage:</span>
                <span className="font-semibold text-[#FF3B4E]">{previewImage.condition || "Emergency Condition"}</span>
              </div>
              <div className="flex justify-between py-1 text-[11px]">
                <span className="text-[#5E6B7A]">AI Verification:</span>
                <span className="font-bold text-[#18D88B]">
                  {previewImage.verificationStatus === "aiApproved" ? "✓ AI Verified & Approved" : (previewImage.verificationStatus || "Pending")}
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setPreviewImage(null)}
                className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#121A24] px-4 py-1.5 font-mono text-xs font-semibold text-[#F4F7FA] hover:bg-[#1A2534]"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
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

function NewEmergencyDrawer({ onCreated }: { onCreated: (id: number) => void }) {
  const { state, refreshAll } = useItms();
  const [type, setType] = React.useState<EmergencyType>("ambulance");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [priority, setPriority] = React.useState<EmergencyPriority>("critical");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Derive junctions from authoritative signals
  const junctions = React.useMemo(
    () => (state.signals ?? []).map((s) => s.id).sort(),
    [state.signals]
  );

  React.useEffect(() => {
    if (junctions.length >= 2 && !origin) {
      setOrigin(junctions[0]!);
      setDestination(junctions[junctions.length - 1]!);
    }
  }, [junctions, origin]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateEmergencyBody = { type, origin, destination, priority };
      const created = await api.createEmergency(body);
      onCreated(created.id);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isRunning = state.sim?.status === "running";

  return (
    <Panel
      title="Dispatch Priority Vehicle"
      subtitle="Instantiate Real-time TraCI Agent"
      emergency
    >
      {!isRunning && (
        <div className="mb-3 rounded-lg border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] p-2.5 font-mono text-xs text-[#FFB547]">
          ⚠ The simulation must be running to insert vehicles. Start the simulation from the top bar or Simulator page.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Vehicle Unit Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EmergencyType)}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Origin Intersection</span>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {junctions.map((j) => {
              const meta = getJunctionMeta(j);
              return (
                <option key={j} value={j}>
                  {meta.fullName}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Destination Facility</span>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {junctions.map((j) => {
              const meta = getJunctionMeta(j);
              return (
                <option key={j} value={j}>
                  {meta.fullName}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-[#5E6B7A]">Priority Level</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as EmergencyPriority)}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0E141D] p-2 text-[#F4F7FA]"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="mt-3 font-mono text-xs text-[#FF4757]">⚠ {error}</div>}

      <div className="mt-4 flex justify-end">
        <ActionButton
          onClick={() => void submit()}
          disabled={submitting || !isRunning || !origin || !destination}
          color="#FF3B4E"
          filled
        >
          {submitting ? "Dispatching…" : "Engage Emergency Dispatch"}
        </ActionButton>
      </div>
    </Panel>
  );
}
