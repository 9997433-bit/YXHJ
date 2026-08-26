/**
 * Tower presentation.
 *
 * Greybox, but not featureless: every silhouette is built from two or three
 * primitives with a distinct proportion, because "which tower is that" has to
 * be answerable from the locked oblique camera at a glance (GDD §15.1). Each
 * one carries exactly one emissive accent so the bloom pass has something to
 * bite on and the rusted body stays matte.
 *
 * Turret yaw follows `Tower.facing`, which is what makes a condenser visibly
 * point its cone at the thing it is freezing.
 */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';

import type { Tower } from '../../combat';
import { APP_PALETTE } from '../config';

const BODY = new MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.85, metalness: 0.25, flatShading: true });
const DARK = new MeshStandardMaterial({ color: 0x3b332c, roughness: 0.9, metalness: 0.3, flatShading: true });

/**
 * Accent materials are cloned per tower rather than shared: dimming one
 * unpowered tower must not black out every other tower of the same type.
 */
function accent(hex: number, intensity = 2.2): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: new Color(hex).multiplyScalar(0.35),
    emissive: new Color(hex),
    emissiveIntensity: intensity,
    roughness: 0.4,
    flatShading: true,
  });
  material.userData.baseIntensity = intensity;
  return material;
}

const ACCENTS = {
  rivet: accent(APP_PALETTE.coin, 1.8),
  tar: accent(APP_PALETTE.tar, 1.4),
  frost: accent(APP_PALETTE.frost, 2.4),
  ember: accent(APP_PALETTE.ember, 2.0),
  electric: accent(APP_PALETTE.electric, 2.2),
};

interface TowerRig {
  root: Group;
  /** Rotates to face the current target. */
  turret: Object3D;
  /** Optional recoil/piston part, driven by `punch`. */
  piston?: Object3D;
  /** Optional always-spinning part (generator flywheel). */
  spinner?: Object3D;
  /** Seconds left on the fire animation. */
  punch: number;
  /** +1 thrusts the moving part forward (ram), -1 pulls it back (recoil). */
  punchDir: number;
  accent: Mesh;
}

function plinth(): Mesh {
  const mesh = new Mesh(new CylinderGeometry(0.36, 0.42, 0.16, 8), DARK);
  mesh.position.y = 0.08;
  return mesh;
}

/** Builds the silhouette for one tower id; unknown ids get a neutral block. */
function buildRig(defId: string): TowerRig {
  const root = new Group();
  const turret = new Group();
  root.add(plinth(), turret);
  turret.position.y = 0.16;

  let accentMesh: Mesh;
  let piston: Object3D | undefined;
  let spinner: Object3D | undefined;
  let punchDir = 1;

  switch (defId) {
    case 'rivet_mg': {
      const body = new Mesh(new BoxGeometry(0.34, 0.26, 0.34), BODY);
      body.position.y = 0.13;
      const barrel = new Mesh(new BoxGeometry(0.1, 0.1, 0.52), DARK);
      barrel.position.set(0, 0.17, 0.3);
      accentMesh = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), ACCENTS.rivet.clone());
      accentMesh.position.set(0, 0.3, 0);
      const recoil = new Group();
      recoil.add(barrel);
      turret.add(body, recoil, accentMesh);
      piston = recoil;
      punchDir = -1;
      break;
    }
    case 'tar_sprayer': {
      const tank = new Mesh(new CylinderGeometry(0.26, 0.3, 0.44, 8), BODY);
      tank.position.y = 0.22;
      const nozzle = new Mesh(new ConeGeometry(0.13, 0.3, 6), DARK);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(0, 0.32, 0.28);
      accentMesh = new Mesh(new TorusGeometry(0.2, 0.035, 6, 16), ACCENTS.tar.clone());
      accentMesh.rotation.x = Math.PI / 2;
      accentMesh.position.y = 0.46;
      turret.add(tank, nozzle, accentMesh);
      break;
    }
    case 'condenser': {
      const column = new Mesh(new CylinderGeometry(0.2, 0.26, 0.5, 6), BODY);
      column.position.y = 0.25;
      const head = new Mesh(new OctahedronGeometry(0.2), DARK);
      head.position.y = 0.58;
      const muzzle = new Mesh(new ConeGeometry(0.18, 0.34, 6, 1, true), ACCENTS.frost.clone());
      muzzle.rotation.x = -Math.PI / 2;
      muzzle.position.set(0, 0.52, 0.3);
      accentMesh = muzzle;
      turret.add(column, head, muzzle);
      break;
    }
    case 'hydraulic_hammer': {
      const frame = new Mesh(new BoxGeometry(0.44, 0.5, 0.32), BODY);
      frame.position.y = 0.25;
      const arm = new Mesh(new BoxGeometry(0.22, 0.16, 0.5), DARK);
      arm.position.set(0, 0.5, 0.22);
      const head = new Mesh(new BoxGeometry(0.3, 0.3, 0.24), DARK);
      head.position.set(0, 0.5, 0.5);
      accentMesh = new Mesh(new BoxGeometry(0.1, 0.32, 0.1), ACCENTS.ember.clone());
      accentMesh.position.set(0, 0.32, -0.14);
      const piston3d = new Group();
      piston3d.add(arm, head);
      turret.add(frame, piston3d, accentMesh);
      piston = piston3d;
      break;
    }
    case 'generator': {
      const shed = new Mesh(new BoxGeometry(0.6, 0.34, 0.5), BODY);
      shed.position.y = 0.17;
      const wheel = new Mesh(new TorusGeometry(0.18, 0.05, 6, 14), DARK);
      wheel.position.set(0.32, 0.26, 0);
      wheel.rotation.y = Math.PI / 2;
      accentMesh = new Mesh(new BoxGeometry(0.44, 0.06, 0.06), ACCENTS.electric.clone());
      accentMesh.position.set(0, 0.36, 0.18);
      turret.add(shed, wheel, accentMesh);
      spinner = wheel;
      break;
    }
    default: {
      const body = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), BODY);
      body.position.y = 0.2;
      accentMesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), ACCENTS.electric.clone());
      accentMesh.position.y = 0.46;
      turret.add(body, accentMesh);
    }
  }

  for (const child of root.children) child.traverse((node) => (node.castShadow = true));
  return { root, turret, piston, spinner, punch: 0, punchDir, accent: accentMesh };
}

export class TowerView {
  readonly root = new Group();

  private readonly rigs = new Map<number, TowerRig>();
  private spin = 0;

  constructor() {
    this.root.name = 'lw-towers';
  }

  add(towerId: number, defId: string, cx: number, cy: number, surfaceY: number): void {
    if (this.rigs.has(towerId)) return;
    const rig = buildRig(defId);
    rig.root.position.set(cx + 0.5, surfaceY, cy + 0.5);
    this.rigs.set(towerId, rig);
    this.root.add(rig.root);
  }

  remove(towerId: number): void {
    const rig = this.rigs.get(towerId);
    if (!rig) return;
    this.root.remove(rig.root);
    this.rigs.delete(towerId);
  }

  /** Kicks the fire animation; called from the `tower_fired` event. */
  fired(towerId: number): void {
    const rig = this.rigs.get(towerId);
    if (rig) rig.punch = 1;
  }

  /** Dims the accent of a tower that is off (unpowered / overheated / disabled). */
  setOnline(towerId: number, online: boolean): void {
    const rig = this.rigs.get(towerId);
    if (!rig) return;
    const material = rig.accent.material as MeshStandardMaterial;
    material.emissiveIntensity = online ? material.userData.baseIntensity ?? 2 : 0.05;
  }

  update(dt: number, towers: readonly Tower[]): void {
    this.spin += dt;
    for (const tower of towers) {
      const rig = this.rigs.get(tower.id);
      if (!rig) continue;

      // Facing is a 2D grid vector; screen Z is grid Y.
      const yaw = Math.atan2(tower.facing.x, tower.facing.y);
      rig.turret.rotation.y = yaw;

      if (rig.spinner) rig.spinner.rotation.x = this.spin * 4;

      if (rig.punch > 0) {
        rig.punch = Math.max(0, rig.punch - dt * 6);
        // Ease-out thrust: snaps forward, drifts back. A linear return reads as
        // a machine sliding rather than a hydraulic ram releasing.
        const thrust = rig.punch * rig.punch * 0.22;
        if (rig.piston) rig.piston.position.z = thrust * rig.punchDir;
      } else if (rig.piston) {
        rig.piston.position.z = 0;
      }
    }
  }

  dispose(): void {
    this.rigs.clear();
    this.root.clear();
  }
}
