/**
 * `GameplayWorld` — the one object the rest of the game talks to.
 *
 * Wires the grid, the flow field, the engineering system and the wave runner
 * together and keeps the field in sync with terrain changes. Everything it owns
 * is also usable standalone; this is a convenience façade, not a god object.
 *
 * Not owned here (by design): gold, power, core integrity, towers and enemies.
 * The world exposes the hooks those systems call (`applyIntegrity`,
 * `destroyBridge`, `grid.setOccupied`) and emits events; it never reaches back.
 */

import type { CellCoord, Seconds, Vec2 } from './types';
import { GameplayEvents } from './events';
import type { SpawnRequest } from './events';
import { Grid } from './grid/Grid';
import type { GateState, ZoneState } from './grid/Grid';
import type { MapDef } from './grid/mapDef';
import type { FlowField } from './pathing/flowField';
import { computeFlowField, isReachable, straightLine, tracePath, tracePolyline } from './pathing/flowField';
import { EngineeringSystem } from './engineering/EngineeringSystem';
import type { EngineeringConfig } from './engineering/EngineeringSystem';
import { buildWavePlan } from './waves/waveGenerator';
import type { WaveEconomyRules, WavePlan } from './waves/waveGenerator';
import type { WaveTableDef } from './waves/baseWaveTable';
import type { EnemyWaveMeta } from './waves/enemyMeta';
import { WaveRunner } from './waves/WaveRunner';
import { GridTerrainQuery, FlowFieldMovement } from './adapters/terrainQuery';
import { SCOPE } from './rules/scope';

export interface GameplayWorldOptions {
  map: MapDef;
  waveTable?: WaveTableDef;
  enemyMeta?: Readonly<Record<string, EnemyWaveMeta>>;
  economy?: Partial<WaveEconomyRules>;
  engineering?: Partial<EngineeringConfig>;
  /** Lets engineering report `insufficient_gold`; the economy keeps the wallet. */
  getGold?: () => number;
  /** 丢区 (GDD §10). Off in M1 — see `rules/scope.ts`. */
  zoneLoss?: boolean;
  /**
   * Cost of walking through an impassable cell in the *movement* field. Finite
   * by design: a sapper can blow up the bridge under an enemy's feet, and a
   * stuck enemy with no direction would stall the wave forever. Legality checks
   * are unaffected — those always run strict.
   */
  blockedPenalty?: number;
  events?: GameplayEvents;
}

export class GameplayWorld {
  readonly events: GameplayEvents;
  readonly grid: Grid;
  readonly engineering: EngineeringSystem;
  readonly waves: WaveRunner;
  readonly plan: WavePlan;
  /** Satisfies `combat.TerrainQuery`. */
  readonly terrain: GridTerrainQuery;
  /** Satisfies `combat.MovementDriver` for ground units. */
  readonly movement: FlowFieldMovement;
  /** False in M1: thresholds are warning marks, not structural losses. */
  readonly zoneLossEnabled: boolean;

  private readonly blockedPenalty: number;
  private cachedField: FlowField | null = null;
  private cachedVersion = -1;

  constructor(options: GameplayWorldOptions) {
    this.events = options.events ?? new GameplayEvents();
    this.grid = new Grid(options.map);
    this.blockedPenalty = options.blockedPenalty ?? 1000;
    this.zoneLossEnabled = options.zoneLoss ?? SCOPE.zoneLoss;

    this.engineering = new EngineeringSystem({
      grid: this.grid,
      events: this.events,
      config: options.engineering,
      getGold: options.getGold,
    });

    this.plan = buildWavePlan({
      gates: this.grid.gates.map((gate) => ({ id: gate.id, openWave: gate.openWave })),
      table: options.waveTable,
      modifiers: this.grid.def.waveModifiers,
      enemyMeta: options.enemyMeta,
      economy: options.economy,
    });

    this.waves = new WaveRunner({
      plan: this.plan,
      events: this.events,
      gateCell: (gateId) => this.gateCell(gateId),
    });

    this.terrain = new GridTerrainQuery(this.grid);
    this.movement = new FlowFieldMovement(() => this.groundField);
  }

  // -------------------------------------------------------------------------
  // Pathing
  // -------------------------------------------------------------------------

  /**
   * Flow field ground units steer on. Rebuilt lazily whenever the grid version
   * changes (a dig completing, a bridge blowing up, a sluice opening).
   */
  get groundField(): FlowField {
    if (this.cachedField && this.cachedVersion === this.grid.version) return this.cachedField;
    this.cachedField = computeFlowField(this.grid, this.grid.coreCells, {
      blockedPenalty: this.blockedPenalty,
    });
    this.cachedVersion = this.grid.version;

    const unreachableGates = this.grid.gates
      .filter((gate) => !gate.cells.some((cell) => isReachable(this.cachedField as FlowField, cell.cx, cell.cy)))
      .map((gate) => gate.id);

    this.events.emit('flow_field_rebuilt', { version: this.grid.version, unreachableGates });
    return this.cachedField;
  }

  /** Forces a rebuild on next access; normally the version counter is enough. */
  invalidateField(): void {
    this.cachedVersion = -1;
  }

  /** Walking route from a gate to the core, in cells. */
  pathFromGate(gateId: string): CellCoord[] {
    const cell = this.gateCell(gateId);
    if (!cell) return [];
    return tracePath(this.groundField, cell);
  }

  /** Same route as a cell-centre polyline for `combat.PolylineMovement`. */
  polylineFromGate(gateId: string): Vec2[] {
    const cell = this.gateCell(gateId);
    if (!cell) return [];
    return tracePolyline(this.groundField, cell);
  }

  /** Flying route: straight at the core, ignoring terrain (GDD §5.1). */
  flightPathFromGate(gateId: string): Vec2[] {
    const cell = this.gateCell(gateId);
    const core = this.grid.coreCells[0];
    if (!cell || !core) return [];
    return straightLine(cell, core);
  }

  gateCell(gateId: string): CellCoord | null {
    return this.grid.gate(gateId)?.cells[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Wave flow
  // -------------------------------------------------------------------------

  /** Opens due gates and hands out scheduled engineering charges, then starts. */
  startWave(options: { early?: boolean } = {}): boolean {
    const next = this.waves.nextWave;
    if (!next) return false;

    // Scripted terrain first: map 1's wave-5 breach unseals both the side route
    // and the cell `gate_1b` spawns on, so it has to land before the gates sync
    // and before anything reads the flow field.
    this.openScheduledBarriers(next.wave);
    for (const gate of this.grid.syncGatesToWave(next.wave)) {
      this.events.emit('gate_opened', { gateId: gate.id, wave: next.wave });
    }
    this.engineering.applyGrantsForWave(next.wave);
    return this.waves.startWave(options);
  }

  /**
   * Barriers with an `openAtWave` schedule (GDD §11 波 5 演出). Zone-driven
   * sluices are not touched here — those go through `applyIntegrity`.
   */
  private openScheduledBarriers(wave: number): void {
    for (const barrier of this.grid.openBarriersForWave(wave)) {
      const cells = barrier.cells.map(({ cx, cy }) => ({ cx, cy }));
      this.events.emit('barrier_opened', { barrierId: barrier.id, cells });
      this.events.emit('terrain_changed', { cells, reason: 'barrier_opened' });
    }
  }

  /** Drives engineering timers and the spawn schedule. */
  tick(dt: Seconds): SpawnRequest[] {
    this.engineering.tick(dt);
    return this.waves.tick(dt);
  }

  // -------------------------------------------------------------------------
  // Hooks for systems the gameplay module does not own
  // -------------------------------------------------------------------------

  /** Zones whose threshold the current integrity has reached, lost or not. */
  breachedZones(integrity: number): ZoneState[] {
    return this.grid.zones.filter((zone) => integrity <= zone.def.triggerIntegrity);
  }

  /**
   * Called by the integrity system (GDD §10) after every change. Loses every
   * zone whose threshold has been crossed and opens the sluice attached to it.
   * Lost zones are never restored, so this is safe to call every frame.
   *
   * With `zoneLoss` off (M1, the default — see `rules/scope.ts`) this never
   * loses anything: integrity is a score the player watches fall, and the run
   * ends when it reaches 0, not when it passes 80 or 50.
   *
   * @returns zones lost by this call; the caller subtracts their power penalty.
   */
  applyIntegrity(integrity: number): ZoneState[] {
    if (!this.zoneLossEnabled) return [];

    const lost: ZoneState[] = [];
    for (const zone of this.grid.zones) {
      if (!zone.powered) continue;
      if (integrity > zone.def.triggerIntegrity) continue;
      this.grid.setZonePowered(zone.id, false);
      const barrierId = zone.def.opensBarrier ?? null;
      const cells = barrierId ? this.grid.openBarrier(barrierId) : [];
      if (barrierId && cells.length > 0) {
        this.events.emit('barrier_opened', { barrierId, cells });
        this.events.emit('terrain_changed', { cells, reason: 'barrier_opened' });
      }
      this.events.emit('zone_lost', {
        zoneId: zone.id,
        powerPenalty: zone.def.powerPenalty,
        openedBarrier: barrierId,
      });
      lost.push(zone);
    }
    return lost;
  }

  /** Sapper crab payload; combat emits `bridge_destroyed`, gameplay edits terrain. */
  destroyBridge(cx: number, cy: number, byEnemy?: number): boolean {
    return this.engineering.destroyBridge(cx, cy, byEnemy);
  }

  get openGates(): GateState[] {
    return this.grid.openGates();
  }
}

export function createGameplayWorld(options: GameplayWorldOptions): GameplayWorld {
  return new GameplayWorld(options);
}
