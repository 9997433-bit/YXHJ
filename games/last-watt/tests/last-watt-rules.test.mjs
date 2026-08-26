import assert from "node:assert/strict";
import test from "node:test";

import {
  DIG_COST,
  LEAK_RULES,
  REACTION_TABLE,
  applyCoating,
  applyLeak,
  buildFlowField,
  canBuildWithPower,
  resolveReaction,
  traceFlowPath,
  tryDig,
} from "./fixtures/rules-mock.mjs";

test("reverse-BFS flow field gives every gate a finite, loop-free path", () => {
  const grid = [
    "#########",
    "#G.....C#",
    "#.#####.#",
    "#G......#",
    "#########",
  ];
  const flowField = buildFlowField(grid);

  assert.equal(flowField.gates.length, 2);
  for (const gate of flowField.gates) {
    const path = traceFlowPath(flowField, gate);
    assert.deepEqual(path.at(-1), flowField.core);
    assert.equal(new Set(path.map(({ row, column }) => `${row},${column}`)).size, path.length);
    assert.equal(path.length - 1, flowField.distanceAt(gate.row, gate.column));

    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      assert.equal(
        flowField.distanceAt(current.row, current.column),
        flowField.distanceAt(previous.row, previous.column) - 1,
      );
    }
  }
});

test("digging a marked segment is legal when an alternate route remains", () => {
  const grid = [
    "########",
    "#GDDDDC#",
    "#PPPPPP#",
    "########",
  ];

  const result = tryDig(grid, 1, 3, { coins: 100, digsRemaining: 2 });

  assert.equal(result.allowed, true);
  assert.equal(result.rows[1][3], "#");
  assert.equal(result.coins, 100 - DIG_COST);
  assert.equal(result.digsRemaining, 1);
  assert.equal(result.constructionSeconds, 3);
  assert.equal(grid[1][3], "D", "legality checks must not mutate map data");

  const updatedFlow = buildFlowField(result.rows);
  for (const gate of updatedFlow.gates) {
    assert.doesNotThrow(() => traceFlowPath(updatedFlow, gate));
  }
});

test("digging the only route is rejected without charging resources", () => {
  const grid = [
    "########",
    "#GDDDDC#",
    "########",
  ];

  const result = tryDig(grid, 1, 3, { coins: 100, digsRemaining: 2 });

  assert.deepEqual(result, {
    allowed: false,
    reason: "would-block-route",
    rows: grid,
  });
});

test("digging requires a marked cell, one charge, and 50 coins", () => {
  const grid = [
    "########",
    "#GDDDDC#",
    "#PPPPPP#",
    "########",
  ];

  assert.equal(
    tryDig(grid, 2, 3, { coins: 100, digsRemaining: 1 }).reason,
    "not-diggable",
  );
  assert.equal(
    tryDig(grid, 1, 3, { coins: 100, digsRemaining: 0 }).reason,
    "no-digs-remaining",
  );
  assert.equal(
    tryDig(grid, 1, 3, { coins: 49, digsRemaining: 1 }).reason,
    "insufficient-coins",
  );
});

test("ice-shatter is represented by the reaction table", () => {
  assert.deepEqual(REACTION_TABLE[0], {
    id: "ice-shatter",
    when: {
      allStates: ["frozen"],
      eventKind: "single-hit",
      minimumDamage: 40,
    },
    effects: {
      damageMultiplier: 2.5,
      splashRadius: 1,
      ignoreArmor: true,
      clearStates: ["frozen"],
    },
  });
});

test("a 40+ single hit shatters frozen targets with all specified effects", () => {
  const reaction = resolveReaction(
    ["wet", "frozen"],
    { kind: "single-hit", damage: 40 },
  );

  assert.deepEqual(reaction, {
    id: "ice-shatter",
    damage: 100,
    splashRadius: 1,
    ignoreArmor: true,
    states: ["wet"],
  });
});

test("ice-shatter does not trigger below 40 damage or without frozen", () => {
  assert.equal(
    resolveReaction(["frozen"], { kind: "single-hit", damage: 39 }),
    null,
  );
  assert.equal(
    resolveReaction(["wet"], { kind: "single-hit", damage: 100 }),
    null,
  );
});

test("power validation permits the exact cap and rejects any overage", () => {
  assert.equal(
    canBuildWithPower({ used: 6, capacity: 8, powerCost: 2 }),
    true,
  );
  assert.equal(
    canBuildWithPower({ used: 7, capacity: 8, powerCost: 2 }),
    false,
  );
  assert.equal(
    canBuildWithPower({ used: 8, capacity: 8, powerCost: 0 }),
    true,
  );
});

test("every normal leaking enemy deducts its full configured integrity", () => {
  const expectedDamage = {
    "scavenger-bug": 2,
    "swift-swarm": 2,
    "armored-hauler": 4,
    "scout-bee": 4,
    "demolition-sapper": 4,
    "repair-drone": 2,
    "repair-mothership": 15,
  };

  for (const [enemyId, integrityDamage] of Object.entries(expectedDamage)) {
    assert.equal(LEAK_RULES[enemyId].integrityDamage, integrityDamage);
    assert.deepEqual(applyLeak({ integrity: 100, coins: 50 }, enemyId), {
      integrity: 100 - integrityDamage,
      coins: 40,
      gameOver: false,
    });
  }
});

test("integrity floors at zero and Leviathan reaching the core defeats instantly", () => {
  assert.deepEqual(
    applyLeak({ integrity: 3, coins: 5 }, "armored-hauler"),
    { integrity: 0, coins: 0, gameOver: true },
  );
  assert.deepEqual(
    applyLeak({ integrity: 100, coins: 50 }, "leviathan"),
    { integrity: 0, coins: 40, gameOver: true },
  );
});

test("oil replaces wet in the single coating slot", () => {
  const wet = applyCoating({ frozen: false }, "wet", 6);
  const oiled = applyCoating(wet, "oil", 12);

  assert.deepEqual(oiled, {
    frozen: false,
    coating: { kind: "oil", remainingSeconds: 12 },
  });
});

test("wet replaces oil in the single coating slot", () => {
  const oiled = applyCoating({}, "oil", 12);
  const wet = applyCoating(oiled, "wet", 6);

  assert.deepEqual(wet, {
    coating: { kind: "wet", remainingSeconds: 6 },
  });
});
