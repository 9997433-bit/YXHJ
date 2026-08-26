/**
 * The bits of "what the player is doing" that are not gameplay state.
 *
 * Arming a tool and picking a blueprint belong to `CommandCenter` — they have
 * rules, they can be refused, and a replay needs them. What is left is the
 * pointer: which cell it is over and which tower the inspector is showing.
 * Neither survives a tick, neither exists in a headless run, so neither goes
 * anywhere near the session.
 */

import type { CellCoord } from '../gameplay';

export class Interaction {
  /** Cell under the pointer, or null when the pointer is off the board. */
  hover: CellCoord | null = null;
  /** Tower the inspector panel is showing. */
  selectedTowerId: number | null = null;
}
