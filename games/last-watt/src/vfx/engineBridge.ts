import { Vector3 } from 'three';

import type { Engine } from '../engine/Engine';
import { computeShakeOffset } from './cameraShake';
import type { ImpactState } from './ImpactDirector';
import type { VfxSystem } from './VfxSystem';

/**
 * 把 VFX 接到引擎的每帧协议上。
 *
 * 这里是 `README` 里那份「顺序不能换」的协议的唯一实现，接线只此一处：
 *
 * ```
 * loop.onFrameBegin  → vfx.beginFrame(realDtMs)，把 timeScale 交回 loop
 * loop.onFixedUpdate → 玩法按 dt·timeScale 推进（顿帧时一个 tick 都不跑）
 * loop.onRender      → vfx.endFrame()，推进粒子时钟与循环发射器
 * loop.onPresent     → 引擎绘制
 * post.onMaskPass    → vfx.setMaskPass()，自发光遮罩 pass 里剔掉非光源层
 * ```
 *
 * 冰碎的 60ms 顿帧就靠第一行落地：`ImpactDirector` 在顿帧期间把 `timeScale`
 * 压成 0，`Loop` 的累加器停止进账，逻辑与粒子一起定住，而渲染照常出帧。
 */

export interface VfxEngineBridgeOptions {
  /**
   * 每帧把冲击状态转给别人（HUD 用它画白闪与暗角）：
   * `onImpact: (state) => hud.applyImpact(state)`。
   */
  onImpact?(state: ImpactState): void;
  /** 相机震动。截图回归需要逐帧可复现时关掉它。默认开。 */
  cameraShake?: boolean;
}

export interface VfxEngineBridge {
  /** 解除全部订阅，并把 VFX 根从场景里摘掉。 */
  detach(): void;
}

export function attachVfxToEngine(
  engine: Engine,
  vfx: VfxSystem,
  options: VfxEngineBridgeOptions = {},
): VfxEngineBridge {
  const shakeEnabled = options.cameraShake !== false;
  const shakeOffset = new Vector3();
  const unsubscribers: Array<() => void> = [];

  vfx.attachTo(engine.scene);

  const syncViewport = (drawingBufferHeight: number, verticalFov: number): void => {
    vfx.setViewport(drawingBufferHeight, verticalFov);
  };

  // resize 早于订阅发生过一次，所以先按当前视口对一遍，再跟随后续变化
  engine.resize();
  unsubscribers.push(
    engine.onViewportChange.add((viewport) =>
      syncViewport(viewport.drawingBufferHeight, viewport.verticalFov),
    ),
  );

  unsubscribers.push(
    engine.loop.onFrameBegin.add(({ realDelta }) => {
      const impact = vfx.beginFrame(realDelta * 1000);

      // 这一行就是顿帧：丢掉它，冰碎只剩粒子，没有那 60ms 的「咔嚓」
      engine.loop.timeScale = impact.timeScale;

      if (shakeEnabled) {
        computeShakeOffset(engine.camera, impact, shakeOffset, engine.cameraRig.focusDistance);
        engine.cameraRig.setShakeOffset(shakeOffset.x, shakeOffset.y, shakeOffset.z);
      }

      options.onImpact?.(impact);
    }),
  );

  unsubscribers.push(engine.loop.onRender.add(() => vfx.endFrame()));

  unsubscribers.push(engine.post.onMaskPass.add((active) => vfx.setMaskPass(active)));

  return {
    detach(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
      engine.loop.timeScale = 1;
      if (shakeEnabled) engine.cameraRig.setShakeOffset(0, 0, 0);
      vfx.setMaskPass(false);
      vfx.root.removeFromParent();
    },
  };
}
