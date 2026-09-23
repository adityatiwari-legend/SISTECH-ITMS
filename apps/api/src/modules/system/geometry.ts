import { readFile } from "node:fs/promises";
import type { NetworkGeometryResponse } from "@itms/types";
import type { NetworkCatalog } from "../simulation/network-loader.ts";

/**
 * Map geometry for the command center, derived from the network source
 * files (net.xml + facilities.add.xml) — the same source of truth as the
 * simulation. Coordinates are SUMO network meters (the network is not
 * geo-referenced; the frontend applies a pure display transform).
 */

const POI_PATTERN = /<poi\s+([^>]*?)\/>/g;
const POI_ATTR_PATTERN = /([\w-]+)="([^"]*)"/g;

export async function getNetworkGeometry(
  catalog: NetworkCatalog,
  facilitiesPath: string,
): Promise<NetworkGeometryResponse> {
  const facilities: NetworkGeometryResponse["facilities"] = [];
  try {
    const xml = await readFile(facilitiesPath, "utf8");
    for (const match of xml.matchAll(POI_PATTERN)) {
      const attrs: Record<string, string> = {};
      for (const attr of match[1]!.matchAll(POI_ATTR_PATTERN)) {
        attrs[attr[1]!] = attr[2]!;
      }
      if (attrs["id"] !== undefined && attrs["x"] !== undefined && attrs["y"] !== undefined) {
        facilities.push({
          id: attrs["id"],
          type: attrs["type"] ?? "poi",
          x: Number(attrs["x"]),
          y: Number(attrs["y"]),
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

  return {
    geoReferenced: catalog.geoReferenced,
    extent: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    junctions: catalog.junctions.map((junction) => ({
      id: junction.id,
      x: junction.x,
      y: junction.y,
      controlled: catalog.signals.some((signal) => signal.id === junction.id),
    })),
    segments: catalog.segments.map((segment) => ({
      id: segment.id,
      fromJunction: segment.fromJunction,
      toJunction: segment.toJunction,
      // Polyline via the lane centerlines (offset per lane index so both
      // directions are visible): use the outer lane shape.
      coordinates: outerLaneShape(segment.lanes.map((lane) => ({ shape: lane.shape, index: lane.index }))),
    })),
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
