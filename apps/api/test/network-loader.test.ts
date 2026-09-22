import { test } from "node:test";
import assert from "node:assert/strict";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { NETWORK_PATH } from "./helpers.ts";

const catalog = await loadNetworkCatalog(NETWORK_PATH);

test("network catalog: junctions", () => {
  const ids = catalog.junctions.map((j) => j.id).sort();
  assert.deepEqual(
    ids,
    ["E1", "E2", "I1", "I2", "I3", "I4", "I5", "I6", "N1", "N2", "N3", "S1", "S2", "S3", "W1", "W2"],
  );
  const controlled = catalog.junctions.filter((j) => j.kind === "traffic_light");
  assert.equal(controlled.length, 6);
  const i1 = catalog.junctions.find((j) => j.id === "I1")!;
  assert.equal(i1.x, 100);
  assert.equal(i1.y, 100);
  assert.ok(i1.incLanes.length > 0);
});

test("network catalog: segments are directed normal edges with lanes", () => {
  assert.equal(catalog.segments.length, 34);
  for (const segment of catalog.segments) {
    assert.ok(segment.lanes.length > 0, `segment ${segment.id} has lanes`);
    assert.ok(!segment.id.startsWith(":"), `segment ${segment.id} is not internal`);
    for (const lane of segment.lanes) {
      assert.ok(lane.speedMps > 0);
      assert.ok(lane.lengthM > 0);
      assert.ok(lane.shape.length >= 2, `lane ${lane.id} has a shape`);
    }
  }
  const i1i2 = catalog.segments.find((s) => s.id === "i1_i2")!;
  assert.equal(i1i2.fromJunction, "I1");
  assert.equal(i1i2.toJunction, "I2");
  assert.equal(i1i2.lanes.length, 2);
});

test("network catalog: roads are undirected junction pairs", () => {
  // 34 directed edges over a 3x2 grid + 20 stub directions => undirected pairs:
  // 7 horizontal + 3 vertical internal = 10 internal pairs? plus 10 stub pairs = 17 roads
  assert.equal(catalog.roads.length, 17);
  const road = catalog.roads.find((r) => r.id === "I1-I2")!;
  assert.deepEqual([...road.segmentIds].sort(), ["i1_i2", "i2_i1"]);
  for (const roadEntry of catalog.roads) {
    assert.ok(roadEntry.segmentIds.length >= 1);
    assert.notEqual(roadEntry.fromJunction, roadEntry.toJunction);
  }
});

test("network catalog: signals with phases from the static program", () => {
  assert.equal(catalog.signals.length, 6);
  for (const signal of catalog.signals) {
    assert.equal(signal.programId, "0");
    assert.equal(signal.phases.length, 4);
    for (const phase of signal.phases) {
      assert.ok(phase.durationS > 0);
      assert.ok(phase.state.length === 16, `phase state length 16 for ${signal.id}`);
    }
  }
  const i1 = catalog.signals.find((s) => s.id === "I1")!;
  assert.ok(i1.phases.some((p) => p.state.includes("G")));
});

test("network catalog: no geo-reference (SRID 0 is deliberate)", () => {
  assert.equal(catalog.geoReferenced, false);
});
