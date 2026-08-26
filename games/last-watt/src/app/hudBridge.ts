/**
 * `SessionSnapshot` → `HudState`, and HUD callbacks → `CommandCenter` calls.
 *
 * `GameSession` already answers every resource question the HUD asks
 * (INTEGRATION.md §4.2-3), so this is a rename layer rather than a second model
 * — the only thing it computes is the tower inspector, which reads the combat
 * entity because per-instance state (heat, damage dealt, target priority) never
 * enters the gameplay snapshot.
 *
 * Rebuilt every frame: the state object is a few dozen numbers and the
 * components diff their own DOM, so caching would buy nothing and cost a
 * stale-field class of bug.
 */

import {
  Hud,
  createEmptyHudState,
  type BuildItemState,
  type HudState,
  type IconName,
  type TowerInspectState,
  type WavePreviewEntry,
} from '../ui';
import type { CombatSystem, TowerDef } from '../combat';
import type {
  GameSession,
  RunStatus,
  WavePreviewEntry as WavePlanEntry,
} from '../gameplay';

import { ENEMY_ICONS, M1_BUILD_MENU, TOWER_ICONS } from './config';
import type { Interaction } from './interaction';

/** How long a rejected command or a wave payout stays on the radio line. */
const NOTICE_MS = 2600;

const M1_DEF_IDS = new Set(M1_BUILD_MENU.map((entry) => entry.defId));
const HOTKEYS = new Map(M1_BUILD_MENU.map((entry) => [entry.defId, entry.hotkey]));

const STATE_LABELS: Record<string, string> = {
  idle: '在线',
  overloaded: '超载中',
  overheated: '过热停机',
  disabled: '被瘫痪',
  unpowered: '断电',
};

/** Range in cells, or 0 for buildings that never shoot. */
export function towerRange(def: TowerDef): number {
  return def.attack.kind === 'none' ? 0 : def.attack.range;
}

export class HudBridge {
  readonly hud: Hud;

  private notice: { line: string; id: string; until: number } | null = null;
  private deliveredStatus: RunStatus | null = null;

  constructor(
    container: HTMLElement,
    private readonly session: GameSession,
    private readonly combat: CombatSystem,
    private readonly interaction: Interaction,
  ) {
    const commands = session.commands;
    this.hud = new Hud(container, {
      onBuildSelect: (id) => this.run(commands.selectBuild(id)),
      onCallWaveEarly: () => this.run(commands.startWave({ early: true })),
      onEngineering: (kind) => this.run(kind === 'dig' ? commands.armDig() : commands.armBridge()),
      onUltimate: () => this.run(commands.ultimate()),
      onSell: (towerId) => {
        this.run(commands.sell(Number(towerId)));
        this.interaction.selectedTowerId = null;
      },
      onTargetPriority: (towerId, priority) => {
        const tower = this.combat.getTower(Number(towerId));
        if (tower) tower.targetStrategy = priority;
      },
      onCloseInspector: () => {
        this.interaction.selectedTowerId = null;
      },
    });
  }

  /** Surfaces a refused command; successes are their own feedback. */
  run(result: { ok: boolean; message: string }): boolean {
    if (!result.ok && result.message) this.notify(result.message, `reject:${result.message}`);
    return result.ok;
  }

  /**
   * Puts a one-off line on the radio bubble.
   *
   * Refusals need somewhere to go — a click that silently does nothing is the
   * fastest way to make a greybox feel broken — and the radio is the channel
   * §14 already gives us for prose.
   */
  notify(line: string, id: string): void {
    this.notice = { line, id, until: performance.now() + NOTICE_MS };
  }

  showComboTip(comboId: string): void {
    // Canonical ids since INTEGRATION §3.6; the toast drops anything it does
    // not recognise rather than throwing.
    this.hud.showComboTip(comboId);
  }

  /**
   * Expiry is an absolute deadline rather than an accumulated frame delta: the
   * loop clamps its delta to survive stalls, so a summed timer runs behind real
   * time and the notice overstays on a slow machine.
   */
  tick(): void {
    if (this.notice && performance.now() >= this.notice.until) this.notice = null;
  }

  build(): HudState {
    const snapshot = this.session.snapshot();
    const state = createEmptyHudState();

    state.gold = Math.floor(snapshot.gold);
    state.wave = snapshot.wave;
    state.nextWave = {
      preview: snapshot.nextWave.preview.map(toPreviewEntry),
      earlyBonusPercent: snapshot.nextWave.earlyBonusPercent,
      canCallEarly: snapshot.nextWave.canCallEarly,
    };
    state.power = snapshot.power;
    state.battery = snapshot.battery;
    state.integrity = snapshot.integrity;
    state.ultimate = snapshot.ultimate;
    state.engineering = snapshot.engineering;
    state.build = snapshot.build
      .filter((item) => M1_DEF_IDS.has(item.defId))
      .map(toBuildItem);
    state.selectedBuildId = snapshot.selectedBuildId;
    state.inspector = this.inspector();
    state.radio = this.radio(snapshot.status);
    return state;
  }

  private inspector(): TowerInspectState | null {
    const towerId = this.interaction.selectedTowerId;
    if (towerId === null) return null;
    const tower = this.combat.getTower(towerId);
    if (!tower) return null;

    const def = tower.baseDef;
    const range = towerRange(def);
    const stats: TowerInspectState['stats'] = [
      { label: '状态', value: STATE_LABELS[tower.state] ?? tower.state },
      { label: '占电', value: String(def.powerCost) },
    ];
    if (range > 0) stats.push({ label: '射程', value: `${range} 格` });
    if (def.attack.kind === 'melee' || def.attack.kind === 'projectile') {
      stats.push({ label: '伤害', value: String(def.attack.damage) });
    }
    stats.push({ label: '累计伤害', value: String(Math.round(tower.damageDealt)) });

    return {
      towerId: String(tower.id),
      name: def.displayName,
      icon: (TOWER_ICONS[def.id] ?? 'tower-rivet') as IconName,
      level: tower.upgradeId ? 1 : 0,
      stats,
      // Upgrades are M2 (GDD §19); the panel renders an empty list cleanly.
      upgrades: [],
      priority: tower.targetStrategy,
      sellRefund: Math.floor(def.cost * 0.7),
    };
  }

  /**
   * `RadioBubble` re-shows any line whose id it has not just seen, so a status
   * line is handed over exactly once — otherwise every refusal would be
   * followed by the deploy hint popping back up.
   */
  private radio(status: RunStatus): HudState['radio'] {
    if (this.notice) return { speaker: '老周', line: this.notice.line, id: this.notice.id };
    if (this.deliveredStatus === status) return null;
    this.deliveredStatus = status;

    switch (status) {
      case 'lost':
        return { speaker: '老周', line: '完整度归零，这局到此为止。刷新页面再来。', id: 'lost' };
      case 'won':
        return { speaker: '老周', line: '十波撑过去了，垂直切片到此为止。', id: 'won' };
      case 'preparing':
        return {
          speaker: '老周',
          line: '点建造项再点地基放塔。冷凝把它冻住，破碎锤一锤下去就是冰碎。',
          id: 'preparing',
        };
      default:
        return null;
    }
  }

  dispose(): void {
    this.hud.dispose();
  }
}

/**
 * The plan's `threat` is a three-way severity; the HUD's is *which* kind of
 * breaker, so the healer case comes from the class instead.
 */
function toPreviewEntry(entry: WavePlanEntry): WavePreviewEntry {
  const threat =
    entry.class === 'healer' ? 'healer' : entry.threat === 'normal' ? null : 'breaker';

  return {
    defId: entry.enemy,
    icon: (ENEMY_ICONS[entry.enemy] ?? 'enemy-bug') as IconName,
    count: entry.count,
    air: entry.air,
    ...(threat ? { threat } : {}),
    ...(entry.threat === 'boss' ? { label: 'BOSS' } : {}),
  };
}

function toBuildItem(item: {
  defId: string;
  name: string;
  cost: number;
  powerCost: number;
  targetsAir: boolean;
  unlocked: boolean;
}): BuildItemState {
  return {
    id: item.defId,
    name: item.name,
    icon: (TOWER_ICONS[item.defId] ?? 'tower-rivet') as IconName,
    cost: item.cost,
    powerCost: item.powerCost,
    targetsAir: item.targetsAir,
    unlocked: item.unlocked,
    ...(HOTKEYS.has(item.defId) ? { hotkey: HOTKEYS.get(item.defId) as string } : {}),
  };
}
