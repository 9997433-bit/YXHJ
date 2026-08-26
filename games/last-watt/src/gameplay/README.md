# `src/gameplay` — 网格 / 寻路 / 工程操作 / 波次

R1-O2 独占子树。对应 GDD §5（地图与改路）、§8.3（波次乘区）、§17.2 模块 1/2/3/7。

**本模块拥有**：棋盘与地形、地面寻路、挖沟/搭桥合法性与施工、变电区断电与闸门支路、波次时间表。

**本模块不拥有**：塔与敌人实体、格子涂层（油/火，归 `src/combat`）、金币/电力/核心完整度（经济系统）、渲染（`src/engine`、`src/vfx`）。这些系统通过下文的钩子和事件与本模块交互，本模块从不反向调用它们。

---

## 30 秒上手

```ts
import { createGameplayWorld, MAP1_POWERHOUSE } from '@/gameplay';

const world = createGameplayWorld({
  map: MAP1_POWERHOUSE,
  getGold: () => wallet.gold, // 只用于把「金币不足」写进 check 结果，钱包仍归经济系统
});

world.events.on('wave_spawn', (request) => combat.spawn(request));
world.events.on('flow_field_rebuilt', () => renderer.refreshPaths());

world.startWave({ early: false });

// 固定步长（engine SIM.fixedDelta = 1/60）
world.tick(1 / 60);
```

`GameplayWorld` 只是把四个子系统接线在一起的门面，`Grid` / `EngineeringSystem` / `WaveRunner` / `computeFlowField` 都可以单独使用（`tests/`、`bench/` 里推荐直接用裸组件）。

---

## 坐标约定

整数格坐标一律 `cx` / `cy`，与 `src/combat` 完全一致（`CellCoord { cx, cy }` 是结构等价的，无需转换）。`src/engine/grid/coords.ts` 把同一对量叫 `col` / `row`，数值相同。世界坐标 1.0 单位 = 1 格，格心 = `(cx + 0.5, cy + 0.5)`。

---

## 跨模块契约

### 给 `src/combat`

| combat 侧 | gameplay 侧 | 说明 |
|---|---|---|
| `TerrainQuery` | `world.terrain`（`GridTerrainQuery`） | 结构等价，不跨子树 import。`isBridge()` 只对**玩家搭的桥**返回 true，正是拆迁蟹的合法目标 |
| `MovementDriver` | `world.movement`（`FlowFieldMovement`） | 地面单位。走 flow field 而不是烘焙折线，所以波中挖沟能让**已经在路上**的敌人改道 |
| `enemy.path`（折线） | `world.polylineFromGate(gateId)` | 想用 combat 自带的 `PolylineMovement` 时用这个 |
| 飞行敌人 | `world.flightPathFromGate(gateId)` | GDD §5.1「飞行敌人直线飞，无视一切」，**不要**喂给 flow field |
| `bridge_destroyed` 事件 | `world.destroyBridge(cx, cy, enemyId)` | combat 发事件，gameplay 改地形。次数不返还 |
| 建塔/卖塔 | `grid.setOccupied(cx, cy, boolean)` | 占位会让 `isBuildable` 转 false 并 bump version |

### 给经济 / 完整度系统

| 时机 | 调用 |
|---|---|
| 完整度变化后（每帧调也安全） | `world.applyIntegrity(n)` → 返回本次丢掉的变电区，调用方自行扣供电上限。阈值只触发一次，丢区不可赎回 |
| 工程扣款 | 监听 `engineering_started`（payload 带 `cost`）。gameplay 不碰钱包 |
| 波次奖励 | `waves.notifyWaveCleared()` 返回 `{ reward, earlyBonus, total }`，同时发 `wave_cleared` |
| 赏金递减 | 每个 `SpawnRequest` 自带 `bountyMultiplier`（波 10 后 0.8、波 15 后 0.6） |

### 给 UI

- 下一波预览：`world.waves.nextPreview` → `WavePreviewEntry[]`，含 `icon` / `count` / `air`（对空警示）/ `threat`（`breaker` 高亮拆与疗）。**预览与实际出怪来自同一份 `ResolvedWave.spawns`**，不会对不上。
- 工程按钮变红：`engineering.checkDig(cx, cy)` / `checkBridge(cx, cy)` 返回 `OperationCheck`，含 `reason`（枚举）、`message`（中文文案）、`cost`、`quotaLeft`、`blockedGates`（会被堵死的出怪口 id，用于 tooltip）。
- 高亮所有合法目标：`engineering.legalTargets('dig' | 'bridge')`。
- 剩余次数角标：`engineering.digLeft` / `bridgeLeft`。

---

## 网格

地图用 ASCII 编写，一格一字符（图例见 `grid/mapDef.ts` 的 `DEFAULT_LEGEND`）：

```
.  地基（可建）      #  岩石        =  路面        d  可挖路段（路面 + 可挖标记）
~  水洼（路面变体）  ,  软土        v  沟壑        w  水面        b  预置桥
C  核心              1/2/3 出怪口   L/M/N 闸门组   F  泄洪道      g  地热裂隙
```

不能用一格一字符表达的东西（变电区矩形、出怪口开启波次、工程次数、波次乘区）放在 `MapDef` 的兄弟字段里。`MapDef` 是纯 JSON 可序列化的：等 `data/` 出正式关卡表，用 `loadMapDef()` 走同一条校验路径接进来即可。

地形特性由 `TERRAIN_TRAITS` 统一裁决（walkable / buildable / road / water / bridgeable），不要在别处再写一份判断。`isBuildable` 已经把地形、占位、施工中、变电区断电四件事一起算好了。

**版本号**：任何影响可通行或可建造的改动都会 `grid.version += 1`。flow field 以此为唯一缓存依据，外部系统也可以拿它做脏检查。

---

## 寻路

`computeFlowField(view, targets, opts)` 从核心反向刷 Dijkstra，产出 `cost`（到核心的步数）与 `direction`（`DIRECTIONS` 下标）。四邻域，方向在第二遍单独计算，平局固定按 N→E→S→W 取，**与堆的弹出顺序无关**，所以同一张图必然得到同一条路径（回放与埋点可复现）。

两种模式：

- **严格**（`blockedPenalty: Infinity`，默认）：不可通行格 `cost = Infinity`、`direction = -1`。合法性校验用它。
- **惩罚**（`GameplayWorld` 默认 `1000`）：穿墙代价极高但有限，于是**每一格都有方向**。拆迁蟹把敌人脚下的桥炸了也不会出现「没有方向可走」的僵死。`isReachable()` 判的是 `cost < reachableThreshold`，仍能区分真通与假通。

改路是全量重算（GDD §5.1），240 格的重算成本可以忽略；`world.groundField` 按 `grid.version` 惰性重建并发 `flow_field_rebuilt`（payload 里带不可达的出怪口列表）。

---

## 工程操作（挖沟 / 搭桥）

| | 挖沟 | 搭桥 |
|---|---|---|
| 代价 | 50 金 / 3s | 80 金 / 3s |
| 目标 | 标了 `Diggable` 的路面（可挖路段） | 沟壑 / 水面 |
| 施工期间 | **仍可通行**（GDD §5.1） | 不可通行，完工才通 |
| 结果 | 路面 → 沟壑 | 沟壑/水面 → 桥（打 `PlayerBridge` 标记） |

合法性（`check()`）比「当前这一格能不能挖」更严，三点值得注意：

1. **按完工后的棋盘判**。所有**已排队但未完工**的工程一并计入，所以「单独看都合法、加起来堵死」的两次挖沟会在第二次就被拒。
2. **尚未开启的出怪口也要保持连通**。否则波 3 挖一刀，波 10 第二出怪口一开就直接死锁。（`config.includeUnopenedGates`，默认开。）
3. **桥依赖只是警告，不是拒绝**。如果某条通路只在玩家搭的桥存在时才成立，`warnings` 里会出现 `bridge_dependent_route`——把敌人引上桥本来就是正当玩法，但 UI 应该提示玩家拆迁蟹能拆掉它。

拒绝时 `reason` 是枚举，`blockedGates` 告诉你是哪个口断了。

---

## 波次

一份 20 波基础表（`BASE_WAVE_TABLE`）× 每图乘区（`MapDef.waveModifiers`），不为每图手写波表（GDD §8.3）。乘区能做四件事：

- `hpMultiplier` / `speedMultiplier`：整图难度列。
- `countMultipliers`：按**类别**缩放数量（`flying` / `healer` / `sapper` / …），例如图 2 的对空考核是 `flying: 1.5`。缩放后至少保留 1 只，不会把一个小队四舍五入抹掉。
- `firstAppearance`：破阵敌首次登场波。早于该波的编组自动换成替身（侦察蜂→疾行鼠、拆迁蟹→装甲车、修理机→拾荒虫），波压不塌；恰好在该波而基础表没排的，补一个小队进去。
- `waveOverrides`：按波做手术（图 3 波 15 母舰 ×2、波 20 利维坦 HP ×1.2 就是这么来的）。

`MAP_WAVE_MODIFIER_PRESETS` 里已经按 GDD §8.3 表格备好了 `map1` / `map2` / `map3` 三列。

`WaveRunner` 只管波次状态与出怪时刻，不创建敌人，也**不知道场上还剩几只**——清场由调用方调 `notifyWaveCleared()` 告知。状态机：`preparing → spawning → clearing → preparing …→ complete`。

> 基础波表与灰盒图 1 都标了 PROVISIONAL：数值是按 GDD §11 教学脚本和 §12 曲线推的可玩初稿，等 `data/` 的正式配表落地后原地替换，生成器不关心数据从哪来。

---

## 灰盒图 1「主厂房」

`maps/map1Powerhouse.ts` 是一张**系统优先**的灰盒图，专门把本模块要支持的机制全部跑通（正式关卡设计仍应落在 `data/`）：

| 机制 | 表现 |
|---|---|
| 挖沟封捷径 | (8,2) 的横向连接把蛇形路线从 44 步缩到 32 步；挖掉它，44 步回来，且因为有环路所以合法 |
| 搭桥引怪 | 第 5 行的沟壑在 (11,5) 缺一格，搭一次桥把路程压到 22 步——玩家在自己的杀伤区正中开门 |
| 丢 B 区开支路 | `sluice_b` 闸门 (15,3)–(16,5) 是一条 21 步直插核心的路，完整度 ≤50 时打开，沿蛇形路线摆的塔瞬间打空 |
| 第二出怪口 | `gate_south` 波 10 开 |
| 工程次数 | 挖沟 3 / 搭桥 2，波 15 补发挖沟 1 |

---

## 自检

```bash
npx tsc --outDir /tmp/gpcheck --module commonjs --target ES2022 --skipLibCheck --strict \
  src/gameplay/selfcheck.main.ts && node /tmp/gpcheck/selfcheck.main.js
```

`selfcheck.ts` 是 33 条 GDD 不变量的可执行版本（地形特性、路径长度、施工期通行、堵死拒绝、未开启出怪口、拆桥回退、丢区开闸、乘区缩放、预览与出怪一致、提前开波 +10% …）。它**不替代** `tests/`（那是 R1-G1 的子树）——`runGameplaySelfCheck()` 已导出，测试可以直接把它当一组断言跑，也可以照着这份清单写更细的用例。

---

## 已知边界

- 寻路是四邻域。八邻域会让「挖一格封路」的直觉失效（斜穿角落），除非另立防穿角规则，v1 不做。
- 所有敌人共用一张 flow field。若后续要做「拆迁蟹优先找塔」之类的差异化寻路，应另刷一张场，不要改这张。
- `FlowFieldMovement` 在格心转向；这是让改道不会斜穿塔位的最简做法，但也意味着敌人不会走对角捷径。
- 格子涂层（油渍/火场）不在这里，归 `src/combat`；本模块只提供 `isRoad()`（涂层只沾路面）和 `isFloodway()`（图 2 泄洪道每波冲油）。
