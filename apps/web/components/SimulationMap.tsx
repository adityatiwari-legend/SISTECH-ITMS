"use client";

import React from "react";
import Link from "next/link";
import type {
  CongestionLevel,
  CorridorDetail,
  EmergencyEventDetail,
  NetworkGeometryResponse,
  SignalSnapshot,
  VehicleSnapshot,
  RoadsideDeviceRecord,
} from "@itms/types";
import { CONGESTION_COLORS, simClock } from "@/lib/format";
import { getJunctionMeta, getVehicleDisplay } from "@/lib/naming";
import { api } from "@/lib/api";
import { Icons } from "./ui";

/**
 * SUMO NETWORK VISUALIZATION — HUMAN-CENTERED OPERATIONS MAP
 *
 * ARCHITECTURE:
 * - SUMO is the authoritative traffic world. Road geometry is derived from
 *   /api/network/geometry (real net.xml shapes, lanes, junctions).
 * - TraCI streams vehicles, signals, routes, and emergencies via WebSockets.
 * - Map UX features: Search with autocomplete, Follow Emergency mode,
 *   Focus Corridor mode, Clickable intersections with rich side inspector,
 *   Hover tooltips, and complete Layer toggles.
 */

export interface SimulationMapData {
  geometry: NetworkGeometryResponse | null;
  trafficSegments: Array<{ segmentId: string; congestion: CongestionLevel; vehicleCount: number; avgSpeedMps: number }>;
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergency: EmergencyEventDetail | null;
  corridor: CorridorDetail | null;
  simTimeSeconds?: number;
}

const DEFAULT_VIEWBOX = { minX: -20, minY: -20, width: 700, height: 480 };

export function SimulationMap({
  data,
  className = "",
  highlightTraffic = true,
  onOpenCopilot,
}: {
  data: SimulationMapData;
  className?: string;
  highlightTraffic?: boolean;
  onOpenCopilot?: (question?: string, context?: { intersectionId?: string }) => void;
}) {
  const geometry = data.geometry;
  const viewBox = React.useMemo(() => {
    if (geometry === null) return DEFAULT_VIEWBOX;
    const pad = 16;
    const minX = geometry.extent.minX - pad;
    const minY = geometry.extent.minY - pad;
    const width = Math.max(50, geometry.extent.maxX - geometry.extent.minX + pad * 2);
    const height = Math.max(50, geometry.extent.maxY - geometry.extent.minY + pad * 2);
    return { minX, minY, width, height };
  }, [geometry]);

  // Layer Toggles
  const [showTraffic, setShowTraffic] = React.useState(highlightTraffic);
  const [showSignals, setShowSignals] = React.useState(true);
  const [showVehicles] = React.useState(true);
  const [showEmergencies] = React.useState(true);
  const [showCorridor, setShowCorridor] = React.useState(true);
  const [showFacilities] = React.useState(true);
  const [showLegend, setShowLegend] = React.useState(false);

  // Search & Selection State
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedJunctionId, setSelectedJunctionId] = React.useState<string | null>(null);
  const [isFollowingEmergency, setIsFollowingEmergency] = React.useState(false);
  const [roadsideDevices, setRoadsideDevices] = React.useState<RoadsideDeviceRecord[]>([]);

  // Periodically sync roadside device statuses
  React.useEffect(() => {
    let isCancelled = false;
    const loadRoadsideDevices = async () => {
      try {
        const res = await api.getRoadsideDevices();
        if (!isCancelled && res?.devices) {
          setRoadsideDevices(res.devices);
        }
      } catch {
        // best effort polling
      }
    };
    void loadRoadsideDevices();
    const interval = setInterval(loadRoadsideDevices, 3000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Search matches
  const searchResults = React.useMemo(() => {
    if (!geometry || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const results: Array<{ id: string; label: string; sub: string; type: "junction" | "facility" | "road" }> = [];

    // Search junctions
    for (const j of geometry.junctions) {
      const meta = getJunctionMeta(j.id);
      if (
        meta.name.toLowerCase().includes(q) ||
        meta.code.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      ) {
        results.push({
          id: j.id,
          label: meta.fullName,
          sub: `SUMO: ${j.id}`,
          type: "junction",
        });
      }
    }

    // Search facilities
    for (const f of geometry.facilities) {
      if (f.id.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)) {
        results.push({
          id: f.id,
          label: f.type === "hospital" ? "City Hospital Base" : f.type === "fire_station" ? "Fire Station Base" : "EMS Western Base",
          sub: `POI: ${f.id}`,
          type: "facility",
        });
      }
    }

    return results.slice(0, 6);
  }, [geometry, searchQuery]);

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[#070A0F] ${className}`}
      data-testid="simulation-map"
    >
      {geometry === null ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="font-mono text-xs uppercase tracking-wider text-[#FFB547]">
            ⚠ Connecting to SUMO Network…
          </span>
          <span className="max-w-sm font-mono text-[11px] leading-relaxed text-[#5E6B7A]">
            Loading authoritative road geometry from digital twin engine.
          </span>
        </div>
      ) : (
        <NetworkCanvas
          viewBox={viewBox}
          data={data}
          showTraffic={showTraffic}
          showSignals={showSignals}
          showVehicles={showVehicles}
          showEmergencies={showEmergencies}
          showCorridor={showCorridor}
          showFacilities={showFacilities}
          onToggleTraffic={() => setShowTraffic((v) => !v)}
          onToggleSignals={() => setShowSignals((v) => !v)}
          onToggleCorridor={() => setShowCorridor((v) => !v)}
          selectedJunctionId={selectedJunctionId}
          onSelectJunction={setSelectedJunctionId}
          isFollowingEmergency={isFollowingEmergency}
          setIsFollowingEmergency={setIsFollowingEmergency}
          roadsideDevices={roadsideDevices}
        />
      )}

      {/* ================================================================== */}
      {/* TOP-LEFT SEARCH & IDENTITY OVERLAY                                 */}
      {/* ================================================================== */}
      <div className="absolute left-3 top-3 z-30 flex flex-col gap-2 max-w-sm w-full pointer-events-auto">
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search junction, hospital, road..."
              className="w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#0A0F16]/95 px-3 py-1.5 pl-8 font-sans text-xs text-[#F4F7FA] placeholder-[#5E6B7A] backdrop-blur-md shadow-lg focus:border-[#42B8FF] focus:outline-none"
            />
            <svg
              className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#5E6B7A]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-[#5E6B7A] hover:text-[#F4F7FA]"
              >
                ✕
              </button>
            )}

            {/* Autocomplete Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0E141D] shadow-2xl overflow-hidden z-40">
                {searchResults.map((res) => (
                  <button
                    key={res.id}
                    onClick={() => {
                      if (res.type === "junction") {
                        setSelectedJunctionId(res.id);
                      }
                      setSearchQuery("");
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#121A24] transition-colors border-b border-[rgba(255,255,255,0.04)] last:border-0"
                  >
                    <div>
                      <div className="font-semibold text-[#F4F7FA]">{res.label}</div>
                      <div className="font-mono text-[9px] text-[#5E6B7A]">{res.sub}</div>
                    </div>
                    <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#121A24] text-[#8D9AAA]">
                      {res.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Legend Toggle Button */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className={`flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.12)] px-2.5 py-1.5 font-mono text-[10px] font-semibold backdrop-blur-md shadow-lg transition-colors ${
              showLegend ? "bg-[#121A24] text-[#42B8FF]" : "bg-[#0A0F16]/95 text-[#8D9AAA] hover:text-[#F4F7FA]"
            }`}
            title="Toggle Map Legend"
          >
            <span>LEGEND</span>
          </button>
        </div>

        {/* Legend Flyout */}
        {showLegend && (
          <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0A0F16]/95 p-3.5 backdrop-blur-md shadow-2xl text-xs space-y-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-1.5 border-b border-[rgba(255,255,255,0.06)] font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
              <span>MAP VISUAL LEGEND</span>
              <button onClick={() => setShowLegend(false)} className="text-[#5E6B7A] hover:text-[#F4F7FA]">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] font-mono">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#64748B]" />
                <span className="text-[#8D9AAA]">Normal traffic</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF3B4E] animate-pulse" />
                <span className="text-[#FF6B7A] font-semibold">Emergency vehicle</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-4 rounded bg-[#FF3B4E]" />
                <span className="text-[#FF3B4E]">Emergency route</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#18D88B] shadow-sm shadow-[#18D88B]" />
                <span className="text-[#18D88B] font-semibold">Current green</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#42B8FF]" />
                <span className="text-[#42B8FF]">Preparing</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#8D9AAA]" />
                <span className="text-[#8D9AAA]">Upcoming</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#FFB547] animate-pulse" />
                <span className="text-[#FFB547]">Cross-traffic clearing</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#475569]" />
                <span className="text-[#8D9AAA]">Passed</span>
              </div>
              <div className="flex items-center gap-2 col-span-2 border-t border-[rgba(255,255,255,0.04)] pt-1.5">
                <span className="h-2 w-2 rounded-full bg-[#1E293B]" />
                <span className="text-[#5E6B7A]">Normal signal control</span>
              </div>
            </div>
          </div>
        )}

        {/* Floating Active Corridor HUD */}
        {showCorridor && data.corridor && data.corridor.status === "ACTIVE" && (
          <ActiveCorridorHUD corridor={data.corridor} emergency={data.emergency} />
        )}
      </div>

      {/* ================================================================== */}
      {/* BOTTOM-LEFT SIMULATION CLOCK & FOLLOW BADGE                        */}
      {/* ================================================================== */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-2 font-mono text-[11px]">
        <div className="flex items-center gap-2 rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-2.5 py-1 backdrop-blur-md">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#18D88B]" />
          <span className="text-[10px] text-[#5E6B7A] uppercase">LIVE CLOCK</span>
          <span className="font-bold text-[#F4F7FA]">
            {simClock(data.simTimeSeconds ?? null)}
          </span>
        </div>

        {isFollowingEmergency && (
          <div className="pointer-events-auto flex items-center gap-2 rounded border border-[#FF3B4E]/40 bg-[#FF3B4E]/15 px-2.5 py-1 text-[10px] font-bold text-[#FF3B4E] backdrop-blur-md animate-pulse">
            <span>● FOLLOWING EMERGENCY</span>
            <button
              onClick={() => setIsFollowingEmergency(false)}
              className="ml-1 rounded bg-[#FF3B4E]/20 px-1 hover:bg-[#FF3B4E]/40"
              title="Stop Following"
            >
              STOP
            </button>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* BOTTOM-RIGHT METRIC BADGES                                         */}
      {/* ================================================================== */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-30 hidden items-center gap-2 font-mono text-[10px] sm:flex">
        <div className="flex items-center gap-3 rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-2.5 py-1 text-[#8D9AAA] backdrop-blur-md">
          <span>{data.vehicles.length} VEHICLES</span>
          <span>·</span>
          <span>{data.signals.length} SIGNALS</span>
          {data.corridor && data.corridor.status === "ACTIVE" && (
            <>
              <span>·</span>
              <span className="font-bold text-[#18D88B]">GREEN CORRIDOR ACTIVE</span>
            </>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* INTERSECTION SIDE INSPECTOR DRAWER                                 */}
      {/* ================================================================== */}
      {selectedJunctionId && (
        <IntersectionInspector
          junctionId={selectedJunctionId}
          data={data}
          roadsideDevice={roadsideDevices.find((d) => d.signalId === selectedJunctionId)}
          onClose={() => setSelectedJunctionId(null)}
          onOpenCopilot={onOpenCopilot}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network Canvas: Handles SVG rendering, Pan/Zoom, Follow Mode
// ---------------------------------------------------------------------------

function NetworkCanvas({
  viewBox,
  data,
  showTraffic,
  showSignals,
  showVehicles,
  showEmergencies,
  showCorridor,
  showFacilities,
  selectedJunctionId,
  onSelectJunction,
  isFollowingEmergency,
  setIsFollowingEmergency,
  onToggleTraffic,
  onToggleSignals,
  onToggleCorridor,
  roadsideDevices,
}: {
  viewBox: { minX: number; minY: number; width: number; height: number };
  data: SimulationMapData;
  showTraffic: boolean;
  showSignals: boolean;
  showVehicles: boolean;
  showEmergencies: boolean;
  showCorridor: boolean;
  showFacilities: boolean;
  selectedJunctionId: string | null;
  onSelectJunction: (id: string | null) => void;
  isFollowingEmergency: boolean;
  setIsFollowingEmergency: (following: boolean) => void;
  onToggleTraffic?: () => void;
  onToggleSignals?: () => void;
  onToggleCorridor?: () => void;
  roadsideDevices?: RoadsideDeviceRecord[];
}) {
  const geometry = data.geometry!;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [view, setView] = React.useState({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  const [hoveredJunctionId, setHoveredJunctionId] = React.useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = React.useState<string | null>(null);
  const [isFollowingVehicle, setIsFollowingVehicle] = React.useState(false);

  // Live emergency vehicle: resolve from 5 Hz vehicle telemetry stream first, fallback to REST
  const liveEmergency = React.useMemo(() => {
    if (!geometry) return null;

    // Helper to validate whether (x, y) is inside the active road network
    const isWithinNetwork = (x: number, y: number) => {
      const minThreshold = Math.max(100, geometry.extent.minX + 50);
      return (
        x >= minThreshold &&
        x <= geometry.extent.maxX + 100 &&
        y >= Math.max(100, geometry.extent.minY + 50) &&
        y <= geometry.extent.maxY + 100
      );
    };

    // Helper to get fallback coordinates from origin junction or emergency route
    const getRouteStartPoint = (): { x: number; y: number } | null => {
      if (!data.emergency) return null;
      const origId = data.emergency.originJunction;
      if (origId) {
        const j = geometry.junctions.find((junc) => junc.id === origId);
        if (j) return { x: j.x, y: j.y };
      }
      const firstSeg = data.emergency.route?.segments?.[0];
      if (firstSeg) {
        const jFrom = geometry.junctions.find((junc) => junc.id === firstSeg.fromJunction);
        if (jFrom) return { x: jFrom.x, y: jFrom.y };
        const jTo = geometry.junctions.find((junc) => junc.id === firstSeg.toJunction);
        if (jTo) return { x: jTo.x, y: jTo.y };
      }
      return null;
    };

    const emvId = data.emergency?.vehicle?.vehicleId;
    const fromVehicles = data.vehicles.find(
      (v) => (emvId && v.id === emvId) || (data.emergency && (v.id.startsWith("emv-") || v.typeId.includes("emergency") || v.typeId.includes("ambulance")))
    );

    if (fromVehicles) {
      let x = fromVehicles.positionX;
      let y = fromVehicles.positionY;

      if (!isWithinNetwork(x, y)) {
        if (fromVehicles.lat != null && fromVehicles.lng != null) {
          const pt = latLngToSumoPoint(fromVehicles.lat, fromVehicles.lng, geometry);
          if (pt && isWithinNetwork(pt.x, pt.y)) {
            x = pt.x;
            y = pt.y;
          }
        }
      }

      if (!isWithinNetwork(x, y)) {
        const routePt = getRouteStartPoint();
        if (routePt) {
          x = routePt.x;
          y = routePt.y;
        }
      }

      if (isWithinNetwork(x, y)) {
        return {
          vehicleId: fromVehicles.id,
          positionX: x,
          positionY: y,
          angle: fromVehicles.angle ?? 0,
          speedMps: fromVehicles.speed,
          type: data.emergency?.vehicle?.type ?? "ambulance",
        };
      }
    }

    if (data.emergency?.live) {
      let x = data.emergency.live.positionX;
      let y = data.emergency.live.positionY;

      if (!isWithinNetwork(x, y)) {
        const routePt = getRouteStartPoint();
        if (routePt) {
          x = routePt.x;
          y = routePt.y;
        }
      }

      if (isWithinNetwork(x, y)) {
        return {
          vehicleId: data.emergency.vehicle?.vehicleId ?? "ambulance",
          positionX: x,
          positionY: y,
          angle: data.emergency.live.angle ?? 0,
          speedMps: data.emergency.live.speedMps,
          type: data.emergency.vehicle?.type ?? "ambulance",
        };
      }
    }

    if (data.emergency) {
      let x = data.emergency.vehicle?.positionX ?? 0;
      let y = data.emergency.vehicle?.positionY ?? 0;

      if (!isWithinNetwork(x, y)) {
        if (data.emergency.vehicle?.lat != null && data.emergency.vehicle?.lng != null) {
          const pt = latLngToSumoPoint(data.emergency.vehicle.lat, data.emergency.vehicle.lng, geometry);
          if (pt && isWithinNetwork(pt.x, pt.y)) {
            x = pt.x;
            y = pt.y;
          }
        }
      }

      if (!isWithinNetwork(x, y)) {
        const routePt = getRouteStartPoint();
        if (routePt) {
          x = routePt.x;
          y = routePt.y;
        }
      }

      if (isWithinNetwork(x, y)) {
        return {
          vehicleId: data.emergency.vehicle?.vehicleId ?? "ambulance",
          positionX: x,
          positionY: y,
          angle: 0,
          speedMps: data.emergency.vehicle?.speedMps ?? 0,
          type: data.emergency.vehicle?.type ?? "ambulance",
        };
      }
    }

    return null;
  }, [data.emergency, data.vehicles, geometry]);

  // Initial viewport setup on load
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    if (!initializedRef.current && viewBox.width > 0) {
      setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
      initializedRef.current = true;
    }
  }, [viewBox.minX, viewBox.minY, viewBox.width]);

  // FOLLOW LOGIC: Smooth tracking centered on followed vehicle
  React.useEffect(() => {
    if (!isFollowingEmergency && !isFollowingVehicle) return;

    let targetX: number | null = null;
    let targetY: number | null = null;

    if (isFollowingEmergency && liveEmergency) {
      targetX = liveEmergency.positionX;
      targetY = flipY(liveEmergency.positionY, geometry);
    } else if (isFollowingVehicle && selectedVehicleId) {
      const v = data.vehicles.find((veh) => veh.id === selectedVehicleId);
      if (v) {
        targetX = v.positionX;
        targetY = flipY(v.positionY, geometry);
      }
    }

    if (targetX === null || targetY === null) return;

    const aspect = viewBox.height / viewBox.width;
    const followW = Math.max(160, Math.min(320, viewBox.width * 0.12));

    setView((prev) => {
      const destX = targetX! - followW / 2;
      const destY = targetY! - (followW * aspect) / 2;
      return {
        x: prev.x + (destX - prev.x) * 0.35,
        y: prev.y + (destY - prev.y) * 0.35,
        w: prev.w + (followW - prev.w) * 0.35,
      };
    });
  }, [isFollowingEmergency, isFollowingVehicle, liveEmergency, selectedVehicleId, data.vehicles, geometry, viewBox]);

  // Toggle follow emergency with instant snap-to-target
  const toggleFollowEmergency = React.useCallback(() => {
    if (!isFollowingEmergency) {
      if (liveEmergency) {
        const emX = liveEmergency.positionX;
        const emY = flipY(liveEmergency.positionY, geometry);
        const aspect = viewBox.height / viewBox.width;
        const followW = Math.max(160, Math.min(320, viewBox.width * 0.12));
        setView({
          x: emX - followW / 2,
          y: emY - (followW * aspect) / 2,
          w: followW,
        });
      }
      setIsFollowingVehicle(false);
      setIsFollowingEmergency(true);
    } else {
      setIsFollowingEmergency(false);
    }
  }, [isFollowingEmergency, liveEmergency, geometry, viewBox, setIsFollowingEmergency]);

  // Toggle follow selected vehicle with instant snap-to-target
  const toggleFollowVehicle = React.useCallback(() => {
    if (!isFollowingVehicle) {
      const v = data.vehicles.find((veh) => veh.id === selectedVehicleId);
      if (v) {
        const emX = v.positionX;
        const emY = flipY(v.positionY, geometry);
        const aspect = viewBox.height / viewBox.width;
        const followW = Math.max(160, Math.min(320, viewBox.width * 0.12));
        setView({
          x: emX - followW / 2,
          y: emY - (followW * aspect) / 2,
          w: followW,
        });
      }
      setIsFollowingEmergency(false);
      setIsFollowingVehicle(true);
    } else {
      setIsFollowingVehicle(false);
    }
  }, [isFollowingVehicle, selectedVehicleId, data.vehicles, geometry, viewBox, setIsFollowingEmergency]);

  // Zoom controls
  const zoomIn = React.useCallback(() => {
    setIsFollowingEmergency(false);
    setIsFollowingVehicle(false);
    setView((prev) => {
      const factor = 0.75;
      const newW = clamp(prev.w * factor, viewBox.width / 40, viewBox.width * 1.5);
      const deltaW = prev.w - newW;
      const aspect = viewBox.height / viewBox.width;
      return {
        x: prev.x + deltaW / 2,
        y: prev.y + (deltaW * aspect) / 2,
        w: newW,
      };
    });
  }, [viewBox, setIsFollowingEmergency]);

  const zoomOut = React.useCallback(() => {
    setIsFollowingEmergency(false);
    setIsFollowingVehicle(false);
    setView((prev) => {
      const factor = 1.33;
      const newW = clamp(prev.w * factor, viewBox.width / 40, viewBox.width * 1.5);
      const deltaW = prev.w - newW;
      const aspect = viewBox.height / viewBox.width;
      return {
        x: prev.x + deltaW / 2,
        y: prev.y + (deltaW * aspect) / 2,
        w: newW,
      };
    });
  }, [viewBox, setIsFollowingEmergency]);

  const fitNetwork = React.useCallback(() => {
    setIsFollowingEmergency(false);
    setIsFollowingVehicle(false);
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox, setIsFollowingEmergency]);

  // FOCUS CORRIDOR: Fits emergency vehicle + all upcoming corridor junctions + destination
  const focusCorridor = React.useCallback(() => {
    setIsFollowingEmergency(false);
    setIsFollowingVehicle(false);
    if (!data.emergency || !data.corridor) {
      fitNetwork();
      return;
    }

    const points: Array<{ x: number; y: number }> = [];
    if (data.emergency.live) {
      points.push({
        x: data.emergency.live.positionX,
        y: flipY(data.emergency.live.positionY, geometry),
      });
    }

    // Add corridor junction coordinates
    for (const sig of data.corridor.signals) {
      const junc = geometry.junctions.find((j) => j.id === sig.junctionId);
      if (junc) {
        points.push({ x: junc.x, y: flipY(junc.y, geometry) });
      }
    }

    if (points.length === 0) {
      fitNetwork();
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const pad = Math.max(30, (maxX - minX) * 0.25);
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

    const spanW = Math.max(60, maxX - minX);
    const spanH = Math.max(60, maxY - minY);
    const aspect = viewBox.height / viewBox.width;
    const finalW = Math.max(spanW, spanH / aspect);

    setView({
      x: minX,
      y: minY,
      w: finalW,
    });
  }, [data.emergency, data.corridor, geometry, viewBox, fitNetwork, setIsFollowingEmergency]);

  // CENTER SELECTED JUNCTION
  const centerSelected = React.useCallback(() => {
    if (!selectedJunctionId) return;
    const junc = geometry.junctions.find((j) => j.id === selectedJunctionId);
    if (!junc) return;
    const aspect = viewBox.height / viewBox.width;
    const targetW = viewBox.width * 0.35;
    setView({
      x: junc.x - targetW / 2,
      y: flipY(junc.y, geometry) - (targetW * aspect) / 2,
      w: targetW,
    });
  }, [selectedJunctionId, geometry, viewBox]);

  // Drag pan
  const dragRef = React.useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      setIsFollowingEmergency(false);
      dragRef.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [view.x, view.y, setIsFollowingEmergency]
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (!drag || !svg) return;
      const rect = svg.getBoundingClientRect();
      const pxPerUnit = rect.width / view.w;
      setView((prev) => ({
        ...prev,
        x: drag.x - (event.clientX - drag.clientX) / pxPerUnit,
        y: drag.y - (event.clientY - drag.clientY) / pxPerUnit,
      }));
    },
    [view.w]
  );

  const onPointerUp = React.useCallback(() => {
    dragRef.current = null;
  }, []);

  const onWheel = React.useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      setIsFollowingEmergency(false);
      const svg = svgRef.current;
      if (!svg) return;
      setView((prev) => {
        const rect = svg.getBoundingClientRect();
        const pxPerUnit = rect.width / prev.w;
        const cursorX = prev.x + (event.clientX - rect.left) / pxPerUnit;
        const cursorY = prev.y + (event.clientY - rect.top) / pxPerUnit;
        const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
        const w = clamp(prev.w * factor, viewBox.width / 40, viewBox.width * 1.5);
        const k = w / prev.w;
        return { x: cursorX - (cursorX - prev.x) * k, y: cursorY - (cursorY - prev.y) * k, w };
      });
    },
    [viewBox.width, setIsFollowingEmergency]
  );

  return (
    <div className="relative h-full w-full">
      {/* ================================================================== */}
      {/* TOP-RIGHT MAP CONTROLS OVERLAY                                    */}
      {/* ================================================================== */}
      <div className="absolute right-3 top-3 z-30 flex flex-wrap items-center gap-1.5">
        {/* Navigation & Focus Tools */}
        <div className="flex items-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/95 p-0.5 backdrop-blur-md shadow-lg">
          <button
            onClick={zoomIn}
            className="flex h-7 w-7 items-center justify-center rounded text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA] transition-colors"
            title="Zoom In"
            aria-label="Zoom in"
          >
            <Icons.ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={zoomOut}
            className="flex h-7 w-7 items-center justify-center rounded text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA] transition-colors"
            title="Zoom Out"
            aria-label="Zoom out"
          >
            <Icons.ZoomOut className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-[1px] bg-[rgba(255,255,255,0.08)]" />
          <button
            onClick={fitNetwork}
            className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#42B8FF] transition-colors"
            title="Fit Entire Network"
          >
            <Icons.FitView className="h-3 w-3" />
            <span className="hidden sm:inline">FIT NETWORK</span>
          </button>

          {(data.emergency || liveEmergency) && (
            <button
              onClick={toggleFollowEmergency}
              className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold transition-colors ${
                isFollowingEmergency
                  ? "bg-[#FF3B4E] text-[#05070B] font-bold shadow-[0_0_12px_rgba(255,59,78,0.5)]"
                  : "text-[#FF3B4E] hover:bg-[rgba(255,59,78,0.15)]"
              }`}
              title="Center and track live emergency vehicle"
            >
              <Icons.CenterTarget className="h-3 w-3" />
              <span>{isFollowingEmergency ? "FOLLOWING EMERGENCY" : "FOLLOW EMERGENCY"}</span>
            </button>
          )}

          {selectedVehicleId && !isFollowingEmergency && (
            <button
              onClick={toggleFollowVehicle}
              className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold transition-colors ${
                isFollowingVehicle
                  ? "bg-[#42B8FF] text-[#05070B] font-bold shadow-[0_0_12px_rgba(66,184,255,0.5)]"
                  : "text-[#42B8FF] hover:bg-[rgba(66,184,255,0.15)]"
              }`}
              title="Track selected vehicle"
            >
              <Icons.CenterTarget className="h-3 w-3" />
              <span>{isFollowingVehicle ? `FOLLOWING ${selectedVehicleId}` : `FOLLOW ${selectedVehicleId}`}</span>
            </button>
          )}

          {data.corridor && (
            <button
              onClick={focusCorridor}
              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold text-[#18D88B] hover:bg-[rgba(24,216,139,0.15)] transition-colors"
              title="Focus full corridor in viewport"
            >
              <span>FOCUS CORRIDOR</span>
            </button>
          )}

          {selectedJunctionId && (
            <button
              onClick={centerSelected}
              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold text-[#42B8FF] hover:bg-[#121A24] transition-colors"
              title="Center on selected junction"
            >
              <span>CENTER SELECTED</span>
            </button>
          )}
        </div>

        {/* Primary Layer Toggles */}
        <div className="hidden md:flex items-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/95 p-0.5 backdrop-blur-md shadow-lg font-mono text-[10px]">
          <button
            onClick={onToggleTraffic}
            className={`rounded px-2 py-1 transition-colors ${
              showTraffic ? "bg-[#121A24] text-[#42B8FF] font-semibold" : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Traffic Congestion"
          >
            TRAFFIC
          </button>
          <button
            onClick={onToggleSignals}
            className={`rounded px-2 py-1 transition-colors ${
              showSignals ? "bg-[#121A24] text-[#18D88B] font-semibold" : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Signals"
          >
            SIGNALS
          </button>
          <button
            onClick={onToggleCorridor}
            className={`rounded px-2 py-1 transition-colors ${
              showCorridor ? "bg-[#121A24] text-[#8B7CFF] font-semibold" : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Green Corridor"
          >
            CORRIDOR
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* SVG CANVAS LAYER                                                   */}
      {/* ================================================================== */}
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.w * (viewBox.height / viewBox.width)}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none"
        style={{ cursor: dragRef.current !== null ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="route-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto"
          >
            <path d="M 0 1.5 L 7 5 L 0 8.5 L 2 5 Z" fill="#FF3B4E" />
          </marker>
        </defs>

        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.w * (viewBox.height / viewBox.width)}
          fill="#070B12"
        />

        {/* 1. Static Road Network */}
        <StaticLayer geometry={geometry} showFacilities={showFacilities} />

        {/* 2. Dynamic TraCI Overlays */}
        <DynamicLayer
          data={data}
          liveEmergency={liveEmergency}
          selectedVehicleId={selectedVehicleId}
          onSelectVehicle={setSelectedVehicleId}
          showTraffic={showTraffic}
          showSignals={showSignals}
          showVehicles={showVehicles}
          showEmergencies={showEmergencies}
          showCorridor={showCorridor}
          selectedJunctionId={selectedJunctionId}
          hoveredJunctionId={hoveredJunctionId}
          onSelectJunction={onSelectJunction}
          onHoverJunction={setHoveredJunctionId}
          roadsideDevices={roadsideDevices}
          viewWidth={view.w}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static Network Layer (Roads, Lanes, Facilities)
// ---------------------------------------------------------------------------

const StaticLayer = React.memo(function StaticLayer({
  geometry,
  showFacilities,
}: {
  geometry: NetworkGeometryResponse;
  showFacilities: boolean;
}) {
  const lanes = React.useMemo(() => {
    const out: Array<{ key: string; points: string; width: number; isMajor: boolean }> = [];
    for (const segment of geometry.segments) {
      const isMajor = segment.laneCount >= 2;
      const laneWidth = laneStrokeWidth(segment.laneCount, geometry);
      for (const lane of segment.lanes) {
        out.push({
          key: lane.id,
          points: flippedPoints(lane.shape, geometry),
          width: isMajor ? laneWidth * 1.1 : laneWidth,
          isMajor,
        });
      }
    }
    return out;
  }, [geometry]);

  return (
    <g>
      {/* Road Casings: Major roads thicker & brighter, minor roads thinner */}
      {geometry.segments.map((segment) => {
        const isMajor = segment.laneCount >= 2;
        return (
          <polyline
            key={`casing-${segment.id}`}
            points={flippedPoints(segment.coordinates, geometry)}
            fill="none"
            stroke={isMajor ? "#222D3E" : "#161E2B"}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={casingWidth(segment.laneCount, geometry) * (isMajor ? 1.15 : 1)}
          />
        );
      })}

      {/* Individual lane polylines (precise SUMO lanes) */}
      {lanes.map((lane) => (
        <polyline
          key={lane.key}
          points={lane.points}
          fill="none"
          stroke={lane.isMajor ? "#34435C" : "#222D3E"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={lane.width}
        />
      ))}

      {/* Facilities POIs */}
      {showFacilities &&
        geometry.facilities.map((facility) => (
          <g key={`f-${facility.id}`}>
            <text
              x={facility.x}
              y={flipY(facility.y, geometry)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={iconSize(geometry)}
              className="cursor-pointer select-none"
            >
              {facility.type === "hospital"
                ? "🏥"
                : facility.type === "ems" || facility.type === "ems_station"
                ? "🚑"
                : "🚒"}
            </text>
            <text
              x={facility.x}
              y={flipY(facility.y, geometry) + iconSize(geometry) * 0.9}
              textAnchor="middle"
              fontSize={iconSize(geometry) * 0.42}
              fill="#8D9AAA"
              className="font-sans font-semibold"
            >
              {facility.type === "hospital"
                ? "City Hospital"
                : facility.type === "ems_station"
                ? "EMS West"
                : "Fire Base"}
            </text>
          </g>
        ))}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Dynamic Layer: Vehicles, Signals, Corridors, Intersections
// ---------------------------------------------------------------------------

function DynamicLayer({
  data,
  liveEmergency,
  selectedVehicleId,
  onSelectVehicle,
  showTraffic,
  showSignals,
  showVehicles,
  showEmergencies,
  showCorridor,
  selectedJunctionId,
  hoveredJunctionId,
  onSelectJunction,
  onHoverJunction,
  roadsideDevices,
  viewWidth,
}: {
  data: SimulationMapData;
  liveEmergency: {
    vehicleId: string;
    positionX: number;
    positionY: number;
    angle: number;
    speedMps: number;
    type: string;
  } | null;
  selectedVehicleId: string | null;
  onSelectVehicle: (id: string | null) => void;
  showTraffic: boolean;
  showSignals: boolean;
  showVehicles: boolean;
  showEmergencies: boolean;
  showCorridor: boolean;
  selectedJunctionId: string | null;
  hoveredJunctionId: string | null;
  onSelectJunction: (id: string | null) => void;
  onHoverJunction: (id: string | null) => void;
  roadsideDevices?: RoadsideDeviceRecord[];
  viewWidth?: number;
}) {
  const deviceBySignal = React.useMemo(() => {
    const m = new Map<string, RoadsideDeviceRecord>();
    if (roadsideDevices) {
      for (const d of roadsideDevices) {
        m.set(d.signalId, d);
        const meta = getJunctionMeta(d.signalId);
        m.set(meta.code, d);
        m.set(meta.rawId, d);
        m.set(meta.code.replace(/[^A-Za-z0-9]/g, ""), d);
        m.set(d.deviceId, d);
      }
    }
    return m;
  }, [roadsideDevices]);

  const geometry = data.geometry;

  const corridorSignals = React.useMemo(() => {
    const rawSignals = data.corridor?.signals ?? [];
    if (rawSignals.length > 0) {
      if (liveEmergency && geometry) {
        const juncMap = new Map(geometry.junctions.map((j) => [j.id, j]));
        return rawSignals.map((s) => {
          const junc = juncMap.get(s.junctionId);
          if (!junc) return s;
          const dx = junc.x - liveEmergency.positionX;
          const dy = junc.y - liveEmergency.positionY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const speed = Math.max(8, liveEmergency.speedMps);
          const eta = Math.round(dist / speed);

          let stage = s.stage;
          if (!stage || stage === "NORMAL") {
            if (dist < 120) {
              stage = "GREEN";
            } else if (dist < 350) {
              stage = "CLEARING";
            } else if (dist < 650) {
              stage = "PREPARING";
            } else if (dist < 1000) {
              stage = "DETECTED";
            }
          }
          return {
            ...s,
            stage: stage ?? "NORMAL",
            etaSeconds: s.etaSeconds ?? eta,
            distanceToEmergencyM: dist,
          };
        });
      }
      return rawSignals;
    }

    // Dynamic fallback: compute rolling green corridor from active emergency route segments
    if (data.emergency?.route?.segments && data.emergency.route.segments.length > 0 && geometry) {
      const segs = data.emergency.route.segments;
      const juncMap = new Map(geometry.junctions.map((j) => [j.id, j]));
      const routeJuncIds: string[] = [];
      for (const seg of segs) {
        if (seg.toJunction && !routeJuncIds.includes(seg.toJunction)) {
          routeJuncIds.push(seg.toJunction);
        }
      }

      let currentTargetIdx = -1;
      let minAheadDist = Infinity;

      if (liveEmergency) {
        for (let i = 0; i < routeJuncIds.length; i++) {
          const junc = juncMap.get(routeJuncIds[i]);
          if (!junc) continue;
          const dx = junc.x - liveEmergency.positionX;
          const dy = junc.y - liveEmergency.positionY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minAheadDist) {
            minAheadDist = dist;
            currentTargetIdx = i;
          }
        }
      }

      return routeJuncIds.map((jId, idx) => {
        const junc = juncMap.get(jId);
        let dist = 500;
        let eta = 30;
        if (liveEmergency && junc) {
          const dx = junc.x - liveEmergency.positionX;
          const dy = junc.y - liveEmergency.positionY;
          dist = Math.sqrt(dx * dx + dy * dy);
          const speed = Math.max(8, liveEmergency.speedMps);
          eta = Math.round(dist / speed);
        }

        let stage: "PASSED" | "GREEN" | "CLEARING" | "PREPARING" | "DETECTED" | "NORMAL" = "NORMAL";
        let status: "APPLIED" | "PASSED" | "PENDING" = "PENDING";

        if (currentTargetIdx !== -1) {
          if (idx < currentTargetIdx) {
            stage = "PASSED";
            status = "PASSED";
          } else if (idx === currentTargetIdx) {
            stage = "GREEN";
            status = "APPLIED";
          } else if (idx === currentTargetIdx + 1) {
            stage = "CLEARING";
            status = "PENDING";
          } else if (idx === currentTargetIdx + 2) {
            stage = "PREPARING";
            status = "PENDING";
          } else if (idx <= currentTargetIdx + 4) {
            stage = "DETECTED";
            status = "PENDING";
          }
        } else {
          if (idx === 0) { stage = "GREEN"; status = "APPLIED"; }
          else if (idx === 1) { stage = "PREPARING"; status = "PENDING"; }
          else { stage = "DETECTED"; status = "PENDING"; }
        }

        return {
          sequenceIndex: idx,
          junctionId: jId,
          signalId: jId,
          approachSegmentId: segs.find((s) => s.toJunction === jId)?.segmentId ?? "",
          etaSeconds: eta,
          mode: "switch" as const,
          stage,
          status,
          distanceToEmergencyM: dist,
        };
      });
    }

    return [];
  }, [data.corridor?.signals, data.emergency?.route?.segments, liveEmergency, geometry]);


  // Deduplicate signals within 15 meters to eliminate visual clutter and duplicates
  const deduplicatedJunctions = React.useMemo(() => {
    if (!geometry) return [];
    const list = geometry.junctions;
    const result: typeof list = [];
    const usedPositions: Array<{ x: number; y: number }> = [];

    // Prioritize corridor signals first, then selected, then controlled
    const sorted = [...list].sort((a, b) => {
      const aInCorridor = corridorSignals.some((s) => s.junctionId === a.id) ? 1 : 0;
      const bInCorridor = corridorSignals.some((s) => s.junctionId === b.id) ? 1 : 0;
      if (aInCorridor !== bInCorridor) return bInCorridor - aInCorridor;
      if (a.id === selectedJunctionId) return -1;
      if (b.id === selectedJunctionId) return 1;
      const aControlled = a.controlled ? 1 : 0;
      const bControlled = b.controlled ? 1 : 0;
      return bControlled - aControlled;
    });

    for (const junc of sorted) {
      const isDuplicate = usedPositions.some((pos) => {
        const dx = pos.x - junc.x;
        const dy = pos.y - junc.y;
        return Math.sqrt(dx * dx + dy * dy) < 15;
      });

      if (!isDuplicate) {
        usedPositions.push({ x: junc.x, y: junc.y });
        result.push(junc);
      }
    }
    return result;
  }, [geometry, corridorSignals, selectedJunctionId]);

  if (!geometry) return null;

  const corridorApproaches = new Set(
    corridorSignals
      .filter((s) => s.status === "APPLIED" || s.status === "PASSED" || s.status === "PENDING" || s.stage === "GREEN" || s.stage === "CLEARING" || s.stage === "PREPARING")
      .map((s) => s.approachSegmentId)
      .filter((id): id is string => Boolean(id))
  );

  const routeSegmentIds = new Set(
    (data.emergency?.route?.segments ?? []).map((s) => s.segmentId)
  );
  const trafficBySegment = new Map(
    data.trafficSegments.map((s) => [s.segmentId, s] as const)
  );
  const signalById = new Map(data.signals.map((s) => [s.id, s] as const));

  const isZoomClose = (viewWidth ?? 1000) <= 450;

  return (
    <g>
      {/* 1. Measured Traffic Congestion Overlay */}
      {showTraffic &&
        geometry.segments.map((segment) => {
          const traffic = trafficBySegment.get(segment.id);
          if (!traffic || traffic.vehicleCount === 0 || traffic.congestion === "LOW")
            return null;
          return (
            <polyline
              key={`cong-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke={CONGESTION_COLORS[traffic.congestion]}
              strokeOpacity={traffic.congestion === "CRITICAL" ? 0.9 : 0.65}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount, geometry) * 0.72}
            />
          );
        })}

      {/* 2. Calculated A* Emergency Route */}
      {routeSegmentIds.size > 0 &&
        geometry.segments
          .filter((segment) => routeSegmentIds.has(segment.id))
          .map((segment) => (
            <g key={`route-grp-${segment.id}`}>
              <polyline
                points={flippedPoints(segment.coordinates, geometry)}
                fill="none"
                stroke="rgba(255, 59, 78, 0.2)"
                strokeLinecap="round"
                strokeWidth={casingWidth(segment.laneCount, geometry) * 1.35}
              />
              <polyline
                points={flippedPoints(segment.coordinates, geometry)}
                fill="none"
                stroke="#FF3B4E"
                strokeOpacity={0.9}
                strokeLinecap="round"
                strokeWidth={casingWidth(segment.laneCount, geometry) * 0.78}
                markerMid="url(#route-arrow)"
                markerEnd="url(#route-arrow)"
              />
            </g>
          ))}

      {/* 3. Predictive Green Corridor Connected Wave */}
      {showCorridor &&
        corridorApproaches.size > 0 &&
        geometry.segments
          .filter((segment) => corridorApproaches.has(segment.id))
          .map((segment) => (
            <g key={`corridor-grp-${segment.id}`}>
              <polyline
                points={flippedPoints(segment.coordinates, geometry)}
                fill="none"
                stroke="rgba(24, 216, 139, 0.3)"
                strokeLinecap="round"
                strokeWidth={casingWidth(segment.laneCount, geometry) * 1.55}
                filter="url(#glow-green)"
              />
              <polyline
                points={flippedPoints(segment.coordinates, geometry)}
                fill="none"
                stroke="#18D88B"
                strokeOpacity={0.95}
                strokeLinecap="round"
                strokeWidth={casingWidth(segment.laneCount, geometry) * 0.88}
                className="itms-corridor-flow"
              />
            </g>
          ))}

      {/* 4. Clickable Intersections (Controlled + Uncontrolled) with 3-Tier Zoom & Deduplication */}
      {deduplicatedJunctions.map((junction) => {
        const signal = signalById.get(junction.id);
        const corrSignal = corridorSignals.find((s) => s.junctionId === junction.id);
        const meta = getJunctionMeta(junction.id);
        const roadsideDev = deviceBySignal.get(junction.id) ?? deviceBySignal.get(meta.code) ?? deviceBySignal.get(meta.rawId);
        const isSelected = selectedJunctionId === junction.id;
        const isHovered = hoveredJunctionId === junction.id;

        const stage = corrSignal?.stage ?? (
          corrSignal?.status === "APPLIED"
            ? "GREEN"
            : corrSignal?.status === "PASSED"
            ? "PASSED"
            : corrSignal?.status === "PENDING"
            ? "PREPARING"
            : "NORMAL"
        );
        const etaSec = corrSignal?.etaSeconds ? Math.max(0, Math.round(corrSignal.etaSeconds)) : null;

        const isCurrentGreen = stage === "GREEN";
        const isClearing = stage === "CLEARING";
        const isPreparing = stage === "PREPARING";
        const isDetected = stage === "DETECTED";
        const isPassed = stage === "PASSED" || stage === "RESTORING";
        const isCorridorActive = isCurrentGreen || isClearing || isPreparing || isDetected;

        // All controlled traffic signals are visible when showSignals is true;
        // active corridor signals, online roadside displays, selected, hovered, and close zoom signals are also rendered.
        const shouldRenderMarker =
          (showSignals && junction.controlled) ||
          (roadsideDev && roadsideDev.connected) ||
          isCorridorActive ||
          isSelected ||
          isHovered ||
          isZoomClose;

        if (!shouldRenderMarker) return null;

        // ZOOM TIER LABEL RULES:
        // Far: ONLY corridor active or selected/hovered.
        // Medium: ONLY corridor active or selected/hovered.
        // Close: Show signal codes and names.
        const shouldRenderLabel = isCorridorActive || isSelected || isHovered || isZoomClose;

        let fillColor = "#1E293B"; // default uncontrolled
        if (isCorridorActive) {
          fillColor = isCurrentGreen
            ? "#18D88B"
            : isClearing
            ? "#FFB547"
            : isPreparing
            ? "#FFB547"
            : "#38BDF8";
        } else if (isPassed) {
          fillColor = "#475569";
        } else if (junction.controlled && showSignals) {
          fillColor = signal ? signalDominantColor(signal.state) : "#FF4757";
        }

        const baseR = signalRadius(geometry);
        const r = baseR * (isSelected ? 1.4 : isHovered ? 1.25 : isCurrentGreen ? 1.35 : isClearing || isPreparing ? 1.2 : 1);
        const cy = flipY(junction.y, geometry);

        return (
          <g
            key={`junc-${junction.id}`}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelectJunction(isSelected ? null : junction.id);
            }}
            onMouseEnter={() => onHoverJunction(junction.id)}
            onMouseLeave={() => onHoverJunction(null)}
          >
            {/* Selection highlight halo */}
            {isSelected && (
              <circle
                cx={junction.x}
                cy={cy}
                r={r * 1.8}
                fill="none"
                stroke="#42B8FF"
                strokeWidth={2}
                className="animate-pulse"
              />
            )}

            {/* Current Green large pulsating glow */}
            {isCurrentGreen && (
              <>
                <circle
                  cx={junction.x}
                  cy={cy}
                  r={r * 2.2}
                  fill="rgba(24, 216, 139, 0.22)"
                  stroke="#18D88B"
                  strokeWidth={1.5}
                  filter="url(#glow-green)"
                  className="animate-pulse"
                />
                <circle
                  cx={junction.x}
                  cy={cy}
                  r={r * 1.6}
                  fill="none"
                  stroke="#18D88B"
                  strokeWidth={1}
                />
              </>
            )}

            {/* Clearing amber pulse */}
            {isClearing && (
              <circle
                cx={junction.x}
                cy={cy}
                r={r * 1.8}
                fill="rgba(255, 181, 71, 0.22)"
                stroke="#FFB547"
                strokeWidth={1.5}
                className="animate-ping"
              />
            )}

            {/* Preparing blue/amber pulse */}
            {isPreparing && (
              <circle
                cx={junction.x}
                cy={cy}
                r={r * 1.5}
                fill="rgba(66, 184, 255, 0.15)"
                stroke="#42B8FF"
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
            )}

            {/* Junction circle */}
            <circle
              cx={junction.x}
              cy={cy}
              r={r}
              fill={fillColor}
              stroke="#05070B"
              strokeWidth={1.5}
            />

            {/* IoT Roadside Priority Display (CRPD) Indicator */}
            {roadsideDev && (
              <g transform={`translate(${junction.x + r * 0.72}, ${cy - r * 0.72})`}>
                <circle
                  r={baseR * 0.45}
                  fill={isCorridorActive && roadsideDev.connected ? "#FF3B4E" : roadsideDev.connected ? "#18D88B" : "#5E6B7A"}
                  stroke="#05070B"
                  strokeWidth={1}
                />
                {isCorridorActive && roadsideDev.connected && (
                  <circle
                    r={baseR * 0.45}
                    fill="#FF3B4E"
                    stroke="#05070B"
                    strokeWidth={1}
                    className="animate-ping opacity-75"
                  />
                )}
              </g>
            )}

            {/* IoT Roadside Priority Display (CRPD) Screen Indicator Badge */}
            {roadsideDev && roadsideDev.connected && (
              <g transform={`translate(${junction.x}, ${cy - r - (isCorridorActive ? 28 : 14)})`} className="pointer-events-none">
                <rect
                  x={-44}
                  y={-9}
                  width={88}
                  height={18}
                  rx={4}
                  fill="#06121E"
                  stroke="#00E5FF"
                  strokeWidth={1.5}
                  filter="drop-shadow(0 0 6px rgba(0,229,255,0.7))"
                />
                <circle cx={-34} cy={0} r={3} fill="#00E5FF" className="animate-pulse" />
                <text
                  x={-26}
                  y={3.5}
                  fill="#E0F7FA"
                  fontSize={8.5}
                  fontFamily="monospace"
                  fontWeight="bold"
                  letterSpacing="0.05em"
                >
                  {`SCREEN ${roadsideDev.deviceId.replace(/^CRPD-I0?(\d+).*/i, "$1") || "1"} ON`}
                </text>
              </g>
            )}

            {/* Corridor Status Badge Floating Above Junction */}
            {isCorridorActive && (
              <g transform={`translate(${junction.x}, ${cy - r - 12})`}>
                <rect
                  x={-34}
                  y={-7}
                  width={68}
                  height={14}
                  rx={3}
                  fill={isCurrentGreen ? "#18D88B" : isClearing ? "#FFB547" : "#0E141D"}
                  stroke={isCurrentGreen ? "#18D88B" : isClearing ? "#FFB547" : "#42B8FF"}
                  strokeWidth={0.8}
                />
                <text
                  x={0}
                  y={3.5}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight="bold"
                  fill={isCurrentGreen || isClearing ? "#05070B" : "#42B8FF"}
                  className="font-mono select-none"
                >
                  {isCurrentGreen
                    ? `GREEN${etaSec !== null ? ` · ${etaSec}s` : ""}`
                    : isClearing
                    ? "CLEARING"
                    : `PREP · ${etaSec ?? 0}s`}
                </text>
              </g>
            )}

            {/* Human-readable label on map */}
            {shouldRenderLabel && (
              <text
                x={junction.x}
                y={isCorridorActive ? cy - r - 16 : cy - r - 3}
                textAnchor="middle"
                fontSize={signalRadius(geometry) * (isZoomClose ? 0.8 : 0.9)}
                fill={isSelected ? "#42B8FF" : isHovered ? "#F4F7FA" : isCurrentGreen ? "#18D88B" : isPreparing ? "#FFB547" : "#94A3B8"}
                className="font-mono font-bold select-none"
              >
                {isZoomClose && junction.controlled ? `${meta.code} · ${meta.name}` : meta.code}
              </text>
            )}

            {/* Hover Tooltip Card in SVG */}
            {isHovered && !isSelected && (
              <g
                transform={`translate(${junction.x + 8}, ${cy - 30})`}
                className="pointer-events-none"
              >
                <rect
                  width={160}
                  height={roadsideDev ? 68 : 56}
                  rx={4}
                  fill="#0A0F16"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={1}
                  className="shadow-xl"
                />
                <text x={8} y={16} fill="#F4F7FA" fontSize={9} fontWeight="bold" className="font-sans">
                  {meta.fullName}
                </text>
                <text x={8} y={30} fill="#8D9AAA" fontSize={8} className="font-mono">
                  {signal ? `Signal: ${signalDominantLabel(signal.state)}` : "Uncontrolled Crossing"}
                </text>
                <text
                  x={8}
                  y={44}
                  fill={isCurrentGreen ? "#18D88B" : isPreparing || isClearing ? "#FFB547" : "#5E6B7A"}
                  fontSize={8}
                  className="font-mono font-semibold"
                >
                  {isCurrentGreen
                    ? `Corridor: GREEN (ETA: ${etaSec ?? 0}s)`
                    : isClearing
                    ? "Corridor: CLEARING CROSS TRAFFIC"
                    : isPreparing
                    ? `Corridor: PREPARING (ETA: ${etaSec ?? 0}s)`
                    : isPassed
                    ? "Corridor: PASSED (Restored)"
                    : `SUMO ID: ${junction.id}`}
                </text>
                {roadsideDev && (
                  <text
                    x={8}
                    y={58}
                    fill={roadsideDev.connected ? "#18D88B" : "#5E6B7A"}
                    fontSize={7.5}
                    className="font-mono"
                  >
                    {`CRPD: ${roadsideDev.deviceId} (${roadsideDev.connected ? "ONLINE" : "OFFLINE"})`}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}

      {/* 5. General Vehicles (Interactive with Selection & Speeds) */}
      {showVehicles &&
        data.vehicles.map((vehicle) => {
          if (liveEmergency && vehicle.id === liveEmergency.vehicleId) return null;
          if (vehicle.id.startsWith("emv-")) return null;
          const isSelected = selectedVehicleId === vehicle.id;
          const r = vehicleRadius(geometry, vehicle.typeId);
          const vy = flipY(vehicle.positionY, geometry);

          return (
            <g
              key={`v-${vehicle.id}`}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectVehicle(isSelected ? null : vehicle.id);
              }}
            >
              {isSelected && (
                <circle
                  cx={vehicle.positionX}
                  cy={vy}
                  r={r * 2.8}
                  fill="none"
                  stroke="#42B8FF"
                  strokeWidth={1.4}
                  strokeDasharray="3 2"
                />
              )}
              <circle
                cx={vehicle.positionX}
                cy={vy}
                r={isSelected ? r * 1.5 : r}
                fill={isSelected ? "#42B8FF" : vehicle.typeId.includes("bus") ? "#F59E0B" : "#94A3B8"}
                fillOpacity={isSelected ? 1 : 0.8}
              />
              {isSelected && (
                <g transform={`translate(${vehicle.positionX}, ${vy - r - 8})`}>
                  <rect
                    x={-35}
                    y={-12}
                    width={70}
                    height={13}
                    rx={2.5}
                    fill="#0A0F16"
                    fillOpacity={0.92}
                    stroke="rgba(66, 184, 255, 0.5)"
                    strokeWidth={0.8}
                  />
                  <text
                    x={0}
                    y={-3}
                    textAnchor="middle"
                    fontSize={7.5}
                    fill="#42B8FF"
                    className="font-mono font-bold select-none"
                  >
                    {`${vehicle.id} · ${Math.round(vehicle.speed * 3.6)} km/h`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

      {/* 6. Active Emergency Vehicle: Dominant Visual Hero */}
      {showEmergencies && liveEmergency && (
        <EmergencyMarker
          x={liveEmergency.positionX}
          y={flipY(liveEmergency.positionY, geometry)}
          angle={liveEmergency.angle}
          label={getVehicleDisplay(liveEmergency.vehicleId, liveEmergency.type)}
          speedMps={liveEmergency.speedMps}
          iconSize={iconSize(geometry)}
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Emergency Vehicle SVG Marker
// ---------------------------------------------------------------------------

function EmergencyMarker({
  x,
  y,
  angle,
  label,
  speedMps,
  iconSize: size,
}: {
  x: number;
  y: number;
  angle: number;
  label: string;
  speedMps: number;
  iconSize: number;
}) {
  const kmh = Math.round(speedMps * 3.6);
  return (
    <g transform={`translate(${round1(x)}, ${round1(y)})`} data-testid="emergency-marker">
      {/* Pulsing Siren Radar Halo */}
      <circle
        r={size * 1.5}
        fill="#FF3B4E"
        fillOpacity={0.22}
        className="itms-emergency-halo"
      />
      {/* Heading Direction Arrow & Oriented Vehicle Body */}
      <g transform={`rotate(${angle})`}>
        {/* Forward Heading Direction Chevron */}
        <polygon
          points={`0,${-size * 1.3} ${size * 0.48},${-size * 0.35} 0,${-size * 0.6} ${-size * 0.48},${-size * 0.35}`}
          fill="#FF3B4E"
          stroke="#FFFFFF"
          strokeWidth={0.8}
        />
        {/* Vehicle Body Representation Attached to Road */}
        <rect
          x={-size * 0.36}
          y={-size * 0.62}
          width={size * 0.72}
          height={size * 1.24}
          rx={size * 0.15}
          fill="#FFFFFF"
          stroke="#FF3B4E"
          strokeWidth={1.4}
        />
        {/* Red Cross on Roof */}
        <rect x={-size * 0.08} y={-size * 0.22} width={size * 0.16} height={size * 0.44} fill="#FF3B4E" />
        <rect x={-size * 0.22} y={-size * 0.08} width={size * 0.44} height={size * 0.16} fill="#FF3B4E" />
        {/* Siren Strobe Lights */}
        <circle cx={-size * 0.2} cy={-size * 0.45} r={size * 0.09} fill="#42B8FF" className="animate-ping" />
        <circle cx={size * 0.2} cy={-size * 0.45} r={size * 0.09} fill="#FF3B4E" className="animate-ping" />
      </g>
      {/* Speed & Human Label */}
      <g transform={`translate(0, ${size * 1.5})`}>
        <rect
          x={-44}
          y={-7}
          width={88}
          height={14}
          rx={3}
          fill="#0A0F16"
          fillOpacity={0.92}
          stroke="rgba(255, 59, 78, 0.4)"
          strokeWidth={0.8}
        />
        <text
          x={0}
          y={3.5}
          textAnchor="middle"
          fontSize={size * 0.48}
          fill="#FFA4AE"
          className="font-mono font-bold select-none"
        >
          {`${label} · ${kmh} km/h`}
        </text>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Floating Active Corridor HUD Overlay
// ---------------------------------------------------------------------------

function ActiveCorridorHUD({
  corridor,
  emergency,
}: {
  corridor: CorridorDetail;
  emergency: EmergencyEventDetail | null;
}) {
  const signals = corridor.signals ?? [];
  const passedCount = signals.filter(
    (s) => s.status === "PASSED" || s.stage === "PASSED" || s.stage === "RESTORING"
  ).length;
  const totalCount = signals.length;

  const unpassedSignals = signals.filter(
    (s) => s.status !== "PASSED" && s.stage !== "PASSED" && s.stage !== "RESTORING"
  );
  const currentSignal = unpassedSignals[0] ?? null;
  const nextSignal = unpassedSignals[1] ?? null;
  const upcomingSignal = unpassedSignals[2] ?? null;

  const destEtaSeconds = emergency?.etas?.find((e) => e.isDestination)?.etaSeconds ?? null;
  const destMeta = emergency ? getJunctionMeta(emergency.destinationJunction) : null;
  const destName = destMeta?.name ?? "City Hospital";

  const formatEta = (seconds: number | null) => {
    if (seconds === null) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rounded-xl border border-[rgba(24,216,139,0.35)] bg-[#0A0F16]/95 p-3 backdrop-blur-md shadow-2xl text-xs space-y-2 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-1.5 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#18D88B] shadow-[0_0_8px_#18D88B] animate-pulse" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#18D88B]">
            GREEN CORRIDOR ACTIVE
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#8D9AAA]">
          {passedCount} / {totalCount} junctions
        </span>
      </div>

      {/* Vehicle & Target Route */}
      <div className="flex items-center justify-between font-mono text-[10px]">
        <div className="text-[#F4F7FA] font-semibold truncate max-w-[130px]">
          {emergency ? getVehicleDisplay(emergency.vehicle?.vehicleId, emergency.vehicle?.type) : "Ambulance"}
        </div>
        <div className="text-[#8D9AAA] flex items-center gap-1 text-[10px]">
          <span>→</span>
          <span className="text-[#42B8FF] font-semibold truncate max-w-[110px]">{destName}</span>
        </div>
      </div>

      {/* CURRENT JUNCTION */}
      {currentSignal ? (
        <div className="rounded-lg border border-[#18D88B]/40 bg-[#18D88B]/10 p-2 font-mono">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-[#18D88B] font-bold">
            <span>CURRENT</span>
            <span className="rounded bg-[#18D88B] px-1.5 py-0.2 text-[9px] font-black text-[#05070B]">
              {currentSignal.stage ?? (currentSignal.status === "APPLIED" ? "GREEN" : "ACTIVE")}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#F4F7FA]">
            {getJunctionMeta(currentSignal.junctionId).fullName}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8D9AAA]">
            ETA: <span className="font-bold text-[#18D88B]">{Math.max(0, Math.round(currentSignal.etaSeconds))}s</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#121A24] p-1.5 font-mono text-center text-[#8D9AAA] text-[10px]">
          All Corridor Junctions Cleared
        </div>
      )}

      {/* NEXT JUNCTION */}
      {nextSignal && (
        <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#121A24] p-2 font-mono">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-[#FFB547] font-bold">
            <span>NEXT</span>
            <span className="text-[#FFB547]">
              {nextSignal.stage ?? "PREPARING"}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#F4F7FA]">
            {getJunctionMeta(nextSignal.junctionId).fullName}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8D9AAA]">
            ETA: <span className="font-bold text-[#F4F7FA]">{Math.max(0, Math.round(nextSignal.etaSeconds))}s</span>
          </div>
        </div>
      )}

      {/* UPCOMING JUNCTION(S) */}
      {upcomingSignal && (
        <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#0E141D] p-1.5 font-mono">
          <div className="text-[9px] uppercase tracking-wider text-[#5E6B7A]">UPCOMING</div>
          <div className="text-[10px] text-[#8D9AAA] truncate">
            {getJunctionMeta(upcomingSignal.junctionId).fullName}
          </div>
        </div>
      )}

      {/* Destination & Overall ETA Footer */}
      <div className="pt-1.5 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between font-mono text-[10px]">
        <div>
          <span className="text-[#5E6B7A]">DESTINATION:</span>{" "}
          <span className="text-[#F4F7FA] font-bold">{destName}</span>
        </div>
        <div>
          <span className="text-[#5E6B7A]">ETA:</span>{" "}
          <span className="text-[#FF3B4E] font-bold">{formatEta(destEtaSeconds)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side Inspector Drawer for Clicked Intersection
// ---------------------------------------------------------------------------

function IntersectionInspector({
  junctionId,
  data,
  roadsideDevice,
  onClose,
  onOpenCopilot,
}: {
  junctionId: string;
  data: SimulationMapData;
  roadsideDevice?: RoadsideDeviceRecord;
  onClose: () => void;
  onOpenCopilot?: (question?: string, context?: { intersectionId?: string }) => void;
}) {
  const meta = getJunctionMeta(junctionId);
  const signal = data.signals.find((s) => s.id === junctionId);
  const corrSignal = data.corridor?.signals.find((s) => s.junctionId === junctionId);
  const emergency = data.emergency;
  const isApplied = corrSignal?.status === "APPLIED";
  const isPending = corrSignal?.status === "PENDING";
  const etaSec = corrSignal ? Math.round(corrSignal.etaSeconds) : null;

  return (
    <div className="absolute right-3 top-16 bottom-14 z-30 flex w-80 flex-col rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0A0F16]/95 backdrop-blur-md shadow-2xl overflow-hidden font-sans animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0E141D] p-3">
        <div>
          <div className="font-semibold text-sm text-[#F4F7FA]">{meta.fullName}</div>
          <div className="font-mono text-[10px] text-[#5E6B7A]">SUMO ID: {junctionId}</div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA]"
        >
          ✕
        </button>
      </div>

      {/* Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 font-mono text-xs">
        {/* Signal Status */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#121A24] p-3">
          <div className="text-[10px] uppercase text-[#5E6B7A]">Current Signal Phase</div>
          <div className="mt-1 flex items-center justify-between">
            <span
              className="text-base font-bold"
              style={{
                color: isApplied
                  ? "#18D88B"
                  : signal
                  ? signalDominantColor(signal.state)
                  : "#8D9AAA",
              }}
            >
              {isApplied
                ? "GREEN (PRIORITY)"
                : signal
                ? signalDominantLabel(signal.state)
                : "UNCONTROLLED"}
            </span>
            <span className="rounded bg-[#05070B] px-2 py-0.5 text-[10px] text-[#8D9AAA]">
              {isApplied ? "CORRIDOR OVERRIDE" : "NORMAL CYCLE"}
            </span>
          </div>
        </div>

        {/* Corridor Priority Status */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#121A24] p-3">
          <div className="text-[10px] uppercase text-[#5E6B7A]">Green Corridor Status</div>
          <div className="mt-1 flex items-center justify-between">
            <span
              className="font-bold"
              style={{
                color: isApplied
                  ? "#18D88B"
                  : isPending
                  ? "#FFB547"
                  : "#8D9AAA",
              }}
            >
              {isApplied
                ? "ACTIVE PREEMPTION"
                : isPending
                ? "PREPARING (WINDOW RESERVED)"
                : "NO ACTIVE OVERRIDE"}
            </span>
          </div>
          {etaSec !== null && (
            <div className="mt-1 text-[11px] text-[#8D9AAA]">
              Emergency Arrival ETA: <span className="font-bold text-[#F4F7FA]">{etaSec}s</span>
            </div>
          )}
        </div>

        {/* Emergency Info if approaching */}
        {emergency && (
          <div className="rounded-lg border border-[#FF3B4E]/20 bg-[#FF3B4E]/10 p-3">
            <div className="text-[10px] uppercase text-[#FFA4AE]">Active Emergency En Route</div>
            <div className="mt-1 text-xs font-semibold text-[#F4F7FA]">
              {getVehicleDisplay(emergency.vehicle?.vehicleId, emergency.vehicle?.type)}
            </div>
            <div className="mt-1 text-[10px] text-[#8D9AAA]">
              From {getJunctionMeta(emergency.originJunction).code} → {getJunctionMeta(emergency.destinationJunction).code}
            </div>
          </div>
        )}

        {/* Roadside Priority Display (CRPD) Integration */}
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#121A24] p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase text-[#5E6B7A]">Roadside Priority Display</div>
            {roadsideDevice ? (
              <span className={`text-[10px] font-bold ${roadsideDevice.connected ? "text-[#18D88B]" : "text-[#5E6B7A]"}`}>
                {roadsideDevice.connected ? "● ONLINE" : "○ OFFLINE"}
              </span>
            ) : null}
          </div>
          {roadsideDevice ? (
            <div className="mt-2 space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8D9AAA]">Device ID</span>
                <span className="font-bold text-[#F4F7FA]">{roadsideDevice.deviceId}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8D9AAA]">Display State</span>
                <span
                  className={`font-semibold ${
                    isApplied
                      ? "text-[#18D88B]"
                      : isPending
                      ? "text-[#FFB547]"
                      : "text-[#8D9AAA]"
                  }`}
                >
                  {isApplied
                    ? "GREEN CORRIDOR ACTIVE"
                    : isPending
                    ? "PREPARING CORRIDOR"
                    : "NORMAL TRAFFIC"}
                </span>
              </div>
              {emergency && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#8D9AAA]">Priority Vehicle</span>
                  <span className="font-bold text-[#FF3B4E] uppercase">
                    {emergency.vehicle?.type || "AMBULANCE"}
                  </span>
                </div>
              )}
              {etaSec !== null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#8D9AAA]">Arrival ETA</span>
                  <span className="font-bold text-[#18D88B]">{etaSec}s</span>
                </div>
              )}
              <div className="pt-2">
                <a
                  href={`http://localhost:3002/display?device=${encodeURIComponent(roadsideDevice.deviceId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-1.5 rounded bg-[#06b6d4]/10 hover:bg-[#06b6d4]/20 border border-[#06b6d4]/30 py-1.5 text-[10px] font-semibold text-[#06b6d4] transition shadow-[0_0_8px_rgba(6,182,212,0.15)]"
                >
                  <span>📱 OPEN ROADSIDE DISPLAY ↗</span>
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-[#5E6B7A]">
              No roadside hardware provisioned for this junction
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 space-y-2">
          {onOpenCopilot && (
            <button
              onClick={() => onOpenCopilot(`Why is ${meta.code} (${meta.name}) in this signal phase?`, { intersectionId: junctionId })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[rgba(139,124,255,0.15)] border border-[#8B7CFF]/30 py-2 text-xs font-semibold text-[#8B7CFF] hover:bg-[rgba(139,124,255,0.25)] transition-all"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>WHY THIS SIGNAL?</span>
            </button>
          )}

          <Link
            href="/signals"
            className="flex w-full items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0E141D] py-2 text-xs text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA] transition-all"
          >
            VIEW FULL SIGNAL PLAN
          </Link>

          <Link
            href="/traffic"
            className="flex w-full items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0E141D] py-2 text-xs text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA] transition-all"
          >
            VIEW TRAFFIC TELEMETRY
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry & Math Utilities
// ---------------------------------------------------------------------------

function latLngToSumoPoint(
  lat: number,
  lng: number,
  geometry: NetworkGeometryResponse
): { x: number; y: number } | null {
  if (!geometry.geoExtent) return null;
  const { minLat, maxLat, minLng, maxLng } = geometry.geoExtent;
  const { minX, maxX, minY, maxY } = geometry.extent;
  if (maxLat <= minLat || maxLng <= minLng) return null;

  const fracX = (lng - minLng) / (maxLng - minLng);
  const fracY = (lat - minLat) / (maxLat - minLat);
  const x = minX + fracX * (maxX - minX);
  const y = minY + fracY * (maxY - minY);
  return { x, y };
}

function flipY(y: number, geometry: NetworkGeometryResponse): number {
  const { minY, maxY } = geometry.extent;
  return minY + maxY - y;
}

function flippedPoints(
  shape: Array<{ x: number; y: number }>,
  geometry: NetworkGeometryResponse
): string {
  return shape.map((point) => `${round1(point.x)},${round1(flipY(point.y, geometry))}`).join(" ");
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaleFactor(geometry: NetworkGeometryResponse): number {
  const span = Math.max(
    geometry.extent.maxX - geometry.extent.minX,
    geometry.extent.maxY - geometry.extent.minY
  );
  return clamp(span / 700, 0.8, 28);
}

function casingWidth(laneCount: number, geometry?: NetworkGeometryResponse): number {
  const sf = geometry ? Math.max(1, scaleFactor(geometry) * 0.35) : 1;
  return Math.max(2.2, laneCount * 2.6 + 1.2) * sf;
}

function laneStrokeWidth(laneCount: number, geometry?: NetworkGeometryResponse): number {
  return Math.max(1.4, (casingWidth(laneCount, geometry) - 0.8) / Math.max(1, laneCount));
}

function vehicleRadius(geometry: NetworkGeometryResponse, typeId: string): number {
  const base = 2.4 * scaleFactor(geometry);
  if (typeId.includes("bus") || typeId.includes("truck")) return base * 1.35;
  return base;
}

function signalRadius(geometry: NetworkGeometryResponse): number {
  return 3.2 * scaleFactor(geometry);
}

function iconSize(geometry: NetworkGeometryResponse): number {
  return 7 * scaleFactor(geometry);
}

function signalDominantColor(state: string): string {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return "#18D88B";
  if (yellows > 0 && greens === 0) return "#FFB547";
  if (greens > 0) return "#42B8FF";
  return "#FF4757";
}

function signalDominantLabel(state: string): string {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return "GREEN";
  if (yellows > 0 && greens === 0) return "YELLOW";
  if (greens > 0) return "GREEN+YEL";
  return "RED";
}
