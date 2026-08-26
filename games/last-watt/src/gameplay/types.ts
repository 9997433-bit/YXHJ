/**
 * Shared value types for the gameplay module (grid, pathing, engineering, waves).
 *
 * Engine-agnostic by contract: no Three.js, no DOM, no imports from sibling
 * `src/` subtrees. Coordinates follow the combat module's convention
 * (`cx`/`cy`, integer cell indices, 1.0 world unit == 1 cell) so the two
 * modules interoperate structurally without importing each other.
 * `src/engine` names the same pair `col`/`row`.
 */

export type Seconds = number;

export interface Vec2 {
  x: number;
  y: number;
}

/** Integer cell coordinate. Structurally identical to `combat.CellCoord`. */
export interface CellCoord {
  cx: number;
  cy: number;
}

export interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Terrain (GDD §5.1)
// ---------------------------------------------------------------------------

/**
 * Terrain codes are stored as bytes in the grid's typed arrays; the string
 * names are the public/serialised form.
 */
export const TERRAIN_CODES = {
  /** 地基 — buildable, enemies cannot enter. */
  ground: 0,
  /** 路面 — walkable, not buildable. */
  path: 1,
  /** 水洼 — road variant; stepping on it applies `wet` for 6s. */
  puddle: 2,
  /** 软土 — neither walkable nor buildable; scenery that reads as "diggable land". */
  soft_soil: 3,
  /** 沟壑 — bridgeable gap. Result of a completed dig. */
  trench: 4,
  /** 水面 — bridgeable water. */
  water: 5,
  /** 桥 — walkable. Player-built bridges are what sapper crabs blow up. */
  bridge: 6,
  /** Permanent scenery block (walls, rubble, machinery). */
  rock: 7,
  /** 核心 — the flow-field goal. */
  core: 8,
  /** 出怪口 — spawn cell, walkable. */
  spawn: 9,
} as const;

export type TerrainName = keyof typeof TERRAIN_CODES;
export type TerrainCode = (typeof TERRAIN_CODES)[TerrainName];

export const TERRAIN_NAMES = Object.keys(TERRAIN_CODES) as TerrainName[];

export interface TerrainTraits {
  /** Ground units may occupy the cell. */
  walkable: boolean;
  /** Towers and generators may be placed here (before occupancy/power checks). */
  buildable: boolean;
  /** Counts as road for coatings — oil and fire only stick to road cells. */
  road: boolean;
  /** Water surface, for the conduction combo and for shader/VFX selection. */
  water: boolean;
  /** A bridge may be built over it. */
  bridgeable: boolean;
}

const T = (
  walkable: boolean,
  buildable: boolean,
  road: boolean,
  water: boolean,
  bridgeable: boolean,
): TerrainTraits => ({ walkable, buildable, road, water, bridgeable });

export const TERRAIN_TRAITS: Readonly<Record<TerrainName, TerrainTraits>> = {
  //         walkable buildable road   water  bridgeable
  ground: T(false, true, false, false, false),
  path: T(true, false, true, false, false),
  puddle: T(true, false, true, true, false),
  soft_soil: T(false, false, false, false, false),
  trench: T(false, false, false, false, true),
  water: T(false, false, false, true, true),
  bridge: T(true, false, true, false, false),
  rock: T(false, false, false, false, false),
  core: T(true, false, false, false, false),
  spawn: T(true, false, true, false, false),
};

export function terrainTraits(name: TerrainName): TerrainTraits {
  return TERRAIN_TRAITS[name];
}

// ---------------------------------------------------------------------------
// Per-cell flags (bitfield, stored alongside terrain)
// ---------------------------------------------------------------------------

export const CellFlag = {
  None: 0,
  /** 可挖路段 — a road cell overlapping soft soil, the only legal dig target. */
  Diggable: 1 << 0,
  /** Cell belongs to a closed barrier group (a sluice the enemy cannot pass yet). */
  Barrier: 1 << 1,
  /** 泄洪道 (map 2) — washed clean of oil at the start of every wave. */
  Floodway: 1 << 2,
  /** 地热裂隙 (map 3) — an adjacent generator supplies +2 extra power. */
  Geothermal: 1 << 3,
  /** A tower/generator stands here. Set by the build system, not by the grid. */
  Occupied: 1 << 4,
  /** This bridge was built by the player, so a sapper crab may destroy it. */
  PlayerBridge: 1 << 5,
  /** An engineering job is currently running on this cell. */
  UnderConstruction: 1 << 6,
} as const;

export type CellFlagValue = (typeof CellFlag)[keyof typeof CellFlag];

/** Read-only snapshot of one cell — the `Cell` record of GDD §17.1. */
export interface CellData extends CellCoord {
  index: number;
  terrain: TerrainName;
  /** Terrain the cell had when the map was loaded (bridges revert to it). */
  baseTerrain: TerrainName;
  walkable: boolean;
  buildable: boolean;
  diggable: boolean;
  bridgeable: boolean;
  occupied: boolean;
  powered: boolean;
  underConstruction: boolean;
  zoneId: string | null;
  barrierId: string | null;
  flags: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function cellCenter(cx: number, cy: number): Vec2 {
  return { x: cx + 0.5, y: cy + 0.5 };
}

export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function manhattan(a: CellCoord, b: CellCoord): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

export function sameCell(a: CellCoord, b: CellCoord): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}
