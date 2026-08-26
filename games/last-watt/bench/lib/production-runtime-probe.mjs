import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { DEFAULT_BUDGETS } from "./budget-controller.mjs";

const gameDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Loads the production TypeScript modules through Vite's SSR transformer, then
 * exercises the real governor and particle pool without a WebGL context.
 *
 * The waves 16–19 probe remains a deterministic demand model. This companion
 * probe prevents that model from silently drifting away from the production
 * constants and, importantly, verifies that the report can read the same
 * counters used by VfxSystem at runtime.
 */
export async function runProductionRuntimeProbe() {
  const server = await createServer({
    root: gameDirectory,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const production = await server.ssrLoadModule("/src/vfx/index.ts");
    return exerciseProductionRuntime(production);
  } finally {
    await server.close();
  }
}

function exerciseProductionRuntime({
  GpuParticleSystem,
  ParticleTile,
  VFX_BUDGET,
  VfxBudget,
  VfxPriority,
}) {
  const productionBudgets = {
    activeEmitters: VFX_BUDGET.maxEmitters,
    loopingEmitters: VFX_BUDGET.maxLoopEmitters,
    burstEmitters: VFX_BUDGET.maxOneShotEmitters,
    gpuParticles: VFX_BUDGET.maxParticles,
    dynamicPointLights: VFX_BUDGET.maxDynamicLights,
  };
  const checks = [];
  const observations = {};
  const particles = new GpuParticleSystem({
    additiveCapacity: 14_000,
    alphaCapacity: 6_000,
    seed: 0x52324732,
  });
  const governor = new VfxBudget();
  governor.autoDegrade = false;
  governor.bindAliveProvider(() => particles.stats.alive);

  try {
    const defaultBudgets = pickRuntimeBudgets(DEFAULT_BUDGETS);
    addCheck(
      checks,
      "production_budget_constants_match_bench_defaults",
      productionBudgets,
      defaultBudgets,
      deepEqual(productionBudgets, defaultBudgets),
    );
    addCheck(
      checks,
      "production_particle_capacity_eq_20000",
      particles.totalCapacity,
      VFX_BUDGET.maxParticles,
      particles.totalCapacity === VFX_BUDGET.maxParticles,
    );

    // Saturate both emitter classes. Every successful one-shot request is
    // written into the real particle buffers so the snapshot is not synthetic.
    beginFrame(governor, particles);
    let acceptedLoops = 0;
    for (let index = 0; index < VFX_BUDGET.maxLoopEmitters; index += 1) {
      if (governor.acquireLoop("bench-loop", VfxPriority.Persistent)) {
        acceptedLoops += 1;
      }
    }
    const overflowLoopAccepted = governor.acquireLoop(
      "bench-loop",
      VfxPriority.Persistent,
    );

    let acceptedOneShots = 0;
    for (let index = 0; index < VFX_BUDGET.maxOneShotEmitters; index += 1) {
      const granted = governor.allow(VfxPriority.Ambient, 1);
      if (particles.emit(particleRequest(1, 1, ParticleTile.Soft, "alpha"), granted) === 1) {
        acceptedOneShots += 1;
      }
    }
    const overflowOneShotGrant = governor.allow(VfxPriority.Ambient, 1);
    const saturatedEmitterSnapshot = governor.snapshot;
    const saturatedEmitterExactParticles = particles.countAliveExact();
    const saturatedEmitterViolations = governor.violations();

    observations.emitterSaturation = {
      acceptedLoops,
      overflowLoopAccepted,
      acceptedOneShots,
      overflowOneShotGrant,
      snapshot: saturatedEmitterSnapshot,
      exactAliveParticles: saturatedEmitterExactParticles,
      violations: saturatedEmitterViolations,
    };
    addCheck(
      checks,
      "production_loop_emitter_cap_enforced",
      {
        accepted: acceptedLoops,
        overflowAccepted: overflowLoopAccepted,
        snapshot: saturatedEmitterSnapshot.loopEmitters,
      },
      {
        accepted: VFX_BUDGET.maxLoopEmitters,
        overflowAccepted: false,
        snapshot: VFX_BUDGET.maxLoopEmitters,
      },
      acceptedLoops === VFX_BUDGET.maxLoopEmitters &&
        !overflowLoopAccepted &&
        saturatedEmitterSnapshot.loopEmitters === VFX_BUDGET.maxLoopEmitters,
    );
    addCheck(
      checks,
      "production_one_shot_emitter_cap_enforced",
      {
        accepted: acceptedOneShots,
        overflowGrant: overflowOneShotGrant,
        snapshot: saturatedEmitterSnapshot.oneShotEmitters,
      },
      {
        accepted: VFX_BUDGET.maxOneShotEmitters,
        overflowGrant: 0,
        snapshot: VFX_BUDGET.maxOneShotEmitters,
      },
      acceptedOneShots === VFX_BUDGET.maxOneShotEmitters &&
        overflowOneShotGrant === 0 &&
        saturatedEmitterSnapshot.oneShotEmitters ===
          VFX_BUDGET.maxOneShotEmitters,
    );
    addCheck(
      checks,
      "production_combined_emitter_cap_lte_64",
      saturatedEmitterSnapshot.loopEmitters +
        saturatedEmitterSnapshot.oneShotEmitters,
      VFX_BUDGET.maxEmitters,
      saturatedEmitterSnapshot.loopEmitters +
        saturatedEmitterSnapshot.oneShotEmitters <=
        VFX_BUDGET.maxEmitters,
      "lte",
    );
    addCheck(
      checks,
      "production_emitter_saturation_has_no_budget_violation",
      saturatedEmitterViolations,
      [],
      saturatedEmitterViolations.length === 0,
    );

    for (let index = 0; index < acceptedLoops; index += 1) {
      governor.releaseLoop("bench-loop");
    }
    particles.update(2);

    // VISUAL_BIBLE §15.3 estimates 2,340 live particles for the representative
    // late-wave collision. Emit that exact load into the production ring pool
    // and compare the O(1) runtime estimate with the exact O(capacity) scan.
    beginFrame(governor, particles);
    const representativeRequested = 2_340;
    const representativeGranted = governor.allow(
      VfxPriority.Event,
      representativeRequested,
    );
    const representativeEmitted = particles.emit(
      particleRequest(
        representativeRequested,
        0.5,
        ParticleTile.Spike,
        "additive",
      ),
      representativeGranted,
    );
    const representativeSnapshot = governor.snapshot;
    const representativeExactParticles = particles.countAliveExact();
    observations.representativeLateWaveLoad = {
      requestedParticles: representativeRequested,
      grantedParticles: representativeGranted,
      emittedParticles: representativeEmitted,
      runtimeEstimatedAliveParticles: representativeSnapshot.aliveParticles,
      exactAliveParticles: representativeExactParticles,
      capacity: particles.totalCapacity,
      particleStats: particles.stats,
      violations: governor.violations(),
    };
    addCheck(
      checks,
      "production_representative_load_uses_real_particle_count",
      {
        estimated: representativeSnapshot.aliveParticles,
        exact: representativeExactParticles,
        emitted: representativeEmitted,
      },
      {
        estimated: representativeRequested,
        exact: representativeRequested,
        emitted: representativeRequested,
      },
      representativeSnapshot.aliveParticles === representativeRequested &&
        representativeExactParticles === representativeRequested &&
        representativeEmitted === representativeRequested,
    );
    addCheck(
      checks,
      "production_representative_load_lte_particle_budget",
      representativeExactParticles,
      VFX_BUDGET.maxParticles,
      representativeExactParticles <= VFX_BUDGET.maxParticles,
      "lte",
    );

    particles.update(1);
    const expiredEstimate = particles.stats.alive;
    const expiredExact = particles.countAliveExact();
    addCheck(
      checks,
      "production_expired_particles_return_to_zero",
      { estimated: expiredEstimate, exact: expiredExact },
      { estimated: 0, exact: 0 },
      expiredEstimate === 0 && expiredExact === 0,
    );

    // Fill both production layers to their real capacities. At full capacity
    // persistent particles must be rejected while protected event particles
    // keep their grant (the ring pool would overwrite the oldest particles).
    beginFrame(governor, particles);
    const additiveRequested = 14_000;
    const additiveGranted = governor.allow(
      VfxPriority.Event,
      additiveRequested,
    );
    const additiveEmitted = particles.emit(
      particleRequest(
        additiveRequested,
        10,
        ParticleTile.Spike,
        "additive",
      ),
      additiveGranted,
    );
    const alphaRequested = 6_000;
    const alphaGranted = governor.allow(VfxPriority.Event, alphaRequested);
    const alphaEmitted = particles.emit(
      particleRequest(alphaRequested, 10, ParticleTile.Soft, "alpha"),
      alphaGranted,
    );
    const fullPoolSnapshot = governor.snapshot;
    const fullPoolExactParticles = particles.countAliveExact();
    const persistentGrantAtCapacity = governor.allow(
      VfxPriority.Persistent,
      50,
    );
    const eventGrantAtCapacity = governor.allow(VfxPriority.Event, 50);
    const fullPoolViolations = governor.violations();

    observations.particleSaturation = {
      requestedParticles: additiveRequested + alphaRequested,
      grantedParticles: additiveGranted + alphaGranted,
      emittedParticles: additiveEmitted + alphaEmitted,
      snapshotBeforePolicyChecks: fullPoolSnapshot,
      exactAliveParticles: fullPoolExactParticles,
      persistentGrantAtCapacity,
      eventGrantAtCapacity,
      violations: fullPoolViolations,
    };
    addCheck(
      checks,
      "production_particle_pool_reaches_exact_budget",
      {
        estimated: fullPoolSnapshot.aliveParticles,
        exact: fullPoolExactParticles,
      },
      {
        estimated: VFX_BUDGET.maxParticles,
        exact: VFX_BUDGET.maxParticles,
      },
      fullPoolSnapshot.aliveParticles === VFX_BUDGET.maxParticles &&
        fullPoolExactParticles === VFX_BUDGET.maxParticles,
    );
    addCheck(
      checks,
      "production_persistent_particles_drop_at_capacity",
      persistentGrantAtCapacity,
      0,
      persistentGrantAtCapacity === 0,
      "eq",
    );
    addCheck(
      checks,
      "production_event_particles_remain_protected_at_capacity",
      eventGrantAtCapacity,
      50,
      eventGrantAtCapacity === 50,
      "eq",
    );
    addCheck(
      checks,
      "production_full_pool_has_no_budget_violation",
      fullPoolViolations,
      [],
      fullPoolViolations.length === 0,
    );
  } finally {
    particles.dispose();
  }

  const passed = checks.every((check) => check.passed);
  return {
    status: passed ? "PASS" : "FAIL",
    kind: "production-typescript-headless-counters",
    loadedModules: {
      governor: "src/vfx/budget.ts#VfxBudget",
      particleSystem: "src/vfx/GpuParticleSystem.ts#GpuParticleSystem",
      publicApi: "src/vfx/index.ts",
      loader: "vite-ssr",
    },
    counterSources: {
      governor: "VfxBudget.snapshot",
      particleEstimate: "GpuParticleSystem.stats.alive",
      particleExact: "GpuParticleSystem.countAliveExact()",
    },
    productionBudgets,
    checks,
    observations,
    renderedFrames: false,
    authoritativeForRenderFps: false,
  };
}

function beginFrame(governor, particles) {
  governor.beginFrame(1000 / 60);
  particles.beginFrame();
}

function particleRequest(count, life, tile, blend) {
  return {
    count,
    position: { x: 0, y: 0, z: 0 },
    life,
    sizeStart: 0.1,
    sizeEnd: 0.05,
    colorStart: [1, 1, 1, 1],
    colorEnd: [1, 1, 1, 0],
    tile,
    blend,
  };
}

function pickRuntimeBudgets(budgets) {
  return {
    activeEmitters: budgets.activeEmitters,
    loopingEmitters: budgets.loopingEmitters,
    burstEmitters: budgets.burstEmitters,
    gpuParticles: budgets.gpuParticles,
    dynamicPointLights: budgets.dynamicPointLights,
  };
}

function addCheck(
  checks,
  id,
  actual,
  expected,
  passed,
  comparator = "deepEqual",
) {
  checks.push({ id, passed, actual, expected, comparator });
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
