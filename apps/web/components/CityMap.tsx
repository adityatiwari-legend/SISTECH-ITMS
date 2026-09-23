"use client";

import React from "react";
import { APIProvider, Map as GoogleMap, useMap, type MapCameraChangedEvent } from "@vis.gl/react-google-maps";
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
 * Live city map (Google Maps JavaScript API via @vis.gl/react-google-maps).
 *
 * ARCHITECTURE (unchanged): Google Maps is ONLY the geographic visualization
 * layer. The simulated network is SUMO's; traffic state flows
 * SUMO → TraCI → backend → WebSocket → this component. Google live traffic
 * is NOT used as a data source and no vehicle movement is faked.
 *
 * Coordinate transform: the SUMO network is synthetic and not geo-referenced
 * (SRID 0, local meters). It is displayed through a documented, configurable
 * meters→degrees projection anchored at NEXT_PUBLIC_MAP_ANCHOR_LAT/LNG.
 */

const DEFAULT_ANCHOR = { lat: 34.0522, lng: -118.2437 }; // central Los Angeles (configurable)

function mapAnchor(): { lat: number; lng: number } {
  const lat = Number(process.env.NEXT_PUBLIC_MAP_ANCHOR_LAT);
  const lng = Number(process.env.NEXT_PUBLIC_MAP_ANCHOR_LNG);
  return {
    lat: Number.isFinite(lat) ? lat : DEFAULT_ANCHOR.lat,
    lng: Number.isFinite(lng) ? lng : DEFAULT_ANCHOR.lng,
  };
}

function makeTransform() {
  const anchor = mapAnchor();
  const METERS_PER_DEG_LAT = 111320;
  const METERS_PER_DEG_LNG = Math.max(1, 111320 * Math.cos((anchor.lat * Math.PI) / 180));
  return {
    anchor,
    toLatLng(x: number, y: number): { lat: number; lng: number } {
      return {
        lat: anchor.lat + (y - 200) / METERS_PER_DEG_LAT,
        lng: anchor.lng + (x - 300) / METERS_PER_DEG_LNG,
      };
    },
  };
}
type Transform = ReturnType<typeof makeTransform>;

/** Dark Google Maps style (display-only; roads/labels dimmed for the dashboard). */
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0b0f17" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5c6675" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#05060a" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1a2230" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#161d29" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a0d14" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5c6675" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e2836" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0a0d14" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#070a10" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3a4354" }] },
];

export interface CityMapData {
  geometry: NetworkGeometryResponse | null;
  trafficSegments: Array<{ segmentId: string; congestion: CongestionLevel; vehicleCount: number; avgSpeedMps: number }>;
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergency: EmergencyEventDetail | null;
  corridor: CorridorDetail | null;
}

export function CityMap({ data, className = "", highlightTraffic = true }: { data: CityMapData; className?: string; highlightTraffic?: boolean }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (apiKey === "") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#fbbf24]">⚠ Map unavailable</span>
        <span className="max-w-sm text-center text-[11px] leading-relaxed text-[#6B7385]">
          Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Put your Google Maps JavaScript API key in
          <code className="mx-1 rounded bg-[rgba(148,163,190,0.1)] px-1 font-mono">apps/web/.env.local</code>
          and restart <code className="mx-1 rounded bg-[rgba(148,163,190,0.1)] px-1 font-mono">npm run dev</code>.
        </span>
      </div>
    );
  }
  return (
    <APIProvider apiKey={apiKey}>
      <GoogleCityMap data={data} className={className} highlightTraffic={highlightTraffic} />
    </APIProvider>
  );
}

function GoogleCityMap({ data, className, highlightTraffic }: { data: CityMapData; className: string; highlightTraffic: boolean }) {
  const transform = React.useMemo(() => makeTransform(), []);
  const handleCameraChange = React.useCallback((event: MapCameraChangedEvent) => {
    void event;
  }, []);

  return (
    <div className={`relative ${className}`} data-testid="city-map">
      <GoogleMap
        defaultCenter={{ lat: transform.anchor.lat - 0.0012, lng: transform.anchor.lng }}
        defaultZoom={16}
        styles={DARK_MAP_STYLE}
        onCameraChanged={handleCameraChange}
        style={{ width: "100%", height: "100%" }}
        gestureHandling="greedy"
        disableDefaultUI={false}
      >        <MapOverlayLayer transform={transform} data={data} highlightTraffic={highlightTraffic} />
      </GoogleMap>
    </div>
  );
}

/**
 * Declarative overlay layer rendered INSIDE <Map> (useMap() provides the
 * instance). Redraws on every live state change; bounded network (34
 * segments, 16 junctions, fleet of vehicles) keeps redraws cheap.
 */
function MapOverlayLayer({
  transform,
  data,
  highlightTraffic,
}: {
  transform: Transform;
  data: CityMapData;
  highlightTraffic: boolean;
}) {
  const map = useMap();
  const overlaysRef = React.useRef<Array<{ setMap(map: google.maps.Map | null): void }>>([]);

  React.useEffect(() => {
    if (map === null) return;
    // Fresh array per effect run (never mutate the previous one: React may
    // freeze arrays created during render).
    const previous = overlaysRef.current;
    for (const overlay of previous) {
      overlay.setMap(null);
    }
    const overlays: Array<{ setMap(map: google.maps.Map | null): void }> = [];
    overlaysRef.current = overlays;

    const geometry = data.geometry;
    if (geometry === null) return;

    const activeCorridor = data.corridor;
    const corridorApproaches = new Set(
      (activeCorridor?.signals ?? [])
        .filter((signal) => signal.status === "APPLIED" || signal.status === "PASSED" || signal.status === "PENDING")
        .map((signal) => signal.approachSegmentId),
    );
    const appliedJunctions = new Set(
      (activeCorridor?.signals ?? []).filter((signal) => signal.status === "APPLIED").map((signal) => signal.junctionId),
    );
    const trafficBySegment = new Map(data.trafficSegments.map((segment) => [segment.segmentId, segment] as const));
    const signalById = new Map(data.signals.map((signal) => [signal.id, signal] as const));
    const emergency = data.emergency;
    const emergencyVehicleId = emergency?.vehicle?.vehicleId ?? null;

    // ---- roads: SUMO segment geometry → Polylines ----
    for (const segment of geometry.segments) {
      const traffic = trafficBySegment.get(segment.id);
      const congested = traffic !== undefined && traffic.vehicleCount > 0;
      const inCorridor = corridorApproaches.has(segment.id);
      const congestionColor = congested ? CONGESTION_COLORS[traffic!.congestion] : null;
      overlays.push(
        new google.maps.Polyline({
          path: segment.coordinates.map((point) => transform.toLatLng(point.x, point.y)),
          strokeColor: inCorridor ? "#a78bfa" : congestionColor !== null && highlightTraffic ? congestionColor : "#263041",
          strokeOpacity: inCorridor ? 0.95 : congestionColor !== null && highlightTraffic ? 0.85 : 0.5,
          strokeWeight: inCorridor ? 6 : congestionColor !== null && highlightTraffic ? 4.5 : 3.5,
          zIndex: inCorridor ? 30 : congestionColor !== null ? 20 : 10,
          clickable: false,
          map,
        }),
      );
    }

    // ---- junctions / signals ----
    for (const junction of geometry.junctions) {
      const signal = signalById.get(junction.id);
      const inCorridor = appliedJunctions.has(junction.id);
      let color = "#3a4354";
      let title = junction.controlled ? `Signal ${junction.id}` : `Junction ${junction.id}`;
      if (inCorridor) {
        color = "#a78bfa";
        title += " — CORRIDOR PRIORITY";
      } else if (junction.controlled && signal !== undefined) {
        color = signalDominantColor(signal.state);
        title += ` — ${signalDominantLabel(signal.state)}`;
      }
      overlays.push(
        new google.maps.Marker({
          position: transform.toLatLng(junction.x, junction.y),
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#05060a",
            strokeWeight: 2,
            scale: junction.controlled ? 7 : 4,
          },
          title,
          zIndex: junction.controlled ? 40 : 15,
          map,
        }),
      );
    }

    // ---- facilities (hospital / EMS / fire) ----
    for (const facility of geometry.facilities) {
      const glyph = facility.type === "hospital" ? "🏥" : facility.type === "ems_station" ? "🚑" : "🚒";
      overlays.push(
        new google.maps.Marker({
          position: transform.toLatLng(facility.x, facility.y),
          label: { text: glyph, fontSize: "18px" },
          title: facility.id.replace(/_/g, " "),
          zIndex: 45,
          map,
        }),
      );
    }

    // ---- simulated vehicles (SUMO positions; no fake motion) ----
    const emergencyPosition =
      emergency !== null && emergency.live !== null
        ? transform.toLatLng(emergency.live.positionX, emergency.live.positionY)
        : null;
    for (const vehicle of data.vehicles) {
      if (vehicle.id === emergencyVehicleId) continue; // drawn below as 🚑
      overlays.push(
        new google.maps.Marker({
          position: transform.toLatLng(vehicle.positionX, vehicle.positionY),
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#8B95A9",
            fillOpacity: 0.5,
            strokeOpacity: 0,
            scale: 2.5,
          },
          clickable: false,
          zIndex: 12,
          map,
        }),
      );
    }
    if (emergencyPosition !== null) {
      overlays.push(
        new google.maps.Marker({
          position: emergencyPosition,
          label: { text: "🚑", fontSize: "26px" },
          title: `${emergencyVehicleId ?? "emergency vehicle"} — live SUMO position`,
          zIndex: 100,
          map,
        }),
      );
    }

    return () => {
      for (const overlay of overlays) {
        overlay.setMap(null);
      }
    };
  }, [map, transform, data, highlightTraffic]);

  return null;
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
