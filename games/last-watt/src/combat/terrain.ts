/**
 * Cell coating field: the oil slicks and fire fields that live on the grid
 * (GDD §17.1 `Cell.coating`).
 *
 * Combat owns this rather than the grid module because combat is the only
 * writer (tar sprayer paints, flamethrower converts) and the only reader
 * (the `on_cell_entered` reaction rows). The render layer just subscribes to
 * `cell_coating_changed`.
 */

import type { CellCoating, Seconds } from './types';
import { cellKey } from './types';

interface CoatedCell {
  cx: number;
  cy: number;
  coating: CellCoating;
  remaining: Seconds;
  /**
   * Numbers the painter attached to the slick, handed to `on_cell_entered`
   * rows. The tar sprayer stores its slow strength here so its upgrade can
   * change 30% to 40% without the reaction table knowing tar exists.
   */
  params?: Readonly<Record<string, number>>;
}

export interface CoatingExpiry {
  cx: number;
  cy: number;
  previous: CellCoating;
}

const EMPTY_PARAMS: Readonly<Record<string, number>> = Object.freeze({});

export class CoatingField {
  private readonly cells = new Map<string, CoatedCell>();

  get(cx: number, cy: number): CellCoating {
    return this.cells.get(cellKey(cx, cy))?.coating ?? 'none';
  }

  remaining(cx: number, cy: number): Seconds {
    return this.cells.get(cellKey(cx, cy))?.remaining ?? 0;
  }

  /**
   * Paints a cell. Returns true when the visible coating changed, so the
   * caller only emits an event on real transitions (a tar tower re-painting
   * the same slick every 2s must not spam the VFX layer).
   */
  paint(
    cx: number,
    cy: number,
    coating: CellCoating,
    duration: Seconds,
    params?: Readonly<Record<string, number>>,
  ): boolean {
    const key = cellKey(cx, cy);
    if (coating === 'none') return this.clearCell(cx, cy);

    const existing = this.cells.get(key);
    if (existing && existing.coating === coating) {
      existing.remaining = Math.max(existing.remaining, duration);
      if (params) existing.params = params;
      return false;
    }
    const cell: CoatedCell = { cx, cy, coating, remaining: duration };
    if (params) cell.params = params;
    this.cells.set(key, cell);
    return true;
  }

  /** Parameter bag of the coating on this cell, empty when there is none. */
  params(cx: number, cy: number): Readonly<Record<string, number>> {
    return this.cells.get(cellKey(cx, cy))?.params ?? EMPTY_PARAMS;
  }

  clearCell(cx: number, cy: number): boolean {
    return this.cells.delete(cellKey(cx, cy));
  }

  tick(dt: Seconds): CoatingExpiry[] {
    const expired: CoatingExpiry[] = [];
    for (const cell of [...this.cells.values()]) {
      cell.remaining -= dt;
      if (cell.remaining <= 0) {
        this.cells.delete(cellKey(cell.cx, cell.cy));
        expired.push({ cx: cell.cx, cy: cell.cy, previous: cell.coating });
      }
    }
    return expired;
  }

  /**
   * Map 2's floodway sluice washes the oil off at the start of every wave
   * (GDD §5.2) — the mechanism that kills oil-fire on that map and forces the
   * player onto the conduct combo.
   */
  wash(predicate: (cx: number, cy: number, coating: CellCoating) => boolean): CoatingExpiry[] {
    const washed: CoatingExpiry[] = [];
    for (const cell of [...this.cells.values()]) {
      if (!predicate(cell.cx, cell.cy, cell.coating)) continue;
      this.cells.delete(cellKey(cell.cx, cell.cy));
      washed.push({ cx: cell.cx, cy: cell.cy, previous: cell.coating });
    }
    return washed;
  }

  entries(): readonly CoatedCell[] {
    return [...this.cells.values()];
  }

  get size(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.clear();
  }
}
