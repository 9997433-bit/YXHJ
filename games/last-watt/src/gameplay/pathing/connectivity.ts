/**
 * Connectivity legality (GDD §5.1): "任何工程操作后，每个出怪口到核心必须仍有
 * 通路，否则按钮变红禁止（堵路靠「绕远」实现，不许彻底堵死）。"
 *
 * The check runs against a *hypothetical* board — the current grid plus the
 * terrain the pending and candidate engineering jobs will leave behind — so the
 * player is told the dig is illegal before paying for it.
 */

import type { CellCoord, TerrainName } from '../types';
import { TERRAIN_TRAITS } from '../types';
import type { Grid, GateState, WalkabilityView } from '../grid/Grid';

/** Cell index → terrain it will have once every queued job finishes. */
export type TerrainOverrides = ReadonlyMap<number, TerrainName>;

/** A grid seen through a set of pending terrain edits. Allocation-free to build. */
export class OverlayView implements WalkabilityView {
  readonly cols: number;
  readonly rows: number;

  constructor(
    private readonly grid: Grid,
    private readonly overrides: TerrainOverrides,
    /** Treat these cells as impassable regardless of terrain (bridge stress test). */
    private readonly removed: ReadonlySet<number> = new Set(),
  ) {
    this.cols = grid.cols;
    this.rows = grid.rows;
  }

  isWalkable(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    const index = cy * this.cols + cx;
    if (this.removed.has(index)) return false;
    const override = this.overrides.get(index);
    if (override !== undefined) return TERRAIN_TRAITS[override].walkable;
    return this.grid.isWalkable(cx, cy);
  }
}

/** Flood fill from the targets over walkable cells. */
export function floodReachable(view: WalkabilityView, targets: readonly CellCoord[]): Uint8Array {
  const { cols, rows } = view;
  const reachable = new Uint8Array(cols * rows);
  const queue: number[] = [];

  for (const target of targets) {
    if (target.cx < 0 || target.cy < 0 || target.cx >= cols || target.cy >= rows) continue;
    const index = target.cy * cols + target.cx;
    if (reachable[index]) continue;
    reachable[index] = 1;
    queue.push(index);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const cx = index % cols;
    const cy = (index - cx) / cols;
    const candidates = [
      [cx, cy - 1],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx - 1, cy],
    ] as const;
    for (const [nx, ny] of candidates) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbour = ny * cols + nx;
      if (reachable[neighbour]) continue;
      if (!view.isWalkable(nx, ny)) continue;
      reachable[neighbour] = 1;
      queue.push(neighbour);
    }
  }

  return reachable;
}

export interface ConnectivityReport {
  ok: boolean;
  /** Gate ids with no route to the core. */
  blockedGates: string[];
  reachable: Uint8Array;
}

export interface ConnectivityOptions {
  /**
   * Gates that have not opened yet still have to stay connected, otherwise a
   * wave-3 dig can soft-lock the run when the second gate opens on wave 10.
   */
  includeUnopenedGates?: boolean;
  overrides?: TerrainOverrides;
  removed?: ReadonlySet<number>;
}

export function checkConnectivity(
  grid: Grid,
  options: ConnectivityOptions = {},
): ConnectivityReport {
  const view =
    options.overrides || options.removed
      ? new OverlayView(grid, options.overrides ?? new Map(), options.removed ?? new Set())
      : grid;

  const reachable = floodReachable(view, grid.coreCells);
  const includeUnopened = options.includeUnopenedGates ?? true;
  const gates: GateState[] = includeUnopened ? [...grid.gates] : grid.gates.filter((g) => g.open);

  const blockedGates: string[] = [];
  for (const gate of gates) {
    // A gate still sealed behind a wall (map 1's wave-5 breach) is not spawning
    // and cannot be cut off by a dig. It becomes protected the moment the wall
    // comes down. Judged on the real grid, not the overlay, so a job that seals
    // a live gate is still caught.
    if (!gate.cells.some((cell) => grid.isWalkable(cell.cx, cell.cy))) continue;
    const connected = gate.cells.some((cell) => reachable[cell.cy * grid.cols + cell.cx] === 1);
    if (!connected) blockedGates.push(gate.id);
  }

  return { ok: blockedGates.length === 0, blockedGates, reachable };
}

/** Flat indices of every player-built bridge currently on the board. */
export function playerBridgeIndices(grid: Grid): Set<number> {
  const indices = new Set<number>();
  grid.forEachCell((cx, cy, index) => {
    if (grid.isPlayerBridge(cx, cy)) indices.add(index);
  });
  return indices;
}

/**
 * Advisory: would the board still be connected if every player bridge were
 * blown up? Sapper crabs destroy bridges (GDD §8.1), so a route that only
 * exists because of one is a warning worth surfacing in the UI — not a
 * rejection, since bridging enemies into a kill zone is a legitimate play.
 */
export function dependsOnPlayerBridges(grid: Grid, options: ConnectivityOptions = {}): boolean {
  const removed = playerBridgeIndices(grid);
  for (const index of options.removed ?? []) removed.add(index);
  if (removed.size === 0) return false;
  return !checkConnectivity(grid, { ...options, removed }).ok;
}
