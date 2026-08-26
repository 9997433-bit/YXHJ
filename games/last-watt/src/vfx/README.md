# `src/vfx` — GPU 粒子战场语言

> 责任人：R1-O4。独占 `games/last-watt/src/vfx/**` 与 `games/last-watt/src/ui/**`。
> 上位文档：`docs/GDD-余电.md` 第 15 章、`games/last-watt/docs/VISUAL_BIBLE.md`。

粒子在《余电》里不是装饰，是**战场信息通道**：玩家判断「发生了什么」靠的是
颜色（六色立法）+ 形状（五种形状语言）+ 冲击（顿帧/闪光/震动）。
因此本模块的所有取舍都优先服务可读性，其次才是观感。

## 一句话架构

**CPU 只在粒子出生时写一次属性，之后的位置、尺寸、颜色、旋转、翻页全部由顶点着色器
按解析式从 `uTime` 求出。** 每种混合模式一个 `THREE.Points` = 一次 draw call，
池是环形缓冲，运行期零 `new`、零 GC、零逐粒子 CPU 更新。

运动模型是带阻尼的匀加速解析积分，而不是逐帧欧拉：

```
v(t) = v0·e^(-k·t) + (a/k)·(1 - e^(-k·t))
p(t) = p0 + (v0/k)·(1 - e^(-k·t)) + (a/k)·(t - (1 - e^(-k·t))/k)
```

代价是**粒子出生后不能再改轨迹**（没有力场、没有碰撞）。这是刻意的：
GDD 15.3 要求 20,000 粒全 GPU 模拟、CPU 粒子零使用，而本作没有任何一个效果需要运行时改轨迹。

## 文件地图

| 文件 | 职责 |
|---|---|
| `VfxSystem.ts` | 门面。玩法层只碰这个类 |
| `events.ts` | 事件契约与优先级枚举，新效果先在这里加一行 |
| `palette.ts` | 六色 + 五形状立法。**禁止在效果里写死十六进制** |
| `atlas.ts` | 程序化 SDF 生成 1024 粒子图集 / 512 贴花图集，无二进制资产 |
| `shaders.ts` | 点精灵顶点/片元着色器 |
| `GpuParticleSystem.ts` | 环形池、属性写入、draw call |
| `DecalManager.ts` | 贴花实例化渲染，64 张上限环形淘汰 |
| `ImpactDirector.ts` | 顿帧/闪光/震动统一入口与节流立法（不依赖 three） |
| `budget.ts` | 预算计数与四级降级阶梯 |
| `effects.ts` | 具体效果：冰碎、冻结、冷凝雾、锤击、超载、过热、死亡 |
| `engineBridge.ts` | 接引擎每帧协议：timeScale、遮罩 pass、相机震动、HUD 冲击 |
| `combatBridge.ts` | 接战斗事件：稳定信号 → `vfx.play` |
| `cameraShake.ts` | 把震动量换算成相机世界偏移 |
| `selfcheck.ts` | 无头自检，17 项断言，不需要 WebGL |
| `demo/` | VFX Gym（纯粒子）与引擎接线试验台 |

## 接入方式（引擎）

一行接完：

```ts
const vfx = new VfxSystem();
const bridge = attachVfxToEngine(engine, vfx, { onImpact: (s) => hud.applyImpact(s) });
```

它把下面这份**顺序不能换**的协议接到 `engine.loop` 上：

```
onFrameBegin  → vfx.beginFrame(realDtMs)，把 impact.timeScale 交回 loop
onFixedUpdate → 玩法按 dt·timeScale 推进（顿帧期间一个 tick 都不跑），期间调 vfx.play(...)
onRender      → vfx.endFrame()，推进粒子时钟与循环发射器
onPresent     → 引擎绘制，属性脏区在这里上传
post.onMaskPass → vfx.setMaskPass()
```

丢掉 `beginFrame` 的返回值，冰碎就只剩粒子，没有那 60ms 的「咔嚓」——
这是唯一一处需要引擎配合的地方，也是 `engineBridge` 存在的全部理由。

桥还负责两件小事：视口跟随 `engine.onViewportChange` 刷新（漏了点精灵的
世界尺寸→像素换算会错），以及把 `impact.shake` 换算成 `CameraRig.setShakeOffset`
的世界偏移。震动只做**平移**——相机一旦转起来，固定俯角的网格读数会飘，玩家点格子会点偏。

### 为什么粒子和贴花要退出遮罩材质替换

引擎的 `EmissiveMask` 会在遮罩 pass 里把每个对象的材质换成代理材质。
这对普通网格是对的，对本模块是致命的：

1. 粒子的运动写在顶点着色器里，代理材质没有这段代码，换上去之后 20,000 颗粒子
   会全部退回**出生点**，Bloom 拿到一张幽灵图；
2. 代理材质默认黑色，而 `PointsMaterial` / `MeshBasicMaterial` 无贴图时画的是**实心方块**——
   遮罩图上会出现一片黑方块，合成后表现为辉光被抠掉。

所以粒子层与贴花层用引擎的正式开关 `skipBloomMask(object)` 声明「我自己渲」，
进不进 Bloom 改由着色器里的 `uCull` 决定（雾、尘土、贴花是被照亮的东西，不是光源，
遮罩 pass 里整层剔掉）。Round 1 那份靠 `Object.defineProperty` 吞掉材质赋值的
`bloomMaskCompat.ts` 已经删除。

## 接入方式（战斗 / 玩法）

战斗层只发事件，不碰粒子；`combatBridge` 负责翻译：

```ts
const combat = connectCombatToVfx(combatSystem.bus, vfx, {
  mistTowers: [TOWER_IDS.condenserJet],
  onComboFirstSeen: (combo) => hud.showComboTip(combo),
});
```

绑的是 `combat/vfxSignals.ts` 的三条**稳定信号**，不是反应行 id
（反应表拆行改名不该波及粒子层）：

| 来源 | 演出 |
|---|---|
| `ice_shatter` | `ice-shatter`（碎片 + 亮芯 + 溅射环 + 霜痕 + 顿帧白闪） |
| `frozen` (`begin`) | `freeze` |
| `overload` (`begin` / `end`) | `overload-start` / 过热才有的 `overload-end` |
| `enemy_killed` | `unit-death` |
| `tower_fired` (`melee`) | `hammer-impact` |
| `tower_fired` (`cone`，冷凝塔) | `condense-mist` 循环发射器，停火 700ms 自动收 |
| `reaction_triggered`（**没有**稳定信号的行） | 按行声明的 `impact` 出顿帧/闪光/震动 |

最后一行是防重复：带稳定信号的行由专属处理器负责，不再走通用冲击，
否则冰碎会请求两次顿帧——第二次必被 100ms 立法驳回，驳回计数就此失真。

想手动播放（试验台、Gym）时直接用事件名：

```ts
vfx.play('ice-shatter', { position, splashRadius: 1, direction });
const mist = vfx.play('condense-mist', { position, direction, range: 3.2 });
mist?.setTransform(newPosition, newDirection);   // 跟随炮口
mist?.stop();                                    // 塔停机/断电/卖出时
```

坐标一律是**世界坐标**（1 世界单位 = 1 格，地面 y=0）；桥收到的战斗格坐标
按 `(x, 高度, y)` 换算，与 `engine/grid/coords.ts` 同一套约定。
本模块只在 `combatBridge.ts` 里 `import type` 战斗事件类型，运行期不依赖 `src/combat`。

## 预算与降级（GDD 15.3，程序约束不是建议值）

| 项 | 上限 |
|---|---|
| GPU 粒子总量 | 20,000 |
| 活跃发射器 | 64（循环 24 / 一次性 40） |
| 贴花 | 64 张，1 张 512 图集 |
| 动态点光 | 8 |
| 粒子 draw call | 2（加法层 + 常规层） |

降级阶梯：环境氛围 → 循环发射率 → 贴花上限 → 动态点光。
**事件与 combo 粒子永不降级**，`VfxBudget.allow()` 对它们永远返回满额。
同类循环发射器 >10 个时自动减半发射率并隔帧更新。

冲击节流（`ImpactDirector`）：顿帧全局 100ms 内最多 1 次；震动取最大档，
强震进行中的弱请求整个丢弃（**不能只续时长**：衰减包络是 `1 - elapsed/duration`，
拉长 duration 会把当前振幅顶上去，等于从后门实现了叠加——这个坑自检里有回归断言）。

## 验证

```bash
npm run selfcheck   # 无头自检：17 项断言，不需要 GPU，可进 CI

# 浏览器里看（Vite 开发服务器）
# src/vfx/demo/index.html        VFX Gym：只跑粒子与 HUD
# src/vfx/demo/integration.html  引擎接线：真 Engine + 后处理 + VFX + HUD，战斗事件由脚本假扮
# 两页都支持 ?t=2.80：固定步长快进到某一刻停帧，画面逐帧可复现，可做截图回归
```

自检覆盖的是截图证明不了的部分：环形池越界与过期回收、combo 永不降级、
循环发射器减半与隔帧、顿帧 100ms 节流、**顿帧期间粒子时钟同步冻结**、
贴花淘汰、3600 帧混合大潮不破任何预算（实测峰值 2,130 粒 / 20,000），
以及 Round 2 补的三处接线：遮罩 pass 里粒子/贴花保留自身材质而普通网格照常代理、
真实 `Loop` 下顿帧期间逻辑 tick 为 0 而画面照常出帧、战斗信号到 `vfx.play` 的映射
（含冷凝雾停火自动收与「带稳定信号的行不重复请求顿帧」）。

## 已知边界

- **点精灵的固有限制**：粒子中心移出视口时整颗被裁掉（边缘弹出），
  且 `gl_PointSize` 有驱动上限。极近距离的大粒子若出现边缘弹出，
  就是该效果改用 instanced billboard 的信号——届时只需替换 `GpuParticleSystem` 的
  几何与着色器，`EmitParams` 与所有效果代码不用动。
- 粒子出生后不可改轨迹（见上文运动模型）。
- 火焰翻页 tile 必须连号（`Flame0..Flame3`），新增 tile 请追加到枚举末尾。
- 锤击**不给顿帧、不给震屏**（VISUAL_BIBLE 10.3）：打击感来自蓄力节奏 + 目标闪白 + 音效。
  只有当它把冻结目标打出冰碎时才吃那份事件级冲击，这样 60ms 顿帧才保得住稀缺性。

## 尚未实现（M2 及以后，接口已留位）

油渍冒泡与点燃、火场、特斯拉折线电弧（`combat` 已在 `chain_arc` 事件里给了折线几何）、
导电增强、大招全场电磁波、拆迁蟹自爆、漏怪抢金币、丢区断电、挖沟/搭桥施工。
这些都只需在 `events.ts` 加一行、在 `effects.ts` 写一个函数，不需要动核心。
