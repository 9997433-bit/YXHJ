/**
 * What the player currently has "in hand".
 *
 * Shared by the input layer (which sets it) and the HUD bridge (which renders
 * it). Deliberately not part of `Sim`: none of it survives a tick, none of it
 * belongs in a replay, and a headless run has no cursor.
 */

import type { CellCoord } from '../gameplay';

export type ArmedTool = 'dig' | 'bridge' | null;

export class Interaction {
  /** Tower id staged for placement, or null. */
  selectedBuildId: string | null = null;
  /** Engineering operation staged for a target cell, or null. */
  armed: ArmedTool = null;
  /** Tower the inspector panel is showing. */
  selectedTowerId: number | null = null;
  /** Cell under the pointer, or null when the pointer is off the board. */
  hover: CellCoord | null = null;

  selectBlueprint(defId: string | null): void {
    this.selectedBuildId = this.selectedBuildId === defId ? null : defId;
    if (this.selectedBuildId) {
      this.armed = null;
      this.selectedTowerId = null;
    }
  }

  arm(tool: Exclude<ArmedTool, null>): void {
    this.armed = this.armed === tool ? null : tool;
    if (this.armed) {
      this.selectedBuildId = null;
      this.selectedTowerId = null;
    }
  }

  selectTower(towerId: number | null): void {
    this.selectedTowerId = towerId;
    if (towerId !== null) {
      this.selectedBuildId = null;
      this.armed = null;
    }
  }

  /** Escape / right click: drop whatever is in hand. */
  clear(): void {
    this.selectedBuildId = null;
    this.armed = null;
    this.selectedTowerId = null;
  }
}
