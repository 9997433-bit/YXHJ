/**
 * GPU 点精灵粒子着色器。
 *
 * 立法：**CPU 每帧不碰任何一颗粒子**。生成时写一次「出生属性」，
 * 之后位置/尺寸/颜色/旋转/翻页全部由顶点着色器按解析式从 `uTime` 求出。
 * 这样 20,000 粒的更新成本恒等于零 CPU，符合 GDD 15.3「全部 GPU 模拟，CPU 粒子零使用」。
 *
 * 运动模型（带阻尼的匀加速，解析积分而非逐帧欧拉）：
 *   v(t) = v0·e^(-k·t) + (a/k)·(1 - e^(-k·t))
 *   p(t) = p0 + (v0/k)·(1 - e^(-k·t)) + (a/k)·(t - (1 - e^(-k·t))/k)
 * k→0 时退化为 p = p0 + v0·t + ½·a·t²，shader 里按分支取。
 */

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

// position（内置属性）= 出生位置
attribute vec2 aTime;    // x: 出生时刻, y: 寿命
attribute vec3 aVel;     // 初速度
attribute vec3 aAcc;     // 恒定加速度（重力/上浮）
attribute vec2 aSize;    // x: 起始世界尺寸, y: 结束世界尺寸
attribute vec2 aRot;     // x: 初始旋转(rad), y: 自旋角速度(rad/s)
attribute vec2 aTile;    // x: 图集 tile 基号, y: 翻页帧数(1=静态)
attribute vec4 aColorA;  // 起始颜色（线性 RGB + alpha）
attribute vec4 aColorB;  // 结束颜色
attribute float aDrag;   // 阻尼系数 k
attribute vec2 aCurve;   // x: 颜色插值指数, y: 尺寸插值指数（1 = 线性）

uniform float uTime;
uniform float uPixelScale;   // drawingBufferHeight / (2·tan(fov/2))
uniform vec2  uSizeClampPx;  // 点精灵像素尺寸下限/上限

varying vec4 vColor;
varying float vRot;
varying float vTile;

void main() {
  float age = uTime - aTime.x;
  float life = aTime.y;

  if (life <= 0.0 || age < 0.0 || age >= life) {
    // 死亡粒子推到裁剪空间外，光栅化阶段零成本
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    vRot = 0.0;
    vTile = 0.0;
    return;
  }

  float t = age / life;

  vec3 disp;
  if (aDrag > 1e-3) {
    float e = 1.0 - exp(-aDrag * age);
    disp = aVel * (e / aDrag) + aAcc * ((age - e / aDrag) / aDrag);
  } else {
    disp = aVel * age + 0.5 * aAcc * age * age;
  }

  vec4 mv = modelViewMatrix * vec4(position + disp, 1.0);
  gl_Position = projectionMatrix * mv;

  // 指数曲线：指数 >1 表示「先稳住、末尾快速收」。
  // 冰晶碎片要靠它读成实心的冰，线性淡出会让它一出生就变成一团灰雾。
  float ct = pow(t, aCurve.x);
  float st = pow(t, aCurve.y);

  float worldSize = mix(aSize.x, aSize.y, st);
  float raw = worldSize * uPixelScale / max(-mv.z, 1e-3);
  float sizePx = clamp(raw, uSizeClampPx.x, uSizeClampPx.y);

  // 亚像素粒子不缩到 0，改为按面积衰减 alpha，避免远处闪烁
  float subPixelFade = raw < uSizeClampPx.x
    ? (raw * raw) / (uSizeClampPx.x * uSizeClampPx.x)
    : 1.0;

  gl_PointSize = sizePx;
  vColor = mix(aColorA, aColorB, ct);
  vColor.a *= subPixelFade;
  vRot = aRot.x + aRot.y * age;

  // 翻页动画：帧号在顶点阶段定好，片元只管采样
  float frames = max(aTile.y, 1.0);
  vTile = aTile.x + min(floor(t * frames), frames - 1.0);
}
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uTilesPerRow;
uniform float uTileInset;   // 半像素内缩，防 mipmap 邻格渗色
uniform float uCull;        // 1 = 本层在自发光遮罩 pass 里整层剔除

varying vec4 vColor;
varying float vRot;
varying float vTile;

void main() {
  if (uCull > 0.5) discard;
  if (vColor.a <= 0.0) discard;

  // gl_PointCoord 原点在左上，翻到常规 UV 朝向后绕中心旋转
  vec2 uv = gl_PointCoord - 0.5;
  uv.y = -uv.y;
  float c = cos(vRot);
  float s = sin(vRot);
  uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

  // 旋转后落到方格外的采样直接丢弃，防止取到邻居 tile
  if (max(abs(uv.x), abs(uv.y)) > 0.5) discard;

  vec2 local = mix(vec2(uTileInset), vec2(1.0 - uTileInset), uv + 0.5);

  vec2 cell = vec2(mod(vTile, uTilesPerRow), floor(vTile / uTilesPerRow));
  vec2 atlasUv = (cell + local) / uTilesPerRow;

  vec4 texel = texture2D(uAtlas, atlasUv);
  if (texel.a <= 0.003) discard;

  // 图集 RGB 存的是 0..2 的亮度（编码时 ÷2），这里还原自发光峰值供 Bloom 吃
  vec3 rgb = vColor.rgb * texel.rgb * 2.0;
  float alpha = vColor.a * texel.a;

  gl_FragColor = vec4(rgb, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
