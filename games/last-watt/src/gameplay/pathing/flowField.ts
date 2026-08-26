/**
 * Ground pathing (GDD §5.1): "地面敌人走当前可通行格的最短路（flow field，从核心
 * 反向刷）；地形变化全量重算。飞行敌人直线飞，无视一切。"
 *
 * One reverse Dijkstra from the core produces a cost field plus a per-cell
 * direction, so any number of enemies path for free and re-routing after a dig
 * costs one rebuild of a 240-cell board.
 *
 * Two modes:
 *  - strict (`blockedPenalty: Infinity`, the default): impassable cells are
 *    never entered. Used for legality checks.
 *  - soft (`blockedPenalty: 1000`): impassable cells cost a fortune but still
 *    get a direction, so a sapper blowing up the bridge an enemy was standing
 *    on can never soft-lock the run. Used for actual movement.
 */

import type { CellCoord, Vec2 } from '../types';
import { DIRECTIONS } from '../grid/Grid';
import type { WalkabilityView } from '../grid/Grid';

export interface FlowFieldOptions {
  /**
   * Cost of entering a non-walkable cell. `Infinity` (default) makes the field
   * strict; a large finite value produces a fallback field that always has a
   * direction to offer.
   */
  blockedPenalty?: number;
}

export interface FlowField {
  readonly cols: number;
  readonly rows: number;
  /** Goal cells (usually the core footprint), as flat indices. */
  readonly targets: readonly number[];
  /** Cost from each cell to the nearest target; `Infinity` when unreachable. */
  readonly cost: Float64Array;
  /** Index into `DIRECTIONS`, or -1 for targets and dead cells. */
  readonly direction: Int8Array;
  readonly blockedPenalty: number;
  /** A cell is genuinely reachable when `cost < reachableThreshold`. */
  readonly reachableThreshold: number;
}

const NO_DIRECTION = -1;

/** Binary min-heap over (cost, index) with index as a deterministic tie-break. */
class MinHeap {
  private readonly costs: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, item: number): void {
    this.costs.push(cost);
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.less(child, parent)) {
        this.swap(child, parent);
        child = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const lastCost = this.costs.pop() as number;
    const lastItem = this.items.pop() as number;
    if (this.items.length > 0) {
      this.costs[0] = lastCost;
      this.items[0] = lastItem;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (right < this.items.length && this.less(right, smallest)) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const ca = this.costs[a] as number;
    const cb = this.costs[b] as number;
    if (ca !== cb) return ca < cb;
    return (this.items[a] as number) < (this.items[b] as number);
  }

  private swap(a: number, b: number): void {
    const cost = this.costs[a] as number;
    this.costs[a] = this.costs[b] as number;
    this.costs[b] = cost;
    const item = this.items[a] as number;
    this.items[a] = this.items[b] as number;
    this.items[b] = item;
  }
}

/**
 * @param targets goal cells; enemies walk toward the cheapest one.
 */
export function computeFlowField(
  view: WalkabilityView,
  targets: readonly CellCoord[],
  options: FlowFieldOptions = {},
): FlowField {
  const { cols, rows } = view;
  const size = cols * rows;
  const blockedPenalty = options.blockedPenalty ?? Infinity;
  const strict = !Number.isFinite(blockedPenalty);

  const cost = new Float64Array(size).fill(Infinity);
  const direction = new Int8Array(size).fill(NO_DIRECTION);
  const settled = new Uint8Array(size);
  const targetIndices: number[] = [];
  const heap = new MinHeap();

  // Cost of stepping *into* a cell: this is what makes the fallback field
  // prefer a long legal detour over cutting through one wall.
  const enterCost = (cx: number, cy: number): number =>
    view.isWalkable(cx, cy) ? 1 : blockedPenalty;

  for (const target of targets) {
    if (target.cx < 0 || target.cy < 0 || target.cx >= cols || target.cy >= rows) continue;
    const index = target.cy * cols + target.cx;
    if (cost[index] === 0) continue;
    cost[index] = 0;
    targetIndices.push(index);
    heap.push(0, index);
  }

  while (heap.size > 0) {
    const index = heap.pop();
    if (settled[index]) continue;
    settled[index] = 1;

    const cx = index % cols;
    const cy = (index - cx) / cols;
    const here = cost[index] as number;
    // Neighbours pay for entering *this* cell, since that is the step they take.
    const step = here + enterCost(cx, cy);
    if (!Number.isFinite(step)) continue;

    for (const dir of DIRECTIONS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbour = ny * cols + nx;
      if (settled[neighbour]) continue;
      if (strict && !view.isWalkable(nx, ny)) continue;
      if (step < (cost[neighbour] as number)) {
        cost[neighbour] = step;
        heap.push(step, neighbour);
      }
    }
  }

  // Directions are assigned in a second pass so ties always break toward the
  // lowest DIRECTIONS index (N, then E, then S, then W) regardless of the order
  // the heap happened to settle cells in.
  for (let index = 0; index < size; index += 1) {
    if (cost[index] === 0 || !Number.isFinite(cost[index] as number)) continue;
    const cx = index % cols;
    const cy = (index - cx) / cols;
    let best = Infinity;
    let bestDir = NO_DIRECTION;
    for (let d = 0; d < DIRECTIONS.length; d += 1) {
      const dir = DIRECTIONS[d] as { dx: number; dy: number };
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbour = ny * cols + nx;
      const neighbourCost = cost[neighbour] as number;
      if (!Number.isFinite(neighbourCost)) continue;
      const candidate = neighbourCost + enterCost(nx, ny);
      if (candidate < best) {
        best = candidate;
        bestDir = d;
      }
    }
    direction[index] = bestDir;
  }

  return {
    cols,
    rows,
    targets: targetIndices,
    cost,
    direction,
    blockedPenalty,
    reachableThreshold: blockedPenalty,
  };
}

export function costAt(field: FlowField, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= field.cols || cy >= field.rows) return Infinity;
  return field.cost[cy * field.cols + cx] as number;
}

/** True when a legal, obstacle-free route to a target exists from this cell. */
export function isReachable(field: FlowField, cx: number, cy: number): boolean {
  return costAt(field, cx, cy) < field.reachableThreshold;
}

export function isTarget(field: FlowField, cx: number, cy: number): boolean {
  return costAt(field, cx, cy) === 0;
}

/** Unit step toward the core, or `null` at the goal / on a dead cell. */
export function directionAt(field: FlowField, cx: number, cy: number): Vec2 | null {
  if (cx < 0 || cy < 0 || cx >= field.cols || cy >= field.rows) return null;
  const dirIndex = field.direction[cy * field.cols + cx] as number;
  if (dirIndex < 0) return null;
  const dir = DIRECTIONS[dirIndex] as { dx: number; dy: number };
  return { x: dir.dx, y: dir.dy };
}

export function nextCell(field: FlowField, cx: number, cy: number): CellCoord | null {
  const dir = directionAt(field, cx, cy);
  if (!dir) return null;
  return { cx: cx + dir.x, cy: cy + dir.y };
}

/**
 * Walks the field from a cell to its goal.
 *
 * @returns the cell chain including both ends, or the partial chain if the walk
 *          runs out of directions (which only happens on unreachable cells in a
 *          strict field).
 */
export function tracePath(
  field: FlowField,
  from: CellCoord,
  maxSteps = field.cols * field.rows,
): CellCoord[] {
  const path: CellCoord[] = [{ cx: from.cx, cy: from.cy }];
  let current: CellCoord = from;
  for (let step = 0; step < maxSteps; step += 1) {
    const next = nextCell(field, current.cx, current.cy);
    if (!next) break;
    path.push(next);
    current = next;
  }
  return path;
}

/**
 * Cell-centre polyline for the combat module's `PolylineMovement`
 * (`Vec2` in cell units, 1.0 == 1 cell).
 */
export function tracePolyline(
  field: FlowField,
  from: CellCoord,
  maxSteps = field.cols * field.rows,
): Vec2[] {
  return tracePath(field, from, maxSteps).map((cell) => ({ x: cell.cx + 0.5, y: cell.cy + 0.5 }));
}

/** Straight line from a spawn to the core, for flying enemies (GDD §5.1). */
export function straightLine(from: CellCoord, to: CellCoord): Vec2[] {
  return [
    { x: from.cx + 0.5, y: from.cy + 0.5 },
    { x: to.cx + 0.5, y: to.cy + 0.5 },
  ];
}
