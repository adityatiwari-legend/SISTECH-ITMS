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
import { CONGESTION_COLORS } from "@/lib/format";

/**
 * SUMO NETWORK VISUALIZATION — the live traffic map.
 *
 * ARCHITECTURE: SUMO is the authoritative traffic world. Road geometry comes
 * from the SUMO network (backend /api/network/geometry, generated from
 * net.xml — never invented); vehicle positions/speeds/angles, signal states,
 * routes, corridor state and simulation time come from TraCI via the backend
 * (REST bootstrap + WebSocket). This component is VISUALIZATION ONLY:
 * - it does not invent roads, positions, or signal phases;
 * - it does not animate anything independently of simulation state
 *   (CSS transitions merely interpolate BETWEEN real TraCI updates);
 * - no external map provider is used or required.
 *
 * Rendering: SVG. Coordinates are SUMO network meters, normalized into the
 * viewport with the aspect ratio preserved (preserveAspectRatio). Y is
 * flipped (SUMO y-up → SVG y-down). Wheel zoom + drag pan included.
 */

export interface SimulationMapData {
  geometry: NetworkGeometryResponse | null;
  trafficSegments: Array<{ segmentId: string; congestion: CongestionLevel; vehicleCount: number; avgSpeedMps: number }>;
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergency: EmergencyEventDetail | null;
  corridor: CorridorDetail | null;
}

const DEFAULT_VIEWBOX = { minX: -20, minY: -20, width: 700, height: 480 };

export function SimulationMap({ data, className = "", highlightTraffic = true }: { data: SimulationMapData; className?: string; highlightTraffic?: boolean }) {
  const geometry = data.geometry;
  const viewBox = React.useMemo(() => {
    if (geometry === null) return DEFAULT_VIEWBOX;
    const pad = 12;
    const minX = geometry.extent.minX - pad;
    const minY = geometry.extent.minY - pad;
    const width = Math.max(50, geometry.extent.maxX - geometry.extent.minX + pad * 2);
    const height = Math.max(50, geometry.extent.maxY - geometry.extent.minY + pad * 2);
    return { minX, minY, width, height };
  }, [geometry]);

  return (
    <div className={`relative overflow-hidden ${className}`} data-testid="simulation-map" style={{ background: "#070A0F" }}>
      {geometry === null ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#fbbf24]">⚠ SUMO network unavailable</span>
          <span className="max-w-sm text-center text-[11px] leading-relaxed text-[#6B7385]">
            Network geometry could not be loaded. Start the backend and verify the SUMO network file.
          </span>
        </div>
      ) : (
        <NetworkCanvas viewBox={viewBox} data={data} highlightTraffic={highlightTraffic} />
      )}
      {/* Network identity chip: honest labeling of what is displayed. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
        <span
          className="rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-widest"
          style={
            geometry?.geoReferenced
              ? { borderColor: "rgba(52,211,153,0.35)", backgroundColor: "rgba(7,10,15,0.85)", color: "#34d399" }
              : { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(7,10,15,0.85)", color: "#fbbf24" }
          }
        >
          {geometry?.geoReferenced
            ? `● SUMO LIVE NETWORK — ${(geometry.demoCity ?? "city").toUpperCase()}`
            : "⚠ SIMULATION NETWORK (SYNTHETIC GRID)"}
        </span>
      </div>
    </div>
  );
}

/**
 * Static network layer (roads/lanes/junctions/facilities): rendered ONCE per
 * geometry. Dynamic layer (signals/vehicles/emergency) renders per update.
 */
function NetworkCanvas({
  viewBox,
  data,
  highlightTraffic,
}: {
  viewBox: { minX: number; minY: number; width: number; height: number };
  data: SimulationMapData;
  highlightTraffic: boolean;
}) {
  const geometry = data.geometry!;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [view, setView] = React.useState({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });

  // Reset the viewport when the network changes.
  React.useEffect(() => {
    setView({ x: viewBox.minX, y: viewBox.minY, w: viewBox.width });
  }, [viewBox]);

  // ---- wheel zoom (toward the cursor) ----
  const onWheel = React.useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const svg = svgRef.current;
    if (svg === null) return;
    setView((previous) => {
      const rect = svg.getBoundingClientRect();
      const pxPerUnit = rect.width / previous.w;
      const cursorX = previous.x + (event.clientX - rect.left) / pxPerUnit;
      const cursorY = previous.y + (event.clientY - rect.top) / pxPerUnit;
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
      const w = clamp(previous.w * factor, viewBox.width / 40, viewBox.width * 1.5);
      const k = w / previous.w;
      return { x: cursorX - (cursorX - previous.x) * k, y: cursorY - (cursorY - previous.y) * k, w };
    });
  }, [viewBox.width]);

  // ---- drag pan ----
  const dragRef = React.useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const onPointerDown = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [view.x, view.y]);
  const onPointerMove = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (drag === null || svg === null) return;
    const rect = svg.getBoundingClientRect();
    const pxPerUnit = rect.width / view.w;
    setView((previous) => ({
      ...previous,
      x: drag.x - (event.clientX - drag.clientX) / pxPerUnit,
      y: drag.y - (event.clientY - drag.clientY) / pxPerUnit,
    }));
  }, [view.w]);
  const onPointerUp = React.useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
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
      <rect x={view.x} y={view.y} width={view.w} height={view.w * (viewBox.height / viewBox.width)} fill="#070A0F" />
      <StaticLayer geometry={geometry} />
      <DynamicLayer data={data} highlightTraffic={highlightTraffic} />
    </svg>
  );
}

/** Roads (real SUMO lane geometry), junction nodes, facility POIs. */
const StaticLayer = React.memo(function StaticLayer({ geometry }: { geometry: NetworkGeometryResponse }) {
  const lanes = React.useMemo(() => {
    const out: Array<{ key: string; points: string; width: number }> = [];
    for (const segment of geometry.segments) {
      const laneWidth = laneStrokeWidth(segment.laneCount);
      for (const lane of segment.lanes) {
        out.push({ key: lane.id, points: flippedPoints(lane.shape, geometry), width: laneWidth });
      }
    }
    return out;
  }, [geometry]);

  const uncontrolled = geometry.junctions.filter((junction) => !junction.controlled);

  return (
    <g>
      {/* road casing: one wide dark stroke per segment centerline */}
      {geometry.segments.map((segment) => (
        <polyline
          key={`casing-${segment.id}`}
          points={flippedPoints(segment.coordinates, geometry)}
          fill="none"
          stroke="#111721"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={casingWidth(segment.laneCount)}
        />
      ))}
      {/* individual lanes (actual SUMO lane shapes) */}
      {lanes.map((lane) => (
        <polyline
          key={lane.key}
          points={lane.points}
          fill="none"
          stroke="#1d242f"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={lane.width}
        />
      ))}
      {/* non-signalized junction nodes */}
      {uncontrolled.map((junction) => (
        <circle key={`j-${junction.id}`} cx={junction.x} cy={flipY(junction.y, geometry)} r={junctionRadius(geometry)} fill="#232c39" stroke="#0a0e14" strokeWidth={1} />
      ))}
      {/* facilities */}
      {geometry.facilities.map((facility) => (
        <text
          key={`f-${facility.id}`}
          x={facility.x}
          y={flipY(facility.y, geometry)}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={iconSize(geometry)}
        >
          {facility.type === "hospital" ? "🏥" : facility.type === "ems" || facility.type === "ems_station" ? "🚑" : "🚒"}
        </text>
      ))}
    </g>
  );
});

/**
 * Signals, congestion overlays, route, corridor, vehicles, emergency —
 * everything that changes with the live simulation. Re-renders per update.
 */
function DynamicLayer({ data, highlightTraffic }: { data: SimulationMapData; highlightTraffic: boolean }) {
  const geometry = data.geometry;
  if (geometry === null) return null;

  const corridorSignals = data.corridor?.signals ?? [];
  const corridorApproaches = new Set(
    corridorSignals
      .filter((signal) => signal.status === "APPLIED" || signal.status === "PASSED" || signal.status === "PENDING")
      .map((signal) => signal.approachSegmentId),
  );
  const appliedJunctions = new Set(corridorSignals.filter((s) => s.status === "APPLIED").map((s) => s.junctionId));
  const passedJunctions = new Set(corridorSignals.filter((s) => s.status === "PASSED").map((s) => s.junctionId));
  const routeSegmentIds = new Set((data.emergency?.route?.segments ?? []).map((segment) => segment.segmentId));
  const trafficBySegment = new Map(data.trafficSegments.map((segment) => [segment.segmentId, segment] as const));
  const signalById = new Map(data.signals.map((signal) => [signal.id, signal] as const));
  const emergency = data.emergency;
  const emergencyVehicleId = emergency?.vehicle?.vehicleId ?? null;

  return (
    <g>
      {/* congestion overlays (measured, only when traffic present) */}
      {highlightTraffic &&
        geometry.segments.map((segment) => {
          const traffic = trafficBySegment.get(segment.id);
          if (traffic === undefined || traffic.vehicleCount === 0 || traffic.congestion === "LOW") return null;
          return (
            <polyline
              key={`cong-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke={CONGESTION_COLORS[traffic.congestion]}
              strokeOpacity={traffic.congestion === "CRITICAL" ? 0.85 : 0.6}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.7}
            />
          );
        })}

      {/* emergency route highlight (A* result) */}
      {routeSegmentIds.size > 0 &&
        geometry.segments
          .filter((segment) => routeSegmentIds.has(segment.id))
          .map((segment) => (
            <polyline
              key={`route-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke="#ff453a"
              strokeOpacity={0.9}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.8}
            />
          ))}

      {/* green corridor (animated direction of priority) */}
      {corridorApproaches.size > 0 &&
        geometry.segments
          .filter((segment) => corridorApproaches.has(segment.id))
          .map((segment) => (
            <polyline
              key={`corridor-${segment.id}`}
              points={flippedPoints(segment.coordinates, geometry)}
              fill="none"
              stroke="#22c55e"
              strokeOpacity={0.95}
              strokeLinecap="round"
              strokeWidth={casingWidth(segment.laneCount) * 0.85}
              className="itms-corridor-flow"
            />
          ))}

      {/* traffic signal markers (real RYG state) */}
      {geometry.junctions.map((junction) => {
        const signal = signalById.get(junction.id);
        if (!junction.controlled || signal === undefined) return null;
        const applied = appliedJunctions.has(junction.id);
        const passed = passedJunctions.has(junction.id);
        const color = applied ? "#22c55e" : signalDominantColor(signal.state);
        const label = applied
          ? `Signal ${junction.id} — EMERGENCY PRIORITY (GREEN CORRIDOR)`
          : passed
            ? `Signal ${junction.id} — PASSED (normal program restored)`
            : `Signal ${junction.id} — ${signalDominantLabel(signal.state)}`;
        return (
          <g key={`sig-${junction.id}`}>
            <circle
              cx={junction.x}
              cy={flipY(junction.y, geometry)}
              r={signalRadius(geometry)}
              fill={color}
              stroke="#05060a"
              strokeWidth={1.5}
            />
            <title>{label}</title>
          </g>
        );
      })}

      {/* vehicles: real TraCI positions; CSS transition interpolates BETWEEN
          updates only (no invented movement) */}
      {data.vehicles.map((vehicle) => {
        if (vehicle.id === emergencyVehicleId) return null; // drawn below
        return (
          <g
            key={`v-${vehicle.id}`}
            style={{
              transform: `translate(${vehicle.positionX}px, ${flipY(vehicle.positionY, geometry)}px)`,
              transition: "transform 200ms linear",
            }}
          >
            <circle r={vehicleRadius(geometry, vehicle.typeId)} fill="#9aa5b8" fillOpacity={0.75} />
          </g>
        );
      })}

      {/* emergency vehicle: dominant, rotated to its real heading */}
      {emergency !== null && emergency.live !== null && (
        <EmergencyMarker
          x={emergency.live.positionX}
          y={flipY(emergency.live.positionY, geometry)}
          angle={emergencyVehicleAngle(emergency)}
          label={emergency.vehicle?.vehicleId ?? "EMERGENCY"}
          speedMps={emergency.live.speedMps}
          iconSize={iconSize(geometry)}
        />
      )}
    </g>
  );
}

/** The 🚑 marker: position + rotation from TraCI, speed/ID/ETA labels. */
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
      style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 200ms linear" }}
      data-testid="emergency-marker"
    >
      <title>{`${label} — live SUMO position — ${kmh} km/h`}</title>
      {/* pulse halo */}
      <circle r={size * 1.1} fill="#ff453a" fillOpacity={0.18} className="itms-emergency-pulse" />
      <g transform={`rotate(${angle})`}>
        {/* direction arrow under the icon */}
        <path d={`M 0 ${-size * 0.95} L ${size * 0.5} ${size * 0.4} L 0 ${size * 0.05} L ${-size * 0.5} ${size * 0.4} Z`} fill="#ff453a" fillOpacity={0.9} />
      </g>
      <text textAnchor="middle" dominantBaseline="central" fontSize={size}>
        🚑
      </text>
      <text x={0} y={size * 1.6} textAnchor="middle" fontSize={size * 0.55} fill="#ff8a80" style={{ fontFamily: "var(--font-mono, monospace)" }}>
        {`${label} ${kmh} km/h`}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** SUMO y-up → SVG y-down flip around the geometry's y-center. */
function flipY(y: number, geometry: NetworkGeometryResponse): number {
  const { minY, maxY } = geometry.extent;
  return minY + maxY - y;
}

/** Flips a whole shape for SVG (SUMO lane/segment geometry). */
function flippedPoints(shape: Array<{ x: number; y: number }>, geometry: NetworkGeometryResponse): string {
  return shape.map((point) => `${round1(point.x)},${round1(flipY(point.y, geometry))}`).join(" ");
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Relative scale factor: small networks (grid) render larger features. */
function scaleFactor(geometry: NetworkGeometryResponse): number {
  const span = Math.max(geometry.extent.maxX - geometry.extent.minX, geometry.extent.maxY - geometry.extent.minY);
  return clamp(span / 700, 0.8, 6); // grid ~0.9; city ~16 (capped 6)
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

/** Vehicle heading in SVG degrees (marker points up = north at 0). */
function emergencyVehicleAngle(emergency: EmergencyEventDetail): number {
  return emergency.live?.angle !== undefined ? emergency.live.angle : 0;
}

function signalDominantColor(state: string): string {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return "#34d399";
  if (yellows > 0 && greens === 0) return "#fbbf24";
  if (greens > 0) return "#67e8f9";
  return "#f87171";
}

function signalDominantLabel(state: string): string {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return "GREEN";
  if (yellows > 0 && greens === 0) return "YELLOW";
  if (greens > 0) return "GREEN+YELLOW";
  return "RED";
}
