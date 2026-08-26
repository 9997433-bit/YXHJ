import { el, setText } from '../dom';
import type { HudState } from '../hudState';

/**
 * 老周电台气泡（GDD 3 / 11：老周只是电台里的声音，不是可操作单位）。
 *
 * 只做「头像 + 一句话 + 无线电杂音光标」。没有对话系统、没有分支——
 * 世界观载体的成本必须保持为零，这是 v1 范围锁里写死的。
 */
export class RadioBubble {
  readonly root: HTMLElement;

  private readonly speaker: HTMLElement;
  private readonly line: HTMLElement;
  private lastId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.speaker = el('div', 'lw-radio__speaker', '老周');
    this.line = el('div', 'lw-radio__line');
    this.root = el(
      'div',
      'lw-panel lw-radio',
      el('div', 'lw-radio__avatar'),
      el('div', '', this.speaker, this.line),
    );
    this.root.hidden = true;
  }

  update(state: HudState, holdMs = 4200): void {
    const radio = state.radio;
    if (!radio) return;
    if (radio.id === this.lastId) return;
    this.lastId = radio.id;

    setText(this.speaker, radio.speaker);
    setText(this.line, radio.line);
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('lw-radio--show');

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.root.classList.remove('lw-radio--show');
      this.timer = setTimeout(() => {
        this.root.hidden = true;
      }, 240);
    }, holdMs);
  }
}
