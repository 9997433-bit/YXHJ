/**
 * Condition evaluators — the left-hand side of the reaction table.
 *
 * One entry per `ConditionSpec.kind`, and nothing else in the combat module is
 * allowed to ask "is this target frozen?" in order to decide a combo. If a row
 * needs a question that is not here, add the verb here, not a branch elsewhere.
 */

import { toCell } from '../types';
import type { ReactionContext } from './context';
import { resolveNumber } from './effects';
import type { ConditionSpec } from './spec';

type Handler<K extends ConditionSpec['kind']> = (
  spec: Extract<ConditionSpec, { kind: K }>,
  ctx: ReactionContext,
) => boolean;

type ConditionHandlers = { [K in ConditionSpec['kind']]: Handler<K> };

function damageOf(ctx: ReactionContext, of: 'current' | 'base' | undefined): number {
  if (!ctx.hit) return 0;
  return of === 'base' ? ctx.hit.baseAmount : ctx.hit.amount;
}

const handlers: ConditionHandlers = {
  always: () => true,

  not: (spec, ctx) => !evaluateCondition(spec.of, ctx),

  allOf: (spec, ctx) => spec.of.every((child) => evaluateCondition(child, ctx)),

  anyOf: (spec, ctx) => spec.of.some((child) => evaluateCondition(child, ctx)),

  targetHasStatus: (spec, ctx) => {
    const target = ctx.target;
    if (!target) return false;
    if (!target.statuses.has(spec.status)) return false;
    return spec.minStacks === undefined || target.statuses.stacks(spec.status) >= spec.minStacks;
  },

  targetLacksStatus: (spec, ctx) => !ctx.target?.statuses.has(spec.status),

  sourceHasTag: (spec, ctx) => ctx.sourceTags.includes(spec.tag),

  sourceLacksTag: (spec, ctx) => !ctx.sourceTags.includes(spec.tag),

  damageTypeIs: (spec, ctx) => ctx.hit?.damageType === spec.damageType,

  damageAtLeast: (spec, ctx) => damageOf(ctx, spec.of) >= spec.amount,

  damageAtMost: (spec, ctx) => damageOf(ctx, spec.of) <= spec.amount,

  targetIsFlying: (spec, ctx) => (ctx.target?.def.isFlying ?? false) === spec.value,

  targetHasFlag: (spec, ctx) => ctx.target?.hasFlag(spec.flag) ?? false,

  changedStatusIs: (spec, ctx) => ctx.changedStatus === spec.status,

  cellCoatingIs: (spec, ctx) => ctx.cellCoating === spec.coating,

  cellTerrainIs: (spec, ctx) => {
    const cell = ctx.cell ?? (ctx.target ? toCell(ctx.target.position) : undefined);
    if (!cell) return false;
    const terrain = ctx.runtime.terrain;
    switch (spec.terrain) {
      case 'road':
        return terrain.isRoad(cell.cx, cell.cy);
      case 'water':
        return terrain.isWater(cell.cx, cell.cy);
      case 'bridge':
        return terrain.isBridge(cell.cx, cell.cy);
      case 'floodway':
        return terrain.isFloodway(cell.cx, cell.cy);
      case 'powered':
        return terrain.isPowered(cell.cx, cell.cy);
    }
  },

  activationIs: (spec, ctx) => ctx.activation === spec.activation,

  batteryAtLeast: (spec, ctx) => ctx.runtime.battery >= resolveNumber(spec.amount, ctx),
};

export function evaluateCondition(spec: ConditionSpec, ctx: ReactionContext): boolean {
  const handler = handlers[spec.kind] as Handler<ConditionSpec['kind']>;
  if (!handler) throw new Error(`[combat] unknown reaction condition: ${(spec as { kind: string }).kind}`);
  return handler(spec, ctx);
}
