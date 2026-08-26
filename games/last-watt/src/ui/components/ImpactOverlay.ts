import { el, setStyle } from '../dom';
import type { ImpactState } from '../../vfx/ImpactDirector';
import type { RGBA } from '../../vfx/palette';

/**
 * 全屏闪光 + 事件暗角，由 `ImpactDirector` 驱动（GDD 15.1「事件驱动 Vignette」）。
 *
 * 放在 UI 层而不是后处理里，有两个实际理由：
 * 1. 白闪只有 1 帧，走后处理要多一遍全屏 blit，性价比极差；
 * 2. 画质降级会关掉后处理，但「冰碎白闪」是玩法反馈，永不降级——
 *    挂在 UI 上它就天然不受降级影响。
 */

/** ImpactDirector 用线性色（要喂给粒子着色器），CSS 要 sRGB，这里转回去。 */
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(v, 0), 1) * 255);
}

function cssRgba(color: RGBA, alpha: number): string {
  return `rgba(${linearToSrgb(color[0])}, ${linearToSrgb(color[1])}, ${linearToSrgb(color[2])}, ${alpha.toFixed(3)})`;
}

export class ImpactOverlay {
  readonly root: HTMLElement;

  private readonly flash: HTMLElement;
  private readonly vignette: HTMLElement;
  private flashVisible = false;
  private vignetteVisible = false;

  constructor() {
    this.flash = el('div', 'lw-impact__flash');
    this.vignette = el('div', 'lw-impact__vignette');
    this.flash.style.display = 'none';
    this.vignette.style.display = 'none';
    this.root = el('div', 'lw-impact', this.vignette, this.flash);
  }

  apply(state: ImpactState): void {
    const flashAlpha = state.flash.alpha;
    if (flashAlpha > 0.001) {
      setStyle(this.flash, 'background-color', cssRgba(state.flash.color, flashAlpha));
      if (!this.flashVisible) {
        this.flash.style.display = '';
        this.flashVisible = true;
      }
    } else if (this.flashVisible) {
      // 彻底摘掉而不是留个透明层：合成器少一层永远是对的
      this.flash.style.display = 'none';
      this.flashVisible = false;
    }

    const vignetteAlpha = state.vignette.alpha;
    if (vignetteAlpha > 0.001) {
      const c = state.vignette.color;
      setStyle(
        this.vignette,
        'background',
        `radial-gradient(ellipse at center, ${cssRgba(c, 0)} 38%, ${cssRgba(c, vignetteAlpha * 0.55)} 76%, ${cssRgba(c, vignetteAlpha)} 100%)`,
      );
      if (!this.vignetteVisible) {
        this.vignette.style.display = '';
        this.vignetteVisible = true;
      }
    } else if (this.vignetteVisible) {
      this.vignette.style.display = 'none';
      this.vignetteVisible = false;
    }
  }
}
