/**
 * Pointer and keyboard → `Command`s.
 *
 * The only place that turns screen space into cells. Nothing here mutates the
 * simulation directly: every action becomes a queued command that `Sim` applies
 * on a tick boundary, which is what keeps a click reproducible in a replay.
 */

import { Vector3 } from 'three';

import type { Engine } from '../engine';
import type { CellCoord } from '../gameplay';

import { M1_BUILD_MENU } from './config';
import type { Interaction } from './interaction';
import type { Sim } from './sim';

export interface InputOptions {
  engine: Engine;
  sim: Sim;
  interaction: Interaction;
  /** Playtest helper; see the `G` binding below. */
  onDevGold?: () => void;
}

export class InputController {
  private readonly point = new Vector3();
  private readonly detach: Array<() => void> = [];

  constructor(private readonly options: InputOptions) {
    const canvas = options.engine.canvas;

    this.on(canvas, 'pointermove', (event) => this.onPointerMove(event as PointerEvent));
    this.on(canvas, 'pointerleave', () => {
      this.options.interaction.hover = null;
    });
    this.on(canvas, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    this.on(canvas, 'contextmenu', (event) => {
      event.preventDefault();
      this.options.interaction.clear();
    });
    this.on(canvas, 'wheel', (event) => {
      event.preventDefault();
      this.options.engine.cameraRig.cycleZoom();
    });
    this.on(window, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent));
  }

  /** Cell under the pointer, or null when the ray misses the board. */
  cellAt(clientX: number, clientY: number): CellCoord | null {
    const { engine, sim } = this.options;
    const rect = engine.canvas.getBoundingClientRect();
    const hit = engine.cameraRig.pointerToGround(clientX, clientY, rect, this.point);
    if (!hit) return null;
    const cx = Math.floor(hit.x);
    const cy = Math.floor(hit.z);
    return sim.world.grid.isInside(cx, cy) ? { cx, cy } : null;
  }

  private onPointerMove(event: PointerEvent): void {
    this.options.interaction.hover = this.cellAt(event.clientX, event.clientY);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      this.options.interaction.clear();
      return;
    }
    if (event.button !== 0) return;

    const cell = this.cellAt(event.clientX, event.clientY);
    if (!cell) return;
    const { interaction, sim } = this.options;

    if (interaction.selectedBuildId) {
      sim.enqueue({ kind: 'build', defId: interaction.selectedBuildId, cell });
      return;
    }
    if (interaction.armed) {
      sim.enqueue({ kind: interaction.armed, cell });
      interaction.armed = null;
      return;
    }

    const tower = sim.combat
      .towerList()
      .find((candidate) => candidate.cell.cx === cell.cx && candidate.cell.cy === cell.cy);
    interaction.selectTower(tower ? tower.id : null);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const { interaction, sim, engine } = this.options;

    const slot = Number(event.key);
    if (Number.isInteger(slot) && slot >= 1 && slot <= M1_BUILD_MENU.length) {
      interaction.selectBlueprint((M1_BUILD_MENU[slot - 1] as { defId: string }).defId);
      event.preventDefault();
      return;
    }

    switch (event.key.toLowerCase()) {
      case ' ':
        sim.enqueue({ kind: 'start_wave', early: sim.phase !== 'deploy' });
        event.preventDefault();
        return;
      case 'd':
        interaction.arm('dig');
        return;
      case 'b':
        interaction.arm('bridge');
        return;
      case 'z':
        engine.cameraRig.cycleZoom();
        return;
      case 'escape':
        interaction.clear();
        return;
      // Playtest affordance, not a design decision: the GDD's 220 starting gold
      // is one condenser plus change, so proving the shatter chain otherwise
      // means grinding two waves first.
      case 'g':
        this.options.onDevGold?.();
        return;
      default:
        return;
    }
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
