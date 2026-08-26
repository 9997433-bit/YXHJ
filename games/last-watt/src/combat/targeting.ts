/**
 * Target acquisition (GDD §14.1: every tower exposes first / strongest / air).
 */

import type { Enemy } from './entities/enemy';
import type { Tower } from './entities/tower';
import type { AttackDef } from './entities/towerDef';
import { distance, type StatusId, type TargetStrategy, type Vec2 } from './types';

export function attackRangeOf(attack: AttackDef): number {
  return attack.kind === 'none' ? 0 : attack.range;
}

export function canAttackTarget(attack: AttackDef, enemy: Enemy): boolean {
  if (attack.kind === 'none') return false;
  return enemy.isAirborne ? attack.targetsAir : true;
}

export function inRange(origin: Vec2, enemy: Enemy, range: number): boolean {
  return distance(origin, enemy.position) <= range + enemy.radius;
}

/**
 * How far a candidate jumps the queue before the strategy's own score decides.
 * Two tiers, most significant first: the player-chosen `air` strategy always
 * outranks the def-level status preference, so arming a tower against flyers
 * still does what it says.
 */
function preferenceTier(
  enemy: Enemy,
  strategy: TargetStrategy,
  priorityStatuses: readonly StatusId[] | undefined,
): number {
  let tier = 0;
  if (strategy === 'air' && enemy.isAirborne) tier += 2;
  if (priorityStatuses?.some((status) => enemy.statuses.has(status))) tier += 1;
  return tier;
}

/**
 * Picks a tower's target. "first" means furthest along the path (closest to
 * the core), which is what the player means by 首位.
 *
 * An attack may also declare `priorityStatuses`; a target carrying one of them
 * outranks the rest of the field, and the strategy orders what is left. That is
 * how the breaker spends its 2.5s swing on a target that is only frozen for 2s.
 */
export function acquireTarget(
  tower: Tower,
  enemies: Iterable<Enemy>,
  strategy: TargetStrategy = tower.targetStrategy,
): Enemy | undefined {
  const attack = tower.def.attack;
  const range = attackRangeOf(attack);
  if (range <= 0) return undefined;
  const priorityStatuses = attack.kind === 'none' ? undefined : attack.priorityStatuses;

  let best: Enemy | undefined;
  let bestTier = -1;
  let bestScore = -Infinity;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (!canAttackTarget(attack, enemy)) continue;
    if (!inRange(tower.position, enemy, range)) continue;

    const tier = preferenceTier(enemy, strategy, priorityStatuses);
    if (tier < bestTier) continue;
    const score = strategy === 'strongest' ? enemy.hp : enemy.pathProgress;
    if (tier > bestTier || score > bestScore) {
      best = enemy;
      bestTier = tier;
      bestScore = score;
    }
  }
  return best;
}

/** Everything alive within `radius` cells of a point, optionally excluding one. */
export function enemiesInRadius(
  enemies: Iterable<Enemy>,
  origin: Vec2,
  radius: number,
  excludeId?: number,
): Enemy[] {
  const found: Enemy[] = [];
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.id === excludeId) continue;
    if (distance(origin, enemy.position) <= radius + enemy.radius) found.push(enemy);
  }
  return found;
}

/**
 * Cone hit test: within range and within the half-angle of `facing`.
 * `facing` must be normalised.
 */
export function enemiesInCone(
  enemies: Iterable<Enemy>,
  origin: Vec2,
  facing: Vec2,
  range: number,
  halfAngleDeg: number,
  includeAir: boolean,
): Enemy[] {
  const cosLimit = Math.cos((halfAngleDeg * Math.PI) / 180);
  const found: Enemy[] = [];
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (!includeAir && enemy.isAirborne) continue;
    const dx = enemy.position.x - origin.x;
    const dy = enemy.position.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range + enemy.radius) continue;
    if (dist < 1e-6) {
      found.push(enemy);
      continue;
    }
    const cos = (dx * facing.x + dy * facing.y) / dist;
    // Widen the cone by the target's radius so big units are not missed.
    if (cos >= cosLimit - enemy.radius / Math.max(dist, 0.5)) found.push(enemy);
  }
  return found;
}

/** Nearest enemy to `origin`, used for chain jumps. */
export function nearestEnemy(
  enemies: Iterable<Enemy>,
  origin: Vec2,
  maxDistance: number,
  exclude: ReadonlySet<number>,
  includeAir: boolean,
): Enemy | undefined {
  let best: Enemy | undefined;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    if (!enemy.alive || exclude.has(enemy.id)) continue;
    if (!includeAir && enemy.isAirborne) continue;
    const dist = distance(origin, enemy.position);
    if (dist <= maxDistance + enemy.radius && dist < bestDist) {
      best = enemy;
      bestDist = dist;
    }
  }
  return best;
}
