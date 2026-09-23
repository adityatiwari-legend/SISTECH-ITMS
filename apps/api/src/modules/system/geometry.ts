import { readFile } from "node:fs/promises";
import type { NetworkGeometryResponse } from "@itms/types";
import type { NetworkCatalog } from "../simulation/network-loader.ts";
import {
  geoFromCatalog,
  round6,
  type GeoTransformer,
} from "../simulation/geo.ts";

/**
 * Map geometry for the command center, derived from the network source
 * files (net.xml + facilities add.xml) — the same source of truth as the
 * simulation.
 *
 * Coordinates: SUMO network meters. When the network is georeferenced
 * (OSM-derived city network), every point also carries lat/lng converted
 * with the network's own projection via the shared geo transformer.
 */
const POI_PATTERN = /<poi\s+([^>]*?)\/>/g;
const POI_ATTR_PATTERN = /([\w-]+)="([^"]*)"/g;

export async function getNetworkGeometry(
  catalog: NetworkCatalog,
  facilitiesPath: string,
  options: { demoCity: string; demoCenter: { lat: number; lng: number } },
): Promise<NetworkGeometryResponse> {
  const geo: GeoTransformer = geoFromCatalog(catalog);
  const facilities: NetworkGeometryResponse["facilities"] = [];
  try {
    const xml = await readFile(facilitiesPath, "utf8");
    for (const match of xml.matchAll(POI_PATTERN)) {
      const attrs: Record<string, string> = {};
      for (const attr of match[1]!.matchAll(POI_ATTR_PATTERN)) {
        attrs[attr[1]!] = attr[2]!;
      }
      if (attrs["id"] !== undefined && attrs["x"] !== undefined && attrs["y"] !== undefined) {
        const x = Number(attrs["x"]);
        const y = Number(attrs["y"]);
        const latLng = geo.geoReferenced ? geo.sumoToLatLng(x, y) : null;
        facilities.push({
          id: attrs["id"],
          type: attrs["type"] ?? "poi",
          x,
          y,
          ...(latLng !== null ? { lat: round6(latLng.lat), lng: round6(latLng.lng) } : {}),
        });
      }
    }
  } catch {
    // facilities file optional for the map; no fabricated points.
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const junction of catalog.junctions) {
    xs.push(junction.x);
    ys.push(junction.y);
  }
  for (const facility of facilities) {
    xs.push(facility.x);
    ys.push(facility.y);
  }

  const extent = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };

  // Geographic extent over a sampled set of points (all junctions + facility).
  let geoExtent: NetworkGeometryResponse["geoExtent"];
  if (geo.geoReferenced) {
    let minLat = 90;
    let minLng = 180;
    let maxLat = -90;
    let maxLng = -180;
    const include = (lat: number, lng: number): void => {
      if (lat < minLat) minLat = lat;
      if (lng < minLng) minLng = lng;
      if (lat > maxLat) maxLat = lat;
      if (lng > maxLng) maxLng = lng;
    };
    for (const junction of catalog.junctions) {
      const latLng = geo.sumoToLatLng(junction.x, junction.y);
      if (latLng !== null) include(latLng.lat, latLng.lng);
    }
    for (const facility of facilities) {
      const latLng = geo.sumoToLatLng(facility.x, facility.y);
      if (latLng !== null) include(latLng.lat, latLng.lng);
    }
    geoExtent = { minLat: round6(minLat), minLng: round6(minLng), maxLat: round6(maxLat), maxLng: round6(maxLng) };
  }

  return {
    geoReferenced: catalog.geoReferenced,
    demoCity: options.demoCity,
    demoCenter: options.demoCenter,
    extent,
    ...(geoExtent !== undefined ? { geoExtent } : {}),
    junctions: catalog.junctions.map((junction) => {
      const latLng = geo.geoReferenced ? geo.sumoToLatLng(junction.x, junction.y) : null;
      return {
        id: junction.id,
        x: junction.x,
        y: junction.y,
        ...(latLng !== null ? { lat: round6(latLng.lat), lng: round6(latLng.lng) } : {}),
        controlled: catalog.signals.some((signal) => signal.id === junction.id),
      };
    }),
    segments: catalog.segments.map((segment) => {
      const coordinates = outerLaneShape(segment.lanes.map((lane) => ({ shape: lane.shape, index: lane.index })));
      const lanes = segment.lanes
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((lane) => ({ id: lane.id, index: lane.index, shape: lane.shape }));
      return {
        id: segment.id,
        fromJunction: segment.fromJunction,
        toJunction: segment.toJunction,
        laneCount: segment.lanes.length,
        coordinates: geo.geoReferenced
          ? coordinates.map((point) => {
              const latLng = geo.sumoToLatLng(point.x, point.y);
              return latLng !== null
                ? { ...point, lat: round6(latLng.lat), lng: round6(latLng.lng) }
                : point;
            })
          : coordinates,
        lanes,
      };
    }),
    facilities,
  };
}

/** Merges parallel lane shapes into one polyline (the road centerline). */
function outerLaneShape(lanes: Array<{ shape: Array<{ x: number; y: number }>; index: number }>): Array<{ x: number; y: number }> {
  if (lanes.length === 0) return [];
  // Use the highest-index lane (outermost in SUMO convention) as the
  // segment's drawn polyline.
  const sorted = [...lanes].sort((a, b) => b.index - a.index);
  return sorted[0]!.shape.map((point) => ({ x: point.x, y: point.y }));
}
