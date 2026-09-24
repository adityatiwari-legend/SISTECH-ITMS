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
} from "@itms/types";
import { CONGESTION_COLORS, simClock } from "@/lib/format";
import { getJunctionMeta, getVehicleDisplay } from "@/lib/naming";
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
          <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0A0F16]/95 p-3 backdrop-blur-md shadow-2xl text-xs space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-1 border-b border-[rgba(255,255,255,0.06)] font-mono text-[9px] uppercase tracking-wider text-[#5E6B7A]">
              <span>MAP VISUAL LEGEND</span>
              <button onClick={() => setShowLegend(false)} className="text-[#5E6B7A] hover:text-[#F4F7FA]">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#94A3B8]" />
                <span className="text-[#8D9AAA]">Normal Vehicle</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">🚑</span>
                <span className="text-[#FF3B4E] font-medium">Emergency Unit</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-4 rounded bg-[#18D88B]" />
                <span className="text-[#18D88B]">Active Corridor</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-4 rounded bg-[#FFB547]" />
                <span className="text-[#FFB547]">Preparing Phase</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-4 rounded bg-[#FF3B4E]" />
                <span className="text-[#FF3B4E]">Emergency Route</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">🏥</span>
                <span className="text-[#8D9AAA]">Hospital Base</span>
              </div>
            </div>
          </div>
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
}) {
  const geometry = data.geometry!;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [view, setView] = React.useState({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  const [hoveredJunctionId, setHoveredJunctionId] = React.useState<string | null>(null);

  // Reset viewport when network geometry changes
  React.useEffect(() => {
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox]);

  // FOLLOW EMERGENCY LOGIC: Smooth tracking without violent snaps
  React.useEffect(() => {
    if (!isFollowingEmergency || !data.emergency?.live) return;
    const emX = data.emergency.live.positionX;
    const emY = flipY(data.emergency.live.positionY, geometry);
    const aspect = viewBox.height / viewBox.width;
    const followW = viewBox.width * 0.42;

    setView((prev) => {
      // Lerp (smooth interpolation) towards target
      const targetX = emX - followW / 2;
      const targetY = emY - (followW * aspect) / 2;
      return {
        x: prev.x + (targetX - prev.x) * 0.25,
        y: prev.y + (targetY - prev.y) * 0.25,
        w: prev.w + (followW - prev.w) * 0.25,
      };
    });
  }, [isFollowingEmergency, data.emergency?.live, geometry, viewBox]);

  // Zoom controls
  const zoomIn = React.useCallback(() => {
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
  }, [viewBox]);

  const zoomOut = React.useCallback(() => {
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
  }, [viewBox]);

  const fitNetwork = React.useCallback(() => {
    setIsFollowingEmergency(false);
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox, setIsFollowingEmergency]);

  // FOCUS CORRIDOR: Fits emergency vehicle + all upcoming corridor junctions + destination
  const focusCorridor = React.useCallback(() => {
    setIsFollowingEmergency(false);
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

          {data.emergency && (
            <button
              onClick={() => setIsFollowingEmergency(!isFollowingEmergency)}
              className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold transition-colors ${
                isFollowingEmergency
                  ? "bg-[#FF3B4E] text-[#05070B] font-bold"
                  : "text-[#FF3B4E] hover:bg-[rgba(255,59,78,0.15)]"
              }`}
              title="Smoothly track emergency vehicle"
            >
              <Icons.CenterTarget className="h-3 w-3" />
              <span>{isFollowingEmergency ? "FOLLOWING" : "FOLLOW EMERGENCY"}</span>
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
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.w * (viewBox.height / viewBox.width)}
          fill="#070A0F"
        />

        {/* 1. Static Road Network */}
        <StaticLayer geometry={geometry} showFacilities={showFacilities} />

        {/* 2. Dynamic TraCI Overlays */}
        <DynamicLayer
          data={data}
          showTraffic={showTraffic}
          showSignals={showSignals}
          showVehicles={showVehicles}
          showEmergencies={showEmergencies}
          showCorridor={showCorridor}
          selectedJunctionId={selectedJunctionId}
          hoveredJunctionId={hoveredJunctionId}
          onSelectJunction={onSelectJunction}
          onHoverJunction={setHoveredJunctionId}
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
    const out: Array<{ key: string; points: string; width: number }> = [];
    for (const segment of geometry.segments) {
      const laneWidth = laneStrokeWidth(segment.laneCount);
      for (const lane of segment.lanes) {
        out.push({
          key: lane.id,
          points: flippedPoints(lane.shape, geometry),
          width: laneWidth,
        });
      }
    }
    return out;
  }, [geometry]);

  return (
    <g>
      {/* Subtle Road Casing (clean dark charcoal) */}
      {geometry.segments.map((segment) => (
        <polyline
          key={`casing-${segment.id}`}
          points={flippedPoints(segment.coordinates, geometry)}
          fill="none"
          stroke="#111622"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={casingWidth(segment.laneCount)}
        />
      ))}

      {/* Individual lane polylines (precise SUMO lanes) */}
      {lanes.map((lane) => (
        <polyline
          key={lane.key}
          points={lane.points}
          fill="none"
          stroke="#18202C"
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
  showTraffic,
  showSignals,
  showVehicles,
  showEmergencies,
  showCorridor,
  selectedJunctionId,
  hoveredJunctionId,
  onSelectJunction,
  onHoverJunction,
}: {
  data: SimulationMapData;
  showTraffic: boolean;
  showSignals: boolean;
  showVehicles: boolean;
  showEmergencies: boolean;
  showCorridor: boolean;
  selectedJunctionId: string | null;
  hoveredJunctionId: string | null;
  onSelectJunction: (id: string | null) => void;
  onHoverJunction: (id: string | null) => void;
}) {
  const geometry = data.geometry;
  if (!geometry) return null;

  const corridorSignals = data.corridor?.signals ?? [];
  const corridorApproaches = new Set(
    corridorSignals
      .filter((s) => s.status === "APPLIED" || s.status === "PASSED" || s.status === "PENDING")
      .map((s) => s.approachSegmentId)
  );

  const routeSegmentIds = new Set(
    (data.emergency?.route?.segments ?? []).map((s) => s.segmentId)
  );
  const trafficBySegment = new Map(
    data.trafficSegments.map((s) => [s.segmentId, s] as const)
  );
  const signalById = new Map(data.signals.map((s) => [s.id, s] as const));
  const emergency = data.emergency;
  const emergencyVehicleId = emergency?.vehicle?.vehicleId ?? null;

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
              strokeWidth={casingWidth(segment.laneCount) * 0.72}
            />
          );
        })}

      {/* 2. Calculated A* Emergency Route */}
      {routeSegmentIds.size > 0 &&
        geometry.segments
          .filter((segment) => routeSegmentIds.has(segment.id))
          .map((segment) => (
            <polyline
              key={`route-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke="#FF3B4E"
              strokeOpacity={0.85}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.85}
            />
          ))}

      {/* 3. Predictive Green Corridor Flow */}
      {showCorridor &&
        corridorApproaches.size > 0 &&
        geometry.segments
          .filter((segment) => corridorApproaches.has(segment.id))
          .map((segment) => (
            <polyline
              key={`corridor-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke="#18D88B"
              strokeOpacity={0.95}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.92}
              className="itms-corridor-flow"
            />
          ))}

      {/* 4. Clickable Intersections (Controlled + Uncontrolled) */}
      {geometry.junctions.map((junction) => {
        const signal = signalById.get(junction.id);
        const corrSignal = corridorSignals.find((s) => s.junctionId === junction.id);
        const meta = getJunctionMeta(junction.id);
        const isSelected = selectedJunctionId === junction.id;
        const isHovered = hoveredJunctionId === junction.id;

        const isApplied = corrSignal?.status === "APPLIED";
        const isPending = corrSignal?.status === "PENDING";
        const isPassed = corrSignal?.status === "PASSED";

        let fillColor = "#1E293B"; // default uncontrolled
        if (junction.controlled && signal && showSignals) {
          fillColor = isApplied
            ? "#18D88B"
            : isPending
            ? "#FFB547"
            : isPassed
            ? "#475569"
            : signalDominantColor(signal.state);
        }

        const r = signalRadius(geometry) * (isSelected ? 1.4 : isHovered ? 1.25 : 1);

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
                cy={flipY(junction.y, geometry)}
                r={r * 1.8}
                fill="none"
                stroke="#42B8FF"
                strokeWidth={2}
                className="animate-pulse"
              />
            )}

            {/* Junction circle */}
            <circle
              cx={junction.x}
              cy={flipY(junction.y, geometry)}
              r={r}
              fill={fillColor}
              stroke="#05070B"
              strokeWidth={1.5}
            />

            {/* Human-readable label on map */}
            <text
              x={junction.x}
              y={flipY(junction.y, geometry) - r - 3}
              textAnchor="middle"
              fontSize={signalRadius(geometry) * 0.9}
              fill={isSelected ? "#42B8FF" : isHovered ? "#F4F7FA" : "#94A3B8"}
              className="font-mono font-bold select-none"
            >
              {meta.code}
            </text>

            {/* Hover Tooltip Card in SVG */}
            {isHovered && !isSelected && (
              <g
                transform={`translate(${junction.x + 8}, ${flipY(junction.y, geometry) - 30})`}
                className="pointer-events-none"
              >
                <rect
                  width={150}
                  height={54}
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
                <text x={8} y={44} fill={isApplied ? "#18D88B" : isPending ? "#FFB547" : "#5E6B7A"} fontSize={8} className="font-mono">
                  {isApplied
                    ? "Priority: GREEN (Corridor)"
                    : isPending
                    ? "Corridor: PREPARING"
                    : `SUMO ID: ${junction.id}`}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 5. General Vehicles (Muted Dots, Real TraCI coordinates) */}
      {showVehicles &&
        data.vehicles.map((vehicle) => {
          if (vehicle.id === emergencyVehicleId) return null;
          return (
            <g
              key={`v-${vehicle.id}`}
              style={{
                transform: `translate(${vehicle.positionX}px, ${flipY(
                  vehicle.positionY,
                  geometry
                )}px)`,
                transition: "transform 200ms linear",
              }}
            >
              <circle
                r={vehicleRadius(geometry, vehicle.typeId)}
                fill="#64748B"
                fillOpacity={0.75}
              />
            </g>
          );
        })}

      {/* 6. Active Emergency Vehicle: Dominant Visual Hero */}
      {showEmergencies && emergency && emergency.live && (
        <EmergencyMarker
          x={emergency.live.positionX}
          y={flipY(emergency.live.positionY, geometry)}
          angle={emergency.live.angle ?? 0}
          label={getVehicleDisplay(emergency.vehicle?.vehicleId, emergency.vehicle?.type)}
          speedMps={emergency.live.speedMps}
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
    <g
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: "transform 200ms linear",
      }}
      data-testid="emergency-marker"
    >
      {/* Pulsing Siren Radar Halo */}
      <circle
        r={size * 1.5}
        fill="#FF3B4E"
        fillOpacity={0.25}
        className="itms-emergency-halo"
      />
      {/* Heading Direction Arrow */}
      <g transform={`rotate(${angle})`}>
        <path
          d={`M 0 ${-size * 1.15} L ${size * 0.6} ${size * 0.5} L 0 ${size * 0.1} L ${
            -size * 0.6
          } ${size * 0.5} Z`}
          fill="#FF3B4E"
          fillOpacity={0.95}
        />
      </g>
      {/* Ambulance Icon */}
      <text textAnchor="middle" dominantBaseline="central" fontSize={size * 1.1}>
        🚑
      </text>
      {/* Speed & Human Label */}
      <text
        x={0}
        y={size * 1.7}
        textAnchor="middle"
        fontSize={size * 0.52}
        fill="#FFA4AE"
        className="font-mono font-bold select-none"
      >
        {`${label} · ${kmh} km/h`}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Side Inspector Drawer for Clicked Intersection
// ---------------------------------------------------------------------------

function IntersectionInspector({
  junctionId,
  data,
  onClose,
  onOpenCopilot,
}: {
  junctionId: string;
  data: SimulationMapData;
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
  return clamp(span / 700, 0.8, 6);
}

function casingWidth(laneCount: number): number {
  return Math.max(2.2, laneCount * 2.6 + 1.2);
}

function laneStrokeWidth(laneCount: number): number {
  return Math.max(1.4, (casingWidth(laneCount) - 0.8) / Math.max(1, laneCount));
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
