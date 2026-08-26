/**
 * A combat stand-in for headless runs.
 *
 * `CombatPort` is what gameplay promises to talk to; this is the smallest thing
 * that keeps that promise. It moves enemies with whatever `MovementDriver` it
 * is handed, leaks them into the core, and emits the four events the link
 * listens for — enough to exercise every wire in `CombatLink` without pulling
 * the real combat module (and its reaction table, statuses and content
 * registry) into a self-check or a benchmark.
 *
 * It is deliberately *not* a simulation: nothing shoots. Tests that need
 * damage, statuses or combos should drive the real `CombatSystem`, which
 * satisfies the same port.
 */

import type { CellCoord, Seconds, Vec2 } from '../types';
import type { RoutedMovable } from '../adapters/routedMovement';
import type {
  BridgeDestroyedEvent,
  CombatContentView,
  CombatEnemyHandle,
  CombatPort,
  CombatSpawnOptions,
  CombatTowerHandle,
  EnemyKilledEvent,
  EnemyLeakedEvent,
  EnemySpawnedEvent,
  TowerDefView,
} from './combatPort';

export interface StubEnemyDef {
  speed: number;
  hp: number;
  bounty: number;
  integrityDamage: number;
  goldStolen: number;
  lossOnLeak?: boolean;
  /** Blows up a player bridge on contact, like the 拆迁蟹 (GDD §8.1). */
  destroysBridges?: boolean;
}

export const STUB_ENEMY_DEFAULT: StubEnemyDef = {
  speed: 1,
  hp: 30,
  bounty: 5,
  integrityDamage: 2,
  goldStolen: 10,
};

/**
 * Shapes only — the numbers mirror GDD §7.1 so the self-check reads like the
 * real economy. The authoritative table is `data/towers.json`.
 */
export const STUB_TOWERS: readonly TowerDefView[] = [
  {
    id: 'mg_rivet',
    displayName: '铆钉机枪',
    cost: 50,
    powerCost: 0,
    category: 'tower',
    attack: { kind: 'projectile', targetsAir: true },
    ui: { icon: 'tower_mg', unlockWave: 1 },
  },
  {
    id: 'tesla_coil',
    displayName: '特斯拉线圈',
    cost: 200,
    powerCost: 4,
    category: 'tower',
    attack: { kind: 'chain', targetsAir: true },
    ui: { icon: 'tower_tesla', unlockWave: 8 },
  },
  {
    id: 'capacitor_station',
    displayName: '电容站',
    cost: 160,
    powerCost: 0,
    category: 'tower',
    attack: { kind: 'none' },
    building: { batteryCapBonus: 30, batteryChargeMul: 1.5 },
    activation: { id: 'capacitor_overload', batteryCost: 20 },
    ui: { icon: 'tower_capacitor', unlockWave: 6 },
  },
  {
    id: 'generator',
    displayName: '发电机',
    cost: 100,
    powerCost: 0,
    category: 'building',
    attack: { kind: 'none' },
    building: { powerCapBonus: 6, powerCapBonusOnFissure: 8 },
    ui: { icon: 'building_generator', unlockWave: 3 },
  },
];

type Listener<T> = (payload: T) => void;

class StubBus {
  readonly spawned = new Set<Listener<EnemySpawnedEvent>>();
  readonly killed = new Set<Listener<EnemyKilledEvent>>();
  readonly leaked = new Set<Listener<EnemyLeakedEvent>>();
  readonly bridges = new Set<Listener<BridgeDestroyedEvent>>();

  on(name: 'enemy_spawned', listener: Listener<EnemySpawnedEvent>): () => void;
  on(name: 'enemy_killed', listener: Listener<EnemyKilledEvent>): () => void;
  on(name: 'enemy_leaked', listener: Listener<EnemyLeakedEvent>): () => void;
  on(name: 'bridge_destroyed', listener: Listener<BridgeDestroyedEvent>): () => void;
  on(name: string, listener: Listener<never>): () => void {
    const set = this.setFor(name);
    set.add(listener as never);
    return () => set.delete(listener as never);
  }

  private setFor(name: string): Set<never> {
    switch (name) {
      case 'enemy_spawned':
        return this.spawned as unknown as Set<never>;
      case 'enemy_killed':
        return this.killed as unknown as Set<never>;
      case 'enemy_leaked':
        return this.leaked as unknown as Set<never>;
      default:
        return this.bridges as unknown as Set<never>;
    }
  }
}

export class StubEnemy implements RoutedMovable {
  readonly position: Vec2;
  readonly facing: Vec2 = { x: 0, y: 0 };
  path: Vec2[] = [];
  pathIndex = 0;
  pathProgress = 0;
  reachedGoal = false;
  alive = true;
  hp: number;
  lastCell: CellCoord;

  constructor(
    readonly id: number,
    readonly defId: string,
    readonly def: StubEnemyDef,
    options: CombatSpawnOptions,
  ) {
    this.position = { ...options.position };
    this.hp = def.hp * (options.hpMultiplier ?? 1);
    if (options.path) this.path = options.path.map((point) => ({ ...point }));
    this.lastCell = { cx: Math.floor(this.position.x), cy: Math.floor(this.position.y) };
  }
}

export interface StubCombatOptions {
  movement: { advance(enemy: RoutedMovable, dt: Seconds, speed: number): void };
  /** Used to spot player bridges under a demolisher's feet. */
  terrain?: { isBridge(cx: number, cy: number): boolean };
  towers?: readonly TowerDefView[];
  enemies?: Readonly<Record<string, Partial<StubEnemyDef>>>;
}

export class StubCombat implements CombatPort {
  readonly bus = new StubBus();
  readonly content: CombatContentView;

  private readonly movement: StubCombatOptions['movement'];
  private readonly terrain: StubCombatOptions['terrain'];
  private readonly enemyDefs: Readonly<Record<string, Partial<StubEnemyDef>>>;
  private readonly towerDefs = new Map<string, TowerDefView>();
  private readonly enemies = new Map<number, StubEnemy>();
  private readonly towers = new Map<number, { defId: string; cell: CellCoord; powered: boolean }>();
  private nextId = 1;

  /** Set by `activateMasterOverload`, so a test can assert it was reached. */
  ultimatesFired = 0;
  floodwayWashes = 0;

  constructor(options: StubCombatOptions) {
    this.movement = options.movement;
    this.terrain = options.terrain;
    this.enemyDefs = options.enemies ?? {};
    for (const def of options.towers ?? STUB_TOWERS) this.towerDefs.set(def.id, def);
    this.content = {
      tower: (id: string): TowerDefView => {
        const def = this.towerDefs.get(id);
        if (!def) throw new Error(`[stub-combat] unknown tower id: ${id}`);
        return def;
      },
      allTowers: (): TowerDefView[] => [...this.towerDefs.values()],
    };
  }

  enemyList(): StubEnemy[] {
    return [...this.enemies.values()];
  }

  towerList(): { defId: string; cell: CellCoord; powered: boolean }[] {
    return [...this.towers.values()];
  }

  isTowerPowered(towerId: number): boolean | undefined {
    return this.towers.get(towerId)?.powered;
  }

  // -- CombatPort ------------------------------------------------------------

  spawnEnemy(defId: string, options: CombatSpawnOptions): CombatEnemyHandle {
    const def: StubEnemyDef = { ...STUB_ENEMY_DEFAULT, ...(this.enemyDefs[defId] ?? {}) };
    const enemy = new StubEnemy(this.nextId++, defId, def, options);
    this.enemies.set(enemy.id, enemy);
    for (const listener of this.bus.spawned) {
      listener({ enemyId: enemy.id, defId, position: { ...enemy.position }, maxHp: enemy.hp });
    }
    return enemy;
  }

  buildTower(defId: string, cell: CellCoord): CombatTowerHandle {
    const id = this.nextId++;
    this.towers.set(id, { defId, cell: { ...cell }, powered: true });
    return { id };
  }

  sellTower(towerId: number): number {
    const tower = this.towers.get(towerId);
    if (!tower) return 0;
    this.towers.delete(towerId);
    return Math.floor((this.towerDefs.get(tower.defId)?.cost ?? 0) * 0.7);
  }

  upgradeTower(): boolean {
    return true;
  }

  setTowerPowered(towerId: number, powered: boolean): void {
    const tower = this.towers.get(towerId);
    if (tower) tower.powered = powered;
  }

  activateTower(): boolean {
    return true;
  }

  activateMasterOverload(): boolean {
    this.ultimatesFired += 1;
    return true;
  }

  washFloodway(): void {
    this.floodwayWashes += 1;
  }

  update(dt: Seconds): void {
    for (const enemy of [...this.enemies.values()]) {
      if (!enemy.alive) continue;
      this.movement.advance(enemy, dt, enemy.def.speed);
      this.checkCellEntry(enemy);
      if (enemy.reachedGoal) this.leak(enemy);
    }
  }

  // -- test controls ---------------------------------------------------------

  /** Kills an enemy the way a tower would, bounty and all. */
  kill(enemyId: number): boolean {
    const enemy = this.enemies.get(enemyId);
    if (!enemy) return false;
    enemy.alive = false;
    this.enemies.delete(enemyId);
    for (const listener of this.bus.killed) {
      listener({
        enemyId,
        defId: enemy.defId,
        bounty: enemy.def.bounty,
        position: { ...enemy.position },
      });
    }
    return true;
  }

  killAll(): number {
    const ids = [...this.enemies.keys()];
    for (const id of ids) this.kill(id);
    return ids.length;
  }

  private checkCellEntry(enemy: StubEnemy): void {
    const cx = Math.floor(enemy.position.x);
    const cy = Math.floor(enemy.position.y);
    if (cx === enemy.lastCell.cx && cy === enemy.lastCell.cy) return;
    enemy.lastCell = { cx, cy };
    if (!enemy.def.destroysBridges || !this.terrain?.isBridge(cx, cy)) return;
    for (const listener of this.bus.bridges) listener({ cx, cy, enemyId: enemy.id });
  }

  private leak(enemy: StubEnemy): void {
    enemy.alive = false;
    this.enemies.delete(enemy.id);
    for (const listener of this.bus.leaked) {
      listener({
        enemyId: enemy.id,
        defId: enemy.defId,
        integrityDamage: enemy.def.integrityDamage,
        goldStolen: enemy.def.goldStolen,
        lossOnLeak: enemy.def.lossOnLeak ?? false,
      });
    }
  }
}
