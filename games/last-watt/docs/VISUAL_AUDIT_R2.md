# 《余电》Round 2 视觉审计（R2-F2）

> **审计人**：R2-F2（云端）。
> **对照基准**：`games/last-watt/docs/VISUAL_BIBLE.md`（实现清单）+ `docs/premium-game-visual-prompts.md`（验收语言）。两者的上游 `docs/GDD-余电.md` 15/18 章视为不可动。
> **审计对象**：`agent/last-watt` @ `e593fa2` 的 `src/engine` / `src/vfx` / `src/ui`（旁及 `src/combat` `src/gameplay` 的表现接缝）。
> **读法**：`[必须修]` = 挡 M1 验收或挡 Round 2 垂直切片；`[可延后]` = M2 之后或「登记即可」。每条给出代码证据，评审时直接翻文件对质。
> **服从裁决**：主调度已拍板「Round 2 第一优先级 = 可玩垂直切片」（PROGRESS.md），本审计的必须修排序以垂直切片路径为先。

---

## 0. 总评

四个表现模块**各自内部质量高，互相之间零接线**。粒子库、冲击节流器、Bloom 遮罩、HUD 单拎出来都对得起圣经条款，且各有无头自检；但引擎主循环没有实例化 `VfxSystem`，战斗事件没有桥到粒子，顿帧 `timeScale` 没有被任何时钟消费。**当前跑 `npm run dev` 看到的是 EmissiveTestbed 脚手架，一个圣经里的战场效果都不在正式场景里。** Round 2 的观感债不是「效果不够好」，而是「效果还没上场」。

三个点名问题的结论先行：

| 点名项 | 结论 | 详见 |
|---|---|---|
| Bloom mask | **两头都造好了，中间没接**。引擎遮罩 pass 与 VFX 的 `setMaskPass` 互不知晓；现状下粒子 alpha 层与贴花整层进 Bloom，违反「Bloom 只吃自发光」 | §1.1 |
| 顿帧 timeScale | **立法完备，执法空转**。`ImpactDirector` 节流正确，但引擎 `Loop` 无 timeScale 概念，正式循环里冰碎 60ms 顿帧是空操作；且缺 0.5s 慢放档，教学链无法实现 | §1.2 |
| 冰碎接战斗事件 | **未接**。战斗侧 `reaction_triggered`（含 `fx_shatter`/hitstop/flash 全套 ImpactSpec）只有无头探针在听；`vfx.play('ice-shatter')` 只被 Gym 和自检调用过 | §1.3 |

---

## 1. 三大点名问题（全部 [必须修]，责任人对应 Round 2 派工）

### 1.1 Bloom mask：引擎遮罩 pass 与 VFX 剔除开关未接（→ R2-O4「skipBloomMask」）

**现状证据**：

- 引擎侧：`src/engine/postfx/PostPipeline.ts` 双 composer 方案正确——先渲自发光遮罩喂 UnrealBloom，再渲 beauty 叠加。`EmissiveMask.apply()` 把全场材质换成自发光代理。**但 `render()` 全程没有调用 `VfxSystem.setMaskPass()`，引擎也根本没持有 `VfxSystem` 实例**（`Engine.ts` 无任何 vfx 引用）。
- VFX 侧：`src/vfx/bloomMaskCompat.ts` 的 `protectMaterialFromMaskSwap()` 锁死了粒子 `Points` 与贴花 `InstancedMesh` 的 `material` 属性——引擎的材质替换被静默吞掉（这是对的，代理材质会让 GPU 粒子退回出生点）。副作用是：**遮罩 pass 里粒子与贴花按原样全彩渲染**。
- VFX 侧已备好正式开关：`GpuParticleSystem.setMaskPass()` 剔 alpha 层（`uCull` discard）、`DecalManager.setMaskPass()` 剔整层贴花、加法层视为光源照常进 Bloom。语义与圣经一致，只是没人调。

**违反条款**：prompts §0.2 / §4.2「Bloom 只吃自发光」、T1 关灯测试「任何 albedo 像素不得泛光」。现状下焦褐尘土、土块、螺栓、alpha 层冰晶碎片、油渍/霜痕贴花——全是「被照亮的物体不是光源」——都会泛光。焦褐还同时踩了「焦褐永不出现在发光通道」（VISUAL_BIBLE §2 断言）。

**修法**（接线量小，一次挂钩）：

1. `VfxSystem` 由主循环（R2-O1）实例化并 `attachTo(engine.scene)`；`Engine.resize()` 里补 `vfx.setViewport(drawingBufferHeight, fovRad)`。
2. `PostPipeline` 增加遮罩 pass 前后钩子（`onMaskBegin/onMaskEnd` 或直接注入 `setMaskPass` 回调），在 `mask.apply()` / `mask.revert()` 两侧调用 `vfx.setMaskPass(true/false)`。
3. 挂上后按 `bloomMaskCompat.ts` 文件头注释的约定，评估是否用引擎正式的「跳过对象」开关取代锁属性 hack（可延后，hack 本身无害）。

### 1.2 顿帧 timeScale：引擎时钟不消费冲击状态，且缺慢放档（→ R2-O4「timeScale 顿帧」）

**现状证据**：

- `src/vfx/ImpactDirector.ts` 的节流立法正确（100ms 冷却驳回、震动取最大档不叠加，自检有断言覆盖）。`VfxSystem.beginFrame()` 按协议返回 `ImpactState`，注释明说「把返回值丢掉，冰碎的顿帧就不会生效——这是唯一一处需要引擎配合的地方」。
- 引擎侧 `src/engine/core/Loop.ts` 是纯固定步长：`onFixedUpdate` 永远按 `SIM.fixedDelta` 推进，**没有任何 timeScale 入口**；`Engine.renderFrame` 也不调 `vfx.beginFrame/endFrame`。目前全项目消费 `timeScale` 的只有 Gym 试验台和无头自检。
- 结论：正式循环里冰碎的 60ms 顿帧、大招的 80ms 顿帧都是空操作——闪光走 DOM 能出（如果 HUD 接了 `applyImpact`），但**世界不会停**，「咔嚓」的分量感直接损失一半。

**附带缺口（同属本项，必须一起修）**：

1. **慢放档缺失**。`ImpactDirector.timeScale` 是二值 0/1。VISUAL_BIBLE §6 裁决「慢放（波 3 冰碎首触发 0.5s 全局慢放）也从本入口走，与顿帧互斥期间以慢放为准」；§10.1 教学链是 M1 P0 验收项。需要给 `ImpactDirector` 加分数 timeScale（如 `requestSlowmo(scale, durationMs)`），并落实「与顿帧互斥」的裁决。
2. **相机震动无施加点**。`src/vfx/cameraShake.ts` 的 `computeShakeOffset()` 是现成的，但 `CameraRig` 的 `place()` 每次从锚点重算相机位置，没有外部偏移入口。震动事件全在 M2（自爆/大招/丢区），钩子本身应随本次主循环接线一起预留，振幅调参可延后。

**修法建议**：每帧顺序按 `VfxSystem` 文件头协议执行——`beginFrame(realDtMs)` 拿 `timeScale` → 固定步长累加器按 `realDt × timeScale` 进水 → `endFrame()` → 渲染。顿帧期间 `onRender` 照常跑（UI 闪光、相机、粒子上传都不能停），只停逻辑与粒子时钟（后者 `VfxSystem` 内部已处理）。

### 1.3 冰碎 → 战斗事件：桥不存在（→ R2-O3「向 VFX 发事件」+ R2-O4「冰碎实接」）

**现状证据**：

- 战斗侧弹药齐全：`src/combat/data/reactions.ts` 的 `ice_shatter` 行带完整 `impact: { vfx: 'fx_shatter', sfx: 'sfx_shatter_glass', hitstop: 60, flash: '#BFF7FF', tip: 'tip_shatter' }`；`combatSystem.ts` 会 emit `reaction_triggered`；`combo_first_seen` 事件也有（对应 §14.2 提示条）。
- VFX 侧弹药齐全：`vfx.play('ice-shatter', …)` 的演出内容对表 GDD 15.2（24 粒冰晶 + 霜痕贴花 3s + 顿帧 60ms + 白闪 1 帧，见 §4 峰值核算的例外项）。
- **中间没有任何桥**：全仓对 `reaction_triggered` 的唯一订阅在 `src/combat/scenarios.ts`——那是无头探针的报表收集，不是表现层。`src/vfx/README.md` 自己写着「combat/events.ts 的事件流**可以**直接桥到这里」——可以，但还没有。

**桥接时必须一并解决的三件事**：

1. **ID 三套并存**：VISUAL_BIBLE §4 登记 `vfx_ice_shatter`，战斗 ImpactSpec 用 `fx_shatter`，VFX 事件名是 `'ice-shatter'`。这是 R1 遗留「敌人 ID 三套并存」在 VFX 侧的复刻，且 Round 2 已拍板「规范 ID = data JSON，代码只许别名」。桥内做唯一映射表并登记进 INTEGRATION.md（R2-F1 辖区），禁止三处各自演化。
2. **坐标换算**：战斗事件带的是 `Vec2` 网格坐标，`vfx.play` 要世界 `Vec3`——桥要走 `engine/grid/coords.cellToWorld`，别在战斗层混进表现坐标。
3. **不许双发冲击**：`playIceShatter` 内部已 `ctx.impact.play(IMPACT_PRESETS.iceShatter)`；桥不要再把 ImpactSpec 里的 `hitstop/flash` 喂一遍 `ImpactDirector`，否则同一次冰碎请求两次顿帧（第二次会被节流器驳回并记进 rejected 统计，白白污染计数）。裁决：**冲击参数以 VFX 侧 `IMPACT_PRESETS` 为准**，战斗 ImpactSpec 的 hitstop/flash 字段仅作数据登记。

**同链路缺口（冰碎三重反馈 §10.1 逐环盘点）**：

| 环节 | 现状 | 判定 |
|---|---|---|
| 叠层（湿冷 + 表面高光上调） | 战斗逻辑有 `status_applied`；表现层无敌人网格、无「湿」材质行为 | [必须修]（随敌人表现层落地） |
| 冻结（冰壳着色器 + 12 霜花） | 霜花粒子有（`playFreeze`）；**冰壳着色器不存在**（§5.6 四着色器里只有引擎主材质路线在走，冰壳/溶解未开工） | [必须修] |
| 碎裂粒子/贴花/顿帧/白闪 | `playIceShatter` 完整，但见 §1.1/§1.2/§1.3 三处断链 | [必须修]（接线即通） |
| 音效「咔嚓」同帧 | **全项目没有音频系统**，`sfx_shatter_glass` 是纸面 ID。§10.1 验收「关画面仅听声音能确认碎裂」现状不可测 | [必须修]（M1 验收硬项；若 Round 2 排不下，需主调度显式改期，不许静默滑走） |
| 首触发教学链（慢放 + 图纸高亮 + 提示条） | 提示条组件有（`ComboToast`，含「每档案只弹一次」）；慢放缺（§1.2）；破碎锤图纸高亮缺 | [必须修] |

---

## 2. 其余 [必须修]（对照圣经逐条）

### 2.1 立法色违规（改动小，见效快，建议随手清）

- [ ] **金黄越界**：`effects.ts` `playHammerImpact` 的螺栓碎片用 `boost(PALETTE.coin, 1.2)`。金黄辖区 = 金币/赏金/波次奖励（prompts §2.1），锤击碎屑不是经济反馈。改暖白火花或焦褐（非发光）。
- [ ] **焦褐发光**：`EmissiveTestbed.buildPaletteProbes()` 给 `tar` 也做了自发光探针。焦褐「永不出现在 emissive 通道」是 §2 硬断言；测试台自己违法会让 T1/T3 审计截图永远带一个假阳性。改成哑光对照组（testbed 恰好缺一个「六色哑光对照」，一举两得）。
- [ ] **冰白常驻发光**：testbed 四角标记与核心顶盖用冰白 E1 级常驻自发光；冰白立法「仅事件瞬间」允许发光。角标改电青（网格对齐断言不受影响），核心顶盖改电青或撤。
  - 注：testbed 本就标注「真资产落地即删」，但它现在是唯一正式场景内容、是所有截图评审的画面来源，违法项会被当成合法先例抄走，故列必须修而非可延后。

### 2.2 M1 支撑效果缺口（VISUAL_BIBLE §10.5，垂直切片可见项优先)

`src/vfx/events.ts` 的事件契约只有 7 条（freeze / ice-shatter / condense-mist / hammer-impact / overload-start / overload-end / unit-death）。以下 M1 项**契约与实现双缺**，其中前四条在垂直切片第一屏就会露馅：

- [ ] 机枪曳光 `vfx_muzzle_tracer`（Tracer tile 已画好，没有效果函数）
- [ ] 通用命中火花 `vfx_hit_spark`（颜色随伤害源立法色）
- [ ] 油渍贴花 + 冒泡 `vfx_oil_decal`（`DecalTile.Oil` 已画好；焦油塔是 M1 四塔之一）
- [ ] 挖沟施工 `vfx_dig`（土块 + 进度环；`gameplay/EngineeringSystem` 目前不发任何表现事件——工程系统需要自己的事件出口，别让 vfx 反向 import gameplay）
- [ ] 湿状态 `vfx_wet_status`（滴水粒子 + 材质高光上调）
- [ ] 漏怪抢金币 `vfx_coin_steal`（金币飘字 UI 侧已有红/金跳字，世界空间金币流缺）
- [ ] 受击闪白 / 死亡溶解着色器（`playUnitDeath` 只有零件粒子占位；溶解是 §5.6 四着色器之一）

### 2.3 引擎—UI 接线（随 R2-O1 主循环）

- [ ] `Hud.applyImpact()` 没有正式调用方（demo 有）。主循环必须每帧把 `vfx.beginFrame()` 的返回值转给 HUD，否则冰碎白闪、丢区暗角全部不显示。
- [ ] `Hud` 与 `hudState` 目前只被 Gym demo 驱动。V-06「最小 HUD 正确」要求数据源为真实对局。

---

## 3. [可延后]（M2 起，或登记即可）

- **贴花图集缺警戒虚线条带**（`DecalTile` 只有油/霜/焦/电纹 4 tile）。丢区演出是 M2，届时补。
- **点光池未建**：`VfxBudget.dynamicLightCap` 有数字没有 `LightPool`。M1 效果表无点光需求（火场/超载点光全在 M2），届时按 §5.2 分配表实现「申请失败降级为加法面片」。
- **发射器计数语义**：`VfxBudget` 的 one-shot 计数是「本帧发射请求数」，圣经预算写的是「同屏活跃发射器」。GPU 环形池架构下一次性发射是 fire-and-forget，没有持续存在的发射器对象——语义差异对预算保护无害，但 T4 验收口径要在 VISUAL_BIBLE §5 登记清楚，防止 bench（R2-G2 接真计数）按错口径断言。
- **`vfx_hammer_impact` 的优先级**：现标 `VfxPriority.Event`（永不降级、绕过一次性上限）。圣经 §4.2 归它为「循环（攻击）」，§8 永不降级清单里没有它。高塔数压力下锤击碎屑会挤占真正的事件预算。降为 Persistent 一行改动，随下次动 `effects.ts` 时带上。
- **`EmissiveMask` 代理不拷贝贴图**：`syncProxy` 只同步颜色/混合参数，不带 `map`/`alphaMap`。当前全场材质无贴图所以零表现问题；**正式资产（统一色板贴图 + alpha 剪切）接入前必须补**，否则遮罩里出现实心黑剪影抠掉背后的辉光。在资产接入 checklist 里立哨。
- **SVG 滤镜辉光 vs 烘焙 glow 贴图**：储能环用 `feGaussianBlur` 实时滤镜（`ResourceRail`），圣经 §10.4 写的是烘焙九宫格 glow 贴图。「不依赖场景 Bloom」的目的已达成；若 HUD 帧成本在参照机超预算再换烘焙位图，先登记不返工。
- **半球补光未登记**：`Lighting` 用了 1 方向光 + 1 `HemisphereLight`（蓝天/棕地，强度 1.35）。补光低饱和、不进 Bloom，实质是灰盒必需的「让锈铁暗部可读」，但 prompts 负面清单有 "colored ambient light washes"，圣经 §9 只写了方向光。**登记进 VISUAL_BIBLE §9 并注明饱和度上限**，把它从「灰色地带」变成「立法许可」。
- **贴花/粒子渲染层级 vs 血条**：`renderOrder` 贴花 5、粒子 10，与 §7 层级表方向一致；但血条/状态图标环这一层还不存在（无敌人表现层）。敌人渲染落地时必须按 §7 表建立全局 sorting 纪律，禁止逐效果自调——先在这里立此存照。

---

## 4. 数值偏差登记（VISUAL_BIBLE §12：实施建议可调，但必须回写文档）

| 项 | 圣经值 | 代码现状 | 处置 |
|---|---|---|---|
| Bloom 架构 | §9 threshold 1.1（阈值法） | 双 composer 自发光遮罩法，`BLOOM.threshold = 0`（`engine/config.ts`） | **遮罩法更强**（albedo 物理上进不了 Bloom 输入），保留实现、**改写 §9** 为遮罩法条款，阈值语义改为「拒绝微弱自发光」 |
| 色调映射 | §9 Neutral | ACESFilmic（`renderer.ts` / Gym 同步） | 二选一后回写；注意 ACES 会压高光饱和，E3 档电青可能偏白，建议真机截图后拍板 |
| 冰碎峰值粒子 | §4.1 = 32 | 24 碎片 + 1 亮芯 + 1 环 + 14 霜屑 = **40** | 砍霜屑到 6 或把表改 40，二选一回写 §4.1 |
| 冻结峰值 | 12 | 12 霜花 + 1 收缩环 = 13 | 表改 13 或环并入霜花预算，回写 |
| 锤击峰值 | §4.2 = 12 | 1 环 + 10 尘土 + 6 螺栓 = 17 | 同上处理 |
| 死亡零件 | §4.2 = 6（4–6 粒） | 8 | 同上处理 |
| 震动振幅 | §1 轻 ≈0.15% / 中 ≈0.4% 屏高 | `SHAKE_AMPLITUDE` 0.35/1.0 × 0.012 ≈ 0.42%/1.2% | 超圣经约 3 倍，真机手感调参后回写；上限「中档 = 自爆」的立法未破 |
| 全屏闪去重 | §6 同 100ms 窗口去重（实施建议） | `requestFlash` 用「取当前 alpha 更高者」策略，无时间窗 | 效果近似（防叠加防闪瞎），确认后回写 §6 措辞 |
| 粒子图集变体数 | §10.6 冰晶×6 / 火花×4 / 软烟×2… | 程序化 SDF 图集：冰晶×3、尖刺×1、烟×1 等（`atlas.ts`） | 灰盒够用；美术图集接入时按 §5.4 布局补齐变体，tile 枚举协议已预留 |

---

## 5. 全局四测试（prompts §7.1）现状

| 测试 | 现状 | 缺什么 |
|---|---|---|
| T1 关灯 | 入口已有：DebugHud `B` 键切 `post.enabled`，testbed 自带锈铁对照组 | 粒子/贴花接入遮罩 pass（§1.1）后才有意义；截图归档流程未建 |
| T2 灰度 | 形状语言合规（图集冰=硬边多面体、电=尖刺、UI 图标同源，见 §6 亮点） | 无战斗画面可截；等垂直切片 |
| T3 色板 | 无自动化。VISUAL_BIBLE §2 的「编辑器校验脚本」三条断言一条都没落 | 建议落成 node 脚本进 `tests/`：扫 `effects.ts` 的 tint 是否全部引用 `PALETTE`、扫材质 emissive 是否立法色（§2.1 两条违规就是它该抓的） |
| T4 预算 | Gym 计数 HUD + 无头自检 13/13 + bench mock PASS；`VfxBudget.violations()` 已可供 bench 断言 | 真机 60fps 未验证（R1 遗留）；bench 接真计数归 R2-G2 |

---

## 6. 合规亮点（防止 Round 2 重复劳动，以下不要动）

- **调色板单一真源**：`vfx/palette.ts` 六立法色，UI `theme.ts` 直接引用；未发现散落硬编码立法色。
- **形状立法执行到位**：图集 tile（冰=硬边多面体×3、电=尖刺/十字辉、环=细/粗两档、火舌翻页 4 帧连号且是唯一翻页块）与 UI 图标（`icons.ts` 明写「轮廓贴着 ShapeLanguage 走，不用通用图标库」）同源。
- **冲击节流立法**：100ms 顿帧冷却「驳回不排队」、震动取最大档且注释点破「续时长 = 后门叠加」的坑；有统计口径（accepted/rejected/merged）供 Gym HUD。
- **UI 发光与 Bloom 解耦**：闪光/暗角走 DOM（`ImpactOverlay`，线性→sRGB 转换正确），供电条呼吸 1Hz、缺口警红闪、储能环 20 门槛刻度 + 满环脉冲——§10.4 的验收语义（数格子 = 数答案）全部在位。
- **GPU 粒子零逐帧 CPU**：出生属性一次写入、顶点着色器解析式演进、顿帧靠时钟冻结实现「画面级一致停格」；预算 `allow()` 对 combo/事件永远满额，符合「事件粒子永不降级」红线（V-03）。
- **降级阶梯**：D1–D4 顺序与 §8 一致，升降档带迟滞防抖。

---

## 7. 建议的 Round 2 修复顺序（依赖排序，非工期承诺）

1. 主循环实例化 `VfxSystem` + `Loop` 吃 `timeScale`（§1.2）——其余一切接线的宿主。
2. `PostPipeline` ↔ `setMaskPass` 挂钩（§1.1）——一并让 HUD 吃 `applyImpact`。
3. 战斗事件桥 + ID 映射表（§1.3）——先通 `ice_shatter`/`freeze`/`unit-death` 三条，垂直切片即可见。
4. `ImpactDirector` 慢放档 + 教学链三件套（§1.3 表）。
5. §2.1 三处立法色违规（半小时级改动，随任意 PR 捎带）。
6. §2.2 支撑效果按「第一屏可见」排：曳光 → 命中火花 → 油渍 → 挖沟。
7. §4 全表回写 VISUAL_BIBLE（文档即真源，不回写视为未完成）。

音频系统（§1.3 音效环）不在上述序列内：它是独立轨道，但 M1 验收把「三通道同帧」定为硬门槛，Round 2 收尾前必须有去向结论。
