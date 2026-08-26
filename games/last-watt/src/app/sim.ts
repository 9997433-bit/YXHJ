/**
 * The simulation aggregate root.
 *
 * Owns nothing itself: it wires `src/gameplay` (board, pathing, engineering,
 * waves), `src/combat` (towers, enemies, statuses, reactions) and `Economy`
 * together, applies player commands on tick boundaries, and re-publishes the
 * few facts that cross module lines (a leak costs integrity, a kill pays a
 * bounty, a sapper's charge edits terrain).
 *
 * Pure TypeScript on purpose — no `three`, no DOM — so it runs headless in
 * tests and benches. Everything visual listens to `combat.bus` /
 * `world.events` / `notices`, never the other way round.
 *
 * Tick order follows ARCHITECTURE §5.3 (adapted to the 60 Hz ruling of Round 2).
 */

import map1Json from '../../data/maps/map1.json';
import wavesJson from '../../data/waves.map1.json';

import {
  CombatSystem,
  PolylineMovement,
  type Enemy,
  type MovementDriver,
} from '../combat';
import {
  GameplayWorld,
  Signal,
  cellCenter,
  importMapDefJson,
  importWaveTableJson,
  type CellCoord,
  type MapJson,
  type Seconds,
  type WaveTableJson,
} from '../gameplay';

import { ECONOMY_DEFAULTS } from './config';
import { Economy } from './economy';

export type SimPhase = 'deploy' | 'wave' | 'interwave' | 'defeat' | 'victory';

export type Command =
  | { kind: 'build'; defId: string; cell: CellCoord }
  | { kind: 'sell'; towerId: number }
  | { kind: 'dig'; cell: CellCoord }
  | { kind: 'bridge'; cell: CellCoord }
  | { kind: 'start_wave'; early?: boolean };

export interface PlacementCheck {
  ok: boolean;
  /** Empty when `ok`; otherwise a player-facing Chinese reason. */
  reason: string;
}

/** App-level notices: things no single module owns, but the HUD must hear. */
export interface SimNoticeMap {
  rejected: { command: Command; reason: string };
  gold_changed: { gold: number; delta: number; reason: string };
  integrity_changed: { integrity: number; delta: number };
  wave_result: { wave: number; reward: number; earlyBonus: number };
  phase_changed: { phase: SimPhase };
}

export type SimNotice = {
  [K in keyof SimNoticeMap]: { kind: K } & SimNoticeMap[K];
}[keyof SimNoticeMap];

/**
 * Ground units steer on the flow field so a mid-wave dig re-routes them;
 * flyers walk the straight line baked at spawn (GDD §5.1).
 */
class HybridMovement implements MovementDriver {
  private readonly air = new PolylineMovement();

  constructor(private readonly ground: MovementDriver) {}

  advance(enemy: Enemy, dt: Seconds, speed: number): void {
    if (enemy.def.isFlying) this.air.advance(enemy, dt, speed);
    else this.ground.advance(enemy, dt, speed);
  }
}

export class Sim {
  readonly world: GameplayWorld;
  readonly combat: CombatSystem;
  readonly economy = new Economy();
  readonly notices = new Signal<SimNotice>();

  phase: SimPhase = 'deploy';
  /** Seconds of simulated time, hitstop excluded. */
  time: Seconds = 0;

  private readonly queue: Command[] = [];
  private readonly bountyMultipliers = new Map<number, number>();
  private readonly poweredZoneVersion = { value: -1 };

  constructor() {
    const map = importMapDefJson(map1Json as unknown as MapJson);
    const waveTable = importWaveTableJson(
      wavesJson as unknown as WaveTableJson,
      map.gates.map((gate) => gate.id),
    );

    this.world = new GameplayWorld({
      map,
      waveTable,
      getGold: () => this.economy.gold,
    });
    this.combat = new CombatSystem({
      terrain: this.world.terrain,
      movement: new HybridMovement(this.world.movement),
      power: this.economy,
    });

    this.bindGameplay();
    this.bindCombat();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  get waveNumber(): number {
    return this.world.waves.waveNumber;
  }

  get totalWaves(): number {
    return this.world.waves.totalWaves;
  }

  get canStartWave(): boolean {
    return this.world.waves.state === 'preparing' && this.phase !== 'defeat';
  }

  get liveEnemies(): number {
    return this.combat.enemyList().length;
  }

  towerDef(defId: string) {
    return this.combat.content.tower(defId);
  }

  /** Can this blueprint go on this cell right now, and if not, why not? */
  checkPlacement(defId: string, cell: CellCoord): PlacementCheck {
    const def = this.combat.content.tower(defId);
    if (!this.world.grid.isInside(cell.cx, cell.cy)) return { ok: false, reason: '超出场地' };
    if (!this.world.grid.isBuildable(cell.cx, cell.cy)) {
      return { ok: false, reason: this.world.grid.isOccupied(cell.cx, cell.cy) ? '该格已被占用' : '只能建在地基上' };
    }
    if (!this.economy.canAfford(def.cost)) return { ok: false, reason: `金币不足（需 ${def.cost}）` };
    if (!this.economy.hasSupplyFor(def.powerCost)) {
      const short = this.economy.powerUsed + def.powerCost - this.economy.powerCap;
      return { ok: false, reason: `供电不足，还差 ${short} 点` };
    }
    return { ok: true, reason: '' };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  enqueue(command: Command): void {
    this.queue.push(command);
  }

  private applyCommand(command: Command): void {
    switch (command.kind) {
      case 'build':
        this.build(command);
        return;
      case 'sell':
        this.sell(command.towerId);
        return;
      case 'dig':
      case 'bridge':
        this.engineer(command);
        return;
      case 'start_wave':
        this.startWave(command.early ?? false);
        return;
    }
  }

  private reject(command: Command, reason: string): void {
    this.notices.emit({ kind: 'rejected', command, reason });
  }

  private build(command: Extract<Command, { kind: 'build' }>): void {
    const check = this.checkPlacement(command.defId, command.cell);
    if (!check.ok) {
      const def = this.combat.content.tower(command.defId);
      if (!this.economy.hasSupplyFor(def.powerCost)) this.economy.flagDeficit(def.powerCost);
      this.reject(command, check.reason);
      return;
    }

    const def = this.combat.content.tower(command.defId);
    this.spend(def.cost, `build:${def.id}`);
    this.combat.buildTower(def.id, command.cell);
    this.world.grid.setOccupied(command.cell.cx, command.cell.cy, true);
    this.recomputePower();
  }

  private sell(towerId: number): void {
    const tower = this.combat.getTower(towerId);
    if (!tower) return;
    const cell = { cx: tower.cell.cx, cy: tower.cell.cy };
    const refund = this.combat.sellTower(towerId);
    this.world.grid.setOccupied(cell.cx, cell.cy, false);
    this.recomputePower();
    if (refund > 0) this.earn(refund, 'sell');
  }

  private engineer(command: Extract<Command, { kind: 'dig' | 'bridge' }>): void {
    const result = this.world.engineering.begin(command.kind, command.cell.cx, command.cell.cy);
    if (!result.ok) this.reject(command, result.message);
  }

  private startWave(early: boolean): void {
    if (!this.canStartWave) return;
    const next = this.world.waves.nextWave;
    if (!next) return;

    // Scripted terrain beats (map 1 wave 5 blows the side wall open) run before
    // the gates sync, so the new spawn cell is walkable on the very first tick.
    for (const barrier of this.world.grid.openBarriersForWave(next.wave)) {
      this.world.events.emit('barrier_opened', {
        barrierId: barrier.id,
        cells: barrier.cells.map(({ cx, cy }) => ({ cx, cy })),
      });
      this.world.events.emit('terrain_changed', {
        cells: barrier.cells.map(({ cx, cy }) => ({ cx, cy })),
        reason: 'scripted_breach',
      });
    }

    if (this.world.startWave({ early })) this.setPhase('wave');
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  tick(dt: Seconds): void {
    if (dt <= 0 || this.phase === 'defeat' || this.phase === 'victory') return;
    this.time += dt;

    // 1. commands  2. terrain timers + spawn schedule  3. combat  4. economy
    while (this.queue.length > 0) this.applyCommand(this.queue.shift() as Command);
    this.world.tick(dt);
    this.combat.update(dt);
    this.economy.chargeBattery(dt);

    this.syncTowerPower();
    this.checkWaveCleared();
  }

  private checkWaveCleared(): void {
    if (!this.world.waves.spawningComplete) return;
    if (this.combat.enemyList().length > 0) return;
    const result = this.world.waves.notifyWaveCleared();
    if (!result) return;
    this.earn(result.total, `wave_${result.wave}`);
    this.notices.emit({
      kind: 'wave_result',
      wave: result.wave,
      reward: result.reward,
      earlyBonus: result.earlyBonus,
    });
    this.setPhase(this.world.waves.state === 'complete' ? 'victory' : 'interwave');
  }

  // -------------------------------------------------------------------------
  // Cross-module plumbing
  // -------------------------------------------------------------------------

  private bindGameplay(): void {
    this.world.events.on('wave_spawn', (request) => {
      const def = this.combat.content.enemy(request.enemy);
      const position = cellCenter(request.cx, request.cy);
      const path = def.isFlying ? this.world.flightPathFromGate(request.gateId) : [];
      const enemy = this.combat.spawnEnemy(request.enemy, {
        position,
        path,
        hpMultiplier: request.hpMultiplier,
        gateId: request.gateId,
      });
      if (request.bountyMultiplier !== 1) {
        this.bountyMultipliers.set(enemy.id, request.bountyMultiplier);
      }
    });

    // Engineering quotes the price; the wallet lives here (GDD §6.1).
    this.world.events.on('engineering_started', (job) => this.spend(job.cost, `${job.op}`));
    this.world.events.on('zone_lost', (event) => {
      this.economy.zonePenalty += event.powerPenalty;
    });
  }

  private bindCombat(): void {
    this.combat.bus.on('enemy_killed', (event) => {
      const multiplier = this.bountyMultipliers.get(event.enemyId) ?? 1;
      this.bountyMultipliers.delete(event.enemyId);
      const bounty = Math.round(event.bounty * multiplier);
      if (bounty > 0) this.earn(bounty, 'bounty');
    });

    this.combat.bus.on('enemy_leaked', (event) => {
      this.bountyMultipliers.delete(event.enemyId);
      const before = this.economy.integrity;
      const after = this.economy.damageIntegrity(event.integrityDamage);
      this.notices.emit({ kind: 'integrity_changed', integrity: after, delta: after - before });
      if (event.goldStolen > 0) this.spend(event.goldStolen, 'leak_theft');

      for (const zone of this.world.applyIntegrity(after)) void zone;
      if (after <= 0 || event.lossOnLeak) this.setPhase('defeat');
    });

    // Combat only reports the demolition; the terrain edit belongs to gameplay.
    this.combat.bus.on('bridge_destroyed', (event) => {
      this.world.destroyBridge(event.cx, event.cy, event.enemyId);
    });
  }

  /** Towers inside a lost substation zone shut down but keep drawing power. */
  private syncTowerPower(): void {
    if (this.poweredZoneVersion.value === this.world.grid.buildVersion) return;
    this.poweredZoneVersion.value = this.world.grid.buildVersion;
    for (const tower of this.combat.towerList()) {
      this.combat.setTowerPowered(tower.id, this.world.grid.isPowered(tower.cell.cx, tower.cell.cy));
    }
  }

  private recomputePower(): void {
    let used = 0;
    let generators = 0;
    let batteryBonus = 0;
    for (const tower of this.combat.towerList()) {
      used += tower.baseDef.powerCost;
      const building = tower.baseDef.building;
      if (!building) continue;
      generators += building.powerCapBonus ?? 0;
      batteryBonus += building.batteryCapBonus ?? 0;
    }
    this.economy.powerUsed = used;
    this.economy.generatorBonus = generators;
    this.economy.batteryMax = ECONOMY_DEFAULTS.batteryMax + batteryBonus;
  }

  private spend(amount: number, reason: string): void {
    if (amount <= 0) return;
    const change = this.economy.spend(amount, reason);
    this.notices.emit({ kind: 'gold_changed', ...change });
  }

  private earn(amount: number, reason: string): void {
    if (amount <= 0) return;
    const change = this.economy.earn(amount, reason);
    this.notices.emit({ kind: 'gold_changed', ...change });
  }

  private setPhase(phase: SimPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.notices.emit({ kind: 'phase_changed', phase });
  }
}
