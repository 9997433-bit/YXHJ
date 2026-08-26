/**
 * MapDef — the pure-data description of a level (GDD §17.1).
 *
 * The board is authored as an ASCII layout so a level fits on one screen and
 * diffs are readable. Everything that cannot be expressed as one character per
 * cell (zones, gate schedules, engineering quotas, wave multipliers) lives in
 * sibling fields.
 *
 * `MapDef` is JSON-serialisable on purpose: once `data/` ships authored levels,
 * `loadMapDef()` validates them with the exact same code path the built-in
 * greybox maps go through.
 */

import type { CellCoord, Rect, TerrainName } from '../types';
import { TERRAIN_CODES, CellFlag } from '../types';

export interface GateDef {
  id: string;
  /** Wave from which this gate spawns enemies. Gate 1 is always 1 (GDD §5.2). */
  openWave: number;
  /**
   * Waves this gate is active on, when it is not simply "from `openWave`
   * onwards". Used by the map 1 wave-5 breach, which borrows a side gate for
   * exactly one wave (GDD §11).
   */
  activeWaves?: number[];
  /**
   * Explicit spawn cells. Without this the gate is located by its layout digit,
   * which also forces the cell to `spawn` terrain; a gate sitting behind a
   * sealed wall has to be declared here instead so its terrain is preserved.
   */
  cells?: CellCoord[];
  label?: string;
}

export interface ZoneDef {
  /** 变电区 id, e.g. `"A"` / `"B"`. */
  id: string;
  label?: string;
  /** Cells covered, as rectangles. Non-buildable cells inside are simply ignored. */
  rects?: Rect[];
  cells?: CellCoord[];
  /** Core integrity at or below which the zone is lost (GDD §10). */
  triggerIntegrity: number;
  /** Supply cap removed when the zone is lost. */
  powerPenalty: number;
  /** Barrier that opens together with the loss, giving enemies a shortcut. */
  opensBarrier?: string;
}

export interface BarrierCell extends CellCoord {
  /** Per-cell result, overriding `BarrierDef.openTerrain`. */
  terrain?: TerrainName;
  /** Marks the opened cell as 可挖路段. */
  diggable?: boolean;
}

export interface BarrierDef {
  /** Referenced by `ZoneDef.opensBarrier` and by `Grid.openBarrier()`. */
  id: string;
  /** Terrain the cells become once the barrier opens. */
  openTerrain?: TerrainName;
  /** Extra cells beyond the ones marked in the layout. */
  cells?: BarrierCell[];
  /** Opens automatically at the start of this wave (map 1's wave-5 breach). */
  openAtWave?: number;
  label?: string;
}

export interface EngineeringQuotaGrant {
  wave: number;
  dig?: number;
  bridge?: number;
}

export interface EngineeringDef {
  digQuota: number;
  bridgeQuota: number;
  /** Mid-run replenishment, e.g. map 1 hands out one extra dig at wave 15. */
  grants?: EngineeringQuotaGrant[];
}

/** Per-map wave weighting (GDD §8.3): one base table, three multiplier columns. */
export interface MapWaveModifiers {
  hpMultiplier?: number;
  speedMultiplier?: number;
  /** Scales the spawn count of every enemy of that class. */
  countMultipliers?: Record<string, number>;
  /** Earliest wave an enemy id may appear on this map. */
  firstAppearance?: Record<string, number>;
  /** Inject a small squad on the exact first-appearance wave when absent. */
  injectOnFirstAppearance?: boolean;
  /** Per-wave surgery keyed by wave number (boss doubling, escorts, …). */
  waveOverrides?: Record<string, WaveOverrideDef>;
}

export interface WaveOverrideDef {
  /** Replace the base wave wholesale. */
  replace?: BaseWaveGroupsDef;
  /** Extra groups appended after the base ones. */
  addGroups?: BaseWaveGroupsDef;
  /** Multiply the count of specific enemy ids. */
  countScale?: Record<string, number>;
  /** Extra HP multiplier on top of the map-wide one (e.g. map 3 Leviathan ×1.2). */
  hpMultiplier?: number;
}

/** Loose alias so `mapDef` need not import the wave module. */
export type BaseWaveGroupsDef = ReadonlyArray<{
  enemy: string;
  count: number;
  interval?: number;
  delay?: number;
  gate?: number | 'all' | 'spread';
}>;

export interface LegendEntry {
  terrain: TerrainName;
  flags?: number;
  /** Index into `MapDef.gates`. */
  gate?: number;
  /** Index into `MapDef.barriers`. */
  barrier?: number;
  core?: boolean;
}

export interface MapDef {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** One string per row, `cols` characters each. See `DEFAULT_LEGEND`. */
  layout: string[];
  /** Extra or overriding characters. */
  legend?: Record<string, LegendEntry>;
  gates: GateDef[];
  barriers?: BarrierDef[];
  zones?: ZoneDef[];
  engineering: EngineeringDef;
  waveModifiers?: MapWaveModifiers;
  /** Free-form authoring notes; never read by the simulation. */
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * Default character set. Gates are digits `1`–`3` (index into `MapDef.gates`),
 * barriers are `L`/`M`/`N` (index into `MapDef.barriers`).
 */
export const DEFAULT_LEGEND: Readonly<Record<string, LegendEntry>> = {
  '.': { terrain: 'ground' },
  '#': { terrain: 'rock' },
  '=': { terrain: 'path' },
  d: { terrain: 'path', flags: CellFlag.Diggable },
  '~': { terrain: 'puddle' },
  D: { terrain: 'puddle', flags: CellFlag.Diggable },
  F: { terrain: 'path', flags: CellFlag.Floodway },
  ',': { terrain: 'soft_soil' },
  g: { terrain: 'soft_soil', flags: CellFlag.Geothermal },
  v: { terrain: 'trench' },
  w: { terrain: 'water' },
  b: { terrain: 'bridge' },
  C: { terrain: 'core', core: true },
  '1': { terrain: 'spawn', gate: 0 },
  '2': { terrain: 'spawn', gate: 1 },
  '3': { terrain: 'spawn', gate: 2 },
  L: { terrain: 'rock', flags: CellFlag.Barrier, barrier: 0 },
  M: { terrain: 'rock', flags: CellFlag.Barrier, barrier: 1 },
  N: { terrain: 'rock', flags: CellFlag.Barrier, barrier: 2 },
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedLayout {
  cols: number;
  rows: number;
  terrain: Uint8Array;
  flags: Uint8Array;
  /** Index into `MapDef.barriers`, -1 when the cell belongs to none. */
  barrier: Int8Array;
  gateCells: Array<CellCoord & { gateIndex: number }>;
  coreCells: CellCoord[];
}

export class MapDefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapDefError';
  }
}

export function resolveLegend(def: MapDef): Record<string, LegendEntry> {
  return { ...DEFAULT_LEGEND, ...(def.legend ?? {}) };
}

export function parseMapLayout(def: MapDef): ParsedLayout {
  const { cols, rows, layout } = def;
  if (layout.length !== rows) {
    throw new MapDefError(`map "${def.id}": layout has ${layout.length} rows, expected ${rows}`);
  }

  const legend = resolveLegend(def);
  const terrain = new Uint8Array(cols * rows);
  const flags = new Uint8Array(cols * rows);
  const barrier = new Int8Array(cols * rows).fill(-1);
  const gateCells: Array<CellCoord & { gateIndex: number }> = [];
  const coreCells: CellCoord[] = [];

  for (let cy = 0; cy < rows; cy += 1) {
    const line = layout[cy] as string;
    if (line.length !== cols) {
      throw new MapDefError(
        `map "${def.id}": row ${cy} has ${line.length} characters, expected ${cols}`,
      );
    }
    for (let cx = 0; cx < cols; cx += 1) {
      const char = line[cx] as string;
      const entry = legend[char];
      if (!entry) {
        throw new MapDefError(`map "${def.id}": unknown layout character "${char}" at ${cx},${cy}`);
      }
      const index = cy * cols + cx;
      terrain[index] = TERRAIN_CODES[entry.terrain];
      flags[index] = entry.flags ?? 0;
      if (entry.barrier !== undefined) barrier[index] = entry.barrier;
      if (entry.gate !== undefined) gateCells.push({ cx, cy, gateIndex: entry.gate });
      if (entry.core) coreCells.push({ cx, cy });
    }
  }

  // Barrier cells listed outside the layout.
  (def.barriers ?? []).forEach((barrierDef, barrierIndex) => {
    for (const cell of barrierDef.cells ?? []) {
      const index = cell.cy * cols + cell.cx;
      if (index < 0 || index >= terrain.length) {
        throw new MapDefError(
          `map "${def.id}": barrier "${barrierDef.id}" references out-of-bounds cell ${cell.cx},${cell.cy}`,
        );
      }
      flags[index] |= CellFlag.Barrier;
      barrier[index] = barrierIndex;
    }
  });

  return { cols, rows, terrain, flags, barrier, gateCells, coreCells };
}

/**
 * Structural validation. Reachability is verified separately by the grid (it
 * needs the flow field), so this stays a pure data check.
 */
export function validateMapDef(def: MapDef): string[] {
  const problems: string[] = [];

  if (!def.id) problems.push('missing id');
  if (def.cols <= 0 || def.rows <= 0) problems.push('cols/rows must be positive');
  if (def.gates.length === 0) problems.push('at least one gate is required');

  const gateIds = new Set<string>();
  for (const gate of def.gates) {
    if (gateIds.has(gate.id)) problems.push(`duplicate gate id "${gate.id}"`);
    gateIds.add(gate.id);
    if (gate.openWave < 1) problems.push(`gate "${gate.id}" has openWave < 1`);
  }

  let parsed: ParsedLayout | null = null;
  try {
    parsed = parseMapLayout(def);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  if (parsed) {
    if (parsed.coreCells.length === 0) problems.push('layout contains no core cell ("C")');
    const seenGateIndices = new Set(parsed.gateCells.map((cell) => cell.gateIndex));
    def.gates.forEach((gate, gateIndex) => {
      if (!seenGateIndices.has(gateIndex) && !gate.cells?.length) {
        problems.push(`gate "${gate.id}" (index ${gateIndex}) has neither a layout cell nor explicit cells`);
      }
    });
    for (const gateIndex of seenGateIndices) {
      if (gateIndex >= def.gates.length) {
        problems.push(`layout marks gate index ${gateIndex} but only ${def.gates.length} are declared`);
      }
    }
    for (const barrierIndex of parsed.barrier) {
      if (barrierIndex >= (def.barriers?.length ?? 0)) {
        problems.push(`layout marks barrier index ${barrierIndex} but none is declared`);
      }
    }
  }

  const barrierIds = new Set((def.barriers ?? []).map((barrier) => barrier.id));
  for (const zone of def.zones ?? []) {
    if (zone.opensBarrier && !barrierIds.has(zone.opensBarrier)) {
      problems.push(`zone "${zone.id}" opens unknown barrier "${zone.opensBarrier}"`);
    }
    if (!zone.rects?.length && !zone.cells?.length) {
      problems.push(`zone "${zone.id}" covers no cells`);
    }
    for (const rect of zone.rects ?? []) {
      if (
        rect.cx < 0 ||
        rect.cy < 0 ||
        rect.cx + rect.w > def.cols ||
        rect.cy + rect.h > def.rows
      ) {
        problems.push(`zone "${zone.id}" has a rect outside the board`);
      }
    }
  }

  if (def.engineering.digQuota < 0 || def.engineering.bridgeQuota < 0) {
    problems.push('engineering quotas must be >= 0');
  }

  return problems;
}

/** Validates and returns the definition, throwing on the first batch of errors. */
export function loadMapDef(def: MapDef): MapDef {
  const problems = validateMapDef(def);
  if (problems.length > 0) {
    throw new MapDefError(`invalid MapDef "${def.id}":\n  - ${problems.join('\n  - ')}`);
  }
  return def;
}

/** Expands a zone definition into the list of cells it covers. */
export function zoneCells(zone: ZoneDef, cols: number, rows: number): CellCoord[] {
  const cells: CellCoord[] = [];
  const seen = new Set<number>();
  const push = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const index = cy * cols + cx;
    if (seen.has(index)) return;
    seen.add(index);
    cells.push({ cx, cy });
  };

  for (const rect of zone.rects ?? []) {
    for (let dy = 0; dy < rect.h; dy += 1) {
      for (let dx = 0; dx < rect.w; dx += 1) push(rect.cx + dx, rect.cy + dy);
    }
  }
  for (const cell of zone.cells ?? []) push(cell.cx, cell.cy);
  return cells;
}
