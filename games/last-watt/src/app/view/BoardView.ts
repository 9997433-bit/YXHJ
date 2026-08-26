/**
 * The board, in three dimensions.
 *
 * The engine's `GridView` is a flat control-group slab; this replaces it with
 * per-cell relief driven by terrain. Foundations stand proud of the road,
 * trenches sink below it, wasteland walls the playfield in. That step is what
 * the 55° camera reads first, and it is the difference between "2.5D board" and
 * "tile map with a tilt" (GDD §15.1).
 *
 * One `InstancedMesh` carries all 240 cells, so the whole board is one draw
 * call and a terrain edit is a matrix rewrite rather than a scene-graph churn.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from 'three';

import type { Grid, TerrainName } from '../../gameplay';
import { tracePolyline } from '../../gameplay';
import type { FlowField } from '../../gameplay';
import { APP_PALETTE, TERRAIN_STYLES } from '../config';

const CELL_INSET = 0.94;

export interface CursorState {
  cx: number;
  cy: number;
  valid: boolean;
  /** Range circle radius in cells; 0 hides it. */
  range: number;
}

export class BoardView {
  readonly root = new Group();

  private readonly cells: InstancedMesh;
  private readonly emissiveCells: InstancedMesh;
  private readonly cursor: Mesh;
  private readonly rangeRing: Mesh;
  private readonly highlights: InstancedMesh;
  private readonly hint: Mesh;
  private readonly routes: Line[] = [];
  private readonly routeGroup = new Group();
  private readonly scratch = new Object3D();
  private readonly matrix = new Matrix4();
  private readonly color = new Color();

  private terrainVersion = -1;
  private gateSignature = '';
  private highlightSignature = '';
  private cursorPulse = 0;

  constructor(private readonly grid: Grid) {
    this.root.name = 'lw-board';

    const geometry = new BoxGeometry(CELL_INSET, 1, CELL_INSET);
    // Pivot at the top face: scaling Y then grows the block downward from the
    // authored surface height, so the visible top always lands where we asked.
    geometry.translate(0, -0.5, 0);

    this.cells = new InstancedMesh(
      geometry,
      new MeshStandardMaterial({ flatShading: true, roughness: 0.92, metalness: 0.1 }),
      grid.cols * grid.rows,
    );
    this.cells.name = 'lw-board-cells';
    this.cells.receiveShadow = true;
    this.cells.castShadow = true;

    // Core and gate cells are the board's only bloom sources, so they get their
    // own emissive material rather than an emissive channel nobody else uses.
    this.emissiveCells = new InstancedMesh(
      geometry.clone(),
      new MeshStandardMaterial({
        flatShading: true,
        roughness: 0.5,
        metalness: 0.2,
        emissive: new Color(0xffffff),
        emissiveIntensity: 1,
      }),
      grid.cols * grid.rows,
    );
    this.emissiveCells.name = 'lw-board-emissive';

    this.cursor = new Mesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: APP_PALETTE.electric,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    this.cursor.name = 'lw-cursor';
    this.cursor.visible = false;
    this.cursor.renderOrder = 4;

    this.rangeRing = new Mesh(
      new RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: APP_PALETTE.frost,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    this.rangeRing.name = 'lw-range-ring';
    this.rangeRing.visible = false;
    this.rangeRing.renderOrder = 5;

    // Legality is not guessable from the terrain alone — three of 240 cells are
    // diggable and the rule involves pathing — so the armed tool paints its
    // legal targets rather than letting the player hunt for them.
    //
    // A pip rather than a filled cell, because build mode has ~110 legal
    // targets: at that count a wash turns the board into one yellow shape and
    // the relief that carries the whole read disappears. `setHighlights` scales
    // the pip back up for the tools that only ever offer a handful.
    this.highlights = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: APP_PALETTE.coin,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      grid.cols * grid.rows,
    );
    this.highlights.name = 'lw-highlights';
    this.highlights.count = 0;
    this.highlights.renderOrder = 3;

    // The tutorial's free dig points at one cell (GDD §11 wave 5). A legality
    // pip cannot carry that — every legal cell has one — so the recommendation
    // gets its own ring in the coin colour the free badge uses.
    this.hint = new Mesh(
      new RingGeometry(0.34, 0.46, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: APP_PALETTE.coin,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    this.hint.name = 'lw-hint';
    this.hint.visible = false;
    this.hint.renderOrder = 4;

    this.routeGroup.name = 'lw-routes';
    this.root.add(
      this.cells,
      this.emissiveCells,
      this.routeGroup,
      this.highlights,
      this.hint,
      this.cursor,
      this.rangeRing,
    );
  }

  /** The one cell an unspent tutorial charge is pointing at, or none. */
  setHint(cell: { cx: number; cy: number } | null): void {
    if (!cell) {
      this.hint.visible = false;
      return;
    }
    const style = TERRAIN_STYLES[this.grid.terrainAt(cell.cx, cell.cy) as TerrainName];
    this.hint.position.set(cell.cx + 0.5, style.height + 0.04, cell.cy + 0.5);
    this.hint.visible = true;
  }

  /**
   * Cells the armed tool may legally be used on. Few targets get a filled cell;
   * many get a centre pip, so "you may build almost anywhere" never repaints
   * the board.
   */
  setHighlights(cells: readonly { cx: number; cy: number }[]): void {
    const signature = cells.map((cell) => `${cell.cx},${cell.cy}`).join('|');
    if (signature === this.highlightSignature) return;
    this.highlightSignature = signature;

    const size = cells.length > 12 ? 0.24 : 0.86;

    let index = 0;
    for (const cell of cells) {
      const style = TERRAIN_STYLES[this.grid.terrainAt(cell.cx, cell.cy) as TerrainName];
      this.scratch.position.set(cell.cx + 0.5, style.height + 0.02, cell.cy + 0.5);
      this.scratch.scale.set(size, 1, size);
      this.scratch.rotation.set(0, 0, 0);
      this.scratch.updateMatrix();
      this.highlights.setMatrixAt(index, this.scratch.matrix);
      index += 1;
    }
    this.highlights.count = index;
    this.highlights.instanceMatrix.needsUpdate = true;
  }

  /** Rebuilds the relief when the grid's walkability version moves. */
  syncTerrain(force = false): void {
    // Gates open on a wave boundary, which does not always move the walkability
    // version, so their state is part of the cache key.
    const gates = this.grid.gates.filter((gate) => gate.open);
    const signature = gates.map((gate) => gate.id).join(',');
    if (!force && this.terrainVersion === this.grid.version && this.gateSignature === signature) {
      return;
    }
    this.terrainVersion = this.grid.version;
    this.gateSignature = signature;

    // "Where do they come from" is the second question the player asks after
    // "where do they go", and the map data gives gate cells ordinary road
    // terrain, so the marker has to be painted here.
    const gateCells = new Set<number>();
    for (const gate of gates) {
      for (const cell of gate.cells) gateCells.add(cell.cy * this.grid.cols + cell.cx);
    }

    let plain = 0;
    let glow = 0;

    for (let cy = 0; cy < this.grid.rows; cy += 1) {
      for (let cx = 0; cx < this.grid.cols; cx += 1) {
        const terrain = this.grid.terrainAt(cx, cy) as TerrainName;
        const style = gateCells.has(cy * this.grid.cols + cx)
          ? TERRAIN_STYLES.spawn
          : TERRAIN_STYLES[terrain];
        // Thickness only has to reach below the lowest neighbour; 1.2 covers the
        // deepest trench without paying for geometry nobody can see.
        const depth = style.height + 1.2;

        this.scratch.position.set(cx + 0.5, style.height, cy + 0.5);
        this.scratch.scale.set(1, depth, 1);
        this.scratch.rotation.set(0, 0, 0);
        this.scratch.updateMatrix();
        this.matrix.copy(this.scratch.matrix);

        if (style.emissive !== undefined) {
          this.emissiveCells.setMatrixAt(glow, this.matrix);
          this.emissiveCells.setColorAt(
            glow,
            this.color.setHex(style.emissive).multiplyScalar(style.emissiveIntensity ?? 1),
          );
          glow += 1;
        } else {
          this.cells.setMatrixAt(plain, this.matrix);
          this.cells.setColorAt(plain, this.tintFor(cx, cy, style.color));
          plain += 1;
        }
      }
    }

    this.cells.count = plain;
    this.emissiveCells.count = glow;
    this.cells.instanceMatrix.needsUpdate = true;
    this.emissiveCells.instanceMatrix.needsUpdate = true;
    if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
    if (this.emissiveCells.instanceColor) this.emissiveCells.instanceColor.needsUpdate = true;
  }

  /**
   * Draws the walking route from every open gate to the core.
   *
   * Not decoration: "which way will they come" is the single question the
   * player asks before every dig, and a greybox with no enemies on the field
   * cannot answer it any other way.
   */
  syncRoutes(field: FlowField, gates: { id: string; cells: { cx: number; cy: number }[] }[]): void {
    this.routeGroup.clear();
    for (const line of this.routes) line.geometry.dispose();
    this.routes.length = 0;

    for (const gate of gates) {
      const start = gate.cells[0];
      if (!start) continue;
      const polyline = tracePolyline(field, start);
      if (polyline.length < 2) continue;

      const points: number[] = [];
      for (const point of polyline) points.push(point.x, 0.09, point.y);

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      const line = new Line(
        geometry,
        new LineBasicMaterial({
          color: APP_PALETTE.ember,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        }),
      );
      line.renderOrder = 3;
      this.routes.push(line);
      this.routeGroup.add(line);
    }
  }

  setCursor(state: CursorState | null): void {
    if (!state) {
      this.cursor.visible = false;
      this.rangeRing.visible = false;
      return;
    }

    const style = TERRAIN_STYLES[this.grid.terrainAt(state.cx, state.cy) as TerrainName];
    const y = style.height + 0.03;
    this.cursor.position.set(state.cx + 0.5, y, state.cy + 0.5);
    this.cursor.visible = true;
    (this.cursor.material as MeshBasicMaterial).color.setHex(
      state.valid ? APP_PALETTE.electric : APP_PALETTE.alarm,
    );

    if (state.range > 0) {
      this.rangeRing.position.set(state.cx + 0.5, y + 0.01, state.cy + 0.5);
      this.rangeRing.scale.setScalar(state.range);
      this.rangeRing.visible = true;
      (this.rangeRing.material as MeshBasicMaterial).color.setHex(
        state.valid ? APP_PALETTE.frost : APP_PALETTE.alarm,
      );
    } else {
      this.rangeRing.visible = false;
    }
  }

  /** Shows a selected tower's range without a build cursor attached. */
  showRangeAt(x: number, z: number, range: number): void {
    this.rangeRing.position.set(x, 0.28, z);
    this.rangeRing.scale.setScalar(range);
    this.rangeRing.visible = true;
    (this.rangeRing.material as MeshBasicMaterial).color.setHex(APP_PALETTE.frost);
  }

  update(dt: number): void {
    this.cursorPulse += dt;
    if (this.hint.visible) {
      const pulse = 1 + Math.sin(this.cursorPulse * 3.2) * 0.12;
      this.hint.scale.set(pulse, 1, pulse);
    }
    if (!this.cursor.visible) return;
    const material = this.cursor.material as MeshBasicMaterial;
    material.opacity = 0.22 + Math.sin(this.cursorPulse * 6) * 0.1;
  }

  /** Top of the terrain slab, i.e. where a tower's feet go. */
  surfaceHeight(cx: number, cy: number): number {
    return TERRAIN_STYLES[this.grid.terrainAt(cx, cy) as TerrainName].height;
  }

  worldOf(cx: number, cy: number, out = new Vector3()): Vector3 {
    const style = TERRAIN_STYLES[this.grid.terrainAt(cx, cy) as TerrainName];
    return out.set(cx + 0.5, style.height, cy + 0.5);
  }

  /**
   * Per-cell weathering. A deterministic hash rather than `Math.random` so a
   * terrain rebuild after a dig does not reshuffle the whole board's tint.
   */
  private tintFor(cx: number, cy: number, base: number): Color {
    const hash = Math.abs(Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1;
    return this.color.setHex(base).multiplyScalar(0.86 + hash * 0.28);
  }

  dispose(): void {
    this.cells.geometry.dispose();
    (this.cells.material as MeshStandardMaterial).dispose();
    this.emissiveCells.geometry.dispose();
    (this.emissiveCells.material as MeshStandardMaterial).dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as MeshBasicMaterial).dispose();
    this.rangeRing.geometry.dispose();
    (this.rangeRing.material as MeshBasicMaterial).dispose();
    this.highlights.geometry.dispose();
    (this.highlights.material as MeshBasicMaterial).dispose();
    this.hint.geometry.dispose();
    (this.hint.material as MeshBasicMaterial).dispose();
    for (const line of this.routes) {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    }
    this.root.clear();
  }
}
