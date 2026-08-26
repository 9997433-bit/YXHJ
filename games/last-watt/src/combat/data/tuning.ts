/**
 * Every combat number that the GDD calls out explicitly, in one greppable
 * place. The tables in this folder reference these constants instead of
 * repeating literals, so a balance pass is a diff on this file.
 *
 * All values are the GDD §6–§9 first-draft numbers and are explicitly tunable.
 */

/** GDD §7.3.1 — a single hit of at least this much shatters a frozen target. */
export const SHATTER_DAMAGE_THRESHOLD = 40;
/** GDD §7.3.1 — shatter deals 250% damage. */
export const SHATTER_DAMAGE_MULTIPLIER = 2.5;
/** GDD §7.3.1 — "+1 cell splash". Fraction of the shatter damage. */
export const SHATTER_SPLASH_RADIUS = 1;
export const SHATTER_SPLASH_FACTOR = 1.0;
/** GDD §7.3.1 — 3 chill layers freeze the target. */
export const CHILL_STACKS_TO_FREEZE = 3;
export const FREEZE_DURATION = 2;
/** GDD §7.3.1 — post-freeze window where chill cannot be re-applied. */
export const CHILL_IMMUNITY_DURATION = 3;
/** GDD §15.2 — shatter is one of only three hitstop events in the game. */
export const SHATTER_HITSTOP_MS = 60;

/** GDD §7.3.2 — ignition damage over time; refreshes, never stacks. */
export const BURN_DPS = 8;
export const BURN_DURATION = 4;
/** GDD §7.3.2 — fire sweeping an oil cell leaves a fire field. */
export const FIRE_FIELD_DURATION = 5;
/** GDD §7.3.2 — fire on a frozen target thaws it and is halved. */
export const FIRE_VS_FROZEN_DAMAGE_MULTIPLIER = 0.5;

/** GDD §7.3.3 — a wet target adds jumps and removes chain falloff. */
export const CONDUCT_BONUS_JUMPS = 2;
export const CONDUCT_FALLOFF = 1.0;
/** Safety cap so stacked conduct procs cannot produce an unbounded chain. */
export const MAX_CHAIN_JUMPS = 8;

/** GDD §7.3.4 — capacitor overload. */
export const OVERLOAD_BATTERY_COST = 20;
export const OVERLOAD_ATTACK_SPEED_MUL = 2;
export const OVERLOAD_DURATION = 6;
export const OVERHEAT_DURATION = 3;
/** Chebyshev radius 1 == the capacitor's 3x3 footprint. */
export const OVERLOAD_RADIUS = 1;

/** GDD §9 — the master overload ultimate: free overload plus a global EMP. */
export const ULTIMATE_OVERLOAD_DURATION = 6;
export const ULTIMATE_EMP_STUN = 1.5;

/** GDD §5.1 — walking through a puddle tags the enemy wet for 6s. */
export const WET_DURATION = 6;
/** GDD §7.1 — the tar slick lasts 12s and slows by 30%. */
export const OIL_SLICK_DURATION = 12;
export const OIL_COATING_DURATION = 6;
export const TAR_SLOW_MULTIPLIER = 0.7;
export const TAR_SLOW_UPGRADED_MULTIPLIER = 0.6;

/** GDD §6.1 — selling refunds 70% of current value. */
export const SELL_REFUND_FRACTION = 0.7;
/** GDD §8.1 — the sapper crab shuts a tower down rather than destroying it. */
export const SAPPER_TOWER_DISABLE_SECONDS = 10;

/**
 * Recursion guard for reaction-spawned damage. Depth 0 is the original hit,
 * depth 1 is its splash; a splash of a splash never triggers reactions.
 */
export const MAX_REACTION_DEPTH = 1;
