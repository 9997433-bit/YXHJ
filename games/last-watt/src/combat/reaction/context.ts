/**
 * The context a reaction row is evaluated against, plus the narrow runtime
 * interface effects are allowed to touch.
 *
 * Keeping the runtime an interface (implemented by `CombatSystem`) means the
 * reaction engine can be unit-tested against a fake world with no towers,
 * no terrain and no event bus.
 */

import type { Enemy } from '../entities/enemy';
import type { TerrainQuery } from '../ports';
import type { StatusModifiers, StatusRemovalReason } from '../status/statusDef';
import type {
  AttackerKind,
  CellCoating,
  CellCoord,
  ComboId,
  DamageType,
  EntityId,
  ReactionTrigger,
  Seconds,
  SourceTag,
  StatusId,
  Vec2,
} from '../types';

/** Who produced the event. Towers carry their def id so telemetry can bucket. */
export interface AttackSource {
  kind: AttackerKind;
  id?: EntityId;
  defId?: string;
}

/** Extra jumps / falloff granted to a chain attack by the conduct combo. */
export interface ChainBonus {
  extraJumps: number;
  falloffOverride?: number;
}

/**
 * A hit in flight. Reaction rows rewrite this before `damage.ts` applies it,
 * which is how shatter turns 45 damage into 112.5 armour-ignoring damage
 * without the damage code knowing what a shatter is.
 */
export interface MutableHit {
  amount: number;
  /** Damage rolled before any reaction touched it, kept for UI floaters. */
  readonly baseAmount: number;
  damageType: DamageType;
  tags: SourceTag[];
  ignoreArmor: boolean;
  combo?: ComboId;
  position: Vec2;
  chainBonus?: ChainBonus;
}

export interface SplashRequest {
  origin: Vec2;
  radius: number;
  amount: number;
  damageType: DamageType;
  tags: SourceTag[];
  ignoreArmor: boolean;
  combo?: ComboId;
  source: AttackSource;
  excludeEnemyId?: EntityId;
  depth: number;
}

export interface ReactionContext {
  trigger: ReactionTrigger;
  runtime: ReactionRuntime;
  source: AttackSource;
  /**
   * Tags of whatever produced this event. When a hit is present this is the
   * *same array* as `hit.tags`, so a row that brands the hit is visible to the
   * rows evaluated after it.
   */
  sourceTags: SourceTag[];
  /** Present for hit / status / cell-entry triggers. */
  target?: Enemy;
  /** Present for `on_hit`; the thing rows rewrite. */
  hit?: MutableHit;
  /** Present for `on_status_changed`. */
  changedStatus?: StatusId;
  /** Present for cell triggers. */
  cell?: CellCoord;
  cellCoating?: CellCoating;
  /** Present for `on_activate`. */
  activation?: string;
  /** Numbers the trigger supplies to `{ param, fallback }` lookups. */
  params: Readonly<Record<string, number>>;
  /** Recursion guard: primary hits are depth 0, reaction splash is depth 1. */
  depth: number;
  /** Row ids that fired, in order. Drives events and the one-shot tip bar. */
  readonly matched: string[];
  /** Mutex keys already claimed this evaluation. */
  readonly claimedMutex: Set<string>;
  /** Splash damage queued by effects, applied after the primary hit lands. */
  readonly pendingSplash: SplashRequest[];
}

export interface StatusApplyRequest {
  stacks?: number;
  duration?: Seconds;
  modifiers?: StatusModifiers;
  params?: Readonly<Record<string, number>>;
}

/**
 * Everything an effect is allowed to do to the world. Deliberately small:
 * if a new combo needs a verb that is not here, that is the signal to think
 * before widening the surface.
 */
export interface ReactionRuntime {
  /** Read-only terrain lookups for `cellTerrainIs`. */
  readonly terrain: TerrainQuery;
  applyStatus(enemy: Enemy, status: StatusId, request: StatusApplyRequest, source: AttackSource): void;
  removeStatus(enemy: Enemy, status: StatusId, reason: StatusRemovalReason): void;
  paintCells(
    origin: CellCoord,
    radius: number,
    coating: CellCoating,
    duration: Seconds,
    onlyOver?: CellCoating,
  ): void;
  overloadTowers(options: {
    scope: 'radius' | 'global';
    origin?: CellCoord;
    radius: number;
    attackSpeedMul: number;
    duration: Seconds;
    overheat: Seconds;
    poweredTowersOnly: boolean;
  }): number;
  stunEnemies(options: {
    scope: 'global' | 'radius';
    origin?: Vec2;
    radius: number;
    duration: Seconds;
  }): number;
  consumeBattery(amount: number): boolean;
  readonly battery: number;
}
