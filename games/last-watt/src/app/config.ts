/**
 * M1 vertical-slice presentation constants.
 *
 * Ids are canonical (`data/*.json`, INTEGRATION.md §3). Nothing here is a
 * balance number — costs, ranges and unlock waves come from the content tables
 * through `GameSession.snapshot()`; this file only decides what a thing looks
 * like and which of the eight blueprints the slice puts on the bar.
 */

import { ENEMY_IDS, TOWER_IDS } from '../combat';
import type { IconName } from '../ui';
import type { TerrainName } from '../gameplay';

export interface BuildEntry {
  defId: string;
  icon: IconName;
  hotkey: string;
}

/**
 * The M1 build bar (GDD §19 M1: four towers plus the generator).
 *
 * Order is the hotkey order. The remaining three blueprints exist in the
 * content tables but are M2 content, so they are not listed rather than listed
 * and greyed out — a locked row the player can never reach this milestone is
 * noise.
 */
export const M1_BUILD_MENU: readonly BuildEntry[] = [
  { defId: TOWER_IDS.rivetMg, icon: 'tower-rivet', hotkey: '1' },
  { defId: TOWER_IDS.tarSprayer, icon: 'tower-tar', hotkey: '2' },
  { defId: TOWER_IDS.condenserJet, icon: 'tower-condenser', hotkey: '3' },
  { defId: TOWER_IDS.hydraulicBreaker, icon: 'tower-hammer', hotkey: '4' },
  { defId: TOWER_IDS.generator, icon: 'building-generator', hotkey: '5' },
];

/** Tower def id → HUD icon (`src/ui/icons.ts`). */
export const TOWER_ICONS: Readonly<Record<string, IconName>> = Object.fromEntries(
  M1_BUILD_MENU.map((entry) => [entry.defId, entry.icon]),
);

/** Enemy def id → next-wave preview icon. */
export const ENEMY_ICONS: Readonly<Record<string, IconName>> = {
  [ENEMY_IDS.scavengerBug]: 'enemy-bug',
  [ENEMY_IDS.swiftRat]: 'enemy-rat',
  [ENEMY_IDS.armoredTruck]: 'enemy-hauler',
  [ENEMY_IDS.scoutWasp]: 'enemy-bee',
  [ENEMY_IDS.demoSapper]: 'enemy-sapper',
  [ENEMY_IDS.repairDrone]: 'enemy-medic',
  [ENEMY_IDS.repairMothership]: 'enemy-boss',
  [ENEMY_IDS.leviathan]: 'enemy-boss',
};

export interface TerrainStyle {
  /** Top surface height in world units; negative sinks the cell. */
  height: number;
  color: number;
  /** Non-zero makes the cell a bloom source — reserved for the core and gates. */
  emissive?: number;
  emissiveIntensity?: number;
}

/**
 * Terrain relief. The heights matter more than the colours: an oblique 55°
 * camera reads a step long before it reads a hue, which is what keeps the board
 * from collapsing into the flat tile-map look GDD §15 rules out.
 */
export const TERRAIN_STYLES: Readonly<Record<TerrainName, TerrainStyle>> = {
  ground: { height: 0.22, color: 0x7a5340 },
  path: { height: 0.04, color: 0x38302a },
  puddle: { height: 0.02, color: 0x1d3b47 },
  soft_soil: { height: 0.14, color: 0x4d3826 },
  trench: { height: -0.42, color: 0x140f0c },
  water: { height: -0.24, color: 0x14313d },
  bridge: { height: 0.1, color: 0x5c4630 },
  rock: { height: 0.52, color: 0x2b221c },
  core: { height: 0.34, color: 0x123840, emissive: 0x35e0ff, emissiveIntensity: 1.6 },
  spawn: { height: 0.04, color: 0x4a231d, emissive: 0xff3b30, emissiveIntensity: 0.9 },
};

export interface EnemyStyle {
  color: number;
  emissive: number;
  /** Silhouette radius in cells; the def's own radius drives collision. */
  size: number;
  /** Height above the board. Flyers hover. */
  hover: number;
  shape: 'bug' | 'rat' | 'hauler' | 'bee' | 'crab' | 'drone' | 'boss';
}

export const ENEMY_STYLES: Readonly<Record<string, EnemyStyle>> = {
  [ENEMY_IDS.scavengerBug]: { color: 0x6d7a4a, emissive: 0x2b3a12, size: 0.3, hover: 0, shape: 'bug' },
  [ENEMY_IDS.swiftRat]: { color: 0x8a6a4b, emissive: 0x3a2410, size: 0.24, hover: 0, shape: 'rat' },
  [ENEMY_IDS.armoredTruck]: { color: 0x5b6068, emissive: 0x141a22, size: 0.46, hover: 0, shape: 'hauler' },
  [ENEMY_IDS.scoutWasp]: { color: 0xc7a23a, emissive: 0x6b4c00, size: 0.28, hover: 0.95, shape: 'bee' },
  [ENEMY_IDS.demoSapper]: { color: 0x8c4535, emissive: 0x5a1408, size: 0.4, hover: 0, shape: 'crab' },
  [ENEMY_IDS.repairDrone]: { color: 0x4f8a72, emissive: 0x0d4a34, size: 0.3, hover: 0.55, shape: 'drone' },
  [ENEMY_IDS.repairMothership]: { color: 0x4f8a72, emissive: 0x0d4a34, size: 0.7, hover: 0.3, shape: 'boss' },
  [ENEMY_IDS.leviathan]: { color: 0x4a4038, emissive: 0x2a0c06, size: 1.0, hover: 0, shape: 'boss' },
};

export const DEFAULT_ENEMY_STYLE: EnemyStyle = {
  color: 0x7a6a58,
  emissive: 0x1a120c,
  size: 0.3,
  hover: 0,
  shape: 'bug',
};

/** Shared with `src/ui/theme.ts` and `src/engine/config.ts` (GDD §15.2). */
export const APP_PALETTE = {
  electric: 0x35e0ff,
  frost: 0xbff7ff,
  ember: 0xff7a29,
  coin: 0xffd84d,
  alarm: 0xff3b30,
  tar: 0x6b4a2b,
} as const;
