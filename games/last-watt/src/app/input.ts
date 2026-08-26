/**
 * Pointer and keyboard → `CommandCenter`.
 *
 * Every click on the board is the same call — `commands.clickCell` — because
 * what a click *means* depends on what is armed, and that state has rules the
 * gameplay layer owns. This file only decides which cell was hit and which key
 * arms what; it never decides whether an action is legal.
 */

import { Vector3 } from 'three';

import type { Engine } from '../engine';
import type { CellCoord, GameSession } from '../gameplay';

import { M1_BUILD_MENU } from './config';
import type { HudBridge } from './hudBridge';
import type { Interaction } from './interaction';

export interface InputOptions {
  engine: Engine;
  session: GameSession;
  interaction: Interaction;
  hud: HudBridge;
  /** Playtest helper; see the `G` binding below. */
  onDevGold?: () => void;
  /** Playtest helper; see the `U` binding below. */
  onToggleUnlockAll?: () => void;
  onTogglePause?: () => void;
  /** Only reachable once the run is decided; see the `R` binding below. */
  onRestart?: () => void;
}

export class InputController {
  private readonly point = new Vector3();
  private readonly detach: Array<() => void> = [];

  constructor(private readonly options: InputOptions) {
    const canvas = options.engine.canvas;

    this.on(canvas, 'pointermove', (event) => {
      this.options.interaction.hover = this.cellAt(event as PointerEvent);
    });
    this.on(canvas, 'pointerleave', () => {
      this.options.interaction.hover = null;
    });
    this.on(canvas, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    this.on(canvas, 'contextmenu', (event) => {
      event.preventDefault();
      this.clear();
    });
    this.on(canvas, 'wheel', (event) => {
      event.preventDefault();
      this.options.engine.cameraRig.cycleZoom();
    });
    this.on(window, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent));
  }

  /** Cell under the pointer, or null when the ray misses the board. */
  cellAt(event: { clientX: number; clientY: number }): CellCoord | null {
    const { engine, session } = this.options;
    const rect = engine.canvas.getBoundingClientRect();
    const hit = engine.cameraRig.pointerToGround(event.clientX, event.clientY, rect, this.point);
    if (!hit) return null;
    const cx = Math.floor(hit.x);
    const cy = Math.floor(hit.z);
    return session.world.grid.isInside(cx, cy) ? { cx, cy } : null;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      this.clear();
      return;
    }
    if (event.button !== 0) return;

    const cell = this.cellAt(event);
    if (!cell) return;
    const { session, interaction, hud } = this.options;

    if (session.armedTool) {
      hud.run(session.commands.clickCell(cell.cx, cell.cy));
      return;
    }

    // Nothing in hand: a click inspects whatever is standing there.
    const placed = session.towerAt(cell.cx, cell.cy);
    interaction.selectedTowerId = placed ? placed.towerId : null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const { session, hud, engine } = this.options;
    const commands = session.commands;

    const slot = Number(event.key);
    if (Number.isInteger(slot) && slot >= 1 && slot <= M1_BUILD_MENU.length) {
      const entry = M1_BUILD_MENU[slot - 1] as { defId: string };
      hud.run(commands.selectBuild(entry.defId));
      event.preventDefault();
      return;
    }

    switch (event.key.toLowerCase()) {
      // The same command as the header's 提前开波 button, so it pays the same
      // +10% bonus. Waves never auto-start (GDD §12: unlimited pause between
      // waves), so every start is a voluntary early call — the keyboard used to
      // quietly hand that bonus back while the button kept it.
      case ' ':
        hud.run(commands.startWave({ early: true }));
        event.preventDefault();
        return;
      case 'd':
        hud.run(commands.armDig());
        return;
      case 'b':
        hud.run(commands.armBridge());
        return;
      case 'q':
        hud.run(commands.ultimate());
        return;
      case 'z':
        engine.cameraRig.cycleZoom();
        return;
      case 'p':
        this.options.onTogglePause?.();
        return;
      case 'r':
        if (session.finished) this.options.onRestart?.();
        return;
      case 'escape':
        this.clear();
        return;
      // Playtest affordance, not a design decision: it tops the wallet up so a
      // tester can reach a blueprint's price without grinding. It cannot skip
      // the unlock schedule — that is `U`, and both are reported by
      // `Game.diagnostics().devAids`.
      case 'g':
        this.options.onDevGold?.();
        return;
      // Lifts the unlock schedule for the rest of the run. This is the only way
      // into the all-blueprints state a player can reach, and the reason the
      // slice no longer boots into it.
      case 'u':
        this.options.onToggleUnlockAll?.();
        return;
      default:
        return;
    }
  }

  private clear(): void {
    this.options.session.commands.disarm();
    this.options.interaction.selectedTowerId = null;
  }

  private on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    const options = type === 'wheel' ? { passive: false } : undefined;
    target.addEventListener(type, handler, options);
    this.detach.push(() => target.removeEventListener(type, handler));
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}
