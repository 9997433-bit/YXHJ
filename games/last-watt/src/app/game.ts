/**
 * The M1 vertical slice, assembled.
 *
 * Nothing here decides a rule. `GameSession` owns the board, the wallet, the
 * wave clock and every legality check; `CombatSystem` owns towers, enemies and
 * the reaction table; the engine's `Loop` owns the frame protocol and
 * `attachVfxToEngine` owns the hit-stop, the shake and the bloom mask. What is
 * left — and all this file does — is hand those four to each other, keep three
 * scene views in sync with the entity lists, and turn input into commands.
 *
 * Frame order is the engine's (INTEGRATION.md §1.1): `onFrameBegin` sets the
 * time scale from the impact director, `onFixedUpdate` runs the 60 Hz
 * simulation, `onRender` updates presentation, `onPresent` draws. Views
 * subscribe to `onRender` so everything visual has been written before the
 * draw, and they advance on `scaledDelta` so a shatter's hit-stop freezes the
 * turrets along with the world.
 */

import map1Json from '../../data/maps/map1.json';
import wavesJson from '../../data/waves.map1.json';

import { CombatSystem, TOWER_IDS, type Tower } from '../combat';
import { Engine } from '../engine';
import {
  createGameSession,
  importMapDefJson,
  importWaveTableJson,
  type GameSession,
  type MapJson,
  type WaveTableJson,
} from '../gameplay';
import { VfxSystem, attachVfxToEngine, connectCombatToVfx, type CombatVfxBridge, type VfxEngineBridge } from '../vfx';

import { M1_BUILD_MENU } from './config';
import { HudBridge, towerRange } from './hudBridge';
import { InputController } from './input';
import { Interaction } from './interaction';
import { RunOverlay } from './runOverlay';
import { BoardView } from './view/BoardView';
import { EnemyView } from './view/EnemyView';
import { TowerView } from './view/TowerView';

/** A tower is "lit" in these states; everything else dims its accent. */
const ONLINE_STATES = new Set(['idle', 'overloaded']);

/** Playtest gold grant (the `G` key). Not a design number — see `input.ts`. */
const DEV_GOLD = 400;

const M1_DEF_IDS = new Set(M1_BUILD_MENU.map((entry) => entry.defId));

export interface GameOptions {
  container: HTMLElement;
  autoStart?: boolean;
  /**
   * Lifts `data/waves.map1.json.unlock_schedule` for the whole run.
   *
   * Off by default: the schedule *is* the tutorial, and a slice that opens with
   * all five blueprints teaches a pacing the real game never has. Headless
   * probes that need the shatter chain in one wave pass true; a playtester
   * reaches the same state with the `U` hotkey, which is announced on screen so
   * a session running with it can never be mistaken for the default one.
   */
  unlockAll?: boolean;
  /**
   * Invoked by the result panel's 重开 button. The assembly layer cannot
   * restart itself — disposing the engine from inside its own frame callback is
   * a use-after-free — so `main.ts` owns the teardown and re-boot.
   */
  onRestart?: () => void;
}

export class Game {
  readonly engine: Engine;
  readonly session: GameSession;
  readonly combat: CombatSystem;
  readonly vfx = new VfxSystem();
  readonly interaction = new Interaction();

  readonly board: BoardView;
  readonly towers = new TowerView();
  readonly enemies = new EnemyView();
  readonly hud: HudBridge;
  readonly input: InputController;
  readonly overlay: RunOverlay;

  /** Frames rendered since boot; the headless probe waits on this. */
  frames = 0;

  private readonly vfxEngine: VfxEngineBridge;
  private readonly vfxCombat: CombatVfxBridge;
  private readonly unsubscribe: Array<() => void> = [];

  private paused = false;
  private resultDetail: string | null = null;
  /** Dev aids used this run, so no screenshot can pass for the default pacing. */
  private readonly devAids = { unlockAll: false, goldGrants: 0 };

  private routeVersion = -1;
  private fpsSince = 0;
  private fpsFrames = 0;
  private fps = 0;
  private simTicks = 0;
  private simHz = 0;

  constructor(options: GameOptions) {
    const { container } = options;

    // The emissive testbed is R1 scaffolding and the engine's `GridView` is a
    // flat control slab; `BoardView` replaces the latter with real relief.
    this.engine = new Engine(container, { testbed: false });
    this.engine.gridView.root.visible = false;

    const map = importMapDefJson(map1Json as unknown as MapJson);
    this.session = createGameSession({
      map,
      waveTable: importWaveTableJson(
        wavesJson as unknown as WaveTableJson,
        map.gates.map((gate) => gate.id),
      ),
    });
    this.combat = new CombatSystem({
      terrain: this.session.terrain,
      movement: this.session.movement,
      power: this.session.power,
    });
    this.session.attachCombat(this.combat);

    this.board = new BoardView(this.session.world.grid);
    this.engine.scene.add(this.board.root, this.towers.root, this.enemies.root);

    this.hud = new HudBridge(container, this.session, this.combat, this.interaction);
    this.overlay = new RunOverlay(container, {
      ...(options.onRestart ? { onRestart: options.onRestart } : {}),
    });
    this.input = new InputController({
      engine: this.engine,
      session: this.session,
      interaction: this.interaction,
      hud: this.hud,
      onDevGold: () => this.grantDevGold(),
      onToggleUnlockAll: () => this.setDevUnlockAll(!this.devAids.unlockAll),
      onTogglePause: () => this.setPaused(!this.paused),
      ...(options.onRestart ? { onRestart: options.onRestart } : {}),
    });
    if (options.unlockAll === true) this.setDevUnlockAll(true);

    this.vfxEngine = attachVfxToEngine(this.engine, this.vfx, {
      onImpact: (impact) => this.hud.hud.applyImpact(impact),
    });

    // After the VFX bridge, so a pause wins over the impact director's time
    // scale instead of being overwritten by it every frame.
    this.unsubscribe.push(
      this.engine.onFrameBegin(() => {
        if (this.paused) this.engine.loop.timeScale = 0;
      }),
    );
    this.vfxCombat = connectCombatToVfx(this.combat.bus, this.vfx, {
      mistTowers: [TOWER_IDS.condenserJet],
      onComboFirstSeen: (comboId) => this.hud.showComboTip(comboId),
    });

    this.bindViews();
    this.board.syncTerrain(true);

    this.unsubscribe.push(
      this.engine.onFixedUpdate(({ delta }) => {
        this.simTicks += 1;
        this.session.tick(delta);
      }),
      this.engine.onRender(({ scaledDelta }) => this.present(scaledDelta)),
      this.engine.onPresent(() => this.measure()),
    );

    if (options.autoStart !== false) this.engine.start();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  /**
   * Scene rigs are event-driven rather than diffed against the tower list: a
   * silhouette is built once and a rebuild would drop its animation state
   * mid-swing. Enemies are the opposite — they come and go every second — so
   * `EnemyView` reconciles against the live list instead.
   */
  private bindViews(): void {
    const bus = this.combat.bus;

    this.unsubscribe.push(
      bus.on('tower_built', (event) => {
        const cx = Math.floor(event.cell.x);
        const cy = Math.floor(event.cell.y);
        this.towers.add(event.towerId, event.defId, cx, cy, this.board.surfaceHeight(cx, cy));
      }),
      bus.on('tower_sold', (event) => this.towers.remove(event.towerId)),
      bus.on('tower_fired', (event) => this.towers.fired(event.towerId)),
      bus.on('tower_state_changed', (event) => {
        this.towers.setOnline(event.towerId, ONLINE_STATES.has(event.state));
      }),
      bus.on('enemy_damaged', (event) => this.enemies.hit(event.enemyId)),
    );
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
  }

  // ---------------------------------------------------------------------------
  // Pause and dev aids
  // ---------------------------------------------------------------------------

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Freezes the simulation without stopping the loop.
   *
   * `engine.stop()` would be the obvious move and is the wrong one: it also
   * stops rendering, so the HUD, the frame meter and the pause banner itself
   * all go stale behind a frozen canvas. Zeroing the time scale is the same
   * mechanism the shatter hit-stop already uses, just held open.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.engine.loop.timeScale = 1;
    this.hud.notify(paused ? '已暂停（P 继续）' : '继续', paused ? 'paused' : 'resumed');
  }

  /** The `U` hotkey and the `unlockAll` option, which are the same switch. */
  setDevUnlockAll(enabled: boolean): void {
    this.devAids.unlockAll = enabled;
    this.session.build.setUnlockOverride(enabled ? (defId) => M1_DEF_IDS.has(defId) : null);
    this.hud.notify(
      enabled ? '调试：解除图纸解锁表' : '调试：恢复真实解锁表',
      `dev-unlock:${enabled}`,
    );
  }

  private grantDevGold(): void {
    this.devAids.goldGrants += 1;
    this.session.economy.earn(DEV_GOLD, 'dev_grant');
    this.hud.notify(`调试：+${DEV_GOLD} 金币`, `dev-gold:${this.devAids.goldGrants}`);
  }

  /** Presentation for one frame, on the simulation's clock. */
  private present(dt: number): void {
    const towers = this.combat.towerList();
    this.board.update(dt);
    this.towers.update(dt, towers);
    this.enemies.update(dt, this.combat.enemyList(), this.engine.camera);

    this.syncBoard();
    this.syncCursor(towers);

    this.hud.tick();
    this.hud.hud.setState(this.hud.build());
    this.syncOverlay();
  }

  /**
   * A finished run outranks a pause: `GameSession.tick` already returns early
   * once the run is decided, so "paused" would be a lie the player can act on.
   */
  private syncOverlay(): void {
    const status = this.session.status;
    if (status === 'lost' || status === 'won') {
      // Frozen at the moment the run ended; re-reading it every frame would
      // rebuild the whole snapshot for numbers that can no longer change.
      this.resultDetail ??= this.resultLine(status);
      this.overlay.show(status, this.resultDetail);
      return;
    }
    this.overlay.show(this.paused ? 'paused' : 'none');
  }

  private resultLine(status: 'lost' | 'won'): string {
    const snapshot = this.session.snapshot();
    const wave = `第 ${snapshot.wave.current} / ${snapshot.wave.total} 波`;
    return status === 'won'
      ? `${wave} · 完整度 ${Math.round(snapshot.integrity.value)}`
      : `${wave} · 核心完整度归零`;
  }

  /** Gate-to-core routes, redrawn only when a dig or a breach moves the field. */
  private syncBoard(): void {
    this.board.syncTerrain();
    this.board.setHighlights(this.session.highlightTargets());
    if (this.routeVersion === this.session.world.grid.version) return;
    this.routeVersion = this.session.world.grid.version;
    this.board.syncRoutes(this.session.world.groundField, this.session.world.openGates);
  }

  private syncCursor(towers: readonly Tower[]): void {
    const hover = this.interaction.hover;
    const commands = this.session.commands;
    const armed = commands.armed;

    if (hover && armed === 'build' && commands.selectedBuildId) {
      const defId = commands.selectedBuildId;
      const check = this.session.build.check(defId, hover.cx, hover.cy);
      this.board.setCursor({
        cx: hover.cx,
        cy: hover.cy,
        valid: check.ok,
        range: towerRange(this.combat.content.tower(defId)),
      });
      return;
    }

    if (hover && (armed === 'dig' || armed === 'bridge')) {
      const check = this.session.world.engineering.check(armed, hover.cx, hover.cy);
      this.board.setCursor({ cx: hover.cx, cy: hover.cy, valid: check.ok, range: 0 });
      return;
    }

    const selected = this.interaction.selectedTowerId;
    if (selected !== null) {
      const tower = towers.find((candidate) => candidate.id === selected);
      if (tower) {
        this.board.setCursor({
          cx: tower.cell.cx,
          cy: tower.cell.cy,
          valid: true,
          range: towerRange(tower.baseDef),
        });
        return;
      }
    }

    this.board.setCursor(hover ? { cx: hover.cx, cy: hover.cy, valid: true, range: 0 } : null);
  }

  /**
   * Wall clock, not the loop's delta: the loop clamps its delta to
   * `fixedDelta * maxSubSteps` so nothing can fast-forward the simulation after
   * a stall, which also means a frame delta can never report worse than 12 fps.
   * A frame-rate meter that bottoms out at 12 hides exactly the stalls it is
   * there to catch, and it would hide the sim falling behind 60 Hz with it.
   */
  private measure(): void {
    this.frames += 1;
    this.fpsFrames += 1;

    const now = performance.now();
    if (this.fpsSince === 0) {
      this.fpsSince = now;
      return;
    }
    const window = (now - this.fpsSince) / 1000;
    if (window < 0.5) return;

    this.fps = this.fpsFrames / window;
    this.simHz = this.simTicks / window;
    this.fpsSince = now;
    this.fpsFrames = 0;
    this.simTicks = 0;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Snapshot for the console probe and the dev overlay. */
  diagnostics(): Record<string, unknown> {
    const snapshot = this.session.snapshot();
    return {
      fps: Math.round(this.fps),
      /** Fixed steps per wall second. Below 60 the run is in slow motion. */
      simHz: Math.round(this.simHz),
      frames: this.frames,
      status: snapshot.status,
      wave: `${snapshot.wave.current}/${snapshot.wave.total}`,
      gold: Math.floor(snapshot.gold),
      power: `${snapshot.power.used}/${snapshot.power.cap}`,
      integrity: Math.round(snapshot.integrity.value),
      towers: this.combat.towerList().length,
      enemies: this.combat.enemyList().length,
      particles: this.vfx.stats.aliveParticles,
      vfxPlayed: { ...this.vfxCombat.played },
      drawCalls: this.engine.renderer.info.render.calls,
      buildMenu: snapshot.build.map((item) => item.defId),
      unlocked: snapshot.build.filter((item) => item.unlocked).map((item) => item.defId),
      paused: this.paused,
      /** Non-default aids in force. Empty is the only value a perf or pacing report may cite. */
      devAids: this.devAidsInUse(),
    };
  }

  private devAidsInUse(): string[] {
    const aids: string[] = [];
    if (this.devAids.unlockAll) aids.push('unlockAll');
    if (this.devAids.goldGrants > 0) aids.push(`gold+${this.devAids.goldGrants * DEV_GOLD}`);
    return aids;
  }

  dispose(): void {
    this.stop();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;

    this.input.dispose();
    this.vfxCombat.detach();
    this.vfxEngine.detach();
    this.overlay.dispose();
    this.hud.dispose();
    this.enemies.dispose();
    this.towers.dispose();
    this.board.dispose();
    this.vfx.dispose();
    this.engine.dispose();
  }
}
