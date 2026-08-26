import process from "node:process";

import {
  DEFAULT_BUDGETS,
  EFFECTS,
  createSource,
  evaluateFrame,
  validateBudgets,
} from "./budget-controller.mjs";

const METRICS = [
  "activeEmitters",
  "loopingEmitters",
  "burstEmitters",
  "gpuParticles",
  "dynamicPointLights",
];

export function runMockProbe({
  scenario,
  budgets = DEFAULT_BUDGETS,
  scenarioPath = null,
  canonicalWaveProfile = null,
}) {
  validateBudgets(budgets);
  validateScenario(scenario, canonicalWaveProfile);

  const timeline = buildTimeline(scenario);
  const frameTimesMs = [];
  const requestedPeaks = emptyPeaks();
  const actualPeaks = emptyPeaks();
  const policy = emptyPolicySummary();
  const waves = new Map(
    timeline.waveSpans.map((span) => [span.wave, createWaveSummary(span)]),
  );
  const activeSources = new Map();
  let waveIndex = 0;
  let stressFrameEvaluation = null;

  const runStarted = process.hrtime.bigint();
  for (let frame = 0; frame < timeline.frameCount; frame += 1) {
    const frameStarted = process.hrtime.bigint();
    for (const source of timeline.starts.get(frame) ?? []) {
      activeSources.set(source.instanceId, source);
    }
    for (const source of timeline.ends.get(frame) ?? []) {
      activeSources.delete(source.instanceId);
    }

    while (frame >= timeline.waveSpans[waveIndex].endFrameExclusive) {
      waveIndex += 1;
    }
    const waveSpan = timeline.waveSpans[waveIndex];
    const waveSecond = (frame - waveSpan.startFrame) / scenario.fps;
    const evaluation = evaluateFrame(
      [...activeSources.values()],
      frame,
      budgets,
    );

    const location = {
      frame,
      wave: waveSpan.wave,
      waveSecond: round(waveSecond, 3),
    };
    updatePeaks(requestedPeaks, evaluation.demand, location);
    updatePeaks(actualPeaks, evaluation.actual, location);
    updatePolicy(policy, evaluation.policy);
    updateWaveSummary(
      waves.get(waveSpan.wave),
      evaluation,
      location,
    );

    if (frame === timeline.stressFrame) {
      stressFrameEvaluation = evaluation;
    }
    frameTimesMs.push(
      Number(process.hrtime.bigint() - frameStarted) / 1_000_000,
    );
  }
  const totalProbeTimeMs =
    Number(process.hrtime.bigint() - runStarted) / 1_000_000;

  const stressEvent = buildStressEventReport(
    scenario,
    timeline,
    stressFrameEvaluation,
  );
  const redlines = evaluateRedlines({
    actualPeaks,
    budgets,
    policy,
    waves: [...waves.keys()],
    stressEvent,
    canonicalWaveProfile,
    canonicalWaveExpectation: scenario.canonicalWave,
  });
  const passed = redlines.every((redline) => redline.passed);
  const cpuTiming = summarizeTiming(frameTimesMs, totalProbeTimeMs, budgets);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    benchmark: {
      id: "last-watt-vfx-budget-probe",
      version: "1.0.0",
      kind: "deterministic-node-budget-mock",
    },
    scenario: {
      id: scenario.id,
      name: scenario.name,
      source: scenarioPath,
      fps: scenario.fps,
      frameCount: timeline.frameCount,
      durationSeconds: round(timeline.frameCount / scenario.fps, 3),
      waves: timeline.waveSpans.map((span) => span.wave),
      canonicalWaveProfile,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    budgets: {
      ...budgets,
      frameTimeMs: round(budgets.frameTimeMs, 3),
    },
    result: {
      status: passed ? "PASS" : "FAIL",
      budgetControllerVerified: passed,
      referenceRenderFpsVerified: false,
      referenceRenderFpsStatus: "REQUIRES_WEBGL_REFERENCE_HARDWARE_CAPTURE",
    },
    redlines,
    peaks: {
      requested: requestedPeaks,
      actual: actualPeaks,
    },
    policy,
    stressEvent,
    hostCpuDiagnostic: cpuTiming,
    waves: [...waves.values()],
    notes: [
      "The mock exercises allocation, priority, LOD, and light-fallback policy; it does not render GPU particles.",
      "Node host CPU timing is diagnostic only and must not be used as proof of 4-core Iris Xe-class 1080p/60fps.",
      "Event and combo burst particles are protected; environment emitters are discarded first.",
      "Point-light requests above eight use additive billboard fallback.",
    ],
  };
}

function validateScenario(scenario, canonicalWaveProfile) {
  if (!scenario || typeof scenario !== "object") {
    throw new TypeError("Scenario must be a JSON object.");
  }
  if (!Number.isInteger(scenario.fps) || scenario.fps <= 0) {
    throw new TypeError("Scenario fps must be a positive integer.");
  }
  if (!Array.isArray(scenario.waves) || scenario.waves.length === 0) {
    throw new TypeError("Scenario must define at least one wave.");
  }
  if (
    !canonicalWaveProfile ||
    canonicalWaveProfile.wave !== scenario.canonicalWave?.wave
  ) {
    throw new TypeError("Scenario must resolve its declared canonical wave.");
  }
  for (const field of [
    "expectedSpawnGroups",
    "expectedEnemyCount",
    "sameFrameShatters",
  ]) {
    if (!Number.isInteger(scenario.canonicalWave[field]) || scenario.canonicalWave[field] <= 0) {
      throw new TypeError(`Scenario canonicalWave.${field} must be a positive integer.`);
    }
  }

  const seenWaves = new Set();
  for (const wave of scenario.waves) {
    if (!Number.isInteger(wave.wave) || seenWaves.has(wave.wave)) {
      throw new TypeError("Wave numbers must be unique integers.");
    }
    seenWaves.add(wave.wave);
    if (!Number.isFinite(wave.durationSeconds) || wave.durationSeconds <= 0) {
      throw new TypeError(`Wave ${wave.wave} duration must be positive.`);
    }
    for (const [effectId, count] of Object.entries(wave.loopEffects ?? {})) {
      validateEffectCount(effectId, count, `wave ${wave.wave}`);
      if (EFFECTS[effectId].mode !== "loop") {
        throw new TypeError(`${effectId} is not a looping effect.`);
      }
    }
    for (const burst of wave.periodicBursts ?? []) {
      validateEffectCount(burst.effect, burst.count, `wave ${wave.wave}`);
      if (EFFECTS[burst.effect].mode !== "burst") {
        throw new TypeError(`${burst.effect} is not a burst effect.`);
      }
      if (
        !Number.isFinite(burst.everySeconds) ||
        burst.everySeconds <= 0 ||
        !Number.isFinite(burst.phaseSeconds) ||
        burst.phaseSeconds < 0
      ) {
        throw new TypeError(
          `Invalid periodic schedule for ${burst.effect} in wave ${wave.wave}.`,
        );
      }
    }
  }

  const stress = scenario.fixedStressEvent;
  if (!stress || !seenWaves.has(stress.wave)) {
    throw new TypeError("fixedStressEvent must target a defined wave.");
  }
  for (const entry of stress.loopEffects ?? []) {
    validateEffectCount(entry.effect, entry.count, "fixedStressEvent");
    if (EFFECTS[entry.effect].mode !== "loop") {
      throw new TypeError(`${entry.effect} is not a looping effect.`);
    }
    if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) {
      throw new TypeError(`${entry.effect} stress duration must be positive.`);
    }
  }
  for (const entry of stress.burstEffects ?? []) {
    validateEffectCount(entry.effect, entry.count, "fixedStressEvent");
    if (EFFECTS[entry.effect].mode !== "burst") {
      throw new TypeError(`${entry.effect} is not a burst effect.`);
    }
  }
  for (const entry of stress.assertSameFrame ?? []) {
    const effectId = typeof entry === "string" ? entry : entry.effect;
    const minCount = typeof entry === "string" ? 1 : entry.minCount;
    validateEffectCount(effectId, minCount, "fixedStressEvent.assertSameFrame");
    if (minCount <= 0) {
      throw new TypeError(`${effectId} same-frame minimum must be positive.`);
    }
  }
}

function validateEffectCount(effectId, count, context) {
  if (!EFFECTS[effectId]) {
    throw new RangeError(`Unknown effect "${effectId}" in ${context}.`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError(`${effectId} count in ${context} must be an integer.`);
  }
}

function buildTimeline(scenario) {
  const sources = [];
  const waveSpans = [];
  let cursor = 0;
  let serial = 0;

  for (const wave of scenario.waves) {
    const durationFrames = Math.round(wave.durationSeconds * scenario.fps);
    const span = {
      wave: wave.wave,
      startFrame: cursor,
      endFrameExclusive: cursor + durationFrames,
      durationSeconds: wave.durationSeconds,
    };
    waveSpans.push(span);

    for (const [effectId, count] of Object.entries(wave.loopEffects ?? {})) {
      for (let index = 0; index < count; index += 1) {
        sources.push(
          createSource(
            effectId,
            sourceId(wave.wave, effectId, serial++),
            span.startFrame,
            span.endFrameExclusive - 1,
          ),
        );
      }
    }

    for (const periodic of wave.periodicBursts ?? []) {
      const intervalFrames = Math.max(
        1,
        Math.round(periodic.everySeconds * scenario.fps),
      );
      const phaseFrames = Math.round(periodic.phaseSeconds * scenario.fps);
      for (
        let eventFrame = span.startFrame + phaseFrames;
        eventFrame < span.endFrameExclusive;
        eventFrame += intervalFrames
      ) {
        for (let index = 0; index < periodic.count; index += 1) {
          const effect = EFFECTS[periodic.effect];
          sources.push(
            createSource(
              periodic.effect,
              sourceId(wave.wave, periodic.effect, serial++),
              eventFrame,
              Math.min(
                span.endFrameExclusive - 1,
                eventFrame +
                  Math.max(
                    1,
                    Math.ceil(effect.durationSeconds * scenario.fps),
                  ) -
                  1,
              ),
            ),
          );
        }
      }
    }
    cursor = span.endFrameExclusive;
  }

  const stressSpan = waveSpans.find(
    (span) => span.wave === scenario.fixedStressEvent.wave,
  );
  const stressFrame =
    stressSpan.startFrame +
    Math.round(scenario.fixedStressEvent.atSecond * scenario.fps);
  if (stressFrame >= stressSpan.endFrameExclusive) {
    throw new RangeError("fixedStressEvent occurs after its target wave.");
  }

  for (const entry of scenario.fixedStressEvent.loopEffects ?? []) {
    for (let index = 0; index < entry.count; index += 1) {
      sources.push(
        createSource(
          entry.effect,
          sourceId(stressSpan.wave, entry.effect, serial++),
          stressFrame,
          Math.min(
            stressSpan.endFrameExclusive - 1,
            stressFrame + Math.round(entry.durationSeconds * scenario.fps) - 1,
          ),
        ),
      );
    }
  }
  for (const entry of scenario.fixedStressEvent.burstEffects ?? []) {
    for (let index = 0; index < entry.count; index += 1) {
      const effect = EFFECTS[entry.effect];
      sources.push(
        createSource(
          entry.effect,
          sourceId(stressSpan.wave, entry.effect, serial++),
          stressFrame,
          Math.min(
            stressSpan.endFrameExclusive - 1,
            stressFrame +
              Math.max(
                1,
                Math.ceil(effect.durationSeconds * scenario.fps),
              ) -
              1,
          ),
        ),
      );
    }
  }

  const starts = new Map();
  const ends = new Map();
  for (const source of sources) {
    appendToFrameIndex(starts, source.startFrame, source);
    appendToFrameIndex(ends, source.endFrame + 1, source);
  }

  return {
    frameCount: cursor,
    sources,
    starts,
    ends,
    waveSpans,
    stressFrame,
  };
}

function sourceId(wave, effectId, serial) {
  return `w${wave}:${effectId}:${serial}`;
}

function appendToFrameIndex(index, frame, source) {
  const entries = index.get(frame);
  if (entries) {
    entries.push(source);
  } else {
    index.set(frame, [source]);
  }
}

function emptyPeaks() {
  return Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      { value: 0, frame: 0, wave: null, waveSecond: 0 },
    ]),
  );
}

function updatePeaks(peaks, values, location) {
  for (const metric of METRICS) {
    if (values[metric] > peaks[metric].value) {
      peaks[metric] = { value: values[metric], ...location };
    }
  }
}

function emptyPolicySummary() {
  return {
    framesWithEmitterDrops: 0,
    maxEmitterDropsPerFrame: 0,
    framesWithEnvironmentDrops: 0,
    maxEnvironmentDropsPerFrame: 0,
    framesWithLoopRateReduction: 0,
    maxLoopRateReductionsPerFrame: 0,
    framesWithPointLightFallback: 0,
    maxPointLightFallbacksPerFrame: 0,
    framesWithSameTypeLoopLod: 0,
    protectedParticleDrops: 0,
  };
}

function updatePolicy(summary, framePolicy) {
  updatePolicyCounter(
    summary,
    framePolicy.emitterDrops,
    "framesWithEmitterDrops",
    "maxEmitterDropsPerFrame",
  );
  updatePolicyCounter(
    summary,
    framePolicy.environmentDrops,
    "framesWithEnvironmentDrops",
    "maxEnvironmentDropsPerFrame",
  );
  updatePolicyCounter(
    summary,
    framePolicy.loopRateReductions,
    "framesWithLoopRateReduction",
    "maxLoopRateReductionsPerFrame",
  );
  updatePolicyCounter(
    summary,
    framePolicy.pointLightFallbacks,
    "framesWithPointLightFallback",
    "maxPointLightFallbacksPerFrame",
  );
  if (framePolicy.sameTypeLoopLodGroups > 0) {
    summary.framesWithSameTypeLoopLod += 1;
  }
  summary.protectedParticleDrops += framePolicy.protectedParticleDrops;
}

function updatePolicyCounter(summary, value, frameKey, maxKey) {
  if (value > 0) {
    summary[frameKey] += 1;
    summary[maxKey] = Math.max(summary[maxKey], value);
  }
}

function createWaveSummary(span) {
  return {
    wave: span.wave,
    durationSeconds: span.durationSeconds,
    frameCount: span.endFrameExclusive - span.startFrame,
    peaks: {
      requested: emptyPeaks(),
      actual: emptyPeaks(),
    },
    policy: emptyPolicySummary(),
  };
}

function updateWaveSummary(wave, evaluation, location) {
  updatePeaks(wave.peaks.requested, evaluation.demand, location);
  updatePeaks(wave.peaks.actual, evaluation.actual, location);
  updatePolicy(wave.policy, evaluation.policy);
}

function buildStressEventReport(scenario, timeline, evaluation) {
  const stress = scenario.fixedStressEvent;
  const startCounts = {};
  for (const source of timeline.sources) {
    if (source.startFrame === timeline.stressFrame) {
      startCounts[source.effectId] = (startCounts[source.effectId] ?? 0) + 1;
    }
  }
  const assertions = (stress.assertSameFrame ?? []).map((entry) => {
    const assertion =
      typeof entry === "string"
        ? { effect: entry, minCount: 1 }
        : { effect: entry.effect, minCount: entry.minCount };
    const requestedAtStressFrame = startCounts[assertion.effect] ?? 0;
    const acceptedAtStressFrame =
      evaluation?.acceptedEffectCounts[assertion.effect] ?? 0;
    return {
      ...assertion,
      requestedAtStressFrame,
      acceptedAtStressFrame,
      passed:
        requestedAtStressFrame >= assertion.minCount &&
        acceptedAtStressFrame >= assertion.minCount,
    };
  });

  return {
    id: stress.id,
    wave: stress.wave,
    atSecond: stress.atSecond,
    globalFrame: timeline.stressFrame,
    requestedEffectStarts: Object.fromEntries(
      Object.entries(startCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    acceptedActiveEffects: evaluation?.acceptedEffectCounts ?? {},
    demand: evaluation?.demand ?? null,
    actual: evaluation?.actual ?? null,
    policy: evaluation?.policy ?? null,
    sameFrameAssertions: assertions,
    passed:
      Boolean(evaluation) &&
      assertions.every((assertion) => assertion.passed),
  };
}

function evaluateRedlines({
  actualPeaks,
  budgets,
  policy,
  waves,
  stressEvent,
  canonicalWaveProfile,
  canonicalWaveExpectation,
}) {
  const checks = [
    budgetCheck(
      "active_emitters_lte_64",
      actualPeaks.activeEmitters.value,
      budgets.activeEmitters,
      "lte",
    ),
    budgetCheck(
      "looping_emitters_lte_24",
      actualPeaks.loopingEmitters.value,
      budgets.loopingEmitters,
      "lte",
    ),
    budgetCheck(
      "burst_emitters_lte_40",
      actualPeaks.burstEmitters.value,
      budgets.burstEmitters,
      "lte",
    ),
    budgetCheck(
      "gpu_particles_lte_20000",
      actualPeaks.gpuParticles.value,
      budgets.gpuParticles,
      "lte",
    ),
    budgetCheck(
      "dynamic_point_lights_lte_8",
      actualPeaks.dynamicPointLights.value,
      budgets.dynamicPointLights,
      "lte",
    ),
    budgetCheck(
      "protected_event_combo_particle_drops_eq_0",
      policy.protectedParticleDrops,
      0,
      "eq",
    ),
    {
      id: "wave_coverage_exactly_10",
      passed: JSON.stringify(waves) === JSON.stringify([10]),
      actual: waves,
      expected: [10],
      comparator: "deepEqual",
    },
    {
      id: "canonical_wave_10_profile_matches_data",
      passed:
        canonicalWaveProfile?.wave === 10 &&
        canonicalWaveProfile.spawnGroups ===
          canonicalWaveExpectation.expectedSpawnGroups &&
        canonicalWaveProfile.enemyCount ===
          canonicalWaveExpectation.expectedEnemyCount,
      actual: {
        wave: canonicalWaveProfile?.wave,
        spawnGroups: canonicalWaveProfile?.spawnGroups,
        enemyCount: canonicalWaveProfile?.enemyCount,
      },
      expected: {
        wave: 10,
        spawnGroups: canonicalWaveExpectation.expectedSpawnGroups,
        enemyCount: canonicalWaveExpectation.expectedEnemyCount,
      },
      comparator: "deepEqual",
    },
    {
      id: "multiple_ice_shatters_share_stress_frame",
      passed:
        stressEvent.passed &&
        stressEvent.sameFrameAssertions.some(
          (assertion) =>
            assertion.effect === "shatter" &&
            assertion.requestedAtStressFrame >=
              canonicalWaveExpectation.sameFrameShatters &&
            assertion.acceptedAtStressFrame >=
              canonicalWaveExpectation.sameFrameShatters,
        ),
      actual: stressEvent.sameFrameAssertions.find(
        (assertion) => assertion.effect === "shatter",
      ),
      expected: {
        effect: "shatter",
        requestedAtStressFrame: `>=${canonicalWaveExpectation.sameFrameShatters}`,
        acceptedAtStressFrame: `>=${canonicalWaveExpectation.sameFrameShatters}`,
      },
      comparator: "contains",
    },
  ];
  return checks;
}

function budgetCheck(id, actual, limit, comparator) {
  return {
    id,
    passed: comparator === "eq" ? actual === limit : actual <= limit,
    actual,
    limit,
    comparator,
  };
}

function summarizeTiming(frameTimesMs, totalProbeTimeMs, budgets) {
  const sorted = [...frameTimesMs].sort((left, right) => left - right);
  const sum = frameTimesMs.reduce((total, value) => total + value, 0);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const max = sorted.at(-1) ?? 0;
  return {
    scope: "NODE_BUDGET_CONTROLLER_ONLY_NO_GPU_RENDER",
    totalProbeTimeMs: round(totalProbeTimeMs, 3),
    meanFrameMs: round(sum / Math.max(frameTimesMs.length, 1), 4),
    p50FrameMs: round(p50, 4),
    p95FrameMs: round(p95, 4),
    p99FrameMs: round(p99, 4),
    maxFrameMs: round(max, 4),
    targetFrameMs: round(budgets.frameTimeMs, 3),
    p95WithinTarget: p95 <= budgets.frameTimeMs,
    authoritativeForRenderFps: false,
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value, digits) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}
