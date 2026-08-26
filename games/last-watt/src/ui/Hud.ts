import type { ImpactState } from '../vfx/ImpactDirector';
import { ActionCluster } from './components/ActionCluster';
import { BuildBar } from './components/BuildBar';
import { ComboToast, type ComboId } from './components/ComboToast';
import { ImpactOverlay } from './components/ImpactOverlay';
import { RadioBubble } from './components/RadioBubble';
import { ResourceRail } from './components/ResourceRail';
import { TowerInspector } from './components/TowerInspector';
import { WaveHeader } from './components/WaveHeader';
import { el } from './dom';
import { createEmptyHudState, type HudCallbacks, type HudState } from './hudState';
import { injectHudStyles } from './styles';

/**
 * HUD 根。
 *
 * 用法：
 * ```ts
 * const hud = new Hud(container, { onBuildSelect: (id) => game.selectBlueprint(id) });
 * // 每帧（或状态变化时）
 * hud.setState(gameStateToHudState(game));
 * hud.applyImpact(impactState);   // 来自 vfx.beginFrame() 的返回值
 * ```
 *
 * HUD 是纯展示层：它不读游戏对象、不定时器驱动逻辑，因此可以被截图脚本
 * 和自检用假数据完整驱动，不需要拉起整局游戏。
 */
export class Hud {
  readonly root: HTMLElement;

  readonly rail: ResourceRail;
  readonly waveHeader: WaveHeader;
  readonly buildBar: BuildBar;
  readonly actions: ActionCluster;
  readonly inspector: TowerInspector;
  readonly toast: ComboToast;
  readonly radio: RadioBubble;
  readonly impactOverlay: ImpactOverlay;

  private state: HudState = createEmptyHudState();

  constructor(
    container: HTMLElement,
    callbacks: HudCallbacks = {},
    options: { seenCombos?: Iterable<string> } = {},
  ) {
    injectHudStyles(container.ownerDocument ?? document);

    this.rail = new ResourceRail();
    this.waveHeader = new WaveHeader(callbacks);
    this.buildBar = new BuildBar(callbacks);
    this.actions = new ActionCluster(callbacks);
    this.inspector = new TowerInspector(callbacks);
    this.toast = new ComboToast(options.seenCombos);
    this.radio = new RadioBubble();
    this.impactOverlay = new ImpactOverlay();

    this.root = el(
      'div',
      'lw-hud',
      this.rail.root,
      this.waveHeader.root,
      this.buildBar.root,
      this.actions.root,
      this.inspector.root,
      this.toast.root,
      this.radio.root,
      this.impactOverlay.root,
    );
    container.append(this.root);
  }

  setState(next: HudState): void {
    this.state = next;
    this.rail.update(next);
    this.waveHeader.update(next);
    this.buildBar.update(next);
    this.actions.update(next);
    this.inspector.update(next);
    this.radio.update(next);
  }

  /** 把 `VfxSystem.beginFrame()` 的返回值直接转过来即可。 */
  applyImpact(impact: ImpactState): void {
    this.impactOverlay.apply(impact);
  }

  /** combo 首次触发时调用；已见过会被静默忽略（GDD 14.2：每档案只弹一次）。 */
  showComboTip(combo: ComboId): boolean {
    return this.toast.showCombo(combo);
  }

  get currentState(): HudState {
    return this.state;
  }

  dispose(): void {
    this.root.remove();
  }
}
