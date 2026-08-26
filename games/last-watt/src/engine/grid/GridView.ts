import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';

import { GRID, SURFACE } from '../config';
import { GRID_DEPTH, GRID_WIDTH } from './coords';

/**
 * Presentation of the 20×12 board: a flat-shaded rusted-iron slab with
 * per-cell plate tinting, cell seams and a perimeter border.
 *
 * Deliberately non-emissive — this surface is the control group proving the
 * bloom pass only picks up emissive materials.
 */
export class GridView {
  readonly root = new Group();

  private readonly ground: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly seams: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly border: LineSegments<BufferGeometry, LineBasicMaterial>;

  constructor() {
    this.root.name = 'GridView';

    this.ground = this.buildGround();
    this.seams = this.buildSeams();
    this.border = this.buildBorder();

    this.root.add(this.ground, this.seams, this.border);
  }

  set seamsVisible(visible: boolean) {
    this.seams.visible = visible;
    this.border.visible = visible;
  }

  get seamsVisible(): boolean {
    return this.seams.visible;
  }

  private buildGround(): Mesh<BufferGeometry, MeshStandardMaterial> {
    const plane = new PlaneGeometry(GRID_WIDTH, GRID_DEPTH, GRID.cols, GRID.rows);
    plane.rotateX(-Math.PI / 2);
    plane.translate(GRID_WIDTH / 2, 0, GRID_DEPTH / 2);

    // Non-indexed so each cell's two triangles can carry their own plate tint.
    const geometry = plane.toNonIndexed();
    plane.dispose();

    const position = geometry.getAttribute('position') as BufferAttribute;
    const triangleCount = position.count / 3;
    const colors = new Float32Array(position.count * 3);

    const base = new Color(SURFACE.rustBase);
    const plate = new Color(SURFACE.rustPlate);
    const tint = new Color();

    for (let tri = 0; tri < triangleCount; tri += 1) {
      const quad = Math.floor(tri / 2);
      const col = quad % GRID.cols;
      const row = Math.floor(quad / GRID.cols);

      // Checkerboard plates plus a deterministic per-cell wobble so the slab
      // reads as weathered metal rather than a chessboard.
      const checker = (col + row) % 2 === 0;
      const wobble = (Math.sin(col * 12.9898 + row * 78.233) * 43758.5453) % 1;
      tint.copy(checker ? base : plate).multiplyScalar(0.92 + Math.abs(wobble) * 0.16);

      for (let v = 0; v < 3; v += 1) {
        const offset = (tri * 3 + v) * 3;
        colors[offset] = tint.r;
        colors[offset + 1] = tint.g;
        colors[offset + 2] = tint.b;
      }
    }

    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: SURFACE.rustRoughness,
      metalness: SURFACE.rustMetalness,
      flatShading: true,
    });

    const mesh = new Mesh(geometry, material);
    mesh.name = 'GridGround';
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildSeams(): LineSegments<BufferGeometry, LineBasicMaterial> {
    const points: number[] = [];
    const y = 0.012;

    for (let col = 1; col < GRID.cols; col += 1) {
      const x = col * GRID.cellSize;
      points.push(x, y, 0, x, y, GRID_DEPTH);
    }
    for (let row = 1; row < GRID.rows; row += 1) {
      const z = row * GRID.cellSize;
      points.push(0, y, z, GRID_WIDTH, y, z);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));

    const material = new LineBasicMaterial({
      color: SURFACE.seam,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    const lines = new LineSegments(geometry, material);
    lines.name = 'GridSeams';
    return lines;
  }

  private buildBorder(): LineSegments<BufferGeometry, LineBasicMaterial> {
    const y = 0.02;
    const points = [
      0, y, 0, GRID_WIDTH, y, 0,
      GRID_WIDTH, y, 0, GRID_WIDTH, y, GRID_DEPTH,
      GRID_WIDTH, y, GRID_DEPTH, 0, y, GRID_DEPTH,
      0, y, GRID_DEPTH, 0, y, 0,
    ];

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));

    const material = new LineBasicMaterial({
      color: SURFACE.border,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    const lines = new LineSegments(geometry, material);
    lines.name = 'GridBorder';
    return lines;
  }

  dispose(): void {
    for (const object of [this.ground, this.seams, this.border]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.root.clear();
  }
}
