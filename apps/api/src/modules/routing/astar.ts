import type { RoadGraph } from "./road-graph.ts";

/**
 * A* over the road graph (junction nodes, directed segment edges).
 *
 * Deterministic: the priority queue breaks ties by (f, then junction id),
 * and neighbors are expanded in sorted order, so repeated runs on the same
 * graph produce identical routes. No ML involved (Rules.md 6).
 *
 * Edge weights are travel times in seconds supplied by the caller
 * (congestion-adjusted); the heuristic must be admissible w.r.t. those
 * weights. The caller passes an admissible heuristic (straight-line
 * distance divided by the network's maximum speed, given effective speed
 * never exceeds free flow).
 */

export interface AStarEdgeInfo {
  segmentId: string;
  fromJunction: string;
  toJunction: string;
}

export interface AStarResult {
  /** True when a path was found. */
  found: boolean;
  /** Junction path from start to goal (inclusive), empty when not found. */
  junctions: string[];
  /** Segment ids along the path, parallel to junctions-1, empty when not found. */
  segmentIds: string[];
  /** Sum of edge costs along the path (seconds). */
  totalCostSeconds: number;
  /** Number of expanded nodes (diagnostics). */
  expandedNodes: number;
}

interface HeapItem {
  junctionId: string;
  f: number;
  g: number;
  /** Insertion counter: FIFO on equal (f, id) for full determinism. */
  order: number;
}

/** Binary min-heap over (f, junctionId, order). */
class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[index]!, this.items[parent]!) < 0) {
        const tmp = this.items[parent]!;
        this.items[parent] = this.items[index]!;
        this.items[index] = tmp;
        index = parent;
      } else {
        break;
      }
    }
  }

  pop(): HeapItem | null {
    if (this.items.length === 0) return null;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.compare(this.items[left]!, this.items[smallest]!) < 0) {
          smallest = left;
        }
        if (right < this.items.length && this.compare(this.items[right]!, this.items[smallest]!) < 0) {
          smallest = right;
        }
        if (smallest === index) break;
        const tmp = this.items[smallest]!;
        this.items[smallest] = this.items[index]!;
        this.items[index] = tmp;
        index = smallest;
      }
    }
    return top;
  }

  private compare(a: HeapItem, b: HeapItem): number {
    if (a.f !== b.f) return a.f - b.f;
    if (a.junctionId !== b.junctionId) return a.junctionId < b.junctionId ? -1 : 1;
    return a.order - b.order;
  }
}

export interface AStarOptions {
  start: string;
  goal: string;
  /**
   * Travel-time cost of traversing a segment (seconds). Called for every
   * candidate edge; must return a finite non-negative number.
   */
  edgeCostSeconds: (segmentId: string) => number;
  /** Admissible heuristic: estimated cost from a junction to the goal. */
  heuristicSeconds: (junctionId: string) => number;
}

/**
 * Runs A*. Returns the optimal path for the given costs, or found=false
 * when the goal is unreachable.
 */
export function aStar(graph: RoadGraph, options: AStarOptions): AStarResult {
  const { start, goal } = options;
  if (!graph.hasNode(start) || !graph.hasNode(goal)) {
    return { found: false, junctions: [], segmentIds: [], totalCostSeconds: Infinity, expandedNodes: 0 };
  }
  if (start === goal) {
    return { found: true, junctions: [start], segmentIds: [], totalCostSeconds: 0, expandedNodes: 0 };
  }

  const gScore = new Map<string, number>([[start, 0]]);
  const cameFrom = new Map<string, { via: string; from: string }>();
  const closed = new Set<string>();
  let order = 0;
  let expanded = 0;
  const open = new MinHeap();
  open.push({
    junctionId: start,
    f: options.heuristicSeconds(start),
    g: 0,
    order: order++,
  });

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed.has(current.junctionId)) continue;
    closed.add(current.junctionId);
    expanded += 1;

    if (current.junctionId === goal) {
      return reconstruct(cameFrom, current.g, start, goal);
    }

    const currentG = gScore.get(current.junctionId) ?? current.g;
    for (const segmentId of graph.outgoingOf(current.junctionId)) {
      const edge = graph.getEdge(segmentId);
      if (edge === null) continue;
      const next = edge.toJunction;
      if (closed.has(next)) continue;
      const stepCost = options.edgeCostSeconds(segmentId);
      if (!Number.isFinite(stepCost) || stepCost < 0) {
        throw new Error(`Edge cost for ${segmentId} is invalid: ${stepCost}`);
      }
      const tentative = currentG + stepCost;
      const known = gScore.get(next);
      if (known === undefined || tentative < known) {
        gScore.set(next, tentative);
        cameFrom.set(next, { via: segmentId, from: current.junctionId });
        open.push({
          junctionId: next,
          f: tentative + options.heuristicSeconds(next),
          g: tentative,
          order: order++,
        });
      }
    }
  }

  return { found: false, junctions: [], segmentIds: [], totalCostSeconds: Infinity, expandedNodes: expanded };
}

function reconstruct(
  cameFrom: Map<string, { via: string; from: string }>,
  totalCost: number,
  start: string,
  goal: string,
): AStarResult {
  const junctions: string[] = [goal];
  const segmentIds: string[] = [];
  let node = goal;
  while (node !== start) {
    const link = cameFrom.get(node);
    if (link === undefined) {
      // Should not happen for a completed search; fail loudly rather than
      // return a corrupt path.
      throw new Error(`A* reconstruction failed at ${node}`);
    }
    segmentIds.push(link.via);
    junctions.push(link.from);
    node = link.from;
  }
  junctions.reverse();
  segmentIds.reverse();
  return { found: true, junctions, segmentIds, totalCostSeconds: totalCost, expandedNodes: 0 };
}
