/**
 * Core value types for the combat module.
 *
 * Everything here is engine-agnostic: no Three.js, no DOM, no imports from
 * sibling `src/` subtrees. The combat module talks to the rest of the game
 * through `ports.ts` (inbound queries) and `events.ts` (outbound signals).
 *
 * Grid convention matches GDD §5.1: 20x12 cells, integer cell coordinates,
 * float world positions in the same unit (1.0 == 1 cell).
 */

export type Seconds = number;
export type Milliseconds = number;
export type EntityId = number;

export interface Vec2 {
  x: number;
  y: number;
}

/** Integer cell coordinate. */
export interface CellCoord {
  cx: number;
  cy: number;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * `true` damage bypasses armour *and* every damage-taken multiplier. It exists
 * for self-inflicted and scripted damage (the Leviathan's P3 burn) that must
 * land as a flat number regardless of the target's state.
 */
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'true';

/**
 * Tags carried by an attack. Reaction rows match on these instead of on
 * concrete tower ids, so new towers inherit combos for free (GDD §7.2).
 */
export type SourceTag =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'physical'
  | 'explosive'
  | 'melee'
  | 'ranged'
  | 'splash'
  | 'dot'
  | 'chain'
  | 'overload'
  | 'ability'
  | 'environment'
  | 'shatter';

export type AttackerKind = 'tower' | 'enemy' | 'ability' | 'environment';

// ---------------------------------------------------------------------------
// Statuses (GDD §7.2)
// ---------------------------------------------------------------------------

export type StatusId =
  /** Coating: applied by condenser spray or by walking through a puddle. */
  | 'wet'
  /** Coating: applied by the tar sprayer, both on cells and on enemies. */
  | 'oil'
  /** Stacking chill layers; 3 layers convert into `frozen`. */
  | 'chilled'
  /** Reaction state: immobile, shatter-primed. */
  | 'frozen'
  /** Reaction state: damage over time. */
  | 'burning'
  /** Movement debuff from tar / cold. */
  | 'slowed'
  /** EMP stun from the master-overload ability. */
  | 'stunned'
  /** Post-freeze grace window that blocks `chilled` (anti perma-freeze). */
  | 'chill_immune'
  /** Leviathan P1 armour plate knocked off by a shatter. */
  | 'armor_broken';

/** Mutual-exclusion buckets. Applying a member evicts the incumbent. */
export type StatusGroup = 'coating' | 'reaction_state';

export type StatusKind = 'coating' | 'reaction_state' | 'modifier';

/** Cell-level coating (GDD §17.1 `Cell.coating`). */
export type CellCoating = 'none' | 'oil' | 'fire';

// ---------------------------------------------------------------------------
// Combos (GDD §7.3)
// ---------------------------------------------------------------------------

export type ComboId = 'shatter' | 'oil_fire' | 'conduct' | 'overload';

/** Where a reaction row hooks into the combat pipeline. */
export type ReactionTrigger =
  /** A hit has been rolled but not yet applied; rows may rewrite the damage. */
  | 'on_hit'
  /** A status just changed stack count on an enemy. */
  | 'on_status_changed'
  /** A cone/aoe attack swept over a grid cell. */
  | 'on_cell_swept'
  /** An enemy entered a new grid cell. */
  | 'on_cell_entered'
  /** A player ability or building activation fired. */
  | 'on_activate';

export type TargetStrategy = 'first' | 'strongest' | 'air';

// ---------------------------------------------------------------------------
// Presentation contract (consumed by src/vfx + src/ui, never by combat itself)
// ---------------------------------------------------------------------------

/**
 * The fixed set of names `src/vfx` binds to. Payloads and the rules about who
 * may declare each one live in `vfxSignals.ts`.
 */
export type CombatVfxSignal = 'ice_shatter' | 'frozen' | 'overload';

/** The subset a reaction row may declare: one-shot bursts at a position. */
export type ReactionVfxSignal = Extract<CombatVfxSignal, 'ice_shatter'>;

/** The subset a status may declare: per-enemy effects with a begin and an end. */
export type StatusVfxSignal = Extract<CombatVfxSignal, 'frozen'>;

/**
 * Screen-impact budget carried on reaction rows. The VFX layer owns the
 * throttling rules from GDD §15.2 ("at most one hitstop per 100ms"); combat
 * only declares intent.
 */
export interface ImpactSpec {
  /**
   * Stable VFX signal this row publishes on top of `reaction_triggered`, so
   * `src/vfx` can bind to a fixed name instead of to a reaction row id. See
   * `vfxSignals.ts`.
   */
  signal?: ReactionVfxSignal;
  /** VFX Graph / particle effect id, see GDD §15.2 particle language table. */
  vfx?: string;
  /** Audio event id, see GDD §16.2. */
  sfx?: string;
  /** Requested hitstop in milliseconds. */
  hitstop?: Milliseconds;
  /** Full-screen or on-target flash colour, hex string from the §15.2 palette. */
  flash?: string;
  /** Controller / screen shake bucket. */
  shake?: 'none' | 'light' | 'medium';
  /** One-shot tutorial tip id (GDD §14.2 combo tip bar). */
  tip?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Direction from `from` to `to`, normalised; zero when the two coincide. */
export function unitVector(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
}

export function toCell(p: Vec2): CellCoord {
  return { cx: Math.floor(p.x), cy: Math.floor(p.y) };
}

export function cellCenter(cx: number, cy: number): Vec2 {
  return { x: cx + 0.5, y: cy + 0.5 };
}

export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
