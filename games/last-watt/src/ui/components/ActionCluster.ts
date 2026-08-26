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
  private readonly digFree: HTMLElement;
  private readonly bridgeButton: HTMLButtonElement;
  private readonly bridgeCount: HTMLElement;
  private readonly bridgeFree: HTMLElement;
  private readonly ultButton: HTMLButtonElement;
  private readonly ultPips: HTMLElement;
  private pipNodes: HTMLElement[] = [];
  private lastMaxCharges = -1;

  constructor(private readonly callbacks: HudCallbacks) {
    this.digCount = el('span', 'lw-eng__count', '0');
    this.digFree = el('span', 'lw-eng__free', '赠送');
    this.digButton = this.createEngButton('dig', '挖沟', this.digCount, this.digFree);

    this.bridgeCount = el('span', 'lw-eng__count', '0');
    this.bridgeFree = el('span', 'lw-eng__free', '赠送');
    this.bridgeButton = this.createEngButton('bridge', '搭桥', this.bridgeCount, this.bridgeFree);

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

    // 「挖沟：0 金」读起来像坏了；一次赠送的镐头要说自己是赠送的（GDD 11 波 5）。
    const digFree = eng.freeDig ?? 0;
    setText(this.digCount, String(eng.digLeft));
    this.digFree.hidden = digFree <= 0;
    this.digButton.disabled = eng.digLeft <= 0;
    setClass(this.digButton, 'lw-eng__button--armed', eng.armed === 'dig');
    setClass(this.digButton, 'lw-eng__button--free', digFree > 0);
    this.digButton.title = engTitle('挖沟', eng.digCost, eng.digLeft, digFree);

    const bridgeFree = eng.freeBridge ?? 0;
    setText(this.bridgeCount, String(eng.bridgeLeft));
    this.bridgeFree.hidden = bridgeFree <= 0;
    this.bridgeButton.disabled = eng.bridgeLeft <= 0;
    setClass(this.bridgeButton, 'lw-eng__button--armed', eng.armed === 'bridge');
    setClass(this.bridgeButton, 'lw-eng__button--free', bridgeFree > 0);
    this.bridgeButton.title = engTitle('搭桥', eng.bridgeCost, eng.bridgeLeft, bridgeFree);

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
    free: HTMLElement,
  ): HTMLButtonElement {
    free.hidden = true;
    const button = el('button', 'lw-eng__button') as HTMLButtonElement;
    button.type = 'button';
    button.append(
      createIcon(kind === 'dig' ? 'eng-dig' : 'eng-bridge', 'lw-eng__icon'),
      el('span', '', label),
      count,
      free,
    );
    button.addEventListener('click', () => this.callbacks.onEngineering?.(kind));
    return button;
  }
}

function engTitle(label: string, cost: number, left: number, free: number): string {
  const price = free > 0 ? `赠送 ${free} 次（不扣金、不占配额）` : `${cost} 金`;
  return `${label}：${price}，剩 ${left} 次`;
}
