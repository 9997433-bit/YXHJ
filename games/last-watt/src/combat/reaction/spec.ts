/**
 * The reaction DSL.
 *
 * GDD §7.2 legislates that every combo lives in one data table and that no
 * combo may be written as an if-else branch in the combat code. These specs
 * are that table's vocabulary: `ConditionSpec` is the left-hand side of a
 * `ReactionRow`, `EffectSpec` is the right-hand side. Both are plain data —
 * serialisable to JSON, hot-reloadable, and testable without a running game.
 *
 * Adding a combo means adding a row. Adding a *verb* means registering one
 * evaluator in `conditions.ts` / `effects.ts` — those two registries are the
 * only places where reaction behaviour is coded.
 */

import type {
  CellCoating,
  ComboId,
  DamageType,
  ImpactSpec,
  ReactionTrigger,
  SourceTag,
  StatusId,
} from '../types';

// ---------------------------------------------------------------------------
// Parameterised numbers
// ---------------------------------------------------------------------------

/**
 * A number in the table may be a literal, or pulled from the parameter bag the
 * trigger carries. That indirection is what lets a *tower upgrade* retune a
 * *combo* without the combo leaving the table: the condenser's "freeze 2.5s"
 * upgrade writes `freezeDuration: 2.5` into the chill it applies, and the
 * chill→freeze row reads `{ param: 'freezeDuration', fallback: 2 }`.
 */
export type NumberSource = number | { param: string; fallback: number };

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type ConditionSpec =
  | { kind: 'always' }
  | { kind: 'not'; of: ConditionSpec }
  | { kind: 'allOf'; of: ConditionSpec[] }
  | { kind: 'anyOf'; of: ConditionSpec[] }
  /** Target carries the status (optionally with at least `minStacks` layers). */
  | { kind: 'targetHasStatus'; status: StatusId; minStacks?: number }
  | { kind: 'targetLacksStatus'; status: StatusId }
  /** The attack carries this tag — the main way rows key off a damage source. */
  | { kind: 'sourceHasTag'; tag: SourceTag }
  | { kind: 'sourceLacksTag'; tag: SourceTag }
  | { kind: 'damageTypeIs'; damageType: DamageType }
  /** Single-hit damage threshold — this is the "≥40" in the shatter rule. */
  | { kind: 'damageAtLeast'; amount: number }
  | { kind: 'damageAtMost'; amount: number }
  | { kind: 'targetIsFlying'; value: boolean }
  /** Arbitrary marker declared on an EnemyDef (`boss`, `armored`, ...). */
  | { kind: 'targetHasFlag'; flag: string }
  /** Only meaningful for `on_status_changed` rows. */
  | { kind: 'changedStatusIs'; status: StatusId }
  /** Only meaningful for `on_cell_swept` / `on_cell_entered` rows. */
  | { kind: 'cellCoatingIs'; coating: CellCoating }
  /** Static terrain under the event's cell (puddles feed the conduct combo). */
  | { kind: 'cellTerrainIs'; terrain: CellTerrainQuery }
  /** Only meaningful for `on_activate` rows. */
  | { kind: 'activationIs'; activation: string }
  | { kind: 'batteryAtLeast'; amount: NumberSource };

export type CellTerrainQuery = 'road' | 'water' | 'bridge' | 'floodway' | 'powered';

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type StatusTargetRef = 'target' | 'source';

/** Status modifiers whose values may be parameterised by the trigger. */
export interface ModifierSourceSpec {
  speedMul?: NumberSource;
  damageTakenMul?: NumberSource;
  armorDelta?: NumberSource;
  immobile?: boolean;
  suppressBehaviour?: boolean;
}

export type EffectSpec =
  /** Rewrite the pending hit before it is applied. */
  | { kind: 'multiplyDamage'; factor: number }
  | { kind: 'addDamage'; amount: number }
  | { kind: 'ignoreArmor' }
  /**
   * Brand the hit so floaters / telemetry / VFX can attribute it to a combo.
   * `alsoTag` pushes a source tag onto the in-flight hit as well, which is how
   * a later row keys off an earlier one (the Leviathan's armour plate matches
   * `sourceHasTag: 'shatter'` rather than restating the shatter conditions).
   */
  | { kind: 'tagCombo'; combo: ComboId; alsoTag?: SourceTag }
  | {
      kind: 'applyStatus';
      status: StatusId;
      stacks?: number;
      /** Falls back to the StatusDef's `defaultDuration` when omitted. */
      duration?: NumberSource;
      to?: StatusTargetRef;
      /**
       * Per-application modifier override. Values may come from the trigger's
       * parameter bag, which is how an oil slick tells the slow it applies how
       * strong it is (30% base, 40% after the tar tower's viscous upgrade).
       */
      modifiers?: ModifierSourceSpec;
      /** Parameter bag handed to the new status instance. */
      params?: Readonly<Record<string, number>>;
    }
  | {
      kind: 'removeStatus';
      status: StatusId;
      to?: StatusTargetRef;
      reason?: 'consumed' | 'cleansed' | 'replaced';
    }
  /** Secondary damage to everything within `radius` cells of the victim. */
  | {
      kind: 'splash';
      radius: number;
      /** Fraction of the (post-modifier) primary damage. */
      factor: number;
      ignoreArmor?: boolean;
      damageType?: DamageType;
      tags?: SourceTag[];
      includePrimaryTarget?: boolean;
    }
  /** Tesla conduct: extra jumps and/or a falloff override for this arc. */
  | { kind: 'chainBonus'; extraJumps?: number; falloffOverride?: number }
  /** Paint grid cells; `onlyOver` restricts the paint to an existing coating. */
  | {
      kind: 'paintCell';
      coating: CellCoating;
      duration: NumberSource;
      radius?: number;
      onlyOver?: CellCoating;
    }
  | { kind: 'consumeBattery'; amount: NumberSource }
  /** Capacitor overload and the master-overload ultimate share this verb. */
  | {
      kind: 'overloadTowers';
      scope: 'radius' | 'global';
      /** Chebyshev radius in cells; 1 == the capacitor's 3x3 (GDD §7.3). */
      radius?: NumberSource;
      attackSpeedMul: number;
      duration: NumberSource;
      /** Post-overload shutdown; 0 means the ultimate's penalty-free version. */
      overheat: NumberSource;
      /** Only towers that draw power are affected (GDD §7.3 "耗电塔"). */
      poweredTowersOnly?: boolean;
    }
  | { kind: 'stunEnemies'; duration: NumberSource; scope: 'global' | 'radius'; radius?: number };

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface ReactionRow {
  id: string;
  /** Set on the four canonical combos; support rows leave it undefined. */
  combo?: ComboId;
  trigger: ReactionTrigger;
  /** Higher runs first. Anti-combo rows outrank the combos they veto. */
  priority: number;
  /**
   * Rows sharing a mutex key are mutually exclusive per event: the first match
   * wins and the rest are skipped. Used so "fire thaws a frozen target" and
   * "shatter" cannot both consume the same `frozen`.
   */
  mutex?: string;
  when: ConditionSpec;
  effects: EffectSpec[];
  impact?: ImpactSpec;
  /**
   * Guards recursion: a splash spawned by a reaction runs at depth 1, its own
   * splash at depth 2. Rows above their `maxDepth` do not fire.
   */
  maxDepth?: number;
  enabled?: boolean;
  /** Free-text provenance, e.g. "GDD §7.3.1". Never read by code. */
  note?: string;
}

export type ReactionTable = readonly ReactionRow[];
