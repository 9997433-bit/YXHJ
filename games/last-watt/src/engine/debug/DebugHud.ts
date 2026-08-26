import { Vector3 } from 'three';

import type { Engine } from '../Engine';
import { worldToCell } from '../grid/coords';

const STYLE_ID = 'lw-engine-debug-style';

const CSS = `
#lw-engine-debug {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10;
  padding: 10px 12px;
  min-width: 232px;
  border: 1px solid rgba(53, 224, 255, 0.28);
  border-radius: 3px;
  background: rgba(10, 8, 7, 0.68);
  backdrop-filter: blur(6px);
  color: #d8cec4;
  font: 11px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.04em;
  pointer-events: none;
  user-select: none;
}
#lw-engine-debug[data-hidden='true'] { display: none; }
#lw-engine-debug .lw-row { display: flex; justify-content: space-between; gap: 16px; }
#lw-engine-debug .lw-key { color: rgba(216, 206, 196, 0.5); }
#lw-engine-debug .lw-val { color: #35e0ff; }
#lw-engine-debug .lw-hint {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(216, 206, 196, 0.14);
  color: rgba(216, 206, 196, 0.55);
}
`;

/**
 * Engine-owned developer overlay. Deliberately id-namespaced (`lw-engine-*`)
 * so it cannot collide with the game HUD built by the UI layer.
 */
export class DebugHud {
  private readonly engine: Engine;
  private readonly root: HTMLDivElement;
  private readonly values = new Map<string, HTMLSpanElement>();
  private readonly hover = new Vector3();

  private hoverLabel = '—';
  private accumulator = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(engine: Engine) {
    this.engine = engine;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.id = 'lw-engine-debug';

    for (const label of ['fps', 'frame', 'draws', 'tris', 'cell', 'view']) {
      this.root.appendChild(this.buildRow(label));
    }

    const hint = document.createElement('div');
    hint.className = 'lw-hint';
    hint.textContent = 'Z zoom · B bloom · G grid · H hide';
    this.root.appendChild(hint);

    document.body.appendChild(this.root);

    this.bindKeys();
    this.bindPointer();
    // Read counters after the draw: on `onRender` they would still be the
    // previous frame's, because the draw now runs last in the frame protocol.
    this.unsubscribers.push(engine.onPresent(({ delta }) => this.update(delta)));
  }

  private buildRow(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lw-row';

    const key = document.createElement('span');
    key.className = 'lw-key';
    key.textContent = label;

    const value = document.createElement('span');
    value.className = 'lw-val';
    value.textContent = '—';
    this.values.set(label, value);

    row.append(key, value);
    return row;
  }

  private set(label: string, text: string): void {
    const node = this.values.get(label);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private update(delta: number): void {
    // The counters are noisy at frame rate; a 4 Hz refresh stays readable.
    this.accumulator += delta;
    if (this.accumulator < 0.25) return;
    this.accumulator = 0;

    const stats = this.engine.stats();
    this.set('fps', stats.fps.toFixed(0));
    this.set('frame', `${stats.frameMs.toFixed(1)} ms`);
    this.set('draws', String(stats.drawCalls));
    this.set('tris', stats.triangles.toLocaleString('en-US'));
    this.set('cell', this.hoverLabel);
    this.set('view', `${this.engine.post.enabled ? 'bloom' : 'raw'} · z${this.engine.cameraRig.zoomStep + 1}`);
  }

  private bindKeys(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.code) {
        case 'KeyZ':
          this.engine.cameraRig.cycleZoom();
          break;
        case 'KeyB':
          this.engine.post.enabled = !this.engine.post.enabled;
          break;
        case 'KeyG':
          this.engine.gridView.seamsVisible = !this.engine.gridView.seamsVisible;
          break;
        case 'KeyH':
          this.root.dataset.hidden = this.root.dataset.hidden === 'true' ? 'false' : 'true';
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    this.unsubscribers.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  private bindPointer(): void {
    const canvas = this.engine.canvas;

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const point = this.engine.cameraRig.pointerToGround(
        event.clientX,
        event.clientY,
        rect,
        this.hover,
      );
      const cell = point ? worldToCell(point.x, point.z) : null;
      this.hoverLabel = cell ? `${cell.col}, ${cell.row}` : '—';
    };

    const onPointerLeave = (): void => {
      this.hoverLabel = '—';
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    this.unsubscribers.push(() => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    });
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.root.remove();
  }
}
