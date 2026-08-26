/**
 * Damage request/result shapes and the small amount of pure arithmetic in the
 * damage pipeline. The pipeline itself lives in `CombatSystem.applyDamage`,
 * because applying damage means running reactions, which means touching the
 * world.
 */

import type { Enemy } from './entities/enemy';
import type { AttackSource, ChainBonus } from './reaction/context';
import type { ComboId, DamageType, EntityId, SourceTag, Vec2 } from './types';

export interface DamageRequest {
  target: Enemy;
  amount: number;
  damageType: DamageType;
  tags: SourceTag[];
  source: AttackSource;
  position?: Vec2;
  ignoreArmor?: boolean;
  /** Pre-set combo attribution, used when splash inherits its parent's combo. */
  combo?: ComboId;
  /** Params published to the reaction table for this hit. */
  params?: Readonly<Record<string, number>>;
  /** 0 for a primary hit; reaction-spawned damage increments it. */
  depth?: number;
}

export interface DamageResult {
  /** HP actually removed. */
  applied: number;
  /** Damage eaten by armour this hit — the "-5" grey floater of GDD §11. */
  absorbed: number;
  killed: boolean;
  combo?: ComboId;
  /** Chain bonus granted by the conduct combo, read back by the tesla coil. */
  chainBonus?: ChainBonus;
  /** Reaction rows that fired on this hit, for tests and telemetry. */
  reactions: string[];
}

export const NO_DAMAGE: DamageResult = Object.freeze({
  applied: 0,
  absorbed: 0,
  killed: false,
  reactions: [] as string[],
});

/**
 * Flat armour subtraction (GDD §8.1: "-5 per hit"), with a floor of 1 so that
 * chip damage still chips (docs/SYSTEMS.md decision D2). The wave-3 teaching
 * moment reads the *absorbed* number for its grey "-5" floater, so the floor
 * does not weaken the lesson.
 */
export const MIN_DAMAGE_THROUGH_ARMOR = 1;

export function resolveArmor(amount: number, armor: number, ignoreArmor: boolean): {
  applied: number;
  absorbed: number;
} {
  if (ignoreArmor || armor <= 0 || amount <= 0) return { applied: amount, absorbed: 0 };
  const absorbed = Math.min(amount, armor);
  const applied = Math.max(MIN_DAMAGE_THROUGH_ARMOR, amount - absorbed);
  return { applied, absorbed };
}

/** Per-combo and per-tower damage accounting for the GDD §20 balance red lines. */
export class CombatStats {
  totalDamage = 0;
  readonly damageByCombo = new Map<ComboId, number>();
  readonly damageByTower = new Map<string, number>();
  readonly comboTriggerCount = new Map<string, number>();
  enemiesKilled = 0;
  enemiesLeaked = 0;

  recordDamage(amount: number, combo: ComboId | undefined, towerDefId: string | undefined): void {
    if (amount <= 0) return;
    this.totalDamage += amount;
    if (combo) this.damageByCombo.set(combo, (this.damageByCombo.get(combo) ?? 0) + amount);
    if (towerDefId) this.damageByTower.set(towerDefId, (this.damageByTower.get(towerDefId) ?? 0) + amount);
  }

  recordReaction(rowId: string): void {
    this.comboTriggerCount.set(rowId, (this.comboTriggerCount.get(rowId) ?? 0) + 1);
  }

  /** Share of all damage attributable to a combo; the §20 red line is 0.40. */
  comboShare(combo: ComboId): number {
    if (this.totalDamage <= 0) return 0;
    return (this.damageByCombo.get(combo) ?? 0) / this.totalDamage;
  }

  reset(): void {
    this.totalDamage = 0;
    this.damageByCombo.clear();
    this.damageByTower.clear();
    this.comboTriggerCount.clear();
    this.enemiesKilled = 0;
    this.enemiesLeaked = 0;
  }
}

/** Identifies the tower that fired, when there was one. */
export function towerDefIdOf(source: AttackSource): string | undefined {
  return source.kind === 'tower' ? source.defId : undefined;
}

export function towerIdOf(source: AttackSource): EntityId | undefined {
  return source.kind === 'tower' ? source.id : undefined;
}
