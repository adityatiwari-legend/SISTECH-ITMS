import proj4 from "proj4";
import type { NetworkCatalog } from "./network-loader.ts";

/**
 * Geographic projection for the SUMO network, derived from the net.xml
 * <location> element (projParameter + netOffset).
 *
 * This is the ONLY coordinate converter in the backend. Every map-bound
 * object (roads, vehicles, signals, routes, corridors, facilities) must go
 * through it so all layers share one coordinate system.
 *
 * SUMO stores geometry in "network meters": projected coordinates shifted by
 * netOffset so the boundary starts near (0, 0). Converting back to lat/lng:
 *   projected = network - netOffset
 *   lonlat    = inverseProjection(projected)
 */

export interface NetworkLocation {
  /** projParameter string ("!" means the network is not georeferenced). */
  projParameter: string;
  netOffset: { dx: number; dy: number };
  convBoundary: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface GeoTransformer {
  geoReferenced: boolean;
  /** Converts SUMO network meters to WGS84 degrees (null when not georeferenced). */
  sumoToLatLng(x: number, y: number): { lat: number; lng: number } | null;
  /** Converts WGS84 degrees to SUMO network meters (null when not georeferenced). */
  latLngToSumo(lat: number, lng: number): { x: number; y: number } | null;
}

const IDENTITY: GeoTransformer = {
  geoReferenced: false,
  sumoToLatLng: () => null,
  latLngToSumo: () => null,
};

/** Parses the net.xml <location> attributes into a typed structure. */
export function parseNetworkLocation(attrs: Record<string, string>): NetworkLocation {
  const projParameter = attrs["projParameter"] ?? "!";
  let netOffset = { dx: 0, dy: 0 };
  const offsetRaw = attrs["netOffset"];
  if (offsetRaw !== undefined && offsetRaw !== "") {
    const parts = offsetRaw.split(",").map(Number);
    if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      netOffset = { dx: parts[0]!, dy: parts[1]! };
    }
  }
  let convBoundary: NetworkLocation["convBoundary"] = null;
  const boundaryRaw = attrs["convBoundary"];
  if (boundaryRaw !== undefined && boundaryRaw !== "") {
    const parts = boundaryRaw.split(",").map(Number);
    if (parts.length === 4 && parts.every((v) => Number.isFinite(v))) {
      convBoundary = { minX: parts[0]!, minY: parts[1]!, maxX: parts[2]!, maxY: parts[3]! };
    }
  }
  return { projParameter, netOffset, convBoundary };
}

/** Builds a transformer from the network's location. Identity for synthetic networks. */
export function createGeoTransformer(location: NetworkLocation): GeoTransformer {
  if (location.projParameter === "!" || location.projParameter === "") {
    return IDENTITY;
  }
  const projParameter = location.projParameter;
  const toSumo = (lat: number, lng: number): { x: number; y: number } => {
    const [px, py] = proj4(proj4.WGS84, projParameter, [lng, lat]);
    return { x: px + location.netOffset.dx, y: py + location.netOffset.dy };
  };
  const toLatLng = (x: number, y: number): { lat: number; lng: number } => {
    const [lng, lat] = proj4(projParameter, proj4.WGS84, [x - location.netOffset.dx, y - location.netOffset.dy]);
    return { lat, lng };
  };
  return {
    geoReferenced: true,
    sumoToLatLng: toLatLng,
    latLngToSumo: toSumo,
  };
}

/** Convenience: transformer directly from the loaded catalog. */
export function geoFromCatalog(catalog: NetworkCatalog): GeoTransformer {
  return catalog.location !== null ? createGeoTransformer(catalog.location) : IDENTITY;
}

/** Rounds a coordinate for compact JSON payloads. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 
 * Extracts full geometry for a sequence of segments.
 * Uses the first lane of each segment to provide a representative line string.
 */
export function extractRouteGeometry(
  segmentIds: string[],
  catalog: NetworkCatalog,
  geo: GeoTransformer
): Array<{ lat: number; lng: number }> {
  if (!geo.geoReferenced) return [];
  const coords: Array<{ lat: number; lng: number }> = [];
  for (const segmentId of segmentIds) {
    const segment = catalog.segments.find((s) => s.id === segmentId);
    if (!segment || segment.lanes.length === 0) continue;
    const shape = segment.lanes[0]!.shape;
    for (const point of shape) {
      const ll = geo.sumoToLatLng(point.x, point.y);
      if (ll) coords.push({ lat: round6(ll.lat), lng: round6(ll.lng) });
    }
  }
  return coords;
}
