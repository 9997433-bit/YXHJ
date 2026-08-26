/**
 * Headless combat scenarios.
 *
 * `runIceShatterProbe` walks the entire GDD §7.3.1 chain — chill stacking,
 * freeze, the 40-damage threshold, 250% armour-ignoring damage, the one-cell
 * splash, and the post-freeze immunity — with no renderer, no grid module and
 * no game loop. It is the M1 acceptance check for "冰碎能爽到" reduced to
 * something a test runner or a benchmark can assert on.
 */

import { CombatSystem } from './combatSystem';
import { ENEMY_IDS, TOWER_IDS } from './data/ids';
import type { Enemy } from './entities/enemy';
import type { Tower } from './entities/tower';
import { OpenFieldTerrain } from './ports';

export interface IceShatterScenario {
  system: CombatSystem;
  /** Armoured hauler: 220 HP behind 5 flat armour, the intended shatter victim. */
  victim: Enemy;
  /** Scavenger bug parked one cell away to catch the shatter splash. */
  bystander: Enemy;
  condenser: Tower;
  hammer: Tower;
}

/**
 * Deterministic layout: the condenser can only see the hauler, and the hammer
 * can reach both. Nothing moves, so the only variable is the reaction table.
 */
export function createIceShatterScenario(): IceShatterScenario {
  const system = new CombatSystem({ terrain: new OpenFieldTerrain(20, 12) });

  const victim = system.spawnEnemy(ENEMY_IDS.armoredTruck, { position: { x: 5.5, y: 6.5 } });
  const bystander = system.spawnEnemy(ENEMY_IDS.scavengerBug, { position: { x: 6.3, y: 6.5 } });

  const condenser = system.buildTower(TOWER_IDS.condenserJet, { cx: 2, cy: 6 });
  const hammer = system.buildTower(TOWER_IDS.hydraulicBreaker, { cx: 5, cy: 5 });

  return { system, victim, bystander, condenser, hammer };
}

export interface ShatterProbeReport {
  /** Chill layers observed before the freeze converted them. */
  peakChillStacks: number;
  frozenAt?: number;
  /** Time the shatter row fired. */
  shatteredAt?: number;
  /** HP removed by the shatter hit itself. */
  shatterDamage: number;
  /** True when the shatter ignored the hauler's 5 armour. */
  ignoredArmor: boolean;
  /** Hitstop the reaction asked the VFX layer for, in milliseconds. */
  hitstopMs?: number;
  /** Tip id emitted for the one-shot combo tip bar. */
  tip?: string;
  /** Bystander killed by the one-cell splash. */
  splashKilled: boolean;
  /** Chill was refused during the post-freeze grace window. */
  chillBlockedAfterFreeze: boolean;
  /** Reaction rows that fired, in order. */
  rows: string[];
  /** Share of all damage this run attributable to the shatter combo. */
  shatterDamageShare: number;
  /** Stable VFX signals seen, in order, as `name` or `name:phase`. */
  signals: string[];
  /** Splash radius the `ice_shatter` signal advertised, in cells. */
  shatterSplashRadius?: number;
}

/** Runs the scenario for `seconds` and reports what the reaction table did. */
export function runIceShatterProbe(seconds = 6, dt = 1 / 60): ShatterProbeReport {
  const { system, victim, bystander } = createIceShatterScenario();

  const report: ShatterProbeReport = {
    peakChillStacks: 0,
    shatterDamage: 0,
    ignoredArmor: false,
    splashKilled: false,
    chillBlockedAfterFreeze: false,
    rows: [],
    shatterDamageShare: 0,
    signals: [],
  };

  system.bus.on('ice_shatter', (event) => {
    report.signals.push('ice_shatter');
    report.shatterSplashRadius = event.splashRadius;
  });
  system.bus.on('frozen', (event) => {
    report.signals.push(`frozen:${event.phase}`);
  });

  system.bus.on('status_applied', (event) => {
    if (event.status === 'chilled') report.peakChillStacks = Math.max(report.peakChillStacks, event.stacks);
    if (event.status === 'frozen' && report.frozenAt === undefined) report.frozenAt = system.time;
  });
  system.bus.on('status_blocked', (event) => {
    if (event.status === 'chilled') report.chillBlockedAfterFreeze = true;
  });
  system.bus.on('reaction_triggered', (event) => {
    report.rows.push(event.rowId);
    if (event.rowId !== 'ice_shatter') return;
    report.shatteredAt = system.time;
    if (event.impact.hitstop !== undefined) report.hitstopMs = event.impact.hitstop;
    if (event.impact.tip !== undefined) report.tip = event.impact.tip;
  });
  system.bus.on('enemy_damaged', (event) => {
    if (event.comboId !== 'shatter') return;
    if (event.enemyId === victim.id) {
      report.shatterDamage = event.amount;
      report.ignoredArmor = event.absorbedByArmor === 0;
    }
  });
  system.bus.on('enemy_killed', (event) => {
    if (event.enemyId === bystander.id && event.comboId === 'shatter') report.splashKilled = true;
  });

  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i += 1) system.update(dt);

  report.shatterDamageShare = system.stats.comboShare('shatter');
  return report;
}

export interface OverloadProbeReport {
  /** Towers the surge reached, as reported by the `overload` signal. */
  towersAffected: number;
  /** Chebyshev radius the signal advertised; 1 is the capacitor's 3x3. */
  radiusCells: number;
  /** Overload window, in seconds. */
  duration: number;
  /** Overheat that follows it, in seconds. */
  overheat: number;
  /** Time the `begin` and `end` phases were observed. */
  beganAt?: number;
  endedAt?: number;
  /** Signal phases in order, e.g. `['begin', 'end']`. */
  phases: string[];
}

/**
 * Fires a capacitor overload and watches the stable `overload` signal open and
 * close, which is the half of the §7.3.4 cycle the VFX layer has to bracket.
 */
export function runOverloadProbe(seconds = 10, dt = 1 / 60): OverloadProbeReport {
  const system = new CombatSystem({ terrain: new OpenFieldTerrain(20, 12) });
  const capacitor = system.buildTower(TOWER_IDS.capacitorStation, { cx: 5, cy: 6 });
  // Two power-drawing towers inside the 3x3 and one deliberately outside it.
  system.buildTower(TOWER_IDS.hydraulicBreaker, { cx: 4, cy: 6 });
  system.buildTower(TOWER_IDS.condenserJet, { cx: 6, cy: 7 });
  system.buildTower(TOWER_IDS.teslaCoil, { cx: 12, cy: 6 });

  const report: OverloadProbeReport = {
    towersAffected: 0,
    radiusCells: 0,
    duration: 0,
    overheat: 0,
    phases: [],
  };

  system.bus.on('overload', (event) => {
    report.phases.push(event.phase);
    if (event.phase === 'begin') {
      report.towersAffected = event.towers.length;
      report.radiusCells = event.radiusCells;
      report.duration = event.duration;
      report.overheat = event.overheat;
      report.beganAt = system.time;
    } else {
      report.endedAt = system.time;
    }
  });

  system.activateTower(capacitor.id);
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i += 1) system.update(dt);
  return report;
}
