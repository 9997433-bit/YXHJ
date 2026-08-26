/**
 * The only ballistic attack in v1 is the machine gun's rivet (GDD §17.2:
 * "instant resolution for spray and arcs, simple ballistics only for the gun").
 */

import type { AttackSource } from '../reaction/context';
import type { DamageType, EntityId, SourceTag, Vec2 } from '../types';

export interface Projectile {
  id: EntityId;
  position: Vec2;
  targetId: EntityId;
  /** Cells per second. */
  speed: number;
  damage: number;
  damageType: DamageType;
  tags: SourceTag[];
  source: AttackSource;
  ignoreArmor: boolean;
  splashRadius: number;
  params?: Readonly<Record<string, number>>;
  /** Dropped once it has been in flight this long with no valid target. */
  age: number;
}
