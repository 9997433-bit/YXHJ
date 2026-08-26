/**
 * THE reaction table (GDD §7.2: "all combos go through one data-driven
 * reaction table, no hard-coded branches").
 *
 * Read top to bottom, this file is the complete answer to "what happens when
 * X hits Y". Every row is data: the engine in `../reaction/engine.ts` knows
 * how to walk rows, and knows nothing about ice, fire, or lightning.
 *
 * The three rows that match an incoming hit share the `hit_match` mutex and run
 * in the fixed order `fire_thaw > ice_shatter > oil_ignite`: one hit matches at
 * most one of them (docs/SYSTEMS.md `evaluation_order`). That ordering is what
 * makes a flamethrower thaw a frozen enemy instead of shattering it — the
 * deliberate anti-combo of GDD §7.3.2. `conduct` sits outside the mutex because
 * it is decided when the coil locks its target, not when the hit lands.
 */

import type { ReactionRow, ReactionTable } from '../reaction/spec';
import {
  BURN_DURATION,
  CHILL_STACKS_TO_FREEZE,
  CONDUCT_BONUS_JUMPS,
  CONDUCT_FALLOFF,
  FIRE_FIELD_DURATION,
  FIRE_VS_FROZEN_DAMAGE_MULTIPLIER,
  FREEZE_DURATION,
  OIL_COATING_DURATION,
  OVERHEAT_DURATION,
  OVERLOAD_ATTACK_SPEED_MUL,
  OVERLOAD_BATTERY_COST,
  OVERLOAD_DURATION,
  OVERLOAD_RADIUS,
  SHATTER_DAMAGE_MULTIPLIER,
  SHATTER_DAMAGE_THRESHOLD,
  SHATTER_SPLASH_FACTOR,
  SHATTER_SPLASH_RADIUS,
  SHATTER_HITSTOP_MS,
  TAR_SLOW_MULTIPLIER,
  ULTIMATE_EMP_STUN,
  ULTIMATE_OVERLOAD_DURATION,
  WET_DURATION,
} from './tuning';

/**
 * Mutex shared by the rows that match an incoming hit, so exactly one of them
 * can claim it (docs/SYSTEMS.md: "命中一行即停").
 */
const HIT_MATCH = 'hit_match';

/**
 * Parameter keys the triggers publish. Rows read them through
 * `{ param, fallback }`; towers and their upgrades write them.
 */
export const REACTION_PARAMS = {
  /** Written by the condenser's chill; read by `chill_to_freeze`. */
  freezeDuration: 'freezeDuration',
  /** Written by the flamethrower's cone sweep; read by `oil_cell_ignites`. */
  fireFieldDuration: 'fireFieldDuration',
  burnDuration: 'burnDuration',
  /** Written by the tar slick; read by `oil_cell_coats`. */
  slowMul: 'slowMul',
  oilCoatingDuration: 'oilCoatingDuration',
  /** Written by an ActivationDef; read by the overload rows. */
  batteryCost: 'batteryCost',
  overloadDuration: 'overloadDuration',
  overheatDuration: 'overheatDuration',
  overloadRadius: 'overloadRadius',
} as const;

// ---------------------------------------------------------------------------
// Combo 1 — 冰碎 / Shatter (GDD §7.3.1)
// ---------------------------------------------------------------------------

const chillToFreeze: ReactionRow = {
  id: 'chill_to_freeze',
  trigger: 'on_status_changed',
  priority: 100,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'changedStatusIs', status: 'chilled' },
      { kind: 'targetHasStatus', status: 'chilled', minStacks: CHILL_STACKS_TO_FREEZE },
      { kind: 'targetLacksStatus', status: 'frozen' },
    ],
  },
  effects: [
    { kind: 'removeStatus', status: 'chilled', reason: 'consumed' },
    {
      kind: 'applyStatus',
      status: 'frozen',
      duration: { param: REACTION_PARAMS.freezeDuration, fallback: FREEZE_DURATION },
    },
  ],
  impact: { vfx: 'fx_freeze_shell', sfx: 'sfx_freeze', flash: '#BFF7FF' },
  note: 'GDD §7.3.1 — three chill layers become a 2s freeze.',
};

const fireThaw: ReactionRow = {
  id: 'fire_thaw',
  trigger: 'on_hit',
  // First in the fixed evaluation order fire_thaw > ice_shatter > oil_ignite.
  priority: 300,
  mutex: HIT_MATCH,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'targetHasStatus', status: 'frozen' },
      { kind: 'sourceHasTag', tag: 'fire' },
    ],
  },
  effects: [
    { kind: 'multiplyDamage', factor: FIRE_VS_FROZEN_DAMAGE_MULTIPLIER },
    { kind: 'removeStatus', status: 'frozen', reason: 'cleansed' },
  ],
  impact: { vfx: 'fx_thaw_steam', sfx: 'sfx_steam_hiss', tip: 'tip_fire_thaws_ice' },
  note: 'GDD §7.3.2 anti-combo — fire on ice: thaw and half damage.',
};

const iceShatter: ReactionRow = {
  id: 'ice_shatter',
  combo: 'shatter',
  trigger: 'on_hit',
  priority: 200,
  mutex: HIT_MATCH,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'targetHasStatus', status: 'frozen' },
      // "Single hit of 40 or more", measured on the damage as rolled.
      { kind: 'damageAtLeast', amount: SHATTER_DAMAGE_THRESHOLD, of: 'base' },
      // Splash, damage over time and chain jumps are not single hits.
      { kind: 'sourceLacksTag', tag: 'splash' },
      { kind: 'sourceLacksTag', tag: 'dot' },
      { kind: 'sourceLacksTag', tag: 'chain' },
    ],
  },
  effects: [
    { kind: 'tagCombo', combo: 'shatter', alsoTag: 'shatter' },
    { kind: 'multiplyDamage', factor: SHATTER_DAMAGE_MULTIPLIER },
    { kind: 'ignoreArmor' },
    {
      kind: 'splash',
      radius: SHATTER_SPLASH_RADIUS,
      factor: SHATTER_SPLASH_FACTOR,
      ignoreArmor: true,
      damageType: 'cold',
      tags: ['ice', 'splash'],
      // Derived damage is inert: no chain-reaction explosions.
      canTriggerReactions: false,
    },
    { kind: 'removeStatus', status: 'frozen', reason: 'consumed' },
  ],
  impact: {
    // The stable name src/vfx binds to; renaming this row must not reach it.
    signal: 'ice_shatter',
    vfx: 'fx_shatter',
    sfx: 'sfx_shatter_glass',
    hitstop: SHATTER_HITSTOP_MS,
    flash: '#BFF7FF',
    tip: 'tip_shatter',
  },
  note: 'GDD §7.3.1 — 250% armour-ignoring damage plus a one-cell splash.',
};

const leviathanPlateBreak: ReactionRow = {
  id: 'leviathan_plate_break',
  trigger: 'on_hit',
  // Runs after `shatter` in the same pass so it can see the tag it just added.
  priority: 50,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'targetHasFlag', flag: 'armor_plated' },
      { kind: 'sourceHasTag', tag: 'shatter' },
    ],
  },
  effects: [{ kind: 'applyStatus', status: 'armor_broken', stacks: 1 }],
  impact: { vfx: 'fx_plate_break', sfx: 'sfx_plate_break', shake: 'light' },
  note: 'GDD §8.2 P1 — shatter knocks an armour plate off the Leviathan.',
};

// ---------------------------------------------------------------------------
// Combo 2 — 油火 / Oil fire (GDD §7.3.2)
// ---------------------------------------------------------------------------

const oilIgnite: ReactionRow = {
  id: 'oil_ignite',
  combo: 'oil_fire',
  trigger: 'on_hit',
  priority: 100,
  mutex: HIT_MATCH,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'targetHasStatus', status: 'oil' },
      { kind: 'sourceHasTag', tag: 'fire' },
    ],
  },
  effects: [
    { kind: 'tagCombo', combo: 'oil_fire' },
    {
      kind: 'applyStatus',
      status: 'burning',
      duration: { param: REACTION_PARAMS.burnDuration, fallback: BURN_DURATION },
    },
  ],
  impact: {
    vfx: 'fx_ignite',
    sfx: 'sfx_ignite_whoosh',
    flash: '#FF7A29',
    tip: 'tip_oil_fire',
  },
  note: 'GDD §7.3.2 — oiled target plus fire equals 8 dmg/s for 4s.',
};

const oilCellIgnites: ReactionRow = {
  id: 'oil_cell_ignites',
  combo: 'oil_fire',
  trigger: 'on_cell_swept',
  priority: 100,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'sourceHasTag', tag: 'fire' },
      { kind: 'cellCoatingIs', coating: 'oil' },
    ],
  },
  effects: [
    {
      kind: 'paintCell',
      coating: 'fire',
      duration: { param: REACTION_PARAMS.fireFieldDuration, fallback: FIRE_FIELD_DURATION },
    },
  ],
  impact: { vfx: 'fx_fire_field', sfx: 'sfx_fire_field_ignite' },
  note: 'GDD §7.3.2 — flame sweeping a slick turns it into a 5s fire field.',
};

const fireFieldBurns: ReactionRow = {
  id: 'fire_field_burns',
  combo: 'oil_fire',
  trigger: 'on_cell_entered',
  priority: 100,
  when: { kind: 'cellCoatingIs', coating: 'fire' },
  effects: [{ kind: 'applyStatus', status: 'burning', duration: BURN_DURATION }],
  impact: { vfx: 'fx_ignite', sfx: 'sfx_ignite_whoosh' },
  note: 'GDD §7.3.2 — anything crossing a fire field catches fire.',
};

const oilCellCoats: ReactionRow = {
  id: 'oil_cell_coats',
  trigger: 'on_cell_entered',
  priority: 90,
  when: { kind: 'cellCoatingIs', coating: 'oil' },
  effects: [
    {
      kind: 'applyStatus',
      status: 'oil',
      duration: { param: REACTION_PARAMS.oilCoatingDuration, fallback: OIL_COATING_DURATION },
    },
    {
      kind: 'applyStatus',
      status: 'slowed',
      duration: 1,
      // Strength comes from the slick, so the tar tower's viscous upgrade
      // changes 30% to 40% without touching this row.
      modifiers: { speedMul: { param: REACTION_PARAMS.slowMul, fallback: TAR_SLOW_MULTIPLIER } },
    },
  ],
  impact: { vfx: 'fx_oil_step' },
  note: 'GDD §7.1 — the slick coats and slows whatever walks through it.',
};

// ---------------------------------------------------------------------------
// Combo 3 — 导电 / Conduct (GDD §7.3.3)
// ---------------------------------------------------------------------------

const puddleWets: ReactionRow = {
  id: 'puddle_wets',
  trigger: 'on_cell_entered',
  priority: 80,
  when: { kind: 'cellTerrainIs', terrain: 'water' },
  effects: [{ kind: 'applyStatus', status: 'wet', duration: WET_DURATION }],
  impact: { vfx: 'fx_wet_splash' },
  note: 'GDD §5.1 — puddles tag enemies wet for 6s, which feeds conduct.',
};

const conduct: ReactionRow = {
  id: 'conduct',
  combo: 'conduct',
  trigger: 'on_hit',
  // Outside the HIT_MATCH mutex on purpose: conduct is decided when the coil
  // locks its primary target, so it does not consume the hit's match slot.
  priority: 50,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'targetHasStatus', status: 'wet' },
      { kind: 'sourceHasTag', tag: 'lightning' },
    ],
  },
  effects: [
    { kind: 'tagCombo', combo: 'conduct' },
    { kind: 'chainBonus', extraJumps: CONDUCT_BONUS_JUMPS, falloffOverride: CONDUCT_FALLOFF },
  ],
  impact: {
    vfx: 'fx_conduct_arc',
    sfx: 'sfx_conduct_crack',
    flash: '#35E0FF',
    tip: 'tip_conduct',
  },
  note: 'GDD §7.3.3 — a wet target adds two jumps and removes the falloff.',
};

// ---------------------------------------------------------------------------
// Combo 4 — 超载 / Overload (GDD §7.3.4) and the §9 ultimate
// ---------------------------------------------------------------------------

const overload: ReactionRow = {
  id: 'overload',
  combo: 'overload',
  trigger: 'on_activate',
  priority: 100,
  when: {
    kind: 'allOf',
    of: [
      { kind: 'activationIs', activation: 'capacitor_overload' },
      {
        kind: 'batteryAtLeast',
        amount: { param: REACTION_PARAMS.batteryCost, fallback: OVERLOAD_BATTERY_COST },
      },
    ],
  },
  effects: [
    {
      kind: 'consumeBattery',
      amount: { param: REACTION_PARAMS.batteryCost, fallback: OVERLOAD_BATTERY_COST },
    },
    {
      kind: 'overloadTowers',
      scope: 'radius',
      radius: { param: REACTION_PARAMS.overloadRadius, fallback: OVERLOAD_RADIUS },
      attackSpeedMul: OVERLOAD_ATTACK_SPEED_MUL,
      duration: { param: REACTION_PARAMS.overloadDuration, fallback: OVERLOAD_DURATION },
      overheat: { param: REACTION_PARAMS.overheatDuration, fallback: OVERHEAT_DURATION },
      poweredTowersOnly: true,
    },
  ],
  impact: {
    vfx: 'fx_overload_ring',
    sfx: 'sfx_overload_surge',
    flash: '#35E0FF',
    tip: 'tip_overload',
  },
  note: 'GDD §7.3.4 — 20 battery for +100% fire rate over 6s, then 3s offline.',
};

const masterOverload: ReactionRow = {
  id: 'master_overload',
  trigger: 'on_activate',
  priority: 100,
  when: { kind: 'activationIs', activation: 'master_overload' },
  effects: [
    {
      kind: 'overloadTowers',
      scope: 'global',
      attackSpeedMul: OVERLOAD_ATTACK_SPEED_MUL,
      duration: ULTIMATE_OVERLOAD_DURATION,
      // The ultimate's whole point: overload with no overheat bill afterwards.
      overheat: 0,
      poweredTowersOnly: true,
    },
    { kind: 'stunEnemies', scope: 'global', duration: ULTIMATE_EMP_STUN },
  ],
  impact: {
    vfx: 'fx_master_overload_wave',
    sfx: 'sfx_emp_wave',
    hitstop: 80,
    flash: '#35E0FF',
    shake: 'light',
  },
  note: 'GDD §9 — free global overload plus a 1.5s EMP freeze on every enemy.',
};

export const REACTION_TABLE: ReactionTable = [
  // Combo 1 — shatter
  chillToFreeze,
  fireThaw,
  iceShatter,
  leviathanPlateBreak,
  // Combo 2 — oil fire
  oilIgnite,
  oilCellIgnites,
  fireFieldBurns,
  oilCellCoats,
  // Combo 3 — conduct
  puddleWets,
  conduct,
  // Combo 4 — overload
  overload,
  masterOverload,
];
