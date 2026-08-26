import { el, setClass, setText } from '../dom';
import { createIcon } from '../icons';
import type { HudCallbacks, HudState } from '../hudState';

/**
 * 右下：工程按钮（挖沟 / 搭桥，带剩余次数角标）+ 大招按钮（充能 0/1/2 格）。
 *
 * 大招充满时脉冲（GDD 14.1）。脉冲用 CSS 动画而不是 JS 逐帧改样式——
 * 顿帧时 JS 时钟会停，但「大招好了」这件事不该跟着停。
 */
export class ActionCluster {
  readonly root: HTMLElement;

  private readonly digButton: HTMLButtonElement;
  private readonly digCount: HTMLElement;
  private readonly bridgeButton: HTMLButtonElement;
  private readonly bridgeCount: HTMLElement;
  private readonly ultButton: HTMLButtonElement;
  private readonly ultPips: HTMLElement;
  private pipNodes: HTMLElement[] = [];
  private lastMaxCharges = -1;

  constructor(private readonly callbacks: HudCallbacks) {
    this.digCount = el('span', 'lw-eng__count', '0');
    this.digButton = this.createEngButton('dig', '挖沟', this.digCount);

    this.bridgeCount = el('span', 'lw-eng__count', '0');
    this.bridgeButton = this.createEngButton('bridge', '搭桥', this.bridgeCount);

    this.ultPips = el('div', 'lw-ult__pips');
    this.ultButton = el('button', 'lw-panel lw-ult') as HTMLButtonElement;
    this.ultButton.type = 'button';
    this.ultButton.append(
      createIcon('ability-overload', 'lw-eng__icon'),
      el('span', '', '主控过载'),
      this.ultPips,
    );
    this.ultButton.addEventListener('click', () => this.callbacks.onUltimate?.());

    this.root = el(
      'div',
      'lw-actions',
      el('div', 'lw-eng', this.digButton, this.bridgeButton),
      this.ultButton,
    );
  }

  update(state: HudState): void {
    const eng = state.engineering;

    setText(this.digCount, String(eng.digLeft));
    this.digButton.disabled = eng.digLeft <= 0;
    setClass(this.digButton, 'lw-eng__button--armed', eng.armed === 'dig');
    this.digButton.title = `挖沟：${eng.digCost} 金，剩 ${eng.digLeft} 次`;

    setText(this.bridgeCount, String(eng.bridgeLeft));
    this.bridgeButton.disabled = eng.bridgeLeft <= 0;
    setClass(this.bridgeButton, 'lw-eng__button--armed', eng.armed === 'bridge');
    this.bridgeButton.title = `搭桥：${eng.bridgeCost} 金，剩 ${eng.bridgeLeft} 次`;

    if (state.ultimate.maxCharges !== this.lastMaxCharges) {
      this.lastMaxCharges = state.ultimate.maxCharges;
      this.pipNodes = [];
      this.ultPips.replaceChildren();
      for (let i = 0; i < state.ultimate.maxCharges; i++) {
        const pip = el('span', 'lw-ult__pip');
        this.pipNodes.push(pip);
        this.ultPips.append(pip);
      }
    }
    for (let i = 0; i < this.pipNodes.length; i++) {
      setClass(this.pipNodes[i], 'lw-ult__pip--charged', i < state.ultimate.charges);
    }

    const ready = state.ultimate.charges > 0;
    this.ultButton.disabled = !ready;
    setClass(this.ultButton, 'lw-ult--ready', ready);
    this.ultButton.title = ready
      ? '全网过载：所有耗电塔超载 6s + 全场 EMP 停顿 1.5s'
      : '每完成 5 波充能 1 次';
  }

  private createEngButton(
    kind: 'dig' | 'bridge',
    label: string,
    count: HTMLElement,
  ): HTMLButtonElement {
    const button = el('button', 'lw-eng__button') as HTMLButtonElement;
    button.type = 'button';
    button.append(
      createIcon(kind === 'dig' ? 'eng-dig' : 'eng-bridge', 'lw-eng__icon'),
      el('span', '', label),
      count,
    );
    button.addEventListener('click', () => this.callbacks.onEngineering?.(kind));
    return button;
  }
}
