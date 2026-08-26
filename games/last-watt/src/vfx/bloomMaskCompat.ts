import type * as THREE from 'three';

/**
 * 与 `engine/postfx/EmissiveMask` 的兼容层。
 *
 * 引擎的自发光遮罩 pass 会把场景里每个对象的材质临时换成一个「代理材质」
 * （`PointsMaterial` / `MeshBasicMaterial`），再用它渲一张只含自发光的图给 Bloom。
 * 这套做法对普通网格是对的，对本模块却会出两个问题：
 *
 * 1. **位置错**：粒子的运动解析式写在顶点着色器里，代理材质没有这段代码，
 *    换上去之后 20,000 颗粒子会全部退回**出生点**，Bloom 拿到的是一张幽灵图；
 * 2. **黑洞**：代理材质默认 `color = 黑`，而 `PointsMaterial` / `MeshBasicMaterial`
 *    没有贴图时画的是**实心方块**——遮罩图上会出现一片黑方块，
 *    合成后表现为辉光被硬生生抠掉。这正是「扁平方块冒充粒子」的最坏形态。
 *
 * 所以这里锁住 `material` 属性：遮罩 pass 的写入被忽略，粒子在两个 pass 里
 * 都用自己的着色器渲染，位置永远正确。哪一层该不该进 Bloom 由 `uCull` 决定
 * （见 `VfxSystem.setMaskPass`），而不是由外部换材质决定。
 *
 * 引擎侧若将来提供「跳过某对象」的正式开关，可以删掉这个文件改用那个开关。
 */
export function protectMaterialFromMaskSwap(object: THREE.Object3D & { material: unknown }): void {
  const own = Object.getOwnPropertyDescriptor(object, 'material');
  // 已经是访问器说明保护过了，别套两层
  if (own && !('value' in own)) return;

  const real = object.material;
  Object.defineProperty(object, 'material', {
    configurable: true,
    enumerable: true,
    get: () => real,
    set: () => {
      /* 遮罩 pass 的材质替换在这里被吞掉，见文件头注释 */
    },
  });
}
