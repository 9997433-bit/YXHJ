/**
 * Milestone scope switches.
 *
 * Some GDD rules are written for the finished game but must stay off in an
 * earlier milestone. Rather than deleting the code (and re-writing it later) or
 * leaving it on (and shipping a milestone that contradicts its own scope lock),
 * the rule stays implemented and this file decides whether it runs.
 *
 * There is exactly one switch so far, and it exists because M1 is a tutorial
 * slice: 丢区 (GDD §10). The substation thresholds still sit on the integrity
 * bar as warning marks, integrity still falls, and reaching 0 still loses the
 * run — but crossing 80 or 50 does not take a 变电区 away, so it does not cut
 * the supply cap, does not black out towers and does not open the sluice.
 * Round 2 主调度裁决 3: 「完整度只扣分不丢区」.
 *
 * Callers that need the other behaviour pass the flag explicitly:
 * `createGameSession({ map, zoneLoss: true })`. Once `data/` owns the milestone
 * gates (R3-F3), `CURRENT_MILESTONE` is the one line that moves.
 */

export type MilestoneId = 'M1' | 'M2';

export interface ScopeRules {
  /**
   * 丢区 (GDD §10): a substation zone drops out for good once core integrity
   * reaches its threshold, costing supply cap, powering down every tower inside
   * it and opening whatever sluice it was holding shut.
   */
  zoneLoss: boolean;
}

export const MILESTONE_SCOPE: Readonly<Record<MilestoneId, Readonly<ScopeRules>>> = {
  M1: { zoneLoss: false },
  M2: { zoneLoss: true },
};

/** The milestone the build is currently locked to. */
export const CURRENT_MILESTONE: MilestoneId = 'M1';

/** Defaults every gameplay entry point falls back to. */
export const SCOPE: Readonly<ScopeRules> = MILESTONE_SCOPE[CURRENT_MILESTONE];
