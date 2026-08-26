/**
 * Playtest overlay: frame budget, live counters, and the key map.
 *
 * Not `engine/debug/DebugHud`: that one drives itself off `engine.onRender`,
 * which this slice deliberately leaves unfired (see `game.ts`), and its `G`
 * binding collides with the gold grant. Separate id namespace so both can be on
 * screen at once if someone wants to compare.
 */

import type { Game } from './game';

const STYLE_ID = 'lw-app-dev-style';

const CSS = `
#lw-app-dev {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 12;
  padding: 9px 12px;
  min-width: 210px;
  border: 1px solid rgba(53, 224, 255, 0.24);
  border-radius: 3px;
  background: rgba(10, 8, 7, 0.66);
  backdrop-filter: blur(6px);
  color: #d8cec4;
  font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.04em;
  pointer-events: none;
  user-select: none;
}
#lw-app-dev[data-hidden='true'] { display: none; }
#lw-app-dev .lw-row { display: flex; justify-content: space-between; gap: 18px; }
#lw-app-dev .lw-k { color: rgba(216, 206, 196, 0.48); }
#lw-app-dev .lw-v { color: #35e0ff; }
#lw-app-dev .lw-keys {
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid rgba(216, 206, 196, 0.14);
  color: rgba(216, 206, 196, 0.55);
  line-height: 1.75;
}
`;

const ROWS = ['fps', 'draws', 'particles', 'towers', 'enemies'] as const;

export class DevOverlay {
  private readonly root = document.createElement('div');
  private readonly values = new Map<string, HTMLSpanElement>();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private timer: number;

  constructor(private readonly game: Game) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root.id = 'lw-app-dev';
    for (const label of ROWS) this.root.appendChild(this.row(label));

    const keys = document.createElement('div');
    keys.className = 'lw-keys';
    keys.innerHTML = [
      '1-5 选建造 · 左键放置 · 右键取消',
      '空格 开波 · D 挖沟 · B 搭桥',
      'Z 缩放 · G +400 金 · H 隐藏',
    ].join('<br>');
    this.root.appendChild(keys);
    document.body.appendChild(this.root);

    this.onKeyDown = (event) => {
      if (event.key.toLowerCase() !== 'h' || event.metaKey || event.ctrlKey) return;
      this.root.dataset.hidden = this.root.dataset.hidden === 'true' ? 'false' : 'true';
    };
    window.addEventListener('keydown', this.onKeyDown);

    // 4 Hz: the counters are unreadable at frame rate and this keeps the
    // overlay off the render path entirely.
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  private row(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lw-row';

    const key = document.createElement('span');
    key.className = 'lw-k';
    key.textContent = label;

    const value = document.createElement('span');
    value.className = 'lw-v';
    value.textContent = '—';
    this.values.set(label, value);

    row.append(key, value);
    return row;
  }

  private refresh(): void {
    const snapshot = this.game.diagnostics();
    for (const label of ROWS) {
      const node = this.values.get(label);
      const text = String(snapshot[label] ?? '—');
      if (node && node.textContent !== text) node.textContent = text;
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }
}
