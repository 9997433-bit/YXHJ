/**
 * Enemy definitions (GDD §8). Pure data; the runtime lives in `enemy.ts`.
 */

import type { ComboId, StatusId } from '../types';

/**
 * What the enemy does besides walking. `walk` and `fly` are the two movement
 * modes; the rest are the three break-the-formation archetypes of GDD §8.1.
 */
export type EnemyBehaviour =
  | { kind: 'walk' }
  | { kind: 'fly' }
  /** Repair drone / mothership: heals nearby allies. */
  | { kind: 'heal'; radius: number; healPerSecond: number; tickInterval: number }
  /** Sapper crab: closes on the nearest tower and detonates. */
  | {
      kind: 'demolish';
      /** Scans this many cells around its path for a tower (GDD §8.1: 2). */
      scanRadius: number;
      /** Wind-up before detonation, so the player can react. */
      fuse: number;
      /** Towers hit are shut down for this long instead of destroyed. */
      towerDisableSeconds: number;
      /** Also destroys player-built bridge tiles it walks over. */
      destroysBridges: boolean;
      /** Blast radius in cells for the tower shutdown. */
      blastRadius: number;
    };

/** Extra units released when the enemy dies (mothership drops 4 drones). */
export interface DeathSpawn {
  defId: string;
  count: number;
  spreadRadius: number;
}

/**
 * HP-threshold phase (Leviathan, GDD §8.2). Entered top-down: the first phase
 * whose `enterAtHpFraction` is satisfied and whose index is ahead of the
 * current one wins.
 */
export interface EnemyPhase {
  id: string;
  /** Entered when hp/maxHp drops to or below this. Use 1 for the opener. */
  enterAtHpFraction: number;
  speedMul?: number;
  damageTakenMul?: number;
  /** Overrides the def-level immunities while this phase is active. */
  statusImmunities?: StatusId[];
  comboMultipliers?: Partial<Record<ComboId, number>>;
  /** P3 overload sprint burns the Leviathan down at 30 HP/s. */
  selfDamagePerSecond?: number;
  /** Released once, on entering the phase. */
  spawnOnEnter?: DeathSpawn[];
}

export interface EnemyDef {
  id: string;
  displayName: string;
  hp: number;
  /** Cells per second (GDD §8.1). */
  speed: number;
  /** Flat reduction per hit; combos that ignore armour bypass it entirely. */
  armor: number;
  bounty: number;
  /** Core integrity lost when this enemy leaks (GDD §10), as a positive number. */
  integrityDamage: number;
  /** Gold stolen on leak (GDD §10 flat 10). */
  goldStolen: number;
  isFlying: boolean;
  /** Hit radius in cells, used by cones, splash and chain range checks. */
  radius: number;
  /** Free-form markers matched by `targetHasFlag` in the reaction table. */
  flags: readonly string[];
  behaviour: EnemyBehaviour;
  statusImmunities?: readonly StatusId[];
  /** Per-combo damage scaling, e.g. the Leviathan taking x4 from shatter. */
  comboMultipliers?: Partial<Record<ComboId, number>>;
  phases?: readonly EnemyPhase[];
  onDeathSpawn?: readonly DeathSpawn[];
  /** Reaching the core ends the run outright (Leviathan only, GDD §8.1). */
  lossOnLeak?: boolean;
  ui: {
    icon: string;
    /** Low-poly mesh id for the render layer. */
    mesh: string;
    /** Shown above the health bar, e.g. the healer's wrench (GDD §14.2). */
    marker?: string;
  };
  note?: string;
}
