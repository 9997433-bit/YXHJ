/**
 * The movement driver combat actually gets once gameplay is wired in.
 *
 * `FlowFieldMovement` alone cannot serve the whole roster: GDD §5.1 says flying
 * enemies go straight at the core and ignore everything, and GDD §8.3 scales
 * enemy speed per map. Combat has one `MovementDriver` port and no per-enemy
 * speed multiplier, so both live here — the router looks the unit up in the
 * route table the spawn side filled in, and falls back to ground movement for
 * anything it has never seen (brood spawned inside combat, e.g. the Leviathan's
 * sappers).
 *
 * Satisfies `combat.MovementDriver` structurally, like everything in this
 * folder.
 */

import type { Vec2 } from '../types';
import type { FlowField } from '../pathing/flowField';
import type { FlowFieldMovable } from './terrainQuery';
import { FlowFieldMovement } from './terrainQuery';

/** `combat.Enemy` as seen by the router. */
export interface RoutedMovable extends FlowFieldMovable {
  path: Vec2[];
  pathIndex: number;
}

export interface EnemyRoute {
  /** Straight-line flight along `path`, ignoring the flow field (GDD §5.1). */
  air: boolean;
  /** Per-map speed column (GDD §8.3), already resolved by the wave plan. */
  speedMultiplier: number;
}

export const GROUND_ROUTE: EnemyRoute = { air: false, speedMultiplier: 1 };

export class RoutedMovement {
  private readonly ground: FlowFieldMovement;

  constructor(
    getField: () => FlowField,
    private readonly routeOf: (enemy: RoutedMovable) => EnemyRoute | undefined,
  ) {
    this.ground = new FlowFieldMovement(getField);
  }

  advance(enemy: RoutedMovable, dt: number, speed: number): void {
    if (speed <= 0) return;
    const route = this.routeOf(enemy) ?? GROUND_ROUTE;
    const scaled = speed * route.speedMultiplier;
    if (route.air && enemy.path.length > 0) this.flyPolyline(enemy, dt, scaled);
    else this.ground.advance(enemy, dt, scaled);
  }

  /** Same walk as `combat.PolylineMovement`, kept local to avoid the import. */
  private flyPolyline(enemy: RoutedMovable, dt: number, speed: number): void {
    let budget = speed * dt;

    while (budget > 0 && enemy.pathIndex < enemy.path.length) {
      const node = enemy.path[enemy.pathIndex] as Vec2;
      const dx = node.x - enemy.position.x;
      const dy = node.y - enemy.position.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= 1e-6) {
        enemy.pathIndex += 1;
        continue;
      }
      const step = Math.min(budget, distance);
      enemy.position.x += (dx / distance) * step;
      enemy.position.y += (dy / distance) * step;
      enemy.facing.x = dx / distance;
      enemy.facing.y = dy / distance;
      enemy.pathProgress += step;
      budget -= step;
      if (step >= distance - 1e-6) enemy.pathIndex += 1;
    }

    if (enemy.pathIndex >= enemy.path.length) enemy.reachedGoal = true;
  }
}
