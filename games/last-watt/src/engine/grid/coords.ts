import { Vector3 } from 'three';

import { GRID } from '../config';

export interface Cell {
  col: number;
  row: number;
}

/** Total playfield size in world units. */
export const GRID_WIDTH = GRID.cols * GRID.cellSize;
export const GRID_DEPTH = GRID.rows * GRID.cellSize;

/**
 * World origin convention: cell (0,0) occupies x∈[0,cellSize], z∈[0,cellSize],
 * so the whole board lives in the positive quadrant and the grid centre is at
 * (GRID_WIDTH/2, 0, GRID_DEPTH/2). Gameplay indices are always integers.
 */
export function isInside(col: number, row: number): boolean {
  return col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows;
}

export function cellIndex(col: number, row: number): number {
  return row * GRID.cols + col;
}

export function indexToCell(index: number, out: Cell = { col: 0, row: 0 }): Cell {
  out.col = index % GRID.cols;
  out.row = Math.floor(index / GRID.cols);
  return out;
}

/** Centre of a cell in world space. */
export function cellToWorld(col: number, row: number, out = new Vector3()): Vector3 {
  return out.set((col + 0.5) * GRID.cellSize, 0, (row + 0.5) * GRID.cellSize);
}

/** Cell containing a world point, or null when the point is off the board. */
export function worldToCell(x: number, z: number, out: Cell = { col: 0, row: 0 }): Cell | null {
  const col = Math.floor(x / GRID.cellSize);
  const row = Math.floor(z / GRID.cellSize);
  if (!isInside(col, row)) return null;
  out.col = col;
  out.row = row;
  return out;
}

/** Clamped variant for drag interactions that may run off the edge. */
export function clampToGrid(col: number, row: number, out: Cell = { col: 0, row: 0 }): Cell {
  out.col = Math.min(Math.max(col, 0), GRID.cols - 1);
  out.row = Math.min(Math.max(row, 0), GRID.rows - 1);
  return out;
}
