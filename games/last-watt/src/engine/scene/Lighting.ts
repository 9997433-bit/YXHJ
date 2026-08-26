import { DirectionalLight, Group, HemisphereLight, Object3D, Vector3 } from 'three';

import { LIGHTING } from '../config';
import { GRID_DEPTH, GRID_WIDTH } from '../grid/coords';

/**
 * Fixed lighting rig — GDD §15.1: exactly one directional key light, no
 * day/night cycle. A very low hemisphere fill keeps unlit rust readable;
 * every other "light" in the game is emissive material plus bloom.
 */
export class Lighting {
  readonly root = new Group();
  readonly key: DirectionalLight;
  readonly fill: HemisphereLight;

  private readonly anchor: Object3D;

  constructor() {
    this.root.name = 'Lighting';

    const centre = new Vector3(GRID_WIDTH / 2, 0, GRID_DEPTH / 2);
    const direction = new Vector3(
      LIGHTING.keyDirection.x,
      LIGHTING.keyDirection.y,
      LIGHTING.keyDirection.z,
    ).normalize();

    this.key = new DirectionalLight(LIGHTING.keyColor, LIGHTING.keyIntensity);
    this.key.name = 'KeyLight';
    // Place the light back along its travel direction, far enough that the
    // orthographic shadow frustum can cover the whole board.
    this.key.position.copy(centre).addScaledVector(direction, -Math.max(GRID_WIDTH, GRID_DEPTH));

    this.anchor = new Object3D();
    this.anchor.position.copy(centre);
    this.key.target = this.anchor;

    this.key.castShadow = true;
    this.key.shadow.intensity = LIGHTING.shadowIntensity;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.02;

    const radius = Math.hypot(GRID_WIDTH, GRID_DEPTH) / 2 + 2;
    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = 0.5;
    shadowCamera.far = radius * 4;
    shadowCamera.updateProjectionMatrix();

    this.fill = new HemisphereLight(
      LIGHTING.fillSkyColor,
      LIGHTING.fillGroundColor,
      LIGHTING.fillIntensity,
    );
    this.fill.name = 'FillLight';

    this.root.add(this.key, this.anchor, this.fill);
  }

  dispose(): void {
    this.key.dispose();
    this.fill.dispose();
    this.root.clear();
  }
}
