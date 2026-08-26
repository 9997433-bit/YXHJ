/**
 * Enemy presentation: silhouette, health bar, and the frozen ice shell.
 *
 * The ice shell is the reason this file has a material-swap path at all. GDD
 * §15.2 asks for "enemy material switches to ice shell" as the readable tell
 * that a target is shatter-primed, and without it the 45-damage hammer swing
 * looks like any other swing.
 *
 * Health bars are camera-facing quads in the scene rather than DOM (GDD §14 /
 * ARCHITECTURE D6): they have to sit in the same depth order as the units.
 */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Camera,
} from 'three';

import type { Enemy } from '../../combat';
import { APP_PALETTE, DEFAULT_ENEMY_STYLE, ENEMY_STYLES, type EnemyStyle } from '../config';

const BAR_WIDTH = 0.62;
const BAR_HEIGHT = 0.075;

/**
 * Frozen shell. The emissive is kept low on purpose: at bloom-visible levels the
 * shell blows out into a white blob and the silhouette stops reading, which
 * costs more than the glow buys — and the shatter itself needs somewhere
 * brighter to go.
 */
const ICE_SHELL = new MeshStandardMaterial({
  color: new Color(APP_PALETTE.frost).multiplyScalar(0.62),
  emissive: new Color(APP_PALETTE.frost),
  emissiveIntensity: 0.42,
  roughness: 0.22,
  metalness: 0.1,
  flatShading: true,
  transparent: true,
  opacity: 0.9,
});

const HURT_TINT = new Color(APP_PALETTE.frost);

function bodyGeometry(style: EnemyStyle): BufferGeometry {
  const s = style.size;
  switch (style.shape) {
    case 'bug':
      return new IcosahedronGeometry(s, 0);
    case 'rat':
      return new SphereGeometry(s, 6, 4).scale(0.8, 0.6, 1.4);
    case 'hauler':
      return new BoxGeometry(s * 1.7, s * 1.3, s * 2.1);
    case 'bee':
      return new OctahedronGeometry(s, 0).scale(1, 0.7, 1.5);
    case 'crab':
      return new SphereGeometry(s, 6, 4).scale(1.4, 0.7, 1);
    case 'drone':
      return new ConeGeometry(s, s * 1.6, 6);
    case 'boss':
      return new BoxGeometry(s * 1.8, s * 1.6, s * 2.2);
  }
}

interface EnemyRig {
  root: Group;
  /** Carries the heading; the health bar stays outside so it can billboard. */
  pivot: Group;
  body: Mesh;
  bar: Mesh;
  barFill: Mesh;
  material: MeshStandardMaterial;
  style: EnemyStyle;
  frozen: boolean;
  /** Seconds left on the hit flash. */
  flash: number;
  bob: number;
}

export class EnemyView {
  readonly root = new Group();

  private readonly rigs = new Map<number, EnemyRig>();
  private readonly barBackground = new MeshBasicMaterial({
    color: 0x120c09,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
  });

  constructor() {
    this.root.name = 'lw-enemies';
  }

  add(enemy: Enemy): void {
    if (this.rigs.has(enemy.id)) return;
    const style = ENEMY_STYLES[enemy.defId] ?? DEFAULT_ENEMY_STYLE;

    const material = new MeshStandardMaterial({
      color: style.color,
      emissive: new Color(style.emissive),
      emissiveIntensity: 0.5,
      roughness: 0.8,
      metalness: 0.15,
      flatShading: true,
    });
    const body = new Mesh(bodyGeometry(style), material);
    body.castShadow = true;
    body.position.y = style.size + style.hover;

    const barY = style.size * 2 + style.hover + 0.22;
    const bar = new Mesh(new PlaneGeometry(BAR_WIDTH, BAR_HEIGHT), this.barBackground);
    bar.position.y = barY;
    bar.renderOrder = 20;

    const barFill = new Mesh(
      new PlaneGeometry(BAR_WIDTH - 0.03, BAR_HEIGHT - 0.025),
      new MeshBasicMaterial({ color: APP_PALETTE.ember, depthTest: false }),
    );
    // Anchored at the left edge so shrinking the scale drains it rightwards.
    barFill.geometry.translate((BAR_WIDTH - 0.03) / 2, 0, 0);
    barFill.position.set(-(BAR_WIDTH - 0.03) / 2, barY, 0.001);
    barFill.renderOrder = 21;

    const pivot = new Group();
    pivot.add(body);
    const root = new Group();
    root.add(pivot, bar, barFill);
    this.rigs.set(enemy.id, {
      root,
      pivot,
      body,
      bar,
      barFill,
      material,
      style,
      frozen: false,
      flash: 0,
      bob: Math.random() * Math.PI * 2,
    });
    this.root.add(root);
  }

  remove(enemyId: number): void {
    const rig = this.rigs.get(enemyId);
    if (!rig) return;
    rig.body.geometry.dispose();
    rig.material.dispose();
    rig.bar.geometry.dispose();
    rig.barFill.geometry.dispose();
    (rig.barFill.material as MeshBasicMaterial).dispose();
    this.root.remove(rig.root);
    this.rigs.delete(enemyId);
  }

  /** Called from `enemy_damaged`; drives the one-frame hit flash. */
  hit(enemyId: number): void {
    const rig = this.rigs.get(enemyId);
    if (rig) rig.flash = 0.12;
  }

  update(dt: number, enemies: readonly Enemy[], camera: Camera): void {
    const seen = new Set<number>();

    for (const enemy of enemies) {
      seen.add(enemy.id);
      let rig = this.rigs.get(enemy.id);
      if (!rig) {
        this.add(enemy);
        rig = this.rigs.get(enemy.id) as EnemyRig;
      }

      rig.bob += dt;
      const hover = rig.style.hover > 0 ? Math.sin(rig.bob * 3) * 0.08 : 0;
      rig.root.position.set(enemy.position.x, hover, enemy.position.y);
      rig.pivot.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.y);

      const frozen = enemy.statuses.has('frozen');
      if (frozen !== rig.frozen) {
        rig.frozen = frozen;
        rig.body.material = frozen ? ICE_SHELL : rig.material;
        rig.body.scale.setScalar(frozen ? 1.18 : 1);
      }

      if (rig.flash > 0) {
        rig.flash = Math.max(0, rig.flash - dt);
        rig.material.emissiveIntensity = 0.5 + (rig.flash / 0.12) * 3.5;
        rig.material.emissive.copy(HURT_TINT);
      } else if (rig.material.emissiveIntensity !== 0.5) {
        rig.material.emissiveIntensity = 0.5;
        rig.material.emissive.setHex(rig.style.emissive);
      }

      const fraction = Math.max(0, Math.min(1, enemy.hpFraction));
      rig.barFill.scale.x = fraction;
      (rig.barFill.material as MeshBasicMaterial).color.setHex(
        fraction > 0.5 ? APP_PALETTE.coin : APP_PALETTE.alarm,
      );
      // The camera is locked, so one quaternion copy per frame is cheaper than
      // any billboard shader and is exact.
      rig.bar.quaternion.copy(camera.quaternion);
      rig.barFill.quaternion.copy(camera.quaternion);
      const visible = fraction < 1;
      rig.bar.visible = visible;
      rig.barFill.visible = visible;
    }

    for (const id of [...this.rigs.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  dispose(): void {
    for (const id of [...this.rigs.keys()]) this.remove(id);
    this.barBackground.dispose();
    this.root.clear();
  }
}
