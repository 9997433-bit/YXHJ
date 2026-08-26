import { el, setClass, setText } from '../dom';
import { createIcon } from '../icons';
import type { BuildItemState, HudCallbacks, HudState } from '../hudState';

/**
 * 底部建造菜单：8 项横排，造价 + 占电角标 + 对空角标（GDD 14.1）。
 *
 * 「电力不足时耗电塔变灰并显示缺口数」是 GDD 点名的部件：缺多少要写出来，
 * 因为玩家的下一步决策是「造发电机还是卖塔」，只说「不够」等于没说。
 */

interface ItemNodes {
  button: HTMLButtonElement;
  cost: HTMLElement;
  powerBadge: HTMLElement | null;
  deficitBadge: HTMLElement;
}

export class BuildBar {
  readonly root: HTMLElement;

  private readonly nodes = new Map<string, ItemNodes>();
  private lastSignature = '';

  constructor(private readonly callbacks: HudCallbacks) {
    this.root = el('div', 'lw-panel lw-build');
  }

  update(state: HudState): void {
    const signature = state.build.map((item) => `${item.id}:${item.unlocked ? 1 : 0}`).join(',');
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.rebuild(state.build);
    }

    const freePower = state.power.cap - state.power.used;
    for (const item of state.build) {
      const nodes = this.nodes.get(item.id);
      if (!nodes) continue;

      const affordable = state.gold >= item.cost;
      const powerDeficit = Math.max(item.powerCost - freePower, 0);
      const buildable = item.unlocked && affordable && powerDeficit === 0;

      nodes.button.disabled = !buildable;
      setClass(nodes.button, 'lw-build__item--locked', !item.unlocked);
      setClass(nodes.button, 'lw-build__item--unaffordable', item.unlocked && !affordable);
      setClass(nodes.button, 'lw-build__item--nopower', item.unlocked && powerDeficit > 0);
      setClass(nodes.button, 'lw-build__item--selected', state.selectedBuildId === item.id);

      setText(nodes.cost, String(item.cost));

      if (powerDeficit > 0) {
        nodes.deficitBadge.hidden = false;
        setText(nodes.deficitBadge, `缺${powerDeficit}`);
        if (nodes.powerBadge) nodes.powerBadge.hidden = true;
      } else {
        nodes.deficitBadge.hidden = true;
        if (nodes.powerBadge) nodes.powerBadge.hidden = false;
      }

      nodes.button.title = this.tooltip(item, affordable, powerDeficit);
    }
  }

  private rebuild(items: BuildItemState[]): void {
    this.nodes.clear();
    this.root.replaceChildren(...items.map((item) => this.createItem(item)));
  }

  private createItem(item: BuildItemState): HTMLElement {
    const icon = createIcon(item.icon, 'lw-build__icon');
    const cost = el('span', 'lw-build__cost', String(item.cost));

    const button = el('button', 'lw-build__item') as HTMLButtonElement;
    button.type = 'button';
    button.append(icon, el('span', 'lw-build__name', item.name), cost);

    let powerBadge: HTMLElement | null = null;
    if (item.powerCost > 0) {
      powerBadge = el('span', 'lw-build__badge lw-build__badge--power', `⚡${item.powerCost}`);
      button.append(powerBadge);
    }
    if (item.targetsAir) {
      button.append(el('span', 'lw-build__badge lw-build__badge--air', '对空'));
    }

    const deficitBadge = el('span', 'lw-build__badge lw-build__badge--deficit');
    deficitBadge.hidden = true;
    button.append(deficitBadge);

    if (item.hotkey) {
      button.append(el('span', 'lw-build__hotkey', item.hotkey));
    }

    button.addEventListener('click', () => this.callbacks.onBuildSelect?.(item.id));

    this.nodes.set(item.id, { button, cost, powerBadge, deficitBadge });
    return button;
  }

  private tooltip(item: BuildItemState, affordable: boolean, powerDeficit: number): string {
    if (!item.unlocked) return `${item.name}（图纸未解锁）`;
    if (powerDeficit > 0) return `${item.name}：供电还差 ${powerDeficit} 点，造发电机或卖塔`;
    if (!affordable) return `${item.name}：金币不足`;
    return `${item.name}：${item.cost} 金${item.powerCost > 0 ? ` / 占电 ${item.powerCost}` : ''}`;
  }
}
