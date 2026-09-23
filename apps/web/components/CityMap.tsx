"use client";

import React from "react";
import { Map as MapLibreMap, Popup, type GeoJSONSource, type MapMouseEvent, type MapGeoJSONFeature, type StyleSpecification } from "maplibre-gl";
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
 * Live city map (MapLibre GL).
 *
 * The SUMO network is not geo-referenced (SRID 0), so coordinates are
 * displayed through a pure linear transform SUMO meters → lng/lat degrees.
 * This is a display projection only — no geography is claimed or
 * fabricated, and no basemap tiles are used (dark background style).
 */

const SCALE = 1e-5; // 600 m network → ~0.006° box
const toLng = (x: number): number => (x - 300) * SCALE;
const toLat = (y: number): number => (y - 200) * SCALE;

export interface CityMapData {
  geometry: NetworkGeometryResponse | null;
  trafficSegments: TrafficStateResponse["segments"];
  signals: SignalSnapshot[];
  vehicles: VehicleSnapshot[];
  emergency: EmergencyEventDetail | null;
  corridor: CorridorDetail | null;
}

type TrafficStateResponse = { segments: Array<{ segmentId: string; congestion: CongestionLevel; vehicleCount: number; avgSpeedMps: number }> };

function emptyStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: undefined,
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#080B12" } }],
  };
}

export function CityMap({ data, className = "", highlightTraffic = true }: { data: CityMapData; className?: string; highlightTraffic?: boolean }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: emptyStyle(),
      center: [0, 0],
      zoom: 15.2,
      attributionControl: false,
      interactive: true,
    });
    mapRef.current = map;
    map.on("load", () => {
      // --- sources (updated imperatively on data changes) ---
      map.addSource("segments", { type: "geojson", data: segmentsFeatureCollection([]) });
      map.addSource("junctions", { type: "geojson", data: junctionsFeatureCollection([]) });
      map.addSource("facilities", { type: "geojson", data: facilitiesFeatureCollection([]) });
      map.addSource("vehicles", { type: "geojson", data: vehiclesFeatureCollection([], null) });
      map.addSource("emergencyRoute", { type: "geojson", data: routeFeatureCollection([], null) });
      map.addSource("corridorGlow", { type: "geojson", data: routeFeatureCollection([], null) });

      map.addLayer({
        id: "corridor-line",
        type: "line",
        source: "corridorGlow",
        paint: {
          "line-color": "#8B5CF6",
          "line-width": 7,
          "line-opacity": 0.35,
          "line-blur": 3,
        },
      });
      map.addLayer({
        id: "corridor-line-core",
        type: "line",
        source: "corridorGlow",
        paint: { "line-color": "#A78BFA", "line-width": 2, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "emergency-route-line",
        type: "line",
        source: "emergencyRoute",
        paint: { "line-color": "#FF3B30", "line-width": 3, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "segment-base",
        type: "line",
        source: "segments",
        paint: { "line-color": "#2A3547", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 7] },
      });
      map.addLayer({
        id: "segment-traffic",
        type: "line",
        source: "segments",
        paint: {
          "line-color": ["get", "congestionColor"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2, 17, 5],
          "line-opacity": ["get", "congestionOpacity"],
        },
        layout: { "line-cap": "round" },
      });
      map.addLayer({
        id: "signal-dots",
        type: "circle",
        source: "junctions",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 17, 9],
          "circle-color": ["get", "signalColor"],
          "circle-stroke-color": "#080B12",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "facility-markers",
        type: "circle",
        source: "facilities",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 5, 17, 10],
          "circle-color": ["get", "facilityColor"],
          "circle-stroke-color": "#F4F7FA",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "vehicle-dots",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": 3,
          "circle-color": "#8B95A7",
          "circle-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "emergency-dot-glow",
        type: "circle",
        source: "vehicles",
        filter: ["==", "emergency", true],
        paint: {
          "circle-radius": 14,
          "circle-color": "#FF3B30",
          "circle-opacity": 0.25,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "emergency-dot",
        type: "circle",
        source: "vehicles",
        filter: ["==", "emergency", true],
        paint: {
          "circle-radius": 8,
          "circle-color": "#FF3B30",
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", "junctions", (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        if (feature === undefined) return;
        const props = feature.properties as { id: string; label: string };
        new Popup({ closeButton: false })
          .setLngLat(event.lngLat)
          .setHTML(`<strong>${props.id}</strong><br/>${props.label}`)
          .addTo(map);
      });
      map.on("mouseenter", "junctions", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "junctions", () => { map.getCanvas().style.cursor = ""; });

      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Data → GeoJSON updates (imperative; the map is the live surface).
  React.useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;

    const { geometry, trafficSegments, signals, vehicles, emergency, corridor } = data;

    const source = (id: string): GeoJSONSource | undefined => map.getSource(id) as GeoJSONSource | undefined;

    // --- segments: base geometry + traffic overlay colors ---
    if (geometry !== null) {
      const trafficBySegment = new Map(trafficSegments.map((segment) => [segment.segmentId, segment] as const));
      const corridorApproaches = new Set((corridor?.signals ?? []).map((signal) => signal.approachSegmentId));
      source("segments")?.setData(segmentsFeatureCollection(geometry.segments.map((segment) => {
        const traffic = trafficBySegment.get(segment.id);
        const congestion = traffic !== undefined && traffic.vehicleCount > 0 ? traffic.congestion : null;
        return {
          id: segment.id,
          coordinates: segment.coordinates.map((point) => [toLng(point.x), toLat(point.y)]),
          congestionColor: congestion !== null ? CONGESTION_COLORS[congestion] : "#3D4960",
          congestionOpacity: congestion !== null ? (highlightTraffic ? 0.85 : 0.3) : 0.25,
          corridor: corridorApproaches.has(segment.id),
        };
      })));

      const signalById = new Map(signals.map((signal) => [signal.id, signal] as const));
      const appliedCorridorSignals = new Set(
        (corridor?.signals ?? []).filter((signal) => signal.status === "APPLIED").map((signal) => signal.junctionId),
      );
      source("junctions")?.setData(junctionsFeatureCollection(geometry.junctions.map((junction) => {
        const signal = signalById.get(junction.id);
        const inCorridor = appliedCorridorSignals.has(junction.id);
        let color = "#3D4960";
        let label = "Uncontrolled junction";
        if (inCorridor) {
          color = "#8B5CF6";
          label = `Signal ${junction.id} — CORRIDOR PRIORITY`;
        } else if (junction.controlled && signal !== undefined) {
          const dominant = signalDominantOf(signal.state);
          color = dominant;
          label = `Signal ${junction.id} — ${dominant === "#22C55E" ? "GREEN" : dominant === "#F59E0B" ? "YELLOW" : dominant === "#EF4444" ? "RED" : "MIXED"}`;
        } else if (junction.controlled) {
          color = "#3D4960";
          label = `Signal ${junction.id} — no live data`;
        }
        return { id: junction.id, x: junction.x, y: junction.y, color, label };
      })));

      source("facilities")?.setData(facilitiesFeatureCollection(geometry.facilities.map((facility) => ({
        id: facility.id,
        x: facility.x,
        y: facility.y,
        color: facility.type === "hospital" ? "#FF3B30" : facility.type === "ems_station" ? "#F59E0B" : "#F97316",
      }))));
    }

    // --- vehicles: normal low-key dots; emergency dominant with glow ---
    const emergencyVehicleId = emergency?.vehicle?.vehicleId ?? null;
    source("vehicles")?.setData(vehiclesFeatureCollection(vehicles, emergencyVehicleId));

    // --- emergency route line ---
    const routeEdges = emergency?.route?.segments ?? [];
    const segmentCoordinates = new Map((geometry?.segments ?? []).map((segment) => [segment.id, segment.coordinates] as const));
    source("emergencyRoute")?.setData(routeFeatureCollection(routeEdges, segmentCoordinates));

    // --- corridor glow (planned/applied approaches) ---
    const corridorEntries = (corridor?.signals ?? []).filter(
      (signal) => signal.status === "APPLIED" || signal.status === "PASSED" || (signal.status === "PENDING" && signal.corridorState !== null),
    );
    source("corridorGlow")?.setData(routeFeatureCollection(corridorEntries, segmentCoordinates));  }, [data, ready, highlightTraffic]);

  return (
    <div className={`relative overflow-hidden ${className}`} data-testid="city-map">
      <div ref={containerRef} className="h-full w-full" />
      {data.geometry === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#080B12]/80">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#8B95A7]">
            {data.geometry === null ? "Loading map…" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function signalDominantOf(state: string): string {
  const greens = (state.match(/[gG]/g) ?? []).length;
  const yellows = (state.match(/[yY]/g) ?? []).length;
  if (greens > 0 && yellows === 0) return "#22C55E";
  if (yellows > 0 && greens === 0) return "#F59E0B";
  if (greens > 0) return "#38BDF8";
  return "#EF4444";
}

function segmentsFeatureCollection(segments: Array<{ id: string; coordinates: Array<[number, number]>; congestionColor: string; congestionOpacity: number }>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature",
      id: undefined,
      properties: { id: segment.id, congestionColor: segment.congestionColor, congestionOpacity: segment.congestionOpacity },
      geometry: { type: "LineString", coordinates: segment.coordinates },
    })),
  };
}

function junctionsFeatureCollection(junctions: Array<{ id: string; x: number; y: number; color: string; label: string }>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: junctions.map((junction) => ({
      type: "Feature",
      properties: { id: junction.id, signalColor: junction.color, label: junction.label },
      geometry: { type: "Point", coordinates: [toLng(junction.x), toLat(junction.y)] },
    })),
  };
}

function facilitiesFeatureCollection(facilities: Array<{ id: string; x: number; y: number; color: string }>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: facilities.map((facility) => ({
      type: "Feature",
      properties: { id: facility.id, facilityColor: facility.color },
      geometry: { type: "Point", coordinates: [toLng(facility.x), toLat(facility.y)] },
    })),
  };
}

function vehiclesFeatureCollection(vehicles: VehicleSnapshot[], emergencyVehicleId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle) => ({
      type: "Feature",
      properties: { id: vehicle.id, emergency: vehicle.id === emergencyVehicleId || vehicle.typeId.startsWith("emergency") },
      geometry: { type: "Point", coordinates: [toLng(vehicle.positionX), toLat(vehicle.positionY)] },
    })),
  };
}

function routeFeatureCollection(
  edges: Array<{ segmentId: string } | { approachSegmentId: string }>,
  coordinatesBySegment: Map<string, Array<{ x: number; y: number }>> | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const edge of edges) {
    const segmentId = "segmentId" in edge ? edge.segmentId : (edge as { approachSegmentId: string }).approachSegmentId;
    const coordinates = coordinatesBySegment?.get(segmentId);
    if (coordinates === undefined || coordinates.length < 2) continue;
    features.push({
      type: "Feature",
      properties: { segmentId },
      geometry: { type: "LineString", coordinates: coordinates.map((point) => [toLng(point.x), toLat(point.y)]) },
    });
  }
  return { type: "FeatureCollection", features };
}
