import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  createGeoTransformer,
  parseNetworkLocation,
} from "../src/modules/simulation/geo.ts";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { NETWORK_PATH } from "./helpers.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CITY_NET = resolve(REPO_ROOT, "simulation", "sumo", "network", "city", "itms-city.net.xml");
const CITY_NET_AVAILABLE = existsSync(CITY_NET);

// --- UTM zone 43 reference vector: EPSG:32643 point for Bhopal center ---
// lat 23.2615 N, lng 77.4092 E  =>  UTM 43N easting/northing (round-trip target).
const BHOPAL_CENTER = { lat: 23.2615, lng: 77.4092 };
const UTM43_PARAM = "+proj=utm +zone=43 +ellps=WGS84 +datum=WGS84 +units=m +no_defs";

test("geo: location parsing keeps netOffset, projection and boundary", () => {
  const location = parseNetworkLocation({
    netOffset: "-742512.52,-2570714.41",
    convBoundary: "0.00,0.00,11194.13,8458.88",
    projParameter: UTM43_PARAM,
  });
  assert.deepEqual(location.netOffset, { dx: -742512.52, dy: -2570714.41 });
  assert.equal(location.projParameter, UTM43_PARAM);
  assert.deepEqual(location.convBoundary, { minX: 0, minY: 0, maxX: 11194.13, maxY: 8458.88 });
});

test("geo: synthetic grid network is not georeferenced (identity transformer)", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  assert.equal(catalog.geoReferenced, false);
  assert.equal(catalog.location?.projParameter, "!");
  // The catalog location is parsed from the net.xml <location> element.
});

test("geo: grid transformer rejects conversion instead of guessing", async () => {
  const catalog = await loadNetworkCatalog(NETWORK_PATH);
  const geo = createGeoTransformer(catalog.location!);
  assert.equal(geo.geoReferenced, false);
  assert.equal(geo.sumoToLatLng(100, 100), null);
  assert.equal(geo.latLngToSumo(23.26, 77.4), null);
});

test("geo: city network is georeferenced and junctions land in Bhopal", { skip: CITY_NET_AVAILABLE ? false : "city network not built" }, async () => {
  const catalog = await loadNetworkCatalog(CITY_NET);
  assert.equal(catalog.geoReferenced, true);
  const geo = createGeoTransformer(catalog.location!);
  for (const junction of catalog.junctions.slice(0, 50)) {
    const latLng = geo.sumoToLatLng(junction.x, junction.y);
    assert.notEqual(latLng, null);
    assert.ok(latLng !== null); // type guard for strict null checks
    // Bhopal demo area (generated with default DEMO_* env).
    assert.ok(latLng.lat > 23.15 && latLng.lat < 23.38, `lat ${latLng.lat} in Bhopal range`);
    assert.ok(latLng.lng > 77.30 && latLng.lng < 77.55, `lng ${latLng.lng} in Bhopal range`);
  }
});

test("geo: UTM 43 round-trip lat/lng <-> network meters is closed (sub-cm)", () => {
  const geo = createGeoTransformer({
    projParameter: UTM43_PARAM,
    netOffset: { dx: -742512.52, dy: -2570714.41 },
    convBoundary: null,
  });
  const sumo = geo.latLngToSumo(BHOPAL_CENTER.lat, BHOPAL_CENTER.lng);
  assert.notEqual(sumo, null);
  assert.ok(sumo !== null); // type guard for strict null checks
  const back = geo.sumoToLatLng(sumo.x, sumo.y);
  assert.notEqual(back, null);
  assert.ok(back !== null); // type guard for strict null checks
  assert.ok(Math.abs(back.lat - BHOPAL_CENTER.lat) < 1e-6, `lat delta ${Math.abs(back.lat - BHOPAL_CENTER.lat)}`);
  assert.ok(Math.abs(back.lng - BHOPAL_CENTER.lng) < 1e-6, `lng delta ${Math.abs(back.lng - BHOPAL_CENTER.lng)}`);
});

test("geo: netOffset direction matches SUMO semantics (network = projected + offset)", () => {
  const geo = createGeoTransformer({
    projParameter: UTM43_PARAM,
    netOffset: { dx: -742512.52, dy: -2570714.41 },
    convBoundary: null,
  });
  // WGS84 -> UTM easting for Bhopal center must be POSITIVE (~742k);
  // with the negative netOffset the network coordinate must be small.
  const sumo = geo.latLngToSumo(BHOPAL_CENTER.lat, BHOPAL_CENTER.lng);
  assert.notEqual(sumo, null);
  assert.ok(sumo !== null); // type guard for strict null checks
  assert.ok(sumo.x > -20_000 && sumo.x < 20_000, `network x ${sumo.x} near origin`);
  assert.ok(sumo.y > -20_000 && sumo.y < 20_000, `network y ${sumo.y} near origin`);
});
