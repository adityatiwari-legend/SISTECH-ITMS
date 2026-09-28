import type { CongestionLevel } from "@itms/types";
import type { RoadGraph } from "./road-graph.ts";
import { aStar, type AStarResult } from "./astar.ts";
import type { NetworkCatalog } from "../simulation/network-loader.ts";

/**
 * Route engine (Phases.md 3.6-3.8, Architecture.md 10).
 *
 * Cost model (deterministic, no ML):
 *
 *   effective_speed = measured average speed when live data exists,
 *                     otherwise free-flow speed, clamped to
 *                     [freeFlow * MIN_SPEED_FACTOR, freeFlow]
 *   edge_cost       = distance / effective_speed   (seconds)
 *
 * Effective speed never exceeds free flow, which keeps the straight-line /
 * max-speed heuristic admissible. Congested segments therefore cost more,
 * so A* selects by expected travel time rather than distance.
 */

/** Lower clamp for measured speeds: a fully jammed segment still creeps. */
export const MIN_SPEED_FACTOR = 0.1;

export interface RouteCostBreakdown {
  segmentId: string;
  fromJunction: string;
  toJunction: string;
  lengthM: number;
  /** Congestion-adjusted travel time (seconds). */
  costSeconds: number;
  /** Travel time at free-flow speed (seconds). */
  freeFlowSeconds: number;
  /** Speed used for the cost (m/s). */
  effectiveSpeedMps: number;
  congestion: CongestionLevel | null;
}

export interface ComputedRoute {
  algorithm: "astar";
  originJunction: string;
  destinationJunction: string;
  junctions: string[];
  segments: RouteCostBreakdown[];
  totalLengthM: number;
  estimatedTravelTimeS: number;
  freeFlowTravelTimeS: number;
  expandedNodes: number;
}

export type RouteValidationError =
  | { code: "unknown_origin"; junctionId: string }
  | { code: "unknown_destination"; junctionId: string }
  | { code: "same_origin_destination"; junctionId: string }
  | { code: "unreachable"; origin: string; destination: string }
  | { code: "disconnected_edge"; segmentId: string; expectedFrom: string }
  | { code: "unknown_segment"; segmentId: string };

export class RouteEngine {
  private readonly graph: RoadGraph;
  private readonly catalog: NetworkCatalog;

  constructor(graph: RoadGraph, catalog: NetworkCatalog) {
    this.graph = graph;
    this.catalog = catalog;
  }

  getGraph(): RoadGraph {
    return this.graph;
  }

  getCatalog(): NetworkCatalog {
    return this.catalog;
  }

  /**
   * Resolves raw identifiers (such as joined traffic light IDs e.g. joinedS_...,
   * formatted grid codes e.g. I-04, or signal IDs) to a concrete junction node in the graph.
   */
  resolveJunctionId(rawId: string): string {
    const clean = rawId.trim();
    if (this.graph.hasNode(clean)) {
      return clean;
    }

    // 1. Grid formatted like "I-04" -> "I4", "I-06" -> "I6", "W-01" -> "W1"
    const gridMatch = clean.match(/^([IEWSN])-?0?([1-9]\d?)$/i);
    if (gridMatch) {
      const candidate = `${gridMatch[1]!.toUpperCase()}${gridMatch[2]}`;
      if (this.graph.hasNode(candidate)) {
        return candidate;
      }
    }

    // 2. Traffic Light ID (e.g. joinedS_3778150947_3778155323_cluster_13329917155_3778150932)
    // Check if it's a known signal in the network catalog
    const signal = this.catalog.signals.find((s) => s.id === clean);
    if (signal) {
      // Find incoming segments to this signal whose toJunction is in the graph
      for (const segId of Object.keys(signal.linkIndicesBySegment)) {
        const seg = this.catalog.segments.find((s) => s.id === segId);
        if (seg && this.graph.hasNode(seg.toJunction)) {
          return seg.toJunction;
        }
      }
    }

    // 3. If it starts with joinedS_, extract embedded junction IDs:
    if (clean.startsWith("joinedS_")) {
      const parts = clean.slice("joinedS_".length).split("_");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "cluster" && i + 2 < parts.length) {
          const clusterId = `cluster_${parts[i + 1]}_${parts[i + 2]}`;
          if (this.graph.hasNode(clusterId)) return clusterId;
        }
        if (parts[i] && this.graph.hasNode(parts[i]!)) {
          return parts[i]!;
        }
      }
    }

    return clean;
  }

  /**
   * Computes the fastest route between two junctions using A* over
   * congestion-adjusted travel times.
   */
  computeRoute(originJunction: string, destinationJunction: string): ComputedRoute {
    const resolvedOrigin = this.resolveJunctionId(originJunction);
    const resolvedDest = this.resolveJunctionId(destinationJunction);

    const validation = this.validateEndpoints(resolvedOrigin, resolvedDest);
    if (validation !== null) {
      throw new RouteError(validation);
    }

    const maxSpeed = this.graph.getMaxFreeFlowSpeed();
    const result: AStarResult = aStar(this.graph, {
      start: resolvedOrigin,
      goal: resolvedDest,
      edgeCostSeconds: (segmentId) => this.edgeCost(segmentId).costSeconds,
      heuristicSeconds: (junctionId) => this.graph.distanceBetween(junctionId, resolvedDest) / maxSpeed,
    });

    if (!result.found) {
      throw new RouteError({ code: "unreachable", origin: resolvedOrigin, destination: resolvedDest });
    }

    const segments = result.segmentIds.map((segmentId) => this.edgeCost(segmentId));
    return {
      algorithm: "astar",
      originJunction: resolvedOrigin,
      destinationJunction: resolvedDest,
      junctions: result.junctions,
      segments,
      totalLengthM: segments.reduce((sum, edge) => sum + edge.lengthM, 0),
      estimatedTravelTimeS: segments.reduce((sum, edge) => sum + edge.costSeconds, 0),
      freeFlowTravelTimeS: segments.reduce((sum, edge) => sum + edge.freeFlowSeconds, 0),
      expandedNodes: result.expandedNodes,
    };
  }

  /**
   * Validates the endpoints of a route request. Returns null when valid,
   * otherwise the first problem.
   */
  validateEndpoints(originJunction: string, destinationJunction: string): RouteValidationError | null {
    const resolvedOrigin = this.resolveJunctionId(originJunction);
    const resolvedDest = this.resolveJunctionId(destinationJunction);

    if (!this.graph.hasNode(resolvedOrigin)) {
      return { code: "unknown_origin", junctionId: originJunction };
    }
    if (!this.graph.hasNode(resolvedDest)) {
      return { code: "unknown_destination", junctionId: destinationJunction };
    }
    if (resolvedOrigin === resolvedDest) {
      return { code: "same_origin_destination", junctionId: originJunction };
    }
    return null;
  }

  /**
   * Validates a computed route (Phases.md: every returned route must start
   * at the origin, end at the destination, use valid connected segments
   * that exist in the SUMO network). Returns the list of problems; empty
   * means the route is valid.
   */
  validateRoute(route: ComputedRoute): RouteValidationError[] {
    const problems: RouteValidationError[] = [];
    const junctions = route.junctions;
    const segments = route.segments;

    if (junctions.length < 2 || junctions[0] !== route.originJunction) {
      problems.push({ code: "unknown_origin", junctionId: route.originJunction });
    }
    if (junctions[junctions.length - 1] !== route.destinationJunction) {
      problems.push({ code: "unknown_destination", junctionId: route.destinationJunction });
    }

    segments.forEach((segment, index) => {
      // The segment must exist in the SUMO network (catalog check).
      const catalogEdge = this.catalog.segments.find((s) => s.id === segment.segmentId);
      if (catalogEdge === undefined) {
        problems.push({ code: "unknown_segment", segmentId: segment.segmentId });
        return;
      }
      // Connectivity: edge i must start where edge i-1 ended, and the first
      // edge must start at the origin junction.
      const expectedFrom = index === 0 ? route.originJunction : segments[index - 1]!.toJunction;
      if (segment.fromJunction !== expectedFrom) {
        problems.push({ code: "disconnected_edge", segmentId: segment.segmentId, expectedFrom });
      }
    });

    return problems;
  }

  /**
   * Cost breakdown of one segment under the current traffic state.
   * Exposed publicly for ETA calculation reuse.
   */
  edgeCost(segmentId: string): RouteCostBreakdown {
    const edge = this.graph.getEdge(segmentId);
    if (edge === null) {
      throw new RouteError({ code: "unknown_segment", segmentId });
    }
    let effectiveSpeed = edge.freeFlowSpeedMps;
    if (edge.measuredSpeedMps !== null) {
      effectiveSpeed = Math.max(
        edge.freeFlowSpeedMps * MIN_SPEED_FACTOR,
        Math.min(edge.freeFlowSpeedMps, edge.measuredSpeedMps),
      );
    }
    const freeFlowSeconds = edge.distanceM / edge.freeFlowSpeedMps;
    const costSeconds = edge.distanceM / effectiveSpeed;
    return {
      segmentId,
      fromJunction: edge.fromJunction,
      toJunction: edge.toJunction,
      lengthM: edge.distanceM,
      costSeconds,
      freeFlowSeconds,
      effectiveSpeedMps: effectiveSpeed,
      congestion: edge.congestion,
    };
  }
}

export class RouteError extends Error {
  readonly problem: RouteValidationError;

  constructor(problem: RouteValidationError) {
    super(describeRouteProblem(problem));
    this.name = "RouteError";
    this.problem = problem;
  }
}

export function describeRouteProblem(problem: RouteValidationError): string {
  switch (problem.code) {
    case "unknown_origin":
      return `Unknown origin junction "${problem.junctionId}".`;
    case "unknown_destination":
      return `Unknown destination junction "${problem.junctionId}".`;
    case "same_origin_destination":
      return `Origin and destination must differ ("${problem.junctionId}" for both).`;
    case "unreachable":
      return `No route exists from "${problem.origin}" to "${problem.destination}".`;
    case "disconnected_edge":
      return `Route is not connected: segment "${problem.segmentId}" should start at "${problem.expectedFrom}".`;
    case "unknown_segment":
      return `Route uses segment "${problem.segmentId}" which is not in the SUMO network.`;
  }
}
