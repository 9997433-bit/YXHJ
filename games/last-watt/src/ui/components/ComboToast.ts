import { el, setText } from '../dom';
import { COLORS, hexToCss } from '../theme';

/**
 * combo 一次性提示条（GDD 14.2）。
 *
 * 「每档案只弹一次」是设计红线：教学靠的是玩家自己打出来的那一下，
 * 提示条只负责给那一下命名。所以 `seen` 集合由外部（Profile 存档）注入，
 * 本组件不自己决定什么叫「见过」。
 */

/** 规范 combo id：`data/reactions.json` 的 `combo` 字段（Round 2 拍板第 3 条）。 */
export type ComboId = 'shatter' | 'oil_fire' | 'conduct' | 'overload';

const COMBO_TIPS: Record<ComboId, { text: string; color: string }> = {
  shatter: { text: '碎裂！冻结的敌人怕重击', color: COLORS.ice },
  oil_fire: { text: '点燃！沾油的敌人怕火', color: COLORS.fire },
  conduct: { text: '导电！湿的敌人会把电传下去', color: COLORS.electric },
  overload: { text: '超载！攻速翻倍，之后会跳闸停机', color: COLORS.electric },
};

/** Round 1 期 UI 自造的旧名。调用方改完即可删，别在这里长第三套名字。 */
const COMBO_ALIASES: Record<string, ComboId> = {
  'ice-shatter': 'shatter',
  'oil-fire': 'oil_fire',
};

export class ComboToast {
  readonly root: HTMLElement;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly seen: Set<string>;

  /**
   * @param seen 已见过的 combo id 集合，来自 Profile 存档；HUD 会就地写入，
   *             宿主负责持久化（GDD 13：Profile 记录 codex_seen）
   */
  constructor(seen: Iterable<string> = []) {
    this.seen = new Set(seen);
    this.root = el('div', 'lw-panel lw-toast');
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
  }

  /**
   * @param combo 规范 combo id；旧的 kebab 名也认
   * @returns 是否真的弹了（已见过、或 id 不认识则返回 false）
   */
  showCombo(combo: ComboId | string, durationMs = 3000): boolean {
    const id = COMBO_ALIASES[combo] ?? (combo as ComboId);
    const tip = COMBO_TIPS[id];
    // 认不出来的 combo 静默丢掉：提示条是教学件，不该替战斗层报错
    if (!tip) return false;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.show(tip.text, tip.color, durationMs);
    return true;
  }

  /** 非 combo 的一次性提示（如「冰火不容，伤害减半」）。 */
  show(text: string, colorHex: string = COLORS.ice, durationMs = 3000): void {
    setText(this.root, text);
    this.root.style.color = hexToCss(colorHex, 1);
    this.root.style.textShadow = `0 0 10px ${hexToCss(colorHex, 0.55)}`;
    this.root.style.boxShadow = `0 0 18px ${hexToCss(colorHex, 0.28)}`;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('lw-toast--show');

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.root.classList.remove('lw-toast--show');
      this.timer = setTimeout(() => {
        this.root.hidden = true;
      }, 260);
    }, durationMs);
  }

  get seenIds(): string[] {
    return [...this.seen];
  }
}
