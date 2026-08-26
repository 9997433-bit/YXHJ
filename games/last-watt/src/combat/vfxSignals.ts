/**
 * Stable VFX signals — combat's presentation contract with `src/vfx`.
 *
 * `reaction_triggered` is a firehose keyed by reaction row id, and
 * `status_applied` is keyed by status id. Both are implementation details of
 * the reaction table: renaming a row, splitting the freeze across two rows or
 * moving overload onto a new verb must not reach the particle layer. So combat
 * publishes a second, much smaller channel whose names are frozen:
 *
 * | Signal | Lifecycle | Declared by |
 * |---|---|---|
 * | `ice_shatter` | one-shot | a reaction row's `impact.signal` |
 * | `frozen` | `begin` / `end` | a `StatusDef.signal` |
 * | `overload` | `begin` / `end` | the `overloadTowers` reaction verb |
 *
 * Every producer is data or a verb, never an `if` on a content id, so the
 * anti-hard-coding rule of GDD §7.2 still holds. `ContentRegistry.validate()`
 * checks that each signal has exactly one declared producer, which is what
 * stops a second row from quietly double-firing the shatter burst.
 */

import type {
  CombatVfxSignal,
  EntityId,
  ImpactSpec,
  ReactionVfxSignal,
  Seconds,
  StatusVfxSignal,
  Vec2,
} from './types';

export type { CombatVfxSignal, ReactionVfxSignal, StatusVfxSignal };

export const COMBAT_VFX_SIGNALS: readonly CombatVfxSignal[] = ['ice_shatter', 'frozen', 'overload'];

/**
 * `overload` is emitted by the `overloadTowers` effect rather than declared on
 * a row, so it is not expected to appear in a row's `impact.signal`.
 */
export const VERB_EMITTED_SIGNALS: readonly CombatVfxSignal[] = ['overload'];

/** Why a `frozen` / `overload` signal is ending. */
export type SignalEndReason =
  /** Ran its natural course. */
  | 'expired'
  /** A combo consumed it — the shatter eating its own freeze. */
  | 'consumed'
  /** Removed by an opposing effect, e.g. the flamethrower's thaw. */
  | 'cleansed'
  /** Evicted by another member of the same exclusivity group. */
  | 'replaced'
  /** The host died, leaked or was despawned while the effect was still up. */
  | 'host_removed';

export interface IceShatterSignal {
  enemyId?: EntityId;
  /** Tower / ability entity that landed the shattering hit. */
  sourceId?: EntityId;
  /** World position of the victim, in cell units (1.0 == 1 cell). */
  position: Vec2;
  /** Splash radius in cells taken from the row's `splash` effect; 0 if none. */
  splashRadius: number;
  /** Unit vector from attacker to victim for directional shards; zero if unknown. */
  direction: Vec2;
  /**
   * Damage the hit carries once every matching row and the per-enemy combo
   * multiplier have run, before armour and damage-taken multipliers.
   */
  damage: number;
  /** The row's full screen-impact budget (hitstop, flash, shake, tip). */
  impact: ImpactSpec;
}

export interface FrozenSignal {
  phase: 'begin' | 'end';
  enemyId: EntityId;
  position: Vec2;
  /** Body radius, so the ice shell can be sized to the unit. */
  radius: number;
  /**
   * Freeze length in seconds; 0 on `end`. A repeated `begin` for the same
   * enemy re-times the existing shell rather than spawning a second one.
   */
  duration: Seconds;
  endReason?: SignalEndReason;
}

export interface OverloadedTower {
  towerId: EntityId;
  defId: string;
  position: Vec2;
}

export interface OverloadSignal {
  phase: 'begin' | 'end';
  /** `radius` is the capacitor's 3x3; `global` is the §9 ultimate. */
  scope: 'radius' | 'global';
  /** Capacitor cell centre in world units; absent when `scope` is global. */
  origin?: Vec2;
  /** Chebyshev radius in cells; 0 when global. */
  radiusCells: number;
  /** Towers the surge actually reached — the ring only needs to visit these. */
  towers: OverloadedTower[];
  /** Overload window in seconds; 0 on `end`. */
  duration: Seconds;
  /** Overheat that follows the window; 0 when nobody pays it (ultimate, heat sink). */
  overheat: Seconds;
  endReason?: SignalEndReason;
}

/** Payload shape per signal, mixed into `CombatEventMap` under the same names. */
export interface CombatVfxSignalMap {
  ice_shatter: IceShatterSignal;
  frozen: FrozenSignal;
  overload: OverloadSignal;
}
