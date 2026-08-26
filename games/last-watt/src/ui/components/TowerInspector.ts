import { el, setText } from '../dom';
import { createIcon } from '../icons';
import type { HudCallbacks, HudState, TargetPriority, TowerInspectState } from '../hudState';

const PRIORITY_LABELS: Record<TargetPriority, string> = {
  first: '首位',
  strongest: '最强',
  air: '对空',
};

/**
 * 点击塔后的面板：升级二选一 + 目标优先级 + 卖出（GDD 14.1）。
 *
 * 面板整体在选中的塔变化时重建——它一局里只会被点开几十次，
 * 为它维持一套增量更新不划算，重建反而少一堆状态同步的 bug。
 */
export class TowerInspector {
  readonly root: HTMLElement;

  private lastTowerId: string | null = null;
  private lastSignature = '';

  constructor(private readonly callbacks: HudCallbacks) {
    this.root = el('div', 'lw-panel lw-inspector');
    this.root.hidden = true;
  }

  update(state: HudState): void {
    const inspector = state.inspector;
    if (!inspector) {
      if (this.lastTowerId !== null) {
        this.lastTowerId = null;
        this.lastSignature = '';
        this.root.hidden = true;
        this.root.replaceChildren();
      }
      return;
    }

    const signature = this.signatureOf(inspector, state.gold);
    if (inspector.towerId === this.lastTowerId && signature === this.lastSignature) return;
    this.lastTowerId = inspector.towerId;
    this.lastSignature = signature;

    this.root.hidden = false;
    this.root.replaceChildren(...this.render(inspector, state.gold));
  }

  private signatureOf(inspector: TowerInspectState, gold: number): string {
    return [
      inspector.towerId,
      inspector.level,
      inspector.priority,
      inspector.sellRefund,
      inspector.stats.map((s) => `${s.label}=${s.value}`).join('|'),
      inspector.upgrades.map((u) => `${u.id}:${gold >= u.cost ? 1 : 0}`).join('|'),
      inspector.overload ? `${inspector.overload.cost}:${inspector.overload.available ? 1 : 0}` : '',
    ].join('#');
  }

  private render(inspector: TowerInspectState, gold: number): Node[] {
    const close = el('button', 'lw-inspector__close', '✕') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.callbacks.onCloseInspector?.());

    const head = el(
      'div',
      'lw-inspector__head',
      el(
        'div',
        'lw-inspector__name',
        createIcon(inspector.icon, 'lw-eng__icon'),
        ` ${inspector.name} Lv${inspector.level}`,
      ),
      close,
    );

    const stats = el('div', 'lw-inspector__stats');
    for (const stat of inspector.stats) {
      stats.append(
        el('span', 'lw-label', stat.label),
        el('span', 'lw-inspector__stat-value', stat.value),
      );
    }

    const nodes: Node[] = [head, stats];

    if (inspector.upgrades.length > 0) {
      const upgrades = el('div', 'lw-upgrades');
      for (const upgrade of inspector.upgrades) {
        const button = el('button', 'lw-upgrade') as HTMLButtonElement;
        button.type = 'button';
        button.append(
          el('span', '', upgrade.name),
          el('span', 'lw-upgrade__cost', `${upgrade.cost} 金`),
        );
        button.title = upgrade.description;
        button.disabled = gold < upgrade.cost;
        button.addEventListener('click', () =>
          this.callbacks.onUpgrade?.(inspector.towerId, upgrade.id),
        );
        upgrades.append(button);
      }
      nodes.push(el('div', '', el('div', 'lw-label', '升级（二选一）'), upgrades));
    }

    if (inspector.overload) {
      const overload = el('button', 'lw-upgrade') as HTMLButtonElement;
      overload.type = 'button';
      overload.append(
        el('span', '', '超载 3×3'),
        el('span', 'lw-upgrade__cost', `${inspector.overload.cost} 储能`),
      );
      overload.disabled = !inspector.overload.available;
      overload.title = '周围 3×3 耗电塔攻速 +100% 持续 6s，随后过热停机 3s';
      overload.addEventListener('click', () => this.callbacks.onOverload?.(inspector.towerId));
      nodes.push(overload);
    }

    const priority = el('div', 'lw-priority');
    for (const key of Object.keys(PRIORITY_LABELS) as TargetPriority[]) {
      const button = el('button', 'lw-priority__button') as HTMLButtonElement;
      button.type = 'button';
      setText(button, PRIORITY_LABELS[key]);
      if (inspector.priority === key) button.classList.add('lw-priority__button--active');
      button.addEventListener('click', () =>
        this.callbacks.onTargetPriority?.(inspector.towerId, key),
      );
      priority.append(button);
    }
    nodes.push(el('div', '', el('div', 'lw-label', '目标优先级'), priority));

    const sell = el('button', 'lw-sell', `卖出 · 返还 ${inspector.sellRefund} 金`) as HTMLButtonElement;
    sell.type = 'button';
    sell.addEventListener('click', () => this.callbacks.onSell?.(inspector.towerId));
    nodes.push(sell);

    return nodes;
  }
}
