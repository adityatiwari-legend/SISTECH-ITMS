import { test } from "node:test";
import assert from "node:assert/strict";
import { aStar } from "../src/modules/routing/astar.ts";
import { RoadGraph } from "../src/modules/routing/road-graph.ts";
import { RouteEngine, RouteError, MIN_SPEED_FACTOR } from "../src/modules/routing/route-engine.ts";
import { loadNetworkCatalog } from "../src/modules/simulation/network-loader.ts";
import { NETWORK_PATH } from "./helpers.ts";

/**
 * Builds a small deterministic test graph:
 *
 *   A ---5s--- B ---5s--- C
 *   |                     |
 *   +--------2s-----------+
 * with edge lengths chosen so that straight-line time bounds hold.
 */
function buildTestGraph(): { graph: RoadGraph; costs: Map<string, number> } {
  const catalog = {
    junctions: [
      { id: "A", kind: "priority", x: 0, y: 0, incLanes: [] },
      { id: "B", kind: "priority", x: 100, y: 0, incLanes: [] },
      { id: "C", kind: "priority", x: 200, y: 0, incLanes: [] },
    ],
    segments: [
      makeSegment("eAB", "A", "B", 100, 2),
      makeSegment("eBC", "B", "C", 100, 2),
      makeSegment("eAC", "A", "C", 200, 2),
    ],
    roads: [],
    signals: [],
    geoReferenced: false,
  };
  const graph = new RoadGraph(catalog as never);
  const costs = new Map<string, number>([
    ["eAB", 5],
    ["eBC", 5],
    ["eAC", 2],
  ]);
  return { graph, costs };
}

function makeSegment(id: string, from: string, to: string, lengthM: number, lanes: number) {
  return {
    id,
    fromJunction: from,
    toJunction: to,
    lanes: [
      { id: `${id}_0`, index: 0, speedMps: 13.89, lengthM, shape: [] },
      ...(lanes > 1
        ? [{ id: `${id}_1`, index: 1, speedMps: 13.89, lengthM, shape: [] }]
        : []),
    ],
  };
}

test("A*: finds the direct faster path (travel time, not hops)", () => {
  const { graph, costs } = buildTestGraph();
  const result = aStar(graph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.segmentIds, ["eAC"]);
  assert.equal(result.totalCostSeconds, 2);
  assert.deepEqual(result.junctions, ["A", "C"]);
});

test("A*: reroutes through shorter total cost when the direct edge is expensive", () => {
  const { graph, costs } = buildTestGraph();
  costs.set("eAC", 15);
  const result = aStar(graph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.segmentIds, ["eAB", "eBC"]);
  assert.equal(result.totalCostSeconds, 10);
});

test("A*: reports unreachable goals", () => {
  const { graph, costs } = buildTestGraph();
  // Direct edge A->C costs 2 and stays reachable...
  const result = aStar(graph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result.found, true);

  // ...a graph without any A->C edge and B with no outgoing edge is unreachable.
  const blockedCatalog = {
    junctions: [
      { id: "A", kind: "priority", x: 0, y: 0, incLanes: [] },
      { id: "B", kind: "priority", x: 100, y: 0, incLanes: [] },
      { id: "C", kind: "priority", x: 200, y: 0, incLanes: [] },
    ],
    segments: [makeSegment("eAB", "A", "B", 100, 2)],
    roads: [],
    signals: [],
    geoReferenced: false,
  };
  const blockedGraph = new RoadGraph(blockedCatalog as never);
  const result2 = aStar(blockedGraph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result2.found, false);
  assert.deepEqual(result2.segmentIds, []);
  assert.deepEqual(result2.junctions, []);
});

test("A*: start equals goal yields empty path with zero cost", () => {
  const { graph, costs } = buildTestGraph();
  const result = aStar(graph, {
    start: "A",
    goal: "A",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.junctions, ["A"]);
  assert.equal(result.totalCostSeconds, 0);
});

test("A*: unknown endpoints are not found", () => {
  const { graph, costs } = buildTestGraph();
  const result = aStar(graph, {
    start: "A",
    goal: "ZZ",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.equal(result.found, false);
});

test("A*: deterministic across repeated runs (tie-breaking)", () => {
  const { graph, costs } = buildTestGraph();
  // Two equal-cost paths: eAC=10 vs eAB+eBC=10
  costs.set("eAC", 10);
  const first = aStar(graph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  const second = aStar(graph, {
    start: "A",
    goal: "C",
    edgeCostSeconds: (segmentId) => costs.get(segmentId) ?? Infinity,
    heuristicSeconds: () => 0,
  });
  assert.deepEqual(first.segmentIds, second.segmentIds);
  assert.deepEqual(first.junctions, second.junctions);
});

// ---------------------------------------------------------------------------
// Road graph / route engine against the real network catalog
// ---------------------------------------------------------------------------

const catalog = await loadNetworkCatalog(NETWORK_PATH);
const graph = new RoadGraph(catalog);
const engine = new RouteEngine(graph, catalog);

test("road graph: nodes and directed edges from the real network", () => {
  assert.equal(graph.nodeCount(), 16);
  assert.equal(graph.edgeCount(), 34);
  assert.equal(graph.getMaxFreeFlowSpeed(), 13.89);
  const outgoing = graph.outgoingOf("I1");
  assert.deepEqual(outgoing, ["i1_i2", "i1_i4", "i1_s1", "i1_w1"]);
});

test("route engine: W1 to E2 routes along connected segments", () => {
  const route = engine.computeRoute("W1", "E2");
  assert.equal(route.junctions[0], "W1");
  assert.equal(route.junctions[route.junctions.length - 1], "E2");
  assert.equal(engine.validateRoute(route).length, 0);
  // All segments exist in the SUMO network.
  for (const segment of route.segments) {
    assert.ok(catalog.segments.some((s) => s.id === segment.segmentId), segment.segmentId);
  }
  // Estimated time uses congestion-adjusted costs; free-flow is the baseline.
  assert.ok(route.estimatedTravelTimeS >= route.freeFlowTravelTimeS - 0.001);
  assert.ok(route.totalLengthM > 0);
});

test("route engine: congestion raises edge cost deterministically", () => {
  const free = engine.edgeCost("i1_i2");
  graph.applyTrafficState([
    {
      segmentId: "i1_i2",
      roadId: "I1-I2",
      fromJunction: "I1",
      toJunction: "I2",
      vehicleCount: 10,
      avgSpeedMps: 3.0,
      queueLength: 4,
      occupancy: 0.4,
      vehiclesPerKm: 25,
      flowRatePerHour: 0,
      congestion: "CRITICAL",
    },
  ]);
  const congested = engine.edgeCost("i1_i2");
  assert.ok(congested.costSeconds > free.costSeconds);
  // effective speed clamps to measured value
  assert.ok(Math.abs(congested.effectiveSpeedMps - 3.0) < 0.001);
  // ... but never below the floor
  graph.applyTrafficState([
    {
      segmentId: "i1_i2",
      roadId: "I1-I2",
      fromJunction: "I1",
      toJunction: "I2",
      vehicleCount: 10,
      avgSpeedMps: 0.2,
      queueLength: 10,
      occupancy: 0.5,
      vehiclesPerKm: 25,
      flowRatePerHour: 0,
      congestion: "CRITICAL",
    },
  ]);
  const jammed = engine.edgeCost("i1_i2");
  assert.ok(Math.abs(jammed.effectiveSpeedMps - 13.89 * MIN_SPEED_FACTOR) < 0.001);
  graph.resetTrafficState();
});

test("route engine: validation rejects bad endpoints", () => {
  assert.equal(engine.validateEndpoints("NOPE", "E2")?.code, "unknown_origin");
  assert.equal(engine.validateEndpoints("W1", "NOPE")?.code, "unknown_destination");
  assert.equal(engine.validateEndpoints("W1", "W1")?.code, "same_origin_destination");
  assert.throws(
    () => engine.computeRoute("W1", "W1"),
    (err: unknown) => err instanceof RouteError,
  );
});

test("route engine: validation detects disconnected segments", () => {
  const route = engine.computeRoute("W1", "E2");
  const broken = {
    ...route,
    segments: [route.segments[0]!, { ...route.segments[1]!, fromJunction: "ZZ" } as typeof route.segments[1]],
  };
  const problems = engine.validateRoute(broken as never);
  assert.ok(problems.some((p) => p.code === "disconnected_edge"));
});

test("route engine: every junction-to-junction pair in the grid is routable", () => {
  const junctions = ["I1", "I2", "I3", "I4", "I5", "I6"];
  for (const from of junctions) {
    for (const to of junctions) {
      if (from === to) continue;
      const route = engine.computeRoute(from, to);
      assert.equal(engine.validateRoute(route).length, 0, `${from} -> ${to}`);
      assert.equal(route.junctions[0], from);
      assert.equal(route.junctions[route.junctions.length - 1], to);
    }
  }
});
