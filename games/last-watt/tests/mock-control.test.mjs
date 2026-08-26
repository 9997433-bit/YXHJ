import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIG_COST,
  buildFlowField,
  canBuildWithPower,
  resolveReaction,
  traceFlowPath,
} from './fixtures/rules-mock.mjs';

test('legacy mock remains as a single contract control', () => {
  const field = buildFlowField([
    '#######',
    '#G...C#',
    '#######',
  ]);

  assert.equal(DIG_COST, 50);
  assert.deepEqual(traceFlowPath(field, field.gates[0]).at(-1), field.core);
  assert.equal(canBuildWithPower({ used: 6, capacity: 8, powerCost: 2 }), true);
  assert.equal(canBuildWithPower({ used: 7, capacity: 8, powerCost: 2 }), false);
  assert.deepEqual(resolveReaction(['wet', 'frozen'], { kind: 'single-hit', damage: 40 }), {
    id: 'ice-shatter',
    damage: 100,
    splashRadius: 1,
    ignoreArmor: true,
    states: ['wet'],
  });
});
