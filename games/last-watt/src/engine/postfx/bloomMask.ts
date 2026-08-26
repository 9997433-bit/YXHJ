import type { Object3D } from 'three';

/**
 * Opt-out contract for the emissive mask pass (GDD §15.1).
 *
 * `EmissiveMask` renders the bloom input by swapping every material in the
 * scene for an unlit proxy tinted by its emissive channel. That is correct for
 * lit meshes and wrong for anything whose look lives in its own shader:
 *
 * 1. A proxy material does not carry the object's vertex program, so a GPU
 *    particle system snaps every point back to its spawn position and the
 *    bloom buffer gets a ghost image;
 * 2. `PointsMaterial` / `MeshBasicMaterial` with no map draw solid squares, and
 *    the proxy defaults to black — the mask ends up with black blocks that
 *    subtract glow during compositing.
 *
 * Rather than have those objects defend themselves (the old `bloomMaskCompat`
 * hack locked the `material` property behind an accessor), they declare a
 * policy here and the mask pass honours it.
 */
export interface BloomMaskPolicy {
  /**
   * Render the object with its own material during the mask pass. Use it for
   * shader-driven objects that already decide per-fragment whether they belong
   * in the bloom buffer.
   */
  skipMaterialSwap?: boolean;
  /** Drop the object (and its children) from the mask pass entirely. */
  hidden?: boolean;
}

interface BloomMaskUserData {
  bloomMask?: BloomMaskPolicy;
}

/** Declare how `EmissiveMask` should treat this object. */
export function setBloomMaskPolicy(object: Object3D, policy: BloomMaskPolicy): void {
  (object.userData as BloomMaskUserData).bloomMask = policy;
}

export function getBloomMaskPolicy(object: Object3D): BloomMaskPolicy | undefined {
  return (object.userData as BloomMaskUserData).bloomMask;
}

export function clearBloomMaskPolicy(object: Object3D): void {
  delete (object.userData as BloomMaskUserData).bloomMask;
}

/**
 * Shorthand for the common case: keep my material, I know what I am doing.
 * Whether the object contributes to bloom is then its own shader's decision.
 */
export function skipBloomMask(object: Object3D): void {
  setBloomMaskPolicy(object, { skipMaterialSwap: true });
}

/** Shorthand for "never appears in the bloom buffer", subtree included. */
export function hideFromBloomMask(object: Object3D): void {
  setBloomMaskPolicy(object, { hidden: true });
}
