/**
 * Status table (GDD §7.2).
 *
 * The two anti-slop rules are enforced here as data:
 *   - `group: 'coating'`       — wet and oil evict each other, latest wins.
 *   - `group: 'reaction_state'`— frozen and burning evict and cancel each other.
 *
 * Colours are the GDD §15.2 palette; the UI status ring and the particle
 * systems both read them from here so they cannot drift apart.
 */

import type { StatusDef } from '../status/statusDef';
import {
  BURN_DPS,
  BURN_DURATION,
  CHILL_IMMUNITY_DURATION,
  CHILL_STACK_DECAY,
  CHILL_STACKS_TO_FREEZE,
  FREEZE_DURATION,
  OIL_COATING_DURATION,
  TAR_SLOW_MULTIPLIER,
  ULTIMATE_EMP_STUN,
  WET_DURATION,
} from './tuning';

export const PALETTE = {
  electric: '#35E0FF',
  fire: '#FF7A29',
  ice: '#BFF7FF',
  oil: '#6B4A2B',
  gold: '#FFD84D',
  alarm: '#FF3B30',
} as const;

export const STATUS_DEFS: readonly StatusDef[] = [
  {
    id: 'wet',
    displayName: '湿',
    kind: 'coating',
    group: 'coating',
    maxStacks: 1,
    defaultDuration: WET_DURATION,
    refresh: 'refresh',
    ui: { icon: 'status_wet', color: PALETTE.electric },
    note: 'GDD §5.1 / §7.3.3 — from condenser spray or a puddle; feeds conduct.',
  },
  {
    id: 'oil',
    displayName: '油',
    kind: 'coating',
    group: 'coating',
    maxStacks: 1,
    defaultDuration: OIL_COATING_DURATION,
    refresh: 'refresh',
    ui: { icon: 'status_oil', color: PALETTE.oil },
    note: 'GDD §7.3.2 — overwrites wet; ignites into burning when hit by fire.',
  },
  {
    id: 'chilled',
    displayName: '湿冷',
    kind: 'modifier',
    maxStacks: CHILL_STACKS_TO_FREEZE,
    defaultDuration: CHILL_STACK_DECAY,
    refresh: 'refresh',
    // Layers peel off one at a time rather than all at once, so stepping out
    // of the spray for a moment does not reset the whole build-up.
    decay: 'one_stack',
    ui: { icon: 'status_chill', color: PALETTE.ice },
    note: 'GDD §7.3.1 — condenser adds one layer per tick; three layers freeze.',
  },
  {
    id: 'frozen',
    displayName: '冻结',
    kind: 'reaction_state',
    group: 'reaction_state',
    maxStacks: 1,
    defaultDuration: FREEZE_DURATION,
    refresh: 'refresh',
    // Chill cannot be re-applied to something already frozen.
    blocks: ['chilled'],
    modifiers: { immobile: true, suppressBehaviour: true },
    // However the freeze ends — expiry, shatter, or a thaw — the target gets a
    // grace window. This is the whole anti perma-freeze rule (GDD §7.3.1).
    onEnd: [
      {
        kind: 'applyStatus',
        status: 'chill_immune',
        duration: CHILL_IMMUNITY_DURATION,
      },
    ],
    ui: { icon: 'status_frozen', color: PALETTE.ice },
    note: 'GDD §7.3.1 — shatter-primed; a single hit of 40+ breaks it open.',
  },
  {
    id: 'burning',
    displayName: '点燃',
    kind: 'reaction_state',
    group: 'reaction_state',
    maxStacks: 1,
    defaultDuration: BURN_DURATION,
    // "Refresh, do not stack" is called out explicitly in the GDD.
    refresh: 'refresh',
    dot: { dps: BURN_DPS, damageType: 'fire', tags: ['fire', 'dot'], ignoreArmor: true },
    ui: { icon: 'status_burning', color: PALETTE.fire },
    note: 'GDD §7.3.2 — 8 dmg/s for 4s, ignores armour, cancels frozen.',
  },
  {
    id: 'slowed',
    displayName: '减速',
    kind: 'modifier',
    maxStacks: 1,
    defaultDuration: 1,
    refresh: 'refresh',
    // Two slows do not multiply; the stronger one wins.
    modifierMerge: 'strongest',
    modifiers: { speedMul: TAR_SLOW_MULTIPLIER },
    ui: { icon: 'status_slow', color: PALETTE.oil },
    note: 'GDD §7.1 — the slick refreshes this every time the enemy re-enters it.',
  },
  {
    id: 'stunned',
    displayName: 'EMP',
    kind: 'modifier',
    maxStacks: 1,
    defaultDuration: ULTIMATE_EMP_STUN,
    refresh: 'refresh',
    modifiers: { immobile: true, suppressBehaviour: true },
    ui: { icon: 'status_emp', color: PALETTE.electric },
    note: 'GDD §9 — the master overload freezes the battlefield for 1.5s.',
  },
  {
    id: 'chill_immune',
    displayName: '抗冻',
    kind: 'modifier',
    maxStacks: 1,
    defaultDuration: CHILL_IMMUNITY_DURATION,
    refresh: 'refresh',
    // Blocks the layers *and* a directly applied freeze; leaves `wet` alone so
    // the conduct combo still works on a target that just thawed.
    blocks: ['chilled', 'frozen'],
    ui: { icon: 'status_chill_immune', color: PALETTE.ice },
    note: 'GDD §7.3.1 — the 3s window that makes perma-freeze impossible.',
  },
  {
    id: 'armor_broken',
    displayName: '装甲破损',
    kind: 'modifier',
    maxStacks: 4,
    defaultDuration: Number.POSITIVE_INFINITY,
    refresh: 'ignore',
    perStackModifiers: { damageTakenMul: 1.25 },
    ui: { icon: 'status_armor_broken', color: PALETTE.alarm },
    note: 'GDD §8.2 P1 — each shatter knocks a plate off the Leviathan.',
  },
];
