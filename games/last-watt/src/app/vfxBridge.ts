/**
 * Combat events → particles.
 *
 * The one place in the app that knows both vocabularies. Everything else stays
 * ignorant: combat declares *what happened* (`reaction_triggered` with an
 * `ImpactSpec`), `src/vfx` owns *what it looks like*, and this table is the
 * only join between them.
 *
 * Rows are matched on the reaction row id **and** on the declared `vfx` name,
 * so the binding survives either side renaming one of the two.
 */

import type { CombatSystem, Tower } from '../combat';
import type { EmitterHandle, VfxSystem } from '../vfx';

/** Mid-body height for a hit effect, in world units above the board. */
const BODY_Y = 0.42;

interface ShatterHook {
  (position: { x: number; y: number; z: number }): void;
}

export interface VfxBridgeOptions {
  combat: CombatSystem;
  vfx: VfxSystem;
  /** Fired once per combo per session, for the §14.2 tip bar. */
  onComboFirstSeen?: (comboId: string) => void;
  /** Lets the camera/audio layers react to a shatter without re-parsing rows. */
  onShatter?: ShatterHook;
}

export class VfxBridge {
  private readonly combat: CombatSystem;
  private readonly vfx: VfxSystem;
  private readonly mist = new Map<number, EmitterHandle>();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly options: VfxBridgeOptions) {
    this.combat = options.combat;
    this.vfx = options.vfx;
    this.bind();
  }

  private bind(): void {
    const { combat, vfx } = this;

    this.unsubscribe.push(
      combat.bus.on('reaction_triggered', (event) => {
        const position = { x: event.position.x, y: BODY_Y, z: event.position.y };
        const signature = `${event.rowId}|${event.impact.vfx ?? ''}`;

        if (signature.includes('ice_shatter') || signature.includes('fx_shatter')) {
          vfx.play('ice-shatter', { position, splashRadius: 1 });
          this.options.onShatter?.(position);
          return;
        }
        if (signature.includes('chill_to_freeze') || signature.includes('fx_freeze_shell')) {
          vfx.play('freeze', { position, radius: 0.5 });
          return;
        }
        if (signature.includes('overload')) {
          vfx.play('overload-start', { position, radiusCells: 1.5 });
        }
      }),

      combat.bus.on('combo_first_seen', (event) => {
        this.options.onComboFirstSeen?.(event.comboId);
      }),

      combat.bus.on('tower_fired', (event) => {
        if (event.attackKind !== 'melee') return;
        vfx.play('hammer-impact', {
          position: { x: event.to.x, y: 0.12, z: event.to.y },
          shockwave: false,
        });
      }),

      combat.bus.on('enemy_killed', (event) => {
        vfx.play('unit-death', { position: { x: event.position.x, y: BODY_Y, z: event.position.y } });
      }),

      combat.bus.on('tower_state_changed', (event) => {
        if (event.state !== 'overheated') return;
        const tower = combat.getTower(event.towerId);
        if (!tower) return;
        vfx.play('overload-end', { position: { x: tower.position.x, y: 0.6, z: tower.position.y } });
      }),

      combat.bus.on('tower_built', (event) => {
        if (event.defId === 'condenser') this.startMist(event.towerId);
      }),

      combat.bus.on('tower_sold', (event) => this.stopMist(event.towerId)),
    );
  }

  /**
   * The condenser's cone runs as a looping emitter rather than a puff per shot:
   * its 0.5s cadence would otherwise read as a stutter, and the mist is the
   * only cue telling the player where the freeze is being built.
   */
  private startMist(towerId: number): void {
    if (this.mist.has(towerId)) return;
    const tower = this.combat.getTower(towerId);
    if (!tower) return;
    const handle = this.vfx.play('condense-mist', {
      position: { x: tower.position.x, y: 0.55, z: tower.position.y },
      direction: { x: tower.facing.x, y: 0.05, z: tower.facing.y },
      range: 3,
      coneAngle: 0.42,
    });
    if (handle) this.mist.set(towerId, handle);
  }

  private stopMist(towerId: number): void {
    const handle = this.mist.get(towerId);
    if (!handle) return;
    handle.stop();
    this.mist.delete(towerId);
  }

  /** Keeps looping emitters glued to their tower's muzzle and heading. */
  update(towers: readonly Tower[]): void {
    if (this.mist.size === 0) return;
    const live = new Set<number>();

    for (const tower of towers) {
      const handle = this.mist.get(tower.id);
      if (!handle) continue;
      live.add(tower.id);
      // A shut-down condenser stops spraying; the emitter is parked underground
      // rather than destroyed, so re-powering it does not re-acquire a slot.
      const y = tower.operational ? 0.55 : -50;
      handle.setTransform(
        {
          x: tower.position.x + tower.facing.x * 0.35,
          y,
          z: tower.position.y + tower.facing.y * 0.35,
        },
        { x: tower.facing.x, y: 0.05, z: tower.facing.y },
      );
    }

    for (const id of [...this.mist.keys()]) {
      if (!live.has(id)) this.stopMist(id);
    }
  }

  dispose(): void {
    for (const handle of this.mist.values()) handle.stop();
    this.mist.clear();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}
