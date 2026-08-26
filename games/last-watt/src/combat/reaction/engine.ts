/**
 * The reaction engine.
 *
 * Its entire job: for a given trigger, walk the matching rows in priority
 * order, run the ones whose conditions hold, and respect mutual exclusion.
 * There is no combo-specific code in this file and there must never be.
 */

import type { ReactionTrigger } from '../types';
import { evaluateCondition } from './conditions';
import type { ReactionContext } from './context';
import { executeEffect } from './effects';
import type { ReactionRow, ReactionTable } from './spec';

export class ReactionEngine {
  private byTrigger = new Map<ReactionTrigger, ReactionRow[]>();
  private rows: ReactionRow[] = [];

  constructor(table: ReactionTable) {
    this.setTable(table);
  }

  /** Replaces the table wholesale — the hook for data hot-reload. */
  setTable(table: ReactionTable): void {
    this.rows = table.filter((row) => row.enabled !== false);
    this.byTrigger = new Map();
    for (const row of this.rows) {
      const bucket = this.byTrigger.get(row.trigger);
      if (bucket) bucket.push(row);
      else this.byTrigger.set(row.trigger, [row]);
    }
    for (const bucket of this.byTrigger.values()) {
      bucket.sort((a, b) => b.priority - a.priority);
    }
  }

  allRows(): readonly ReactionRow[] {
    return this.rows;
  }

  /**
   * Runs every matching row against `ctx`, mutating it in place. Returns the
   * rows that fired so the caller can raise `reaction_triggered` events with
   * their presentation payloads.
   */
  resolve(ctx: ReactionContext): ReactionRow[] {
    const bucket = this.byTrigger.get(ctx.trigger);
    if (!bucket) return [];

    const fired: ReactionRow[] = [];
    for (const row of bucket) {
      if (row.maxDepth !== undefined && ctx.depth > row.maxDepth) continue;
      if (row.mutex && ctx.claimedMutex.has(row.mutex)) continue;
      if (!evaluateCondition(row.when, ctx)) continue;

      if (row.mutex) ctx.claimedMutex.add(row.mutex);
      for (const effect of row.effects) executeEffect(effect, ctx);

      // Per-enemy combo scaling (Leviathan takes x4 from shatter, GDD §8.2).
      // Lives here rather than in a row so every combo picks it up uniformly.
      if (row.combo && ctx.hit && ctx.target) {
        const multiplier = ctx.target.comboMultiplier(row.combo);
        if (multiplier !== 1) ctx.hit.amount *= multiplier;
      }

      ctx.matched.push(row.id);
      fired.push(row);
    }
    return fired;
  }
}
