import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CombatSystem,
  ENEMY_DEFS,
  OpenFieldTerrain,
  REACTION_TABLE,
  runIceShatterProbe,
} from '../src/combat/index.ts';
import { runGameplaySelfCheck } from '../src/gameplay/index.ts';

const gameplayReport = runGameplaySelfCheck();

for (const result of gameplayReport.results) {
  test(`gameplay self-check: ${result.name}`, () => {
    assert.equal(result.ok, true, result.detail);
  });
}

test('gameplay self-check reports no aggregate failures', () => {
  assert.equal(gameplayReport.results.length, 73);
  assert.equal(gameplayReport.passed, gameplayReport.results.length);
  assert.equal(gameplayReport.failed, 0);
  assert.equal(gameplayReport.ok, true);
});

test('OpenFieldTerrain provides deterministic headless terrain', () => {
  const terrain = new OpenFieldTerrain(3, 2, new Set(['1,0']));

  assert.equal(terrain.isInside(0, 0), true);
  assert.equal(terrain.isInside(2, 1), true);
  assert.equal(terrain.isInside(3, 1), false);
  assert.equal(terrain.isRoad(2, 1), true);
  assert.equal(terrain.isBuildable(2, 1), true);
  assert.equal(terrain.isWater(1, 0), true);
  assert.equal(terrain.isWater(0, 0), false);
  assert.equal(terrain.isBridge(), false);
  assert.equal(terrain.isPowered(), true);
  assert.equal(terrain.isFloodway(), false);
});

test('the production reaction table contains the complete ice-shatter rule', () => {
  const shatter = REACTION_TABLE.find((row) => row.id === 'ice_shatter');

  assert.ok(shatter);
  assert.equal(shatter.trigger, 'on_hit');
  assert.equal(shatter.combo, 'shatter');
  assert.deepEqual(shatter.when, {
    kind: 'allOf',
    of: [
      { kind: 'targetHasStatus', status: 'frozen' },
      { kind: 'damageAtLeast', amount: 40, of: 'base' },
      { kind: 'sourceLacksTag', tag: 'splash' },
      { kind: 'sourceLacksTag', tag: 'dot' },
      { kind: 'sourceLacksTag', tag: 'chain' },
    ],
  });
  assert.deepEqual(shatter.effects, [
    { kind: 'tagCombo', combo: 'shatter', alsoTag: 'shatter' },
    { kind: 'multiplyDamage', factor: 2.5 },
    { kind: 'ignoreArmor' },
    {
      kind: 'splash',
      radius: 1,
      factor: 1,
      ignoreArmor: true,
      damageType: 'cold',
      tags: ['ice', 'splash'],
      canTriggerReactions: false,
    },
    { kind: 'removeStatus', status: 'frozen', reason: 'consumed' },
  ]);
});

test('runIceShatterProbe executes freeze, shatter, splash, and immunity end to end', () => {
  const report = runIceShatterProbe();

  assert.equal(report.peakChillStacks, 3);
  assert.ok(report.frozenAt !== undefined);
  assert.ok(report.shatteredAt !== undefined);
  assert.ok(report.shatteredAt > report.frozenAt);
  assert.equal(report.shatterDamage, 112.5);
  assert.equal(report.ignoredArmor, true);
  assert.equal(report.splashKilled, true);
  assert.equal(report.hitstopMs, 60);
  assert.equal(report.tip, 'tip_shatter');
  assert.equal(report.chillBlockedAfterFreeze, true);
  assert.ok(report.rows.includes('chill_to_freeze'));
  assert.ok(report.rows.includes('ice_shatter'));
});

test('production combat enforces the 40-damage ice-shatter threshold', () => {
  const below = new CombatSystem({ terrain: new OpenFieldTerrain() });
  const belowTarget = below.spawnEnemy('armored_hauler', {
    position: { x: 5.5, y: 5.5 },
  });
  below.applyStatus(belowTarget, 'frozen', {}, { kind: 'environment' });
  const belowResult = below.applyDamage({
    target: belowTarget,
    amount: 39,
    damageType: 'physical',
    tags: [],
    source: { kind: 'environment' },
  });

  assert.equal(belowResult.applied, 34);
  assert.equal(belowResult.reactions.includes('ice_shatter'), false);
  assert.equal(belowTarget.statuses.has('frozen'), true);

  const exact = new CombatSystem({ terrain: new OpenFieldTerrain() });
  const exactTarget = exact.spawnEnemy('armored_hauler', {
    position: { x: 5.5, y: 5.5 },
  });
  exact.applyStatus(exactTarget, 'frozen', {}, { kind: 'environment' });
  const exactResult = exact.applyDamage({
    target: exactTarget,
    amount: 40,
    damageType: 'physical',
    tags: [],
    source: { kind: 'environment' },
  });

  assert.equal(exactResult.applied, 100);
  assert.equal(exactResult.absorbed, 0);
  assert.ok(exactResult.reactions.includes('ice_shatter'));
  assert.equal(exactTarget.statuses.has('frozen'), false);
  assert.equal(exactTarget.statuses.has('chill_immune'), true);
});

test('production statuses keep wet and oil in one coating slot', () => {
  const system = new CombatSystem({ terrain: new OpenFieldTerrain() });
  const target = system.spawnEnemy('scavenger_bug', {
    position: { x: 1.5, y: 1.5 },
  });

  system.applyStatus(target, 'wet', { duration: 6 }, { kind: 'environment' });
  system.applyStatus(target, 'oil', { duration: 12 }, { kind: 'environment' });
  assert.equal(target.statuses.has('wet'), false);
  assert.equal(target.statuses.has('oil'), true);
  assert.equal(target.statuses.get('oil')?.remaining, 12);

  system.applyStatus(target, 'wet', { duration: 6 }, { kind: 'environment' });
  assert.equal(target.statuses.has('oil'), false);
  assert.equal(target.statuses.has('wet'), true);
  assert.equal(target.statuses.get('wet')?.remaining, 6);
});

test('every production enemy emits its configured leak payload', () => {
  const expected = new Map<string, [integrityDamage: number, goldStolen: number, lossOnLeak: boolean]>([
    ['scavenger_bug', [2, 10, false]],
    ['swift_rat', [2, 10, false]],
    ['armored_truck', [4, 10, false]],
    ['scout_wasp', [4, 10, false]],
    ['demo_sapper', [4, 10, false]],
    ['repair_drone', [2, 10, false]],
    ['repair_mothership', [15, 10, false]],
    ['leviathan', [100, 0, true]],
  ]);
  const system = new CombatSystem({
    terrain: new OpenFieldTerrain(),
    movement: {
      advance(enemy) {
        enemy.reachedGoal = true;
      },
    },
  });
  const leaks: Array<{
    defId: string;
    integrityDamage: number;
    goldStolen: number;
    lossOnLeak: boolean;
  }> = [];
  system.bus.on('enemy_leaked', (event) => leaks.push(event));

  for (const def of ENEMY_DEFS) {
    system.spawnEnemy(def.id, { position: { x: 1.5, y: 1.5 } });
  }
  system.update(1 / 60);

  assert.equal(leaks.length, expected.size);
  for (const leak of leaks) {
    assert.deepEqual(
      [leak.integrityDamage, leak.goldStolen, leak.lossOnLeak],
      expected.get(leak.defId),
      leak.defId,
    );
  }
});
