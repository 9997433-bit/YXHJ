/**
 * The two screen states the HUD deliberately has no component for: paused, and
 * the run being over.
 *
 * Both live here rather than in `src/ui` because neither is part of the §14
 * information architecture — pause is a playtest affordance and the result
 * panel exists because "refresh the page to try again" is not an ending. Same
 * reasoning as `devOverlay.ts`: own id namespace, own injected stylesheet,
 * nothing for the HUD's own components to collide with.
 */

import type { RunStatus } from '../gameplay';

const STYLE_ID = 'lw-run-overlay-style';

const CSS = `
#lw-run-overlay {
  position: fixed;
  inset: 0;
  z-index: 14;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #d8cec4;
}
#lw-run-overlay[data-mode='none'] { display: none; }
/* A pause has to stay out of the way: the whole point is reading the board. */
#lw-run-overlay[data-mode='paused'] { align-items: flex-start; padding-top: 84px; }
#lw-run-overlay[data-mode='paused'] .lw-ro__card {
  min-width: 0;
  padding: 7px 16px;
  border-color: rgba(53, 224, 255, 0.4);
  background: rgba(10, 8, 7, 0.72);
}
#lw-run-overlay[data-mode='paused'] .lw-ro__title { font-size: 13px; letter-spacing: 0.34em; color: #35e0ff; }
#lw-run-overlay[data-mode='lost'] { background: rgba(28, 6, 4, 0.52); }
#lw-run-overlay[data-mode='won'] { background: rgba(4, 20, 26, 0.52); }

.lw-ro__card {
  pointer-events: auto;
  min-width: 260px;
  padding: 22px 30px 20px;
  text-align: center;
  border: 1px solid rgba(138, 106, 82, 0.55);
  border-radius: 4px;
  background: rgba(10, 8, 7, 0.9);
  backdrop-filter: blur(7px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}
.lw-ro__title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-shadow: 0 0 18px rgba(53, 224, 255, 0.45);
}
#lw-run-overlay[data-mode='lost'] .lw-ro__title { color: #ff3b30; text-shadow: 0 0 18px rgba(255, 59, 48, 0.5); }
#lw-run-overlay[data-mode='won'] .lw-ro__title { color: #35e0ff; }
.lw-ro__line { margin-top: 8px; color: rgba(216, 206, 196, 0.72); }
.lw-ro__line[hidden] { display: none; }
.lw-ro__button {
  margin-top: 16px;
  padding: 8px 22px;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #ffd84d;
  background: rgba(255, 216, 77, 0.08);
  border: 1px solid rgba(255, 216, 77, 0.6);
  border-radius: 3px;
  cursor: pointer;
  transition: background-color 0.14s, box-shadow 0.14s;
}
.lw-ro__button:hover { background: rgba(255, 216, 77, 0.18); box-shadow: 0 0 16px rgba(255, 216, 77, 0.35); }
.lw-ro__button[hidden] { display: none; }
`;

export type OverlayMode = 'none' | 'paused' | RunStatus;

export interface RunOverlayOptions {
  /** Absent means no restart button; the panel still explains the ending. */
  onRestart?: () => void;
}

export class RunOverlay {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly line = document.createElement('div');
  private readonly button = document.createElement('button');

  private mode: OverlayMode = 'none';

  constructor(container: HTMLElement, private readonly options: RunOverlayOptions = {}) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root.id = 'lw-run-overlay';
    this.root.dataset.mode = 'none';

    this.title.className = 'lw-ro__title';
    this.line.className = 'lw-ro__line';

    this.button.type = 'button';
    this.button.className = 'lw-ro__button';
    this.button.textContent = '重开一局  R';
    this.button.hidden = true;
    this.button.addEventListener('click', () => this.options.onRestart?.());

    const card = document.createElement('div');
    card.className = 'lw-ro__card';
    card.append(this.title, this.line, this.button);
    this.root.append(card);
    container.append(this.root);
  }

  /** Idempotent: called every frame with the run's current state. */
  show(mode: OverlayMode, detail = ''): void {
    if (mode === this.mode && this.line.textContent === detail) return;
    this.mode = mode;
    this.root.dataset.mode = mode;

    switch (mode) {
      case 'paused':
        this.title.textContent = '已暂停';
        break;
      case 'lost':
        this.title.textContent = '核心失守';
        break;
      case 'won':
        this.title.textContent = '守住了';
        break;
      default:
        break;
    }

    this.line.textContent = detail;
    this.line.hidden = detail === '';
    this.button.hidden = mode !== 'lost' && mode !== 'won';
    if (mode !== 'none' && this.options.onRestart === undefined) this.button.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}
