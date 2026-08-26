/**
 * The gameplay ⇄ combat handshake.
 *
 * Round 1 left four wires dangling between the two modules; this is all four of
 * them in one place, and the only file in `src/gameplay` that knows a combat
 * system exists (through `combatPort.ts`, structurally — still no cross-subtree
 * import):
 *
 *  1. **Spawns.** A `SpawnRequest` becomes a combat enemy at the right gate
 *     cell, with the map's HP column applied, ground units on the flow field
 *     and flyers on a straight line to the core (GDD §5.1, §8.3). This is what
 *     makes the wave-10 second gate mean something: two live gates, two spawn
 *     positions, two routes, one shared field.
 *  2. **Leaks → integrity → 丢区.** `enemy_leaked` costs integrity and gold,
 *     then `GameplayWorld.applyIntegrity` decides whether a substation is lost;
 *     every tower in a lost zone is shut down through `setTowerPowered` and the
 *     supply cap drops (GDD §10).
 *  3. **拆迁蟹 → destroyBridge.** Combat detects the sapper stepping on a
 *     player bridge and emits; gameplay owns the terrain edit and the re-route.
 *  4. **Bounties and the clear signal.** `WaveRunner` does not track live
 *     entities, so the link counts them — including brood spawned inside combat
 *     — and reports the field clear.
 */

import type { CellCoord, Seconds, Vec2 } from '../types';
import { cellCenter } from '../types';
import type { GameplayEvents, SpawnRequest } from '../events';
import type { GameplayWorld } from '../world';
import type { Economy } from '../economy/Economy';
import type { BuildSystem } from '../build/BuildSystem';
import { straightLine } from '../pathing/flowField';
import type { EnemyRoute } from '../adapters/routedMovement';
import { RoutedMovement } from '../adapters/routedMovement';
import type { EnemyWaveMeta } from '../waves/enemyMeta';
import { DEFAULT_ENEMY_WAVE_META, enemyMetaOf } from '../waves/enemyMeta';
import type {
  BridgeDestroyedEvent,
  CombatEnemyHandle,
  CombatPort,
  EnemyKilledEvent,
  EnemyLeakedEvent,
  EnemySpawnedEvent,
} from './combatPort';

export type DefeatReason = 'integrity' | 'leviathan';

/** Per-enemy data combat does not carry but the economy and router need. */
export interface EnemyRecord extends EnemyRoute {
  enemyId: number;
  defId: string;
  wave: number;
  gateId: string | null;
  /** Late-wave bounty decay, resolved when the wave was planned (GDD §6.1). */
  bountyMultiplier: number;
}

export interface CombatLinkOptions {
  world: GameplayWorld;
  economy: Economy;
  build: BuildSystem;
  events?: GameplayEvents;
  enemyMeta?: Readonly<Record<string, EnemyWaveMeta>>;
}

export class CombatLink {
  /** Hand this to `new CombatSystem({ movement })`. */
  readonly movement: RoutedMovement;

  private readonly world: GameplayWorld;
  private readonly economy: Economy;
  private readonly build: BuildSystem;
  private readonly events: GameplayEvents;
  private readonly enemyMeta: Readonly<Record<string, EnemyWaveMeta>>;

  private combat: CombatPort | null = null;
  private readonly unsubscribes: Array<() => void> = [];

  private readonly byId = new Map<number, EnemyRecord>();
  /** Keyed by the enemy object combat hands back, so the router needs no id. */
  private readonly byEntity = new WeakMap<object, EnemyRecord>();
  /** Set while `spawn()` is inside `combat.spawnEnemy`, to catch its event. */
  private pending: EnemyRecord | null = null;

  private defeatReason: DefeatReason | null = null;

  constructor(options: CombatLinkOptions) {
    this.world = options.world;
    this.economy = options.economy;
    this.build = options.build;
    this.events = options.events ?? options.world.events;
    this.enemyMeta = options.enemyMeta ?? DEFAULT_ENEMY_WAVE_META;
    this.movement = new RoutedMovement(
      () => this.world.groundField,
      (enemy) => this.byEntity.get(enemy),
    );
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  attach(combat: CombatPort): void {
    this.detach();
    this.combat = combat;
    this.unsubscribes.push(
      combat.bus.on('enemy_spawned', (payload) => this.onEnemySpawned(payload)),
      combat.bus.on('enemy_killed', (payload) => this.onEnemyKilled(payload)),
      combat.bus.on('enemy_leaked', (payload) => this.onEnemyLeaked(payload)),
      combat.bus.on('bridge_destroyed', (payload) => this.onBridgeDestroyed(payload)),
    );
  }

  detach(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
    this.combat = null;
  }

  get attached(): boolean {
    return this.combat !== null;
  }

  get liveEnemies(): number {
    return this.byId.size;
  }

  get defeat(): DefeatReason | null {
    return this.defeatReason;
  }

  enemyRecord(enemyId: number): EnemyRecord | undefined {
    return this.byId.get(enemyId);
  }

  reset(): void {
    this.byId.clear();
    this.pending = null;
    this.defeatReason = null;
  }

  // -------------------------------------------------------------------------
  // 1. Spawns
  // -------------------------------------------------------------------------

  /**
   * Turns one `SpawnRequest` into a combat enemy.
   *
   * Ground units get an empty path on purpose: they steer on the shared flow
   * field, so a dig completing mid-wave re-routes units already on the road
   * (GDD §5.1). Only flyers carry waypoints.
   */
  spawn(request: SpawnRequest): CombatEnemyHandle | null {
    const combat = this.combat;
    if (!combat) return null;

    const cell: CellCoord = { cx: request.cx, cy: request.cy };
    const meta = enemyMetaOf(request.enemy, this.enemyMeta);
    const air = meta.class === 'flying';
    const record: EnemyRecord = {
      enemyId: -1,
      defId: request.enemy,
      wave: request.wave,
      gateId: request.gateId,
      air,
      speedMultiplier: request.speedMultiplier,
      bountyMultiplier: request.bountyMultiplier,
    };

    this.pending = record;
    let handle: CombatEnemyHandle;
    try {
      handle = combat.spawnEnemy(request.enemy, {
        position: cellCenter(cell.cx, cell.cy),
        hpMultiplier: request.hpMultiplier,
        gateId: request.gateId,
        ...(air ? { path: this.flightPath(cell) } : {}),
      });
    } finally {
      this.pending = null;
    }

    record.enemyId = handle.id;
    this.byId.set(handle.id, record);
    this.byEntity.set(handle, record);
    return handle;
  }

  /** GDD §5.1: a flyer's route is the segment from its gate to the core. */
  private flightPath(from: CellCoord): Vec2[] {
    const core = this.world.grid.coreCells[0];
    if (!core) return [];
    // Drop the start point: the unit is already standing on it.
    return straightLine(from, core).slice(1);
  }

  // -------------------------------------------------------------------------
  // 2. Leaks, integrity and 丢区
  // -------------------------------------------------------------------------

  private onEnemyLeaked(payload: EnemyLeakedEvent): void {
    this.byId.delete(payload.enemyId);

    this.economy.steal(payload.goldStolen);
    const integrity = this.economy.damageIntegrity(payload.integrityDamage, 'leak');
    this.applyIntegrity(integrity);

    if (payload.lossOnLeak) this.lose('leviathan');
    else if (integrity <= 0) this.lose('integrity');
  }

  /**
   * Pushes the current integrity through `GameplayWorld` and settles the
   * consequences: supply cap penalty, blackout for every tower inside the zone,
   * and the sluice the zone was holding shut. Idempotent — the world only
   * reports a zone the first time it crosses its threshold.
   */
  applyIntegrity(integrity: number): void {
    for (const zone of this.world.applyIntegrity(integrity)) {
      this.economy.applyPowerPenalty(zone.def.powerPenalty);
      for (const tower of this.build.setZonePowered(zone.id, false)) {
        this.combat?.setTowerPowered(tower.towerId, false);
      }
    }
  }

  private lose(reason: DefeatReason): void {
    if (this.defeatReason) return;
    this.defeatReason = reason;
    this.events.emit('run_lost', {
      reason,
      wave: this.world.waves.waveNumber,
      integrity: this.economy.integrity,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Sapper crab
  // -------------------------------------------------------------------------

  private onBridgeDestroyed(payload: BridgeDestroyedEvent): void {
    // The engineering charge is not refunded (GDD §8.1) — that is the point.
    this.world.destroyBridge(payload.cx, payload.cy, payload.enemyId);
  }

  // -------------------------------------------------------------------------
  // 4. Bookkeeping
  // -------------------------------------------------------------------------

  private onEnemySpawned(payload: EnemySpawnedEvent): void {
    if (this.pending) {
      // Our own spawn; `spawn()` finishes the registration with the handle.
      return;
    }
    if (this.byId.has(payload.enemyId)) return;
    // Brood spawned inside combat (mothership death, Leviathan P2). It never
    // passed through `spawn()`, so it inherits the current wave's economy.
    const meta = enemyMetaOf(payload.defId, this.enemyMeta);
    this.byId.set(payload.enemyId, {
      enemyId: payload.enemyId,
      defId: payload.defId,
      wave: this.world.waves.waveNumber,
      gateId: null,
      air: meta.class === 'flying',
      speedMultiplier: 1,
      bountyMultiplier: this.world.waves.currentWave?.bountyMultiplier ?? 1,
    });
  }

  private onEnemyKilled(payload: EnemyKilledEvent): void {
    const record = this.byId.get(payload.enemyId);
    this.byId.delete(payload.enemyId);
    if (payload.bounty <= 0) return;
    this.economy.earn(Math.round(payload.bounty * (record?.bountyMultiplier ?? 1)), 'bounty');
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /** Dispatches this tick's spawn requests into combat. */
  dispatch(requests: readonly SpawnRequest[]): void {
    for (const request of requests) this.spawn(request);
  }

  /** Runs the combat frame, when the session is the one driving it. */
  update(dt: Seconds): void {
    this.combat?.update(dt);
  }

  washFloodway(): void {
    this.combat?.washFloodway();
  }

  get system(): CombatPort | null {
    return this.combat;
  }
}
