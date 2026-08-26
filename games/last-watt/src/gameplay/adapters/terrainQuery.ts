/**
 * Adapter for combat's inbound ports (`src/combat/ports.ts`).
 *
 * Structural, not nominal: nothing is imported across the subtree boundary, the
 * shapes simply match. `GameplayWorld` hands these to the combat system, and
 * combat's own headless stubs keep working unchanged.
 */

import type { CellCoord, Vec2 } from '../types';
import type { Grid } from '../grid/Grid';
import type { FlowField } from '../pathing/flowField';
import { directionAt, isReachable, tracePolyline } from '../pathing/flowField';

/** Satisfies `combat.TerrainQuery`. */
export class GridTerrainQuery {
  readonly width: number;
  readonly height: number;

  constructor(private readonly grid: Grid) {
    this.width = grid.cols;
    this.height = grid.rows;
  }

  isInside(cx: number, cy: number): boolean {
    return this.grid.isInside(cx, cy);
  }

  isRoad(cx: number, cy: number): boolean {
    return this.grid.isRoad(cx, cy);
  }

  isBuildable(cx: number, cy: number): boolean {
    return this.grid.isBuildable(cx, cy);
  }

  isWater(cx: number, cy: number): boolean {
    return this.grid.isWater(cx, cy);
  }

  isBridge(cx: number, cy: number): boolean {
    return this.grid.isPlayerBridge(cx, cy);
  }

  isPowered(cx: number, cy: number): boolean {
    return this.grid.isPowered(cx, cy);
  }

  isFloodway(cx: number, cy: number): boolean {
    return this.grid.isFloodway(cx, cy);
  }
}

/**
 * Minimal shape of `combat.Enemy` this driver touches. Declared locally so the
 * gameplay module keeps compiling on its own.
 */
export interface FlowFieldMovable {
  position: Vec2;
  facing: Vec2;
  pathProgress: number;
  reachedGoal: boolean;
}

/**
 * Satisfies `combat.MovementDriver` by steering off the flow field instead of a
 * baked polyline, so a dig mid-wave re-routes enemies that are already walking.
 *
 * Flying enemies must NOT use this (GDD §5.1: "飞行敌人直线飞，无视一切") — give
 * them `straightLine()` and combat's `PolylineMovement`.
 */
export class FlowFieldMovement {
  constructor(private readonly getField: () => FlowField) {}

  advance(enemy: FlowFieldMovable, dt: number, speed: number): void {
    if (speed <= 0) return;
    const field = this.getField();
    let budget = speed * dt;
    let guard = 0;

    while (budget > 1e-9 && guard < 64) {
      guard += 1;
      const cx = Math.floor(enemy.position.x);
      const cy = Math.floor(enemy.position.y);

      // Aim for the centre of the current cell first: turning on cell centres
      // is what keeps a grid re-route from cutting a corner through a tower.
      const centre = { x: cx + 0.5, y: cy + 0.5 };
      const atCentre =
        Math.abs(enemy.position.x - centre.x) < 1e-4 && Math.abs(enemy.position.y - centre.y) < 1e-4;

      let target: Vec2;
      if (atCentre) {
        const dir = directionAt(field, cx, cy);
        if (!dir) {
          enemy.reachedGoal = true;
          return;
        }
        target = { x: centre.x + dir.x, y: centre.y + dir.y };
      } else {
        target = centre;
      }

      const dx = target.x - enemy.position.x;
      const dy = target.y - enemy.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-9) {
        enemy.position.x = target.x;
        enemy.position.y = target.y;
        continue;
      }

      const step = Math.min(budget, distance);
      enemy.position.x += (dx / distance) * step;
      enemy.position.y += (dy / distance) * step;
      enemy.facing.x = dx / distance;
      enemy.facing.y = dy / distance;
      enemy.pathProgress += step;
      budget -= step;

      if (step >= distance - 1e-9) {
        enemy.position.x = target.x;
        enemy.position.y = target.y;
      }
    }
  }
}

/** Cell-centre polyline from a spawn cell to the core, for `PolylineMovement`. */
export function polylineToCore(field: FlowField, from: CellCoord): Vec2[] {
  if (!isReachable(field, from.cx, from.cy)) return [];
  return tracePolyline(field, from);
}
