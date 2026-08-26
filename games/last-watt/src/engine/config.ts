/**
 * Engine-wide tuning constants.
 *
 * Everything here is locked by the GDD (docs/GDD-余电.md). Where a value comes
 * from a specific ruling the chapter is cited so a later change has to argue
 * with the design doc rather than with this file.
 */

/** Grid dimensions — GDD §5.1: 20×12 cells. */
export const GRID = {
  cols: 20,
  rows: 12,
  /** World units per cell. 1 unit == 1 cell keeps gameplay math free of scale factors. */
  cellSize: 1,
} as const;

/** Camera rig — GDD §15.1: perspective, FOV 30°, pitch 55°, fixed yaw, two zoom steps. */
export const CAMERA = {
  fov: 30,
  /** Degrees above the horizon. */
  pitchDeg: 55,
  /** Degrees around world Y. 0 keeps the grid axis-aligned on screen. */
  yawDeg: 0,
  near: 1,
  far: 400,
  /**
   * Zoom steps as a multiplier on the "whole grid fits the viewport" distance.
   * Index 0 is the tactical overview, index 1 is the close read.
   */
  zoomSteps: [1.0, 0.62] as const,
  /** Extra breathing room around the grid at the widest zoom step. */
  fitMargin: 1.1,
} as const;

/**
 * Colour legislation — GDD §15.2. Hex numbers (not strings) so they can be fed
 * straight into THREE.Color without a parse.
 */
export const PALETTE = {
  /** 电青 — power / conduction / overload / ultimate. */
  electric: 0x35e0ff,
  /** 橙红 — fire / self-destruct. */
  ember: 0xff7a29,
  /** 冰白 — ice / shatter. */
  frost: 0xbff7ff,
  /** 焦褐 — oil slick / dust. */
  tar: 0x6b4a2b,
  /** 金黄 — economy. */
  coin: 0xffd84d,
  /** 警红 — zone loss / core damage. */
  alarm: 0xff3b30,
} as const;

/** Rusted-iron wasteland base tones. Non-emissive; these must never bloom. */
export const SURFACE = {
  /** Scene clear colour / far fog. */
  voidColor: 0x0d0908,
  /** Ground slab. */
  rustBase: 0x7a5340,
  /** Alternating plate tint, keeps the 20×12 read legible without a texture. */
  rustPlate: 0x6d4835,
  /** Grid seam lines. */
  seam: 0x9b7458,
  /** Grid border. */
  border: 0xb98d68,
  /**
   * Rust is an oxide, not bare metal. Keeping metalness low is both physically
   * right and the only way the slab reads at all without an environment map.
   */
  rustRoughness: 0.9,
  rustMetalness: 0.12,
} as const;

/** Lighting — GDD §15.1: one fixed directional key light, no day/night. */
export const LIGHTING = {
  keyColor: 0xffd9b8,
  keyIntensity: 2.6,
  /** Direction the key light travels, in grid-relative units. */
  keyDirection: { x: -0.55, y: -1.0, z: -0.45 },
  /** Minimal sky/ground fill so unlit rust does not read as pure black. */
  fillSkyColor: 0x546a7e,
  fillGroundColor: 0x3a251b,
  fillIntensity: 1.35,
  /** Shadows stay readable but never crush to black. */
  shadowIntensity: 0.72,
} as const;

/**
 * Post-processing — GDD §15.1: bloom (emissive only), event-driven vignette,
 * light tonemapping. The bloom input is an emissive-only render, so the
 * threshold exists purely to reject faint emissive, not to reject lit albedo.
 */
export const BLOOM = {
  strength: 0.6,
  radius: 0.62,
  threshold: 0.0,
  /** Additive weight when the bloom buffer is composited over the beauty pass. */
  mix: 1.0,
  /** Render the bloom buffer at half res; it is a blur, nobody can tell. */
  resolutionScale: 0.5,
} as const;

/** Fixed simulation step. Gameplay logic must be frame-rate independent. */
export const SIM = {
  /** 60 Hz logic tick. */
  fixedDelta: 1 / 60,
  /** Never spiral: drop time rather than run more than this many catch-up steps. */
  maxSubSteps: 5,
} as const;

/** Render layers. Objects opt into bloom by material emissive, not by layer. */
export const LAYERS = {
  default: 0,
  /** Reserved for editor/debug gizmos that must never reach the beauty pass. */
  debug: 30,
} as const;

/** Device caps — GDD §4.2 targets 1080p/60 on GTX 1060 class hardware. */
export const DEVICE = {
  maxPixelRatio: 2,
} as const;
