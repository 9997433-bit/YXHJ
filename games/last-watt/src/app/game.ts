/**
 * The M1 vertical slice, assembled.
 *
 * Owns the frame: every other module is passive and gets called from here in a
 * fixed order. That order is not arbitrary — the VFX layer's hitstop only works
 * if the simulation adopts the `timeScale` it hands back, so the loop has to
 * open the VFX frame *before* stepping the world and close it *after*
 * (`src/vfx/VfxSystem.ts`). The engine's own `Loop` is deliberately left idle
 * for the same reason: it renders at the end of its render signal, which is one
 * step too early to see this frame's particles.
 *
 * Simulation runs at a fixed 60 Hz (`SIM.fixedDelta`) regardless of display
 * rate; presentation interpolates nothing yet, which is honest for a greybox
 * and keeps a dropped frame from desyncing the reaction table.
 */

import { Vector2, Vector3 } from 'three';

import { Engine, SIM } from '../engine';
import type { Tower } from '../combat';
import { VfxSystem } from '../vfx';

import { M1_BUILD_MENU } from './config';
import { HudBridge, towerRange } from './hudBridge';
import { InputController } from './input';
import { Interaction } from './interaction';
import { Sim } from './sim';
import { VfxBridge } from './vfxBridge';
import { BoardView } from './view/BoardView';
import { EnemyView } from './view/EnemyView';
import { TowerView } from './view/TowerView';

/** A tower is "lit" in these states; everything else dims its accent. */
const ONLINE_STATES = new Set(['idle', 'overloaded']);

/** Playtest gold grant (the `G` key). Not a design number — see `input.ts`. */
const DEV_GOLD = 400;

export interface GameOptions {
  container: HTMLElement;
  /** Off in screenshot/probe runs so the first frame is deterministic. */
  autoStart?: boolean;
}

export class Game {
  readonly engine: Engine;
  readonly sim = new Sim();
  readonly vfx: VfxSystem;
  readonly interaction = new Interaction();

  readonly board: BoardView;
  readonly towers = new TowerView();
  readonly enemies = new EnemyView();
  readonly hud: HudBridge;
  readonly input: InputController;
  readonly vfxBridge: VfxBridge;

  /** Frames rendered since boot; the headless probe waits on this. */
  frames = 0;

  private readonly unsubscribe: Array<() => void> = [];
  private readonly appliedShake = new Vector3();
  private readonly shakeRight = new Vector3();
  private readonly shakeUp = new Vector3();
  private readonly surface = new Vector3();
  private readonly bufferSize = new Vector2();

  private rafId = 0;
  private running = false;
  private lastFrameMs = 0;
  private accumulator = 0;
  private routeVersion = -1;
  private fpsWindow = 0;
  private fpsFrames = 0;
  private fps = 0;

  constructor(options: GameOptions) {
    const { container } = options;

    // The emissive testbed is R1 scaffolding and the engine's `GridView` is a
    // flat control slab; `BoardView` replaces the latter with real relief.
    this.engine = new Engine(container, { testbed: false });
    this.engine.gridView.root.visible = false;

    this.vfx = new VfxSystem();
    this.board = new BoardView(this.sim.world.grid);

    this.engine.scene.add(this.board.root, this.towers.root, this.enemies.root);
    this.vfx.attachTo(this.engine.scene);

    this.hud = new HudBridge(container, this.sim, this.interaction);
    this.vfxBridge = new VfxBridge({
      combat: this.sim.combat,
      vfx: this.vfx,
      onComboFirstSeen: (comboId) => this.hud.showComboTip(comboId),
    });
    this.input = new InputController({
      engine: this.engine,
      sim: this.sim,
      interaction: this.interaction,
      onDevGold: () => {
        this.sim.economy.earn(DEV_GOLD, 'dev_grant');
        this.hud.notify('调试：+400 金币', 'dev-gold');
      },
    });

    this.bindViews();
    this.bindNotices();

    this.board.syncTerrain(true);
    this.syncViewport();
    window.addEventListener('resize', this.syncViewport);

    if (options.autoStart !== false) this.start();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  /**
   * Scene rigs are event-driven rather than diffed against the tower list: a
   * tower's silhouette is built once and a rebuild would drop its animation
   * state mid-swing.
   */
  private bindViews(): void {
    const bus = this.sim.combat.bus;

    this.unsubscribe.push(
      bus.on('tower_built', (event) => {
        const cx = Math.floor(event.cell.x);
        const cy = Math.floor(event.cell.y);
        this.board.worldOf(cx, cy, this.surface);
        this.towers.add(event.towerId, event.defId, cx, cy, this.surface.y);
      }),
      bus.on('tower_sold', (event) => this.towers.remove(event.towerId)),
      bus.on('tower_fired', (event) => this.towers.fired(event.towerId)),
      bus.on('tower_state_changed', (event) => {
        this.towers.setOnline(event.towerId, ONLINE_STATES.has(event.state));
      }),
      bus.on('enemy_damaged', (event) => this.enemies.hit(event.enemyId)),
    );
  }

  private bindNotices(): void {
    this.unsubscribe.push(
      this.sim.notices.add((notice) => {
        switch (notice.kind) {
          case 'rejected':
            this.hud.notify(notice.reason, `reject-${notice.reason}`);
            return;
          case 'wave_result':
            this.hud.notify(
              notice.earlyBonus > 0
                ? `第 ${notice.wave} 波清空，+${notice.reward} 金（提前奖励 +${notice.earlyBonus}）`
                : `第 ${notice.wave} 波清空，+${notice.reward} 金`,
              `wave-${notice.wave}`,
            );
            return;
          default:
            return;
        }
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const realDt = Math.min((now - this.lastFrameMs) / 1000, SIM.fixedDelta * SIM.maxSubSteps);
    this.lastFrameMs = now;
    this.step(realDt);
  };

  /** One frame's worth of work. Split out so probes can drive it by hand. */
  step(realDt: number): void {
    // ① Impact first: hitstop must be able to zero out this frame's simulation.
    const impact = this.vfx.beginFrame(realDt * 1000);
    const dt = realDt * impact.timeScale;

    // ② Fixed 60 Hz simulation. Excess time is dropped rather than queued, so a
    //    stall costs a slow-motion moment instead of a burst of catch-up ticks.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SIM.fixedDelta && steps < SIM.maxSubSteps) {
      this.accumulator -= SIM.fixedDelta;
      steps += 1;
      this.sim.tick(SIM.fixedDelta);
    }
    if (steps === SIM.maxSubSteps) this.accumulator = 0;

    // ③ Presentation follows the same scaled clock, so a frozen frame is frozen
    //    everywhere: no drifting turrets over a stopped world.
    const towers = this.sim.combat.towerList();
    this.board.update(dt);
    this.towers.update(dt, towers);
    this.enemies.update(dt, this.sim.combat.enemyList(), this.engine.camera);
    this.vfxBridge.update(towers);
    this.syncRoutes();
    this.syncCursor(towers);

    // ④ Close the VFX frame before rendering; particle buffers upload on draw.
    this.vfx.endFrame();

    this.hud.tick(realDt);
    this.hud.hud.setState(this.hud.build());
    this.hud.hud.applyImpact(impact);
    this.applyShake(impact.shake);

    this.engine.renderer.info.reset();
    this.engine.post.render();

    this.frames += 1;
    this.fpsWindow += realDt;
    this.fpsFrames += 1;
    if (this.fpsWindow >= 0.5) {
      this.fps = this.fpsFrames / this.fpsWindow;
      this.fpsWindow = 0;
      this.fpsFrames = 0;
    }
  }

  /**
   * Camera shake, applied on top of whatever the rig solved.
   *
   * `ImpactState.shake` is expressed as a fraction of screen height, so it is
   * converted through the frustum at the camera's distance: the same 0.01 kick
   * then reads identically at both zoom steps.
   */
  private applyShake(shake: { x: number; y: number }): void {
    const camera = this.engine.camera;
    camera.position.sub(this.appliedShake);

    if (shake.x === 0 && shake.y === 0) {
      this.appliedShake.set(0, 0, 0);
      camera.updateMatrixWorld(true);
      return;
    }

    const distance = camera.position.distanceTo(this.engine.cameraRig.getTarget(this.surface));
    const worldPerScreenHeight = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    camera.matrixWorld.extractBasis(this.shakeRight, this.shakeUp, new Vector3());

    this.appliedShake
      .copy(this.shakeRight)
      .multiplyScalar(shake.x * worldPerScreenHeight)
      .addScaledVector(this.shakeUp, shake.y * worldPerScreenHeight);
    camera.position.add(this.appliedShake);
    camera.updateMatrixWorld(true);
  }

  /** Gate-to-core routes, redrawn only when a dig or a breach moves the field. */
  private syncRoutes(): void {
    this.board.syncTerrain();
    if (this.routeVersion === this.sim.world.grid.version) return;
    this.routeVersion = this.sim.world.grid.version;
    this.board.syncRoutes(this.sim.world.groundField, this.sim.world.openGates);
  }

  private syncCursor(towers: readonly Tower[]): void {
    const { interaction } = this;
    const hover = interaction.hover;

    if (hover && interaction.selectedBuildId) {
      const defId = interaction.selectedBuildId;
      const check = this.sim.checkPlacement(defId, hover);
      this.board.setCursor({
        cx: hover.cx,
        cy: hover.cy,
        valid: check.ok,
        range: towerRange(this.sim.towerDef(defId)),
      });
      return;
    }

    if (hover && interaction.armed) {
      const check = this.sim.world.engineering.check(interaction.armed, hover.cx, hover.cy);
      this.board.setCursor({ cx: hover.cx, cy: hover.cy, valid: check.ok, range: 0 });
      return;
    }

    if (interaction.selectedTowerId !== null) {
      const tower = towers.find((candidate) => candidate.id === interaction.selectedTowerId);
      if (tower) {
        const range = towerRange(tower.baseDef);
        this.board.setCursor({
          cx: Math.floor(tower.position.x),
          cy: Math.floor(tower.position.y),
          valid: true,
          range,
        });
        return;
      }
    }

    if (hover) {
      this.board.setCursor({ cx: hover.cx, cy: hover.cy, valid: true, range: 0 });
      return;
    }
    this.board.setCursor(null);
  }

  private readonly syncViewport = (): void => {
    const size = this.engine.renderer.getDrawingBufferSize(this.bufferSize);
    this.vfx.setViewport(size.y, (this.engine.camera.fov * Math.PI) / 180);
  };

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Snapshot for the console probe and the debug overlay. */
  diagnostics(): Record<string, unknown> {
    return {
      fps: Math.round(this.fps),
      frames: this.frames,
      phase: this.sim.phase,
      wave: `${this.sim.waveNumber}/${this.sim.totalWaves}`,
      gold: Math.floor(this.sim.economy.gold),
      power: `${this.sim.economy.powerUsed}/${this.sim.economy.powerCap}`,
      integrity: Math.round(this.sim.economy.integrity),
      towers: this.sim.combat.towerList().length,
      enemies: this.sim.combat.enemyList().length,
      particles: this.vfx.stats.aliveParticles,
      drawCalls: this.engine.renderer.info.render.calls,
      buildMenu: M1_BUILD_MENU.map((entry) => entry.defId),
    };
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.syncViewport);
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;

    this.input.dispose();
    this.vfxBridge.dispose();
    this.hud.dispose();
    this.enemies.dispose();
    this.towers.dispose();
    this.board.dispose();
    this.vfx.dispose();
    this.engine.dispose();
  }
}
