/**
 * M1 vertical-slice constants.
 *
 * Everything here is presentation or slice scope — the balance numbers stay in
 * `data/*.json` and `src/combat/data`. When a value duplicates something the
 * design owns, the source is cited so the copy can be deleted later rather than
 * becoming a second source of truth.
 */

import type { ComboId, IconName } from '../ui';
import type { TerrainName } from '../gameplay';

/** `data/game_state.defaults.json` → `defaults` / `limits` / `rules`. */
export const ECONOMY_DEFAULTS = {
  gold: 220,
  powerCap: 8,
  battery: 0,
  batteryMax: 100,
  integrity: 100,
  integrityMax: 100,
  /** rules.battery.charge_per_idle_power_per_s */
  batteryChargePerIdlePower: 0.25,
  /** rules.battery.overload_battery_cost */
  overloadCost: 20,
  /** rules.economy.early_wave_bonus_ratio */
  earlyBonusPercent: 10,
} as const;

export interface BuildEntry {
  /** Canonical tower id — `src/combat/data/towers.ts`. */
  defId: string;
  icon: IconName;
  hotkey: string;
}

/**
 * The M1 build menu (GDD §19 M1: four towers plus the generator).
 *
 * Slice deviation, deliberate: `data/waves.map1.json.unlock_schedule` gates the
 * condenser and the hammer behind wave 3, which is correct for the tutorial but
 * makes the shatter chain unreachable in a two-minute playtest. Everything here
 * is unlocked from the deploy phase until the tutorial track (M2) lands and can
 * drive `unlocked` from the schedule again.
 */
export const M1_BUILD_MENU: readonly BuildEntry[] = [
  { defId: 'rivet_mg', icon: 'tower-rivet', hotkey: '1' },
  { defId: 'tar_sprayer', icon: 'tower-tar', hotkey: '2' },
  { defId: 'condenser', icon: 'tower-condenser', hotkey: '3' },
  { defId: 'hydraulic_hammer', icon: 'tower-hammer', hotkey: '4' },
  { defId: 'generator', icon: 'building-generator', hotkey: '5' },
];

/** Enemy def id → next-wave preview icon (`src/ui/icons.ts`). */
export const ENEMY_ICONS: Readonly<Record<string, IconName>> = {
  scavenger_bug: 'enemy-bug',
  scurry_rats: 'enemy-rat',
  armored_hauler: 'enemy-hauler',
  scout_bee: 'enemy-bee',
  sapper_crab: 'enemy-sapper',
  repair_drone: 'enemy-medic',
  repair_mothership: 'enemy-boss',
  leviathan: 'enemy-boss',
};

/**
 * `combat.ComboId` → `ui.ComboId`.
 *
 * The two modules named the same four combos differently (`shatter` vs
 * `ice-shatter`, `oil_fire` vs `oil-fire`). Neither is wrong on its own and
 * neither should import the other, so the join lives here. Delete this table
 * once the shared id registry lands and both sides read it.
 */
export const COMBO_TIP_IDS: Readonly<Record<string, ComboId>> = {
  shatter: 'ice-shatter',
  ice_shatter: 'ice-shatter',
  oil_fire: 'oil-fire',
  conduct: 'conduct',
  overload: 'overload',
};

export interface TerrainStyle {
  /** Top surface height in world units; negative sinks the cell. */
  height: number;
  color: number;
  /** Non-zero makes the cell a bloom source — reserved for core and gates. */
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
  scavenger_bug: { color: 0x6d7a4a, emissive: 0x2b3a12, size: 0.3, hover: 0, shape: 'bug' },
  scurry_rats: { color: 0x8a6a4b, emissive: 0x3a2410, size: 0.24, hover: 0, shape: 'rat' },
  armored_hauler: { color: 0x5b6068, emissive: 0x141a22, size: 0.46, hover: 0, shape: 'hauler' },
  scout_bee: { color: 0xc7a23a, emissive: 0x6b4c00, size: 0.28, hover: 0.95, shape: 'bee' },
  sapper_crab: { color: 0x8c4535, emissive: 0x5a1408, size: 0.4, hover: 0, shape: 'crab' },
  repair_drone: { color: 0x4f8a72, emissive: 0x0d4a34, size: 0.3, hover: 0.55, shape: 'drone' },
  repair_mothership: { color: 0x4f8a72, emissive: 0x0d4a34, size: 0.7, hover: 0.3, shape: 'boss' },
  leviathan: { color: 0x4a4038, emissive: 0x2a0c06, size: 1.0, hover: 0, shape: 'boss' },
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
