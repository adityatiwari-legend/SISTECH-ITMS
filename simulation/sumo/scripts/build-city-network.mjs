#!/usr/bin/env node
/**
 * Builds the georeferenced city SUMO network from a cached OpenStreetMap
 * extract (see fetch-city-osm.mjs) and generates everything the "city"
 * demo profile needs:
 *
 *   network/city/itms-city.net.xml        netconvert OSM import (UTM georeferenced)
 *   network/city/city-facilities.add.xml  hospital/EMS/fire POIs (network meters)
 *   scenarios/city/city.trips.xml         seeded random trip definitions
 *   scenarios/city/city.rou.xml           routes (duarouter)
 *   scenarios/city/city-low.rou.xml       low-demand variant (for emergency_low)
 *   scenarios/city/city-high.rou.xml      high-demand variant (for emergency_high)
 *   scenarios/city/city.sumocfg           scenario config (normal demand)
 *   scenarios/city/city-low.sumocfg       low-demand scenario config
 *   scenarios/city/city-high.sumocfg      high-demand scenario config
 *
 * Env (same as fetch-city-osm.mjs):
 *   DEMO_CITY / DEMO_LAT / DEMO_LNG / DEMO_RADIUS_KM
 *   DEMO_TRIPS          trip count, normal demand (default 520)
 *   DEMO_DURATION_S     simulation duration (default 600)
 *   DEMO_HOSPITAL_LAT / DEMO_HOSPITAL_LNG
 *   DEMO_EMS_LAT / DEMO_EMS_LNG
 *   DEMO_FIRE_LAT / DEMO_FIRE_LNG
 *
 * Usage: npm run build:city-network   (requires the cached OSM extract)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import proj4 from "proj4";
import { demoCityConfig } from "./fetch-city-osm.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sumoDir = resolve(scriptDir, "..");
const networkDir = join(sumoDir, "network");
const cityNetworkDir = join(networkDir, "city");
const scenariosDir = join(sumoDir, "scenarios");
const cityScenarioDir = join(scenariosDir, "city");

const TRIP_DURATION_S = readEnvInt("DEMO_DURATION_S", 600);
const TRIP_COUNT = readEnvInt("DEMO_TRIPS", 520);
const LOW_FACTOR = 0.45;
const HIGH_FACTOR = 2.2;

function readEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`Invalid ${name}: "${raw}" is not a positive integer.`);
    process.exit(1);
  }
  return value;
}

function readEnvLatLng(prefix, fallback) {
  const lat = Number(process.env[`${prefix}_LAT`]);
  const lng = Number(process.env[`${prefix}_LNG`]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return fallback;
}

function resolveSumoBinary(name) {
  if (process.env.SUMO_BINARY) return process.env.SUMO_BINARY;
  if (process.env.SUMO_HOME) {
    const candidate = join(process.env.SUMO_HOME, "bin", `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function runTool(binary, args, label) {
  console.log(`${label}: ${binary} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
  const result = spawnSync(binary, args, { stdio: "inherit", windowsHide: true });
  if (result.error) {
    console.error(
      `Failed to start ${binary} (${result.error.message}). Install SUMO (e.g. 'pip install eclipse-sumo'), set SUMO_HOME, or set SUMO_BINARY.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. netconvert: OSM -> georeferenced net.xml
// ---------------------------------------------------------------------------
const demo = demoCityConfig();
const osmPath = join(networkDir, "osm", `${demo.slug}.osm.xml`);
if (!existsSync(osmPath)) {
  console.error(`Missing OSM extract: ${osmPath}. Run 'npm run fetch:city' first.`);
  process.exit(1);
}

mkdirSync(cityNetworkDir, { recursive: true });
mkdirSync(cityScenarioDir, { recursive: true });

const netXml = join(cityNetworkDir, "itms-city.net.xml");
runTool(
  resolveSumoBinary("netconvert"),
  [
    "--osm-files", osmPath,
    "--proj.utm", "true", // explicit georeferencing: projParameter carries the UTM zone
    "--tls.guess-signals", "true", // OSM-tagged traffic signals become TLS
    "--tls.guess", "true", // additional TLS at major untagged junctions
    "--tls.guess.threshold", "35", // keep guessing to genuinely large junctions
    "--tls.join", "true", // cluster signal nodes around one real intersection
    "--junctions.join", "true", // merge dual-carriageway junction clusters
    "--geometry.remove", "true", // merge geometry-only nodes into long edges
    "--ramps.guess", "true",
    "--remove-edges.isolated", "true",
    "--output.original-names", "true", // keep OSM way ids for traceability
    "--output-file", netXml,
  ],
  "netconvert",
);

// ---------------------------------------------------------------------------
// 2. Parse the network's <location> element (projection + netOffset) and the
//    edge catalog so facilities/trips can be placed in network meters.
// ---------------------------------------------------------------------------
const xml = readFileSync(netXml, "utf8");
const locationMatch = /<location\s+([^>]*?)\/>/.exec(xml);
if (locationMatch === null) {
  console.error("Built network has no <location> element; it is not georeferenced.");
  process.exit(1);
}
const attrs = Object.fromEntries(
  [...locationMatch[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
);
const netOffset = attrs["netOffset"]?.split(",").map(Number) ?? [0, 0];
const projParameter = attrs["projParameter"] ?? "!";
if (projParameter === "!") {
  console.error("projParameter is '!' — the network is NOT georeferenced. Refusing to build the city demo on it.");
  process.exit(1);
}
console.log(`Network projection: ${projParameter}`);
console.log(`Network offset: ${netOffset.join(",")}`);

/** lat/lng -> SUMO network meters: WGS84 -> UTM, then the network's netOffset. */
function latLngToSumo(lat, lng) {
  const [px, py] = proj4(proj4.WGS84, projParameter, [lng, lat], true);
  return { x: px + netOffset[0], y: py + netOffset[1] };
}

const edgePattern = /<edge\s+([^>]*?)>\s*<lane[^>]*length="([\d.]+)"/g;
const edgeLengths = new Map();
for (const match of xml.matchAll(/<edge\s+([^>]*?)\/?>(?:\s*<lane[\s\S]*?<\/edge>)?/g)) {
  // Lightweight parse: id/from/to and max lane length for candidate scoring.
  const edgeAttrs = Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  if (edgeAttrs["function"] !== undefined && edgeAttrs["function"] !== "normal") continue;
  if (edgeAttrs["id"] === undefined || edgeAttrs["from"] === undefined || edgeAttrs["to"] === undefined) continue;
  if (edgeAttrs["id"].startsWith(":")) continue;
  edgeLengths.set(edgeAttrs["id"], {
    from: edgeAttrs["from"],
    to: edgeAttrs["to"],
    length: 0,
  });
}
for (const match of xml.matchAll(/<edge\s+[^>]*?id="([^"]+)"[\s\S]*?<\/edge>/g)) {
  const entry = edgeLengths.get(match[1]);
  if (entry === undefined) continue;
  let maxLen = 0;
  for (const laneMatch of match[0].matchAll(/<lane[^>]*length="([\d.]+)"/g)) {
    maxLen = Math.max(maxLen, Number(laneMatch[1]));
  }
  entry.length = maxLen;
}

const edges = [...edgeLengths.entries()].map(([id, info]) => ({ id, ...info }));
const candidates = edges.filter((edge) => edge.length >= 60);
if (candidates.length < 40) {
  console.error(`Only ${candidates.length} usable edges in the network; area too small or OSM extract bad.`);
  process.exit(1);
}
console.log(`Network: ${edges.length} edges, ${candidates.length} trip candidates`);

// Deterministic PRNG (mulberry32) so runs are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 3. Facilities: place hospital/EMS/fire POIs at real coordinates, converted
//    into network meters with the network's own projection.
// ---------------------------------------------------------------------------
const hospital = readEnvLatLng("DEMO_HOSPITAL", { lat: 23.2606, lng: 77.3933 }); // Hamidia Hospital, Bhopal
const emsStation = readEnvLatLng("DEMO_EMS", { lat: 23.2655, lng: 77.4136 });
const fireStation = readEnvLatLng("DEMO_FIRE", { lat: 23.2543, lng: 77.4210 });

function facilityXml(id, type, name, coord) {
  const p = latLngToSumo(coord.lat, coord.lng);
  console.log(`Facility ${name}: (${coord.lat}, ${coord.lng}) -> network (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  return `    <poi id="${id}" type="${type}" x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" color="${type === "hospital" ? "1.00,0.30,0.30" : type === "ems" ? "0.40,0.80,1.00" : "1.00,0.60,0.20"}"/>`;
}

writeFileSync(
  join(cityNetworkDir, "city-facilities.add.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Facilities for the ${demo.city} city demo (generated by build-city-network.mjs
  from DEMO_* coordinates; positions are in the network's projected meters).
-->
<additional>
${facilityXml("hospital_central", "hospital", "Hospital", hospital)}
${facilityXml("ems_station_west", "ems", "EMS Station", emsStation)}
${facilityXml("fire_station_south", "fire", "Fire Station", fireStation)}
</additional>
`,
  "utf8",
);

// ---------------------------------------------------------------------------
// 4. Trips: seeded random candidate edge pairs, spread over the duration.
//    duarouter turns them into validated routes (unroutable pairs are dropped).
// ---------------------------------------------------------------------------
function writeTrips(path, count, seed) {
  const rng = mulberry32(seed);
  const pick = () => candidates[Math.floor(rng() * candidates.length)];
  const vehicles = [];
  const step = TRIP_DURATION_S / (count + 1);
  let emitted = 0;
  let depart = step;
  while (emitted < count) {
    const from = pick();
    let to = pick();
    let guard = 0;
    while (to.id === from.id && guard < 10) {
      to = pick();
      guard++;
    }
    if (to.id === from.id) continue;
    const type = rng() < 0.04 ? "bus" : rng() < 0.04 ? "truck" : "car";
    vehicles.push(`    <trip id="t${seed}_${emitted}" type="${type}" depart="${depart.toFixed(1)}" from="${from.id}" to="${to.id}"/>`);
    emitted++;
    depart += step;
  }
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ${demo.city} city trips (generated by build-city-network.mjs; seed ${seed},
  ${count} trips over ${TRIP_DURATION_S}s). Deterministic: identical initial
  conditions for baseline vs ITMS comparison runs.
-->
<routes>
    <vType id="car" vClass="passenger" length="5.0" accel="2.6" decel="4.5" departLane="best" departSpeed="max"/>
    <vType id="bus" vClass="bus" length="12.0" accel="1.0" decel="3.5" departLane="best"/>
    <vType id="truck" vClass="truck" length="9.0" accel="1.3" decel="3.5" departLane="best"/>
${vehicles.join("\n")}
</routes>
`,
    "utf8",
  );
  console.log(`Wrote ${count} trips -> ${path}`);
}

const variants = [
  { name: "city", count: TRIP_COUNT, seed: 42 },
  { name: "city-low", count: Math.round(TRIP_COUNT * LOW_FACTOR), seed: 43 },
  { name: "city-high", count: Math.round(TRIP_COUNT * HIGH_FACTOR), seed: 44 },
];

for (const variant of variants) {
  const tripsPath = join(cityScenarioDir, `${variant.name}.trips.xml`);
  const rouPath = join(cityScenarioDir, `${variant.name}.rou.xml`);
  writeTrips(tripsPath, variant.count, variant.seed);
  runTool(
    resolveSumoBinary("duarouter"),
    [
      "--net-file", netXml,
      "--route-files", tripsPath,
      "--output-file", rouPath,
      "--seed", String(variant.seed),
      "--ignore-errors", "true",
      "--no-warnings", "true",
    ],
    `duarouter(${variant.name})`,
  );
}

// ---------------------------------------------------------------------------
// 5. Scenario configs. The fleet vTypes (emergency.add.xml) are shared.
// ---------------------------------------------------------------------------
function sumocfg(rouFile) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <input>
        <net-file value="../../network/city/itms-city.net.xml"/>
        <route-files value="${rouFile}"/>
        <additional-files value="../../network/city/city-facilities.add.xml,../../network/emergency-fleet.add.xml"/>
    </input>
    <time>
        <begin value="0"/>
        <end value="${TRIP_DURATION_S}"/>
    </time>
</configuration>
`;
}

writeFileSync(join(cityScenarioDir, "city.sumocfg"), sumocfg("city.rou.xml"), "utf8");
writeFileSync(join(cityScenarioDir, "city-low.sumocfg"), sumocfg("city-low.rou.xml"), "utf8");
writeFileSync(join(cityScenarioDir, "city-high.sumocfg"), sumocfg("city-high.rou.xml"), "utf8");

console.log(`\nCity demo built for ${demo.city}.`);
console.log("Enable it in the backend with ITMS_DEMO=city (see apps/api/.env.example).");
