/**
 * The 20×12 board (GDD §5.1, §17.1).
 *
 * Cell state lives in parallel typed arrays; `CellData` snapshots are built on
 * demand for UI and debugging. Every mutation that can change walkability bumps
 * `version`, which is the only thing the flow field caches on.
 *
 * Deliberately *not* here: cell coatings (oil/fire). Combat authors and consumes
 * those and owns that field — see `src/combat/ports.ts`.
 */

import type { CellCoord, CellData, TerrainName } from '../types';
import { CellFlag, TERRAIN_CODES, TERRAIN_NAMES, TERRAIN_TRAITS } from '../types';
import type { BarrierCell, BarrierDef, MapDef, ZoneDef } from './mapDef';
import { loadMapDef, parseMapLayout, resolveLegend, zoneCells } from './mapDef';
import type { MilestoneId } from '../rules/scope';
import { CURRENT_MILESTONE, milestoneAtLeast } from '../rules/scope';

export interface GateState {
  id: string;
  index: number;
  openWave: number;
  open: boolean;
  /** When set, the gate only spawns on exactly these waves. */
  activeWaves?: number[];
  cells: CellCoord[];
  label?: string;
}

/** Does this gate send enemies on the given wave? */
export function gateActiveOn(gate: { openWave: number; activeWaves?: number[] }, wave: number): boolean {
  if (gate.activeWaves) return gate.activeWaves.includes(wave);
  return gate.openWave <= wave;
}

export interface ZoneState {
  def: ZoneDef;
  id: string;
  powered: boolean;
  cells: CellCoord[];
}

export interface BarrierState {
  def: BarrierDef;
  id: string;
  open: boolean;
  cells: BarrierCell[];
  openTerrain: TerrainName;
}

/** Character `toLayoutString()` emits when a terrain has no legend entry. */
export const UNKNOWN_LAYOUT_CHAR = '?';

/** Neighbour order is fixed (N, E, S, W) so every tie-break is deterministic. */
export const DIRECTIONS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** Minimal surface the flow field and the legality checker need. */
export interface WalkabilityView {
  readonly cols: number;
  readonly rows: number;
  isWalkable(cx: number, cy: number): boolean;
}

export class Grid implements WalkabilityView {
  readonly def: MapDef;
  readonly cols: number;
  readonly rows: number;
  readonly size: number;

  readonly gates: GateState[] = [];
  readonly coreCells: CellCoord[] = [];

  /**
   * Bumped on every walkability change. The flow field caches on this and
   * nothing else, so placing a tower must not touch it.
   */
  version = 0;

  /** Bumped on every buildability change (occupancy, zone power). */
  buildVersion = 0;

  private readonly terrain: Uint8Array;
  private readonly baseTerrain: Uint8Array;
  private readonly flags: Uint8Array;
  private readonly zoneIndex: Int8Array;
  private readonly barrierIndex: Int8Array;
  private readonly zoneStates: ZoneState[] = [];
  private readonly barrierStates: BarrierState[] = [];
  private readonly zoneById = new Map<string, ZoneState>();
  private readonly barrierById = new Map<string, BarrierState>();

  constructor(def: MapDef, options: { validate?: boolean } = {}) {
    this.def = options.validate === false ? def : loadMapDef(def);
    this.cols = def.cols;
    this.rows = def.rows;
    this.size = def.cols * def.rows;

    const parsed = parseMapLayout(this.def);
    this.terrain = parsed.terrain;
    this.baseTerrain = Uint8Array.from(parsed.terrain);
    this.flags = parsed.flags;
    this.barrierIndex = parsed.barrier;
    this.zoneIndex = new Int8Array(this.size).fill(-1);
    this.coreCells = parsed.coreCells;

    this.def.gates.forEach((gateDef, index) => {
      const fromLayout = parsed.gateCells
        .filter((cell) => cell.gateIndex === index)
        .map(({ cx, cy }) => ({ cx, cy }));
      this.gates.push({
        id: gateDef.id,
        index,
        openWave: gateDef.openWave,
        open: gateDef.openWave <= 1,
        activeWaves: gateDef.activeWaves,
        cells: gateDef.cells?.length ? gateDef.cells.map(({ cx, cy }) => ({ cx, cy })) : fromLayout,
        label: gateDef.label,
      });
    });

    (this.def.barriers ?? []).forEach((barrierDef, index) => {
      const declared = new Map<number, BarrierCell>();
      for (const cell of barrierDef.cells ?? []) {
        declared.set(this.index(cell.cx, cell.cy), cell);
      }
      const cells: BarrierCell[] = [];
      for (let i = 0; i < this.size; i += 1) {
        if (this.barrierIndex[i] !== index) continue;
        cells.push(declared.get(i) ?? this.coordOf(i));
      }
      const state: BarrierState = {
        def: barrierDef,
        id: barrierDef.id,
        open: false,
        cells,
        openTerrain: barrierDef.openTerrain ?? 'path',
      };
      this.barrierStates.push(state);
      this.barrierById.set(state.id, state);
    });

    (this.def.zones ?? []).forEach((zoneDef, index) => {
      const cells = zoneCells(zoneDef, this.cols, this.rows);
      for (const cell of cells) this.zoneIndex[this.index(cell.cx, cell.cy)] = index;
      const state: ZoneState = { def: zoneDef, id: zoneDef.id, powered: true, cells };
      this.zoneStates.push(state);
      this.zoneById.set(state.id, state);
    });
  }

  // -------------------------------------------------------------------------
  // Coordinates
  // -------------------------------------------------------------------------

  isInside(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  index(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  coordOf(index: number): CellCoord {
    return { cx: index % this.cols, cy: Math.floor(index / this.cols) };
  }

  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------

  terrainAt(cx: number, cy: number): TerrainName {
    if (!this.isInside(cx, cy)) return 'rock';
    return TERRAIN_NAMES[this.terrain[this.index(cx, cy)] as number] as TerrainName;
  }

  baseTerrainAt(cx: number, cy: number): TerrainName {
    if (!this.isInside(cx, cy)) return 'rock';
    return TERRAIN_NAMES[this.baseTerrain[this.index(cx, cy)] as number] as TerrainName;
  }

  /**
   * Replaces the terrain of one cell. Callers that change several cells at once
   * should pass `silent` and bump the version themselves to emit a single
   * rebuild.
   */
  setTerrain(cx: number, cy: number, terrain: TerrainName, options: { silent?: boolean } = {}): void {
    if (!this.isInside(cx, cy)) return;
    const index = this.index(cx, cy);
    const code = TERRAIN_CODES[terrain];
    if (this.terrain[index] === code) return;
    this.terrain[index] = code;
    if (!options.silent) this.version += 1;
  }

  bumpVersion(): void {
    this.version += 1;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  isWalkable(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    return TERRAIN_TRAITS[this.terrainAt(cx, cy)].walkable;
  }

  /** Road cells carry coatings; the core itself is a goal, not a road. */
  isRoad(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    return TERRAIN_TRAITS[this.terrainAt(cx, cy)].road;
  }

  isWater(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    return TERRAIN_TRAITS[this.terrainAt(cx, cy)].water;
  }

  isBridge(cx: number, cy: number): boolean {
    return this.terrainAt(cx, cy) === 'bridge';
  }

  /** Only player-built bridges are valid sapper targets (GDD §8.1). */
  isPlayerBridge(cx: number, cy: number): boolean {
    return this.isBridge(cx, cy) && this.hasFlag(cx, cy, CellFlag.PlayerBridge);
  }

  /** Terrain allows building, nothing stands there, and the zone still has power. */
  isBuildable(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    if (!TERRAIN_TRAITS[this.terrainAt(cx, cy)].buildable) return false;
    if (this.hasFlag(cx, cy, CellFlag.Occupied)) return false;
    if (this.hasFlag(cx, cy, CellFlag.UnderConstruction)) return false;
    return this.isPowered(cx, cy);
  }

  /** False inside a lost substation zone — towers there shut down (GDD §10). */
  isPowered(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return true;
    const zone = this.zoneIndex[this.index(cx, cy)] as number;
    if (zone < 0) return true;
    return (this.zoneStates[zone] as ZoneState).powered;
  }

  isFloodway(cx: number, cy: number): boolean {
    return this.hasFlag(cx, cy, CellFlag.Floodway);
  }

  isGeothermal(cx: number, cy: number): boolean {
    return this.hasFlag(cx, cy, CellFlag.Geothermal);
  }

  /**
   * 可挖路段 (GDD §5.1): marked at authoring time. Roads and puddles are the
   * headline case; bare soft soil is also diggable where a map marks it, which
   * is what lets a player dig-then-bridge a brand new cell of road.
   */
  isDiggable(cx: number, cy: number): boolean {
    if (!this.hasFlag(cx, cy, CellFlag.Diggable)) return false;
    if (this.hasFlag(cx, cy, CellFlag.UnderConstruction)) return false;
    const terrain = this.terrainAt(cx, cy);
    return terrain === 'path' || terrain === 'puddle' || terrain === 'soft_soil';
  }

  isBridgeable(cx: number, cy: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    if (this.hasFlag(cx, cy, CellFlag.UnderConstruction)) return false;
    return TERRAIN_TRAITS[this.terrainAt(cx, cy)].bridgeable;
  }

  isOccupied(cx: number, cy: number): boolean {
    return this.hasFlag(cx, cy, CellFlag.Occupied);
  }

  /** Called by the build system when a tower or generator is placed or sold. */
  setOccupied(cx: number, cy: number, occupied: boolean): void {
    this.setFlag(cx, cy, CellFlag.Occupied, occupied);
    this.buildVersion += 1;
  }

  hasFlag(cx: number, cy: number, flag: number): boolean {
    if (!this.isInside(cx, cy)) return false;
    return ((this.flags[this.index(cx, cy)] as number) & flag) !== 0;
  }

  setFlag(cx: number, cy: number, flag: number, on: boolean): void {
    if (!this.isInside(cx, cy)) return;
    const index = this.index(cx, cy);
    const current = this.flags[index] as number;
    this.flags[index] = on ? current | flag : current & ~flag;
  }

  flagsAt(cx: number, cy: number): number {
    if (!this.isInside(cx, cy)) return 0;
    return this.flags[this.index(cx, cy)] as number;
  }

  // -------------------------------------------------------------------------
  // Gates, zones, barriers
  // -------------------------------------------------------------------------

  gate(id: string): GateState | undefined {
    return this.gates.find((gate) => gate.id === id);
  }

  /** Gates spawning at the given wave. */
  openGates(wave?: number): GateState[] {
    if (wave === undefined) return this.gates.filter((gate) => gate.open);
    return this.gates.filter((gate) => gateActiveOn(gate, wave));
  }

  /** Opens every gate whose schedule has come due; returns the newly opened. */
  syncGatesToWave(wave: number): GateState[] {
    const opened: GateState[] = [];
    for (const gate of this.gates) {
      if (!gate.open && gateActiveOn(gate, wave)) {
        gate.open = true;
        opened.push(gate);
      }
    }
    return opened;
  }

  zone(id: string): ZoneState | undefined {
    return this.zoneById.get(id);
  }

  get zones(): readonly ZoneState[] {
    return this.zoneStates;
  }

  zoneIdAt(cx: number, cy: number): string | null {
    if (!this.isInside(cx, cy)) return null;
    const index = this.zoneIndex[this.index(cx, cy)] as number;
    return index < 0 ? null : (this.zoneStates[index] as ZoneState).id;
  }

  setZonePowered(id: string, powered: boolean): boolean {
    const zone = this.zoneById.get(id);
    if (!zone || zone.powered === powered) return false;
    zone.powered = powered;
    // Losing a zone kills power, not passability — the flow field is unaffected.
    this.buildVersion += 1;
    return true;
  }

  get barriers(): readonly BarrierState[] {
    return this.barrierStates;
  }

  barrier(id: string): BarrierState | undefined {
    return this.barrierById.get(id);
  }

  /** Opens a sluice, turning its cells into road (GDD §10, integrity ≤ 50). */
  openBarrier(id: string): CellCoord[] {
    const barrier = this.barrierById.get(id);
    if (!barrier || barrier.open) return [];
    barrier.open = true;
    for (const cell of barrier.cells) {
      this.setTerrain(cell.cx, cell.cy, cell.terrain ?? barrier.openTerrain, { silent: true });
      this.setFlag(cell.cx, cell.cy, CellFlag.Barrier, false);
      if (cell.diggable) this.setFlag(cell.cx, cell.cy, CellFlag.Diggable, true);
    }
    this.version += 1;
    return barrier.cells.map(({ cx, cy }) => ({ cx, cy }));
  }

  /**
   * Opens every barrier scheduled for this wave; returns the ones opened.
   * A barrier the authored table defers to a later milestone stays shut.
   */
  openBarriersForWave(wave: number, milestone: MilestoneId = CURRENT_MILESTONE): BarrierState[] {
    const opened: BarrierState[] = [];
    for (const barrier of this.barrierStates) {
      if (barrier.open || barrier.def.openAtWave !== wave) continue;
      if (!milestoneAtLeast(milestone, barrier.def.activeFromMilestone)) continue;
      this.openBarrier(barrier.id);
      opened.push(barrier);
    }
    return opened;
  }

  // -------------------------------------------------------------------------
  // Iteration & snapshots
  // -------------------------------------------------------------------------

  neighbors4(cx: number, cy: number): CellCoord[] {
    const out: CellCoord[] = [];
    for (const dir of DIRECTIONS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (this.isInside(nx, ny)) out.push({ cx: nx, cy: ny });
    }
    return out;
  }

  forEachCell(visit: (cx: number, cy: number, index: number) => void): void {
    for (let cy = 0; cy < this.rows; cy += 1) {
      for (let cx = 0; cx < this.cols; cx += 1) visit(cx, cy, this.index(cx, cy));
    }
  }

  cellAt(cx: number, cy: number): CellData | null {
    if (!this.isInside(cx, cy)) return null;
    const index = this.index(cx, cy);
    const barrierIdx = this.barrierIndex[index] as number;
    return {
      cx,
      cy,
      index,
      terrain: this.terrainAt(cx, cy),
      baseTerrain: this.baseTerrainAt(cx, cy),
      walkable: this.isWalkable(cx, cy),
      buildable: this.isBuildable(cx, cy),
      diggable: this.isDiggable(cx, cy),
      bridgeable: this.isBridgeable(cx, cy),
      occupied: this.isOccupied(cx, cy),
      powered: this.isPowered(cx, cy),
      underConstruction: this.hasFlag(cx, cy, CellFlag.UnderConstruction),
      zoneId: this.zoneIdAt(cx, cy),
      barrierId: barrierIdx < 0 ? null : ((this.barrierStates[barrierIdx] as BarrierState).id),
      flags: this.flagsAt(cx, cy),
    };
  }

  /** Renders the current board back to layout characters, for debugging. */
  toLayoutString(): string[] {
    const legend = resolveLegend(this.def);
    const entries = Object.entries(legend);
    const lines: string[] = [];

    for (let cy = 0; cy < this.rows; cy += 1) {
      let line = '';
      for (let cx = 0; cx < this.cols; cx += 1) {
        const terrain = this.terrainAt(cx, cy);
        const flags = this.flagsAt(cx, cy) & (CellFlag.Diggable | CellFlag.Floodway | CellFlag.Geothermal);
        const exact = entries.find(
          ([, entry]) => entry.terrain === terrain && (entry.flags ?? 0) === flags,
        );
        const loose = entries.find(([, entry]) => entry.terrain === terrain);
        line += exact?.[0] ?? loose?.[0] ?? UNKNOWN_LAYOUT_CHAR;
      }
      lines.push(line);
    }
    return lines;
  }
}
