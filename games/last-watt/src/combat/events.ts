/**
 * Outbound combat event stream.
 *
 * This is the only channel combat uses to talk to presentation (`src/vfx`,
 * `src/ui`) and to the meta layers (`src/gameplay` economy, integrity).
 * Combat never imports those modules; it emits and forgets.
 */

import type {
  CellCoating,
  ComboId,
  DamageType,
  EntityId,
  ImpactSpec,
  Seconds,
  StatusId,
  Vec2,
} from './types';

export interface CombatEventMap {
  enemy_spawned: {
    enemyId: EntityId;
    defId: string;
    position: Vec2;
    maxHp: number;
  };
  enemy_damaged: {
    enemyId: EntityId;
    /** Damage actually subtracted from HP, after armour and multipliers. */
    amount: number;
    /** Damage rolled before armour, useful for "-5" chip-damage floaters. */
    rawAmount: number;
    /** Amount absorbed by armour this hit (GDD §8.1 armoured hauler). */
    absorbedByArmor: number;
    damageType: DamageType;
    /** Set when the damage was produced or amplified by a combo. */
    comboId?: ComboId;
    position: Vec2;
    remainingHp: number;
  };
  enemy_healed: {
    enemyId: EntityId;
    amount: number;
    healerId: EntityId;
  };
  enemy_killed: {
    enemyId: EntityId;
    defId: string;
    bounty: number;
    position: Vec2;
    /** What landed the killing blow, for the death-cause telemetry in §19 M2. */
    killerTowerId?: EntityId;
    comboId?: ComboId;
  };
  /** Reached the core. `src/gameplay` owns integrity and the gold theft. */
  enemy_leaked: {
    enemyId: EntityId;
    defId: string;
    integrityDamage: number;
    goldStolen: number;
    /** True only for the Leviathan: an instant loss (GDD §8.1). */
    lossOnLeak: boolean;
    gateId?: string;
  };
  enemy_phase_changed: {
    enemyId: EntityId;
    defId: string;
    phaseIndex: number;
    phaseId: string;
  };

  status_applied: {
    enemyId: EntityId;
    status: StatusId;
    stacks: number;
    duration: Seconds;
    /** True when the status was already present and only refreshed/stacked. */
    refreshed: boolean;
  };
  status_removed: {
    enemyId: EntityId;
    status: StatusId;
    reason: 'expired' | 'replaced' | 'consumed' | 'cleansed' | 'immune_host_died';
  };
  status_blocked: {
    enemyId: EntityId;
    status: StatusId;
    reason: 'immune' | 'blocked_by_status' | 'def_immunity';
  };

  reaction_triggered: {
    rowId: string;
    comboId?: ComboId;
    enemyId?: EntityId;
    sourceId?: EntityId;
    position: Vec2;
    impact: ImpactSpec;
  };
  /** Fires once per combo per session so the UI can pop the §14.2 tip bar. */
  combo_first_seen: {
    comboId: ComboId;
    position: Vec2;
    tip?: string;
  };

  tower_built: { towerId: EntityId; defId: string; cell: Vec2 };
  tower_sold: { towerId: EntityId; defId: string; refund: number };
  tower_upgraded: { towerId: EntityId; defId: string; upgradeId: string };
  tower_fired: {
    towerId: EntityId;
    defId: string;
    from: Vec2;
    to: Vec2;
    attackKind: string;
  };
  /** Tesla arc geometry, so the VFX layer can draw the polyline (§15.2). */
  chain_arc: {
    towerId: EntityId;
    points: Vec2[];
    /** True when the wet/conduct bonus was active on this arc. */
    empowered: boolean;
  };
  tower_state_changed: {
    towerId: EntityId;
    defId: string;
    state: 'idle' | 'overloaded' | 'overheated' | 'disabled' | 'unpowered';
    duration: Seconds;
  };

  cell_coating_changed: {
    cx: number;
    cy: number;
    coating: CellCoating;
    duration: Seconds;
  };

  /** Sapper crab blew up a bridge tile; `src/gameplay` owns the terrain edit. */
  bridge_destroyed: { cx: number; cy: number; enemyId: EntityId };

  /** Master overload ability resolved (GDD §9). */
  ability_master_overload: {
    towersAffected: number;
    enemiesStunned: number;
    duration: Seconds;
  };
}

export type CombatEventName = keyof CombatEventMap;

export type CombatEventListener<K extends CombatEventName> = (
  payload: CombatEventMap[K],
) => void;

/**
 * Tiny synchronous emitter. Deliberately not generic infrastructure: combat
 * needs exactly this and nothing more, and keeping it local keeps the module
 * dependency-free.
 */
export class CombatEventBus {
  private readonly listeners = new Map<CombatEventName, Set<(p: never) => void>>();

  on<K extends CombatEventName>(name: K, listener: CombatEventListener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as (p: never) => void);
    return () => {
      set?.delete(listener as (p: never) => void);
    };
  }

  emit<K extends CombatEventName>(name: K, payload: CombatEventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of set) {
      (listener as CombatEventListener<K>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
