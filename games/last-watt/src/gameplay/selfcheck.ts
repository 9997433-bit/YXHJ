/**
 * Dependency-free self-check for the gameplay module.
 *
 * Not a replacement for `tests/` (that subtree owns the real suite) — this is
 * the executable version of the invariants the GDD states, so the module can be
 * verified from a plain `node`/`vite-node` run and so the test authors have a
 * list of what is supposed to hold.
 *
 *   npx vite-node src/gameplay/selfcheck.ts
 */

import type { CellCoord } from './types';
import { CellFlag } from './types';
import { Grid } from './grid/Grid';
import { MAP1_POWERHOUSE } from './maps/map1Powerhouse';
import { computeFlowField, costAt, isReachable, tracePath } from './pathing/flowField';
import { checkConnectivity } from './pathing/connectivity';
import { EngineeringSystem } from './engineering/EngineeringSystem';
import { GameplayEvents } from './events';
import { buildWavePlan, MAP_WAVE_MODIFIER_PRESETS } from './waves/waveGenerator';
import { ENEMY_IDS } from './waves/enemyMeta';
import { GameplayWorld } from './world';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfCheckReport {
  results: CheckResult[];
  passed: number;
  failed: number;
  ok: boolean;
}

class Checker {
  readonly results: CheckResult[] = [];

  check(name: string, run: () => string | true): void {
    try {
      const outcome = run();
      this.results.push({
        name,
        ok: outcome === true,
        detail: outcome === true ? '' : outcome,
      });
    } catch (error) {
      this.results.push({
        name,
        ok: false,
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }
}

const expect = (condition: boolean, message: string): string | true => (condition ? true : message);

function freshWorld(): GameplayWorld {
  return new GameplayWorld({ map: MAP1_POWERHOUSE, events: new GameplayEvents() });
}

/** Advances a world until every running engineering job has completed. */
function settle(world: GameplayWorld, seconds = 4): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) world.engineering.tick(step);
}

interface WalkTrail {
  visited: CellCoord[];
  reachedGoal: boolean;
}

/** Drives a stand-in ground unit with the real `FlowFieldMovement`. */
function walk(world: GameplayWorld, from: CellCoord, speed = 4): WalkTrail {
  const unit = {
    position: { x: from.cx + 0.5, y: from.cy + 0.5 },
    facing: { x: 0, y: 0 },
    pathProgress: 0,
    reachedGoal: false,
  };
  const visited: CellCoord[] = [{ ...from }];

  for (let step = 0; step < 4000 && !unit.reachedGoal; step += 1) {
    world.movement.advance(unit, 1 / 60, speed);
    const cell = { cx: Math.floor(unit.position.x), cy: Math.floor(unit.position.y) };
    const last = visited[visited.length - 1] as CellCoord;
    if (cell.cx !== last.cx || cell.cy !== last.cy) visited.push(cell);
  }

  return { visited, reachedGoal: unit.reachedGoal };
}

export function runGameplaySelfCheck(): SelfCheckReport {
  const checker = new Checker();

  // -- map & grid -----------------------------------------------------------

  checker.check('map 1 layout parses and is 20×12', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    return expect(
      grid.cols === 20 && grid.rows === 12 && grid.coreCells.length === 4,
      `cols=${grid.cols} rows=${grid.rows} core=${grid.coreCells.length}`,
    );
  });

  checker.check('terrain traits follow GDD §5.1', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const problems: string[] = [];
    if (grid.isBuildable(1, 1)) problems.push('road cell (1,1) must not be buildable');
    if (!grid.isWalkable(1, 1)) problems.push('road cell (1,1) must be walkable');
    if (!grid.isBuildable(5, 0)) problems.push('ground cell (5,0) must be buildable');
    if (grid.isWalkable(5, 0)) problems.push('ground cell (5,0) must not be walkable');
    if (!grid.isBridgeable(11, 5)) problems.push('trench (11,5) must be bridgeable');
    if (grid.isWalkable(11, 5)) problems.push('trench (11,5) must not be walkable');
    if (!grid.isWalkable(10, 6)) problems.push('puddle (10,6) must be walkable');
    if (!grid.isWater(10, 6)) problems.push('puddle (10,6) must count as water');
    return expect(problems.length === 0, problems.join('; '));
  });

  checker.check('every gate reaches the core on a fresh board', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const report = checkConnectivity(grid);
    return expect(report.ok, `blocked gates: ${report.blockedGates.join(', ')}`);
  });

  // -- flow field -----------------------------------------------------------

  checker.check('flow field routes gate 1 through the (8,2) short-cut', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const field = computeFlowField(grid, grid.coreCells);
    const path = tracePath(field, { cx: 0, cy: 1 });
    const usesShortcut = path.some((cell) => cell.cx === 8 && cell.cy === 2);
    const cost = costAt(field, 0, 1);
    return expect(
      usesShortcut && cost === 32,
      `cost=${cost} (expected 32), shortcut=${usesShortcut}`,
    );
  });

  checker.check('flow field path is a chain of walkable neighbours ending on the core', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const field = computeFlowField(grid, grid.coreCells);
    const path = tracePath(field, { cx: 0, cy: 10 });
    const problems: string[] = [];
    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1] as { cx: number; cy: number };
      const current = path[i] as { cx: number; cy: number };
      const step = Math.abs(current.cx - previous.cx) + Math.abs(current.cy - previous.cy);
      if (step !== 1) problems.push(`step ${i} is not a 4-neighbour move`);
      if (!grid.isWalkable(current.cx, current.cy)) problems.push(`step ${i} is not walkable`);
    }
    const last = path[path.length - 1] as { cx: number; cy: number };
    if (grid.terrainAt(last.cx, last.cy) !== 'core') problems.push('path does not end on the core');
    return expect(problems.length === 0, problems.join('; '));
  });

  checker.check('unreachable cells report Infinity in a strict field', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const field = computeFlowField(grid, grid.coreCells);
    return expect(
      !isReachable(field, 0, 0) && costAt(field, 0, 0) === Infinity,
      `ground cell (0,0) should be unreachable, got ${costAt(field, 0, 0)}`,
    );
  });

  checker.check('soft field always offers a direction so nothing can soft-lock', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const field = computeFlowField(grid, grid.coreCells, { blockedPenalty: 1000 });
    let missing = 0;
    grid.forEachCell((cx, cy, index) => {
      if (field.cost[index] === 0) return;
      if ((field.direction[index] as number) < 0) missing += 1;
    });
    return expect(missing === 0, `${missing} cells have no direction`);
  });

  // -- engineering ----------------------------------------------------------

  checker.check('dig is only legal on 可挖路段', () => {
    const world = freshWorld();
    const onRoad = world.engineering.checkDig(2, 1);
    const onGround = world.engineering.checkDig(5, 0);
    const onMarked = world.engineering.checkDig(8, 2);
    return expect(
      !onRoad.ok && onRoad.reason === 'not_diggable' &&
        !onGround.ok && onGround.reason === 'not_diggable' &&
        onMarked.ok,
      `road=${onRoad.reason} ground=${onGround.reason} marked=${onMarked.reason}`,
    );
  });

  checker.check('digging the (8,2) short-cut costs 12 extra steps', () => {
    const world = freshWorld();
    const started = world.engineering.beginDig(8, 2);
    if (!started.ok) return `dig rejected: ${started.reason}`;
    settle(world);
    const cost = costAt(world.groundField, 0, 1);
    return expect(cost === 44, `expected 44 steps after the dig, got ${cost}`);
  });

  checker.check('a dig stays passable while the work is running (GDD §5.1)', () => {
    const world = freshWorld();
    world.engineering.beginDig(8, 2);
    const duringWork = world.grid.isWalkable(8, 2);
    world.engineering.tick(1);
    const stillWalkable = world.grid.isWalkable(8, 2);
    settle(world);
    const afterWork = world.grid.terrainAt(8, 2);
    return expect(
      duringWork && stillWalkable && afterWork === 'trench',
      `during=${duringWork} mid=${stillWalkable} after=${afterWork}`,
    );
  });

  checker.check('a dig that would seal every route is rejected', () => {
    const world = freshWorld();
    // (8,2) forces the long serpentine; (12,3) then cuts that serpentine in two.
    const first = world.engineering.beginDig(8, 2);
    settle(world);
    const second = world.engineering.checkDig(12, 3);
    return expect(
      first.ok && !second.ok && second.reason === 'would_block_path' && second.blockedGates.length > 0,
      `first=${first.reason} second=${second.reason} gates=${second.blockedGates.join(',')}`,
    );
  });

  checker.check('two queued digs are judged together, not one at a time', () => {
    const world = freshWorld();
    const first = world.engineering.beginDig(8, 2);
    // Still under construction: the second check must already see the trench.
    const second = world.engineering.checkDig(12, 3);
    return expect(
      first.ok && !second.ok && second.reason === 'would_block_path',
      `first=${first.reason} second=${second.reason}`,
    );
  });

  checker.check('legality accounts for gates that have not opened yet', () => {
    const world = freshWorld();
    // (5,10) is the south gate's only exit and the south gate opens on wave 10.
    world.grid.setFlag(5, 10, CellFlag.Diggable, true);
    const check = world.engineering.checkDig(5, 10);
    return expect(
      !check.ok && check.blockedGates.includes('gate_south'),
      `reason=${check.reason} gates=${check.blockedGates.join(',')}`,
    );
  });

  checker.check('bridging the ravine at (11,5) opens the 22-step middle route', () => {
    const world = freshWorld();
    const started = world.engineering.beginBridge(11, 5);
    if (!started.ok) return `bridge rejected: ${started.reason}`;
    const midWork = world.grid.isWalkable(11, 5);
    settle(world);
    const cost = costAt(world.groundField, 0, 1);
    return expect(
      !midWork && cost === 22 && world.grid.isPlayerBridge(11, 5),
      `walkableDuringWork=${midWork} cost=${cost}`,
    );
  });

  checker.check('a sapper destroying a bridge reverts the terrain and re-routes', () => {
    const world = freshWorld();
    world.engineering.beginBridge(11, 5);
    settle(world);
    const bridged = costAt(world.groundField, 0, 1);
    world.destroyBridge(11, 5, 42);
    const after = costAt(world.groundField, 0, 1);
    return expect(
      bridged === 22 && after === 32 && world.grid.terrainAt(11, 5) === 'trench',
      `bridged=${bridged} after=${after} terrain=${world.grid.terrainAt(11, 5)}`,
    );
  });

  checker.check('quotas are spent, never refunded by a sapper', () => {
    const world = freshWorld();
    const before = world.engineering.bridgeLeft;
    world.engineering.beginBridge(11, 5);
    settle(world);
    world.destroyBridge(11, 5);
    return expect(
      before === 2 && world.engineering.bridgeLeft === 1,
      `before=${before} after=${world.engineering.bridgeLeft}`,
    );
  });

  checker.check('quota exhaustion blocks further work', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const engineering = new EngineeringSystem({ grid, digQuota: 0 });
    const check = engineering.checkDig(8, 2);
    return expect(!check.ok && check.reason === 'no_quota', `reason=${check.reason}`);
  });

  checker.check('the wave 15 grant hands out one extra dig', () => {
    const world = freshWorld();
    const before = world.engineering.digLeft;
    world.engineering.applyGrantsForWave(15);
    return expect(
      world.engineering.digLeft === before + 1,
      `before=${before} after=${world.engineering.digLeft}`,
    );
  });

  checker.check('insufficient gold is reported without touching the wallet', () => {
    const grid = new Grid(MAP1_POWERHOUSE);
    const engineering = new EngineeringSystem({ grid, getGold: () => 10 });
    const check = engineering.checkDig(8, 2);
    return expect(
      !check.ok && check.reason === 'insufficient_gold' && check.cost === 50,
      `reason=${check.reason} cost=${check.cost}`,
    );
  });

  // -- zones & barriers -----------------------------------------------------

  checker.check('losing zone A cuts power to its cells only', () => {
    const world = freshWorld();
    const lost = world.applyIntegrity(80);
    const zoneCellPowered = world.grid.isPowered(5, 2);
    const otherPowered = world.grid.isPowered(5, 4);
    return expect(
      lost.length === 1 && lost[0]?.id === 'A' && !zoneCellPowered && otherPowered,
      `lost=${lost.map((z) => z.id).join(',')} zoneCell=${zoneCellPowered} other=${otherPowered}`,
    );
  });

  checker.check('losing zone B opens the sluice and shortens the enemy route', () => {
    const world = freshWorld();
    const before = costAt(world.groundField, 0, 1);
    world.applyIntegrity(50);
    const after = costAt(world.groundField, 0, 1);
    return expect(
      before === 32 && after === 21 && world.grid.terrainAt(16, 4) === 'path',
      `before=${before} after=${after} sluice=${world.grid.terrainAt(16, 4)}`,
    );
  });

  checker.check('integrity thresholds fire once and only once', () => {
    const world = freshWorld();
    const first = world.applyIntegrity(40);
    const second = world.applyIntegrity(40);
    return expect(
      first.length === 2 && second.length === 0,
      `first=${first.length} second=${second.length}`,
    );
  });

  // -- combat-facing adapters -----------------------------------------------

  checker.check('the flow-field driver walks a ground unit all the way to the core', () => {
    const world = freshWorld();
    const trail = walk(world, { cx: 0, cy: 1 });
    const last = trail.visited[trail.visited.length - 1] as { cx: number; cy: number };
    return expect(
      trail.reachedGoal && world.grid.terrainAt(last.cx, last.cy) === 'core',
      `reached=${trail.reachedGoal} last=${last.cx},${last.cy} steps=${trail.visited.length}`,
    );
  });

  checker.check('a dig re-routes units that are already on the road', () => {
    const world = freshWorld();
    // Park the unit one cell short of the (8,2) short-cut, then close it.
    const start = { cx: 7, cy: 1 };
    const before = walk(world, start);
    world.engineering.beginDig(8, 2);
    settle(world);
    const after = walk(world, start);
    const usedShortcut = (trail: WalkTrail): boolean =>
      trail.visited.some((cell) => cell.cx === 8 && cell.cy === 2);
    return expect(
      usedShortcut(before) && !usedShortcut(after) && after.reachedGoal,
      `before=${usedShortcut(before)} after=${usedShortcut(after)} reached=${after.reachedGoal}`,
    );
  });

  checker.check('the terrain adapter only reports player bridges as bridges', () => {
    const world = freshWorld();
    const beforeBuild = world.terrain.isBridge(11, 5);
    world.engineering.beginBridge(11, 5);
    settle(world);
    return expect(
      !beforeBuild &&
        world.terrain.isBridge(11, 5) &&
        !world.terrain.isBuildable(11, 5) &&
        world.terrain.isRoad(11, 5),
      `before=${beforeBuild} after=${world.terrain.isBridge(11, 5)}`,
    );
  });

  checker.check('the polyline handed to combat is a cell-centre chain', () => {
    const world = freshWorld();
    const polyline = world.polylineFromGate('gate_north');
    const offGrid = polyline.filter(
      (point) => Math.abs((point.x % 1) - 0.5) > 1e-9 || Math.abs((point.y % 1) - 0.5) > 1e-9,
    );
    return expect(
      polyline.length === 33 && offGrid.length === 0,
      `length=${polyline.length} offCentre=${offGrid.length}`,
    );
  });

  // -- waves ----------------------------------------------------------------

  checker.check('the plan is 20 waves with wave × 5 rewards', () => {
    const plan = buildWavePlan({ gates: [{ id: 'g1', openWave: 1 }] });
    const bad = plan.filter((wave) => wave.reward !== wave.wave * 5);
    return expect(
      plan.length === 20 && bad.length === 0,
      `waves=${plan.length} badRewards=${bad.length}`,
    );
  });

  checker.check('bounty decays ×0.8 after wave 10 and ×0.6 after wave 15', () => {
    const plan = buildWavePlan({ gates: [{ id: 'g1', openWave: 1 }] });
    const at = (wave: number): number => plan[wave - 1]?.bountyMultiplier ?? -1;
    return expect(
      at(10) === 1 && at(11) === 0.8 && at(15) === 0.8 && at(16) === 0.6,
      `w10=${at(10)} w11=${at(11)} w15=${at(15)} w16=${at(16)}`,
    );
  });

  checker.check('a gate only receives spawns once it has opened', () => {
    const plan = buildWavePlan({
      gates: [
        { id: 'a', openWave: 1 },
        { id: 'b', openWave: 10 },
      ],
    });
    const early = plan.slice(0, 9).flatMap((wave) => wave.spawns);
    const late = plan[9]?.spawns ?? [];
    return expect(
      early.every((spawn) => spawn.gateId === 'a') && late.some((spawn) => spawn.gateId === 'b'),
      `earlyLeak=${early.filter((s) => s.gateId !== 'a').length} lateUsesB=${late.some((s) => s.gateId === 'b')}`,
    );
  });

  checker.check('breakers are substituted before their first-appearance wave', () => {
    const plan = buildWavePlan({
      gates: [{ id: 'a', openWave: 1 }],
      modifiers: MAP_WAVE_MODIFIER_PRESETS.map2,
    });
    // Map 2 delays the sapper crab to wave 9; the base table fields it on 7.
    const wave7 = plan[6]?.spawns.filter((spawn) => spawn.enemy === ENEMY_IDS.sapperCrab) ?? [];
    const wave9 = plan[8]?.spawns.filter((spawn) => spawn.enemy === ENEMY_IDS.sapperCrab) ?? [];
    return expect(
      wave7.length === 0 && wave9.length > 0,
      `wave7=${wave7.length} wave9=${wave9.length}`,
    );
  });

  checker.check('an early first appearance injects a squad (map 3, wave 2)', () => {
    const plan = buildWavePlan({
      gates: [{ id: 'a', openWave: 1 }],
      modifiers: MAP_WAVE_MODIFIER_PRESETS.map3,
    });
    const wave2 = plan[1]?.preview.map((entry) => entry.enemy) ?? [];
    const hasAllThree = [ENEMY_IDS.scoutBee, ENEMY_IDS.sapperCrab, ENEMY_IDS.repairDrone].every(
      (enemy) => wave2.includes(enemy),
    );
    return expect(hasAllThree, `wave 2 preview: ${wave2.join(', ')}`);
  });

  checker.check('map weight columns scale the right classes (GDD §8.3)', () => {
    const base = buildWavePlan({ gates: [{ id: 'a', openWave: 1 }] });
    const map2 = buildWavePlan({
      gates: [{ id: 'a', openWave: 1 }],
      modifiers: MAP_WAVE_MODIFIER_PRESETS.map2,
    });
    const countAt = (plan: ReturnType<typeof buildWavePlan>, wave: number, enemy: string): number =>
      plan[wave - 1]?.spawns.filter((spawn) => spawn.enemy === enemy).length ?? 0;
    const baseBees = countAt(base, 16, ENEMY_IDS.scoutBee);
    const map2Bees = countAt(map2, 16, ENEMY_IDS.scoutBee);
    return expect(
      baseBees === 8 && map2Bees === 12,
      `base=${baseBees} map2=${map2Bees} (expected 8 → 12 at ×1.5)`,
    );
  });

  checker.check('map 3 doubles the wave 15 mothership and buffs the Leviathan', () => {
    const plan = buildWavePlan({
      gates: [{ id: 'a', openWave: 1 }],
      modifiers: MAP_WAVE_MODIFIER_PRESETS.map3,
    });
    const motherships = plan[14]?.spawns.filter((s) => s.enemy === ENEMY_IDS.mothership).length ?? 0;
    const leviathanHp = plan[19]?.spawns.find((s) => s.enemy === ENEMY_IDS.leviathan)?.hpMultiplier ?? 0;
    return expect(
      motherships === 2 && Math.abs(leviathanHp - 1.44) < 1e-9,
      `motherships=${motherships} leviathanHp=${leviathanHp} (expected 2 and 1.2×1.2)`,
    );
  });

  checker.check('preview counts match what actually spawns', () => {
    const plan = buildWavePlan({ gates: [{ id: 'a', openWave: 1 }] });
    const problems: string[] = [];
    for (const wave of plan) {
      for (const entry of wave.preview) {
        const actual = wave.spawns.filter((spawn) => spawn.enemy === entry.enemy).length;
        if (actual !== entry.count) {
          problems.push(`wave ${wave.wave} ${entry.enemy}: preview ${entry.count} vs ${actual}`);
        }
      }
    }
    return expect(problems.length === 0, problems.slice(0, 3).join('; '));
  });

  checker.check('the runner emits every spawn of a wave exactly once', () => {
    const world = freshWorld();
    world.startWave();
    const wave = world.waves.currentWave;
    let emitted = 0;
    for (let t = 0; t < 120; t += 1 / 60) {
      emitted += world.tick(1 / 60).length;
      if (world.waves.spawningComplete) break;
    }
    return expect(
      wave !== null && emitted === wave.spawns.length && world.waves.state === 'clearing',
      `emitted=${emitted} expected=${wave?.spawns.length} state=${world.waves.state}`,
    );
  });

  checker.check('starting early pays the +10% bonus on clear', () => {
    const world = freshWorld();
    world.startWave({ early: true });
    for (let t = 0; t < 120; t += 1 / 60) {
      world.tick(1 / 60);
      if (world.waves.spawningComplete) break;
    }
    const result = world.waves.notifyWaveCleared();
    return expect(
      result?.reward === 5 && result.earlyBonus === 1 && result.total === 6,
      `result=${JSON.stringify(result)}`,
    );
  });

  checker.check('the second gate opens at wave 10 and emits once', () => {
    const world = freshWorld();
    let openings = 0;
    world.events.on('gate_opened', () => {
      openings += 1;
    });
    for (let wave = 1; wave <= 10; wave += 1) {
      world.startWave();
      for (let t = 0; t < 200; t += 1 / 60) {
        world.tick(1 / 60);
        if (world.waves.spawningComplete) break;
      }
      world.waves.notifyWaveCleared();
    }
    return expect(
      openings === 1 && world.grid.gate('gate_south')?.open === true,
      `openings=${openings} southOpen=${world.grid.gate('gate_south')?.open}`,
    );
  });

  const passed = checker.results.filter((result) => result.ok).length;
  return {
    results: checker.results,
    passed,
    failed: checker.results.length - passed,
    ok: passed === checker.results.length,
  };
}

export function formatSelfCheckReport(report: SelfCheckReport): string {
  const lines = report.results.map(
    (result) => `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? `\n        ${result.detail}` : ''}`,
  );
  lines.push(`\n${report.passed} passed, ${report.failed} failed`);
  return lines.join('\n');
}
