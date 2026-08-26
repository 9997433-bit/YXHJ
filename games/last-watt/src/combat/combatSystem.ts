/**
 * The combat orchestrator.
 *
 * Owns the enemy and tower collections, drives the per-frame update, and
 * implements `ReactionRuntime` so the data-driven reaction table can act on
 * the world. It knows how to deliver an attack; it does not know what a combo
 * is. Every combo in this game is a row in `data/reactions.ts`.
 *
 * Module boundary (Round 1 R1-O3): nothing under `src/combat/` imports from a
 * sibling `src/` subtree. Grid, pathing, waves and economy arrive through the
 * ports in `ports.ts`; presentation leaves through the event bus.
 */

import {
  CombatStats,
  NO_DAMAGE,
  resolveArmor,
  towerDefIdOf,
  towerIdOf,
  type DamageRequest,
  type DamageResult,
} from './damage';
import { ContentRegistry, type CombatContent } from './data';
import {
  MAX_CHAIN_JUMPS,
  MAX_REACTION_DEPTH,
  SELL_REFUND_FRACTION,
  ULTIMATE_OVERLOAD_DURATION,
} from './data/tuning';
import { Enemy, type EnemySpawnOptions } from './entities/enemy';
import type { DeathSpawn } from './entities/enemyDef';
import type { Projectile } from './entities/projectile';
import { Tower } from './entities/tower';
import type {
  ChainAttack,
  ConeAttack,
  MeleeAttack,
  PaintAttack,
  ProjectileAttack,
} from './entities/towerDef';
import { CombatEventBus } from './events';
import {
  InfiniteBattery,
  OpenFieldTerrain,
  PolylineMovement,
  type MovementDriver,
  type PowerSupply,
  type TerrainQuery,
} from './ports';
import type {
  AttackSource,
  MutableHit,
  ReactionContext,
  ReactionRuntime,
  SplashRequest,
  StatusApplyRequest,
} from './reaction/context';
import { executeEffect } from './reaction/effects';
import { ReactionEngine } from './reaction/engine';
import type { EffectSpec, ReactionRow } from './reaction/spec';
import type { StatusRemoval } from './status/statusSet';
import type { StatusRemovalReason } from './status/statusDef';
import { CoatingField } from './terrain';
import {
  acquireTarget,
  enemiesInCone,
  enemiesInRadius,
  nearestEnemy,
} from './targeting';
import {
  cellCenter,
  clamp,
  distance,
  toCell,
  unitVector,
  type CellCoating,
  type CellCoord,
  type ComboId,
  type EntityId,
  type Seconds,
  type StatusId,
  type StatusVfxSignal,
  type Vec2,
} from './types';
import type { OverloadedTower, OverloadSignal, SignalEndReason } from './vfxSignals';

/** Damage-over-time resolves in discrete ticks so floaters stay readable. */
const DOT_TICK: Seconds = 0.5;
/** A rivet with no valid target left is dropped after this long. */
const PROJECTILE_MAX_AGE: Seconds = 3;
const EMPTY_PARAMS: Readonly<Record<string, number>> = Object.freeze({});
const ZERO_VEC: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

/** An overload window in flight, so the `overload` signal can be closed. */
interface OverloadSurge {
  remaining: Seconds;
  begin: OverloadSignal;
}

export interface CombatSystemOptions {
  content?: CombatContent;
  terrain?: TerrainQuery;
  movement?: MovementDriver;
  power?: PowerSupply;
  bus?: CombatEventBus;
}

export class CombatSystem implements ReactionRuntime {
  readonly bus: CombatEventBus;
  readonly content: ContentRegistry;
  readonly reactions: ReactionEngine;
  readonly coatings = new CoatingField();
  readonly terrain: TerrainQuery;
  readonly movement: MovementDriver;
  readonly power: PowerSupply;
  readonly stats = new CombatStats();

  time: Seconds = 0;

  private readonly enemies = new Map<EntityId, Enemy>();
  private readonly towers = new Map<EntityId, Tower>();
  private projectiles: Projectile[] = [];
  private nextId: EntityId = 1;
  private readonly seenCombos = new Set<ComboId>();
  private readonly removalQueue: Enemy[] = [];
  private overloadSurges: OverloadSurge[] = [];

  constructor(options: CombatSystemOptions = {}) {
    this.content = new ContentRegistry(options.content);
    this.reactions = new ReactionEngine(this.content.reactions);
    this.terrain = options.terrain ?? new OpenFieldTerrain();
    this.movement = options.movement ?? new PolylineMovement();
    this.power = options.power ?? new InfiniteBattery();
    this.bus = options.bus ?? new CombatEventBus();
  }

  // -------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------

  get battery(): number {
    return this.power.battery;
  }

  enemyList(): Enemy[] {
    return [...this.enemies.values()];
  }

  towerList(): Tower[] {
    return [...this.towers.values()];
  }

  projectileList(): readonly Projectile[] {
    return this.projectiles;
  }

  getEnemy(id: EntityId): Enemy | undefined {
    return this.enemies.get(id);
  }

  getTower(id: EntityId): Tower | undefined {
    return this.towers.get(id);
  }

  /**
   * `defId` is a `data/enemies.json` id. Round 1's combat-private names still
   * resolve through `data/ids.ts`, but every id emitted from here is canonical.
   */
  spawnEnemy(defId: string, options: EnemySpawnOptions): Enemy {
    const def = this.content.enemy(defId);
    const enemy = new Enemy(this.nextId++, def, this.content.statuses, options);
    enemy.lastCell = toCell(enemy.position);
    this.enemies.set(enemy.id, enemy);
    this.updatePhase(enemy);
    this.bus.emit('enemy_spawned', {
      enemyId: enemy.id,
      defId: enemy.defId,
      position: { ...enemy.position },
      maxHp: enemy.maxHp,
    });
    return enemy;
  }

  /** `defId` is a `data/towers.json` id; Round 1 aliases still resolve. */
  buildTower(defId: string, cell: CellCoord): Tower {
    const def = this.content.tower(defId);
    const tower = new Tower(this.nextId++, def, cell);
    tower.powered = this.terrain.isPowered(cell.cx, cell.cy);
    this.towers.set(tower.id, tower);
    this.bus.emit('tower_built', { towerId: tower.id, defId: def.id, cell: { ...tower.position } });
    return tower;
  }

  upgradeTower(towerId: EntityId, upgradeId: string): boolean {
    const tower = this.towers.get(towerId);
    if (!tower || tower.upgradeId) return false;
    const upgrade = this.content.upgrade(upgradeId);
    tower.applyUpgrade(upgrade);
    this.bus.emit('tower_upgraded', { towerId, defId: tower.defId, upgradeId: upgrade.id });
    return true;
  }

  /** Returns the refund (GDD §6.1: 70% of current value). */
  sellTower(towerId: EntityId): number {
    const tower = this.towers.get(towerId);
    if (!tower) return 0;
    const spent = tower.baseDef.cost + (tower.upgradeId ? this.content.upgrade(tower.upgradeId).cost : 0);
    const refund = Math.floor(spent * SELL_REFUND_FRACTION);
    this.towers.delete(towerId);
    this.bus.emit('tower_sold', { towerId, defId: tower.defId, refund });
    return refund;
  }

  /** Called by `src/gameplay` when a substation zone is lost (GDD §10). */
  setTowerPowered(towerId: EntityId, powered: boolean): void {
    const tower = this.towers.get(towerId);
    if (!tower || tower.powered === powered) return;
    tower.powered = powered;
    this.bus.emit('tower_state_changed', {
      towerId,
      defId: tower.defId,
      state: tower.state,
      duration: 0,
    });
  }

  removeEnemy(enemy: Enemy): void {
    this.endEnemySignals(enemy);
    enemy.alive = false;
    this.enemies.delete(enemy.id);
  }

  reset(): void {
    this.enemies.clear();
    this.towers.clear();
    this.projectiles = [];
    this.coatings.clear();
    this.stats.reset();
    this.seenCombos.clear();
    this.overloadSurges = [];
    this.time = 0;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: Seconds): void {
    if (dt <= 0) return;
    this.time += dt;

    for (const expiry of this.coatings.tick(dt)) {
      this.bus.emit('cell_coating_changed', {
        cx: expiry.cx,
        cy: expiry.cy,
        coating: 'none',
        duration: 0,
      });
    }

    for (const enemy of this.enemies.values()) this.updateEnemy(enemy, dt);
    for (const tower of this.towers.values()) this.updateTower(tower, dt);
    this.updateProjectiles(dt);
    this.updateOverloadSurges(dt);
    this.flushRemovals();
  }

  /** Closes the `overload` VFX signal once its window has run out. */
  private updateOverloadSurges(dt: Seconds): void {
    if (this.overloadSurges.length === 0) return;
    const survivors: OverloadSurge[] = [];
    for (const surge of this.overloadSurges) {
      surge.remaining -= dt;
      if (surge.remaining > 0) {
        survivors.push(surge);
        continue;
      }
      this.bus.emit('overload', {
        ...surge.begin,
        phase: 'end',
        duration: 0,
        endReason: 'expired',
      });
    }
    this.overloadSurges = survivors;
  }

  private flushRemovals(): void {
    if (this.removalQueue.length === 0) return;
    for (const enemy of this.removalQueue) this.enemies.delete(enemy.id);
    this.removalQueue.length = 0;
  }

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  private updateEnemy(enemy: Enemy, dt: Seconds): void {
    if (!enemy.alive) return;
    enemy.age += dt;

    for (const removal of enemy.statuses.tick(dt)) this.onStatusRemoved(enemy, removal);
    this.tickDots(enemy, dt);
    if (!enemy.alive) return;

    const phase = enemy.currentPhase;
    if (phase?.selfDamagePerSecond) {
      this.applyDamage({
        target: enemy,
        amount: phase.selfDamagePerSecond * dt,
        damageType: 'true',
        tags: ['dot'],
        source: { kind: 'environment' },
        ignoreArmor: true,
        depth: MAX_REACTION_DEPTH + 1,
      });
      if (!enemy.alive) return;
    }

    const suppressed = enemy.statuses.modifiers().suppressBehaviour;
    this.movement.advance(enemy, dt, enemy.effectiveSpeed);
    this.checkCellEntry(enemy);
    if (!suppressed) this.updateBehaviour(enemy, dt);

    if (enemy.reachedGoal && enemy.alive) this.leak(enemy);
  }

  private tickDots(enemy: Enemy, dt: Seconds): void {
    for (const instance of enemy.statuses.list()) {
      const def = this.content.statuses.get(instance.id);
      if (!def.dot) continue;
      instance.dotCarry += dt;
      while (instance.dotCarry >= DOT_TICK && enemy.alive) {
        instance.dotCarry -= DOT_TICK;
        this.applyDamage({
          target: enemy,
          amount: def.dot.dps * DOT_TICK,
          damageType: def.dot.damageType,
          tags: def.dot.tags,
          source: { kind: 'environment', defId: def.id },
          ignoreArmor: def.dot.ignoreArmor ?? false,
          // DoT ticks never re-trigger reactions: burning must not re-ignite.
          depth: MAX_REACTION_DEPTH + 1,
        });
      }
    }
  }

  private updatePhase(enemy: Enemy): void {
    const phases = enemy.def.phases;
    if (!phases || phases.length === 0) return;
    const fraction = enemy.hpFraction;
    let next = enemy.phaseIndex;
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i] as (typeof phases)[number];
      if (fraction <= phase.enterAtHpFraction && i > next) next = i;
    }
    if (next === enemy.phaseIndex) return;

    enemy.phaseIndex = next;
    const phase = phases[next] as (typeof phases)[number];
    for (const removal of enemy.statuses.setImmunities(enemy.immunities())) {
      this.onStatusRemoved(enemy, removal);
    }
    this.bus.emit('enemy_phase_changed', {
      enemyId: enemy.id,
      defId: enemy.defId,
      phaseIndex: next,
      phaseId: phase.id,
    });
    if (phase.spawnOnEnter) this.spawnBrood(enemy, phase.spawnOnEnter);
  }

  private checkCellEntry(enemy: Enemy): void {
    const cell = toCell(enemy.position);
    if (cell.cx === enemy.lastCell.cx && cell.cy === enemy.lastCell.cy) return;
    enemy.lastCell = cell;
    if (!this.terrain.isInside(cell.cx, cell.cy)) return;

    this.trigger({
      trigger: 'on_cell_entered',
      target: enemy,
      cell,
      cellCoating: this.coatings.get(cell.cx, cell.cy),
      params: this.coatings.params(cell.cx, cell.cy),
      source: { kind: 'environment' },
      sourceTags: ['environment'],
    });

    const behaviour = enemy.def.behaviour;
    if (behaviour.kind === 'demolish' && behaviour.destroysBridges && this.terrain.isBridge(cell.cx, cell.cy)) {
      this.bus.emit('bridge_destroyed', { cx: cell.cx, cy: cell.cy, enemyId: enemy.id });
    }
  }

  private updateBehaviour(enemy: Enemy, dt: Seconds): void {
    const behaviour = enemy.def.behaviour;
    switch (behaviour.kind) {
      case 'walk':
      case 'fly':
        return;

      case 'heal': {
        enemy.behaviourTimer -= dt;
        if (enemy.behaviourTimer > 0) return;
        enemy.behaviourTimer = behaviour.tickInterval;
        const amount = behaviour.healPerSecond * behaviour.tickInterval;
        for (const ally of enemiesInRadius(this.enemies.values(), enemy.position, behaviour.radius, enemy.id)) {
          if (ally.hp >= ally.maxHp) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + amount);
          this.bus.emit('enemy_healed', { enemyId: ally.id, amount, healerId: enemy.id });
        }
        return;
      }

      case 'demolish': {
        if (enemy.armedTargetId === undefined) {
          const target = this.nearestTower(enemy.position, behaviour.scanRadius);
          if (!target) return;
          enemy.armedTargetId = target.id;
          enemy.behaviourTimer = behaviour.fuse;
          return;
        }
        enemy.behaviourTimer -= dt;
        if (enemy.behaviourTimer > 0) return;
        this.detonate(enemy, behaviour.blastRadius, behaviour.towerDisableSeconds);
        return;
      }
    }
  }

  private nearestTower(origin: Vec2, radius: number): Tower | undefined {
    let best: Tower | undefined;
    let bestDist = Infinity;
    for (const tower of this.towers.values()) {
      const dist = distance(origin, tower.position);
      if (dist <= radius && dist < bestDist) {
        best = tower;
        bestDist = dist;
      }
    }
    return best;
  }

  /** Sapper crab self-destruct: shuts towers down, kills itself, pays nothing. */
  private detonate(enemy: Enemy, blastRadius: number, disableSeconds: Seconds): void {
    for (const tower of this.towers.values()) {
      if (distance(enemy.position, tower.position) > blastRadius + 0.5) continue;
      tower.disable(disableSeconds);
      this.bus.emit('tower_state_changed', {
        towerId: tower.id,
        defId: tower.defId,
        state: 'disabled',
        duration: disableSeconds,
      });
    }
    this.endEnemySignals(enemy);
    enemy.alive = false;
    this.bus.emit('enemy_killed', {
      enemyId: enemy.id,
      defId: enemy.defId,
      bounty: 0,
      position: { ...enemy.position },
    });
    this.removalQueue.push(enemy);
  }

  private leak(enemy: Enemy): void {
    this.endEnemySignals(enemy);
    enemy.alive = false;
    this.stats.enemiesLeaked += 1;
    this.bus.emit('enemy_leaked', {
      enemyId: enemy.id,
      defId: enemy.defId,
      integrityDamage: enemy.def.integrityDamage,
      goldStolen: enemy.def.goldStolen,
      lossOnLeak: enemy.def.lossOnLeak ?? false,
      ...(enemy.gateId !== undefined ? { gateId: enemy.gateId } : {}),
    });
    this.removalQueue.push(enemy);
  }

  private kill(enemy: Enemy, source: AttackSource, combo: ComboId | undefined): void {
    this.endEnemySignals(enemy);
    enemy.alive = false;
    enemy.hp = 0;
    this.stats.enemiesKilled += 1;
    const killerTowerId = towerIdOf(source);
    this.bus.emit('enemy_killed', {
      enemyId: enemy.id,
      defId: enemy.defId,
      bounty: enemy.def.bounty,
      position: { ...enemy.position },
      ...(killerTowerId !== undefined ? { killerTowerId } : {}),
      ...(combo !== undefined ? { comboId: combo } : {}),
    });
    if (enemy.def.onDeathSpawn) this.spawnBrood(enemy, enemy.def.onDeathSpawn);
    this.removalQueue.push(enemy);
  }

  private spawnBrood(parent: Enemy, spawns: readonly DeathSpawn[]): void {
    for (const spawn of spawns) {
      for (let i = 0; i < spawn.count; i += 1) {
        const angle = (i / spawn.count) * Math.PI * 2;
        const options: EnemySpawnOptions = {
          position: {
            x: parent.position.x + Math.cos(angle) * spawn.spreadRadius,
            y: parent.position.y + Math.sin(angle) * spawn.spreadRadius,
          },
          path: parent.path.slice(parent.pathIndex),
        };
        if (parent.gateId !== undefined) options.gateId = parent.gateId;
        const child = this.spawnEnemy(spawn.defId, options);
        child.pathProgress = parent.pathProgress;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Towers
  // -------------------------------------------------------------------------

  private updateTower(tower: Tower, dt: Seconds): void {
    const transition = tower.tick(dt);
    if (transition) {
      this.bus.emit('tower_state_changed', {
        towerId: tower.id,
        defId: tower.defId,
        state: transition,
        duration: tower.stateRemaining(),
      });
    }
    if (!tower.operational || tower.cooldown > 0) return;

    const attack = tower.def.attack;
    switch (attack.kind) {
      case 'none':
        return;
      case 'paint':
        this.firePaint(tower, attack);
        return;
      case 'cone':
        this.fireCone(tower, attack);
        return;
      case 'projectile':
        this.fireProjectile(tower, attack);
        return;
      case 'melee':
        this.fireMelee(tower, attack);
        return;
      case 'chain':
        this.fireChain(tower, attack);
        return;
    }
  }

  private startCooldown(tower: Tower, interval: Seconds): void {
    tower.cooldown = interval / tower.attackSpeedMul;
  }

  private sourceOf(tower: Tower): AttackSource {
    return { kind: 'tower', id: tower.id, defId: tower.defId };
  }

  private firePaint(tower: Tower, attack: PaintAttack): void {
    const radius = attack.paintRadius;
    const origin = tower.cell;
    const span = Math.ceil(radius);
    let painted = false;

    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const cx = origin.cx + dx;
        const cy = origin.cy + dy;
        if (!this.terrain.isInside(cx, cy)) continue;
        if (attack.roadOnly && !this.terrain.isRoad(cx, cy)) continue;
        if (distance(tower.position, cellCenter(cx, cy)) > radius) continue;
        // Never smother a live fire field with fresh oil.
        if (this.coatings.get(cx, cy) === 'fire') continue;

        const changed = this.coatings.paint(cx, cy, attack.coating, attack.coatingDuration, attack.params);
        painted = true;
        if (changed) {
          this.bus.emit('cell_coating_changed', {
            cx,
            cy,
            coating: attack.coating,
            duration: attack.coatingDuration,
          });
        }
      }
    }
    if (painted) {
      this.bus.emit('tower_fired', {
        towerId: tower.id,
        defId: tower.defId,
        from: { ...tower.position },
        to: { ...tower.position },
        attackKind: 'paint',
      });
    }
    this.startCooldown(tower, attack.interval);
  }

  private fireCone(tower: Tower, attack: ConeAttack): void {
    const target = acquireTarget(tower, this.enemies.values());
    if (!target) return;

    const dx = target.position.x - tower.position.x;
    const dy = target.position.y - tower.position.y;
    const length = Math.hypot(dx, dy) || 1;
    tower.facing.x = dx / length;
    tower.facing.y = dy / length;

    const source = this.sourceOf(tower);
    const params = attack.params ?? EMPTY_PARAMS;
    const victims = enemiesInCone(
      this.enemies.values(),
      tower.position,
      tower.facing,
      attack.range,
      attack.halfAngleDeg,
      attack.targetsAir,
    );

    const damage = attack.damagePerSecond * attack.interval;
    for (const victim of victims) {
      if (damage > 0) {
        this.applyDamage({
          target: victim,
          amount: damage,
          damageType: attack.damageType,
          tags: attack.tags,
          source,
          params,
        });
      }
      if (!victim.alive) continue;
      for (const application of attack.applyStatuses ?? []) {
        const request: StatusApplyRequest = {};
        if (application.stacks !== undefined) request.stacks = application.stacks;
        if (application.duration !== undefined) request.duration = application.duration;
        if (application.modifiers) request.modifiers = application.modifiers;
        if (application.params) request.params = application.params;
        this.applyStatus(victim, application.status, request, source);
      }
    }

    if (attack.sweepsCells) this.sweepCells(tower, attack, params, source);

    this.bus.emit('tower_fired', {
      towerId: tower.id,
      defId: tower.defId,
      from: { ...tower.position },
      to: { ...target.position },
      attackKind: 'cone',
    });
    this.startCooldown(tower, attack.interval);
  }

  /** Reports every cell inside the cone to the `on_cell_swept` trigger. */
  private sweepCells(
    tower: Tower,
    attack: ConeAttack,
    params: Readonly<Record<string, number>>,
    source: AttackSource,
  ): void {
    const span = Math.ceil(attack.range);
    const cosLimit = Math.cos((attack.halfAngleDeg * Math.PI) / 180);

    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const cx = tower.cell.cx + dx;
        const cy = tower.cell.cy + dy;
        if (!this.terrain.isInside(cx, cy)) continue;
        const center = cellCenter(cx, cy);
        const toCellX = center.x - tower.position.x;
        const toCellY = center.y - tower.position.y;
        const dist = Math.hypot(toCellX, toCellY);
        if (dist > attack.range) continue;
        if (dist > 1e-6) {
          const cos = (toCellX * tower.facing.x + toCellY * tower.facing.y) / dist;
          if (cos < cosLimit) continue;
        }
        this.trigger({
          trigger: 'on_cell_swept',
          cell: { cx, cy },
          cellCoating: this.coatings.get(cx, cy),
          params,
          source,
          sourceTags: [...attack.tags],
        });
      }
    }
  }

  private fireProjectile(tower: Tower, attack: ProjectileAttack): void {
    const target = acquireTarget(tower, this.enemies.values());
    if (!target) return;

    const projectile: Projectile = {
      id: this.nextId++,
      position: { ...tower.position },
      targetId: target.id,
      speed: attack.projectileSpeed,
      damage: attack.damage,
      damageType: attack.damageType,
      tags: attack.tags,
      source: this.sourceOf(tower),
      ignoreArmor: attack.ignoreArmor ?? false,
      splashRadius: attack.splashRadius ?? 0,
      age: 0,
    };
    this.projectiles.push(projectile);

    this.bus.emit('tower_fired', {
      towerId: tower.id,
      defId: tower.defId,
      from: { ...tower.position },
      to: { ...target.position },
      attackKind: 'projectile',
    });
    this.startCooldown(tower, attack.interval);
  }

  private fireMelee(tower: Tower, attack: MeleeAttack): void {
    const target = acquireTarget(tower, this.enemies.values());
    if (!target) return;

    const result = this.applyDamage({
      target,
      amount: attack.damage,
      damageType: attack.damageType,
      tags: attack.tags,
      source: this.sourceOf(tower),
      ignoreArmor: attack.ignoreArmor ?? false,
    });

    if (attack.splashRadius) {
      for (const victim of enemiesInRadius(
        this.enemies.values(),
        target.position,
        attack.splashRadius,
        target.id,
      )) {
        this.applyDamage({
          target: victim,
          amount: attack.damage,
          damageType: attack.damageType,
          tags: [...attack.tags, 'splash'],
          source: this.sourceOf(tower),
          ignoreArmor: attack.ignoreArmor ?? false,
          // A shockwave is still a single 45-damage hit, so it may shatter a
          // frozen neighbour; that shatter's own splash cannot cascade further.
          depth: MAX_REACTION_DEPTH,
        });
      }
    }

    this.bus.emit('tower_fired', {
      towerId: tower.id,
      defId: tower.defId,
      from: { ...tower.position },
      to: { ...target.position },
      attackKind: result.applied > 0 ? 'melee' : 'melee_miss',
    });
    this.startCooldown(tower, attack.interval);
  }

  private fireChain(tower: Tower, attack: ChainAttack): void {
    const first = acquireTarget(tower, this.enemies.values());
    if (!first) return;

    const source = this.sourceOf(tower);
    const hitIds = new Set<EntityId>();
    const points: Vec2[] = [{ ...tower.position }];
    let current: Enemy | undefined = first;
    let damage = attack.damage;
    let falloff = attack.falloff;
    let jumps = attack.jumps;
    let empowered = false;

    while (current && hitIds.size < Math.min(jumps, MAX_CHAIN_JUMPS)) {
      points.push({ ...current.position });
      const previous: Enemy = current;
      hitIds.add(previous.id);

      const result = this.applyDamage({
        target: previous,
        amount: damage,
        damageType: attack.damageType,
        tags: attack.tags,
        source,
      });

      // Conduct is decided on the primary target only (SYSTEMS.md decision D8):
      // a wet enemy mid-chain does not extend a chain that is already flying.
      if (result.chainBonus && hitIds.size === 1) {
        jumps = Math.min(MAX_CHAIN_JUMPS, jumps + result.chainBonus.extraJumps);
        if (result.chainBonus.falloffOverride !== undefined) falloff = result.chainBonus.falloffOverride;
        empowered = true;
      }
      damage *= falloff;

      current = nearestEnemy(
        this.enemies.values(),
        previous.position,
        attack.jumpRange,
        hitIds,
        attack.targetsAir,
      );
    }

    this.bus.emit('chain_arc', { towerId: tower.id, points, empowered });
    this.bus.emit('tower_fired', {
      towerId: tower.id,
      defId: tower.defId,
      from: { ...tower.position },
      to: points[points.length - 1] ?? { ...tower.position },
      attackKind: 'chain',
    });
    this.startCooldown(tower, attack.interval);
  }

  private updateProjectiles(dt: Seconds): void {
    if (this.projectiles.length === 0) return;
    const survivors: Projectile[] = [];

    for (const projectile of this.projectiles) {
      projectile.age += dt;
      const target = this.enemies.get(projectile.targetId);
      if (!target || !target.alive || projectile.age > PROJECTILE_MAX_AGE) continue;

      const dx = target.position.x - projectile.position.x;
      const dy = target.position.y - projectile.position.y;
      const dist = Math.hypot(dx, dy);
      const step = projectile.speed * dt;

      if (dist <= step + target.radius) {
        this.applyDamage({
          target,
          amount: projectile.damage,
          damageType: projectile.damageType,
          tags: projectile.tags,
          source: projectile.source,
          ignoreArmor: projectile.ignoreArmor,
          ...(projectile.params ? { params: projectile.params } : {}),
        });
        if (projectile.splashRadius > 0) {
          for (const victim of enemiesInRadius(
            this.enemies.values(),
            target.position,
            projectile.splashRadius,
            target.id,
          )) {
            this.applyDamage({
              target: victim,
              amount: projectile.damage,
              damageType: projectile.damageType,
              tags: [...projectile.tags, 'splash'],
              source: projectile.source,
              ignoreArmor: projectile.ignoreArmor,
              depth: MAX_REACTION_DEPTH,
            });
          }
        }
        continue;
      }

      projectile.position.x += (dx / dist) * step;
      projectile.position.y += (dy / dist) * step;
      survivors.push(projectile);
    }
    this.projectiles = survivors;
  }

  // -------------------------------------------------------------------------
  // Damage pipeline
  // -------------------------------------------------------------------------

  applyDamage(request: DamageRequest): DamageResult {
    const enemy = request.target;
    if (!enemy.alive) return NO_DAMAGE;

    const depth = request.depth ?? 0;
    const hit: MutableHit = {
      amount: request.amount,
      baseAmount: request.amount,
      damageType: request.damageType,
      // Copy: reaction rows may brand the hit and must not mutate a def's array.
      tags: [...request.tags],
      ignoreArmor: request.ignoreArmor ?? false,
      position: request.position ? { ...request.position } : { ...enemy.position },
    };
    if (request.combo) hit.combo = request.combo;

    let firedRows: ReactionRow[] = [];
    let pendingSplash: SplashRequest[] = [];

    if (depth <= MAX_REACTION_DEPTH) {
      const ctx = this.makeContext({
        trigger: 'on_hit',
        target: enemy,
        hit,
        source: request.source,
        sourceTags: hit.tags,
        params: request.params ?? EMPTY_PARAMS,
        depth,
      });
      firedRows = this.resolve(ctx);
      pendingSplash = ctx.pendingSplash;
    }

    // `true` damage is exactly what it says: no armour, no multipliers. The
    // Leviathan's P3 self-burn must be a flat 30/s no matter what state it is in.
    const unmodified = hit.damageType === 'true';
    const ignoreArmor = unmodified || hit.ignoreArmor;
    const { applied: afterArmor, absorbed } = resolveArmor(
      hit.amount,
      ignoreArmor ? 0 : enemy.effectiveArmor,
      ignoreArmor,
    );
    const applied = Math.max(0, unmodified ? afterArmor : afterArmor * enemy.damageTakenMul);

    enemy.hp -= applied;
    this.stats.recordDamage(applied, hit.combo, towerDefIdOf(request.source));
    const towerId = towerIdOf(request.source);
    if (towerId !== undefined) {
      const tower = this.towers.get(towerId);
      if (tower) tower.damageDealt += applied;
    }

    this.bus.emit('enemy_damaged', {
      enemyId: enemy.id,
      amount: applied,
      rawAmount: hit.amount,
      absorbedByArmor: absorbed,
      damageType: hit.damageType,
      ...(hit.combo !== undefined ? { comboId: hit.combo } : {}),
      position: { ...hit.position },
      remainingHp: Math.max(0, enemy.hp),
    });

    for (const splash of pendingSplash) this.resolveSplash(splash);

    const killed = enemy.hp <= 0;
    if (killed) this.kill(enemy, request.source, hit.combo);
    else this.updatePhase(enemy);

    const result: DamageResult = {
      applied,
      absorbed,
      killed,
      reactions: firedRows.map((row) => row.id),
    };
    if (hit.combo) result.combo = hit.combo;
    if (hit.chainBonus) result.chainBonus = hit.chainBonus;
    return result;
  }

  private resolveSplash(splash: SplashRequest): void {
    for (const victim of enemiesInRadius(
      this.enemies.values(),
      splash.origin,
      splash.radius,
      splash.excludeEnemyId,
    )) {
      this.applyDamage({
        target: victim,
        amount: splash.amount,
        damageType: splash.damageType,
        tags: splash.tags,
        source: splash.source,
        ignoreArmor: splash.ignoreArmor,
        position: splash.origin,
        depth: splash.canTriggerReactions ? splash.depth : MAX_REACTION_DEPTH + 1,
        ...(splash.combo ? { combo: splash.combo } : {}),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Reaction plumbing
  // -------------------------------------------------------------------------

  private makeContext(seed: {
    trigger: ReactionContext['trigger'];
    source: AttackSource;
    sourceTags: ReactionContext['sourceTags'];
    params: Readonly<Record<string, number>>;
    depth?: number;
    target?: Enemy;
    hit?: MutableHit;
    changedStatus?: StatusId;
    cell?: CellCoord;
    cellCoating?: CellCoating;
    activation?: string;
  }): ReactionContext {
    return {
      trigger: seed.trigger,
      runtime: this,
      source: seed.source,
      sourceTags: seed.sourceTags,
      params: seed.params,
      depth: seed.depth ?? 0,
      matched: [],
      claimedMutex: new Set<string>(),
      pendingSplash: [],
      ...(seed.target ? { target: seed.target } : {}),
      ...(seed.hit ? { hit: seed.hit } : {}),
      ...(seed.changedStatus ? { changedStatus: seed.changedStatus } : {}),
      ...(seed.cell ? { cell: seed.cell } : {}),
      ...(seed.cellCoating ? { cellCoating: seed.cellCoating } : {}),
      ...(seed.activation ? { activation: seed.activation } : {}),
    };
  }

  /** Builds a context, runs the table, publishes what fired. */
  private trigger(seed: Parameters<CombatSystem['makeContext']>[0]): ReactionRow[] {
    const ctx = this.makeContext(seed);
    const fired = this.resolve(ctx);
    for (const splash of ctx.pendingSplash) this.resolveSplash(splash);
    return fired;
  }

  private resolve(ctx: ReactionContext): ReactionRow[] {
    const fired = this.reactions.resolve(ctx);
    for (const row of fired) {
      this.stats.recordReaction(row.id);
      const position = ctx.target
        ? { ...ctx.target.position }
        : ctx.cell
          ? cellCenter(ctx.cell.cx, ctx.cell.cy)
          : { x: 0, y: 0 };

      this.bus.emit('reaction_triggered', {
        rowId: row.id,
        position,
        impact: row.impact ?? {},
        ...(row.combo !== undefined ? { comboId: row.combo } : {}),
        ...(ctx.target ? { enemyId: ctx.target.id } : {}),
        ...(ctx.source.id !== undefined ? { sourceId: ctx.source.id } : {}),
      });

      if (row.impact?.signal) this.emitRowSignal(row, ctx, position);

      // GDD §14.2: the tip bar for a combo fires exactly once per session.
      if (row.combo && !this.seenCombos.has(row.combo)) {
        this.seenCombos.add(row.combo);
        this.bus.emit('combo_first_seen', {
          comboId: row.combo,
          position,
          ...(row.impact?.tip !== undefined ? { tip: row.impact.tip } : {}),
        });
      }
    }
    return fired;
  }

  /**
   * Publishes the stable one-shot signal a row declares. Everything in the
   * payload is read off the row and the context, so the shatter burst follows
   * `impact.signal` rather than the row being called `ice_shatter`.
   */
  private emitRowSignal(row: ReactionRow, ctx: ReactionContext, position: Vec2): void {
    const signal = row.impact?.signal;
    if (!signal) return;
    const splash = row.effects.find((effect) => effect.kind === 'splash');
    const attacker = ctx.source.id !== undefined ? this.towers.get(ctx.source.id) : undefined;

    this.bus.emit(signal, {
      position,
      splashRadius: splash?.kind === 'splash' ? splash.radius : 0,
      direction: attacker ? unitVector(attacker.position, position) : { ...ZERO_VEC },
      damage: ctx.hit?.amount ?? 0,
      impact: row.impact ?? {},
      ...(ctx.target ? { enemyId: ctx.target.id } : {}),
      ...(ctx.source.id !== undefined ? { sourceId: ctx.source.id } : {}),
    });
  }

  /** Runs a bare effect list (a status's `onEnd`) outside of any row. */
  private runEffects(effects: readonly EffectSpec[], seed: Parameters<CombatSystem['makeContext']>[0]): void {
    const ctx = this.makeContext(seed);
    for (const effect of effects) executeEffect(effect, ctx);
    for (const splash of ctx.pendingSplash) this.resolveSplash(splash);
  }

  // -------------------------------------------------------------------------
  // ReactionRuntime
  // -------------------------------------------------------------------------

  applyStatus(enemy: Enemy, status: StatusId, request: StatusApplyRequest, source: AttackSource): void {
    if (!enemy.alive) return;
    const result = enemy.statuses.apply(status, request);

    for (const removal of result.removed) this.onStatusRemoved(enemy, removal);

    if (!result.applied && !result.refreshed) {
      if (result.blockedBy) {
        this.bus.emit('status_blocked', { enemyId: enemy.id, status, reason: result.blockedBy });
      }
      return;
    }

    this.bus.emit('status_applied', {
      enemyId: enemy.id,
      status,
      stacks: result.stacks,
      duration: result.duration,
      refreshed: result.refreshed && !result.applied,
    });

    const signal = this.content.statuses.get(status).signal;
    if (signal) {
      this.bus.emit(signal, {
        phase: 'begin',
        enemyId: enemy.id,
        position: { ...enemy.position },
        radius: enemy.radius,
        duration: result.duration,
      });
    }

    const instance = enemy.statuses.get(status);
    this.trigger({
      trigger: 'on_status_changed',
      target: enemy,
      changedStatus: status,
      source,
      sourceTags: [],
      params: instance?.params ?? EMPTY_PARAMS,
    });
  }

  removeStatus(enemy: Enemy, status: StatusId, reason: StatusRemovalReason): void {
    const removal = enemy.statuses.remove(status, reason);
    if (removal) this.onStatusRemoved(enemy, removal);
  }

  private onStatusRemoved(enemy: Enemy, removal: StatusRemoval): void {
    this.bus.emit('status_removed', {
      enemyId: enemy.id,
      status: removal.status,
      reason: removal.reason,
    });
    if (removal.def.signal) this.endStatusSignal(enemy, removal.def.signal, removal.reason);
    if (!removal.def.onEnd || !enemy.alive) return;
    this.runEffects(removal.def.onEnd, {
      trigger: 'on_status_changed',
      target: enemy,
      source: { kind: 'environment', defId: removal.status },
      sourceTags: [],
      params: EMPTY_PARAMS,
    });
  }

  private endStatusSignal(enemy: Enemy, signal: StatusVfxSignal, reason: SignalEndReason): void {
    this.bus.emit(signal, {
      phase: 'end',
      enemyId: enemy.id,
      position: { ...enemy.position },
      radius: enemy.radius,
      duration: 0,
      endReason: reason,
    });
  }

  /**
   * Closes every open per-enemy signal when the host leaves the field, so the
   * VFX layer never keeps a looping emitter alive on a corpse.
   */
  private endEnemySignals(enemy: Enemy): void {
    for (const instance of enemy.statuses.list()) {
      const signal = this.content.statuses.get(instance.id).signal;
      if (signal) this.endStatusSignal(enemy, signal, 'host_removed');
    }
  }

  paintCells(
    origin: CellCoord,
    radius: number,
    coating: CellCoating,
    duration: Seconds,
    onlyOver?: CellCoating,
  ): void {
    const span = Math.max(0, Math.floor(radius));
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const cx = origin.cx + dx;
        const cy = origin.cy + dy;
        if (!this.terrain.isInside(cx, cy)) continue;
        if (onlyOver && this.coatings.get(cx, cy) !== onlyOver) continue;
        if (this.coatings.paint(cx, cy, coating, duration)) {
          this.bus.emit('cell_coating_changed', { cx, cy, coating, duration });
        }
      }
    }
  }

  overloadTowers(options: {
    scope: 'radius' | 'global';
    origin?: CellCoord;
    radius: number;
    attackSpeedMul: number;
    duration: Seconds;
    overheat: Seconds;
    poweredTowersOnly: boolean;
  }): number {
    const affected: OverloadedTower[] = [];
    for (const tower of this.towers.values()) {
      if (options.poweredTowersOnly && !tower.drawsPower) continue;
      if (!tower.powered) continue;
      if (options.scope === 'radius') {
        const origin = options.origin;
        if (!origin) continue;
        // Chebyshev distance: radius 1 is exactly the capacitor's 3x3.
        const chebyshev = Math.max(
          Math.abs(tower.cell.cx - origin.cx),
          Math.abs(tower.cell.cy - origin.cy),
        );
        if (chebyshev > options.radius) continue;
      }
      tower.overload(options.attackSpeedMul, options.duration, options.overheat);
      affected.push({ towerId: tower.id, defId: tower.defId, position: { ...tower.position } });
      this.bus.emit('tower_state_changed', {
        towerId: tower.id,
        defId: tower.defId,
        state: 'overloaded',
        duration: options.duration,
      });
    }

    this.openOverloadSurge(options, affected);
    return affected.length;
  }

  /**
   * Publishes the `overload` signal for the surge that just landed and arms
   * its closing edge. Driven by the effect verb rather than by a row id, so
   * the capacitor and the §9 ultimate both light up without a branch.
   */
  private openOverloadSurge(
    options: { scope: 'radius' | 'global'; origin?: CellCoord; radius: number; duration: Seconds; overheat: Seconds },
    towers: OverloadedTower[],
  ): void {
    const begin: OverloadSignal = {
      phase: 'begin',
      scope: options.scope,
      radiusCells: options.scope === 'radius' ? options.radius : 0,
      towers,
      duration: options.duration,
      overheat: options.overheat,
      ...(options.scope === 'radius' && options.origin
        ? { origin: cellCenter(options.origin.cx, options.origin.cy) }
        : {}),
    };
    this.bus.emit('overload', begin);
    if (options.duration > 0) this.overloadSurges.push({ remaining: options.duration, begin });
  }

  stunEnemies(options: {
    scope: 'global' | 'radius';
    origin?: Vec2;
    radius: number;
    duration: Seconds;
  }): number {
    const targets =
      options.scope === 'global' || !options.origin
        ? this.enemyList()
        : enemiesInRadius(this.enemies.values(), options.origin, options.radius);
    for (const enemy of targets) {
      this.applyStatus(enemy, 'stunned', { duration: options.duration }, { kind: 'ability' });
    }
    return targets.length;
  }

  consumeBattery(amount: number): boolean {
    return this.power.tryConsumeBattery(amount);
  }

  // -------------------------------------------------------------------------
  // Activations (GDD §7.3.4 capacitor overload, §9 master overload)
  // -------------------------------------------------------------------------

  /**
   * Fires a building's activation. Returns false when nothing in the table
   * matched — for the capacitor that means the battery was short.
   */
  activateTower(towerId: EntityId): boolean {
    const tower = this.towers.get(towerId);
    const activation = tower?.def.activation;
    if (!tower || !activation) return false;
    // A capacitor that is itself shut down cannot fire (SYSTEMS.md §7.5).
    if (!tower.operational || tower.activationCooldown > 0) return false;

    const fired = this.trigger({
      trigger: 'on_activate',
      activation: activation.id,
      cell: tower.cell,
      source: { kind: 'tower', id: tower.id, defId: tower.defId },
      sourceTags: ['ability', 'overload'],
      params: activation.params,
    });
    if (fired.length === 0) return false;
    tower.activationCooldown = activation.cooldown;
    return true;
  }

  /**
   * The §9 ultimate. Charge accounting lives in `src/gameplay`; combat just
   * applies the effect when told to.
   */
  activateMasterOverload(): boolean {
    const fired = this.trigger({
      trigger: 'on_activate',
      activation: 'master_overload',
      source: { kind: 'ability' },
      sourceTags: ['ability', 'overload'],
      params: EMPTY_PARAMS,
    });
    if (fired.length === 0) return false;
    this.bus.emit('ability_master_overload', {
      towersAffected: this.towerList().filter((t) => t.state === 'overloaded').length,
      enemiesStunned: this.enemyList().filter((e) => e.statuses.has('stunned')).length,
      duration: ULTIMATE_OVERLOAD_DURATION,
    });
    return true;
  }

  /** Start-of-wave hook: map 2's sluice washes its oil away (GDD §5.2). */
  washFloodway(): void {
    for (const expiry of this.coatings.wash((cx, cy) => this.terrain.isFloodway(cx, cy))) {
      this.bus.emit('cell_coating_changed', {
        cx: expiry.cx,
        cy: expiry.cy,
        coating: 'none',
        duration: 0,
      });
    }
  }

  /** Debug helper: how loaded is the field, for the §15.3 particle budget. */
  coatedCellCount(): number {
    return this.coatings.size;
  }

  /** Clamps a world position into the grid; used by spawn helpers. */
  clampToGrid(position: Vec2): Vec2 {
    return {
      x: clamp(position.x, 0, this.terrain.width),
      y: clamp(position.y, 0, this.terrain.height),
    };
  }
}
