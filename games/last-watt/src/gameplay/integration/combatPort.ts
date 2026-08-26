/**
 * The slice of `src/combat` the gameplay module talks to.
 *
 * Structural, not nominal: nothing is imported across the subtree boundary
 * (README "本模块不拥有" contract). `CombatSystem` satisfies these shapes as it
 * stands, and a stub that satisfies them drives the whole session headless —
 * which is what lets `selfcheck.ts` exercise the wiring without pulling combat,
 * three.js or a canvas into the run.
 *
 * Everything here mirrors `src/combat/{combatSystem,events,ports,data}.ts`. When
 * combat changes one of these signatures, this file is the single place that
 * has to follow.
 */

import type { CellCoord, Seconds, Vec2 } from '../types';

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/** Passive economy contributions of a building (`combat.BuildingEffects`). */
export interface BuildingEffectsView {
  powerCapBonus?: number;
  /** Map 3: a generator next to a geothermal fissure supplies more (GDD §5.2). */
  powerCapBonusOnFissure?: number;
  batteryCapBonus?: number;
  batteryChargeMul?: number;
}

/** The columns of a `combat.TowerDef` the build menu and the wallet need. */
export interface TowerDefView {
  readonly id: string;
  readonly displayName: string;
  readonly cost: number;
  /** Permanent draw on the supply cap (GDD §6.2); never released until sold. */
  readonly powerCost: number;
  readonly category: 'tower' | 'building';
  /** `kind: 'none'` for the generator and the capacitor station. */
  readonly attack: { readonly kind: string; readonly targetsAir?: boolean | undefined };
  readonly building?: BuildingEffectsView | undefined;
  readonly activation?: { readonly id: string; readonly batteryCost: number } | undefined;
  readonly ui: { readonly icon: string; readonly unlockWave?: number | undefined };
}

export interface CombatContentView {
  tower(id: string): TowerDefView;
  allTowers(): TowerDefView[];
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** What `combat.buildTower` hands back. */
export interface CombatTowerHandle {
  readonly id: number;
}

/**
 * What `combat.spawnEnemy` hands back. The object identity is the key the
 * movement router uses, so per-enemy route data needs no id bookkeeping.
 */
export interface CombatEnemyHandle {
  readonly id: number;
  readonly defId: string;
  readonly position: Vec2;
}

export interface CombatSpawnOptions {
  position: Vec2;
  /** Waypoints; only flying units get one (GDD §5.1 straight-line flight). */
  path?: Vec2[];
  hpMultiplier?: number;
  gateId?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EnemySpawnedEvent {
  enemyId: number;
  defId: string;
  position: Vec2;
  maxHp: number;
}

export interface EnemyKilledEvent {
  enemyId: number;
  defId: string;
  bounty: number;
  position: Vec2;
}

export interface EnemyLeakedEvent {
  enemyId: number;
  defId: string;
  integrityDamage: number;
  goldStolen: number;
  /** Leviathan only: reaching the core ends the run outright (GDD §8.1). */
  lossOnLeak: boolean;
  gateId?: string;
}

export interface BridgeDestroyedEvent {
  cx: number;
  cy: number;
  enemyId: number;
}

/**
 * Overload set: one method per event so a generic bus (`CombatEventBus.on`)
 * assigns cleanly. A generic-to-generic match across two different event maps
 * does not.
 */
export interface CombatBusPort {
  on(name: 'enemy_spawned', listener: (payload: EnemySpawnedEvent) => void): () => void;
  on(name: 'enemy_killed', listener: (payload: EnemyKilledEvent) => void): () => void;
  on(name: 'enemy_leaked', listener: (payload: EnemyLeakedEvent) => void): () => void;
  on(name: 'bridge_destroyed', listener: (payload: BridgeDestroyedEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// The façade
// ---------------------------------------------------------------------------

/** `CombatSystem` seen from the gameplay side. */
export interface CombatPort {
  readonly bus: CombatBusPort;
  readonly content: CombatContentView;

  update(dt: Seconds): void;

  spawnEnemy(defId: string, options: CombatSpawnOptions): CombatEnemyHandle;
  buildTower(defId: string, cell: CellCoord): CombatTowerHandle;
  sellTower(towerId: number): number;
  upgradeTower(towerId: number, upgradeId: string): boolean;
  /** Called when a substation zone is lost or restored (GDD §10). */
  setTowerPowered(towerId: number, powered: boolean): void;
  /** Capacitor overload (GDD §7.3.4). */
  activateTower(towerId: number): boolean;
  /** 主控过载 (GDD §9). Charge accounting stays on the gameplay side. */
  activateMasterOverload(): boolean;
  /** Start-of-wave hook: map 2's floodway washes its oil away (GDD §5.2). */
  washFloodway(): void;
}
