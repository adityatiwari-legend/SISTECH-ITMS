#!/usr/bin/env node
/**
 * Fetches the OpenStreetMap road network for the configured demo city and
 * caches it as an .osm.xml file for netconvert.
 *
 * The demo area is fully configurable through environment variables:
 *   DEMO_CITY       display name (default "Bhopal")
 *   DEMO_LAT        center latitude (default 23.2615, Bhopal city center)
 *   DEMO_LNG        center longitude (default 77.4092, Bhopal city center)
 *   DEMO_RADIUS_KM  radius of the area (default 3.0)
 *   DEMO_OVERPASS   comma-separated Overpass endpoints (optional override)
 *
 * Usage: node simulation/sumo/scripts/fetch-city-osm.mjs [--force]
 *        (cached file is reused when present unless --force is given)
 */
import { mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const networkDir = resolve(scriptDir, "..", "network");
const osmDir = join(networkDir, "osm");

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// DEMO_ROADS=major (default) keeps arterials/collectors only — a demo-appropriate
// network size for the per-step TraCI collector. DEMO_ROADS=all adds residential
// streets (large networks need DEMO_RADIUS_KM <= 1.5 to stay usable).
const MAJOR_HIGHWAY_TYPES =
  "motorway|trunk|primary|secondary|tertiary|unclassified|" +
  "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";
const ALL_HIGHWAY_TYPES =
  MAJOR_HIGHWAY_TYPES + "|residential|living_street";

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`Invalid ${name}: "${raw}" is not a number.`);
    process.exit(1);
  }
  return value;
}

export function demoCityConfig(env = process.env) {
  const city = env.DEMO_CITY || "Bhopal";
  const lat = readEnvNumber.call(null, "DEMO_LAT", 23.2615);
  const lng = readEnvNumber("DEMO_LNG", 77.4092);
  const radiusKm = readEnvNumber("DEMO_RADIUS_KM", 3.0);
  const slug = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  // Bounding box: latitude degrees per km ~ 1/111.32; longitude shrinks by cos(lat).
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    city,
    lat,
    lng,
    radiusKm,
    slug,
    bbox: { south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng },
  };
}

function buildQuery(bbox, highwayTypes) {
  return (
    `[out:xml][timeout:300];` +
    `(\n` +
    `  way["highway"~"^(${highwayTypes})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});\n` +
    `);\n` +
    `(._;>;);\n` + // recurse down: pull in all referenced nodes
    `out body;\n`
  );
}

async function fetchOverpass(query, endpoints) {
  let lastError = null;
  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Overpass ${endpoint} (attempt ${attempt}) ...`);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "ITMS-demo-fetch/1.0 (OpenStreetMap data for SUMO simulation)",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const text = await response.text();
        const head = text.slice(0, 200);
        if (head.includes("<osm")) return text;
        throw new Error(`Unexpected response head: ${text.slice(0, 80)}`);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`  failed: ${lastError}`);
      }
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastError}`);
}

async function main() {
  const force = process.argv.includes("--force");
  const demo = demoCityConfig();
  const osmPath = join(osmDir, `${demo.slug}.osm.xml`);

  if (!force && existsSync(osmPath)) {
    console.log(`Cached OSM extract exists: ${osmPath} (${Math.round(statSync(osmPath).size / 1024)} KB).`);
    console.log("Use --force to re-download. Delete the file to switch areas after changing DEMO_* env vars.");
    return;
  }

  console.log(`Demo city: ${demo.city}  center=(${demo.lat}, ${demo.lng})  radius=${demo.radiusKm} km`);
  console.log(`Bounding box: S=${demo.bbox.south.toFixed(5)} W=${demo.bbox.west.toFixed(5)} N=${demo.bbox.north.toFixed(5)} E=${demo.bbox.east.toFixed(5)}`);

  const endpoints = (process.env.DEMO_OVERPASS || DEFAULT_ENDPOINTS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const xml = await fetchOverpass(
    buildQuery(demo.bbox, process.env.DEMO_ROADS === "all" ? ALL_HIGHWAY_TYPES : MAJOR_HIGHWAY_TYPES),
    endpoints,
  );

  mkdirSync(osmDir, { recursive: true });
  writeFileSync(osmPath, xml, "utf8");
  console.log(`Saved: ${osmPath} (${Math.round(xml.length / 1024)} KB)`);
  console.log(`Next: npm run build:city-network`);
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`Fetch failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
