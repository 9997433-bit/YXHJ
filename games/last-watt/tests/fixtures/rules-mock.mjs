/**
 * Pure, dependency-free rule fixtures derived from GDD sections 5–10.
 * They deliberately do not import the game so the contract probes can run
 * before production modules exist.
 */

const TRAVERSABLE_CELLS = new Set([".", "G", "C", "P", "D"]);
const ORTHOGONAL_OFFSETS = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

function assertRectangularGrid(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows[0].length === 0) {
    throw new TypeError("grid must contain at least one cell");
  }

  const width = rows[0].length;
  if (rows.some((row) => typeof row !== "string" || row.length !== width)) {
    throw new TypeError("grid rows must be equal-length strings");
  }
}

function neighbours(row, column, height, width) {
  return ORTHOGONAL_OFFSETS.map(([rowOffset, columnOffset]) => ({
    row: row + rowOffset,
    column: column + columnOffset,
  })).filter(
    (cell) =>
      cell.row >= 0 &&
      cell.row < height &&
      cell.column >= 0 &&
      cell.column < width,
  );
}

export function buildFlowField(rows) {
  assertRectangularGrid(rows);

  const height = rows.length;
  const width = rows[0].length;
  const gates = [];
  let core = null;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (rows[row][column] === "G") {
        gates.push({ row, column });
      } else if (rows[row][column] === "C") {
        if (core !== null) {
          throw new Error("grid must contain exactly one core");
        }
        core = { row, column };
      }
    }
  }

  if (core === null) {
    throw new Error("grid must contain exactly one core");
  }

  const distances = Array.from({ length: height }, () =>
    Array(width).fill(Number.POSITIVE_INFINITY),
  );
  const queue = [core];
  let queueIndex = 0;
  distances[core.row][core.column] = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;

    for (const next of neighbours(current.row, current.column, height, width)) {
      if (!TRAVERSABLE_CELLS.has(rows[next.row][next.column])) {
        continue;
      }
      if (Number.isFinite(distances[next.row][next.column])) {
        continue;
      }

      distances[next.row][next.column] =
        distances[current.row][current.column] + 1;
      queue.push(next);
    }
  }

  return {
    core,
    gates,
    height,
    width,
    distanceAt(row, column) {
      return distances[row]?.[column] ?? Number.POSITIVE_INFINITY;
    },
    nextStepAt(row, column) {
      const currentDistance =
        distances[row]?.[column] ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(currentDistance) || currentDistance === 0) {
        return null;
      }

      return (
        neighbours(row, column, height, width).find(
          (candidate) =>
            distances[candidate.row][candidate.column] < currentDistance,
        ) ?? null
      );
    },
  };
}

export function traceFlowPath(flowField, start) {
  const path = [{ ...start }];
  const visited = new Set();
  let current = { ...start };

  while (
    current.row !== flowField.core.row ||
    current.column !== flowField.core.column
  ) {
    const key = `${current.row},${current.column}`;
    if (visited.has(key)) {
      throw new Error(`flow field loop detected at ${key}`);
    }
    visited.add(key);

    const next = flowField.nextStepAt(current.row, current.column);
    if (next === null) {
      throw new Error(`flow field dead end detected at ${key}`);
    }

    current = next;
    path.push(current);

    if (path.length > flowField.height * flowField.width) {
      throw new Error("flow path exceeded the grid size");
    }
  }

  return path;
}

export const DIG_COST = 50;

export function tryDig(
  rows,
  row,
  column,
  { coins, digsRemaining },
) {
  assertRectangularGrid(rows);

  if (
    row < 0 ||
    row >= rows.length ||
    column < 0 ||
    column >= rows[0].length
  ) {
    return { allowed: false, reason: "out-of-bounds", rows };
  }
  if (rows[row][column] !== "D") {
    return { allowed: false, reason: "not-diggable", rows };
  }
  if (digsRemaining <= 0) {
    return { allowed: false, reason: "no-digs-remaining", rows };
  }
  if (coins < DIG_COST) {
    return { allowed: false, reason: "insufficient-coins", rows };
  }

  const candidateRows = rows.slice();
  candidateRows[row] =
    candidateRows[row].slice(0, column) +
    "#" +
    candidateRows[row].slice(column + 1);

  const flowField = buildFlowField(candidateRows);
  const blocksAnyGate = flowField.gates.some(
    (gate) => !Number.isFinite(flowField.distanceAt(gate.row, gate.column)),
  );
  if (blocksAnyGate) {
    return { allowed: false, reason: "would-block-route", rows };
  }

  return {
    allowed: true,
    reason: null,
    rows: candidateRows,
    coins: coins - DIG_COST,
    digsRemaining: digsRemaining - 1,
    constructionSeconds: 3,
  };
}

export const REACTION_TABLE = Object.freeze([
  Object.freeze({
    id: "ice-shatter",
    when: Object.freeze({
      allStates: Object.freeze(["frozen"]),
      eventKind: "single-hit",
      minimumDamage: 40,
    }),
    effects: Object.freeze({
      damageMultiplier: 2.5,
      splashRadius: 1,
      ignoreArmor: true,
      clearStates: Object.freeze(["frozen"]),
    }),
  }),
]);

export function resolveReaction(states, event, table = REACTION_TABLE) {
  const reaction = table.find(
    (entry) =>
      entry.when.allStates.every((state) => states.includes(state)) &&
      entry.when.eventKind === event.kind &&
      event.damage >= entry.when.minimumDamage,
  );

  if (reaction === undefined) {
    return null;
  }

  return {
    id: reaction.id,
    damage: event.damage * reaction.effects.damageMultiplier,
    splashRadius: reaction.effects.splashRadius,
    ignoreArmor: reaction.effects.ignoreArmor,
    states: states.filter(
      (state) => !reaction.effects.clearStates.includes(state),
    ),
  };
}

export function canBuildWithPower({ used, capacity, powerCost }) {
  if ([used, capacity, powerCost].some((value) => value < 0)) {
    throw new RangeError("power values cannot be negative");
  }
  return used + powerCost <= capacity;
}

export const LEAK_RULES = Object.freeze({
  "scavenger-bug": Object.freeze({ integrityDamage: 2, coinLoss: 10 }),
  "swift-swarm": Object.freeze({ integrityDamage: 2, coinLoss: 10 }),
  "armored-hauler": Object.freeze({ integrityDamage: 4, coinLoss: 10 }),
  "scout-bee": Object.freeze({ integrityDamage: 4, coinLoss: 10 }),
  "demolition-sapper": Object.freeze({ integrityDamage: 4, coinLoss: 10 }),
  "repair-drone": Object.freeze({ integrityDamage: 2, coinLoss: 10 }),
  "repair-mothership": Object.freeze({ integrityDamage: 15, coinLoss: 10 }),
  leviathan: Object.freeze({ instantDefeat: true, coinLoss: 10 }),
});

export function applyLeak({ integrity, coins }, enemyId) {
  const rule = LEAK_RULES[enemyId];
  if (rule === undefined) {
    throw new Error(`unknown enemy: ${enemyId}`);
  }

  if (rule.instantDefeat === true) {
    return {
      integrity: 0,
      coins: Math.max(0, coins - rule.coinLoss),
      gameOver: true,
    };
  }

  const nextIntegrity = Math.max(0, integrity - rule.integrityDamage);
  return {
    integrity: nextIntegrity,
    coins: Math.max(0, coins - rule.coinLoss),
    gameOver: nextIntegrity === 0,
  };
}

const COATINGS = new Set(["wet", "oil"]);

export function applyCoating(status, coating, remainingSeconds) {
  if (!COATINGS.has(coating)) {
    throw new Error(`unknown coating: ${coating}`);
  }

  return {
    ...status,
    coating: {
      kind: coating,
      remainingSeconds,
    },
  };
}
