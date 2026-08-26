/**
 * One playable run: board + economy + waves + combat, on a 60 Hz fixed step.
 *
 * `GameplayWorld` is the board; this is the *game*. It owns the tick order,
 * the win/lose state and the snapshot the HUD renders, and it is the object the
 * engine layer holds:
 *
 * ```ts
 * const session = createGameSession({ map: MAP1_POWERHOUSE });
 * const combat = new CombatSystem({
 *   terrain: session.terrain,     // GridTerrainQuery
 *   movement: session.movement,   // flow field + straight-line flight
 *   power: session.power,         // the battery, GDD §6.2
 * });
 * session.attachCombat(combat);   // spawns, bounties, leaks, bridges, blackouts
 *
 * session.commands.armDig();      // 挖沟按钮
 * session.commands.clickCell(8, 2);
 * session.commands.startWave();
 * // every fixed step (SIM.fixedDelta = 1/60):
 * session.tick(1 / 60);
 * ```
 *
 * Combat is optional: with nothing attached the board, the wallet, the wave
 * clock and every legality rule still run, which is what `selfcheck.ts` and the
 * bench harnesses use.
 */

import type { CellCoord, Seconds } from '../types';
import { GameplayEvents } from '../events';
import type { SpawnRequest } from '../events';
import type { MapDef } from '../grid/mapDef';
import type { WaveTableDef } from '../waves/baseWaveTable';
import type { EnemyWaveMeta } from '../waves/enemyMeta';
import type { WaveEconomyRules, WavePreviewEntry } from '../waves/waveGenerator';
import type { EngineeringConfig, EngineeringHint } from '../engineering/EngineeringSystem';
import type { MilestoneId } from '../rules/scope';
import { GameplayWorld } from '../world';
import type { EconomyRules } from '../economy/Economy';
import { Economy } from '../economy/Economy';
import { BuildSystem } from '../build/BuildSystem';
import type { PlacedTower } from '../build/BuildSystem';
import { CombatLink } from '../integration/CombatLink';
import type { CombatContentView, CombatPort } from '../integration/combatPort';
import type { CommandButtons, ToolKind } from '../commands/CommandCenter';
import { CommandCenter } from '../commands/CommandCenter';

export type RunStatus = 'preparing' | 'running' | 'won' | 'lost';

export interface BuildMenuItem {
  defId: string;
  name: string;
  icon: string;
  cost: number;
  powerCost: number;
  targetsAir: boolean;
  unlocked: boolean;
  /** Wave the blueprint unlocks on, so a locked slot can say *when* (GDD §11). */
  unlockWave: number;
  /** Gold and supply both check out right now. */
  affordable: boolean;
  /** Missing supply points, for the §14.1 grey-out badge. */
  powerDeficit: number;
}

export interface SessionSnapshot {
  status: RunStatus;
  gold: number;
  wave: { current: number; total: number; inProgress: boolean };
  nextWave: { preview: WavePreviewEntry[]; earlyBonusPercent: number; canCallEarly: boolean };
  power: { used: number; cap: number; deficit: number };
  battery: { value: number; max: number; overloadCost: number };
  integrity: {
    value: number;
    max: number;
    /**
     * False in M1: the marks below warn how badly the core is doing, they are
     * not zones about to drop out (`rules/scope.ts`).
     */
    lossEnabled: boolean;
    thresholds: {
      value: number;
      label: string;
      /** Integrity has reached the mark. */
      breached: boolean;
      /** The zone is actually gone; always false while `lossEnabled` is off. */
      lost: boolean;
    }[];
  };
  ultimate: { charges: number; maxCharges: number };
  engineering: {
    digLeft: number;
    bridgeLeft: number;
    /** Price of the next use; 0 while a free tutorial charge is unspent. */
    digCost: number;
    bridgeCost: number;
    /** Free charges left, so the HUD can label the button 「赠送」. */
    freeDig: number;
    freeBridge: number;
    /** Cell an unspent tutorial charge points at, for the board highlight. */
    recommended: EngineeringHint | null;
    armed: 'dig' | 'bridge' | null;
  };
  build: BuildMenuItem[];
  selectedBuildId: string | null;
  liveEnemies: number;
  buttons: CommandButtons;
}

export interface GameSessionOptions {
  map: MapDef;
  waveTable?: WaveTableDef;
  enemyMeta?: Readonly<Record<string, EnemyWaveMeta>>;
  waveEconomy?: Partial<WaveEconomyRules>;
  engineering?: Partial<EngineeringConfig>;
  economy?: Partial<EconomyRules>;
  /** Tower catalogue before combat attaches; combat's own replaces it. */
  content?: CombatContentView;
  /**
   * Blueprint unlock schedule (GDD §11). Defaults to the table's
   * `ui.unlockWave`; a sandbox or a test passes `() => true`.
   */
  isBlueprintUnlocked?: (defId: string, wave: number) => boolean;
  events?: GameplayEvents;
  blockedPenalty?: number;
  /**
   * Scope the run plays under; defaults to `CURRENT_MILESTONE`. M1 is the
   * tutorial slice, where integrity only ever costs score and, at zero, the
   * run — see `rules/scope.ts`.
   */
  milestone?: MilestoneId;
  /** 丢区 (GDD §10) override, beating both the map table and the milestone. */
  zoneLoss?: boolean;
  /** False when the engine drives `combat.update` itself. */
  driveCombat?: boolean;
}

export class GameSession {
  readonly events: GameplayEvents;
  readonly world: GameplayWorld;
  readonly economy: Economy;
  readonly build: BuildSystem;
  readonly link: CombatLink;
  readonly commands: CommandCenter;

  private runStatus: RunStatus = 'preparing';
  private readonly driveCombat: boolean;

  constructor(options: GameSessionOptions) {
    this.events = options.events ?? new GameplayEvents();
    this.driveCombat = options.driveCombat ?? true;

    this.economy = new Economy({
      events: this.events,
      ...(options.economy ? { rules: options.economy } : {}),
    });

    this.world = new GameplayWorld({
      map: options.map,
      events: this.events,
      // Engineering asks before it lets the player arm a charge; the wallet
      // itself is only ever debited from `engineering_started` below.
      getGold: () => this.economy.gold,
      ...(options.waveTable ? { waveTable: options.waveTable } : {}),
      ...(options.enemyMeta ? { enemyMeta: options.enemyMeta } : {}),
      ...(options.waveEconomy ? { economy: options.waveEconomy } : {}),
      ...(options.engineering ? { engineering: options.engineering } : {}),
      ...(options.blockedPenalty !== undefined ? { blockedPenalty: options.blockedPenalty } : {}),
      ...(options.milestone ? { milestone: options.milestone } : {}),
      ...(options.zoneLoss !== undefined ? { zoneLoss: options.zoneLoss } : {}),
    });

    this.build = new BuildSystem({
      grid: this.world.grid,
      economy: this.economy,
      events: this.events,
      ...(options.content ? { content: options.content } : {}),
      ...(options.isBlueprintUnlocked ? { isUnlocked: options.isBlueprintUnlocked } : {}),
      currentWave: () => this.world.waves.nextWave?.wave ?? this.world.waves.waveNumber,
    });

    this.link = new CombatLink({
      world: this.world,
      economy: this.economy,
      build: this.build,
      events: this.events,
      ...(options.enemyMeta ? { enemyMeta: options.enemyMeta } : {}),
    });

    this.commands = new CommandCenter({
      engineering: this.world.engineering,
      build: this.build,
      economy: this.economy,
      waves: this.world.waves,
      events: this.events,
      startWave: (early) => this.startWave({ early }),
      fireUltimate: () => this.fireUltimate(),
      activateTower: (towerId) => this.link.system?.activateTower(towerId) ?? false,
      upgradeTower: (towerId, upgradeId) => this.upgradeTower(towerId, upgradeId),
      isRunOver: () => this.finished,
    });

    // Engineering never touches the wallet itself (module contract); the
    // economy pays when a job actually starts. A tutorial charge is free, and
    // billing 0 gold would still emit a `gold_changed` the HUD would flash.
    this.events.on('engineering_started', (job) => {
      if (job.cost > 0) this.economy.spend(job.cost, 'engineering');
    });
    this.events.on('run_lost', () => {
      this.runStatus = 'lost';
    });
  }

  // -------------------------------------------------------------------------
  // Combat ports
  // -------------------------------------------------------------------------

  /** `combat.TerrainQuery`. */
  get terrain(): GameplayWorld['terrain'] {
    return this.world.terrain;
  }

  /** `combat.MovementDriver`: flow field for walkers, straight line for flyers. */
  get movement(): CombatLink['movement'] {
    return this.link.movement;
  }

  /** `combat.PowerSupply`: the §6.2 battery. */
  get power(): Economy {
    return this.economy;
  }

  attachCombat(combat: CombatPort): void {
    this.build.attachCombat(combat);
    this.link.attach(combat);
  }

  // -------------------------------------------------------------------------
  // Run state
  // -------------------------------------------------------------------------

  get status(): RunStatus {
    return this.runStatus;
  }

  get finished(): boolean {
    return this.runStatus === 'won' || this.runStatus === 'lost';
  }

  /** Opens due gates (the wave-10 second breach), grants charges, starts. */
  startWave(options: { early?: boolean } = {}): boolean {
    if (this.finished) return false;
    if (!this.world.startWave(options)) return false;
    this.runStatus = 'running';
    // Map 2: the floodway washes last wave's oil away (GDD §5.2).
    this.link.washFloodway();
    return true;
  }

  /**
   * One fixed step. Order matters: terrain and the spawn clock first so a job
   * finishing this tick re-routes before anything moves, then combat, then the
   * battery, then the clear check.
   */
  tick(dt: Seconds): SpawnRequest[] {
    if (this.finished) return [];

    const requests = this.world.tick(dt);
    this.link.dispatch(requests);
    if (this.driveCombat) this.link.update(dt);
    this.economy.tick(dt);
    this.settleWave();
    return requests;
  }

  /**
   * The signed-delta integrity hook (INTEGRATION.md §4.2-4). Anything outside
   * gameplay that damages or repairs the core comes through here — the assembly
   * layer bridges `combat:enemy_leaked` to it — and it settles the whole chain:
   * the number, the `integrity_changed` event, the 80/50 substation latch (off
   * in M1, see `rules/scope.ts`) and the §10 defeat check, which always runs.
   *
   * Leaks route through `CombatLink` instead, because the leak payload also
   * carries stolen gold and the Leviathan's instant loss.
   *
   * @returns the integrity left after the change.
   */
  applyIntegrity(delta: number, reason: string): number {
    const integrity =
      delta < 0
        ? this.economy.damageIntegrity(-delta, reason)
        : this.economy.healIntegrity(delta, reason);
    this.link.settleIntegrity(integrity);
    if (integrity <= 0) this.link.declareDefeat('integrity');
    return integrity;
  }

  /**
   * Sapper-crab hook (INTEGRATION.md §4.2-4): the terrain reverts to a gully and
   * the flow field re-routes. The engineering charge is *not* refunded.
   */
  destroyBridge(cx: number, cy: number): boolean {
    return this.world.destroyBridge(cx, cy);
  }

  towerAt(cx: number, cy: number): PlacedTower | undefined {
    return this.build.towerAt(cx, cy);
  }

  /** Cells the armed tool may be used on, for board highlighting. */
  highlightTargets(): CellCoord[] {
    return this.commands.targets();
  }

  get armedTool(): ToolKind | null {
    return this.commands.armed;
  }

  // -------------------------------------------------------------------------
  // Snapshot (GDD §14.1)
  // -------------------------------------------------------------------------

  snapshot(): SessionSnapshot {
    const economy = this.economy.snapshot();
    const armed = this.commands.armed;
    return {
      status: this.runStatus,
      gold: economy.gold,
      wave: {
        current: this.world.waves.waveNumber,
        total: this.world.waves.totalWaves,
        inProgress: this.world.waves.state !== 'preparing' && this.world.waves.state !== 'complete',
      },
      nextWave: {
        preview: this.world.waves.nextPreview,
        earlyBonusPercent: Math.round((this.world.waves.nextWave?.earlyStartBonus ?? 0.1) * 100),
        canCallEarly: this.world.waves.state === 'preparing' && this.world.waves.nextWave !== null,
      },
      power: economy.power,
      battery: economy.battery,
      integrity: {
        value: economy.integrity.value,
        max: economy.integrity.max,
        lossEnabled: this.world.zoneLossEnabled,
        thresholds: this.world.grid.zones.map((zone) => ({
          value: zone.def.triggerIntegrity,
          label: zone.def.label ?? zone.id,
          breached: economy.integrity.value <= zone.def.triggerIntegrity,
          lost: !zone.powered,
        })),
      },
      ultimate: economy.ultimate,
      engineering: {
        digLeft: this.world.engineering.digLeft,
        bridgeLeft: this.world.engineering.bridgeLeft,
        digCost: this.world.engineering.costOf('dig'),
        bridgeCost: this.world.engineering.costOf('bridge'),
        freeDig: this.world.engineering.freeOf('dig'),
        freeBridge: this.world.engineering.freeOf('bridge'),
        recommended: this.world.engineering.recommendation,
        armed: armed === 'dig' || armed === 'bridge' ? armed : null,
      },
      build: this.buildMenu(),
      selectedBuildId: this.commands.selectedBuildId,
      liveEnemies: this.link.liveEnemies,
      buttons: this.commands.buttons(),
    };
  }

  private buildMenu(): BuildMenuItem[] {
    return this.build.catalogue.map((def) => {
      const affordableGold = this.economy.canAfford(def.cost);
      const affordablePower = this.economy.canDraw(def.powerCost);
      return {
        defId: def.id,
        name: def.displayName,
        icon: def.ui.icon,
        cost: def.cost,
        powerCost: def.powerCost,
        targetsAir: def.attack.targetsAir ?? false,
        unlocked: this.build.isUnlocked(def.id),
        unlockWave: this.build.unlockWaveOf(def.id) ?? 1,
        affordable: affordableGold && affordablePower,
        powerDeficit: affordablePower
          ? 0
          : Math.max(0, this.economy.powerUsed + def.powerCost - this.economy.powerCap),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The wave runner does not track entities, so the clear signal comes from
   * here: everything spawned, nothing alive (brood included).
   */
  private settleWave(): void {
    if (this.world.waves.state !== 'clearing') return;
    if (this.link.attached && this.link.liveEnemies > 0) return;

    const result = this.world.waves.notifyWaveCleared();
    if (!result) return;

    this.economy.earn(result.total, 'wave_reward');
    this.economy.notifyWaveCleared();
    // No wave left to prepare for means that was the twentieth (GDD §12).
    this.runStatus = this.world.waves.nextWave === null ? 'won' : 'preparing';
  }

  private fireUltimate(): boolean {
    const combat = this.link.system;
    if (!combat) return false;
    if (!this.economy.spendUltimateCharge()) return false;
    if (!combat.activateMasterOverload()) {
      // Nothing in the reaction table matched; hand the charge back.
      this.economy.ultimateCharges += 1;
      return false;
    }
    this.events.emit('ultimate_fired', { chargesLeft: this.economy.ultimateCharges });
    return true;
  }

  private upgradeTower(towerId: number, upgradeId: string): boolean {
    const combat = this.link.system;
    return combat ? combat.upgradeTower(towerId, upgradeId) : false;
  }
}

export function createGameSession(options: GameSessionOptions): GameSession {
  return new GameSession(options);
}
