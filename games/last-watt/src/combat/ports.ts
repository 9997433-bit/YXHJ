/**
 * Inbound ports: everything combat needs to know about the world but does not
 * own. `src/gameplay` (grid, pathing, economy) supplies real implementations;
 * the defaults below let combat run headless in tests and benchmarks.
 */

import type { Enemy } from './entities/enemy';
import type { Seconds, Vec2 } from './types';

/**
 * Static terrain queries. Cell *coatings* (oil / fire) are deliberately NOT
 * here: combat authors and consumes them, so it owns that field itself
 * (see `terrain.ts`).
 */
export interface TerrainQuery {
  readonly width: number;
  readonly height: number;
  isInside(cx: number, cy: number): boolean;
  /** Enemies walk here. Coatings only stick to road cells. */
  isRoad(cx: number, cy: number): boolean;
  isBuildable(cx: number, cy: number): boolean;
  /** Puddle variant of road: stepping on it applies `wet` (GDD §5.1). */
  isWater(cx: number, cy: number): boolean;
  /** Player-built bridge tile: the sapper crab blows these up (GDD §8.1). */
  isBridge(cx: number, cy: number): boolean;
  /** False inside a lost substation zone — towers there shut down (GDD §10). */
  isPowered(cx: number, cy: number): boolean;
  /**
   * Map 2 floodway (GDD §5.2): these cells are washed clean of oil at the
   * start of every wave, which is what kills the oil-fire combo on that map.
   */
  isFloodway(cx: number, cy: number): boolean;
}

/** Open, fully powered field. Used by headless scenarios and unit tests. */
export class OpenFieldTerrain implements TerrainQuery {
  constructor(
    readonly width = 20,
    readonly height = 12,
    private readonly water: ReadonlySet<string> = new Set(),
  ) {}

  isInside(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }
  isRoad(cx: number, cy: number): boolean {
    return this.isInside(cx, cy);
  }
  isBuildable(cx: number, cy: number): boolean {
    return this.isInside(cx, cy);
  }
  isWater(cx: number, cy: number): boolean {
    return this.water.has(`${cx},${cy}`);
  }
  isBridge(): boolean {
    return false;
  }
  isPowered(): boolean {
    return true;
  }
  isFloodway(): boolean {
    return false;
  }
}

/**
 * Movement is owned by `src/gameplay` (flow field, GDD §5.1). Combat only
 * hands it the current speed after status modifiers and asks it to advance.
 */
export interface MovementDriver {
  /**
   * @param speed cells per second, already multiplied by status effects.
   *              A frozen or stunned enemy arrives here with speed 0.
   */
  advance(enemy: Enemy, dt: Seconds, speed: number): void;
}

/**
 * Default driver: walk the polyline in `enemy.path`, tracking `pathProgress`
 * (cells travelled) so the "first" targeting strategy works standalone.
 */
export class PolylineMovement implements MovementDriver {
  advance(enemy: Enemy, dt: Seconds, speed: number): void {
    if (speed <= 0 || enemy.path.length === 0) return;
    let budget = speed * dt;

    while (budget > 0 && enemy.pathIndex < enemy.path.length) {
      const node = enemy.path[enemy.pathIndex] as Vec2;
      const dx = node.x - enemy.position.x;
      const dy = node.y - enemy.position.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= 1e-6) {
        enemy.pathIndex += 1;
        continue;
      }
      const step = Math.min(budget, dist);
      enemy.position.x += (dx / dist) * step;
      enemy.position.y += (dy / dist) * step;
      enemy.facing.x = dx / dist;
      enemy.facing.y = dy / dist;
      enemy.pathProgress += step;
      budget -= step;
      if (step >= dist - 1e-6) enemy.pathIndex += 1;
    }

    if (enemy.pathIndex >= enemy.path.length) enemy.reachedGoal = true;
  }
}

/**
 * Battery / power economy lives in `src/gameplay` (GDD §6.2). Combat asks
 * before spending and never mutates the numbers itself.
 */
export interface PowerSupply {
  /** Returns false when the player cannot pay; the activation is then refused. */
  tryConsumeBattery(amount: number): boolean;
  readonly battery: number;
}

/** Always-solvent stub for headless runs. */
export class InfiniteBattery implements PowerSupply {
  battery = 100;
  tryConsumeBattery(): boolean {
    return true;
  }
}
