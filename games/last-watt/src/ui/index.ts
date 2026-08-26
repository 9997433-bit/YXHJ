/**
 * `src/ui` 对外出口。
 *
 * 玩法层只需要 `Hud` + `HudState`：构造一次，之后每帧推状态。
 */

export { Hud } from './Hud';
export {
  createEmptyHudState,
  type BuildItemState,
  type HudCallbacks,
  type HudState,
  type TargetPriority,
  type TowerInspectState,
  type TowerUpgradeOption,
  type WavePreviewEntry,
  type ZoneThreshold,
} from './hudState';
export { ComboToast, type ComboId } from './components/ComboToast';
export { ImpactOverlay } from './components/ImpactOverlay';
export { createIcon, type IconName } from './icons';
export { HUD_CSS, injectHudStyles } from './styles';
export { COLORS, EMISSIVE, glow, hexToCss, textGlow } from './theme';
