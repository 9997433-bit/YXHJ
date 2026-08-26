# `src/ui` — 自发光 HUD

> 责任人：R1-O4。上位文档：`docs/GDD-余电.md` 第 14 章、`games/last-watt/docs/VISUAL_BIBLE.md` 10.4。

## 两条设计立法

1. **UI 自发光与场景 Bloom 解耦**。发光全部用 `box-shadow` / `text-shadow` / SVG 滤镜实现，
   不依赖后处理。画质降级会关掉 post，但 HUD 的可读性不允许跟着降级。
2. **图标形状对齐粒子形状语言**（GDD 18.1）。冰是硬边多面体、火是软边火舌、
   电是折线尖刺、超载是扩散圆环、经济是圆点。色弱玩家靠形状也能读出系统归属，
   所以图标是手写 SVG path 而不是通用图标库。

## 数据流

单向。玩法层推 `HudState`，HUD 只读不改；玩家输入通过 `HudCallbacks` 回去。
HUD **不持有任何游戏状态**，因此可以被截图脚本和自检用假数据完整驱动，
不需要拉起一整局游戏（`src/vfx/demo/main.ts` 就是这么做的）。

```ts
const hud = new Hud(container, {
  onBuildSelect: (id) => game.selectBlueprint(id),
  onCallWaveEarly: () => game.callWaveEarly(),
  onEngineering: (kind) => game.armEngineering(kind),
  onUltimate: () => game.fireMasterOverload(),
  onUpgrade: (towerId, upgradeId) => game.upgrade(towerId, upgradeId),
  onSell: (towerId) => game.sell(towerId),
  onTargetPriority: (towerId, p) => game.setPriority(towerId, p),
  onCloseInspector: () => game.deselect(),
}, { seenCombos: profile.codexSeen });

// 每帧或状态变化时
hud.setState(projectGameStateToHud(game));
hud.applyImpact(impactState);            // 来自 vfx.beginFrame() 的返回值
hud.showComboTip('ice-shatter');         // 首次触发时；已见过会被静默忽略
```

`HudState` 的形状见 `hudState.ts`，`createEmptyHudState()` 提供安全初值。

## 部件与它们要回答的问题

| 部件 | 玩家用它回答的问题 |
|---|---|
| `ResourceRail` 供电分格条 | 「还能建几点电的塔」——1 格 = 1 点，数格子就是答案；空闲格 1Hz 呼吸表示正在给储能充电 |
| `ResourceRail` 储能环 | 「够不够放一次超载」——20 的门槛刻在环上，够了转青、不够转红 |
| `ResourceRail` 完整度条 | 「离丢区还有多远」——80/50 两条刻度线 + 丢区名标签 |
| `WaveHeader` 兵种预览 | 「下一波要不要改阵」——对空/拆/疗三类破阵敌用描边色跳出来 |
| `BuildBar` | 「为什么不能造」——三态分明：未解锁灰掉、金币不足造价变红、电力不足灰显并写出**缺几点** |
| `ActionCluster` | 「大招好了没、工程还剩几次」 |
| `TowerInspector` | 「升哪个、卖多少、打谁」 |
| `ComboToast` | combo 首次触发时给那一下命名，每档案只弹一次 |
| `ImpactOverlay` | 白闪与事件暗角 |

供电缺口的「缺 N」不是措辞讲究：玩家的下一步决策是「造发电机还是卖塔」，
只说「不够」等于没说。

## 实现约定

- 无框架，纯 DOM。一共十来个部件、每帧只改几个数字，一层虚拟 DOM 的开销和心智成本都比它自己大。
  代价是必须手动做「值没变就不写 DOM」，由 `dom.ts` 的 `setText` / `setClass` / `setStyle` 兜住。
- 样式以 TS 字符串内联注入（`styles.ts`），不引 `.css` 文件——`src/ui` 因此不对打包器的
  CSS loader 做任何假设，headless 截图和 Vite 里是同一份样式。
- 颜色只能从 `../vfx/palette` 取，UI 与粒子共用一套语义色。
- 所有按钮都是真 `<button>`，带 `:focus-visible` 轮廓与 `title`，键盘可达。

## 与冲击系统的关系

白闪和暗角挂在 UI 层而不是后处理里，有两个实际理由：白闪只有 1 帧，
走后处理要多一遍全屏 blit，性价比极差；而且降级会关掉后处理，
但「冰碎白闪」是玩法反馈，**永不降级**——挂在 UI 上它天然不受影响。

相机震动**不作用于 HUD**：HUD 跟着抖会让点击目标漂移，且 GDD 没有这个要求。

## 尚未实现（M2 及以后）

暂停/设置页、Game Over 结算（输在第几波、哪个口漏最多）、星级结算、
教学高亮遮罩、敌人血条与状态图标环（属世界空间层，应由渲染层出而不是 DOM）。
