/**
 * Public engine surface.
 *
 * The gameplay, combat, VFX and UI layers should import from `@engine` only.
 * Anything not re-exported here is an internal detail and may change without
 * a heads-up; if you need something else, ask for it to be added rather than
 * deep-importing a path.
 */

export { Engine, type EngineStats, type ViewportEvent } from './Engine';

export { CameraRig } from './core/CameraRig';
export {
  Loop,
  type FixedUpdateEvent,
  type FrameBeginEvent,
  type RenderEvent,
} from './core/Loop';
export { Signal, type Listener } from './core/Signal';
export { WebGL2UnsupportedError, createRenderer, describeGpu } from './core/renderer';

export { GridView } from './grid/GridView';
export {
  GRID_DEPTH,
  GRID_WIDTH,
  type Cell,
  cellIndex,
  cellToWorld,
  clampToGrid,
  indexToCell,
  isInside,
  worldToCell,
} from './grid/coords';

export { Lighting } from './scene/Lighting';
export { EmissiveTestbed } from './scene/EmissiveTestbed';

export { EmissiveMask } from './postfx/EmissiveMask';
export { PostPipeline } from './postfx/PostPipeline';
export {
  clearBloomMaskPolicy,
  getBloomMaskPolicy,
  hideFromBloomMask,
  setBloomMaskPolicy,
  skipBloomMask,
  type BloomMaskPolicy,
} from './postfx/bloomMask';

export { DebugHud } from './debug/DebugHud';

export { BLOOM, CAMERA, DEVICE, GRID, LAYERS, LIGHTING, PALETTE, SIM, SURFACE } from './config';
