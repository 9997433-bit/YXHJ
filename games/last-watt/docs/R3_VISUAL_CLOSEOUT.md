# 《余电》Round 3 视觉闭环复检（R3-F2）

> **复检人**：R3-F2（云端）。
> **对照基准**：`games/last-watt/docs/VISUAL_AUDIT_R2.md`（审于 `e593fa2`）+ `.agent_workspace/PROGRESS.md` Round 2 拍板第 2 条（「必须修冰碎 Bloom 糊白，事件粒子可读优先于炫」）。
> **被审对象**：`agent/last-watt` @ `4f6c4b2` 的 `src/vfx` / `src/engine` / `src/app`（正式主循环）。
> **读法**：✅ 闭合 = 代码证据 + 自动化证据齐；◐ 部分闭合 = 主判定闭合但审计点名的附带缺口未清；❌ 未闭合。
> **时点声明**：本复检时点 `git branch -r` 只有 `main` 与 `agent/last-watt`，R3-O4（冰碎可读性 + 音效）尚无云端分支——本文即 R3-O4 开工前的基线快照，其修复落地后按 §3.4 的验收口径复验并回写本文。

---

## 0. 三项点名判定先行

| 点名项 | 判定 | 一句话结论 |
|---|---|---|
| **Bloom mask**（R2 审计 §1.1） | ✅ 闭合 | 引擎遮罩 pass ↔ `vfx.setMaskPass` 在正式主循环接通：alpha 粒子层与贴花整层被剔出 Bloom 输入，加法层按光源照常进；锁材质 hack 已删，换成引擎正式的 `skipBloomMask` 策略接口 |
| **顿帧 timeScale**（R2 审计 §1.2） | ◐ 主链闭合 | `Loop` 每帧采纳 `ImpactDirector.timeScale`，冰碎 60ms 顿帧在正式循环真实生效、渲染照常出帧、相机震动有了施加点；**慢放档仍缺**——`timeScale` 仍是 0/1 二值，波 3 教学链的 0.5s 慢放无法实现 |
| **冰碎 Bloom 糊白**（Round 2 拍板 #2） | ❌ 未闭合 | `git diff e593fa2..HEAD -- src/vfx/effects.ts` 为空：糊白的四个亮度源自 R2-O1 点名以来一个数值都没动。但定性已变——架构债（albedo 泛光）已清，剩下的是**参数债**，改动面约 5 个数值，见 §3 |

三项合计：审计 §1 的「接线债」全部还清，Round 2 新立的「观感债」原封未动。这与派工表一致——接线归 R2-O4（已合流），调参归 R3-O4（未开工）。

---

## 1. Bloom mask：✅ 闭合

**审计原判**（§1.1）：两头都造好了，中间没接；粒子 alpha 层与贴花整层进 Bloom，违反「Bloom 只吃自发光」。

**现状证据（逐条对上审计的修法清单）**：

1. **主循环实例化 + 视口同步**：`src/app/game.ts:129` 的 `attachVfxToEngine(this.engine, this.vfx, …)` 是正式对局的接线（不再只是 Gym/demo）；`src/vfx/engineBridge.ts:56-61` 先 `engine.resize()` 对齐一次视口，再订阅 `onViewportChange` 持续同步 `setViewport(drawingBufferHeight, verticalFov)`——审计要求的两处都在。
2. **遮罩 pass 前后钩子**：`src/engine/postfx/PostPipeline.ts:60` 新增 `onMaskPass: Signal<boolean>`，`render()` 在 `mask.apply()` 前发 `true`、`finally` 里 `revert()` 后发 `false`（`:133-140`，异常路径也保证还原）；`engineBridge.ts:81` 订阅它调 `vfx.setMaskPass(active)`。
3. **VFX 侧剔除语义正确**：`GpuParticleSystem.setMaskPass`（`GpuParticleSystem.ts:452-454`）只剔常规混合层（`uCull` 整层丢弃）——雾、尘土、冰晶碎片是被照亮的物体不是光源；加法层照常渲染。`DecalManager.setMaskPass`（`DecalManager.ts:172-174`）贴花整层剔除。与圣经语义一致。
4. **锁材质 hack 已按约定退役**：`src/vfx/bloomMaskCompat.ts` 已删除（-36 行），替代物是引擎正式接口 `src/engine/postfx/bloomMask.ts` 的 `skipBloomMask` / `hideFromBloomMask` 策略；`EmissiveMask.walk`（`EmissiveMask.ts:99-121`）尊重策略并对 `hidden` 子树整枝剪除。粒子与贴花在构造时自声明 `skipBloomMask`（`GpuParticleSystem.ts:190`、`DecalManager.ts:154`）。

**自动化证据**：vfx 自检新增「自发光遮罩：粒子/贴花保留自己的着色器，普通网格照常代理」PASS（`src/vfx/selfcheck.ts:384`）。

**随判定登记的两条残余（均不挡闭合，属审计 §3/§4 既有登记）**：

- `EmissiveMask.syncProxy` 仍不拷贝 `map`/`alphaMap`（`EmissiveMask.ts:166-198`）。当前全场无贴图零表现问题；**正式资产接入 checklist 的哨兵继续有效**。
- **VISUAL_BIBLE §9 未回写**：`VISUAL_BIBLE.md:173-175` 仍写「threshold 1.1（阈值法）+ 色调映射 Neutral」，而实现是双 composer 遮罩法（`BLOOM.threshold = 0`，`engine/config.ts:96`）+ ACESFilmic（`engine/core/renderer.ts:52`）。审计 §4 裁决「保留实现、改写 §9」，且 §7 明言「文档即真源，不回写视为未完成」——这笔文档债在 §4 表里继续挂账。

---

## 2. 顿帧 timeScale：◐ 主链闭合，慢放档未闭合

**审计原判**（§1.2）：立法完备，执法空转；引擎 `Loop` 无 timeScale 入口；附带缺口两条——慢放档缺失、相机震动无施加点。

### 2.1 主链：✅

- `Loop` 增加 `timeScale`（`src/engine/core/Loop.ts:65`），在 `onFrameBegin` 之后采样，累加器按 `delta × timeScale` 进水（`:127-129`）——顿帧期间零个固定步，`onRender`/`onPresent` 照常发（`:151-152`），完全符合审计「只停逻辑与粒子时钟，渲染不停」的修法建议。
- 桥接是审计建议的帧协议唯一实现：`engineBridge.ts:64-77` 在 `onFrameBegin` 调 `vfx.beginFrame(realDelta*1000)` 并把返回的 `impact.timeScale` 写回 `engine.loop.timeScale`；`onRender` 调 `vfx.endFrame()` 推进粒子时钟。
- HUD 吃到冲击状态（审计 §2.3）：`src/app/game.ts:130` `onImpact: (impact) => this.hud.hud.applyImpact(impact)`，白闪/暗角走 DOM 与真实对局接通。
- **自动化证据**：自检「引擎帧协议：冰碎顿帧冻结逻辑 tick，渲染照常出帧」PASS（顿帧 3 帧内 0 tick / 6 帧画面，之后恢复 4 tick）；「顿帧期间粒子时钟同步冻结」PASS。

### 2.2 附带缺口 1（相机震动施加点）：✅

`CameraRig.setShakeOffset`（`src/engine/core/CameraRig.ts:88-92`，纯平移、55° 俯仰不受扰）已建，`engineBridge.ts:70-73` 每帧用 `computeShakeOffset` 施加，且提供 `cameraShake: false` 开关供截图回归。震动振幅超圣经 3 倍的调参债（审计 §4 表）仍随真机验证挂账。

### 2.3 附带缺口 2（慢放档）：❌ 未闭合

`ImpactDirector.timeScale` 仍是二值（`ImpactDirector.ts:200-202`：`hitstopRemainingMs > 0 ? 0 : 1`）；全仓 `rg "slowmo|慢放"` 零命中。VISUAL_BIBLE §6 裁决的「波 3 冰碎首触发 0.5s 全局慢放、与顿帧互斥期间以慢放为准」依然无法实现——而 §10.1 教学链是 M1 P0 验收项。审计原文把它列为「同属本项，必须一起修」，故本项整体只能判 ◐。

**引擎侧已就绪的好消息**：`Loop` 的累加器天然支持分数 timeScale，`RenderEvent.scaledDelta` 契约也已写明（`Loop.ts:23`）——补 `requestSlowmo(scale, durationMs)` 只动 `ImpactDirector` 一个文件加互斥裁决，引擎零改动。**建议归属**：随 R3-O4 的冰碎教学链一起落，或主调度显式改期（不许静默滑走，同审计对音效的处置措辞）。

---

## 3. 冰碎 Bloom 糊白：❌ 未闭合（架构债已清，剩参数债）

**债务出处**：R2-O1 在合流切片上实测点名「冰碎的溅射环 + 亮芯经 Bloom 之后在近景会糊成一团白，碎片读不出来」（PROGRESS.md R2-O1 回报观察 1），主调度升格为 Round 3 拍板第 2 条。R2 审计成文于切片之前，故本节的机理分析与验收口径由本复检补立。

### 3.1 未动的直接证据

- `git diff e593fa2..HEAD -- games/last-watt/src/vfx/effects.ts` **输出为空**——冰碎演出的全部亮度/尺寸曲线与 R2-O1 点名时逐字节相同。
- Bloom 参数同样未动：`BLOOM = { strength: 0.6, radius: 0.62, threshold: 0, mix: 1.0 }`（`engine/config.ts:93-101`）。
- 无 R3-O4 分支在途（见文首时点声明）。

### 3.2 机理：糊白的四个源，以及为什么碎片本体已经无辜

遮罩 pass 接通后（§1），24 片 alpha 混合的冰晶碎片**已被剔出 Bloom 输入**——碎片自己不再泛光，`colorStart` 也只有克制的 `boost(ice, 1.25)`（`effects.ts:84`，注释明白写着防「白纸片」）。近景糊白由四个**加法/叠加源**贡献，全部合法进 Bloom：

| 源 | 数值现状 | 折算 |
|---|---|---|
| 亮芯 Flare | `boost(ice, 2.6)`，尺寸 1.5r→2.9r，`sizeCurve 0.5` 先猛胀（`effects.ts:97-109`） | 线性 RGB ≈ (1.36, 2.42, 2.60)，三通道全部 >1 深入 Bloom；近景变焦档（`zoomSteps[1]=0.62`）下接近 3 格宽的辉光卡 |
| 溅射环 | `boost(ice, 1.9)`，0.5r→2.4r / 0.3s（`effects.ts:112-123`） | 与亮芯同帧同心叠加 |
| 霜屑 ×14 | `boost(ice, 2.2)` 加法（`effects.ts:126-147`） | 单粒小，但爆点处密集 |
| 全屏白闪 | `intensity 0.62`，hold 17ms + decay 90ms（`ImpactDirector.ts:66-69`） | DOM 层，走真实时钟 |

**顿帧把最糟的一帧定住 60ms**：碎裂当帧粒子时钟只走了 ~16ms，随后 60ms 顿帧冻结粒子时钟（这是 §2 里验证过的正确行为）。亮芯寿命 160ms、`sizeCurve 0.5`——冻结时它恰好停在 ~1.9 世界单位、~90% 峰值亮度的状态整整 60ms；同窗口内全屏白闪按真实时钟从 0.62 衰减。三者叠加，近景就是那团读不出碎片的白。

旁证：敌人表现层自己已经在给冰碎「省亮度预算」——`EnemyView.ts:37-39` 的冰壳材质注释明写「shell blows out into a white blob…the shatter itself needs somewhere brighter to go」，冰壳自发光压到 0.42。表现层的亮度纪律意识在，只是 `effects.ts` 这一发还没按同一纪律核算。

### 3.3 定性与改动面

架构上「albedo 永不泛光」已成立，糊白不再是系统缺陷而是**一次事件内的亮度预算超支**。改动面收敛在两个文件约 5 个数值：`effects.ts` 的亮芯 boost/尺寸终值、溅射环 boost、霜屑 boost，以及 `ImpactDirector.ts` 的 `IMPACT_PRESETS.iceShatter.flash.intensity`。**建议起点**（真机截图拍板，数值不是裁决）：亮芯 2.6→≈1.6 且 `sizeEnd` 2.9r→≈2.0r、溅射环 1.9→≈1.4、白闪 0.62→≈0.45；原则是**顿帧冻结帧的画面主体应是碎片 + 环形边界，不是亮芯**——白闪负责「咔嚓」的一瞬，亮芯不必再赢它一次。

### 3.4 闭合验收口径（留给 R3-O4，复验按此执行）

1. 近景变焦档触发冰碎，顿帧冻结帧截图内：24 片碎片轮廓**可数**、1 格溅射环边界**可辨**、除白闪首帧外无整屏过曝帧；
2. T1 关灯测试（`B` 键关 post）对照截图：关 Bloom 后碎片形状不变，只失去辉光——证明可读性不依赖 Bloom 也不被它摧毁；
3. 调参后回写 VISUAL_BIBLE §4 峰值表与本文档本节（文档即真源）。

---

## 4. 必须修清单逐条闭合表（对照 R2 审计 §1–§4）

| 审计条目 | 判定 | 证据 / 备注 |
|---|---|---|
| §1.1 Bloom mask 接线 | ✅ | 本文 §1 |
| §1.2 顿帧主链 | ✅ | 本文 §2.1 |
| §1.2 慢放档 | ❌ | 本文 §2.3，`timeScale` 仍二值 |
| §1.2 相机震动施加点 | ✅ | 本文 §2.2 |
| §1.3 冰碎事件桥 | ✅ | `src/vfx/combatBridge.ts` 优先绑 `combat/vfxSignals.ts` 三条稳定信号；审计点名的三件事全落：**ID 映射**已登记进 INTEGRATION.md §3.8（`fx_*` 注册表冻结）；**坐标换算**经 `toWorld` 注入、默认约定与 `grid/coords` 一致（`combatBridge.ts:46-50`）；**不许双发冲击**由 `payload.impact.signal` 短路兑现（`combatBridge.ts:210-214`），自检「冲击不被重复请求」PASS |
| §1.3 缺口表·叠层湿材质 | ❌ | `EnemyView` 无 wet 材质行为（rg 零命中） |
| §1.3 缺口表·冻结冰壳 | ◐ | `EnemyView.ts:41-49` 冰壳材质替换 + 1.18 倍鼓壳已可读；§5.6 的冰壳**着色器**仍不存在，判占位达标、SOTA 未达 |
| §1.3 缺口表·碎裂三重反馈 | ✅ | 三处断链全接（§1/§2/桥）；可读性另案 §3 |
| §1.3 缺口表·音效同帧 | ❌ | 全项目仍无音频系统（`rg -i audio src/` 仅 `combat/types.ts` 类型字段）。Round 3 拍板第 4 条已派 R3-O4，未落地 |
| §1.3 缺口表·教学链三件套 | ◐ | 提示条 ✅（`combo_first_seen` → `hud.showComboTip`，`game.ts:134`）；慢放 ❌（§2.3）；破碎锤图纸高亮 ❌ |
| §2.1 金黄越界（锤击螺栓） | ❌ | `effects.ts:306` 仍 `boost(PALETTE.coin, 1.2)` |
| §2.1 焦褐发光 / 冰白常驻（testbed） | ❌（降级候审） | `EmissiveTestbed.ts:72,91`（tar 自发光探针）、`:162,197`（frost 顶盖/角标）原样。但审计判必须修的理由——「它是唯一正式场景内容」——已消失：`main.ts` 现在跑的是可玩切片，testbed 退居 `engine/boot.ts` 旁路 harness。按审计自己的注记逻辑可降回 [可延后]，建议主调度确认改判而不是静默降级 |
| §2.2 M1 支撑效果七条 | ❌（一条 ◐） | `events.ts` 契约仍 7 条；曳光/命中火花/油渍/挖沟/湿/金币流全缺。受击闪白 ◐：`EnemyView.ts:165-197` 已有材质级闪白（0.12s 自发光脉冲），死亡溶解着色器仍无 |
| §2.3 HUD 接线 | ✅ | `applyImpact` 正式调用方在 `game.ts:130`；HUD 数据源为真实对局（`HudBridge` 绑 `GameSession`/`CombatSystem`） |
| §4 数值偏差回写 | ❌ | `git log e593fa2..HEAD -- docs/VISUAL_BIBLE.md` 零提交：Bloom 遮罩法条款、ACES 取舍、冰碎峰值 40 vs 32、震动振幅——八行全部未回写 |

**闭合率**：接线类 6/6 全闭；表现内容/文档类 1◐+8❌。与 Round 3「不再扩系统，只打磨与验收」的拍板对表，❌ 项里挡 M1 验收的是：糊白（V-01/拍板 2）、音效（G-06/拍板 4）、慢放+图纸高亮（G-06 教学链）；其余属登记与快改。

---

## 5. 复现证据（全部实测于 `4f6c4b2`）

```bash
cd games/last-watt

# vfx 无头自检：17/17 通过（R2 基线 13 项 + 新增 4 项：
#   自发光遮罩策略 / 引擎帧协议顿帧 / 战斗桥稳定信号 / 战斗桥通用冲击兜底）
npm run selfcheck

# 类型检查：0 错误
npx tsc --noEmit

# 单测：79 pass / 2 fail —— 两条失败均为 gameplay 侧过期断言
#（自检数 73≠47、swift_rat 漏怪 payload 变更），不在 vfx 辖区，归 R3-G1 全链修复
npm test

# 糊白未动的直接证据（输出为空）：
git diff e593fa2..HEAD -- src/vfx/effects.ts

# 浏览器目检入口：npm run dev 即正式切片（main.ts 挂 src/app/Game）；
# vfx 接线试验台 src/vfx/demo/integration.html 可单独跑冰碎全链路
```

---

## 6. 遗留派工建议（按依赖排序）

1. **R3-O4（已派，未开工）**：按 §3.3 调参 + §3.4 口径截图验收；同批落最小 combo 音效（拍板 4）与冰碎首触发慢放档（`ImpactDirector.requestSlowmo`，含与顿帧互斥裁决）。
2. **随任意 PR 捎带的半小时级快改**：`effects.ts:306` 螺栓改暖白/焦褐；`vfx_hammer_impact` 优先级降 Persistent（审计 §3 既有登记）。
3. **文档回写**：VISUAL_BIBLE §9（遮罩法 + ACES）与 §4 峰值表——R2 审计 §7 第 7 条原文「不回写视为未完成」，Round 3 收尾前必须清账。
4. **主调度裁决两件**：testbed 立法色违规降级为 [可延后]（理由见 §4 表）；湿材质/溶解着色器/曳光等 §2.2 剩余项是否随 M1 验收或显式改期 M2。
