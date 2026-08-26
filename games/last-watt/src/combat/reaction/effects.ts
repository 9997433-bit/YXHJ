/**
 * Effect executors — the right-hand side of the reaction table.
 *
 * Each verb is a few lines that either rewrites the in-flight hit or asks the
 * `ReactionRuntime` to change the world. The four combos of GDD §7.3 are
 * assembled entirely out of these verbs.
 */

import type { StatusModifiers } from '../status/statusDef';
import { toCell, type Seconds } from '../types';
import type { ReactionContext } from './context';
import type { EffectSpec, ModifierSourceSpec, NumberSource } from './spec';

/** Resolves a literal or a `{ param, fallback }` lookup against the trigger. */
export function resolveNumber(source: NumberSource, ctx: ReactionContext): number {
  if (typeof source === 'number') return source;
  const value = ctx.params[source.param];
  return value === undefined || Number.isNaN(value) ? source.fallback : value;
}

function resolveDuration(source: NumberSource | undefined, ctx: ReactionContext, fallback: Seconds): Seconds {
  return source === undefined ? fallback : resolveNumber(source, ctx);
}

function resolveModifiers(spec: ModifierSourceSpec, ctx: ReactionContext): StatusModifiers {
  const mods: StatusModifiers = {};
  if (spec.speedMul !== undefined) mods.speedMul = resolveNumber(spec.speedMul, ctx);
  if (spec.damageTakenMul !== undefined) mods.damageTakenMul = resolveNumber(spec.damageTakenMul, ctx);
  if (spec.armorDelta !== undefined) mods.armorDelta = resolveNumber(spec.armorDelta, ctx);
  if (spec.immobile !== undefined) mods.immobile = spec.immobile;
  if (spec.suppressBehaviour !== undefined) mods.suppressBehaviour = spec.suppressBehaviour;
  return mods;
}

type Handler<K extends EffectSpec['kind']> = (
  spec: Extract<EffectSpec, { kind: K }>,
  ctx: ReactionContext,
) => void;

type EffectHandlers = { [K in EffectSpec['kind']]: Handler<K> };

const handlers: EffectHandlers = {
  multiplyDamage: (spec, ctx) => {
    if (ctx.hit) ctx.hit.amount *= spec.factor;
  },

  addDamage: (spec, ctx) => {
    if (ctx.hit) ctx.hit.amount += spec.amount;
  },

  ignoreArmor: (_spec, ctx) => {
    if (ctx.hit) ctx.hit.ignoreArmor = true;
  },

  tagCombo: (spec, ctx) => {
    if (!ctx.hit) return;
    ctx.hit.combo = spec.combo;
    if (spec.alsoTag && !ctx.hit.tags.includes(spec.alsoTag)) ctx.hit.tags.push(spec.alsoTag);
  },

  applyStatus: (spec, ctx) => {
    const enemy = spec.to === 'source' ? undefined : ctx.target;
    if (!enemy) return;
    const request: Parameters<ReactionContext['runtime']['applyStatus']>[2] = {};
    if (spec.stacks !== undefined) request.stacks = spec.stacks;
    if (spec.duration !== undefined) request.duration = resolveNumber(spec.duration, ctx);
    if (spec.params) request.params = spec.params;
    if (spec.modifiers) request.modifiers = resolveModifiers(spec.modifiers, ctx);
    ctx.runtime.applyStatus(enemy, spec.status, request, ctx.source);
  },

  removeStatus: (spec, ctx) => {
    const enemy = spec.to === 'source' ? undefined : ctx.target;
    if (!enemy) return;
    ctx.runtime.removeStatus(enemy, spec.status, spec.reason ?? 'consumed');
  },

  splash: (spec, ctx) => {
    const hit = ctx.hit;
    if (!hit) return;
    const request: (typeof ctx.pendingSplash)[number] = {
      origin: { x: hit.position.x, y: hit.position.y },
      radius: spec.radius,
      amount: hit.amount * spec.factor,
      damageType: spec.damageType ?? hit.damageType,
      tags: spec.tags ? [...spec.tags] : [...hit.tags, 'splash'],
      ignoreArmor: spec.ignoreArmor ?? hit.ignoreArmor,
      source: ctx.source,
      depth: ctx.depth + 1,
    };
    if (hit.combo) request.combo = hit.combo;
    if (!spec.includePrimaryTarget && ctx.target) request.excludeEnemyId = ctx.target.id;
    ctx.pendingSplash.push(request);
  },

  chainBonus: (spec, ctx) => {
    if (!ctx.hit) return;
    const bonus = ctx.hit.chainBonus ?? { extraJumps: 0 };
    bonus.extraJumps += spec.extraJumps ?? 0;
    if (spec.falloffOverride !== undefined) bonus.falloffOverride = spec.falloffOverride;
    ctx.hit.chainBonus = bonus;
  },

  paintCell: (spec, ctx) => {
    const origin = ctx.cell ?? (ctx.target ? toCell(ctx.target.position) : undefined);
    if (!origin) return;
    ctx.runtime.paintCells(
      origin,
      spec.radius ?? 0,
      spec.coating,
      resolveNumber(spec.duration, ctx),
      spec.onlyOver,
    );
  },

  consumeBattery: (spec, ctx) => {
    ctx.runtime.consumeBattery(resolveNumber(spec.amount, ctx));
  },

  overloadTowers: (spec, ctx) => {
    const options: Parameters<ReactionContext['runtime']['overloadTowers']>[0] = {
      scope: spec.scope,
      radius: resolveDuration(spec.radius, ctx, 1),
      attackSpeedMul: spec.attackSpeedMul,
      duration: resolveNumber(spec.duration, ctx),
      overheat: resolveNumber(spec.overheat, ctx),
      poweredTowersOnly: spec.poweredTowersOnly ?? true,
    };
    if (ctx.cell) options.origin = ctx.cell;
    ctx.runtime.overloadTowers(options);
  },

  stunEnemies: (spec, ctx) => {
    const options: Parameters<ReactionContext['runtime']['stunEnemies']>[0] = {
      scope: spec.scope,
      radius: spec.radius ?? 0,
      duration: resolveNumber(spec.duration, ctx),
    };
    if (ctx.target) options.origin = ctx.target.position;
    ctx.runtime.stunEnemies(options);
  },
};

export function executeEffect(spec: EffectSpec, ctx: ReactionContext): void {
  const handler = handlers[spec.kind] as Handler<EffectSpec['kind']>;
  if (!handler) throw new Error(`[combat] unknown reaction effect: ${(spec as { kind: string }).kind}`);
  handler(spec, ctx);
}
