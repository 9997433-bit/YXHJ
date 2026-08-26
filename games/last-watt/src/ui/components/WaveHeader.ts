import { el, setClass, setText } from '../dom';
import { createIcon } from '../icons';
import type { HudCallbacks, HudState, WavePreviewEntry } from '../hudState';

/**
 * 顶部中央：波次进度 + 下一波兵种预览 + 提前开波（GDD 14.1）。
 *
 * 预览是 GDD 明确用来解决「信息不够」的部件，所以对空 / 拆 / 疗三类破阵敌
 * 在这里就要用描边色跳出来——玩家必须在开波**之前**看出该不该改阵。
 */
export class WaveHeader {
  readonly root: HTMLElement;

  private readonly current: HTMLElement;
  private readonly total: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly early: HTMLButtonElement;
  private lastPreviewKey = '';

  constructor(private readonly callbacks: HudCallbacks) {
    this.current = el('span', 'lw-wave__current', '0');
    this.total = el('span', 'lw-wave__total', '/ 20');
    this.preview = el('div', 'lw-wave__preview');

    this.early = el('button', 'lw-wave__early') as HTMLButtonElement;
    this.early.type = 'button';
    this.early.addEventListener('click', () => this.callbacks.onCallWaveEarly?.());

    this.root = el(
      'div',
      'lw-panel lw-wave',
      el(
        'div',
        'lw-wave__counter',
        el('div', 'lw-label', '波次'),
        this.current,
        this.total,
      ),
      this.preview,
      this.early,
    );
  }

  update(state: HudState): void {
    setText(this.current, String(state.wave.current));
    setText(this.total, `/ ${state.wave.total}`);

    const key = state.nextWave.preview
      .map((e) => `${e.defId}x${e.count}${e.air ? 'A' : ''}${e.threat ?? ''}`)
      .join(',');
    if (key !== this.lastPreviewKey) {
      this.lastPreviewKey = key;
      this.preview.replaceChildren(
        ...state.nextWave.preview.map((entry) => this.createPreviewItem(entry)),
      );
    }

    const label = state.wave.inProgress
      ? '进行中'
      : `提前开波 +${state.nextWave.earlyBonusPercent}%`;
    setText(this.early, label);
    this.early.disabled = !state.nextWave.canCallEarly || state.wave.inProgress;
  }

  private createPreviewItem(entry: WavePreviewEntry): HTMLElement {
    const icon = createIcon(entry.icon, 'lw-preview-item__icon');
    icon.setAttribute('width', '18');
    icon.setAttribute('height', '18');

    const item = el(
      'div',
      'lw-preview-item',
      icon,
      el('span', 'lw-preview-item__count', `×${entry.count}`),
    );
    setClass(item, 'lw-preview-item--air', entry.air === true);
    setClass(item, 'lw-preview-item--breaker', entry.threat === 'breaker');
    setClass(item, 'lw-preview-item--healer', entry.threat === 'healer');
    item.title = entry.label ?? entry.defId;
    return item;
  }
}
