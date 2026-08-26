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

  /** Where gameplay wants the camera centred; the framing solve adds an offset on top. */
  private readonly anchor = new Vector3();
  private readonly effectiveTarget = new Vector3();
  private readonly offsetDir = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly corner = new Vector3();
  private readonly shake = new Vector3();
  private readonly lookAt = new Vector3();

  private zoomIndex = 0;
  private aspect = 1;
  private fitDistance = 1;
  private frameOffsetZ = 0;

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

    const pitch = MathUtils.degToRad(CAMERA.pitchDeg);
    const yaw = MathUtils.degToRad(CAMERA.yawDeg);
    // Unit vector from the look-at target back towards the camera.
    this.offsetDir
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .normalize();

    this.anchor.set((GRID.cols * GRID.cellSize) / 2, 0, (GRID.rows * GRID.cellSize) / 2);
    this.setViewport(1, 1);
  }

  /** Re-solves the framing for the new viewport and re-places the camera. */
  setViewport(width: number, height: number): void {
    this.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.aspect = this.aspect;
    this.solveFraming();
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

  /** Ground-plane point the camera is actually looking at, framing offset included. */
  getTarget(out = new Vector3()): Vector3 {
    return out.copy(this.effectiveTarget);
  }

  /** Distance from the eye to the look-at point; VFX needs it to size screen shake. */
  get focusDistance(): number {
    return this.fitDistance * CAMERA.zoomSteps[this.zoomIndex];
  }

  /**
   * Impact shake, in world units (see `vfx/cameraShake`).
   *
   * Eye and look-at point move together, so this is a pure translation: the
   * locked 55° pitch and yaw survive, and a shaking screen never shifts which
   * cell sits under the cursor by more than the offset itself.
   */
  setShakeOffset(x: number, y: number, z: number): void {
    if (this.shake.x === x && this.shake.y === y && this.shake.z === z) return;
    this.shake.set(x, y, z);
    this.apply();
  }

  setTarget(x: number, z: number): void {
    this.anchor.set(x, 0, z);
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
    this.place(this.fitDistance * CAMERA.zoomSteps[this.zoomIndex], this.frameOffsetZ);
  }

  private place(distance: number, offsetZ: number): void {
    this.effectiveTarget.copy(this.anchor);
    this.effectiveTarget.z += offsetZ;
    this.lookAt.copy(this.effectiveTarget).add(this.shake);
    this.camera.position.copy(this.lookAt).addScaledVector(this.offsetDir, distance);
    this.camera.lookAt(this.lookAt);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  /**
   * Solves for the distance and vertical framing offset that fit the whole
   * 20×12 board.
   *
   * A closed-form fit is wrong here: under perspective the near edge of a
   * pitched board projects much larger than the far edge, so aiming at the
   * board's centre leaves dead space at the top and clips the bottom. Instead
   * the four ground corners are projected and the rig is re-centred and
   * re-scaled until they sit inside the viewport. Converges in a handful of
   * passes and only runs on resize, so the cost is irrelevant.
   */
  private solveFraming(): void {
    const pitch = MathUtils.degToRad(CAMERA.pitchDeg);
    const halfFov = MathUtils.degToRad(CAMERA.fov) / 2;

    // Solve against the resting rig: a shake offset mid-solve would feed back
    // into the projected corners and bake itself into the fit distance.
    const shakeX = this.shake.x;
    const shakeY = this.shake.y;
    const shakeZ = this.shake.z;
    this.shake.set(0, 0, 0);

    const worldWidth = GRID.cols * GRID.cellSize;
    const worldDepth = GRID.rows * GRID.cellSize;

    // Analytic starting guess: the board's depth is foreshortened by sin(pitch)
    // on the screen's vertical axis, its width is not (yaw is grid-aligned).
    const byHeight = (worldDepth * Math.sin(pitch)) / 2 / Math.tan(halfFov);
    const byWidth = worldWidth / 2 / (Math.tan(halfFov) * this.aspect);

    let distance = Math.max(byHeight, byWidth);
    let offsetZ = 0;

    for (let pass = 0; pass < 8; pass += 1) {
      this.place(distance, offsetZ);
      const centred = this.projectBoard();

      // World depth spanned by one NDC unit at the target plane. Pushing the
      // target away from the camera slides the board down the screen.
      const worldPerNdcY = (distance * Math.tan(halfFov)) / Math.sin(pitch);
      offsetZ -= ((centred.minY + centred.maxY) / 2) * worldPerNdcY;

      this.place(distance, offsetZ);
      const framed = this.projectBoard();

      const halfX = (framed.maxX - framed.minX) / 2;
      const halfY = (framed.maxY - framed.minY) / 2;
      distance *= Math.max(halfX, halfY) * CAMERA.fitMargin;
    }

    this.fitDistance = distance;
    this.frameOffsetZ = offsetZ;
    this.shake.set(shakeX, shakeY, shakeZ);
  }

  /** NDC bounding box of the board's four ground corners. */
  private projectBoard(): { minX: number; maxX: number; minY: number; maxY: number } {
    const worldWidth = GRID.cols * GRID.cellSize;
    const worldDepth = GRID.rows * GRID.cellSize;
    const corners: Array<[number, number]> = [
      [0, 0],
      [worldWidth, 0],
      [0, worldDepth],
      [worldWidth, worldDepth],
    ];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [x, z] of corners) {
      this.corner.set(x, 0, z).project(this.camera);
      minX = Math.min(minX, this.corner.x);
      maxX = Math.max(maxX, this.corner.x);
      minY = Math.min(minY, this.corner.y);
      maxY = Math.max(maxY, this.corner.y);
    }

    return { minX, maxX, minY, maxY };
  }
}
