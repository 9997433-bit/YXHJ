# 《余电》Last Watt

2.5D 斜俯视网格塔防。本目录是**游戏根目录**——所有代码、数据、测试都在 `games/last-watt/` 内，不外溢到仓库根。

设计正文：[`../../docs/GDD-余电.md`](../../docs/GDD-余电.md)（v1 已锁定，本工程按其裁决实现）。

---

## 快速开始

```bash
npm install && npm run dev
```

终端会打印本地地址（默认 <http://localhost:5173/>），浏览器打开即可看到运行中的引擎脚手架。

> 需要 **Node.js ≥ 20.19** 与支持 **WebGL2** 的浏览器（Chrome 56+ / Edge / Firefox 51+ / Safari 15+，且开启硬件加速）。
> 若 WebGL2 不可用，页面会显示中英文双语的启动失败面板与排查步骤，而不是一块黑屏。

### 全部脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 开发服务器，热更新 |
| `npm run build` | 生产构建到 `dist/`（相对 base，可直接静态托管） |
| `npm run preview` | 本地预览 `dist/` 构建产物 |
| `npm run typecheck` | `tsc --noEmit` 全量类型检查（不参与 dev/build 链路） |
| `npm run selfcheck` | VFX 层无头自检（17 项断言，不需要 GPU，可进 CI） |

试验台页面（Vite 下直接访问，不进生产构建）：

| 页面 | 看什么 |
|---|---|
| `/src/vfx/demo/index.html` | VFX Gym：只跑粒子与 HUD，不启动引擎；`?t=1.2` 定帧截图 |
| `/src/vfx/demo/integration.html` | 引擎接线：真 Engine + 后处理 + VFX + HUD，战斗事件由脚本假扮；`?t=2.8` 定帧截图 |

---

## 当前脚手架里有什么

Round 1 的引擎层交付（R1-O1），对应 GDD 第 15.1 节锁定的画面技术路线：

- **WebGL2 + Three.js**：显式申请 `webgl2` 上下文，拿不到就报错，绝不静默降级到 WebGL1。
- **斜俯视相机**：透视 **FOV 30°**、**俯角 55°**、偏航锁死、两档缩放；距离由「整块 20×12 网格铺满视口」反算，改窗口尺寸会自动重算。
- **20×12 网格**：锈铁地板按格分色（棋盘 + 每格确定性微扰），带格缝与边界线；`cellToWorld` / `worldToCell` 是全工程唯一的格↔世界坐标换算。
- **1 盏方向光**：固定方向、投影范围恰好覆盖棋盘，另加一盏极弱半球补光，防止背光面纯黑。无昼夜。
- **Bloom 只吃自发光**：见下节。
- **自发光测试体**：6 色调色板探针（各自坐在哑光锈铁基座上）、纯锈铁对照组、会呼吸的核心塔、四角对齐标记。
- **调试 HUD**：帧率 / 帧时 / DrawCall / 三角形 / 鼠标所在格 / 当前视图状态。

### 键位（调试用）

| 键 | 作用 |
|---|---|
| `Z` | 切换两档缩放 |
| `B` | 开关 Bloom（用来肉眼对照后处理前后） |
| `G` | 开关网格线 |
| `H` | 隐藏/显示调试 HUD |

---

## 「Bloom 只吃自发光」是怎么做到的

对 beauty pass 调高阈值做不到这件事——一块被方向光打亮的锈铁板同样会过阈值发光，画面就会糊成一片脏光。所以这里用两条 composer 链：

1. **遮罩链**：渲染前把场景里每个材质临时换成一个无光照代理，颜色 = 该材质的 `emissive × emissiveIntensity`，没有自发光通道的一律涂黑；这一帧的雾和背景也临时关掉。产物是一张纯自发光图，交给 `UnrealBloomPass` 模糊（半分辨率，反正是模糊）。
2. **主链**：渲染正常光照画面，把上面那张模糊图**加算**上去，最后 `OutputPass` 做 ACES 色调映射。

结果：锈铁地板亮到什么程度都不会发光，而自发光材质无论多暗都一定会发光。想验证就按 `B` 前后对比，或者看调色板探针与它脚下基座的分界。

个别材质需要例外时用 `material.userData.bloom`：

```ts
glowCardMaterial.userData.bloom = true;  // 没有 emissive 通道的加算光片，强制参与 Bloom
matteEmissiveMaterial.userData.bloom = false; // 有 emissive 但不许发光
```

**自己写着色器的对象要整个退出材质替换**，否则代理材质会丢掉它的顶点程序
（GPU 粒子会全部退回出生点），并且在遮罩图上画出一片实心黑方块：

```ts
import { skipBloomMask, hideFromBloomMask } from '@engine/index';

skipBloomMask(particleSystem.points); // 用自己的材质渲两个 pass，进不进 Bloom 由着色器自己决定
hideFromBloomMask(debugGizmo);        // 连同子树一起，从遮罩 pass 里消失
```

需要在遮罩 pass 里临时改自己状态（比如剔掉「被照亮但不发光」的那一层）的系统，
订阅 `engine.post.onMaskPass`：它在遮罩 pass 前后各发一次 `true` / `false`。

---

## 目录约定

```
games/last-watt/
├─ index.html          # 唯一入口，挂载 #lw-app，内联启动/失败面板
├─ vite.config.ts      # 相对 base，@engine 路径别名
├─ tsconfig.json
├─ src/
│  ├─ engine/          # ← 本文档描述的部分（引擎层）
│  │  ├─ boot.ts       #   入口：建引擎、挂 HUD、启动循环、兜底错误屏
│  │  ├─ Engine.ts     #   运行时宿主：场景 / 相机 / 光 / 后处理 / 循环
│  │  ├─ config.ts     #   全部锁定常量（网格、相机、调色板、光照、Bloom、步长）
│  │  ├─ index.ts      #   对外 API barrel —— 其他层只从这里 import
│  │  ├─ core/         #   渲染器、相机机位、定步长循环、Signal
│  │  ├─ grid/         #   网格坐标换算 + 棋盘表现
│  │  ├─ postfx/       #   自发光遮罩 + 双 composer Bloom
│  │  ├─ scene/        #   光照装配、自发光测试体
│  │  └─ debug/        #   开发者 HUD 与调试键位
│  ├─ gameplay/        # 网格逻辑、寻路、波次、地形改造
│  ├─ combat/          # 塔、敌人、状态与反应表
│  ├─ vfx/             # GPU 粒子战场语言
│  └─ ui/              # HUD
├─ data/               # 配表（TowerDef / EnemyDef / WaveDef / MapDef / ReactionRow）
├─ docs/               # 架构、视觉圣经、系统说明、验收清单
├─ tests/              # 自动化探针与单测
└─ bench/              # 帧时与粒子预算压测
```

## 接入引擎（给其他模块的约定）

```ts
import { Engine, cellToWorld, PALETTE } from '@engine/index';
```

- **只从 `@engine/index` 引用引擎**。没有导出的都是内部实现，会变。
- **逻辑写在 `onFixedUpdate` 里**：60 Hz 定步长，最多追 5 步，掉帧不会让模拟快进。
  表现写在 `onRender` 里，它带 `alpha`（距下一个逻辑步的插值系数）。

  ```ts
  const engine = new Engine(document.getElementById('lw-app')!);
  engine.onFixedUpdate(({ delta, tick }) => world.step(delta, tick));
  engine.onRender(({ alpha }) => view.interpolate(alpha));
  engine.start();
  ```

- **每帧协议**（顺序即契约）：

  ```
  onFrameBegin  真实 dt —— 唯一能改本帧 timeScale 的时机
  onFixedUpdate 按 dt·timeScale 推进；timeScale = 0 时一个 tick 都不跑
  onRender      表现层写状态（VFX 在这里结帧）
  onPresent     引擎绘制
  ```

  顿帧（冰碎那 60ms）就是把 `timeScale` 压到 0：模拟与粒子一起定住，帧率不掉。
  发起方是 VFX 的 `ImpactDirector`，接线只有一行，写在 `vfx/engineBridge.ts` 里：

  ```ts
  const bridge = attachVfxToEngine(engine, vfx, { onImpact: (s) => hud.applyImpact(s) });
  ```

  无头脚本用 `engine.loop.step(dt)` 驱动同一套协议，不需要 rAF。

- **格坐标**：`cell (col,row)` 的中心是 `((col+0.5), 0, (row+0.5))`，整块棋盘落在正象限 `x∈[0,20] z∈[0,12]`。别自己另算一套。
- **想让东西发光就给它 `emissive`**，不要靠调亮 `color`——后者不会进 Bloom，这是有意的。
- **颜色用 `PALETTE`**（GDD §15.2 的颜色立法），不要写字面量色值。
- **测试体是脚手架**：真实塔/敌人模型进来后删掉 `EmissiveTestbed` 即可，引擎其余部分不依赖它。
  也可以直接 `new Engine(container, { testbed: false })` 关掉。

## 已知的下一步

- 事件驱动 Vignette（丢区/大招染色）属于 VFX 层，不放在这条常驻后处理链上。
- 动态点光全局上限 8 盏的配额管理器尚未实现；当前只有 1 盏方向光 + 1 盏补光。
- 粒子预算计数器（GDD §15.3）由 VFX 层与 bench 侧共同落地。
