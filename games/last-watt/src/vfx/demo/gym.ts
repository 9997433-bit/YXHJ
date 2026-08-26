import * as THREE from 'three';
import { VfxSystem } from '../VfxSystem';
import { PALETTE_HEX } from '../palette';
import { DegradeLevel } from '../budget';

/**
 * VFX Gym（VISUAL_BIBLE 11：一键触发全部效果 + 常驻计数 HUD）。
 *
 * 这是 VFX 层的独立试验台，**不依赖 `src/engine`**：
 * 引擎还在同轮迭代中，把 Gym 挂在它上面会让「粒子是否正常」和
 * 「引擎今天能不能启动」这两件事纠缠在一起。Gym 自己开一个最小渲染器，
 * 相机参数照抄 GDD 15.1（FOV 30°、俯角 55°、固定朝向）。
 *
 * 两种驱动方式：
 * - `start()`：rAF 实时跑，人工观察；
 * - `runTo(seconds)`：固定步长快进到某一刻再渲染一帧，
 *   给截图 / 回归比对用，同一时刻的画面逐帧可复现。
 */

const FIXED_STEP_MS = 1000 / 60;

export interface GymCounters {
  time: number;
  particles: number;
  loopEmitters: number;
  oneShotEmitters: number;
  decals: number;
  degrade: DegradeLevel;
  droppedRequests: number;
  hitstopsAccepted: number;
  hitstopsRejected: number;
  timeScale: number;
}

interface ScheduledEvent {
  at: number;
  label: string;
  run(): void;
}

export class VfxGym {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vfx = new VfxSystem();

  private readonly timeline: ScheduledEvent[] = [];
  private fired = new Set<number>();
  private clock = 0;
  private rafHandle = 0;
  private lastRealMs = 0;
  private mistHandle: ReturnType<VfxSystem['play']> = null;
  private readonly hotspot = new THREE.Vector3(9, 0.55, 6);
  private readonly towerSpot = new THREE.Vector3(5, 0.9, 6);
  private readonly capacitorSpot = new THREE.Vector3(14, 0.8, 6);

  constructor(container: HTMLElement, width = 1280, height = 720) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x0d0908, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, width / height, 1, 400);
    this.placeCamera();

    this.buildStage();
    this.vfx.attachTo(this.scene);
    this.vfx.setViewport(height, THREE.MathUtils.degToRad(30));
    this.buildTimeline();
  }

  /** GDD 15.1：透视、FOV 30°、俯角 55°、朝向固定不可旋转。 */
  private placeCamera(): void {
    const target = new THREE.Vector3(10, 0, 6);
    const pitch = THREE.MathUtils.degToRad(55);
    const distance = 26;
    this.camera.position.set(
      target.x,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(pitch) * distance,
    );
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  private buildStage(): void {
    this.scene.fog = new THREE.FogExp2(0x0d0908, 0.014);

    const key = new THREE.DirectionalLight(0xffd9b8, 2.4);
    key.position.set(-0.55, 1, -0.45).multiplyScalar(20);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0x3b4a5a, 0x241812, 0.55));

    // 锈铁地面：粒子必须能在这个底色上被一眼读出来，所以地面刻意压暗压灰
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      new THREE.MeshStandardMaterial({ color: 0x4a3227, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(10, 0, 6);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(20, 20, 0x8a6a52, 0x6b5142);
    grid.position.set(10, 0.01, 6);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    // 三个低模替身：冷凝塔（喷雾源）、目标敌人（冰碎点）、电容站（超载点）
    this.scene.add(
      this.stand(this.towerSpot, 0.62, PALETTE_HEX.ice, 0.9),
      this.stand(this.hotspot, 0.5, 0x6f7d84, 0.05),
      this.stand(this.capacitorSpot, 0.7, PALETTE_HEX.electric, 1.4),
    );
  }

  private stand(at: THREE.Vector3, size: number, emissiveHex: number | string, glow: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * 1.6, size),
      new THREE.MeshStandardMaterial({
        color: 0x2a2320,
        roughness: 0.7,
        metalness: 0.3,
        emissive: new THREE.Color(emissiveHex as number),
        emissiveIntensity: glow,
      }),
    );
    mesh.position.set(at.x, size * 0.8, at.z);
    return mesh;
  }

  /**
   * 演示时间线。顺序刻意安排成「冻结 → 冰碎 → 第二次冰碎」，
   * 因为第二次冰碎距第一次不到 100ms，正好把顿帧节流规则演出来：
   * 粒子照出，顿帧被驳回。
   */
  private buildTimeline(): void {
    const add = (at: number, label: string, run: () => void) =>
      this.timeline.push({ at, label, run });

    add(0.15, '冷凝喷雾（循环）', () => {
      this.mistHandle = this.vfx.play('condense-mist', {
        position: { x: this.towerSpot.x + 0.4, y: 0.85, z: this.towerSpot.z },
        direction: { x: 1, y: 0.05, z: 0 },
        range: 3.2,
        coneAngle: 0.4,
      });
    });

    add(0.9, '冻结成立', () => {
      this.vfx.play('freeze', { position: this.pt(this.hotspot), radius: 0.5 });
    });

    add(1.15, '冰碎（主反馈）', () => {
      this.vfx.play('ice-shatter', {
        position: this.pt(this.hotspot),
        splashRadius: 1,
        direction: { x: 0.15, y: 1, z: -0.1 },
      });
    });

    // 同一帧内的第二次冰碎（溅射连锁的真实情形）：粒子照出，顿帧被驳回。
    // 这就是 100ms 节流立法要防的画面——两次顿帧叠在一起会让手感变成卡顿。
    add(1.15, '冰碎 #2（同帧，顿帧应被驳回）', () => {
      this.vfx.play('ice-shatter', {
        position: { x: this.hotspot.x + 1.4, y: this.hotspot.y, z: this.hotspot.z + 0.8 },
        splashRadius: 0.8,
      });
    });

    add(1.75, '破碎锤命中', () => {
      this.vfx.play('hammer-impact', {
        position: { x: this.hotspot.x - 1.8, y: 0.1, z: this.hotspot.z + 1.6 },
        shockwave: true,
      });
    });

    add(2.2, '电容站超载', () => {
      this.vfx.play('overload-start', {
        position: this.pt(this.capacitorSpot),
        radiusCells: 1.5,
      });
    });

    add(3.4, '过热停机', () => {
      this.vfx.play('overload-end', { position: this.pt(this.capacitorSpot) });
      this.mistHandle?.stop();
    });
  }

  private pt(v: THREE.Vector3): { x: number; y: number; z: number } {
    return { x: v.x, y: v.y, z: v.z };
  }

  /** 推进一个固定帧。返回本帧的冲击状态，供外部把 timeScale 施加到自己的逻辑。 */
  step(dtMs = FIXED_STEP_MS): GymCounters {
    const impact = this.vfx.beginFrame(dtMs);
    // 时间线用**缩放后**的时间推进：顿帧时演出也该定住
    this.clock += (dtMs / 1000) * impact.timeScale;

    for (let i = 0; i < this.timeline.length; i++) {
      const event = this.timeline[i];
      if (this.fired.has(i) || this.clock < event.at) continue;
      this.fired.add(i);
      event.run();
    }

    this.vfx.endFrame();
    return this.counters(impact.timeScale);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 固定步长快进到指定时刻并渲染一帧——截图与回归比对用。 */
  runTo(seconds: number): GymCounters {
    let counters = this.counters(1);
    let guard = 0;
    while (this.clock < seconds && guard++ < 10_000) {
      counters = this.step();
    }
    this.render();
    return counters;
  }

  start(): void {
    this.lastRealMs = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - this.lastRealMs, 50);
      this.lastRealMs = now;
      this.step(dt);
      this.render();
      this.rafHandle = requestAnimationFrame(frame);
    };
    this.rafHandle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  /** 时间线跑完后重来一轮，方便长时间观察。 */
  reset(): void {
    this.fired = new Set();
    this.clock = 0;
    this.mistHandle?.stop();
    this.mistHandle = null;
  }

  counters(timeScale: number): GymCounters {
    const stats = this.vfx.stats;
    const impact = this.vfx.impact.diagnostics;
    return {
      time: this.clock,
      particles: stats.aliveParticles,
      loopEmitters: stats.loopEmitters,
      oneShotEmitters: stats.oneShotEmitters,
      decals: stats.decals,
      degrade: stats.degrade,
      droppedRequests: stats.droppedRequests,
      hitstopsAccepted: impact.hitstopsAccepted,
      hitstopsRejected: impact.hitstopsRejected,
      timeScale,
    };
  }

  dispose(): void {
    this.stop();
    this.vfx.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
