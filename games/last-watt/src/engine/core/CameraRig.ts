import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

import { CAMERA, GRID } from '../config';

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Fixed oblique top-down rig — GDD §15.1.
 *
 * Perspective FOV 30°, 55° above the horizon, yaw locked. The camera never
 * rotates: only the zoom step and the look-at target may move, so the grid's
 * screen-space geometry stays a constant the UI and VFX layers can rely on.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  private readonly target = new Vector3();
  private readonly offsetDir = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  private zoomIndex = 0;
  private aspect = 1;
  private fitDistance = 1;

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

    const pitch = MathUtils.degToRad(CAMERA.pitchDeg);
    const yaw = MathUtils.degToRad(CAMERA.yawDeg);
    // Unit vector from the look-at target back towards the camera.
    this.offsetDir
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .normalize();

    this.target.set((GRID.cols * GRID.cellSize) / 2, 0, (GRID.rows * GRID.cellSize) / 2);
    this.setViewport(1, 1);
  }

  /** Re-derives the fit distance for the new viewport and re-places the camera. */
  setViewport(width: number, height: number): void {
    this.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.aspect = this.aspect;
    this.fitDistance = this.computeFitDistance();
    this.apply();
  }

  /** Which zoom step is active (0 = overview, 1 = close). */
  get zoomStep(): number {
    return this.zoomIndex;
  }

  setZoomStep(index: number): void {
    const clamped = MathUtils.clamp(Math.round(index), 0, CAMERA.zoomSteps.length - 1);
    if (clamped === this.zoomIndex) return;
    this.zoomIndex = clamped;
    this.apply();
  }

  cycleZoom(): number {
    this.setZoomStep((this.zoomIndex + 1) % CAMERA.zoomSteps.length);
    return this.zoomIndex;
  }

  /** Ground-plane point the camera is centred on. */
  getTarget(out = new Vector3()): Vector3 {
    return out.copy(this.target);
  }

  setTarget(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.apply();
  }

  /**
   * Projects a pointer position onto the y=0 ground plane.
   * Returns null only if the ray runs parallel to the plane, which the locked
   * 55° pitch makes impossible in practice.
   */
  pointerToGround(clientX: number, clientY: number, rect: DOMRect, out = new Vector3()): Vector3 | null {
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(GROUND_PLANE, out);
  }

  private apply(): void {
    const distance = this.fitDistance * CAMERA.zoomSteps[this.zoomIndex];
    this.camera.position.copy(this.target).addScaledVector(this.offsetDir, distance);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Distance at which the whole 20×12 grid fits the viewport.
   *
   * The grid's depth is foreshortened by sin(pitch) when it lands on the
   * screen's vertical axis; its width is unaffected because yaw is locked to a
   * grid axis. Whichever axis needs more room wins.
   */
  private computeFitDistance(): number {
    const pitch = MathUtils.degToRad(CAMERA.pitchDeg);
    const halfFov = MathUtils.degToRad(CAMERA.fov) / 2;

    const worldWidth = GRID.cols * GRID.cellSize;
    const worldDepth = GRID.rows * GRID.cellSize;

    const halfScreenHeight = (worldDepth * Math.sin(pitch)) / 2;
    const halfScreenWidth = worldWidth / 2;

    const byHeight = halfScreenHeight / Math.tan(halfFov);
    const byWidth = halfScreenWidth / (Math.tan(halfFov) * this.aspect);

    return Math.max(byHeight, byWidth) * CAMERA.fitMargin;
  }
}
