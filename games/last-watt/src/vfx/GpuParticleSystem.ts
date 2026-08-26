import * as THREE from 'three';
import {
  ATLAS_SIZE,
  TILES_PER_ROW,
  ParticleTile,
  buildParticleAtlas,
} from './atlas';
import { PARTICLE_FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './shaders';
import { skipBloomMask } from '../engine/postfx/bloomMask';
import type { RGBA } from './palette';

/**
 * GPU 点精灵粒子系统。
 *
 * 结构：每种混合模式一个 `THREE.Points`（= 一次 draw call），内部是环形缓冲池。
 * 发射 = 往环上写一段出生属性并标脏；回收 = 不需要，寿命到了顶点着色器自然裁掉。
 * 运行期零 `new`、零 GC、零逐粒子 CPU 更新。
 */

export type ParticleBlend = 'additive' | 'alpha';

export interface EmitParams {
  /** 发射粒子数（会被预算裁剪，返回值是实际发射数） */
  count: number;
  position: THREE.Vector3 | { x: number; y: number; z: number };
  /** 出生位置的立方体抖动半径 */
  positionJitter?: number;
  /** 主方向；不给则各向同性 */
  direction?: { x: number; y: number; z: number };
  /** 主方向的锥角（弧度），0 = 笔直，Math.PI = 全向 */
  coneAngle?: number;
  speed?: number;
  speedJitter?: number;
  /** 世界加速度，重力写 { x:0, y:-9.8, z:0 } */
  acceleration?: { x: number; y: number; z: number };
  /** 阻尼系数：0 = 真空，>3 = 迅速停住（雾、烟） */
  drag?: number;
  life: number;
  lifeJitter?: number;
  sizeStart: number;
  sizeEnd: number;
  sizeJitter?: number;
  colorStart: RGBA;
  colorEnd: RGBA;
  /**
   * 颜色/透明度插值曲线指数，默认 1（线性）。
   * >1 = 先稳住末尾快收（冰晶要实心）；<1 = 一出生就淡（雾气要柔）。
   */
  colorCurve?: number;
  /** 尺寸插值曲线指数，默认 1。>1 让「先胀后停」，<1 让「猛胀再缓」。 */
  sizeCurve?: number;
  tile: ParticleTile;
  /** 翻页帧数，火焰用 4 */
  frameCount?: number;
  /** 初始旋转随机化 */
  randomRotation?: boolean;
  /** 自旋角速度上限（rad/s），正负随机 */
  spin?: number;
  blend?: ParticleBlend;
}

const FLOATS = {
  time: 2,
  vel: 3,
  acc: 3,
  size: 2,
  rot: 2,
  tile: 2,
  colorA: 4,
  colorB: 4,
  drag: 1,
  curve: 2,
} as const;

/** 可复现随机源：自检与压测需要逐帧一致的结果。 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  /** [-1, 1) */
  signed(): number {
    return this.next() * 2 - 1;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

interface UpdateRangeCapable {
  addUpdateRange?(start: number, count: number): void;
  updateRange?: { offset: number; count: number };
  needsUpdate: boolean;
}

/** three r16x 把 `updateRange` 换成了 `addUpdateRange`；两边都兼容，避免锁死小版本。 */
function markRange(attr: THREE.BufferAttribute, start: number, count: number): void {
  const a = attr as unknown as UpdateRangeCapable;
  if (typeof a.addUpdateRange === 'function') {
    a.addUpdateRange(start, count);
  } else if (a.updateRange) {
    a.updateRange.offset = start;
    a.updateRange.count = count;
  }
  attr.needsUpdate = true;
}

function clearRanges(attr: THREE.BufferAttribute): void {
  const a = attr as unknown as { clearUpdateRanges?: () => void };
  a.clearUpdateRanges?.();
}

class ParticleLayer {
  readonly points: THREE.Points;
  readonly capacity: number;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly attrs: Record<string, THREE.BufferAttribute>;
  private head = 0;
  /** 环上每颗粒子的死亡时刻，用于统计存活数（不参与模拟） */
  private readonly deathTime: Float32Array;

  constructor(capacity: number, blend: ParticleBlend, atlas: THREE.Texture) {
    this.capacity = capacity;
    this.deathTime = new Float32Array(capacity);

    const geometry = new THREE.BufferGeometry();
    const attrs: Record<string, THREE.BufferAttribute> = {};

    const add = (name: string, itemSize: number) => {
      const attr = new THREE.BufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
      attrs[name] = attr;
    };

    add('position', 3);
    add('aTime', FLOATS.time);
    add('aVel', FLOATS.vel);
    add('aAcc', FLOATS.acc);
    add('aSize', FLOATS.size);
    add('aRot', FLOATS.rot);
    add('aTile', FLOATS.tile);
    add('aColorA', FLOATS.colorA);
    add('aColorB', FLOATS.colorB);
    add('aDrag', FLOATS.drag);
    add('aCurve', FLOATS.curve);

    // 位置在着色器里演进，包围盒无意义，直接关剔除
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uAtlas: { value: atlas },
        uTilesPerRow: { value: TILES_PER_ROW },
        uTileInset: { value: 0.5 / (ATLAS_SIZE / TILES_PER_ROW) },
        uPixelScale: { value: 600 },
        uSizeClampPx: { value: new THREE.Vector2(1, 256) },
        uCull: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.geometry = geometry;
    this.attrs = attrs;
    this.points = new THREE.Points(geometry, this.material);
    // The motion is an analytic solve in our vertex shader; a proxy material
    // would snap every particle back to its spawn point in the bloom buffer.
    // Which layer reaches bloom is decided by `uCull`, see `setMaskPass`.
    skipBloomMask(this.points);
    this.points.frustumCulled = false;
    // 粒子画在血条之下、地面之上（GDD 15.2 防糊规则 ②）
    this.points.renderOrder = 10;
    this.points.name = `lw-particles-${blend}`;
  }

  get uniforms() {
    return this.material.uniforms;
  }

  /** 当前存活粒子数——统计用，O(capacity) 但只在需要时调。 */
  countAlive(now: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.deathTime[i] > now) n++;
    }
    return n;
  }

  write(now: number, count: number, params: EmitParams, rng: Rng): number {
    const n = Math.min(count, this.capacity);
    if (n <= 0) return 0;

    const pos = this.attrs.position.array as Float32Array;
    const time = this.attrs.aTime.array as Float32Array;
    const vel = this.attrs.aVel.array as Float32Array;
    const acc = this.attrs.aAcc.array as Float32Array;
    const size = this.attrs.aSize.array as Float32Array;
    const rot = this.attrs.aRot.array as Float32Array;
    const tile = this.attrs.aTile.array as Float32Array;
    const colA = this.attrs.aColorA.array as Float32Array;
    const colB = this.attrs.aColorB.array as Float32Array;
    const drag = this.attrs.aDrag.array as Float32Array;
    const curve = this.attrs.aCurve.array as Float32Array;
    const colorCurve = params.colorCurve ?? 1;
    const sizeCurve = params.sizeCurve ?? 1;

    const jitter = params.positionJitter ?? 0;
    const speed = params.speed ?? 0;
    const speedJitter = params.speedJitter ?? 0;
    const cone = params.coneAngle ?? Math.PI;
    const dir = params.direction;
    const a = params.acceleration;
    const lifeJitter = params.lifeJitter ?? 0;
    const sizeJitter = params.sizeJitter ?? 0;
    const frames = params.frameCount ?? 1;
    const spin = params.spin ?? 0;

    // 锥形采样需要一组正交基
    let dx = 0;
    let dy = 1;
    let dz = 0;
    if (dir) {
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dx = dir.x / len;
      dy = dir.y / len;
      dz = dir.z / len;
    }
    // 与主方向不平行的参考轴
    const refX = Math.abs(dy) > 0.9 ? 1 : 0;
    const refY = Math.abs(dy) > 0.9 ? 0 : 1;
    let t1x = refY * dz - 0 * dy;
    let t1y = 0 * dx - refX * dz;
    let t1z = refX * dy - refY * dx;
    const t1len = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1len;
    t1y /= t1len;
    t1z /= t1len;
    const t2x = dy * t1z - dz * t1y;
    const t2y = dz * t1x - dx * t1z;
    const t2z = dx * t1y - dy * t1x;

    const start = this.head;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % this.capacity;

      pos[i * 3] = params.position.x + rng.signed() * jitter;
      pos[i * 3 + 1] = params.position.y + rng.signed() * jitter;
      pos[i * 3 + 2] = params.position.z + rng.signed() * jitter;

      const life = Math.max(params.life + rng.signed() * lifeJitter, 0.02);
      time[i * 2] = now;
      time[i * 2 + 1] = life;
      this.deathTime[i] = now + life;

      const sp = Math.max(speed + rng.signed() * speedJitter, 0);
      if (sp > 0) {
        let vx: number;
        let vy: number;
        let vz: number;
        if (dir && cone < Math.PI - 1e-3) {
          // 在锥内均匀采样（cosθ 均匀，避免向轴心堆积）
          const cosMin = Math.cos(cone);
          const cosT = rng.range(cosMin, 1);
          const sinT = Math.sqrt(Math.max(1 - cosT * cosT, 0));
          const phi = rng.next() * Math.PI * 2;
          const cp = Math.cos(phi) * sinT;
          const spn = Math.sin(phi) * sinT;
          vx = dx * cosT + t1x * cp + t2x * spn;
          vy = dy * cosT + t1y * cp + t2y * spn;
          vz = dz * cosT + t1z * cp + t2z * spn;
        } else {
          // 球面均匀
          const u = rng.signed();
          const phi = rng.next() * Math.PI * 2;
          const r = Math.sqrt(Math.max(1 - u * u, 0));
          vx = r * Math.cos(phi);
          vy = u;
          vz = r * Math.sin(phi);
        }
        vel[i * 3] = vx * sp;
        vel[i * 3 + 1] = vy * sp;
        vel[i * 3 + 2] = vz * sp;
      } else {
        vel[i * 3] = 0;
        vel[i * 3 + 1] = 0;
        vel[i * 3 + 2] = 0;
      }

      acc[i * 3] = a ? a.x : 0;
      acc[i * 3 + 1] = a ? a.y : 0;
      acc[i * 3 + 2] = a ? a.z : 0;

      const sj = 1 + rng.signed() * sizeJitter;
      size[i * 2] = params.sizeStart * sj;
      size[i * 2 + 1] = params.sizeEnd * sj;

      rot[i * 2] = params.randomRotation ? rng.next() * Math.PI * 2 : 0;
      rot[i * 2 + 1] = spin ? rng.signed() * spin : 0;

      tile[i * 2] = params.tile;
      tile[i * 2 + 1] = frames;

      colA[i * 4] = params.colorStart[0];
      colA[i * 4 + 1] = params.colorStart[1];
      colA[i * 4 + 2] = params.colorStart[2];
      colA[i * 4 + 3] = params.colorStart[3];
      colB[i * 4] = params.colorEnd[0];
      colB[i * 4 + 1] = params.colorEnd[1];
      colB[i * 4 + 2] = params.colorEnd[2];
      colB[i * 4 + 3] = params.colorEnd[3];

      drag[i] = params.drag ?? 0;
      curve[i * 2] = colorCurve;
      curve[i * 2 + 1] = sizeCurve;
    }

    this.head = (start + n) % this.capacity;
    this.markDirty(start, n);
    return n;
  }

  private markDirty(start: number, n: number): void {
    const wrap = start + n > this.capacity;
    const first = wrap ? this.capacity - start : n;
    for (const name of Object.keys(this.attrs)) {
      const attr = this.attrs[name];
      const size = attr.itemSize;
      markRange(attr, start * size, first * size);
      if (wrap) markRange(attr, 0, (n - first) * size);
    }
  }

  /** 上下文丢失重建等场景下强制全量重传。 */
  invalidate(): void {
    for (const name of Object.keys(this.attrs)) {
      const attr = this.attrs[name];
      clearRanges(attr);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export interface ParticleSystemOptions {
  /** 加法混合层容量（辉光：电、火、冰晶、火花） */
  additiveCapacity?: number;
  /** 常规混合层容量（雾、烟、土块） */
  alphaCapacity?: number;
  seed?: number;
}

export interface ParticleStats {
  alive: number;
  capacity: number;
  emittedThisFrame: number;
  droppedThisFrame: number;
  drawCalls: number;
}

export class GpuParticleSystem {
  readonly root = new THREE.Group();
  readonly atlasTexture: THREE.DataTexture;

  private readonly layers: Record<ParticleBlend, ParticleLayer>;
  private readonly rng: Rng;
  private clock = 0;
  private emitted = 0;
  private dropped = 0;
  /** 未结算的存活估计：批次到期后减掉，避免每帧扫全池 */
  private batches: { die: number; count: number }[] = [];
  private aliveEstimate = 0;

  constructor(options: ParticleSystemOptions = {}) {
    const atlasData = buildParticleAtlas();
    this.atlasTexture = new THREE.DataTexture(atlasData, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
    this.atlasTexture.needsUpdate = true;
    this.atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.generateMipmaps = true;
    this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.atlasTexture.colorSpace = THREE.NoColorSpace;
    this.atlasTexture.name = 'lw-particle-atlas';

    this.rng = new Rng(options.seed ?? 0x1a2b3c4d);
    this.layers = {
      additive: new ParticleLayer(options.additiveCapacity ?? 14000, 'additive', this.atlasTexture),
      alpha: new ParticleLayer(options.alphaCapacity ?? 6000, 'alpha', this.atlasTexture),
    };
    this.root.name = 'lw-vfx-particles';
    this.root.add(this.layers.additive.points, this.layers.alpha.points);
  }

  get time(): number {
    return this.clock;
  }

  get totalCapacity(): number {
    return this.layers.additive.capacity + this.layers.alpha.capacity;
  }

  /**
   * 相机参数变化时调用：点精灵尺寸靠 `drawingBufferHeight / (2·tan(fov/2))`
   * 换算世界尺寸→像素，窗口 resize 或缩放档位切换后必须刷新。
   */
  setViewport(drawingBufferHeight: number, verticalFovRad: number): void {
    const scale = drawingBufferHeight / (2 * Math.tan(verticalFovRad / 2));
    for (const layer of Object.values(this.layers)) {
      layer.uniforms.uPixelScale.value = scale;
    }
  }

  /** 上限跟着驱动能力走：SwiftShader / 集显对超大点精灵的填充率很敏感。 */
  setPointSizeClamp(minPx: number, maxPx: number): void {
    for (const layer of Object.values(this.layers)) {
      layer.uniforms.uSizeClampPx.value.set(minPx, maxPx);
    }
  }

  /**
   * 自发光遮罩 pass 开关（GDD 15.1「Bloom 只吃自发光」）。
   *
   * 开启时把常规混合层整层剔除——雾、尘土、冰晶碎片是被照亮的物体，不是光源，
   * 不该进 Bloom；加法混合层本身就是光，照常渲染。
   * 引擎不调用这个方法也能跑，只是雾会带上一点辉光。
   */
  setMaskPass(active: boolean): void {
    this.layers.alpha.uniforms.uCull.value = active ? 1 : 0;
  }

  /**
   * @param budget 本次允许发射的上限（由 VfxBudget 给出），不传则不限
   * @returns 实际发射数
   */
  emit(params: EmitParams, budget = Infinity): number {
    const want = Math.max(0, Math.floor(params.count));
    const allowed = Math.min(want, Math.floor(budget));
    if (allowed <= 0) {
      this.dropped += want;
      return 0;
    }
    const layer = this.layers[params.blend ?? 'additive'];
    const n = layer.write(this.clock, allowed, params, this.rng);
    this.emitted += n;
    this.dropped += want - n;
    this.aliveEstimate += n;
    this.batches.push({
      die: this.clock + params.life + (params.lifeJitter ?? 0),
      count: n,
    });
    return n;
  }

  /**
   * @param dt 已经过 timeScale 缩放的秒数。顿帧期间传 0，粒子随画面一起定住。
   */
  update(dt: number): void {
    this.clock += dt;
    const now = this.clock;

    let i = 0;
    while (i < this.batches.length && this.batches[i].die <= now) {
      this.aliveEstimate -= this.batches[i].count;
      i++;
    }
    if (i > 0) this.batches.splice(0, i);
    if (this.aliveEstimate < 0) this.aliveEstimate = 0;

    for (const layer of Object.values(this.layers)) {
      layer.uniforms.uTime.value = now;
    }
  }

  /** 每帧开头调用：清掉上一帧的发射统计。属性脏区由 three 上传后自行清理。 */
  beginFrame(): void {
    this.emitted = 0;
    this.dropped = 0;
  }

  get stats(): ParticleStats {
    return {
      alive: this.aliveEstimate,
      capacity: this.totalCapacity,
      emittedThisFrame: this.emitted,
      droppedThisFrame: this.dropped,
      drawCalls: 2,
    };
  }

  /** 精确存活数（扫池）。只在自检/压测里用，正常帧走 `stats.alive` 估计值。 */
  countAliveExact(): number {
    return (
      this.layers.additive.countAlive(this.clock) + this.layers.alpha.countAlive(this.clock)
    );
  }

  dispose(): void {
    for (const layer of Object.values(this.layers)) layer.dispose();
    this.atlasTexture.dispose();
  }
}
