import * as THREE from 'three';
import { DecalManager } from './DecalManager';
import { GpuParticleSystem, type ParticleSystemOptions } from './GpuParticleSystem';
import { ImpactDirector, type ImpactState } from './ImpactDirector';
import { VfxBudget, type BudgetSnapshot } from './budget';
import {
  emitCondenseMistPuff,
  playFreeze,
  playHammerImpact,
  playIceShatter,
  playOverloadEnd,
  playOverloadStart,
  playUnitDeath,
  type MistParams,
  type VfxContext,
} from './effects';
import {
  VfxPriority,
  type EmitterHandle,
  type Vec3Like,
  type VfxEventMap,
  type VfxEventName,
} from './events';

/**
 * VFX 门面。玩法层只跟这个类打交道。
 *
 * 每帧协议（顺序不能换）：
 * ```ts
 * const impact = vfx.beginFrame(realDtMs);   // ① 拿 timeScale：顿帧期间它是 0
 * world.step(realDtMs * impact.timeScale);   // ② 玩法自己按 timeScale 推进，期间调 vfx.play(...)
 * vfx.endFrame();                            // ③ 推进粒子时钟、跑循环发射器
 * renderer.render(scene, camera);            // ④ 属性脏区在这里上传
 * ```
 * 把 `beginFrame` 的返回值丢掉，冰碎的顿帧就不会生效——这是唯一一处需要引擎配合的地方。
 */

export interface VfxSystemOptions extends ParticleSystemOptions {
  decalCapacity?: number;
}

interface LoopEmitter {
  id: number;
  kind: string;
  index: number;
  rate: number;
  accumulator: number;
  alive: boolean;
  params: MistParams;
  tick(dt: number, amount: number): void;
}

export class VfxSystem {
  readonly root = new THREE.Group();
  readonly particles: GpuParticleSystem;
  readonly decals: DecalManager;
  readonly impact = new ImpactDirector();
  readonly budget = new VfxBudget();

  private readonly ctx: VfxContext;
  private readonly loops = new Map<number, LoopEmitter>();
  private nextEmitterId = 1;
  private scaledDt = 0;
  private frameOpen = false;

  constructor(options: VfxSystemOptions = {}) {
    this.particles = new GpuParticleSystem(options);
    this.decals = new DecalManager(options.decalCapacity);
    this.root.name = 'lw-vfx';
    this.root.add(this.decals.mesh, this.particles.root);

    this.budget.bindAliveProvider(() => this.particles.stats.alive);
    this.ctx = {
      particles: this.particles,
      decals: this.decals,
      impact: this.impact,
      budget: this.budget,
    };
  }

  /** 把 VFX 根挂到场景图上；相机/渲染器由引擎持有，这里不碰。 */
  attachTo(scene: THREE.Object3D): void {
    scene.add(this.root);
  }

  /** resize / 缩放档位切换后必须调，否则点精灵尺寸会错。 */
  setViewport(drawingBufferHeight: number, verticalFovRad: number): void {
    this.particles.setViewport(drawingBufferHeight, verticalFovRad);
  }

  /**
   * 自发光遮罩 pass 的开关，给 `PostPipeline` 用：
   * ```ts
   * vfx.setMaskPass(true);  bloomComposer.render();  vfx.setMaskPass(false);
   * ```
   * 不接也能跑（雾和贴花会多吃一点辉光），接上就完全符合「Bloom 只吃自发光」。
   */
  setMaskPass(active: boolean): void {
    this.particles.setMaskPass(active);
    this.decals.setMaskPass(active);
  }

  /** @returns 本帧的冲击状态；`timeScale` 必须被玩法层采纳 */
  beginFrame(realDtMs: number): ImpactState {
    const state = this.impact.update(realDtMs);
    this.budget.beginFrame(realDtMs);
    this.particles.beginFrame();
    this.decals.setCap(this.budget.decalCap);
    this.scaledDt = (realDtMs / 1000) * state.timeScale;
    this.frameOpen = true;
    return state;
  }

  endFrame(): void {
    if (!this.frameOpen) {
      // 容错：引擎忘了调 beginFrame 时，退化成不带顿帧的固定步长
      this.scaledDt = 1 / 60;
    }
    const dt = this.scaledDt;

    for (const emitter of this.loops.values()) {
      if (!emitter.alive) continue;
      if (!this.budget.shouldTickLoop(emitter.kind, emitter.index)) continue;
      const rate = emitter.rate * this.budget.loopRate(emitter.kind);
      emitter.accumulator += rate * dt;
      const amount = Math.floor(emitter.accumulator);
      if (amount > 0) {
        emitter.accumulator -= amount;
        emitter.tick(dt, amount);
      }
    }

    this.particles.update(dt);
    this.decals.update(dt);
    this.frameOpen = false;
  }

  /**
   * 播放一个战场事件。
   * @returns 循环类效果返回句柄（记得 stop），一次性效果返回 null
   */
  play<K extends VfxEventName>(name: K, payload: VfxEventMap[K]): EmitterHandle | null {
    switch (name) {
      case 'ice-shatter': {
        const p = payload as VfxEventMap['ice-shatter'];
        playIceShatter(this.ctx, p.position, {
          splashRadius: p.splashRadius,
          direction: p.direction,
        });
        return null;
      }
      case 'freeze': {
        const p = payload as VfxEventMap['freeze'];
        playFreeze(this.ctx, p.position, p.radius);
        return null;
      }
      case 'hammer-impact': {
        const p = payload as VfxEventMap['hammer-impact'];
        playHammerImpact(this.ctx, p.position, { shockwave: p.shockwave });
        return null;
      }
      case 'overload-start': {
        const p = payload as VfxEventMap['overload-start'];
        playOverloadStart(this.ctx, p.position, p.radiusCells);
        return null;
      }
      case 'overload-end': {
        const p = payload as VfxEventMap['overload-end'];
        playOverloadEnd(this.ctx, p.position);
        return null;
      }
      case 'unit-death': {
        const p = payload as VfxEventMap['unit-death'];
        playUnitDeath(this.ctx, p.position);
        return null;
      }
      case 'condense-mist': {
        const p = payload as VfxEventMap['condense-mist'];
        return this.startCondenseMist(p);
      }
      default:
        return null;
    }
  }

  private startCondenseMist(params: VfxEventMap['condense-mist']): EmitterHandle | null {
    const kind = 'condense-mist';
    if (!this.budget.acquireLoop(kind, VfxPriority.Persistent)) return null;

    const id = this.nextEmitterId++;
    const mist: MistParams = {
      position: { ...params.position },
      direction: { ...params.direction },
      range: params.range,
      coneAngle: params.coneAngle,
    };

    const emitter: LoopEmitter = {
      id,
      kind,
      index: id,
      // 每秒 55 粒 × 0.85s 寿命 ≈ 单塔峰值 47 粒，远低于 VISUAL_BIBLE 10.2 的 150 上限；
      // 持续状态不许吃大粒子量（GDD 15.2 规则 ②）
      rate: 55,
      accumulator: 0,
      alive: true,
      params: mist,
      tick: (_dt, amount) => emitCondenseMistPuff(this.ctx, mist, amount),
    };
    this.loops.set(id, emitter);

    const handle: EmitterHandle = {
      id,
      get alive() {
        return emitter.alive;
      },
      setTransform: (position: Vec3Like, direction?: Vec3Like) => {
        mist.position.x = position.x;
        mist.position.y = position.y;
        mist.position.z = position.z;
        if (direction) {
          mist.direction.x = direction.x;
          mist.direction.y = direction.y;
          mist.direction.z = direction.z;
        }
      },
      stop: () => {
        if (!emitter.alive) return;
        emitter.alive = false;
        this.loops.delete(id);
        this.budget.releaseLoop(kind);
      },
    };
    return handle;
  }

  get stats(): BudgetSnapshot & { drawCalls: number; decals: number } {
    return {
      ...this.budget.snapshot,
      drawCalls: this.particles.stats.drawCalls + 1,
      decals: this.decals.count,
    };
  }

  dispose(): void {
    for (const emitter of this.loops.values()) emitter.alive = false;
    this.loops.clear();
    this.particles.dispose();
    this.decals.dispose();
  }
}
