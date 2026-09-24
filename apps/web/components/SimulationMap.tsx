"use client";

import React from "react";
import type {
  CongestionLevel,
  CorridorDetail,
  EmergencyEventDetail,
  NetworkGeometryResponse,
  SignalSnapshot,
  VehicleSnapshot,
} from "@itms/types";
import { CONGESTION_COLORS, simClock } from "@/lib/format";
import { Icons } from "./ui";

/**
 * SUMO NETWORK VISUALIZATION — AUTHORITATIVE MISSION CONTROL MAP
 *
 * ARCHITECTURE:
 * - SUMO is the authoritative traffic world. Road geometry is derived from
 *   /api/network/geometry (real net.xml shapes, lanes, junctions).
 * - TraCI streams vehicles, signals, routes, and emergencies via WebSockets.
 * - This component is pure SVG with CSS transform interpolation between updates.
 * - Map controls: Zoom (+/-), Fit Network, Center Emergency, and Layer Toggles.
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
}: {
  data: SimulationMapData;
  className?: string;
  highlightTraffic?: boolean;
}) {
  const geometry = data.geometry;
  const viewBox = React.useMemo(() => {
    if (geometry === null) return DEFAULT_VIEWBOX;
    const pad = 14;
    const minX = geometry.extent.minX - pad;
    const minY = geometry.extent.minY - pad;
    const width = Math.max(50, geometry.extent.maxX - geometry.extent.minX + pad * 2);
    const height = Math.max(50, geometry.extent.maxY - geometry.extent.minY + pad * 2);
    return { minX, minY, width, height };
  }, [geometry]);

  // Layer toggles
  const [showTraffic, setShowTraffic] = React.useState(highlightTraffic);
  const [showSignals, setShowSignals] = React.useState(true);
  const [showCorridor, setShowCorridor] = React.useState(true);

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[#070A0F] ${className}`}
      data-testid="simulation-map"
    >
      {geometry === null ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="font-mono text-xs uppercase tracking-wider text-[#FFB547]">
            ⚠ SUMO Network Connecting…
          </span>
          <span className="max-w-sm font-mono text-[11px] leading-relaxed text-[#5E6B7A]">
            Waiting for authoritative SUMO network geometry from /api/network/geometry.
          </span>
        </div>
      ) : (
        <NetworkCanvas
          viewBox={viewBox}
          data={data}
          showTraffic={showTraffic}
          showSignals={showSignals}
          showCorridor={showCorridor}
          onToggleTraffic={() => setShowTraffic(!showTraffic)}
          onToggleSignals={() => setShowSignals(!showSignals)}
          onToggleCorridor={() => setShowCorridor(!showCorridor)}
        />
      )}

      {/* Top-Left Network Identity Chip */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
        <span
          className="rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider backdrop-blur-md shadow-sm"
          style={{
            color: geometry?.geoReferenced ? "#18D88B" : "#FFB547",
          }}
        >
          {geometry?.geoReferenced
            ? `● SUMO NETWORK — ${(geometry.demoCity ?? "Bhopal").toUpperCase()}`
            : "⚠ SUMO NETWORK (SYNTHETIC GRID)"}
        </span>
      </div>

      {/* Bottom-Left Live Simulation Clock Overlay */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 font-mono text-[11px]">
        <div className="flex items-center gap-2 rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-2.5 py-1 backdrop-blur-md">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#18D88B]" />
          <span className="text-[10px] text-[#5E6B7A] uppercase">SIM TIME</span>
          <span className="font-bold text-[#F4F7FA]">
            {simClock(data.simTimeSeconds ?? null)}
          </span>
        </div>
      </div>

      {/* Bottom-Right Summary Overlay */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden items-center gap-2 font-mono text-[10px] sm:flex">
        <div className="flex items-center gap-3 rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 px-2.5 py-1 text-[#8D9AAA] backdrop-blur-md">
          <span>{data.vehicles.length} VEHICLES</span>
          <span>·</span>
          <span>{data.signals.length} SIGNALS</span>
          {data.corridor && data.corridor.status === "ACTIVE" && (
            <>
              <span>·</span>
              <span className="font-bold text-[#8B7CFF]">CORRIDOR ACTIVE</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NetworkCanvas({
  viewBox,
  data,
  showTraffic,
  showSignals,
  showCorridor,
  onToggleTraffic,
  onToggleSignals,
  onToggleCorridor,
}: {
  viewBox: { minX: number; minY: number; width: number; height: number };
  data: SimulationMapData;
  showTraffic: boolean;
  showSignals: boolean;
  showCorridor: boolean;
  onToggleTraffic: () => void;
  onToggleSignals: () => void;
  onToggleCorridor: () => void;
}) {
  const geometry = data.geometry!;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [view, setView] = React.useState({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });

  // Reset viewport when network changes
  React.useEffect(() => {
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox]);

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
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox]);

  const centerEmergency = React.useCallback(() => {
    if (!data.emergency?.live) return;
    const emX = data.emergency.live.positionX;
    const emY = flipY(data.emergency.live.positionY, geometry);
    const aspect = viewBox.height / viewBox.width;
    const focusW = viewBox.width * 0.45;
    setView({
      x: emX - focusW / 2,
      y: emY - (focusW * aspect) / 2,
      w: focusW,
    });
  }, [data.emergency, geometry, viewBox]);

  // Wheel zoom
  const onWheel = React.useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
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
    [viewBox.width]
  );

  // Drag pan
  const dragRef = React.useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      dragRef.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [view.x, view.y]
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

  return (
    <div className="relative h-full w-full">
      {/* ================================================================== */}
      {/* TOP-RIGHT MAP CONTROLS OVERLAY                                    */}
      {/* ================================================================== */}
      <div className="absolute right-3 top-3 z-20 flex flex-wrap items-center gap-1.5">
        <div className="flex items-center rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 p-0.5 backdrop-blur-md shadow-lg">
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
            title="Reset Network Extent"
          >
            <Icons.FitView className="h-3 w-3" />
            <span className="hidden sm:inline">FIT</span>
          </button>
          {data.emergency && (
            <button
              onClick={centerEmergency}
              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-semibold text-[#FF3B4E] hover:bg-[rgba(255,59,78,0.15)] transition-colors animate-pulse"
              title="Center on Emergency Vehicle"
            >
              <Icons.CenterTarget className="h-3 w-3" />
              <span>EMERGENCY</span>
            </button>
          )}
        </div>

        {/* Layer Toggles */}
        <div className="hidden sm:flex items-center rounded border border-[rgba(255,255,255,0.08)] bg-[#0A0F16]/90 p-0.5 backdrop-blur-md shadow-lg font-mono text-[10px]">
          <button
            onClick={onToggleTraffic}
            className={`rounded px-2 py-1 transition-colors ${
              showTraffic
                ? "bg-[#121A24] text-[#42B8FF] font-semibold"
                : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Traffic Congestion Overlay"
          >
            TRAFFIC
          </button>
          <button
            onClick={onToggleSignals}
            className={`rounded px-2 py-1 transition-colors ${
              showSignals
                ? "bg-[#121A24] text-[#18D88B] font-semibold"
                : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Traffic Signals"
          >
            SIGNALS
          </button>
          <button
            onClick={onToggleCorridor}
            className={`rounded px-2 py-1 transition-colors ${
              showCorridor
                ? "bg-[#121A24] text-[#8B7CFF] font-semibold"
                : "text-[#5E6B7A] hover:text-[#8D9AAA]"
            }`}
            title="Toggle Green Corridor Flow"
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
        <StaticLayer geometry={geometry} />
        <DynamicLayer
          data={data}
          showTraffic={showTraffic}
          showSignals={showSignals}
          showCorridor={showCorridor}
        />
      </svg>
    </div>
  );
}

/**
 * Static network layer (roads/lanes/junctions/facilities):
 * Memoized to prevent repainting when dynamic vehicle positions update.
 */
const StaticLayer = React.memo(function StaticLayer({
  geometry,
}: {
  geometry: NetworkGeometryResponse;
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

  const uncontrolled = geometry.junctions.filter((j) => !j.controlled);

  return (
    <g>
      {/* Road casing (wide charcoal stroke per centerline) */}
      {geometry.segments.map((segment) => (
        <polyline
          key={`casing-${segment.id}`}
          points={flippedPoints(segment.coordinates, geometry)}
          fill="none"
          stroke="#111722"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={casingWidth(segment.laneCount)}
        />
      ))}

      {/* Individual lane polylines (actual SUMO lane geometry) */}
      {lanes.map((lane) => (
        <polyline
          key={lane.key}
          points={lane.points}
          fill="none"
          stroke="#1C2433"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={lane.width}
        />
      ))}

      {/* Uncontrolled junction nodes */}
      {uncontrolled.map((junction) => (
        <circle
          key={`j-${junction.id}`}
          cx={junction.x}
          cy={flipY(junction.y, geometry)}
          r={junctionRadius(geometry)}
          fill="#1C2534"
          stroke="#070A0F"
          strokeWidth={1}
        />
      ))}

      {/* Facilities & POIs */}
      {geometry.facilities.map((facility) => (
        <text
          key={`f-${facility.id}`}
          x={facility.x}
          y={flipY(facility.y, geometry)}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={iconSize(geometry)}
        >
          {facility.type === "hospital"
            ? "🏥"
            : facility.type === "ems" || facility.type === "ems_station"
            ? "🚑"
            : "🚒"}
        </text>
      ))}
    </g>
  );
});

/**
 * Dynamic layer: vehicles, signals, congestion overlays, corridor flows, emergency marker.
 */
function DynamicLayer({
  data,
  showTraffic,
  showSignals,
  showCorridor,
}: {
  data: SimulationMapData;
  showTraffic: boolean;
  showSignals: boolean;
  showCorridor: boolean;
}) {
  const geometry = data.geometry;
  if (geometry === null) return null;

  const corridorSignals = data.corridor?.signals ?? [];
  const corridorApproaches = new Set(
    corridorSignals
      .filter((s) => s.status === "APPLIED" || s.status === "PASSED" || s.status === "PENDING")
      .map((s) => s.approachSegmentId)
  );
  const appliedJunctions = new Set(
    corridorSignals.filter((s) => s.status === "APPLIED").map((s) => s.junctionId)
  );
  const passedJunctions = new Set(
    corridorSignals.filter((s) => s.status === "PASSED").map((s) => s.junctionId)
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

      {/* 2. Calculated A* Emergency Route Highlight */}
      {routeSegmentIds.size > 0 &&
        geometry.segments
          .filter((segment) => routeSegmentIds.has(segment.id))
          .map((segment) => (
            <polyline
              key={`route-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke="#FF3B4E"
              strokeOpacity={0.9}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.85}
            />
          ))}

      {/* 3. Green Corridor Animated Flow */}
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
              strokeWidth={casingWidth(segment.laneCount) * 0.88}
              className="itms-corridor-flow"
            />
          ))}

      {/* 4. Traffic Signal Glyphs (Real TraCI RYG State) */}
      {showSignals &&
        geometry.junctions.map((junction) => {
          const signal = signalById.get(junction.id);
          if (!junction.controlled || !signal) return null;

          const applied = appliedJunctions.has(junction.id);
          const passed = passedJunctions.has(junction.id);
          const color = applied ? "#18D88B" : signalDominantColor(signal.state);
          const label = applied
            ? `Signal ${junction.id} — EMERGENCY PRIORITY (GREEN)`
            : passed
            ? `Signal ${junction.id} — PASSED (Restored)`
            : `Signal ${junction.id} — ${signalDominantLabel(signal.state)}`;

          return (
            <g key={`sig-${junction.id}`}>
              <circle
                cx={junction.x}
                cy={flipY(junction.y, geometry)}
                r={signalRadius(geometry)}
                fill={color}
                stroke="#05070B"
                strokeWidth={1.5}
              />
              <title>{label}</title>
            </g>
          );
        })}

      {/* 5. General Vehicles: Real TraCI Coordinates with 200ms Linear Interpolation */}
      {data.vehicles.map((vehicle) => {
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
              fill="#94A3B8"
              fillOpacity={0.8}
            />
          </g>
        );
      })}

      {/* 6. Active Emergency Vehicle: Prominent Marker with Angle & Speed */}
      {emergency && emergency.live && (
        <EmergencyMarker
          x={emergency.live.positionX}
          y={flipY(emergency.live.positionY, geometry)}
          angle={emergency.live.angle ?? 0}
          label={emergency.vehicle?.vehicleId ?? "EMERGENCY"}
          speedMps={emergency.live.speedMps}
          iconSize={iconSize(geometry)}
        />
      )}
    </g>
  );
}

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
      <title>{`${label} — live SUMO position — ${kmh} km/h`}</title>
      {/* Halo ring */}
      <circle
        r={size * 1.3}
        fill="#FF3B4E"
        fillOpacity={0.2}
        className="itms-emergency-halo"
      />
      {/* TraCI Rotated Heading Arrow */}
      <g transform={`rotate(${angle})`}>
        <path
          d={`M 0 ${-size * 1.05} L ${size * 0.55} ${size * 0.45} L 0 ${size * 0.08} L ${
            -size * 0.55
          } ${size * 0.45} Z`}
          fill="#FF3B4E"
          fillOpacity={0.95}
        />
      </g>
      {/* Ambulance Icon */}
      <text textAnchor="middle" dominantBaseline="central" fontSize={size}>
        🚑
      </text>
      {/* Speed & ID Tag */}
      <text
        x={0}
        y={size * 1.6}
        textAnchor="middle"
        fontSize={size * 0.55}
        fill="#FFA4AE"
        className="font-mono font-bold"
      >
        {`${label} · ${kmh} km/h`}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Geometry Helpers
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
  const base = 2.6 * scaleFactor(geometry);
  if (typeId.includes("bus") || typeId.includes("truck")) return base * 1.4;
  return base;
}

function signalRadius(geometry: NetworkGeometryResponse): number {
  return 3.4 * scaleFactor(geometry);
}

function junctionRadius(geometry: NetworkGeometryResponse): number {
  return 2.2 * scaleFactor(geometry);
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
