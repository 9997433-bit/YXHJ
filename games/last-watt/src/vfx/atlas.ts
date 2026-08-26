/**
 * 程序化粒子图集（GDD 18.2：粒子图集 1 张 1024，且「一张帧动画贴图都不画」）。
 *
 * 图集在运行时用 SDF 光栅化生成，不依赖 canvas、不落二进制资产：
 * - 浏览器和 node（自检 / 压测）走同一条代码路径，结果逐字节一致；
 * - 美术后期要换成手绘图集时，只需替换 `buildParticleAtlas` 的产出，tile 枚举与 UV 约定不变。
 *
 * 布局：1024×1024，8×8 格，每格 128px。所有形状留 4px 边距防 mipmap 渗色。
 */

export const ATLAS_SIZE = 1024;
export const TILES_PER_ROW = 8;
export const TILE_PX = ATLAS_SIZE / TILES_PER_ROW;

/**
 * tile 序号即 shader 里的 `aTile.x`。火焰翻页要求 4 帧连号（16..19），
 * 新增 tile 一律追加到末尾，不要插队。
 */
export enum ParticleTile {
  /** 软圆：雾、烟、辉光底 */
  Soft = 0,
  /** 硬点：金币、亮芯 */
  Dot = 1,
  /** 尖刺火花：电系命中 */
  Spike = 2,
  /** 十字辉光：闪光核心 */
  Flare = 3,
  /** 硬边冰晶 A/B/C：碎裂主体 */
  IceShardA = 4,
  IceShardB = 5,
  IceShardC = 6,
  /** 六角霜花：冻结附着 */
  Frost = 7,
  /** 细圆环：扩散电磁环 */
  Ring = 8,
  /** 粗冲击环：锤击 / 自爆 */
  ShockRing = 9,
  /** 烟团 */
  Smoke = 10,
  /** 土块：挖沟 / 碎石 */
  Clod = 11,
  /** 金属螺栓碎片 */
  Bolt = 12,
  /** 蒸汽绺：过热停机 */
  Steam = 13,
  /** 拉伸曳光：机枪弹道 */
  Tracer = 14,
  /** 火舌翻页 4 帧（必须连号） */
  Flame0 = 16,
  Flame1 = 17,
  Flame2 = 18,
  Flame3 = 19,
}

export const FLAME_FRAME_COUNT = 4;

// ---------------------------------------------------------------------------
// 光栅化工具：一律用 SDF，边缘抗锯齿免费拿到，且与分辨率无关。
// ---------------------------------------------------------------------------

/** 稳定哈希，保证 node / 浏览器 / 多次运行结果一致。 */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, y * freq) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function sdCircle(x: number, y: number, r: number): number {
  return Math.hypot(x, y) - r;
}

function sdBox(x: number, y: number, hw: number, hh: number): number {
  const dx = Math.abs(x) - hw;
  const dy = Math.abs(y) - hh;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0);
}

/** 凸多边形 SDF：取所有半平面的最大值。顶点必须逆时针。 */
function sdConvexPolygon(x: number, y: number, pts: readonly (readonly [number, number])[]): number {
  let d = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    // 左法线（逆时针多边形指向外侧）
    const nx = ey / len;
    const ny = -ex / len;
    d = Math.max(d, (x - ax) * nx + (y - ay) * ny);
  }
  return d;
}

function rotate(pts: readonly (readonly [number, number])[], rad: number) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c] as const);
}

/** SDF → 覆盖率，px 为一个像素在 [-1,1] 归一空间中的宽度。 */
function coverage(d: number, px: number): number {
  return Math.min(Math.max(0.5 - d / px, 0), 1);
}

// ---------------------------------------------------------------------------
// 各 tile 的绘制函数：返回 [亮度, alpha]，亮度用来做「芯亮边暗」的自发光层次。
// ---------------------------------------------------------------------------

type TilePainter = (x: number, y: number, px: number) => readonly [number, number];

const ICE_A: readonly (readonly [number, number])[] = [
  [-0.62, -0.44],
  [0.18, -0.72],
  [0.66, 0.1],
  [0.02, 0.74],
  [-0.44, 0.3],
];
const ICE_B: readonly (readonly [number, number])[] = [
  [-0.5, -0.62],
  [0.58, -0.28],
  [0.3, 0.66],
  [-0.36, 0.42],
];
const ICE_C: readonly (readonly [number, number])[] = [
  [-0.24, -0.78],
  [0.52, -0.1],
  [0.06, 0.8],
  [-0.58, 0.06],
];

function iceShard(pts: readonly (readonly [number, number])[], spin: number): TilePainter {
  const poly = rotate(pts, spin);
  return (x, y, px) => {
    const d = sdConvexPolygon(x, y, poly);
    const a = coverage(d, px);
    if (a <= 0) return [0, 0];
    // 刻面：沿一条斜轴做硬阶梯，读起来像多面体而不是贴纸
    const facet = x * 0.7 + y * 0.7;
    const step = facet > 0.08 ? 1 : facet > -0.2 ? 0.72 : 0.5;
    // 边缘高光
    const rim = 1 - Math.min(Math.max(-d / 0.16, 0), 1);
    return [step * 0.85 + rim * 0.5, a];
  };
}

const PAINTERS: Partial<Record<ParticleTile, TilePainter>> = {
  [ParticleTile.Soft]: (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.pow(Math.max(1 - r, 0), 2.4);
    return [a, a];
  },
  [ParticleTile.Dot]: (x, y, px) => {
    const a = coverage(sdCircle(x, y, 0.72), px);
    const core = Math.pow(Math.max(1 - Math.hypot(x, y) / 0.72, 0), 0.6);
    return [0.55 + core * 0.75, a];
  },
  [ParticleTile.Spike]: (x, y) => {
    // 四角尖刺：沿轴衰减慢、离轴衰减快
    const r = Math.hypot(x, y) + 1e-4;
    const axis = Math.max(Math.abs(x), Math.abs(y));
    const cross = Math.min(Math.abs(x), Math.abs(y));
    const spike = Math.pow(Math.max(1 - axis, 0), 1.6) * Math.pow(Math.max(1 - cross * 6, 0), 1.2);
    const core = Math.pow(Math.max(1 - r * 3.4, 0), 1.5);
    const a = Math.min(spike + core, 1);
    return [a * 1.35, a];
  },
  [ParticleTile.Flare]: (x, y) => {
    const r = Math.hypot(x, y);
    const glow = Math.pow(Math.max(1 - r, 0), 3);
    const bar = Math.pow(Math.max(1 - Math.abs(y) * 7, 0), 2) * Math.max(1 - Math.abs(x), 0);
    const bar2 = Math.pow(Math.max(1 - Math.abs(x) * 7, 0), 2) * Math.max(1 - Math.abs(y), 0);
    const a = Math.min(glow + (bar + bar2) * 0.7, 1);
    return [a * 1.5, a];
  },
  [ParticleTile.IceShardA]: iceShard(ICE_A, 0),
  [ParticleTile.IceShardB]: iceShard(ICE_B, 0.9),
  [ParticleTile.IceShardC]: iceShard(ICE_C, -1.4),
  [ParticleTile.Frost]: (x, y, px) => {
    // 六角霜花：三根交叉枝
    let d = Infinity;
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI) / 3;
      const c = Math.cos(-ang);
      const s = Math.sin(-ang);
      d = Math.min(d, sdBox(x * c - y * s, x * s + y * c, 0.68, 0.055));
    }
    d = Math.min(d, sdCircle(x, y, 0.14));
    const a = coverage(d, px);
    return [a * 1.2, a];
  },
  [ParticleTile.Ring]: (x, y, px) => {
    const d = Math.abs(sdCircle(x, y, 0.72)) - 0.035;
    const a = coverage(d, px);
    const soft = Math.pow(Math.max(1 - Math.abs(Math.hypot(x, y) - 0.72) / 0.24, 0), 2) * 0.35;
    return [Math.min(a * 1.4 + soft, 1.6), Math.min(a + soft, 1)];
  },
  [ParticleTile.ShockRing]: (x, y, px) => {
    const r = Math.hypot(x, y);
    const d = Math.abs(sdCircle(x, y, 0.66)) - 0.14;
    const a = coverage(d, px);
    // 内侧拖尾，让环有速度感
    const trail = Math.pow(Math.max(1 - Math.abs(r - 0.5) / 0.5, 0), 3) * 0.4;
    return [a * 1.1 + trail, Math.min(a + trail * 0.8, 1)];
  },
  [ParticleTile.Smoke]: (x, y) => {
    const r = Math.hypot(x, y);
    const n = fbm(x * 2.6 + 11.3, y * 2.6 - 4.7, 3);
    const a = Math.pow(Math.max(1 - r, 0), 1.8) * (0.55 + n * 0.9);
    return [a * 0.5, Math.min(a, 1)];
  },
  [ParticleTile.Clod]: (x, y, px) => {
    const ang = Math.atan2(y, x);
    const wobble = 0.62 + 0.18 * smoothNoise(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5);
    const a = coverage(sdCircle(x, y, wobble), px);
    const shade = 0.35 + 0.5 * Math.max(0, -y * 0.5 + 0.5);
    return [shade, a];
  },
  [ParticleTile.Bolt]: (x, y, px) => {
    const d = Math.min(sdBox(x, y, 0.26, 0.62), sdBox(x, y, 0.5, 0.2));
    const a = coverage(d, px);
    const shade = 0.4 + 0.6 * Math.max(0, 0.5 - x * 0.6);
    return [shade, a];
  },
  [ParticleTile.Steam]: (x, y) => {
    const n = fbm(x * 1.9 - 8.1, y * 1.9 + 2.4, 2);
    const r = Math.hypot(x * 1.35, y * 0.85);
    const a = Math.pow(Math.max(1 - r, 0), 2.2) * (0.5 + n * 1.0);
    return [a * 0.85, Math.min(a, 1)];
  },
  [ParticleTile.Tracer]: (x, y, px) => {
    const d = sdBox(x, y, 0.86, 0.045);
    const a = coverage(d, px) * Math.pow(Math.max(1 - Math.abs(x) / 0.9, 0), 0.7);
    const core = Math.pow(Math.max(1 - Math.abs(y) * 26, 0), 2);
    return [Math.min(a + core, 1) * 1.6, Math.min(a + core * 0.6, 1)];
  },
};

/** 火焰翻页：4 帧共用一个参数化火舌，帧间推进噪声相位与高度。 */
for (let f = 0; f < FLAME_FRAME_COUNT; f++) {
  const phase = f / FLAME_FRAME_COUNT;
  PAINTERS[(ParticleTile.Flame0 + f) as ParticleTile] = (x, y) => {
    // y 向上为火舌方向；越往上越窄越乱
    const up = (y + 1) * 0.5; // 0 底 1 顶
    const taper = Math.pow(Math.max(1 - up, 0), 0.55);
    const sway = (smoothNoise(up * 3.1 + phase * 7.3, phase * 5.1) - 0.5) * 0.5 * up;
    const width = 0.62 * taper;
    const dx = Math.abs(x - sway);
    let a = Math.pow(Math.max(1 - dx / Math.max(width, 1e-3), 0), 1.5);
    a *= Math.pow(Math.max(1 - Math.abs(up - 0.32) / 0.9, 0), 1.1);
    const n = fbm(x * 3 + phase * 9.7, y * 3 - phase * 6.2, 3);
    a *= 0.55 + n * 0.95;
    // 底部亮芯
    const core = Math.pow(Math.max(1 - Math.hypot(x * 2.2, (y + 0.42) * 1.5), 0), 2);
    return [Math.min(a * 0.9 + core * 1.6, 2), Math.min(a + core, 1)];
  };
}

/**
 * 生成 RGBA8 图集。R/G/B 存「亮度 × 白」，A 存覆盖率；
 * 着色由 shader 里的 colorA/colorB 决定，所以图集本身是无彩的——
 * 这也是所有粒子能共用一张图、一个 material、一次 draw call 的原因。
 */
export function buildParticleAtlas(): Uint8Array {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const margin = 4;
  const inner = TILE_PX - margin * 2;
  const px = 2 / inner;

  for (const key of Object.keys(PAINTERS)) {
    const tile = Number(key) as ParticleTile;
    const painter = PAINTERS[tile];
    if (!painter) continue;
    const tx = (tile % TILES_PER_ROW) * TILE_PX;
    const ty = Math.floor(tile / TILES_PER_ROW) * TILE_PX;

    for (let j = 0; j < inner; j++) {
      const y = ((j + 0.5) / inner) * 2 - 1;
      for (let i = 0; i < inner; i++) {
        const x = ((i + 0.5) / inner) * 2 - 1;
        const [lum, alpha] = painter(x, y, px);
        if (alpha <= 0) continue;
        const gx = tx + margin + i;
        // 纹理原点在左下，painter 的 +y 朝上
        const gy = ty + margin + (inner - 1 - j);
        const o = (gy * ATLAS_SIZE + gx) * 4;
        const v = Math.min(Math.max(lum, 0), 2) * 127.5;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = Math.min(Math.max(alpha, 0), 1) * 255;
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// 贴花图集（GDD 18.2：512，油渍/霜痕/焦痕/电纹）
// ---------------------------------------------------------------------------

export const DECAL_ATLAS_SIZE = 512;
export const DECAL_TILES_PER_ROW = 2;

export enum DecalTile {
  Oil = 0,
  Frost = 1,
  Scorch = 2,
  ElectricCrack = 3,
}

export function buildDecalAtlas(): Uint8Array {
  const size = DECAL_ATLAS_SIZE;
  const tile = size / DECAL_TILES_PER_ROW;
  const data = new Uint8Array(size * size * 4);

  const painters: Record<DecalTile, (x: number, y: number) => readonly [number, number]> = {
    [DecalTile.Oil]: (x, y) => {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y);
      const edge = 0.72 + 0.2 * smoothNoise(Math.cos(ang) * 2.3 + 3, Math.sin(ang) * 2.3 + 3);
      const a = Math.min(Math.max((edge - r) / 0.12, 0), 1);
      const sheen = fbm(x * 3.4 + 21, y * 3.4 - 9, 3);
      return [0.25 + sheen * 0.5, a * 0.92];
    },
    [DecalTile.Frost]: (x, y) => {
      const r = Math.hypot(x, y);
      let branch = 0;
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const c = Math.cos(-ang);
        const s = Math.sin(-ang);
        const bx = x * c - y * s;
        const by = x * s + y * c;
        branch = Math.max(branch, Math.pow(Math.max(1 - Math.abs(by) * 14, 0), 1.4) * Math.max(1 - Math.abs(bx), 0));
      }
      const speck = Math.pow(Math.max(fbm(x * 6 + 4, y * 6 + 4, 2) - 0.45, 0) * 3, 2);
      const a = Math.min(branch + speck * 0.5, 1) * Math.max(1 - r, 0);
      return [1.1, a];
    },
    [DecalTile.Scorch]: (x, y) => {
      const r = Math.hypot(x, y);
      const n = fbm(x * 2.8 - 13, y * 2.8 + 7, 3);
      const a = Math.pow(Math.max(1 - r, 0), 1.4) * (0.6 + n * 0.8);
      return [0.12, Math.min(a, 1)];
    },
    [DecalTile.ElectricCrack]: (x, y) => {
      // 从中心放射的折线裂纹
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y);
      const spokes = 5;
      const k = ((ang + Math.PI) / (Math.PI * 2)) * spokes;
      const local = Math.abs(k - Math.round(k)) / spokes;
      const jitter = (smoothNoise(r * 5 + Math.round(k) * 13, Math.round(k) * 7) - 0.5) * 0.06;
      const a = Math.pow(Math.max(1 - Math.abs(local + jitter) * 26, 0), 1.5) * Math.max(1 - r, 0);
      return [1.4, Math.min(a, 1)];
    },
  };

  for (let t = 0; t < 4; t++) {
    const painter = painters[t as DecalTile];
    const ox = (t % DECAL_TILES_PER_ROW) * tile;
    const oy = Math.floor(t / DECAL_TILES_PER_ROW) * tile;
    for (let j = 0; j < tile; j++) {
      const y = ((j + 0.5) / tile) * 2 - 1;
      for (let i = 0; i < tile; i++) {
        const x = ((i + 0.5) / tile) * 2 - 1;
        const [lum, alpha] = painter(x, y);
        if (alpha <= 0) continue;
        const o = ((oy + (tile - 1 - j)) * size + ox + i) * 4;
        const v = Math.min(Math.max(lum, 0), 2) * 127.5;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = Math.min(Math.max(alpha, 0), 1) * 255;
      }
    }
  }
  return data;
}
