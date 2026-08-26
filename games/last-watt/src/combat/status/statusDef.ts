/**
 * Status definitions and the aggregation rules that turn a bag of statuses
 * into the numbers combat actually uses.
 *
 * GDD §7.2 legislates two exclusivity rules and this file is where they live:
 *   - coatings are unique (wet / oil evict each other, latest wins);
 *   - reaction states are unique (frozen / burning evict and cancel each other).
 * Both are expressed as data (`group`), not as branches.
 */

import type { EffectSpec } from '../reaction/spec';
import type {
  DamageType,
  Seconds,
  SourceTag,
  StatusGroup,
  StatusId,
  StatusKind,
  StatusVfxSignal,
} from '../types';

/** Everything a status can do to its host's numbers. All fields optional. */
export interface StatusModifiers {
  /** Multiplied together across all active statuses. */
  speedMul?: number;
  /** Hard stop, wins over any speedMul. */
  immobile?: boolean;
  /** Incoming damage multiplier, multiplied across statuses. */
  damageTakenMul?: number;
  /** Added to the enemy's flat armour (negative values shred it). */
  armorDelta?: number;
  /** Blocks the enemy's own behaviour (attacks, healing aura, self-destruct). */
  suppressBehaviour?: boolean;
}

/** Damage-over-time carried by a status (burning, Leviathan P3 self-damage). */
export interface StatusDot {
  dps: number;
  damageType: DamageType;
  tags: SourceTag[];
  ignoreArmor?: boolean;
}

export interface StatusDef {
  id: StatusId;
  displayName: string;
  kind: StatusKind;
  /** Mutual-exclusion bucket; applying a member evicts the incumbent. */
  group?: StatusGroup;
  maxStacks: number;
  defaultDuration: Seconds;
  /** What happens when the status is applied while already active. */
  refresh: 'refresh' | 'extend' | 'ignore';
  /**
   * What expiry does to a stacked status. `all` drops the whole thing;
   * `one_stack` peels one layer and restarts the timer, which is how chill
   * layers decay one at a time instead of vanishing together.
   */
  decay?: 'all' | 'one_stack';
  /**
   * How a per-application modifier override merges with the incumbent.
   * `strongest` keeps whichever value is worse for the host, so two slows of
   * different strengths take the stronger rather than stacking or overwriting.
   */
  modifierMerge?: 'replace' | 'strongest';
  /** While active, these statuses cannot be applied to the host. */
  blocks?: StatusId[];
  /** Applying this status removes these (cross-group cancellation). */
  clears?: StatusId[];
  modifiers?: StatusModifiers;
  /** Applied once per stack on top of `modifiers` (Leviathan armour plates). */
  perStackModifiers?: StatusModifiers;
  dot?: StatusDot;
  /**
   * Runs whenever the status leaves the host for any reason other than death:
   * natural expiry, consumption by a combo, or eviction. `frozen` uses this to
   * hand out the 3s chill immunity that makes perma-freeze impossible.
   */
  onEnd?: EffectSpec[];
  /**
   * Stable VFX signal published with a `begin` / `end` lifecycle whenever this
   * status arrives and leaves, so `src/vfx` can start and stop a looping
   * emitter without knowing the status id. See `../vfxSignals.ts`.
   */
  signal?: StatusVfxSignal;
  ui: {
    /** Status icon ring under the health bar (GDD §14.2). */
    icon: string;
    /** Palette entry from GDD §15.2. */
    color: string;
  };
  note?: string;
}

export interface StatusInstance {
  id: StatusId;
  stacks: number;
  /** Seconds left; `Infinity` for permanent marks such as `armor_broken`. */
  remaining: Seconds;
  /** Per-application override, e.g. tar's 30% vs. its 40% upgrade. */
  modifiers?: StatusModifiers;
  /**
   * Numbers the applier attached to this instance, read back by reaction rows
   * through `{ param, fallback }`. The condenser stores `freezeDuration` here
   * so its upgrade can lengthen the freeze without touching the combo row.
   */
  params?: Readonly<Record<string, number>>;
  /** Accumulator so DoTs deal fractional damage across frames. */
  dotCarry: number;
}

export type StatusRemovalReason = 'expired' | 'replaced' | 'consumed' | 'cleansed';

export interface AggregatedModifiers {
  speedMul: number;
  immobile: boolean;
  damageTakenMul: number;
  armorDelta: number;
  suppressBehaviour: boolean;
}

export const NEUTRAL_MODIFIERS: Readonly<AggregatedModifiers> = Object.freeze({
  speedMul: 1,
  immobile: false,
  damageTakenMul: 1,
  armorDelta: 0,
  suppressBehaviour: false,
});

/** Lookup table for status definitions; unknown ids fail loudly. */
export class StatusRegistry {
  private readonly defs = new Map<StatusId, StatusDef>();

  constructor(defs: readonly StatusDef[] = []) {
    for (const def of defs) this.register(def);
  }

  register(def: StatusDef): void {
    this.defs.set(def.id, def);
  }

  get(id: StatusId): StatusDef {
    const def = this.defs.get(id);
    if (!def) throw new Error(`[combat] unknown status id: ${id}`);
    return def;
  }

  tryGet(id: StatusId): StatusDef | undefined {
    return this.defs.get(id);
  }

  all(): StatusDef[] {
    return [...this.defs.values()];
  }
}
