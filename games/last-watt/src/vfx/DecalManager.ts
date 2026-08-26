import * as THREE from 'three';
import {
  DECAL_ATLAS_SIZE,
  DECAL_TILES_PER_ROW,
  DecalTile,
  buildDecalAtlas,
} from './atlas';
import { VFX_BUDGET } from './budget';
import { skipBloomMask } from '../engine/postfx/bloomMask';
import type { RGBA } from './palette';

/**
 * 贴花管理（GDD 15.3：上限 64 张，共用 atlas，超出淘汰最旧）。
 *
 * 一个 InstancedMesh + 一张图集 = 一次 draw call。槽位是固定的环形数组，
 * 满了就覆盖最旧的一张——不做优先级，因为贴花是「痕迹」，最新的永远最相关。
 */

export interface DecalRequest {
  position: { x: number; y: number; z: number };
  tile: DecalTile;
  /** 世界尺寸（边长） */
  size: number;
  /** 绕地面法线的旋转 */
  rotation?: number;
  color: RGBA;
  /** 秒；Infinity 表示常驻直到被淘汰（油渍由玩法层显式移除） */
  life: number;
  /** 淡出时长（秒） */
  fadeOut?: number;
}

export class DecalManager {
  readonly mesh: THREE.InstancedMesh;
  readonly atlasTexture: THREE.DataTexture;

  private readonly capacity: number;
  private readonly material: THREE.ShaderMaterial;
  private readonly aTile: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aTiming: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scaleVec = new THREE.Vector3();
  private readonly posVec = new THREE.Vector3();
  private readonly slotOwner: (number | null)[];
  private head = 0;
  private clock = 0;
  private nextId = 1;
  private activeCap: number;

  constructor(capacity: number = VFX_BUDGET.maxDecals) {
    this.capacity = capacity;
    this.activeCap = capacity;
    this.slotOwner = new Array(capacity).fill(null);

    const data = buildDecalAtlas();
    this.atlasTexture = new THREE.DataTexture(
      data,
      DECAL_ATLAS_SIZE,
      DECAL_ATLAS_SIZE,
      THREE.RGBAFormat,
    );
    this.atlasTexture.needsUpdate = true;
    this.atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.generateMipmaps = true;
    this.atlasTexture.colorSpace = THREE.NoColorSpace;
    this.atlasTexture.name = 'lw-decal-atlas';

    const geometry = new THREE.PlaneGeometry(1, 1);
    // 地面贴花：平面默认朝 +Z，转到朝 +Y
    geometry.rotateX(-Math.PI / 2);

    this.aTile = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    // x: 出生时刻, y: 寿命, z: 淡出时长
    this.aTiming = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (let i = 0; i < capacity; i++) this.aTiming.array[i * 3 + 1] = -1;

    geometry.setAttribute('aTile', this.aTile);
    geometry.setAttribute('aColor', this.aColor);
    geometry.setAttribute('aTiming', this.aTiming);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uTilesPerRow: { value: DECAL_TILES_PER_ROW },
        uTime: { value: 0 },
        uCull: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aTile;
        attribute vec4 aColor;
        attribute vec3 aTiming;
        uniform float uTime;
        uniform float uTilesPerRow;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          float life = aTiming.y;
          float age = uTime - aTiming.x;
          float fade = 1.0;
          if (life < 0.0 || age < 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vUv = vec2(0.0);
            vColor = vec4(0.0);
            return;
          }
          if (life > 0.0) {
            float fadeOut = max(aTiming.z, 1e-3);
            fade = clamp((life - age) / fadeOut, 0.0, 1.0);
            if (age >= life) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              vUv = vec2(0.0);
              vColor = vec4(0.0);
              return;
            }
          }
          vec2 cell = vec2(mod(aTile, uTilesPerRow), floor(aTile / uTilesPerRow));
          vUv = (cell + uv) / uTilesPerRow;
          vColor = vec4(aColor.rgb, aColor.a * fade);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uCull;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          if (uCull > 0.5) discard;
          vec4 texel = texture2D(uAtlas, vUv);
          float a = texel.a * vColor.a;
          if (a <= 0.004) discard;
          gl_FragColor = vec4(vColor.rgb * texel.rgb * 2.0, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      // 贴花贴地，用 polygonOffset 压掉 z-fighting
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    // Per-instance timing and atlas lookup live in this shader; a mask-pass
    // proxy material would draw 64 opaque squares instead. `uCull` culls the
    // whole layer during the mask pass, see `setMaskPass`.
    skipBloomMask(this.mesh);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'lw-vfx-decals';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 初始全部推到看不见的地方
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 降级时收紧上限；已存在的贴花不回收，靠环形覆盖自然收敛。 */
  setCap(cap: number): void {
    this.activeCap = Math.max(1, Math.min(cap, this.capacity));
  }

  /** 贴花是地面痕迹不是光源，自发光遮罩 pass 里整层剔除。 */
  setMaskPass(active: boolean): void {
    this.material.uniforms.uCull.value = active ? 1 : 0;
  }

  get count(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const born = this.aTiming.array[i * 3];
      const life = this.aTiming.array[i * 3 + 1];
      if (life < 0) continue;
      if (life === 0 || this.clock - born < life) n++;
    }
    return n;
  }

  /** @returns 贴花 id，用于提前移除（油渍被泄洪道冲走时要用） */
  add(req: DecalRequest): number {
    const slot = this.head % this.activeCap;
    this.head = (this.head + 1) % this.activeCap;

    this.posVec.set(req.position.x, req.position.y, req.position.z);
    this.euler.set(0, req.rotation ?? 0, 0);
    this.quat.setFromEuler(this.euler);
    this.scaleVec.set(req.size, 1, req.size);
    this.matrix.compose(this.posVec, this.quat, this.scaleVec);
    this.mesh.setMatrixAt(slot, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    this.aTile.array[slot] = req.tile;
    this.aTile.needsUpdate = true;

    this.aColor.array[slot * 4] = req.color[0];
    this.aColor.array[slot * 4 + 1] = req.color[1];
    this.aColor.array[slot * 4 + 2] = req.color[2];
    this.aColor.array[slot * 4 + 3] = req.color[3];
    this.aColor.needsUpdate = true;

    this.aTiming.array[slot * 3] = this.clock;
    this.aTiming.array[slot * 3 + 1] = Number.isFinite(req.life) ? req.life : 0;
    this.aTiming.array[slot * 3 + 2] = req.fadeOut ?? 0.5;
    this.aTiming.needsUpdate = true;

    const id = this.nextId++;
    this.slotOwner[slot] = id;
    return id;
  }

  remove(id: number): boolean {
    for (let i = 0; i < this.capacity; i++) {
      if (this.slotOwner[i] !== id) continue;
      this.aTiming.array[i * 3 + 1] = -1;
      this.aTiming.needsUpdate = true;
      this.slotOwner[i] = null;
      return true;
    }
    return false;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.aTiming.array[i * 3 + 1] = -1;
      this.slotOwner[i] = null;
    }
    this.aTiming.needsUpdate = true;
    this.head = 0;
  }

  update(dt: number): void {
    this.clock += dt;
    this.material.uniforms.uTime.value = this.clock;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.atlasTexture.dispose();
  }
}
