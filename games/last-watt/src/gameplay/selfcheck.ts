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
import { DEFAULT_ENEMY_WAVE_META, ENEMY_IDS } from './waves/enemyMeta';
import { GameplayWorld } from './world';
import { GameSession } from './session/GameSession';
import { StubCombat } from './integration/stubCombat';
import type { MapJson, WaveTableJson } from './data/importers';
import { importMapDefJson, importWaveTableJson } from './data/importers';
import type { GameStateDefaultsJson } from './data/gameStateDefaults';
import map1Json from '../../data/maps/map1.json';
import wavesJson from '../../data/waves.map1.json';
import defaultsJson from '../../data/game_state.defaults.json';

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

/**
 * @param options.zoneLoss opts into 丢区 (GDD §10), which the M1 scope lock
 *                         keeps off by default — see `rules/scope.ts`.
 */
function freshWorld(options: { zoneLoss?: boolean } = {}): GameplayWorld {
  return new GameplayWorld({
    map: MAP1_POWERHOUSE,
    events: new GameplayEvents(),
    ...(options.zoneLoss !== undefined ? { zoneLoss: options.zoneLoss } : {}),
  });
}

/** Advances a world until every running engineering job has completed. */
function settle(world: GameplayWorld, seconds = 4): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) world.engineering.tick(step);
}

/**
 * A session on the board the game actually ships — `data/maps/map1.json` and
 * its wave table — rather than this module's greybox. No combat is attached, so
 * the wave runner settles itself as soon as spawning finishes.
 */
function authoredSession(): GameSession {
  const map = importMapDefJson(map1Json as unknown as MapJson);
  const waveTable = importWaveTableJson(
    wavesJson as unknown as WaveTableJson,
    map.gates.map((gate) => gate.id),
  );
  return new GameSession({
    map,
    waveTable,
    events: new GameplayEvents(),
    enemyMeta: DEFAULT_ENEMY_WAVE_META,
  });
}

/** Runs the authored schedule up to and including `upTo`, with nothing to kill. */
function playAuthoredWaves(session: GameSession, upTo: number): void {
  for (let n = 1; n <= upTo; n += 1) {
    session.startWave();
    for (let t = 0; t < 60 * 300 && session.world.waves.state !== 'preparing'; t += 1) {
      session.tick(1 / 60);
    }
  }
}

function digTargetsOf(session: GameSession): string[] {
  return session.world.engineering.legalTargets('dig').map((cell) => `${cell.cx},${cell.cy}`);
}

interface WiredSession {
  session: GameSession;
  combat: StubCombat;
}

/**
 * A session with the stand-in combat attached, i.e. the full R2 wiring:
 * occupancy, spawns, bounties, leaks, blackouts and the bridge round-trip.
 */
function wiredSession(
  options: { gold?: number; integrity?: number; unlockAll?: boolean; zoneLoss?: boolean } = {},
): WiredSession {
  const session = new GameSession({
    map: MAP1_POWERHOUSE,
    events: new GameplayEvents(),
    economy: {
      ...(options.gold !== undefined ? { startingGold: options.gold } : {}),
      ...(options.integrity !== undefined ? { maxIntegrity: options.integrity } : {}),
    },
    enemyMeta: DEFAULT_ENEMY_WAVE_META,
    ...(options.unlockAll ? { isBlueprintUnlocked: (): boolean => true } : {}),
    ...(options.zoneLoss !== undefined ? { zoneLoss: options.zoneLoss } : {}),
  });
  const combat = new StubCombat({
    movement: session.movement,
    terrain: session.terrain,
    enemies: {
      [ENEMY_IDS.sapperCrab]: { destroysBridges: true, speed: 2 },
      [ENEMY_IDS.leviathan]: { lossOnLeak: true, integrityDamage: 100 },
    },
  });
  session.attachCombat(combat);
  return { session, combat };
}

/** Runs one wave to the end: spawn everything, wipe the field, collect. */
function playWave(wired: WiredSession, options: { early?: boolean } = {}): void {
  wired.session.startWave(options);
  for (let t = 0; t < 60 * 300 && !wired.session.world.waves.spawningComplete; t += 1) {
    wired.session.tick(1 / 60);
  }
  wired.combat.killAll();
  wired.session.tick(1 / 60);
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
    grid.forEachCell((_cx, _cy, index) => {
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

  checker.check('丢区 on: losing zone A cuts power to its cells only', () => {
    const world = freshWorld({ zoneLoss: true });
    const lost = world.applyIntegrity(80);
    const zoneCellPowered = world.grid.isPowered(5, 2);
    const otherPowered = world.grid.isPowered(5, 4);
    return expect(
      lost.length === 1 && lost[0]?.id === 'A' && !zoneCellPowered && otherPowered,
      `lost=${lost.map((z) => z.id).join(',')} zoneCell=${zoneCellPowered} other=${otherPowered}`,
    );
  });

  checker.check('丢区 on: losing zone B opens the sluice and shortens the route', () => {
    const world = freshWorld({ zoneLoss: true });
    const before = costAt(world.groundField, 0, 1);
    world.applyIntegrity(50);
    const after = costAt(world.groundField, 0, 1);
    return expect(
      before === 32 && after === 21 && world.grid.terrainAt(16, 4) === 'path',
      `before=${before} after=${after} sluice=${world.grid.terrainAt(16, 4)}`,
    );
  });

  checker.check('丢区 on: integrity thresholds fire once and only once', () => {
    const world = freshWorld({ zoneLoss: true });
    const first = world.applyIntegrity(40);
    const second = world.applyIntegrity(40);
    return expect(
      first.length === 2 && second.length === 0,
      `first=${first.length} second=${second.length}`,
    );
  });

  // M1 是教学切片，完整度只扣分不丢区（Round 2 主调度裁决 3）。

  checker.check('M1: crossing 80 and 50 reports the breach but loses nothing', () => {
    const world = freshWorld();
    let announced = 0;
    world.events.on('zone_lost', () => {
      announced += 1;
    });
    const lost = world.applyIntegrity(40);
    const breached = world.breachedZones(40);
    return expect(
      lost.length === 0 &&
        announced === 0 &&
        breached.length === 2 &&
        world.grid.zones.every((zone) => zone.powered),
      `lost=${lost.length} events=${announced} breached=${breached.length}`,
    );
  });

  checker.check('M1: the sluice stays shut however low the core gets', () => {
    const world = freshWorld();
    const before = costAt(world.groundField, 0, 1);
    world.applyIntegrity(0);
    return expect(
      costAt(world.groundField, 0, 1) === before && world.grid.terrainAt(16, 4) !== 'path',
      `route ${before} -> ${costAt(world.groundField, 0, 1)} sluice=${world.grid.terrainAt(16, 4)}`,
    );
  });

  checker.check('placing a tower does not rebuild the flow field', () => {
    const world = freshWorld();
    void world.groundField;
    let rebuilds = 0;
    world.events.on('flow_field_rebuilt', () => {
      rebuilds += 1;
    });
    world.grid.setOccupied(5, 0, true);
    void world.groundField;
    const afterTower = rebuilds;
    world.engineering.beginDig(8, 2);
    settle(world);
    void world.groundField;
    return expect(
      afterTower === 0 && rebuilds === 1 && !world.grid.isBuildable(5, 0),
      `afterTower=${afterTower} afterDig=${rebuilds}`,
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

  // -- combat handshake (R2) ------------------------------------------------
  //
  // Driven through `StubCombat`, which implements the same `CombatPort` the
  // real `CombatSystem` does. These assert the wiring, not the combat maths.

  checker.check('a tower takes its cell without re-routing anybody', () => {
    const { session, combat } = wiredSession();
    void session.world.groundField;
    let rebuilds = 0;
    session.events.on('flow_field_rebuilt', () => {
      rebuilds += 1;
    });
    const gold = session.economy.gold;
    const placed = session.commands.buildAt('mg_rivet', 5, 0);
    void session.world.groundField;
    return expect(
      placed.ok &&
        session.world.grid.isOccupied(5, 0) &&
        !session.world.grid.isBuildable(5, 0) &&
        session.economy.gold === gold - 50 &&
        combat.towerList().length === 1 &&
        rebuilds === 0,
      `ok=${placed.ok} occupied=${session.world.grid.isOccupied(5, 0)} gold=${session.economy.gold} rebuilds=${rebuilds}`,
    );
  });

  checker.check('the same cell cannot take a second tower', () => {
    const { session } = wiredSession();
    session.commands.buildAt('mg_rivet', 5, 0);
    const again = session.commands.buildAt('mg_rivet', 5, 0);
    return expect(!again.ok && again.check?.reason === 'occupied', `reason=${again.check?.reason}`);
  });

  checker.check('selling frees the cell and releases the supply draw', () => {
    const { session, combat } = wiredSession({ gold: 1000, unlockAll: true });
    session.commands.buildAt('tesla_coil', 5, 0);
    const drawn = session.economy.powerUsed;
    const refund = session.commands.sellAt(5, 0);
    return expect(
      drawn === 4 &&
        refund.ok &&
        session.economy.powerUsed === 0 &&
        session.world.grid.isBuildable(5, 0) &&
        combat.towerList().length === 0,
      `drawn=${drawn} used=${session.economy.powerUsed} buildable=${session.world.grid.isBuildable(5, 0)}`,
    );
  });

  checker.check('the supply cap refuses the tower that would break it (GDD §6.2)', () => {
    const { session } = wiredSession({ gold: 1000, unlockAll: true });
    const first = session.commands.buildAt('tesla_coil', 5, 0);
    const second = session.commands.buildAt('tesla_coil', 6, 0);
    const third = session.commands.buildAt('tesla_coil', 7, 0);
    return expect(
      first.ok && second.ok && !third.ok && third.check?.reason === 'insufficient_power',
      `1=${first.ok} 2=${second.ok} 3=${third.check?.reason} used=${session.economy.powerUsed}/${session.economy.powerCap}`,
    );
  });

  checker.check('generators raise the cap and capacitors the battery (GDD §6.2, D9)', () => {
    const { session } = wiredSession({ gold: 1000, unlockAll: true });
    const baseCap = session.economy.powerCap;
    const baseBattery = session.economy.batteryMax;
    session.build.place('generator', 5, 0);
    session.build.place('capacitor_station', 6, 0);
    return expect(
      session.economy.powerCap === baseCap + 6 &&
        session.economy.batteryMax === baseBattery + 30 &&
        Math.abs(session.economy.batteryChargeMultiplier - 1.5) < 1e-9,
      `cap=${session.economy.powerCap} battery=${session.economy.batteryMax} mul=${session.economy.batteryChargeMultiplier}`,
    );
  });

  checker.check('the 挖沟 button arms, highlights, digs on click and disarms', () => {
    const { session } = wiredSession();
    const armed = session.commands.armDig();
    const targets = session.highlightTargets();
    const gold = session.economy.gold;
    const clicked = session.commands.clickCell(8, 2);
    return expect(
      armed.ok &&
        session.armedTool === null &&
        targets.some((cell) => cell.cx === 8 && cell.cy === 2) &&
        clicked.ok &&
        session.economy.gold === gold - 50 &&
        session.world.engineering.digLeft === 2,
      `targets=${targets.length} clicked=${clicked.status} gold=${session.economy.gold}`,
    );
  });

  checker.check('an illegal click leaves the tool armed and the wallet alone', () => {
    const { session } = wiredSession();
    session.commands.armDig();
    const gold = session.economy.gold;
    const clicked = session.commands.clickCell(1, 1);
    return expect(
      !clicked.ok &&
        session.armedTool === 'dig' &&
        session.economy.gold === gold &&
        session.world.engineering.digLeft === 3,
      `status=${clicked.status} armed=${session.armedTool} gold=${session.economy.gold}`,
    );
  });

  checker.check('the engineering buttons grey out with the reason attached', () => {
    const { session } = wiredSession({ gold: 10 });
    const buttons = session.commands.buttons();
    return expect(
      !buttons.dig.enabled && buttons.dig.message === '金币不足' && buttons.dig.badge === 3,
      `enabled=${buttons.dig.enabled} message=${buttons.dig.message} badge=${buttons.dig.badge}`,
    );
  });

  checker.check('the wallet starts from data/game_state.defaults.json (§5.4)', () => {
    const { session } = wiredSession();
    const json = defaultsJson as unknown as GameStateDefaultsJson;
    return expect(
      session.economy.gold === json.defaults.gold &&
        session.economy.powerCap === json.defaults.power_cap &&
        session.economy.batteryMax === json.limits.battery_max_base &&
        session.world.engineering.config.digCost === json.rules.economy.dig_cost_gold,
      `gold=${session.economy.gold} cap=${session.economy.powerCap} battery=${session.economy.batteryMax}`,
    );
  });

  checker.check('engineering_completed reports the canonical terrain name', () => {
    const { session } = wiredSession();
    let terrain = '';
    session.events.on('engineering_completed', (job) => {
      terrain = job.terrain;
    });
    session.commands.armDig();
    session.commands.clickCell(8, 2);
    for (let t = 0; t < 4; t += 1 / 60) session.tick(1 / 60);
    // Internally the cell is a `trench`; across the boundary it is a `gully`.
    return expect(
      terrain === 'gully' && session.world.grid.terrainAt(8, 2) === 'trench',
      `event=${terrain} internal=${session.world.grid.terrainAt(8, 2)}`,
    );
  });

  checker.check('every wave_spawn carries a canonical enemy id (§3.2)', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const waveTable = importWaveTableJson(
      wavesJson as unknown as WaveTableJson,
      map.gates.map((gate) => gate.id),
    );
    const canonical = new Set<string>(Object.values(ENEMY_IDS));
    const seen = new Set<string>();
    const world = new GameplayWorld({ map, waveTable });
    for (const wave of world.plan) for (const spawn of wave.spawns) seen.add(spawn.enemy);
    const strays = [...seen].filter((id) => !canonical.has(id));
    return expect(
      strays.length === 0 && seen.size > 0,
      `${seen.size} ids, non-canonical: ${strays.join(', ') || 'none'}`,
    );
  });

  checker.check('applyIntegrity takes a signed delta and latches lost zones', () => {
    const { session } = wiredSession({ zoneLoss: true });
    const damaged = session.applyIntegrity(-25, 'test');
    const zoneLost = session.world.grid.zones.filter((zone) => !zone.powered).length;
    // Repairing back above the threshold does not hand the substation back.
    const healed = session.applyIntegrity(40, 'repair');
    return expect(
      damaged === 75 &&
        zoneLost === 1 &&
        healed === 100 &&
        session.world.grid.zones.filter((zone) => !zone.powered).length === 1,
      `damaged=${damaged} healed=${healed} lost=${zoneLost}`,
    );
  });

  checker.check('ground units spawn on the gate cell and steer on the shared field', () => {
    const { session, combat } = wiredSession();
    let spawnedAt = { x: -1, y: -1 };
    combat.bus.on('enemy_spawned', (payload) => {
      spawnedAt = payload.position;
    });
    session.startWave();
    session.tick(1 / 60);
    const enemy = combat.enemyList()[0];
    // Empty path on purpose: walkers follow the field, so a mid-wave dig
    // re-routes them (GDD §5.1). Only flyers carry waypoints.
    return expect(
      enemy !== undefined &&
        spawnedAt.x === 0.5 &&
        spawnedAt.y === 1.5 &&
        enemy.path.length === 0 &&
        enemy.pathProgress > 0,
      `spawn=${spawnedAt.x},${spawnedAt.y} path=${enemy?.path.length} progress=${enemy?.pathProgress}`,
    );
  });

  checker.check('flyers get a straight line to the core, not the flow field', () => {
    const { session, combat } = wiredSession();
    const request = {
      enemy: ENEMY_IDS.scoutBee,
      gateId: 'gate_north',
      wave: 4,
      ordinal: 0,
      hpMultiplier: 1,
      speedMultiplier: 1,
      bountyMultiplier: 1,
      cx: 0,
      cy: 1,
    };
    session.link.spawn(request);
    const bee = combat.enemyList()[0];
    const core = session.world.grid.coreCells[0] as CellCoord;
    for (let t = 0; t < 60 * 60 && bee && !bee.reachedGoal; t += 1) session.tick(1 / 60);
    return expect(
      bee !== undefined &&
        bee.path.length === 1 &&
        Math.abs((bee.path[0]?.x ?? 0) - (core.cx + 0.5)) < 1e-9 &&
        bee.reachedGoal,
      `path=${JSON.stringify(bee?.path)} reached=${bee?.reachedGoal}`,
    );
  });

  checker.check('the map speed column reaches the movement driver (GDD §8.3)', () => {
    const { session, combat } = wiredSession();
    const base = { enemy: ENEMY_IDS.scavenger, gateId: 'gate_north', wave: 1, ordinal: 0, hpMultiplier: 1, bountyMultiplier: 1, cx: 0, cy: 1 };
    session.link.spawn({ ...base, speedMultiplier: 1 });
    session.link.spawn({ ...base, speedMultiplier: 2 });
    for (let t = 0; t < 30; t += 1) session.tick(1 / 60);
    const [slow, fast] = combat.enemyList();
    const ratio = slow && fast ? fast.pathProgress / Math.max(slow.pathProgress, 1e-9) : 0;
    return expect(Math.abs(ratio - 2) < 0.05, `progress ${slow?.pathProgress} vs ${fast?.pathProgress}`);
  });

  checker.check('a kill pays the decayed bounty (GDD §6.1)', () => {
    const { session, combat } = wiredSession();
    session.startWave();
    session.tick(1 / 60);
    const gold = session.economy.gold;
    const enemy = combat.enemyList()[0];
    if (!enemy) return 'nothing spawned';
    combat.kill(enemy.id);
    return expect(
      session.economy.gold === gold + 5 && session.link.liveEnemies === 0,
      `gold ${gold} -> ${session.economy.gold} live=${session.link.liveEnemies}`,
    );
  });

  checker.check('a leak costs integrity and steals gold (GDD §10)', () => {
    const { session } = wiredSession();
    const gold = session.economy.gold;
    session.link.spawn({
      enemy: ENEMY_IDS.scavenger,
      gateId: 'gate_north',
      wave: 1,
      ordinal: 0,
      hpMultiplier: 1,
      speedMultiplier: 4,
      bountyMultiplier: 1,
      cx: 0,
      cy: 1,
    });
    for (let t = 0; t < 60 * 120 && session.link.liveEnemies > 0; t += 1) session.tick(1 / 60);
    return expect(
      session.economy.integrity === 98 && session.economy.gold === gold - 10,
      `integrity=${session.economy.integrity} gold ${gold} -> ${session.economy.gold}`,
    );
  });

  checker.check('丢区 on: integrity ≤80 loses zone A — cap −4, towers dark, draw kept (D11)', () => {
    const { session, combat } = wiredSession({ gold: 1000, unlockAll: true, zoneLoss: true });
    session.commands.buildAt('tesla_coil', 5, 2); // inside zone A
    const tower = session.build.towerAt(5, 2);
    const cap = session.economy.powerCap;
    session.applyIntegrity(-20, 'test');
    return expect(
      tower !== undefined &&
        session.economy.powerCap === cap - 4 &&
        session.build.towerAt(5, 2)?.powered === false &&
        combat.isTowerPowered(tower.towerId) === false &&
        session.economy.powerUsed === 4 &&
        !session.build.check('mg_rivet', 6, 2).ok,
      `cap ${cap} -> ${session.economy.powerCap} powered=${session.build.towerAt(5, 2)?.powered} used=${session.economy.powerUsed}`,
    );
  });

  checker.check('丢区 on: integrity ≤50 opens the B sluice and re-routes the field', () => {
    const { session } = wiredSession({ zoneLoss: true });
    const before = costAt(session.world.groundField, 0, 1);
    session.applyIntegrity(-50, 'test');
    const after = costAt(session.world.groundField, 0, 1);
    // 8 − 4 − 6 would be negative; the cap floors at zero and every powered
    // tower is now dead weight (GDD §6.3-3).
    return expect(
      before === 32 && after === 21 && session.economy.powerCap === 0,
      `route ${before} -> ${after} cap=${session.economy.powerCap}`,
    );
  });

  checker.check('M1: a battered core keeps its cap, its towers and its walls', () => {
    const { session, combat } = wiredSession({ gold: 1000, unlockAll: true });
    session.commands.buildAt('tesla_coil', 5, 2); // inside zone A
    const tower = session.build.towerAt(5, 2);
    const cap = session.economy.powerCap;
    const route = costAt(session.world.groundField, 0, 1);
    session.applyIntegrity(-99, 'test');
    return expect(
      tower !== undefined &&
        session.economy.powerCap === cap &&
        session.build.towerAt(5, 2)?.powered === true &&
        combat.isTowerPowered(tower.towerId) === true &&
        costAt(session.world.groundField, 0, 1) === route &&
        session.status !== 'lost',
      `integrity=${session.economy.integrity} cap ${cap} -> ${session.economy.powerCap} route ${route} -> ${costAt(session.world.groundField, 0, 1)}`,
    );
  });

  checker.check('M1: integrity 0 still loses the run, and only that', () => {
    const { session } = wiredSession();
    let reason = '';
    let zonesAnnounced = 0;
    session.events.on('run_lost', (payload) => {
      reason = payload.reason;
    });
    session.events.on('zone_lost', () => {
      zonesAnnounced += 1;
    });
    const atFifty = session.applyIntegrity(-50, 'test');
    const stillRunning = session.status;
    session.applyIntegrity(-50, 'test');
    return expect(
      atFifty === 50 &&
        stillRunning !== 'lost' &&
        session.status === 'lost' &&
        reason === 'integrity' &&
        zonesAnnounced === 0,
      `at50=${atFifty}/${stillRunning} final=${session.status} reason=${reason || 'none'} zones=${zonesAnnounced}`,
    );
  });

  checker.check('M1: the snapshot marks a breached threshold without calling it lost', () => {
    const { session } = wiredSession();
    session.applyIntegrity(-25, 'test');
    const integrity = session.snapshot().integrity;
    const [zoneA, zoneB] = integrity.thresholds;
    return expect(
      integrity.lossEnabled === false &&
        zoneA?.breached === true &&
        zoneA?.lost === false &&
        zoneB?.breached === false,
      `lossEnabled=${integrity.lossEnabled} A=${zoneA?.breached}/${zoneA?.lost} B=${zoneB?.breached}`,
    );
  });

  checker.check('the Leviathan reaching the core ends the run outright', () => {
    const { session, combat } = wiredSession();
    session.link.spawn({
      enemy: ENEMY_IDS.leviathan,
      gateId: 'gate_north',
      wave: 20,
      ordinal: 0,
      hpMultiplier: 1,
      speedMultiplier: 4,
      bountyMultiplier: 1,
      cx: 0,
      cy: 1,
    });
    let lost = '';
    session.events.on('run_lost', (payload) => {
      lost = payload.reason;
    });
    for (let t = 0; t < 60 * 300 && session.status !== 'lost'; t += 1) session.tick(1 / 60);
    return expect(
      lost === 'leviathan' && session.status === 'lost' && combat.enemyList().length === 0,
      `reason=${lost} status=${session.status}`,
    );
  });

  checker.check('a sapper on a player bridge reverts the terrain through gameplay', () => {
    const { session, combat } = wiredSession();
    session.commands.bridge(11, 5);
    for (let t = 0; t < 60 * 4; t += 1) session.tick(1 / 60);
    const bridged = costAt(session.world.groundField, 0, 1);
    session.link.spawn({
      enemy: ENEMY_IDS.sapperCrab,
      gateId: 'gate_north',
      wave: 7,
      ordinal: 0,
      hpMultiplier: 1,
      speedMultiplier: 1,
      bountyMultiplier: 1,
      cx: 0,
      cy: 1,
    });
    for (let t = 0; t < 60 * 120 && session.world.grid.isPlayerBridge(11, 5); t += 1) {
      session.tick(1 / 60);
    }
    void combat;
    return expect(
      bridged === 22 &&
        !session.world.grid.isPlayerBridge(11, 5) &&
        session.world.grid.terrainAt(11, 5) === 'trench' &&
        costAt(session.world.groundField, 0, 1) === 32,
      `bridged=${bridged} terrain=${session.world.grid.terrainAt(11, 5)} after=${costAt(session.world.groundField, 0, 1)}`,
    );
  });

  checker.check('a wave clears only once the field is empty, then pays out', () => {
    const { session, combat } = wiredSession();
    session.startWave();
    for (let t = 0; t < 60 * 300 && !session.world.waves.spawningComplete; t += 1) {
      session.tick(1 / 60);
    }
    const phaseWhileAlive: string = session.world.waves.state;
    const stillRunning = phaseWhileAlive === 'clearing' && session.link.liveEnemies > 0;
    const gold = session.economy.gold;
    combat.killAll();
    session.tick(1 / 60);
    const phaseAfterWipe: string = session.world.waves.state;
    return expect(
      stillRunning &&
        phaseAfterWipe === 'preparing' &&
        session.economy.gold >= gold + 5 &&
        session.status === 'preparing',
      `running=${stillRunning} state=${phaseAfterWipe} gold ${gold} -> ${session.economy.gold}`,
    );
  });

  checker.check('five cleared waves charge 主控过载 once (GDD §9)', () => {
    const wired = wiredSession({ integrity: 100000 });
    for (let wave = 0; wave < 5; wave += 1) playWave(wired);
    const charges = wired.session.economy.ultimateCharges;
    const fired = wired.session.commands.ultimate();
    return expect(
      charges === 1 && fired.ok && wired.combat.ultimatesFired === 1 && wired.session.economy.ultimateCharges === 0,
      `charges=${charges} fired=${fired.status} combat=${wired.combat.ultimatesFired}`,
    );
  });

  checker.check('wave 10 opens the second breach and spawns from both gates', () => {
    const wired = wiredSession({ integrity: 100000 });
    const gates = new Map<number, Set<string>>();
    const cells = new Set<string>();
    wired.session.events.on('wave_spawn', (request) => {
      const set = gates.get(request.wave) ?? new Set<string>();
      set.add(request.gateId);
      gates.set(request.wave, set);
      if (request.gateId === 'gate_south') cells.add(`${request.cx},${request.cy}`);
    });
    for (let wave = 0; wave < 10; wave += 1) playWave(wired);
    const nine = gates.get(9) ?? new Set<string>();
    const ten = gates.get(10) ?? new Set<string>();
    return expect(
      nine.size === 1 &&
        ten.size === 2 &&
        ten.has('gate_south') &&
        cells.size === 1 &&
        cells.has('0,10') &&
        wired.session.world.grid.gate('gate_south')?.open === true,
      `w9=${[...nine].join('|')} w10=${[...ten].join('|')} southCells=${[...cells].join('|')}`,
    );
  });

  checker.check('both breaches can still reach the core once wave 10 opens', () => {
    const wired = wiredSession({ integrity: 100000 });
    for (let wave = 0; wave < 10; wave += 1) playWave(wired);
    const field = wired.session.world.groundField;
    const north = wired.session.world.gateCell('gate_north') as CellCoord;
    const south = wired.session.world.gateCell('gate_south') as CellCoord;
    return expect(
      isReachable(field, north.cx, north.cy) && isReachable(field, south.cx, south.cy),
      `north=${costAt(field, north.cx, north.cy)} south=${costAt(field, south.cx, south.cy)}`,
    );
  });

  checker.check('the HUD snapshot reports the wired state (GDD §14.1)', () => {
    const { session } = wiredSession();
    session.commands.armDig();
    const snapshot = session.snapshot();
    const mg = snapshot.build.find((item) => item.defId === 'mg_rivet');
    const tesla = snapshot.build.find((item) => item.defId === 'tesla_coil');
    return expect(
      snapshot.gold === 220 &&
        snapshot.power.cap === 8 &&
        snapshot.integrity.value === 100 &&
        snapshot.integrity.thresholds.length === 2 &&
        snapshot.engineering.armed === 'dig' &&
        snapshot.engineering.digLeft === 3 &&
        mg?.unlocked === true &&
        tesla?.unlocked === false &&
        snapshot.wave.total === 20,
      `gold=${snapshot.gold} armed=${snapshot.engineering.armed} mg=${mg?.unlocked} tesla=${tesla?.unlocked}`,
    );
  });

  // -- authored data under data/ --------------------------------------------
  //
  // These check the *authored* map against the pathing rules rather than this
  // module's own greybox. A failure here is design feedback for the data track,
  // not necessarily a bug in the gameplay code.

  checker.check('data/maps/map1.json imports into a valid MapDef', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    return expect(
      map.cols === 20 && map.rows === 12 && map.gates.length === 3 && (map.zones?.length ?? 0) === 2,
      `cols=${map.cols} gates=${map.gates.length} zones=${map.zones?.length}`,
    );
  });

  checker.check('authored map: every live gate reaches the core', () => {
    const grid = new Grid(importMapDefJson(map1Json as unknown as MapJson));
    const report = checkConnectivity(grid);
    return expect(report.ok, `blocked: ${report.blockedGates.join(', ')}`);
  });

  checker.check('authored map: the wave-5 breach opens a side gate that can path', () => {
    const grid = new Grid(importMapDefJson(map1Json as unknown as MapJson));
    const sealed = grid.isWalkable(0, 5);
    grid.openBarriersForWave(5);
    const field = computeFlowField(grid, grid.coreCells);
    return expect(
      !sealed && grid.isWalkable(0, 5) && isReachable(field, 0, 5),
      `sealedBefore=${!sealed} walkableAfter=${grid.isWalkable(0, 5)}`,
    );
  });

  checker.check('authored map: the side route really is a short-cut worth digging', () => {
    const grid = new Grid(importMapDefJson(map1Json as unknown as MapJson));
    const before = costAt(computeFlowField(grid, grid.coreCells), 0, 2);
    grid.openBarriersForWave(5);
    const after = costAt(computeFlowField(grid, grid.coreCells), 0, 2);
    return expect(after < before, `main gate route: ${before} steps → ${after} after the breach`);
  });

  checker.check('authored map: the recommended free dig at (5,5) is legal once open', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const grid = new Grid(map);
    const engineering = new EngineeringSystem({ grid });
    const beforeBreach = engineering.checkDig(5, 5);
    grid.openBarriersForWave(5);
    const afterBreach = engineering.checkDig(5, 5);
    return expect(
      !beforeBreach.ok && afterBreach.ok,
      `before=${beforeBreach.reason} after=${afterBreach.reason ?? 'ok'}`,
    );
  });

  checker.check('authored map: the M1 丢区 gate is read from the table, not hard-coded', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const asAuthored = new GameplayWorld({ map });
    const asM2 = new GameplayWorld({ map, milestone: 'M2' });
    // Flipping the JSON switch has to flip the runtime (INTEGRATION.md §4.1-5).
    const flipped = new GameplayWorld({ map: { ...map, zoneLossByMilestone: { M1: true } } });
    return expect(
      map.zoneLossByMilestone?.M1 === false &&
        (map.zones ?? []).every((zone) => zone.activeFromMilestone === 'M2') &&
        !asAuthored.zoneLossEnabled &&
        asM2.zoneLossEnabled &&
        flipped.zoneLossEnabled,
      `gate=${JSON.stringify(map.zoneLossByMilestone)} m1=${asAuthored.zoneLossEnabled} m2=${asM2.zoneLossEnabled} flipped=${flipped.zoneLossEnabled}`,
    );
  });

  checker.check('丢区 on: losing zone B opens the authored floodgate short-cut', () => {
    // The authored zones carry `active_from_milestone: "M2"`, so this needs the
    // milestone rather than the raw switch.
    const world = new GameplayWorld({
      map: importMapDefJson(map1Json as unknown as MapJson),
      milestone: 'M2',
    });
    const before = costAt(world.groundField, 0, 2);
    world.applyIntegrity(50);
    const after = costAt(world.groundField, 0, 2);
    return expect(
      after < before && world.grid.terrainAt(13, 7) === 'path',
      `before=${before} after=${after} gate=${world.grid.terrainAt(13, 7)}`,
    );
  });

  // 挖沟教学 (GDD §11 波 5). Before the breach the authored map has no dig worth
  // teaching on: (8,2)/(9,2) are the only road gate_1 has, and cutting one seals
  // the gate. The lesson only exists once the side route is open, so these check
  // that starting wave 5 opens it and that the free charge arrives with it.

  checker.check('挖沟教学: starting wave 5 opens the breach the lesson needs', () => {
    const session = authoredSession();
    const sealedBefore = !session.world.grid.isWalkable(0, 5);
    const before = digTargetsOf(session);
    playAuthoredWaves(session, 5);
    const after = digTargetsOf(session);
    const teaches = ['5,5', '8,2'].every((cell) => after.includes(cell));
    return expect(
      sealedBefore && !before.includes('5,5') && teaches,
      `sealed=${sealedBefore} before=[${before.join(' ')}] after=[${after.join(' ')}]`,
    );
  });

  checker.check('挖沟教学: the wave-5 charge is free and points at (5,5)', () => {
    const session = authoredSession();
    playAuthoredWaves(session, 5);
    const before = session.snapshot();
    const gold = session.economy.gold;
    const hint = before.engineering.recommended;
    const dug = session.commands.dig(hint?.cx ?? -1, hint?.cy ?? -1);
    const after = session.snapshot();
    return expect(
      hint?.cx === 5 &&
        hint.cy === 5 &&
        before.engineering.digCost === 0 &&
        before.engineering.freeDig === 1 &&
        dug.ok &&
        session.economy.gold === gold &&
        // The three paid charges the map grants are all still there.
        after.engineering.digLeft === 3 &&
        after.engineering.digCost === 50 &&
        after.engineering.recommended === null,
      `hint=${hint ? `${hint.cx},${hint.cy}` : 'none'} dug=${dug.ok}/${dug.message} gold ${gold} -> ${session.economy.gold} left=${after.engineering.digLeft}`,
    );
  });

  checker.check('挖沟教学: the taught dig puts the enemies back on the long road', () => {
    const session = authoredSession();
    playAuthoredWaves(session, 5);
    const world = session.world;
    const shortcut = costAt(world.groundField, 0, 5);
    world.engineering.beginDig(5, 5);
    settle(world);
    const closed = costAt(world.groundField, 0, 5);
    return expect(
      closed > shortcut && world.grid.terrainAt(5, 5) === 'trench',
      `side route ${shortcut} -> ${closed} steps, (5,5)=${world.grid.terrainAt(5, 5)}`,
    );
  });

  checker.check('authored map: the gully takes exactly the whole bridge quota', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const grid = new Grid(map);
    const engineering = new EngineeringSystem({ grid });
    const bridgeable = engineering.legalTargets('bridge');
    return expect(
      map.engineering.bridgeQuota === 2 &&
        bridgeable.length === 2 &&
        bridgeable.every((cell) => cell.cx === 7 && (cell.cy === 8 || cell.cy === 9)),
      `quota=${map.engineering.bridgeQuota} targets=${bridgeable.map((c) => `${c.cx},${c.cy}`).join(' ')}`,
    );
  });

  checker.check('data/waves.map1.json imports and normalises enemy ids', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const table = importWaveTableJson(
      wavesJson as unknown as WaveTableJson,
      map.gates.map((gate) => gate.id),
    );
    const ids = new Set(table.waves.flatMap((wave) => wave.groups.map((group) => group.enemy)));
    const unknown = [...ids].filter((id) => !(id in DEFAULT_ENEMY_WAVE_META));
    return expect(unknown.length === 0, `unrecognised enemy ids: ${unknown.join(', ')}`);
  });

  checker.check('the authored map and wave table run together end to end', () => {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const waveTable = importWaveTableJson(
      wavesJson as unknown as WaveTableJson,
      map.gates.map((gate) => gate.id),
    );
    const world = new GameplayWorld({ map, waveTable });
    let spawned = 0;
    for (let wave = 0; wave < waveTable.waves.length; wave += 1) {
      world.startWave();
      for (let t = 0; t < 300; t += 1 / 60) {
        spawned += world.tick(1 / 60).length;
        if (world.waves.spawningComplete) break;
      }
      world.waves.notifyWaveCleared();
    }
    const expected = world.plan.reduce((total, wave) => total + wave.spawns.length, 0);
    return expect(spawned === expected && spawned > 0, `spawned=${spawned} expected=${expected}`);
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
