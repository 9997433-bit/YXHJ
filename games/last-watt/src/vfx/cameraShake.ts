import * as THREE from 'three';
import type { ImpactState } from './ImpactDirector';

/**
 * 把 `ImpactState.shake` 换算成世界空间偏移。
 *
 * 相机是固定俯角、不可旋转的（GDD 15.1），所以震动只能是**平移**——
 * 一旦让它转起来，网格的斜俯视读数就会飘，玩家点格子会点偏。
 * 偏移沿相机的右轴与上轴施加，量纲是「屏幕高度的比例 × 当前视口世界高度」。
 */
const right = new THREE.Vector3();
const up = new THREE.Vector3();

export function computeShakeOffset(
  camera: THREE.PerspectiveCamera,
  state: ImpactState,
  target: THREE.Vector3,
  focusDistance: number,
): THREE.Vector3 {
  target.set(0, 0, 0);
  if (state.shake.x === 0 && state.shake.y === 0) return target;

  // 视口在对焦距离处的世界高度：把「屏幕比例」变成世界单位
  const worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * focusDistance;

  camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
  target
    .copy(right)
    .multiplyScalar(state.shake.x * worldHeight)
    .addScaledVector(up, state.shake.y * worldHeight);
  return target;
}
