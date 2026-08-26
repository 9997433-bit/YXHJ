export const DEFAULT_BUDGETS = Object.freeze({
  activeEmitters: 64,
  loopingEmitters: 24,
  burstEmitters: 40,
  gpuParticles: 20_000,
  dynamicPointLights: 8,
  targetFps: 60,
  frameTimeMs: 1000 / 60,
});

const PRIORITY = Object.freeze({
  environment: 0,
  gameplay: 1,
  combo: 2,
  event: 3,
});

export const EFFECTS = Object.freeze({
  ambient_dust: loopEffect("environment", 24, 1.5),
  geothermal_steam: loopEffect("environment", 36, 1.2),
  oil_bubbles: loopEffect("environment", 3, 1.0),
  wet_drips: loopEffect("gameplay", 3, 0.8),
  condensation_mist: loopEffect("combo", 100, 1.4),
  burning_enemy: loopEffect("combo", 28, 0.8),
  fire_field: loopEffect("combo", 90, 1.2, { pointLights: 1 }),
  overload_arc: loopEffect("event", 70, 0.3),
  hit_spark: burstEffect("gameplay", 6, 0.12),
  freeze_bloom: burstEffect("combo", 12, 0.3),
  tesla_chain: burstEffect("combo", 6, 0.2, { pointLights: 1 }),
  conductive_chain: burstEffect("combo", 18, 0.2, {
    pointLights: 1,
    protectedParticles: true,
  }),
  // Production ice shatter: 24 shards + core + ring + 14 frost motes.
  shatter: burstEffect("event", 40, 0.9, { protectedParticles: true }),
  demolition_explosion: burstEffect("event", 16, 0.5, {
    pointLights: 1,
    protectedParticles: true,
  }),
  coin_flow: burstEffect("gameplay", 8, 1.0),
  ultimate_ring: burstEffect("event", 128, 0.5, {
    pointLights: 1,
    protectedParticles: true,
  }),
  emp_noise: burstEffect("event", 80, 1.5, { protectedParticles: true }),
});

export function validateBudgets(budgets) {
  for (const [name, value] of Object.entries(budgets)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Budget "${name}" must be a positive finite number.`);
    }
  }
}

export function createSource(effectId, instanceId, startFrame, endFrame) {
  const effect = EFFECTS[effectId];
  if (!effect) {
    throw new RangeError(`Unknown VFX effect "${effectId}".`);
  }
  return {
    effectId,
    instanceId,
    startFrame,
    endFrame,
    ...effect,
  };
}

export function evaluateFrame(sources, frame, budgets = DEFAULT_BUDGETS) {
  const active = sources.filter(
    (source) => source.startFrame <= frame && source.endFrame >= frame,
  );
  const demand = summarizeDemand(active);
  const looping = active.filter((source) => source.mode === "loop");
  const bursts = active.filter((source) => source.mode === "burst");

  const acceptedLoops = selectEmitters(looping, budgets.loopingEmitters);
  const acceptedBursts = selectEmitters(bursts, budgets.burstEmitters);
  let accepted = [...acceptedLoops.accepted, ...acceptedBursts.accepted];
  const emitterRejected = [
    ...acceptedLoops.rejected,
    ...acceptedBursts.rejected,
  ];

  if (accepted.length > budgets.activeEmitters) {
    const totalSelection = selectEmitters(accepted, budgets.activeEmitters);
    accepted = totalSelection.accepted;
    emitterRejected.push(...totalSelection.rejected);
  }

  const particleState = applyParticlePolicy(accepted, budgets.gpuParticles);
  const lightState = applyLightPolicy(
    particleState.accepted,
    budgets.dynamicPointLights,
  );
  const protectedDrops = emitterRejected.filter(
    (source) => source.protectedParticles,
  );

  return {
    demand,
    actual: {
      activeEmitters: particleState.accepted.length,
      loopingEmitters: particleState.accepted.filter(
        (source) => source.mode === "loop",
      ).length,
      burstEmitters: particleState.accepted.filter(
        (source) => source.mode === "burst",
      ).length,
      gpuParticles: particleState.particles,
      dynamicPointLights: lightState.realLights,
    },
    policy: {
      emitterDrops: emitterRejected.length + particleState.dropped.length,
      environmentDrops:
        emitterRejected.filter((source) => source.priority === "environment")
          .length +
        particleState.dropped.filter(
          (source) => source.priority === "environment",
        ).length,
      loopRateReductions: particleState.rateReduced.length,
      pointLightFallbacks: lightState.fallbackLights,
      protectedParticleDrops:
        protectedDrops.length + particleState.protectedDrops.length,
      sameTypeLoopLodGroups: countSameTypeLoopLodGroups(
        particleState.accepted,
      ),
    },
    acceptedEffectCounts: countEffects(particleState.accepted),
  };
}

function loopEffect(priority, emissionRate, particleLifetime, options = {}) {
  return Object.freeze({
    mode: "loop",
    priority,
    priorityRank: PRIORITY[priority],
    emissionRate,
    particleLifetime,
    particles: Math.ceil(emissionRate * particleLifetime),
    durationSeconds: Number.POSITIVE_INFINITY,
    pointLights: 0,
    protectedParticles: false,
    ...options,
  });
}

function burstEffect(priority, particles, durationSeconds, options = {}) {
  return Object.freeze({
    mode: "burst",
    priority,
    priorityRank: PRIORITY[priority],
    particles,
    durationSeconds,
    pointLights: 0,
    protectedParticles: false,
    ...options,
  });
}

function summarizeDemand(active) {
  return {
    activeEmitters: active.length,
    loopingEmitters: active.filter((source) => source.mode === "loop").length,
    burstEmitters: active.filter((source) => source.mode === "burst").length,
    gpuParticles: active.reduce(
      (total, source) => total + source.particles,
      0,
    ),
    dynamicPointLights: active.reduce(
      (total, source) => total + source.pointLights,
      0,
    ),
  };
}

function selectEmitters(sources, limit) {
  const sorted = [...sources].sort(compareImportance);
  return {
    accepted: sorted.slice(0, limit),
    rejected: sorted.slice(limit),
  };
}

function compareImportance(left, right) {
  return (
    right.priorityRank - left.priorityRank ||
    Number(right.protectedParticles) - Number(left.protectedParticles) ||
    right.startFrame - left.startFrame ||
    left.instanceId.localeCompare(right.instanceId)
  );
}

function applyParticlePolicy(sources, particleLimit) {
  const scales = new Map(sources.map((source) => [source.instanceId, 1]));
  const sameTypeGroups = groupBy(
    sources.filter((source) => source.mode === "loop"),
    (source) => source.effectId,
  );

  for (const group of sameTypeGroups.values()) {
    if (group.length > 10) {
      for (const source of group) {
        scales.set(source.instanceId, 0.5);
      }
    }
  }

  const dropped = [];
  const accepted = [...sources];
  let particles = countParticles(accepted, scales);

  const environmentCandidates = accepted
    .filter(
      (source) =>
        source.priority === "environment" && !source.protectedParticles,
    )
    .sort((left, right) => right.particles - left.particles);

  while (particles > particleLimit && environmentCandidates.length > 0) {
    const source = environmentCandidates.shift();
    accepted.splice(accepted.indexOf(source), 1);
    dropped.push(source);
    particles = countParticles(accepted, scales);
  }

  const rateReduced = [];
  if (particles > particleLimit) {
    const reducibleLoops = accepted.filter(
      (source) => source.mode === "loop" && !source.protectedParticles,
    );
    for (const scale of [0.25, 0.125]) {
      for (const source of reducibleLoops) {
        if ((scales.get(source.instanceId) ?? 1) > scale) {
          scales.set(source.instanceId, scale);
          rateReduced.push(source);
        }
      }
      particles = countParticles(accepted, scales);
      if (particles <= particleLimit) {
        break;
      }
    }
  }

  return {
    accepted,
    dropped,
    rateReduced: uniqueByInstance(rateReduced),
    protectedDrops: dropped.filter((source) => source.protectedParticles),
    particles,
  };
}

function applyLightPolicy(sources, lightLimit) {
  const requests = sources
    .flatMap((source) =>
      Array.from({ length: source.pointLights }, (_, index) => ({
        source,
        index,
      })),
    )
    .sort((left, right) => compareImportance(left.source, right.source));
  return {
    realLights: Math.min(requests.length, lightLimit),
    fallbackLights: Math.max(0, requests.length - lightLimit),
  };
}

function countParticles(sources, scales) {
  return Math.ceil(
    sources.reduce(
      (total, source) =>
        total + source.particles * (scales.get(source.instanceId) ?? 1),
      0,
    ),
  );
}

function countEffects(sources) {
  return Object.fromEntries(
    [...groupBy(sources, (source) => source.effectId).entries()]
      .map(([effectId, group]) => [effectId, group.length])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function countSameTypeLoopLodGroups(sources) {
  return [...groupBy(
    sources.filter((source) => source.mode === "loop"),
    (source) => source.effectId,
  ).values()].filter((group) => group.length > 10).length;
}

function uniqueByInstance(sources) {
  return [...new Map(sources.map((source) => [source.instanceId, source])).values()];
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}
