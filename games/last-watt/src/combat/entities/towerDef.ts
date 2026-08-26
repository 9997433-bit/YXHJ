/**
 * Tower definitions and the upgrade patch format (GDD §7.1).
 *
 * Attacks are a small tagged union rather than one god-struct, because the
 * seven v1 towers only need five delivery shapes and each shape wants
 * different numbers. Reaction rows never look at `AttackDef.kind` — they match
 * on `tags`, so a future tower with the `fire` tag gets the oil-fire combo for
 * free.
 */

import type { StatusModifiers } from '../status/statusDef';
import type {
  CellCoating,
  DamageType,
  Seconds,
  SourceTag,
  StatusId,
  TargetStrategy,
} from '../types';

export interface StatusApplication {
  status: StatusId;
  stacks?: number;
  duration?: Seconds;
  modifiers?: StatusModifiers;
  /** Numbers carried into the status instance for reaction rows to read. */
  params?: Readonly<Record<string, number>>;
}

interface AttackBase {
  /** Seconds between attacks, before overload / upgrade multipliers. */
  interval: Seconds;
  /** Range in cells. */
  range: number;
  targetsAir: boolean;
  damageType: DamageType;
  tags: SourceTag[];
}

/** Rivet machine gun: a travelling bullet, the only ballistic attack in v1. */
export interface ProjectileAttack extends AttackBase {
  kind: 'projectile';
  damage: number;
  /** Cells per second. */
  projectileSpeed: number;
  splashRadius?: number;
  ignoreArmor?: boolean;
}

/** Hydraulic hammer: instant, short range, single heavy hit — the shatter key. */
export interface MeleeAttack extends AttackBase {
  kind: 'melee';
  damage: number;
  splashRadius?: number;
  ignoreArmor?: boolean;
}

/** Condenser spray and flamethrower: a cone re-evaluated every tick. */
export interface ConeAttack extends AttackBase {
  kind: 'cone';
  /** Half-angle in degrees; the full cone is twice this. */
  halfAngleDeg: number;
  /** Sustained damage; per-tick damage is `damagePerSecond * interval`. */
  damagePerSecond: number;
  applyStatuses?: readonly StatusApplication[];
  /**
   * Cells the cone covers are reported to the `on_cell_swept` trigger, which
   * is how the flamethrower turns a slick into a fire field.
   */
  sweepsCells?: boolean;
  /** Numbers published to the reaction table by this attack's triggers. */
  params?: Readonly<Record<string, number>>;
}

/** Tesla coil: chain lightning, the conduct combo's delivery system. */
export interface ChainAttack extends AttackBase {
  kind: 'chain';
  damage: number;
  /** Number of targets hit including the first. */
  jumps: number;
  /** Damage retained per jump (0.7 == the GDD's -30%). */
  falloff: number;
  /** Max distance between consecutive chain targets, in cells. */
  jumpRange: number;
}

/** Tar sprayer: paints the ground instead of hitting units. */
export interface PaintAttack extends AttackBase {
  kind: 'paint';
  coating: CellCoating;
  coatingDuration: Seconds;
  /** Radius in cells around the tower. */
  paintRadius: number;
  /** Coatings only stick to road cells (GDD §5.1). */
  roadOnly: boolean;
  /** Numbers stamped onto the painted cells for the reaction table to read. */
  params?: Readonly<Record<string, number>>;
}

/** Capacitor station and generator: no attack at all. */
export interface NoAttack {
  kind: 'none';
}

export type AttackDef =
  | ProjectileAttack
  | MeleeAttack
  | ConeAttack
  | ChainAttack
  | PaintAttack
  | NoAttack;

/** Passive contributions to the power economy (GDD §6.2). */
export interface BuildingEffects {
  powerCapBonus?: number;
  /** Bonus when adjacent to a geothermal fissure on map 3 (GDD §5.2). */
  powerCapBonusOnFissure?: number;
  batteryCapBonus?: number;
  batteryChargeMul?: number;
}

/** Player-triggered ability attached to a building (capacitor overload). */
export interface ActivationDef {
  /** Matched by `activationIs` in the reaction table. */
  id: string;
  batteryCost: number;
  cooldown: Seconds;
  /** Numbers handed to the `on_activate` rows via `{ param, fallback }`. */
  params: Readonly<Record<string, number>>;
}

export interface TowerDef {
  id: string;
  displayName: string;
  cost: number;
  /** Permanent draw on the supply cap (GDD §6.2). */
  powerCost: number;
  category: 'tower' | 'building';
  attack: AttackDef;
  defaultStrategy: TargetStrategy;
  /** Ids into the upgrade table; v1 gives every tower exactly two or none. */
  upgrades: readonly string[];
  building?: BuildingEffects;
  activation?: ActivationDef;
  /** Tesla's "no overheat after overload" upgrade sets this. */
  overheatImmune?: boolean;
  ui: {
    icon: string;
    mesh: string;
    /** Wave the blueprint unlocks on in map 1 (GDD §11). */
    unlockWave?: number;
  };
  note?: string;
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export interface StatusApplicationPatch {
  status: StatusId;
  stacks?: number;
  duration?: Seconds;
  modifiers?: StatusModifiers;
  params?: Readonly<Record<string, number>>;
}

/**
 * The v1 upgrade vocabulary. Every one of the 14 upgrades in GDD §7.1 is
 * expressible here, so upgrades stay data and the runtime keeps one code path.
 */
export interface UpgradePatch {
  damageMul?: number;
  damageAdd?: number;
  intervalMul?: number;
  rangeAdd?: number;
  ignoreArmor?: boolean;
  splashRadiusAdd?: number;
  chainJumpsAdd?: number;
  chainFalloffOverride?: number;
  coneHalfAngleAdd?: number;
  addTags?: readonly SourceTag[];
  statusOverrides?: readonly StatusApplicationPatch[];
  coatingDurationAdd?: number;
  paintRadiusAdd?: number;
  /** Retunes the params this attack publishes to the reaction table. */
  paramOverrides?: Readonly<Record<string, number>>;
  /** Retunes the params an activation hands to the reaction table. */
  activationParamOverrides?: Readonly<Record<string, number>>;
  overheatImmune?: boolean;
}

export interface UpgradeDef {
  id: string;
  towerId: string;
  displayName: string;
  cost: number;
  description: string;
  patch: UpgradePatch;
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

function patchStatuses(
  base: readonly StatusApplication[] | undefined,
  overrides: readonly StatusApplicationPatch[] | undefined,
): readonly StatusApplication[] | undefined {
  if (!base || !overrides) return base;
  return base.map((application) => {
    const override = overrides.find((o) => o.status === application.status);
    if (!override) return application;
    return {
      ...application,
      ...(override.stacks !== undefined ? { stacks: override.stacks } : {}),
      ...(override.duration !== undefined ? { duration: override.duration } : {}),
      ...(override.modifiers ? { modifiers: { ...application.modifiers, ...override.modifiers } } : {}),
      ...(override.params ? { params: { ...application.params, ...override.params } } : {}),
    };
  });
}

function patchAttack(attack: AttackDef, patch: UpgradePatch): AttackDef {
  if (attack.kind === 'none') return attack;

  const common = {
    interval: attack.interval * (patch.intervalMul ?? 1),
    range: attack.range + (patch.rangeAdd ?? 0),
    tags: patch.addTags ? [...attack.tags, ...patch.addTags] : attack.tags,
  };

  switch (attack.kind) {
    case 'projectile':
    case 'melee': {
      const damage = attack.damage * (patch.damageMul ?? 1) + (patch.damageAdd ?? 0);
      const splash = (attack.splashRadius ?? 0) + (patch.splashRadiusAdd ?? 0);
      return {
        ...attack,
        ...common,
        damage,
        ...(splash > 0 ? { splashRadius: splash } : {}),
        ...(patch.ignoreArmor !== undefined ? { ignoreArmor: patch.ignoreArmor } : {}),
      };
    }
    case 'cone':
      return {
        ...attack,
        ...common,
        damagePerSecond: attack.damagePerSecond * (patch.damageMul ?? 1) + (patch.damageAdd ?? 0),
        halfAngleDeg: attack.halfAngleDeg + (patch.coneHalfAngleAdd ?? 0),
        ...(attack.applyStatuses
          ? { applyStatuses: patchStatuses(attack.applyStatuses, patch.statusOverrides) }
          : {}),
        ...(patch.paramOverrides ? { params: { ...attack.params, ...patch.paramOverrides } } : {}),
      };
    case 'chain':
      return {
        ...attack,
        ...common,
        damage: attack.damage * (patch.damageMul ?? 1) + (patch.damageAdd ?? 0),
        jumps: attack.jumps + (patch.chainJumpsAdd ?? 0),
        falloff: patch.chainFalloffOverride ?? attack.falloff,
      };
    case 'paint':
      return {
        ...attack,
        ...common,
        coatingDuration: attack.coatingDuration + (patch.coatingDurationAdd ?? 0),
        paintRadius: attack.paintRadius + (patch.paintRadiusAdd ?? 0) + (patch.rangeAdd ?? 0),
        ...(patch.paramOverrides ? { params: { ...attack.params, ...patch.paramOverrides } } : {}),
      };
  }
}

/** Returns a new TowerDef with the upgrade applied; the base def is untouched. */
export function patchTowerDef(def: TowerDef, patch: UpgradePatch): TowerDef {
  return {
    ...def,
    attack: patchAttack(def.attack, patch),
    ...(patch.overheatImmune !== undefined ? { overheatImmune: patch.overheatImmune } : {}),
    ...(def.activation && patch.activationParamOverrides
      ? {
          activation: {
            ...def.activation,
            params: { ...def.activation.params, ...patch.activationParamOverrides },
          },
        }
      : {}),
  };
}
