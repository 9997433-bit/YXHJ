/**
 * `Sim` + `Interaction` → `HudState`, and HUD callbacks → commands.
 *
 * The HUD holds no game state of its own (see `src/ui/hudState.ts`), so this is
 * where the two vocabularies meet. Built fresh every frame: the state object is
 * a couple of dozen numbers and the components already diff their own DOM, so
 * caching here would buy nothing and cost a stale-field class of bug.
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
import type { TowerDef } from '../combat';

import { COMBO_TIP_IDS, ECONOMY_DEFAULTS, ENEMY_ICONS, M1_BUILD_MENU } from './config';
import type { Interaction } from './interaction';
import type { Sim, SimPhase } from './sim';

/** Range in cells, or 0 for buildings that never shoot. */
export function towerRange(def: TowerDef): number {
  return def.attack.kind === 'none' ? 0 : def.attack.range;
}

export function towerTargetsAir(def: TowerDef): boolean {
  return def.attack.kind === 'none' ? false : def.attack.targetsAir;
}

/** How long a rejected build or a wave payout stays on the radio line. */
const NOTICE_MS = 2600;

export class HudBridge {
  readonly hud: Hud;

  private notice: { line: string; id: string; until: number } | null = null;
  private deliveredPhase: SimPhase | null = null;

  constructor(
    container: HTMLElement,
    private readonly sim: Sim,
    private readonly interaction: Interaction,
  ) {
    this.hud = new Hud(container, {
      onBuildSelect: (id) => this.interaction.selectBlueprint(id),
      onCallWaveEarly: () => this.sim.enqueue({ kind: 'start_wave', early: true }),
      onEngineering: (kind) => this.interaction.arm(kind),
      onSell: (towerId) => {
        this.sim.enqueue({ kind: 'sell', towerId: Number(towerId) });
        this.interaction.selectTower(null);
      },
      onCloseInspector: () => this.interaction.selectTower(null),
    });
  }

  /**
   * Puts a one-off line on the radio bubble.
   *
   * Rejections need somewhere to go — a build that silently does nothing is the
   * fastest way to make a greybox feel broken — and the radio is the channel
   * §14 already gives us for prose. Re-notifying with the same `id` refreshes
   * the timer instead of retriggering the bubble's entry animation.
   */
  notify(line: string, id: string): void {
    this.notice = { line, id, until: performance.now() + NOTICE_MS };
  }

  /**
   * Expiry is an absolute wall-clock deadline rather than an accumulated frame
   * delta: the loop clamps its delta to survive stalls, so on a slow machine a
   * summed timer runs behind real time and the notice overstays.
   */
  tick(): void {
    if (this.notice && performance.now() >= this.notice.until) this.notice = null;
  }

  showComboTip(comboId: string): void {
    // `ComboToast` looks the id straight up in its tip table and throws on a
    // miss, so an unmapped combo has to stop here rather than take the frame
    // down with it.
    const uiId = COMBO_TIP_IDS[comboId];
    if (uiId) this.hud.showComboTip(uiId);
  }

  build(): HudState {
    const { sim } = this;
    const state = createEmptyHudState();
    const economy = sim.economy;
    const waves = sim.world.waves;

    state.gold = Math.floor(economy.gold);
    state.wave = {
      current: waves.waveNumber,
      total: waves.totalWaves,
      inProgress: sim.phase === 'wave',
    };
    state.nextWave = {
      preview: this.preview(),
      earlyBonusPercent: ECONOMY_DEFAULTS.earlyBonusPercent,
      canCallEarly: sim.canStartWave,
    };
    state.power = {
      used: economy.powerUsed,
      cap: economy.powerCap,
      deficit: economy.powerDeficit,
    };
    state.battery = {
      value: Math.floor(economy.battery),
      max: economy.batteryMax,
      overloadCost: ECONOMY_DEFAULTS.overloadCost,
    };
    state.integrity = {
      value: Math.max(0, Math.round(economy.integrity)),
      max: ECONOMY_DEFAULTS.integrityMax,
      thresholds: sim.world.grid.zones.map((zone) => ({
        value: zone.def.triggerIntegrity,
        label: zone.def.label ?? zone.id,
        lost: !zone.powered,
      })),
    };
    state.build = this.buildItems();
    state.selectedBuildId = this.interaction.selectedBuildId;
    state.engineering = {
      digLeft: sim.world.engineering.digLeft,
      bridgeLeft: sim.world.engineering.bridgeLeft,
      digCost: sim.world.engineering.config.digCost,
      bridgeCost: sim.world.engineering.config.bridgeCost,
      armed: this.interaction.armed,
    };
    state.inspector = this.inspector();
    state.radio = this.radio();
    return state;
  }

  private buildItems(): BuildItemState[] {
    return M1_BUILD_MENU.map((entry) => {
      const def = this.sim.towerDef(entry.defId);
      return {
        id: def.id,
        name: def.displayName,
        icon: entry.icon,
        cost: def.cost,
        powerCost: def.powerCost,
        targetsAir: towerTargetsAir(def),
        unlocked: true,
        hotkey: entry.hotkey,
      };
    });
  }

  private preview(): WavePreviewEntry[] {
    return this.sim.world.waves.nextPreview.map((entry) => ({
      defId: entry.enemy,
      icon: (ENEMY_ICONS[entry.enemy] ?? 'enemy-bug') as IconName,
      count: entry.count,
      air: entry.air,
      ...(entry.threat === 'breaker' ? { threat: 'breaker' as const } : {}),
    }));
  }

  private inspector(): TowerInspectState | null {
    const towerId = this.interaction.selectedTowerId;
    if (towerId === null) return null;
    const tower = this.sim.combat.getTower(towerId);
    if (!tower) return null;

    const def = tower.baseDef;
    const menuEntry = M1_BUILD_MENU.find((entry) => entry.defId === def.id);
    const range = towerRange(def);
    const stats: TowerInspectState['stats'] = [
      { label: '状态', value: STATE_LABELS[tower.state] },
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
      icon: (menuEntry?.icon ?? 'tower-rivet') as IconName,
      level: tower.upgradeId ? 1 : 0,
      stats,
      // Upgrades are M2 (GDD §19); the panel renders an empty list cleanly.
      upgrades: [],
      priority: tower.targetStrategy,
      sellRefund: Math.floor(def.cost * 0.7),
    };
  }

  /**
   * `RadioBubble` re-shows any line whose id it has not just seen, so a phase
   * line has to be handed over exactly once per phase entry — otherwise every
   * rejected build would be followed by the deploy hint popping back up.
   */
  private radio(): HudState['radio'] {
    if (this.notice) return { speaker: '老周', line: this.notice.line, id: this.notice.id };
    if (this.deliveredPhase === this.sim.phase) return null;
    this.deliveredPhase = this.sim.phase;

    switch (this.sim.phase) {
      case 'defeat':
        return { speaker: '老周', line: '完整度归零，这局到此为止。刷新页面再来。', id: 'defeat' };
      case 'victory':
        return { speaker: '老周', line: '十波撑过去了，垂直切片到此为止。', id: 'victory' };
      case 'deploy':
        return {
          speaker: '老周',
          line: '点建造项再点地基放塔。冷凝把它冻住，破碎锤一锤下去就是冰碎。',
          id: 'deploy',
        };
      default:
        return null;
    }
  }

  dispose(): void {
    this.hud.dispose();
  }
}

const STATE_LABELS: Record<string, string> = {
  idle: '在线',
  overloaded: '超载中',
  overheated: '过热停机',
  disabled: '被瘫痪',
  unpowered: '断电',
};
