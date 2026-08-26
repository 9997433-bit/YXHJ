/**
 * Enemy runtime instance.
 *
 * Holds only state. Movement is delegated to a `MovementDriver` port, damage
 * to `damage.ts`, statuses to `StatusSet`, and behaviour to `enemyBehaviour.ts`.
 */

import type { StatusRegistry } from '../status/statusDef';
import { StatusSet } from '../status/statusSet';
import type { CellCoord, EntityId, Seconds, StatusId, Vec2 } from '../types';
import type { EnemyDef, EnemyPhase } from './enemyDef';

export interface EnemySpawnOptions {
  position: Vec2;
  /** Waypoints from the gameplay flow field; may be empty for static tests. */
  path?: Vec2[];
  /** Per-map HP multiplier from `MapDef.wave_multipliers` (GDD §8.3). */
  hpMultiplier?: number;
  /** Which spawn gate released it, for the "which gate leaked most" readout. */
  gateId?: string;
}

export class Enemy {
  readonly statuses: StatusSet;

  hp: number;
  readonly maxHp: number;

  readonly position: Vec2;
  readonly facing: Vec2 = { x: 1, y: 0 };
  path: Vec2[];
  pathIndex = 0;
  /** Cells travelled, drives the "first" targeting strategy. */
  pathProgress = 0;
  reachedGoal = false;
  alive = true;

  phaseIndex = -1;
  /** Cell occupied last frame, so `on_cell_entered` fires exactly once. */
  lastCell: CellCoord = { cx: -1, cy: -1 };
  /** Behaviour cooldown: heal pulse timer or sapper fuse. */
  behaviourTimer = 0;
  /** Set once the sapper has committed to a target tower. */
  armedTargetId?: EntityId;
  age: Seconds = 0;
  readonly gateId?: string;

  constructor(
    readonly id: EntityId,
    readonly def: EnemyDef,
    registry: StatusRegistry,
    options: EnemySpawnOptions,
  ) {
    this.maxHp = def.hp * (options.hpMultiplier ?? 1);
    this.hp = this.maxHp;
    this.position = { x: options.position.x, y: options.position.y };
    this.path = options.path ? options.path.map((p) => ({ x: p.x, y: p.y })) : [];
    this.statuses = new StatusSet(registry, new Set(def.statusImmunities ?? []));
    if (options.gateId !== undefined) this.gateId = options.gateId;
  }

  get defId(): string {
    return this.def.id;
  }

  get radius(): number {
    return this.def.radius;
  }

  get isAirborne(): boolean {
    return this.def.isFlying;
  }

  get hpFraction(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  get currentPhase(): EnemyPhase | undefined {
    return this.phaseIndex >= 0 ? this.def.phases?.[this.phaseIndex] : undefined;
  }

  /** Speed after phase and status modifiers; 0 while frozen or stunned. */
  get effectiveSpeed(): number {
    const mods = this.statuses.modifiers();
    if (mods.immobile) return 0;
    return this.def.speed * mods.speedMul * (this.currentPhase?.speedMul ?? 1);
  }

  /** Flat armour after status shred, floored at zero. */
  get effectiveArmor(): number {
    return Math.max(0, this.def.armor + this.statuses.modifiers().armorDelta);
  }

  /** Incoming-damage multiplier from statuses and the active boss phase. */
  get damageTakenMul(): number {
    return this.statuses.modifiers().damageTakenMul * (this.currentPhase?.damageTakenMul ?? 1);
  }

  hasFlag(flag: string): boolean {
    return this.def.flags.includes(flag);
  }

  /** Def-level immunities merged with the active phase's overrides. */
  immunities(): Set<StatusId> {
    const phase = this.currentPhase;
    const ids = phase?.statusImmunities ?? this.def.statusImmunities ?? [];
    return new Set(ids);
  }

  comboMultiplier(combo: string): number {
    const phaseMul = (this.currentPhase?.comboMultipliers as Record<string, number> | undefined)?.[combo];
    const defMul = (this.def.comboMultipliers as Record<string, number> | undefined)?.[combo];
    return (phaseMul ?? defMul ?? 1);
  }
}
