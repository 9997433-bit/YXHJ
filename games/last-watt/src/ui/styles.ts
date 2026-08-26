import { COLORS, glow, hexToCss, textGlow } from './theme';

/**
 * HUD 样式表。
 *
 * 以 TS 字符串形式内联注入，不用 `.css` 文件——`src/ui` 因此不对打包器的
 * CSS loader 做任何假设，headless 自检和 Vite 里都是同一份样式。
 *
 * 所有发光效果用 box-shadow / text-shadow / SVG 滤镜实现（VISUAL_BIBLE 10.4：
 * UI 自发光与场景 Bloom 解耦），因此后处理被降级关掉时 HUD 不变样。
 */
export const HUD_CSS = `
.lw-hud {
  position: absolute;
  inset: 0;
  font-family: "Rajdhani", "DIN Alternate", "Barlow Semi Condensed", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  color: #dfe9ef;
  pointer-events: none;
  user-select: none;
  z-index: 10;
  --lw-electric: ${COLORS.electric};
  --lw-alert: ${COLORS.alert};
  --lw-coin: ${COLORS.coin};
  --lw-ice: ${COLORS.ice};
}

.lw-hud button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  pointer-events: auto;
}
.lw-hud button:disabled { cursor: not-allowed; }
.lw-hud button:focus-visible {
  outline: 2px solid ${hexToCss(COLORS.electric, 0.9)};
  outline-offset: 2px;
}

/* 锈铁上的深色玻璃面板：底噪一点点暖调，避免纯黑贴在废土场景上像挖了个洞 */
.lw-panel {
  background: linear-gradient(180deg, rgba(20, 16, 14, 0.82), rgba(12, 9, 8, 0.9));
  border: 1px solid rgba(138, 106, 82, 0.45);
  border-radius: 4px;
  box-shadow: inset 0 1px 0 rgba(255, 220, 190, 0.06), 0 4px 18px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
}

.lw-label {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(199, 178, 160, 0.75);
}

/* ---------------- 左上资源纵列 ---------------- */

.lw-rail {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 236px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lw-gold {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.lw-gold__value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  color: ${hexToCss(COLORS.coin, 1)};
  text-shadow: ${textGlow(COLORS.coin)};
}
.lw-gold__delta {
  font-size: 15px;
  font-weight: 700;
  opacity: 0;
  transform: translateY(0);
  transition: opacity 0.18s ease-out, transform 0.5s ease-out;
}
.lw-gold__delta--show { opacity: 1; transform: translateY(-9px); }
.lw-gold__delta--gain { color: ${hexToCss(COLORS.coin, 1)}; text-shadow: ${textGlow(COLORS.coin, 0.8)}; }
.lw-gold__delta--loss { color: ${hexToCss(COLORS.alert, 1)}; text-shadow: ${textGlow(COLORS.alert, 0.8)}; }

/* 供电条：1 格 = 1 点供电，格数即答案「还能建几点电的塔」 */
.lw-power__row { display: flex; align-items: center; gap: 8px; }
.lw-power__segments {
  display: flex;
  gap: 2px;
  flex: 1;
  height: 14px;
}
.lw-seg {
  flex: 1;
  min-width: 3px;
  border-radius: 1px;
  background: rgba(53, 224, 255, 0.07);
  border: 1px solid rgba(53, 224, 255, 0.22);
  transition: background-color 0.12s linear, box-shadow 0.12s linear;
}
.lw-seg--used {
  background: ${hexToCss(COLORS.electric, 0.92)};
  border-color: ${hexToCss(COLORS.electric, 1)};
  box-shadow: ${glow(COLORS.electric, 0.55)};
}
/* 空闲格 = 正在给储能充电，1Hz 呼吸把「没建满有收益」说出来 */
.lw-seg--free { animation: lw-breathe 1s ease-in-out infinite; }
.lw-seg--deficit {
  background: ${hexToCss(COLORS.alert, 0.25)};
  border-color: ${hexToCss(COLORS.alert, 0.95)};
  animation: lw-deficit-flash 0.28s steps(1) 4;
}
@keyframes lw-breathe {
  0%, 100% { border-color: rgba(53, 224, 255, 0.18); }
  50% { border-color: rgba(53, 224, 255, 0.5); box-shadow: 0 0 6px rgba(53, 224, 255, 0.25); }
}
@keyframes lw-deficit-flash {
  0%, 100% { background: ${hexToCss(COLORS.alert, 0.55)}; }
  50% { background: rgba(0, 0, 0, 0.1); }
}
.lw-power__count { font-size: 13px; min-width: 46px; text-align: right; }
.lw-power__count--short { color: ${hexToCss(COLORS.alert, 1)}; text-shadow: ${textGlow(COLORS.alert, 0.7)}; }

/* 储能环 */
.lw-battery { display: flex; align-items: center; gap: 10px; }
.lw-battery__ring { width: 56px; height: 56px; flex: none; }
.lw-battery__text { display: flex; flex-direction: column; gap: 2px; }
.lw-battery__value {
  font-size: 17px;
  font-weight: 700;
  color: ${hexToCss(COLORS.electric, 1)};
  text-shadow: ${textGlow(COLORS.electric, 0.7)};
}
.lw-battery--full .lw-battery__ring { animation: lw-pulse 1s ease-in-out infinite; }
@keyframes lw-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.2); } }

/* 完整度：80 / 50 两条阈值刻度，刻度旁预告要丢哪个变电区 */
.lw-integrity__track {
  position: relative;
  height: 12px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 106, 82, 0.5);
  overflow: hidden;
}
.lw-integrity__fill {
  height: 100%;
  background: linear-gradient(90deg, ${hexToCss(COLORS.alert, 0.85)}, ${hexToCss(COLORS.coin, 0.9)} 55%, ${hexToCss(COLORS.ice, 0.9)});
  box-shadow: inset 0 0 8px rgba(255, 255, 255, 0.25);
  transition: width 0.25s ease-out;
}
.lw-integrity__tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: ${hexToCss(COLORS.alert, 0.9)};
  box-shadow: 0 0 6px ${hexToCss(COLORS.alert, 0.7)};
}
.lw-integrity__marks { position: relative; height: 12px; }
.lw-integrity__mark {
  position: absolute;
  transform: translateX(-50%);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: ${hexToCss(COLORS.alert, 0.85)};
  white-space: nowrap;
}
/* 丢区关掉时：跌破的刻度亮起来，但不写「已丢」 */
.lw-integrity__mark--breached { font-weight: 700; text-shadow: ${textGlow(COLORS.alert, 0.6)}; }
.lw-integrity--critical .lw-integrity__track {
  border-color: ${hexToCss(COLORS.alert, 0.9)};
  box-shadow: ${glow(COLORS.alert, 0.5)};
}

/* ---------------- 顶部波次 ---------------- */

.lw-wave {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
}
.lw-wave__counter { display: flex; align-items: baseline; gap: 4px; }
.lw-wave__current { font-size: 24px; font-weight: 700; text-shadow: ${textGlow(COLORS.ice, 0.5)}; }
.lw-wave__total { font-size: 13px; opacity: 0.6; }
.lw-wave__preview { display: flex; gap: 8px; align-items: center; }
.lw-preview-item {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(138, 106, 82, 0.35);
}
.lw-preview-item__count { font-size: 13px; font-weight: 700; }
/* 对空 / 拆 / 疗三类破阵敌要在预览里就跳出来，玩家才有时间改阵 */
.lw-preview-item--air { border-color: ${hexToCss(COLORS.electric, 0.8)}; box-shadow: ${glow(COLORS.electric, 0.35)}; }
.lw-preview-item--breaker { border-color: ${hexToCss(COLORS.fire, 0.85)}; box-shadow: ${glow(COLORS.fire, 0.35)}; }
.lw-preview-item--healer { border-color: ${hexToCss(COLORS.ice, 0.85)}; box-shadow: ${glow(COLORS.ice, 0.35)}; }
.lw-wave__early {
  padding: 6px 12px;
  border-radius: 3px;
  border: 1px solid ${hexToCss(COLORS.coin, 0.7)};
  color: ${hexToCss(COLORS.coin, 1)};
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-shadow: ${textGlow(COLORS.coin, 0.6)};
  transition: box-shadow 0.15s, background-color 0.15s;
}
.lw-wave__early:hover:not(:disabled) {
  background: ${hexToCss(COLORS.coin, 0.14)};
  box-shadow: ${glow(COLORS.coin, 0.5)};
}
.lw-wave__early:disabled { opacity: 0.35; border-color: rgba(138, 106, 82, 0.5); color: rgba(199, 178, 160, 0.6); text-shadow: none; }

/* ---------------- 底部建造菜单 ---------------- */

.lw-build {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 8px;
}
.lw-build__item {
  position: relative;
  width: 74px;
  height: 78px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  padding: 6px 4px 5px;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(32, 26, 22, 0.75), rgba(14, 11, 10, 0.85));
  border: 1px solid rgba(138, 106, 82, 0.45);
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.08s;
}
.lw-build__item:hover:not(:disabled) { transform: translateY(-2px); border-color: ${hexToCss(COLORS.electric, 0.7)}; box-shadow: ${glow(COLORS.electric, 0.4)}; }
.lw-build__item--selected { border-color: ${hexToCss(COLORS.electric, 1)}; box-shadow: ${glow(COLORS.electric, 0.7)}; }
/* 未解锁：压暗图面，但解锁波次角标保持满对比——「锁着」是状态，「第几波开」才是信息 */
.lw-build__item--locked { border-color: rgba(138, 106, 82, 0.24); }
.lw-build__item--locked .lw-build__icon,
.lw-build__item--locked .lw-build__name,
.lw-build__item--locked .lw-build__cost,
.lw-build__item--locked .lw-build__badge,
.lw-build__item--locked .lw-build__hotkey { opacity: 0.26; filter: grayscale(1); }
.lw-build__item--unaffordable .lw-build__cost { color: ${hexToCss(COLORS.alert, 1)}; }
/* 电力不足：整项灰显 + 警红缺口数（GDD 14.1） */
.lw-build__item--nopower { filter: grayscale(0.85) brightness(0.7); }
.lw-build__icon { width: 30px; height: 30px; }
.lw-build__name { font-size: 10px; letter-spacing: 0.04em; opacity: 0.85; }
.lw-build__cost { font-size: 12px; font-weight: 700; color: ${hexToCss(COLORS.coin, 1)}; }
.lw-build__badge {
  position: absolute;
  top: 3px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 2px;
  line-height: 1.3;
}
.lw-build__badge--power {
  right: 3px;
  color: ${hexToCss(COLORS.electric, 1)};
  border: 1px solid ${hexToCss(COLORS.electric, 0.6)};
  text-shadow: ${textGlow(COLORS.electric, 0.5)};
}
.lw-build__badge--air {
  left: 3px;
  color: ${hexToCss(COLORS.ice, 1)};
  border: 1px solid ${hexToCss(COLORS.ice, 0.55)};
}
.lw-build__badge--deficit {
  right: 3px;
  color: #fff;
  background: ${hexToCss(COLORS.alert, 0.85)};
  border: 1px solid ${hexToCss(COLORS.alert, 1)};
  box-shadow: ${glow(COLORS.alert, 0.45)};
}
.lw-build__hotkey {
  position: absolute;
  bottom: 3px;
  right: 4px;
  font-size: 9px;
  opacity: 0.45;
}
.lw-build__lock {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: ${hexToCss(COLORS.ice, 1)};
  background: rgba(10, 8, 7, 0.86);
  border: 1px solid ${hexToCss(COLORS.ice, 0.45)};
}

/* ---------------- 右下：工程 + 大招 ---------------- */

.lw-actions {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.lw-eng { display: flex; gap: 6px; }
.lw-eng__button {
  position: relative;
  width: 60px;
  height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 3px;
  background: rgba(18, 14, 12, 0.8);
  border: 1px solid rgba(138, 106, 82, 0.5);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.lw-eng__button:hover:not(:disabled) { border-color: ${hexToCss(COLORS.coin, 0.8)}; box-shadow: ${glow(COLORS.coin, 0.35)}; }
.lw-eng__button:disabled { opacity: 0.35; }
.lw-eng__button--armed { border-color: ${hexToCss(COLORS.coin, 1)}; box-shadow: ${glow(COLORS.coin, 0.6)}; }
.lw-eng__count {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 11px;
  font-weight: 700;
  color: ${hexToCss(COLORS.coin, 1)};
}
.lw-eng__icon { width: 22px; height: 22px; }
/* 左上角：右上角是剩余次数，中间是图标与标签，只有这里是空的 */
.lw-eng__free {
  position: absolute;
  top: 2px;
  left: 3px;
  padding: 0 3px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #150f09;
  background: ${hexToCss(COLORS.coin, 0.92)};
}
.lw-eng__button--free { border-color: ${hexToCss(COLORS.coin, 0.7)}; box-shadow: ${glow(COLORS.coin, 0.35)}; }

.lw-ult {
  position: relative;
  width: 126px;
  height: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 4px;
  background: radial-gradient(120% 140% at 50% 120%, rgba(53, 224, 255, 0.16), rgba(10, 14, 16, 0.9));
  border: 1px solid ${hexToCss(COLORS.electric, 0.55)};
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.lw-ult:disabled { opacity: 0.4; border-color: rgba(138, 106, 82, 0.5); background: rgba(12, 10, 9, 0.85); }
.lw-ult--ready { animation: lw-ult-pulse 1.2s ease-in-out infinite; }
@keyframes lw-ult-pulse {
  0%, 100% { box-shadow: ${glow(COLORS.electric, 0.4)}; }
  50% { box-shadow: ${glow(COLORS.electric, 1.15)}; }
}
.lw-ult__pips { display: flex; gap: 4px; }
.lw-ult__pip {
  width: 22px;
  height: 5px;
  border-radius: 1px;
  background: rgba(53, 224, 255, 0.12);
  border: 1px solid ${hexToCss(COLORS.electric, 0.35)};
}
.lw-ult__pip--charged {
  background: ${hexToCss(COLORS.electric, 0.95)};
  box-shadow: ${glow(COLORS.electric, 0.6)};
}

/* ---------------- 塔检视面板 ---------------- */

.lw-inspector {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 224px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}
.lw-inspector__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lw-inspector__name { font-size: 15px; font-weight: 700; text-shadow: ${textGlow(COLORS.ice, 0.4)}; }
.lw-inspector__close { font-size: 15px; opacity: 0.6; padding: 0 4px; }
.lw-inspector__stats { display: grid; grid-template-columns: auto auto; gap: 2px 10px; font-size: 11px; }
.lw-inspector__stat-value { text-align: right; color: ${hexToCss(COLORS.ice, 0.95)}; }
.lw-upgrades { display: flex; gap: 6px; }
.lw-upgrade {
  flex: 1;
  padding: 7px 5px;
  border-radius: 3px;
  border: 1px solid rgba(138, 106, 82, 0.5);
  background: rgba(0, 0, 0, 0.35);
  font-size: 10px;
  line-height: 1.35;
  text-align: center;
}
.lw-upgrade:hover:not(:disabled) { border-color: ${hexToCss(COLORS.electric, 0.8)}; box-shadow: ${glow(COLORS.electric, 0.35)}; }
.lw-upgrade:disabled { opacity: 0.4; }
.lw-upgrade__cost { display: block; margin-top: 3px; font-weight: 700; color: ${hexToCss(COLORS.coin, 1)}; }
.lw-priority { display: flex; gap: 3px; }
.lw-priority__button {
  flex: 1;
  padding: 4px 0;
  font-size: 10px;
  border-radius: 2px;
  border: 1px solid rgba(138, 106, 82, 0.45);
}
.lw-priority__button--active {
  border-color: ${hexToCss(COLORS.electric, 0.9)};
  color: ${hexToCss(COLORS.electric, 1)};
  box-shadow: ${glow(COLORS.electric, 0.3)};
}
.lw-sell {
  padding: 6px;
  border-radius: 3px;
  border: 1px solid ${hexToCss(COLORS.alert, 0.55)};
  color: ${hexToCss(COLORS.alert, 0.95)};
  font-size: 11px;
}
.lw-sell:hover { background: ${hexToCss(COLORS.alert, 0.14)}; box-shadow: ${glow(COLORS.alert, 0.4)}; }

/* ---------------- combo 提示条 ---------------- */

.lw-toast {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translate(-50%, -14px);
  padding: 9px 20px;
  border-radius: 3px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.05em;
  opacity: 0;
  transition: opacity 0.22s ease-out, transform 0.22s ease-out;
  background: linear-gradient(180deg, rgba(24, 20, 18, 0.94), rgba(12, 10, 9, 0.94));
  border: 1px solid currentColor;
}
.lw-toast--show { opacity: 1; transform: translate(-50%, 0); }

/* ---------------- 老周电台气泡 ---------------- */

.lw-radio {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: 320px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
}
.lw-radio--show { opacity: 1; transform: translateY(0); }
.lw-radio__avatar {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 2px;
  border: 1px solid ${hexToCss(COLORS.coin, 0.5)};
  background: radial-gradient(circle at 50% 35%, rgba(255, 216, 77, 0.25), rgba(0, 0, 0, 0.5));
}
.lw-radio__speaker {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: ${hexToCss(COLORS.coin, 0.9)};
}
/* 无线电杂音：短促的水平扫描线，暗示这是对讲机不是旁白 */
.lw-radio__line { font-size: 13px; line-height: 1.45; }
.lw-radio__line::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 12px;
  margin-left: 4px;
  vertical-align: -1px;
  background: ${hexToCss(COLORS.coin, 0.8)};
  animation: lw-caret 0.6s steps(1) infinite;
}
@keyframes lw-caret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* ---------------- 全屏冲击叠加层 ---------------- */

/* 闪光与暗角由 ImpactDirector 驱动。用固定层而不是每次新建元素，
   否则 60ms 一次的白闪会在合成器上反复触发 layer 重建。 */
.lw-impact {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
}
.lw-impact__flash { position: absolute; inset: 0; mix-blend-mode: screen; }
.lw-impact__vignette { position: absolute; inset: 0; }
`;

let injected: HTMLStyleElement | null = null;

/** 幂等注入：多次 mount HUD（热重载）不会堆叠 style 标签。 */
export function injectHudStyles(doc: Document = document): void {
  if (injected && injected.isConnected) return;
  const existing = doc.getElementById('lw-hud-styles');
  if (existing) {
    injected = existing as HTMLStyleElement;
    return;
  }
  const style = doc.createElement('style');
  style.id = 'lw-hud-styles';
  style.textContent = HUD_CSS;
  doc.head.appendChild(style);
  injected = style;
}
