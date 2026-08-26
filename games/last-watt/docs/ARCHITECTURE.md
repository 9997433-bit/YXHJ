# 《余电》Last Watt — 工程架构（ARCHITECTURE.md）

> 责任代理:R1-F1(fable)。状态:**Round 1 拍板版,可开工**。
> 上游:`docs/GDD-余电.md` v1.0(设计唯一正文,已锁裁决不得推翻)。
> 效力边界:设计冲突以 GDD 为准;**代码组织、运行时选型、接口契约以本文为准**。
> 姊妹文档:`SYSTEMS.md`(R1-F3,系统细则+配表)、`VISUAL_BIBLE.md`(R1-F2)、`ACCEPTANCE.md`(R1-F4)。

---

## 0. 裁决摘要(一屏读完)

| # | 裁决 | 一句话 |
|---|---|---|
| D1 | **M1 运行时 = Three.js + WebGL2 + TypeScript + Vite** | 本环境无 Unity Editor(已验证),不空等;GDD 4.2 的 Unity URP 是发布版目标,15 章表现逐条映射见 §2 |
| D2 | **逻辑核纯 TypeScript,零 three.js/DOM 依赖** | 30Hz 固定步长 + 种子随机,可在 Node 无头跑 → tests/bench 直接驱动 |
| D3 | **单向数据流:Command → Sim → Event + Snapshot → 视图** | 视图(scene/vfx/ui/audio)只读快照、只听事件、只发命令 |
| D4 | **GPU 粒子 = Instanced 无状态粒子(顶点着色器闭式解)为主** | 预算沿用 GDD 15.3(≤20,000 粒 / ≤64 发射器);有状态特例见 §6.2 |
| D5 | **后处理 = `postprocessing` 库单 pass 合并**(Bloom 高阈值只吃自发光 + Vignette + ACES) | 对应 GDD 15.1「后处理三件套,没了」 |
| D6 | **HUD = DOM overlay;战场内信息 = 场景内 instanced quad** | 血条/状态环/射程圈在 3D 场景里,菜单/资源条走 HTML/CSS |
| D7 | **共享契约唯一来源 = `src/engine/contracts/`,内容以本文附录 B 为规范文本** | 并行代理照抄附录 B 起步,R2 合并去重 |
| D8 | **M1 = 图 1 灰盒前 10 波,`npm run dev` 即可玩** | 范围见 §8,验收细则归 ACCEPTANCE.md |

---

## 1. 运行时裁决:为什么是 Three.js + WebGL2

### 1.1 环境事实

- 云端构建环境**没有 Unity Editor**(`unity`/`unityhub`/`unity-editor` 均不存在),也无法在无头 Linux 容器里跑 URP 管线做逐帧调试。
- 环境有 **Node.js 22.14 + npm 10.9**,浏览器 WebGL2 是当下唯一能让 10 个并行代理**当天写、当天跑、当天测**的 3D 栈。
- GDD 第 19 章 M1 的验收核心是「冰碎能爽到」——粒子+音效+顿帧的反馈链、60fps、可试玩。这些在 Three.js + WebGL2 上全部可达,且逻辑层代码(见 D2)与渲染栈无关,未来迁 Unity 时按模块对照重写即可,设计与数值零返工。

### 1.2 与 GDD 4.2「Unity URP(锁定)」的关系

GDD 4.2 锁定的是**发布版**平台与引擎(Steam / 1080p60 / GTX 1060 红线)。本文不推翻它,做出的是**开发期运行时**裁决:

- M1–M2 垂直切片在 Three.js + WebGL2 上实现并验收玩法;
- GDD 已自带迁移条款(「Godot 4 有全部等价物」),本文把同样的对照关系扩展到 Three.js(§2 映射表);
- **逻辑核(gameplay/combat)不 import 任何渲染 API**,迁移成本被架构性地压在表现层。

### 1.3 技术栈清单(锁定)

| 项 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript(`strict: true`) | 全仓库无裸 JS |
| 构建 | Vite | `npm run dev` 热更 / `npm run build` 产物 |
| 渲染 | three(npm 最新稳定版,装机时锁进 lockfile) | 强制 WebGL2,WebGL1 直接弹错误页 |
| 后处理 | `postprocessing`(npm) | Bloom/Vignette/ToneMapping/SMAA 合并 pass,比 EffectComposer 多 pass 省带宽 |
| 单测 | Vitest | 逻辑核无头可测(D2 的直接红利) |
| UI | 无框架,原生 DOM + CSS | HUD 件少且静态结构固定,不引 React/Vue |
| 音频 | 原生 WebAudio | 事件音效表 + 双 stem 淡入淡出,首次点击解锁 autoplay |
| 存档 | localStorage | Profile 结构见 GDD 17.1,唯一跨局数据 |

---

## 2. Unity URP → Three.js/WebGL2 映射表(对照 GDD 第 15 章逐条)

| GDD 15 章条目 | Unity URP 原定实现 | Three.js/WebGL2 对应实现 |
|---|---|---|
| 低模网格 + 平面着色 + 统一色板 + 自发光遮罩 | URP Lit + Emission Mask | `MeshStandardMaterial`(`flatShading: true`)+ 统一色板贴图 + `emissiveMap`;自发光强度 >1 输出 HDR 供 Bloom 阈值提取 |
| 摄像机:透视 FOV 30°、俯角 55°、固定朝向、两档缩放 | Cinemachine 固定机位 | `PerspectiveCamera(fov=30)`,绕 X 轴 −55° 俯视棋盘中心,禁旋转;滚轮在两档 dolly 距离间切换 |
| GPU 粒子(VFX Graph,CPU 粒子零使用) | VFX Graph GPU 模拟 | `InstancedBufferGeometry` + 顶点着色器**闭式解**模拟(出生参数上传一次,位置=f(出生态, 当前时间),零逐帧 CPU 写入),见 §6 |
| 折线闪电(LineRenderer + 噪声) | LineRenderer | instanced quad-strip 折线 + 顶点着色器噪声抖动;与粒子同对象池 |
| Bloom(高阈值只吃自发光) | URP Bloom | `postprocessing.BloomEffect`,`luminanceThreshold ≈ 1.0`——只有 emissive HDR 像素过阈值,锈铁废土永不泛光 |
| 事件驱动 Vignette(丢区/大招染色) | URP Vignette | `VignetteEffect` 参数由 GameEvent 驱动做时间曲线动画 |
| 轻量色调映射 | URP Tonemapping | ACES Filmic(合入同一 postprocessing pass) |
| 抗锯齿 | URP MSAA | SMAA pass(与后处理同链,1080p 下代价可控) |
| 动态点光 ≤8 盏 + 加法混合伪光 | URP 点光预算 | `THREE.PointLight` 全局池 ≤8,超预算的「光」= `AdditiveBlending` 自发光面片(与 GDD 同策) |
| AO 烘焙进贴图 | 烘焙 lightmap/AO | `aoMap`(次 UV)或直接烤进色板贴图,运行时零实时 AO |
| 贴花(油渍/霜痕/焦痕/电纹/警戒线,≤64) | URP Decal Projector | **地表平贴 quad**(相机固定斜俯视、地面纯平,无需投影器),共用 512 atlas,超限淘汰最旧 |
| 4 个着色器:冰壳/溶解/水面滚动/自发光主材质 | Shader Graph | 4 个 `ShaderMaterial`(或 `onBeforeCompile` 注入);冰壳=材质整体替换,溶解=alpha 阈值+边缘自发光,水面=双层 UV 滚动 |
| 受击闪白 / 敌人材质切换 | 材质属性块 | per-instance uniform(InstancedMesh 自定义 attribute),不新建材质实例 |
| 顿帧/震动/闪光节流 | 自研 | 同自研:顿帧挂 Sim 时钟(§5.4),震动=相机偏移,闪光=全屏 quad;唯一入口在 `vfx/impact` |
| 对象池、预热 8–16 实例、运行期零 Instantiate | 自研 | 同自研:`engine/core/ObjectPool`,粒子发射器/闪电/贴花/敌人视图全部走池 |

**结论:GDD 第 15 章的每一条视觉立法在 WebGL2 上都有直接等价物,无一条需要降级设计。**

---

## 3. 目录公约(锁定,含 Round 1 所有权)

```text
games/last-watt/                  ← 游戏独占根,禁止向仓库根铺任何工程文件
├── index.html                    ← O1
├── package.json / package-lock.json / vite.config.ts / tsconfig.json   ← O1(根构建文件)
├── docs/                         ← 文档区(F1/F2/F3/F4 各自文件)
│   ├── ARCHITECTURE.md           ← 本文(F1)
│   ├── VISUAL_BIBLE.md           ← F2
│   ├── SYSTEMS.md                ← F3
│   └── ACCEPTANCE.md             ← F4
├── data/                         ← F3 独占:全部 JSON 配表(见 §7.3 清单)
├── src/
│   ├── main.ts                   ← O1:装配入口(仅组装,禁写玩法逻辑)
│   ├── sim.ts                    ← O1:Sim 聚合根(仅按 §5.3 顺序调度各系统)
│   ├── engine/                   ← O1 独占
│   │   ├── contracts/            ← 共享契约(规范文本=附录 B;唯一来源,见 §7.1)
│   │   ├── core/                 ← GameLoop(固定步长+插值)、Clock(含顿帧)、RNG、EventBus、ObjectPool
│   │   ├── render/               ← RendererCore、相机、灯光池、postprocessing 链
│   │   ├── scene/                ← 灰盒视图:BoardView / TowerView / EnemyView(读快照+事件)
│   │   ├── input/                ← 指针→格子拾取、命令封装与派发
│   │   ├── audio/                ← WebAudio 事件音效表、BGM 双 stem
│   │   ├── assets/               ← JSON/贴图/模型加载器
│   │   └── save/                 ← Profile 读写(localStorage)
│   ├── gameplay/                 ← O2 独占
│   │   ├── grid/                 ← Cell 数组、地形、涂层计时(油渍/火场)
│   │   ├── path/                 ← flow field(核心反向 BFS)、堵死校验、全量重算
│   │   ├── waves/                ← 波次生成器、乘区套用、下一波预览数据
│   │   ├── engineering/          ← 挖沟/搭桥:合法性校验、施工计时、次数管理
│   │   ├── economy/              ← 金币收支、供电上限校验、空闲供电→储能结算
│   │   ├── integrity/            ← 完整度扣分、阈值丢区(M2)、支路开启(M2)
│   │   └── session/              ← 单局状态机(部署/波中/波间/结算)、星级
│   ├── combat/                   ← O3 独占
│   │   ├── towers/               ← 索敌(首位/最强/对空)、开火、升级、过热
│   │   ├── enemies/              ← 沿 flow field 移动、飞行直线、拆/疗行为
│   │   ├── projectiles/          ← 机枪弹道(唯一弹道;喷雾/电弧即时判定)
│   │   ├── status/               ← 敌人标签:湿/油/湿冷层/冻/燃,互斥与计时立法
│   │   ├── reactions/            ← 数据驱动反应表执行器(4 combo 无 if-else)
│   │   └── abilities/            ← 电容站超载(M2)、大招主控过载(M2)
│   ├── vfx/                      ← O4 独占
│   │   ├── particles/            ← GPU 粒子池、BudgetGovernor(预算与降级阶梯)
│   │   ├── decals/               ← 贴花池(≤64,超限淘汰最旧)
│   │   ├── impact/               ← 顿帧/震动/闪光统一节流入口
│   │   └── bindings/             ← GameEvent → 特效绑定表(声明式)
│   └── ui/                       ← O4 独占
│       ├── hud/                  ← 顶部波次/预览、左上资源纵列、底部建造菜单、右下按钮
│       ├── panels/               ← 塔面板(升级/优先级/卖出)、电容站面板
│       ├── world/                ← 场景内:血条、状态图标环、射程圈、施工进度环
│       └── toasts/               ← combo 一次性提示条、老周电台气泡
├── tests/                        ← G1 独占(Vitest;逻辑核无头直测)
└── bench/                        ← G2 独占(无头 sim 压测 + 浏览器指标钩子消费)
```

**硬规则**

1. 每个代理只在自己独占目录写文件;跨目录需求走 §7 契约,不直接改别人的文件。
2. `src/main.ts` / `src/sim.ts` 是仅有的两个 src 根文件,归 O1,只做装配与调度,出现任何玩法 if-else 即违规。
3. 资产(贴图/音频/模型)放 `games/last-watt/public/assets/`(O1 建目录;M1 灰盒期资产极少,由使用方代理各自放入自己命名空间子目录,如 `public/assets/vfx/`)。

---

## 4. 分层与依赖规则(锁定)

```text
           ┌───────────────────────────────────────────┐
           │   contracts(纯类型+常量,零依赖)          │
           └───────────────────────────────────────────┘
                ▲            ▲             ▲
   ┌────────────┴──┐   ┌─────┴─────┐   ┌───┴────────────────┐
   │ engine/core   │◄──┤ gameplay  │◄──┤ combat             │
   │ (EventBus,RNG,│   │(网格/寻路/ │   │(塔/敌/状态/反应)   │
   │  Clock,Pool)  │   │ 经济/波次) │   │ 只读 gameplay 查询 │
   └───────────────┘   └───────────┘   └────────────────────┘
                ▲             ▲              ▲
                │       ┌─────┴──────────────┴─────┐
                │       │ sim.ts(聚合根,O1 装配) │ ← 逻辑核边界,以上全部无 three/DOM
                │       └──────────────────────────┘
                │                    │ Command 入 / Event + Snapshot 出
   ┌────────────┴────────────────────▼─────────────────────┐
   │ 表现层:engine/render + engine/scene + engine/audio   │
   │         vfx/** + ui/**(只读快照、只听事件、只发命令)│
   └───────────────────────────────────────────────────────┘
```

允许的 import 方向(白名单,其余全部禁止):

| 模块 | 可以 import |
|---|---|
| `engine/contracts` | (无) |
| `engine/core` | contracts |
| `gameplay/**` | contracts, engine/core |
| `combat/**` | contracts, engine/core, gameplay(仅查询接口:格子查询、flow field 采样、经济扣款) |
| `sim.ts` | contracts, engine/core, gameplay, combat |
| `engine/render|scene|input|audio|assets|save` | contracts, engine/core, three, DOM |
| `vfx/**`, `ui/**` | contracts, engine/core, engine/render, three, DOM |
| `main.ts` | 一切(装配) |
| `tests/**`, `bench/**` | contracts, engine/core, gameplay, combat, sim(无头);bench 另可读浏览器指标钩子 |

**红线:`gameplay/**` 与 `combat/**` 任何文件 import `three` 或触碰 `document`/`window` 即架构违规**(G1 应写一条静态扫描测试盯死这条)。

---

## 5. 模块边界与数据流(GDD 17.2 十四系统 → 文件落位)

### 5.1 十四系统落位表

| # | GDD 17.2 系统 | 落位目录 | Owner | 里程碑 |
|---|---|---|---|---|
| 1 | 网格与地形 | `gameplay/grid/` | O2 | M1 |
| 2 | 寻路(flow field) | `gameplay/path/` | O2 | M1 |
| 3 | 波次生成器 | `gameplay/waves/` | O2 | M1 |
| 4 | 战斗(索敌/判定/弹道) | `combat/towers/` `combat/enemies/` `combat/projectiles/` | O3 | M1 |
| 5 | 状态与反应系统 | `combat/status/` `combat/reactions/` | O3 | M1(冰碎全链) |
| 6 | 经济与电力 | `gameplay/economy/` | O2 | M1 |
| 7 | 工程操作 | `gameplay/engineering/` | O2 | M1(挖沟;搭桥 M2) |
| 8 | 大招与超载 | `combat/abilities/` | O3 | M2 |
| 9 | 完整度与区域 | `gameplay/integrity/` | O2 | M1 扣分;丢区 M2 |
| 10 | UI | `ui/**` | O4 | M1 最小 HUD |
| 11 | 关卡数据 | `data/**`(配表)+ `engine/assets`(加载) | F3 / O1 | M1(图 1) |
| 12 | VFX 系统 | `vfx/**` | O4 | M1(冰碎链+预算器) |
| 13 | 音频 | `engine/audio/` + `data/audio-events.json` | O1 / F3 | M1(≥5 条) |
| 14 | 存档与关卡流程 | `engine/save/` + `gameplay/session/` | O1 / O2 | M1 最小(Profile 读写) |

### 5.2 数据流(唯一模式)

```text
DOM 输入 ──► engine/input ──► PlayerCommand 队列
                                    │  (tick 边界统一消费)
                                    ▼
                  Sim(30Hz 固定步长,纯 TS,种子随机)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        GameEvent 流         StateSnapshot          tests / bench
     (发生即广播,当帧消费)   (每 tick 发布,只读)     (直接驱动 Sim,无头)
              │                     │
     ┌────────┼────────┬────────┐   │
     ▼        ▼        ▼        ▼   ▼
    vfx    audio   scene(灰盒) ui(HUD+面板)   ← 每帧 rAF:用最近两份快照按 alpha 插值渲染
```

- **命令**:视图层永远不直接改 Sim 状态;一切玩家操作封装为 `PlayerCommand`(附录 B),Sim 在 tick 边界校验执行,非法命令广播 `command_rejected`(UI 驳回音效即听此事件)。
- **事件**:一次性事实(「冰碎发生在 (x,y)」),VFX/音频/提示条全靠事件,**事件里带齐渲染所需上下文,视图不得回查 Sim 内部**。
- **快照**:持续状态(血量、金币、位置),UI 与灰盒视图逐帧拉取;视图保留最近两份快照,按 `alpha = accumulator/dt` 插值敌人位置,30Hz 逻辑照样渲染出 60fps 顺滑移动。

### 5.3 tick 内系统更新顺序(锁定,确定性依赖此序)

1. 消费命令队列(建造/卖出/挖沟/开波/超载…)
2. 地形计时(施工进度、油渍/火场剩余时间)
3. 波次生成器出怪
4. 敌人移动与行为(拆迁蟹索塔、治疗光环、飞行直线)
5. 塔索敌与开火 → 伤害与状态施加
6. 反应表结算(冰碎/油火/导电/超载增益)
7. 死亡与漏怪结算 → 赏金、扣完整度、抢金币
8. 电力结算(供电占用校验、空闲供电 → 储能 +0.25/点/秒)
9. 清理、发布 GameEvent 批与 StateSnapshot

### 5.4 顿帧(hitstop)的架构位置

顿帧**冻结 Sim 累加器与粒子时间,不冻结渲染**:`engine/core/Clock` 提供 `hitstop(ms)`;唯一调用方是 `vfx/impact`(节流立法:100ms 内最多 1 次、震动取最大档,同 GDD 15.2)。逻辑核自身永不调用顿帧——它是表现,不是规则。

### 5.5 确定性与随机

- `engine/core/RNG`:mulberry32,按流命名(`rng.wave`、`rng.combat`、`rng.vfx`);Sim 只用前两条,`rng.vfx` 供表现层,互不污染。
- 同种子 + 同命令序列(含 tick 编号)⇒ 同结果。G1 用「录制命令回放」做回归;G2 用它做无头压测。

---

## 6. GPU 粒子系统设计(vfx 的架构约束)

### 6.1 主方案:无状态 instanced 粒子

- 每类效果一个 `InstancedBufferGeometry` 池:实例属性 = 出生时间、出生位置、初速、寿命、尺寸曲线参数、颜色索引(指向 12 材质图集)。
- 顶点着色器闭式解:`pos = birth + v0·t + ½g·t²`(+旋转/尺寸/透明度曲线),**CPU 每帧零写入**,发射时只写一段环形缓冲。
- 覆盖粒子语言表(GDD 15.2)中除「金币吸附流」外的全部条目:冰晶炸裂、火舌翻页、电火花、尘土、蒸汽、扩散环全部是闭式可解的。
- 预算硬编码为常量(附录 B `VFX_BUDGET`):总量 ≤20,000、发射器 ≤64(循环 ≤24 / 一次性 ≤40)、材质 ≤12(单张 1024 图集)、贴花 ≤64。`BudgetGovernor` 按「事件 > combo > 环境氛围」丢弃,降级阶梯照 GDD 15.3,**事件类 combo 粒子永不降级**。

### 6.2 有状态特例(唯一豁免)

「漏怪抢金币」需要粒子吸附到移动敌人(閉式解无法表达追踪)。裁决:**8 粒/次的小规模 CPU 模拟**(位置逐帧写 instance attribute)。粒子量个位数,不值得为它上 FBO ping-pong;若 M3 压测证明需要,再由 vfx 内部升级实现,接口不变。

### 6.3 WebGL2 边界的明示

WebGL2 无 compute shader。本设计**不依赖** compute:闭式解在顶点阶段完成,transform feedback / ping-pong 都不是 M1 依赖项。这是选无状态方案的根本原因,写明防止后来者「顺手」引入有状态大粒子系统。

---

## 7. 与其他 Round 1 代理的接口契约

### 7.1 契约的唯一来源

- 规范文本 = **本文附录 B**(TypeScript,可直接照抄成文件)。
- 代码落位 = `src/engine/contracts/`(O1 建立,内容必须与附录 B 一致;发现分歧以附录 B 为准并回改代码)。
- Round 1 并行期:任何代理若在 O1 落地前需要类型,**逐字复制附录 B 到自己目录下的 `_contracts_mirror.ts`**(前缀下划线),R2 合并时删除镜像、统一 import `engine/contracts`。禁止自创同义类型。

### 7.2 各代理的供给/消费矩阵

| 代理 | 供给(别人依赖你什么) | 消费(你依赖别人什么) |
|---|---|---|
| **O1 engine** | GameLoop/Clock/EventBus/RNG/ObjectPool;渲染核+后处理链;灰盒视图;输入→命令;音频事件表播放器;`contracts/` 落地;`main.ts`/`sim.ts` 装配 | gameplay/combat 的系统注册接口(附录 B `SimSystem`);F3 的 JSON 路径与结构 |
| **O2 gameplay** | 格子查询(`GridQuery`)、flow field 采样(`PathQuery`)、经济扣款/校验(`EconomyApi`)、波次预览数据(进快照) | contracts;engine/core;F3 的 `maps/ waves.json` 等配表 |
| **O3 combat** | 敌人/塔的全部战斗事实(事件+快照字段);状态与反应结算 | contracts;engine/core;O2 的 GridQuery/PathQuery/EconomyApi;F3 的 `towers/enemies/reactions.json` |
| **O4 vfx+ui** | 玩家全部操作入口(HUD→命令);战场信息呈现;冰碎反馈链的粒子/顿帧/闪白 | contracts(事件+快照+命令);engine/render;F2 的色板/形状立法;`data/` 中 UI 相关字段(造价/角标) |
| **F3 data** | 全部 JSON 配表 + `SYSTEMS.md` 数值细则 | 本文附录 B 的 `*Def` 类型与 §7.4 canonical ID(字段名与 ID 必须一致) |
| **G1 tests** | 回归安全网(flow field/反应表/经济/冻结时序/import 白名单静态扫描) | sim.ts 聚合根、contracts、F3 配表 |
| **G2 bench** | 无头 tick 压测、粒子预算计数断言 | sim.ts;O4 暴露的浏览器指标钩子(§7.5) |

### 7.3 F3 配表文件名(锁定,O1 加载器与 O2/O3 按此读取)

```text
data/towers.json        data/enemies.json      data/waves.json(20 波基础表)
data/maps/map1.json     data/maps/map2.json    data/maps/map3.json
data/reactions.json     data/upgrades.json     data/audio-events.json
data/tutorial.json(前 5 波脚本化节拍)
```

### 7.4 Canonical ID 注册表(锁定;配表、代码、事件、测试全用这套 snake_case ID,中文名只进显示字段)

- **塔**:`rivet_gun` 铆钉机枪 · `tar_sprayer` 焦油喷洒器 · `hydraulic_crusher` 液压破碎锤 · `condenser` 冷凝喷射塔 · `flamethrower` 火焰喷射塔 · `tesla_coil` 特斯拉线圈 · `capacitor` 电容站 · `generator` 发电机
- **敌人**:`scavenger` 拾荒虫 · `rat_swarm` 疾行鼠群 · `armored_hauler` 装甲运输车 · `scout_wasp` 侦察蜂 · `blast_sapper` 爆破工兵(拆迁蟹) · `repair_drone` 修理无人机 · `repair_mothership` 修理母舰 · `leviathan` 利维坦
- **敌人行为**:`normal` / `demolish` / `heal`(+ 独立布尔 `is_flying`)
- **状态标签**:`wet` 湿 · `oil` 油 · `chill` 湿冷层(带 stacks) · `frozen` 冻 · `burning` 燃(互斥立法见 GDD 7.2,由 `combat/status` 执行)
- **格子地形**:`road` 路面 · `foundation` 地基 · `soft_earth` 软土 · `ravine` 沟壑 · `water_surface` 水面;路面变体标志:`is_puddle`(水洼)、`is_diggable`(可挖路段);涂层:`none` / `oil` / `fire`
- **combo**:`shatter` 冰碎 · `oil_fire` 油火 · `conduct` 导电 · `overload` 超载
- **索敌优先级**:`first` 首位 / `strongest` 最强 / `air_first` 对空

### 7.5 G2 浏览器指标钩子(O4/O1 实现,G2 消费)

`window.__lastWatt.metrics` 每秒刷新:`{ fps, frameMsP95, drawCalls, particlesAlive, emittersLoop, emittersOneShot, decals, pointLights, budgetDrops }`。G2 的压测断言全部读此对象,不摸内部实现。

### 7.6 坐标与单位立法(所有代理必须一致)

- 网格 20×12:`x ∈ [0,19]` 向东,`y ∈ [0,11]` 向屏幕下方;格边长 = 1.0 世界单位。
- 三维映射:格子 `(x, y)` → 世界 `(x + 0.5, 0, y + 0.5)`(取格中心;three.js Y 轴向上)。
- Sim 内位置一律「格坐标浮点」(如 `{x: 3.75, y: 2.0}`),表现层负责换算世界坐标。
- 时间单位一律**秒**(浮点),tick 步长 `1/30` 秒;伤害/金币为整数。

---

## 8. M1 垂直切片:最小可运行定义

### 8.1 一句话定义

**`npm install && npm run dev` 打开浏览器,能在图 1 灰盒上用 4 塔 + 发电机打完前 10 波,冰碎的看+听+顿帧反馈链完整,挖沟可用,漏怪扣完整度。**

### 8.2 范围(照 GDD 19 章 M1 展开成工程条目)

| 条目 | M1 内容 | 明确不做(M2+) |
|---|---|---|
| 地图 | `map1.json` 灰盒:20×12、1 出怪口(波 10 开第 2 口)、核心、地形四类可见区分(纯色材质即可) | 图 2/3;变电区丢区;水洼导电考核 |
| 塔 | `rivet_gun` / `tar_sprayer` / `condenser` / `hydraulic_crusher` + `generator`,数值照 GDD 7.1 | `flamethrower` / `tesla_coil` / `capacitor`;升级二选一;索敌优先级切换 |
| 敌人 | `scavenger` / `rat_swarm` / `armored_hauler`(护甲 −5/击)+ `scout_wasp`(直线飞,机枪可打) | 拆/疗行为;两 Boss |
| combo | **冰碎全链**:0.5s/层 ×3 → 冻 2s(解冻后免疫 3s)→ 单发 ≥40 → 250% + 1 格溅射无视护甲;首次触发全局慢放 0.5s + 提示条 | 油火(油标签存在但无火塔)、导电、超载 |
| 电力 | 供电上限 8 + 发电机 +6;塔常驻占电;空闲供电 → 储能 +0.25/点/秒(储能有数值有 UI 环,尚无消耗方) | 电容超载、大招 |
| 工程 | 挖沟:50 金 / 3s 施工 / 配额 3 / 堵死校验红禁;flow field 全量重算 | 搭桥;炸桥;补发次数 |
| 完整度 | 100 点;漏怪按表扣 + 抢 10 金演出;≤0 Game Over;撑过波 10 出临时结算屏 | 丢区两档、波间修复、星级 |
| VFX | 冰碎(24 粒冰晶 + 霜痕贴花 + 60ms 顿帧 + 白闪)、冷凝雾、冻结冰壳、油渍贴花、机枪曳光、死亡溶解、金币飞行流;BudgetGovernor 上线 | 全套粒子语言表其余条目按 M2/M3 排 |
| 音频 | ≥5 条:放置确认、机枪循环、冻结、**冰碎玻璃咔嚓**、金币入账(首次点击解锁 WebAudio) | 24 条全量、BGM、老周语音 |
| UI | 顶部波次+下一波预览+开波按钮;左上金币/供电/储能/完整度;底部 5 建造项(占电/对空角标、缺电灰显);挖沟按钮(剩余角标);点塔显示射程圈+卖出;combo 提示条 | 升级面板、大招按钮、修复按钮、电容面板 |
| 教学 | 不做脚本化教学(GDD 11 章的波 1–5 节拍属 M2);但波次解锁建造项由 `tutorial.json` 数据驱动,M1 只用「逐波解锁图纸」这一层 | 老周气泡、免费挖沟赠送、慢放高亮图纸 |

### 8.3 「可运行」的工程判据(供 F4 细化验收)

1. `npm install && npm run dev` 一条链跑通,冷启动到可交互 <3s(本地)。
2. `npm test`(Vitest)绿:至少覆盖 flow field 重算与堵死校验、反应表(冻结→碎裂时序、免疫窗)、经济(占电校验、储能充速)、漏怪结算。
3. `npm run bench:headless`:1000 tick × 波 8–10 出怪压力,单 tick 均值 <3ms(逻辑核,Node 环境)。
4. 浏览器 60fps@1080p(GTX 1060 级),`__lastWatt.metrics` 全程不超 §6.1 预算。
5. 同种子同命令回放,快照哈希一致(确定性判据)。

---

## 9. 未决风险(Round 1 无法闭合,登记给主调度)

| # | 风险 | 影响 | 缓解/责任 |
|---|---|---|---|
| R1 | WebGL2 selective bloom 链路(emissive HDR >1 + 阈值 1.0)在低端卡上的实际观感与代价未验证 | D5 可能需调整为 mask-based selective bloom | O4 在 M1 内做一次 A/B,结论回写 VISUAL_BIBLE |
| R2 | 并行代理在 contracts 落地前各自镜像,存在漂移窗口 | 合并冲突/类型分裂 | 附录 B 为唯一规范;R2 合并首个动作=删镜像统一 import;G1 加静态扫描 |
| R3 | 金币吸附粒子的 CPU 特例若被滥用成惯例,粒子架构会退化 | 60fps 红线 | §6.2 写死「唯一豁免」;G2 压测断言 CPU 粒子数 <64 |
| R4 | 发布版 Unity 迁移的启动时点与人力未拍板(GDD 4.2 锁 Unity URP,web 栈是否可作为最终发布栈超出 R1-F1 权限) | M3 后可能出现双栈维护 | 登记给主调度;逻辑核纯 TS 已把迁移面压到表现层 |
| R5 | 30Hz tick 下 0.5s/层叠冻(15 tick)与 60ms 顿帧(非 tick 整数倍)的取整口径,若各写各的会出现 ±1 tick 手感漂移 | combo 手感 | 立法:时长一律向上取整到 tick;顿帧属渲染时钟不参与取整(§5.4);F3 在 SYSTEMS.md 落数值时引用此条 |

---

## 附录 A:M1 依赖清单(package.json 基线,O1 落地)

```jsonc
{
  "dependencies": { "three": "^0.1xx(装机时锁 lockfile)", "postprocessing": "^6.x" },
  "devDependencies": { "typescript": "^5.x", "vite": "^6.x", "vitest": "^3.x", "@types/three": "匹配 three 版本" },
  "scripts": {
    "dev": "vite", "build": "vite build", "preview": "vite preview",
    "test": "vitest run", "bench:headless": "vitest bench --run"
  }
}
```

## 附录 B:共享契约规范文本(`src/engine/contracts/`,可逐字落盘)

> 落盘文件:`ids.ts` / `data.ts` / `commands.ts` / `events.ts` / `state.ts` / `budget.ts`。
> Round 1 镜像规则见 §7.1。字段以此为准;新增字段需在本附录先行登记(R2 起走合并评审)。

```ts
// ─── ids.ts ───────────────────────────────────────────────
export type TowerId =
  | "rivet_gun" | "tar_sprayer" | "hydraulic_crusher" | "condenser"
  | "flamethrower" | "tesla_coil" | "capacitor" | "generator";
export type EnemyId =
  | "scavenger" | "rat_swarm" | "armored_hauler" | "scout_wasp"
  | "blast_sapper" | "repair_drone" | "repair_mothership" | "leviathan";
export type StatusId = "wet" | "oil" | "chill" | "frozen" | "burning";
export type TerrainId = "road" | "foundation" | "soft_earth" | "ravine" | "water_surface";
export type CoatingId = "none" | "oil" | "fire";
export type ComboId = "shatter" | "oil_fire" | "conduct" | "overload";
export type TargetPriority = "first" | "strongest" | "air_first";
export type EnemyBehavior = "normal" | "demolish" | "heal";

// ─── data.ts(F3 配表结构;字段名与 JSON 一致)──────────
export interface CellCoord { x: number; y: number }           // 0..19 / 0..11
export interface TowerDef {
  id: TowerId; name_cn: string; cost: number; power_cost: number;
  range: number; damage: number; fire_interval: number;
  targets_air: boolean; tags: string[]; upgrades: [UpgradeRef, UpgradeRef] | [];
}
export interface UpgradeRef { id: string; name_cn: string; cost: number }
export interface EnemyDef {
  id: EnemyId; name_cn: string; hp: number; speed: number; armor: number;
  bounty: number; integrity_damage: number; is_flying: boolean; behavior: EnemyBehavior;
}
export interface WaveSpawn { enemy_id: EnemyId; count: number; interval: number; gate_id: string }
export interface WaveDef { wave_no: number; spawns: WaveSpawn[]; reward: number; unlocks?: TowerId[] }
export interface MapDef {
  id: string; grid: CellDef[][]; gates: GateDef[]; core: CellCoord;
  zones: ZoneDef[]; dig_quota: number; bridge_quota: number;
  wave_multipliers: { hp: number; weight_air_heal: number; weight_demolish: number };
}
export interface CellDef {
  terrain: TerrainId; is_puddle?: boolean; is_diggable?: boolean; zone_id?: string;
}
export interface GateDef { id: string; cell: CellCoord; opens_at_wave: number }
export interface ZoneDef { id: string; cells: CellCoord[]; power_penalty: number }
export interface ReactionRow {
  id: ComboId; trigger_source: string; required_status: StatusId;
  effect: Record<string, number | string | boolean>;   // 细则由 SYSTEMS.md 定义
}

// ─── commands.ts(视图 → Sim 的唯一写入通道)─────────────
export type PlayerCommand =
  | { kind: "build_tower"; defId: TowerId; cell: CellCoord }
  | { kind: "sell_tower"; towerUid: number }
  | { kind: "upgrade_tower"; towerUid: number; branch: 0 | 1 }        // M2
  | { kind: "set_priority"; towerUid: number; priority: TargetPriority } // M2
  | { kind: "dig"; cell: CellCoord }
  | { kind: "bridge"; cell: CellCoord }                                // M2
  | { kind: "start_wave"; early: boolean }
  | { kind: "repair_core" }                                            // M2
  | { kind: "capacitor_overload"; towerUid: number }                   // M2
  | { kind: "fire_ultimate" };                                         // M2

// ─── events.ts(Sim → 视图;事件自带渲染上下文)──────────
export type GameEvent =
  | { kind: "command_rejected"; command: PlayerCommand; reason: string }
  | { kind: "wave_started"; waveNo: number }
  | { kind: "wave_ended"; waveNo: number; reward: number }
  | { kind: "gate_opened"; gateId: string }
  | { kind: "enemy_spawned"; uid: number; defId: EnemyId; gateId: string }
  | { kind: "enemy_damaged"; uid: number; amount: number; sourceTower?: TowerId; pos: CellCoord }
  | { kind: "enemy_died"; uid: number; defId: EnemyId; bounty: number; pos: CellCoord }
  | { kind: "enemy_leaked"; uid: number; defId: EnemyId; integrityDamage: number; goldStolen: number }
  | { kind: "tower_built"; uid: number; defId: TowerId; cell: CellCoord }
  | { kind: "tower_sold"; uid: number; refund: number }
  | { kind: "tower_fired"; uid: number; defId: TowerId; targetUid?: number; muzzle: CellCoord }
  | { kind: "status_applied"; uid: number; status: StatusId; stacks: number }
  | { kind: "status_expired"; uid: number; status: StatusId }
  | { kind: "reaction_triggered"; combo: ComboId; uid: number; pos: CellCoord;
      damage?: number; splashCells?: CellCoord[]; firstTimeThisProfile: boolean }
  | { kind: "coating_changed"; cell: CellCoord; coating: CoatingId; duration: number }
  | { kind: "construction_started"; op: "dig" | "bridge"; cell: CellCoord; duration: number }
  | { kind: "construction_completed"; op: "dig" | "bridge"; cell: CellCoord }
  | { kind: "path_recomputed" }
  | { kind: "gold_changed"; gold: number; delta: number; reason: string }
  | { kind: "power_changed"; used: number; cap: number }
  | { kind: "battery_changed"; value: number }
  | { kind: "integrity_changed"; value: number; delta: number }
  | { kind: "zone_lost"; zoneId: string }                              // M2
  | { kind: "overload_started"; capacitorUid: number; towerUids: number[] } // M2
  | { kind: "overload_ended"; capacitorUid: number }                   // M2
  | { kind: "ult_charged"; charges: number }                           // M2
  | { kind: "ult_fired" }                                              // M2
  | { kind: "game_over"; waveNo: number; worstGateId: string }
  | { kind: "victory"; integrity: number; stars: 1 | 2 | 3 };

// ─── state.ts(每 tick 发布;视图保留两份做插值)──────────
export interface TowerSnap {
  uid: number; defId: TowerId; cell: CellCoord; level: 0 | 1;
  powered: boolean; overheatLeft: number; priority: TargetPriority;
}
export interface EnemySnap {
  uid: number; defId: EnemyId; pos: { x: number; y: number };  // 格坐标浮点
  hp: number; maxHp: number; statuses: { id: StatusId; stacks: number; timeLeft: number }[];
}
export interface WavePreviewEntry { enemyId: EnemyId; count: number; gateId: string }
export interface GameStateSnapshot {
  tick: number; time: number;
  phase: "deploy" | "wave" | "interwave" | "result";
  gold: number; powerCap: number; powerUsed: number; battery: number;
  integrity: number; waveNo: number; ultCharges: number;
  digLeft: number; bridgeLeft: number;
  towers: TowerSnap[]; enemies: EnemySnap[];
  nextWavePreview: WavePreviewEntry[];
  dirtyCells: { cell: CellCoord; def: CellDef; coating: CoatingId }[]; // 仅本 tick 变化的格
}

// ─── budget.ts(VFX 预算常量,G2 断言引用)────────────────
export const VFX_BUDGET = {
  maxParticles: 20_000, maxEmitters: 64, maxLoopEmitters: 24, maxOneShotEmitters: 40,
  maxParticleMaterials: 12, maxDecals: 64, maxPointLights: 8, maxCpuParticles: 64,
  hitstopWindowMs: 100,
} as const;

// ─── Sim 装配接口(O1 sim.ts 按 §5.3 顺序调度)────────────
export interface SimSystem { readonly name: string; tick(dt: number): void }
```

## 附录 C:GDD 校准索引(写代码前先读哪几节)

| 你是 | 必读 GDD 章节 |
|---|---|
| O1 | 15.1(相机/灯光/后处理)、15.3(预算)、16(音频)、13(存档) |
| O2 | 5(地图/改路/寻路)、6(经济)、10(完整度)、12(节奏) |
| O3 | 7(塔/combo/标签立法)、8(敌人)、9(大招)、17.1(数据结构) |
| O4 | 14(UI 信息架构)、15.2(粒子语言表)、15.3(降级阶梯) |
| F3 | 17.1、18.4(配表清单)、6/7/8 全部数字 |
| G1/G2 | 19(M1/M2 验收)、20(红线)、15.3(预算数字) |

---

*本文为 Round 1 拍板版。修订走 R2 合并评审;附录 B 的任何字段变更必须同步改此文与 `engine/contracts/`。*
