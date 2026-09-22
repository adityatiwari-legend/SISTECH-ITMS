import type { NetworkCatalog } from "../simulation/network-loader.ts";
import type { SegmentTraffic, CongestionLevel } from "@itms/types";

/**
 * Road graph for routing (Phases.md 3.5).
 *
 * Nodes = intersections (junctions), edges = directed road segments.
 * Every edge exposes distance, free-flow speed, lane count (capacity
 * structure) and — when live traffic data exists — the measured average
 * speed and congestion level. Costs are computed by the route engine.
 */

export interface RoadGraphEdge {
  segmentId: string;
  fromJunction: string;
  toJunction: string;
  /** Segment length in meters. */
  distanceM: number;
  /** Free-flow speed in m/s (network speed limit). */
  freeFlowSpeedMps: number;
  /** Number of lanes (capacity structure). */
  laneCount: number;
  /** Latest measured average speed in m/s (null: no live data). */
  measuredSpeedMps: number | null;
  /** Vehicles currently on the segment (null: no live data). */
  vehicleCount: number | null;
  /** Latest congestion classification (null: no live data). */
  congestion: CongestionLevel | null;
}

export interface RoadGraphNode {
  junctionId: string;
  x: number;
  y: number;
  outgoing: string[]; // segment ids
}

export class RoadGraph {
  private readonly nodes = new Map<string, RoadGraphNode>();
  private readonly edges = new Map<string, RoadGraphEdge>();
  private readonly adjacency = new Map<string, string[]>(); // junction -> sorted segment ids
  private maxFreeFlowSpeedMps = 0;

  constructor(catalog: NetworkCatalog) {
    for (const junction of catalog.junctions) {
      this.nodes.set(junction.id, { junctionId: junction.id, x: junction.x, y: junction.y, outgoing: [] });
    }
    for (const segment of catalog.segments) {
      const edge: RoadGraphEdge = {
        segmentId: segment.id,
        fromJunction: segment.fromJunction,
        toJunction: segment.toJunction,
        distanceM: Math.max(...segment.lanes.map((lane) => lane.lengthM)),
        freeFlowSpeedMps: Math.max(...segment.lanes.map((lane) => lane.speedMps)),
        laneCount: segment.lanes.length,
        measuredSpeedMps: null,
        vehicleCount: null,
        congestion: null,
      };
      this.edges.set(segment.id, edge);
      this.maxFreeFlowSpeedMps = Math.max(this.maxFreeFlowSpeedMps, edge.freeFlowSpeedMps);
      const node = this.nodes.get(segment.fromJunction);
      if (node === undefined) {
        throw new Error(`Segment ${segment.id} starts at unknown junction ${segment.fromJunction}`);
      }
      node.outgoing.push(segment.id);
    }
    for (const node of this.nodes.values()) {
      const sorted = [...node.outgoing].sort();
      node.outgoing = sorted;
      this.adjacency.set(node.junctionId, sorted);
    }
  }

  hasNode(junctionId: string): boolean {
    return this.nodes.has(junctionId);
  }

  getNode(junctionId: string): RoadGraphNode | null {
    return this.nodes.get(junctionId) ?? null;
  }

  getEdge(segmentId: string): RoadGraphEdge | null {
    return this.edges.get(segmentId) ?? null;
  }

  /** Sorted outgoing segment ids of a junction. */
  outgoingOf(junctionId: string): string[] {
    return this.adjacency.get(junctionId) ?? [];
  }

  /** Fastest free-flow speed anywhere in the network (heuristic bound). */
  getMaxFreeFlowSpeed(): number {
    return this.maxFreeFlowSpeedMps;
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    return this.edges.size;
  }

  /** Euclidean distance between two junctions (heuristic support). */
  distanceBetween(a: string, b: string): number {
    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    if (nodeA === undefined || nodeB === undefined) {
      throw new Error(`Unknown junction in distance query: ${a} or ${b}`);
    }
    const dx = nodeA.x - nodeB.x;
    const dy = nodeA.y - nodeB.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Applies live traffic measurements (Phase 2 collector output) to edge
   * weights. Only real measured values are used; segments without data
   * keep null (treated as free flow by the cost model).
   */
  applyTrafficState(segments: SegmentTraffic[]): void {
    for (const segment of segments) {
      const edge = this.edges.get(segment.segmentId);
      if (edge === undefined) continue;
      edge.measuredSpeedMps = segment.vehicleCount > 0 ? segment.avgSpeedMps : null;
      edge.vehicleCount = segment.vehicleCount;
      edge.congestion = segment.vehicleCount > 0 ? segment.congestion : null;
    }
  }

  /** Clears live measurements (e.g. when a new simulation starts). */
  resetTrafficState(): void {
    for (const edge of this.edges.values()) {
      edge.measuredSpeedMps = null;
      edge.vehicleCount = null;
      edge.congestion = null;
    }
  }
}
