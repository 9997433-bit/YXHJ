import { el, restartAnimation, setAttr, setClass, setStyle, setText, svg } from '../dom';
import type { HudState } from '../hudState';
import { COLORS, hexToCss } from '../theme';

/**
 * 左上资源纵列：金币 / 供电 / 储能 / 核心完整度（GDD 14.1）。
 *
 * 验收标准来自 VISUAL_BIBLE 10.4：**不看数字、只看条和环**就能回答
 * 「还能建几点电的塔」「储能够不够一次超载」。所以供电做成一格一点的分格条
 * （数格子 = 数答案），储能环上把 20 的超载门槛刻死。
 */

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export class ResourceRail {
  readonly root: HTMLElement;

  private readonly goldValue: HTMLElement;
  private readonly goldDelta: HTMLElement;
  private readonly powerSegments: HTMLElement;
  private readonly powerCount: HTMLElement;
  private readonly battery: HTMLElement;
  private readonly batteryArc: SVGCircleElement;
  private readonly batteryTick: SVGLineElement;
  private readonly batteryValue: HTMLElement;
  private readonly integrity: HTMLElement;
  private readonly integrityFill: HTMLElement;
  private readonly integrityValue: HTMLElement;
  private readonly integrityTicks: HTMLElement;
  private readonly integrityMarks: HTMLElement;

  private segmentNodes: HTMLElement[] = [];
  private lastCap = -1;
  private lastGold = Number.NaN;
  private lastDeficit = 0;
  private lastThresholdKey = '';
  private lastLossEnabled = true;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.goldValue = el('span', 'lw-gold__value', '0');
    this.goldDelta = el('span', 'lw-gold__delta');
    const gold = el('div', 'lw-gold', this.goldValue, this.goldDelta);

    this.powerSegments = el('div', 'lw-power__segments');
    this.powerCount = el('span', 'lw-power__count', '0/0');
    const power = el(
      'div',
      'lw-power',
      el('div', 'lw-label', '供电'),
      el('div', 'lw-power__row', this.powerSegments, this.powerCount),
    );

    this.batteryArc = svg('circle', {
      cx: 28,
      cy: 28,
      r: RING_RADIUS,
      fill: 'none',
      stroke: hexToCss(COLORS.electric, 1),
      'stroke-width': 5,
      'stroke-linecap': 'butt',
      'stroke-dasharray': `0 ${RING_CIRCUMFERENCE}`,
      transform: 'rotate(-90 28 28)',
      filter: 'url(#lw-ring-glow)',
    });
    this.batteryTick = svg('line', {
      x1: 28,
      y1: 3,
      x2: 28,
      y2: 9,
      stroke: hexToCss(COLORS.electric, 0.95),
      'stroke-width': 2,
    });
    this.batteryValue = el('span', 'lw-battery__value', '0');

    const ring = svg(
      'svg',
      { class: 'lw-battery__ring', viewBox: '0 0 56 56' },
      // 自带辉光：UI 不吃场景 Bloom（VISUAL_BIBLE 10.4）
      svg(
        'defs',
        {},
        (() => {
          const filter = svg('filter', {
            id: 'lw-ring-glow',
            x: '-60%',
            y: '-60%',
            width: '220%',
            height: '220%',
          });
          filter.append(
            svg('feGaussianBlur', { stdDeviation: 2.4, result: 'blur' }),
            (() => {
              const merge = svg('feMerge', {});
              merge.append(
                svg('feMergeNode', { in: 'blur' }),
                svg('feMergeNode', { in: 'blur' }),
                svg('feMergeNode', { in: 'SourceGraphic' }),
              );
              return merge;
            })(),
          );
          return filter;
        })(),
      ),
      svg('circle', {
        cx: 28,
        cy: 28,
        r: RING_RADIUS,
        fill: 'none',
        stroke: hexToCss(COLORS.electric, 0.14),
        'stroke-width': 5,
      }),
      this.batteryArc,
      this.batteryTick,
    );

    this.battery = el(
      'div',
      'lw-battery',
      ring,
      el(
        'div',
        'lw-battery__text',
        el('div', 'lw-label', '储能'),
        this.batteryValue,
      ),
    );

    this.integrityFill = el('div', 'lw-integrity__fill');
    this.integrityTicks = el('div', 'lw-integrity__track', this.integrityFill);
    this.integrityMarks = el('div', 'lw-integrity__marks');
    this.integrityValue = el('span', 'lw-power__count', '100');
    this.integrity = el(
      'div',
      'lw-integrity',
      el(
        'div',
        'lw-power__row',
        el('div', 'lw-label', '核心完整度'),
        this.integrityValue,
      ),
      this.integrityTicks,
      this.integrityMarks,
    );

    this.root = el('div', 'lw-panel lw-rail', gold, power, this.battery, this.integrity);
  }

  update(state: HudState): void {
    this.updateGold(state.gold);
    this.updatePower(state.power);
    this.updateBattery(state.battery);
    this.updateIntegrity(state.integrity);
  }

  private updateGold(gold: number): void {
    setText(this.goldValue, String(Math.floor(gold)));
    if (Number.isNaN(this.lastGold)) {
      this.lastGold = gold;
      return;
    }
    const delta = Math.round(gold - this.lastGold);
    this.lastGold = gold;
    if (delta === 0) return;

    // 漏怪抢金币要红色跳字（GDD 15.2），入账是金色
    setText(this.goldDelta, delta > 0 ? `+${delta}` : String(delta));
    setClass(this.goldDelta, 'lw-gold__delta--gain', delta > 0);
    setClass(this.goldDelta, 'lw-gold__delta--loss', delta < 0);
    this.goldDelta.classList.remove('lw-gold__delta--show');
    void this.goldDelta.offsetWidth;
    this.goldDelta.classList.add('lw-gold__delta--show');

    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = setTimeout(() => {
      this.goldDelta.classList.remove('lw-gold__delta--show');
    }, 700);
  }

  private updatePower(power: HudState['power']): void {
    // 缺口格要画出来，玩家才知道「差几点」而不只是「不够」
    const total = power.cap + Math.max(power.deficit, 0);
    if (total !== this.lastCap) {
      this.lastCap = total;
      this.powerSegments.replaceChildren();
      this.segmentNodes = [];
      for (let i = 0; i < total; i++) {
        const seg = el('div', 'lw-seg');
        this.segmentNodes.push(seg);
        this.powerSegments.append(seg);
      }
    }

    for (let i = 0; i < this.segmentNodes.length; i++) {
      const seg = this.segmentNodes[i];
      const used = i < power.used;
      const overCap = i >= power.cap;
      setClass(seg, 'lw-seg--used', used && !overCap);
      setClass(seg, 'lw-seg--free', !used && !overCap);
      setClass(seg, 'lw-seg--deficit', overCap);
    }

    // 新出现的缺口重放一次闪烁（VISUAL_BIBLE 10.4：警红闪 2 次）
    if (power.deficit > 0 && power.deficit !== this.lastDeficit) {
      for (let i = power.cap; i < this.segmentNodes.length; i++) {
        restartAnimation(this.segmentNodes[i]);
      }
    }
    this.lastDeficit = power.deficit;

    setText(this.powerCount, `${power.used}/${power.cap}`);
    setClass(this.powerCount, 'lw-power__count--short', power.deficit > 0);
  }

  private updateBattery(battery: HudState['battery']): void {
    const ratio = battery.max > 0 ? Math.min(Math.max(battery.value / battery.max, 0), 1) : 0;
    const filled = ratio * RING_CIRCUMFERENCE;
    setAttr(this.batteryArc, 'stroke-dasharray', `${filled.toFixed(2)} ${RING_CIRCUMFERENCE}`);
    setText(this.batteryValue, String(Math.floor(battery.value)));

    // 超载门槛刻度：一眼看出「够不够放一次超载」
    const tickRatio = battery.max > 0 ? battery.overloadCost / battery.max : 0;
    const angle = tickRatio * Math.PI * 2 - Math.PI / 2;
    const inner = RING_RADIUS - 4.5;
    const outer = RING_RADIUS + 3;
    setAttr(this.batteryTick, 'x1', (28 + Math.cos(angle) * inner).toFixed(2));
    setAttr(this.batteryTick, 'y1', (28 + Math.sin(angle) * inner).toFixed(2));
    setAttr(this.batteryTick, 'x2', (28 + Math.cos(angle) * outer).toFixed(2));
    setAttr(this.batteryTick, 'y2', (28 + Math.sin(angle) * outer).toFixed(2));
    setAttr(
      this.batteryTick,
      'stroke',
      hexToCss(battery.value >= battery.overloadCost ? COLORS.electric : COLORS.alert, 0.95),
    );

    setClass(this.battery, 'lw-battery--full', ratio >= 1);
  }

  private updateIntegrity(integrity: HudState['integrity']): void {
    const ratio = integrity.max > 0 ? Math.min(Math.max(integrity.value / integrity.max, 0), 1) : 0;
    setStyle(this.integrityFill, 'width', `${(ratio * 100).toFixed(1)}%`);
    setText(this.integrityValue, String(Math.ceil(integrity.value)));

    // 丢区关掉时（M1），刻度还在，但它预告的事情不会发生：写「已丢」是骗人，
    // 而完全不动它等于让玩家一直等一个不会来的惩罚。所以改成「跌破」的记号。
    const lossEnabled = integrity.lossEnabled !== false;
    const key = integrity.thresholds
      .map((t) => `${t.value}:${t.label}:${t.lost ? 1 : 0}:${t.breached ? 1 : 0}`)
      .join('|');
    if (key !== this.lastThresholdKey || lossEnabled !== this.lastLossEnabled) {
      this.lastThresholdKey = key;
      this.lastLossEnabled = lossEnabled;
      // 刻度线画在条上，标签画在条下——阈值旁边预告丢哪个区（GDD 14.1）
      for (const node of Array.from(this.integrityTicks.querySelectorAll('.lw-integrity__tick'))) {
        node.remove();
      }
      this.integrityMarks.replaceChildren();
      for (const threshold of integrity.thresholds) {
        const percent = (threshold.value / integrity.max) * 100;
        const tick = el('div', 'lw-integrity__tick');
        tick.style.left = `${percent}%`;
        this.integrityTicks.append(tick);

        const breached = threshold.breached === true;
        const flagged = lossEnabled ? threshold.lost : breached;
        const suffix = lossEnabled ? (threshold.lost ? ' 已丢' : '') : '';
        const mark = el('div', 'lw-integrity__mark', `${threshold.label}${suffix}`);
        mark.style.left = `${percent}%`;
        mark.style.opacity = flagged ? '1' : '0.7';
        setClass(mark, 'lw-integrity__mark--breached', !lossEnabled && breached);
        mark.title = lossEnabled
          ? `完整度跌破 ${threshold.value}，丢掉「${threshold.label}」`
          : `完整度跌破 ${threshold.value}：本里程碑只记伤，不会丢掉「${threshold.label}」`;
        this.integrityMarks.append(mark);
      }
    }

    const nextThreshold = integrity.thresholds.find((t) =>
      lossEnabled ? !t.lost : t.breached !== true,
    );
    setClass(
      this.integrity,
      'lw-integrity--critical',
      nextThreshold !== undefined && integrity.value <= nextThreshold.value + 10,
    );
  }
}
