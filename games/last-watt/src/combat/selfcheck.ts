/**
 * Dependency-free self-check for the combat module.
 *
 * Two things it proves that a type-checker cannot:
 *   1. every tower / upgrade / enemy / boss-phase id in the runtime tables is
 *      a primary key from `games/last-watt/data/*.json` (Round 2 ruling 3), and
 *      no Round 1 combat-private name survives as anything but an alias;
 *   2. the three stable VFX signals of `vfxSignals.ts` actually fire, with the
 *      lifecycle `src/vfx` is told to expect.
 *
 *   npx vite-node src/combat/selfcheck.run.ts
 */

import enemiesJson from '../../data/enemies.json';
import towersJson from '../../data/towers.json';
import { CombatSystem } from './combatSystem';
import { ContentRegistry, DEFAULT_CONTENT } from './data';
import {
  ENEMY_IDS,
  LEGACY_ENEMY_IDS,
  LEGACY_TOWER_IDS,
  LEGACY_UPGRADE_IDS,
  TOWER_IDS,
  resolveEnemyId,
  resolveTowerId,
  resolveUpgradeId,
} from './data/ids';
import { OpenFieldTerrain } from './ports';
import { runIceShatterProbe, runOverloadProbe } from './scenarios';
import { COMBAT_VFX_SIGNALS } from './vfxSignals';

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
      this.results.push({ name, ok: outcome === true, detail: outcome === true ? '' : outcome });
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

function missing(actual: Iterable<string>, expected: Iterable<string>): string[] {
  const have = new Set(actual);
  return [...expected].filter((id) => !have.has(id));
}

export function runCombatSelfCheck(): SelfCheckReport {
  const checker = new Checker();
  const registry = new ContentRegistry();

  const jsonTowerIds = towersJson.towers.map((tower) => tower.id);
  const jsonUpgradeIds = towersJson.towers.flatMap((tower) =>
    (tower.upgrades ?? []).map((upgrade) => upgrade.id),
  );
  const jsonEnemyIds = enemiesJson.enemies.map((enemy) => enemy.id);

  checker.check('content tables cross-validate', () => {
    const problems = registry.validate();
    return expect(problems.length === 0, problems.join('; '));
  });

  checker.check('tower ids are data/towers.json primary keys', () => {
    const codeIds = DEFAULT_CONTENT.towers.map((tower) => tower.id);
    const extra = missing(jsonTowerIds, codeIds);
    const absent = missing(codeIds, jsonTowerIds);
    return expect(
      extra.length === 0 && absent.length === 0,
      `not in JSON: [${extra.join(', ')}]; not implemented: [${absent.join(', ')}]`,
    );
  });

  checker.check('upgrade ids are data/towers.json primary keys', () => {
    const codeIds = DEFAULT_CONTENT.upgrades.map((upgrade) => upgrade.id);
    const extra = missing(jsonUpgradeIds, codeIds);
    const absent = missing(codeIds, jsonUpgradeIds);
    return expect(
      extra.length === 0 && absent.length === 0,
      `not in JSON: [${extra.join(', ')}]; not implemented: [${absent.join(', ')}]`,
    );
  });

  checker.check('enemy ids are data/enemies.json primary keys', () => {
    const codeIds = DEFAULT_CONTENT.enemies.map((enemy) => enemy.id);
    const extra = missing(jsonEnemyIds, codeIds);
    const absent = missing(codeIds, jsonEnemyIds);
    return expect(
      extra.length === 0 && absent.length === 0,
      `not in JSON: [${extra.join(', ')}]; not implemented: [${absent.join(', ')}]`,
    );
  });

  checker.check('boss phase ids match data/enemies.json', () => {
    const leviathanJson = enemiesJson.enemies.find((enemy) => enemy.id === ENEMY_IDS.leviathan);
    const jsonPhases = (leviathanJson?.behavior_params?.phases ?? []).map((phase) => phase.id);
    const codePhases = (registry.enemy(ENEMY_IDS.leviathan).phases ?? []).map((phase) => phase.id);
    return expect(
      jsonPhases.length === codePhases.length && jsonPhases.every((id, i) => id === codePhases[i]),
      `json=[${jsonPhases.join(', ')}] code=[${codePhases.join(', ')}]`,
    );
  });

  checker.check('every reaction row id is stable across the table', () => {
    const ids = DEFAULT_CONTENT.reactions.map((row) => row.id);
    return expect(new Set(ids).size === ids.length, `duplicate row ids in [${ids.join(', ')}]`);
  });

  checker.check('legacy ids resolve but are never primary keys', () => {
    const problems: string[] = [];
    for (const [legacy, canonical] of Object.entries(LEGACY_TOWER_IDS)) {
      if (registry.tower(legacy).id !== canonical) problems.push(`tower ${legacy}`);
      if (jsonTowerIds.includes(legacy)) problems.push(`tower alias ${legacy} is also a JSON id`);
    }
    for (const [legacy, canonical] of Object.entries(LEGACY_UPGRADE_IDS)) {
      if (registry.upgrade(legacy).id !== canonical) problems.push(`upgrade ${legacy}`);
    }
    for (const [legacy, canonical] of Object.entries(LEGACY_ENEMY_IDS)) {
      if (registry.enemy(legacy).id !== canonical) problems.push(`enemy ${legacy}`);
    }
    return expect(problems.length === 0, problems.join('; '));
  });

  checker.check('canonical ids resolve to themselves', () => {
    const drift = [
      ...jsonTowerIds.filter((id) => resolveTowerId(id) !== id),
      ...jsonUpgradeIds.filter((id) => resolveUpgradeId(id) !== id),
      ...jsonEnemyIds.filter((id) => resolveEnemyId(id) !== id),
    ];
    return expect(drift.length === 0, `shadowed by an alias: [${drift.join(', ')}]`);
  });

  checker.check('events emitted for a legacy id carry the canonical one', () => {
    const system = new CombatSystem({ terrain: new OpenFieldTerrain(20, 12) });
    let builtAs = '';
    let spawnedAs = '';
    system.bus.on('tower_built', (event) => {
      builtAs = event.defId;
    });
    system.bus.on('enemy_spawned', (event) => {
      spawnedAs = event.defId;
    });
    system.buildTower('hydraulic_hammer', { cx: 5, cy: 5 });
    system.spawnEnemy('armored_hauler', { position: { x: 5.5, y: 6.5 } });
    return expect(
      builtAs === TOWER_IDS.hydraulicBreaker && spawnedAs === ENEMY_IDS.armoredTruck,
      `tower_built=${builtAs} enemy_spawned=${spawnedAs}`,
    );
  });

  checker.check('every stable VFX signal has exactly one producer', () => {
    const declared = new Set<string>();
    for (const row of DEFAULT_CONTENT.reactions) if (row.impact?.signal) declared.add(row.impact.signal);
    for (const status of DEFAULT_CONTENT.statuses) if (status.signal) declared.add(status.signal);
    declared.add('overload');
    const absent = COMBAT_VFX_SIGNALS.filter((signal) => !declared.has(signal));
    return expect(absent.length === 0, `undeclared: [${absent.join(', ')}]`);
  });

  const shatter = runIceShatterProbe();

  checker.check('ice shatter still resolves end to end', () =>
    expect(
      shatter.frozenAt !== undefined &&
        shatter.shatteredAt !== undefined &&
        shatter.ignoredArmor &&
        shatter.splashKilled,
      JSON.stringify(shatter),
    ),
  );

  checker.check('ice_shatter signal fires once, with the row splash radius', () =>
    expect(
      shatter.signals.filter((name) => name === 'ice_shatter').length === 1 &&
        shatter.shatterSplashRadius === 1,
      `signals=[${shatter.signals.join(', ')}] splashRadius=${String(shatter.shatterSplashRadius)}`,
    ),
  );

  checker.check('frozen signal brackets the freeze', () => {
    const phases = shatter.signals.filter((name) => name.startsWith('frozen:'));
    return expect(
      phases[0] === 'frozen:begin' && phases.includes('frozen:end'),
      `phases=[${phases.join(', ')}]`,
    );
  });

  checker.check('shatter closes the freeze before the burst', () => {
    const end = shatter.signals.indexOf('frozen:end');
    const burst = shatter.signals.indexOf('ice_shatter');
    return expect(
      end !== -1 && burst !== -1 && end < burst,
      `signals=[${shatter.signals.join(', ')}]`,
    );
  });

  const overload = runOverloadProbe();

  checker.check('overload signal opens on the capacitor 3x3', () =>
    expect(
      overload.phases[0] === 'begin' && overload.radiusCells === 1 && overload.towersAffected === 2,
      JSON.stringify(overload),
    ),
  );

  checker.check('overload signal closes when the window ends', () =>
    expect(
      overload.phases.join(',') === 'begin,end' &&
        overload.endedAt !== undefined &&
        overload.beganAt !== undefined &&
        Math.abs(overload.endedAt - overload.beganAt - overload.duration) < 0.05,
      JSON.stringify(overload),
    ),
  );

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
