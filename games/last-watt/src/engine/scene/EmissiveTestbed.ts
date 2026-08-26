import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
} from 'three';

import { GRID, PALETTE, SURFACE } from '../config';
import { cellToWorld } from '../grid/coords';

interface Pulse {
  material: MeshStandardMaterial;
  base: number;
  amplitude: number;
  speed: number;
  phase: number;
}

/**
 * Scaffold-only content: rusted-iron props with no emissive next to probes
 * that glow in every colour of the GDD §15.2 palette.
 *
 * Its job is to make the two locked visual rules falsifiable at a glance —
 * the rust must never bloom, the emissive always must. Delete this module once
 * real tower and enemy meshes land; nothing else in the engine depends on it.
 */
export class EmissiveTestbed {
  readonly root = new Group();

  private readonly pulses: Pulse[] = [];
  private readonly geometries: Array<{ dispose(): void }> = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private ring?: Mesh;

  constructor() {
    this.root.name = 'EmissiveTestbed';

    this.buildPaletteProbes();
    this.buildRustControlGroup();
    this.buildCorePylon();
    this.buildCornerMarkers();
  }

  /** Drives the emissive pulse; call once per rendered frame. */
  update(elapsed: number): void {
    for (const pulse of this.pulses) {
      pulse.material.emissiveIntensity =
        pulse.base + Math.sin(elapsed * pulse.speed + pulse.phase) * pulse.amplitude;
    }
    if (this.ring) {
      this.ring.rotation.z = elapsed * 0.6;
      this.ring.position.y = 2.35 + Math.sin(elapsed * 1.3) * 0.06;
    }
  }

  /**
   * One probe per legislated colour, each on a matte rust pedestal so the
   * bloom boundary between glowing and non-glowing geometry is visible.
   */
  private buildPaletteProbes(): void {
    const entries: Array<[string, number]> = [
      ['electric', PALETTE.electric],
      ['ember', PALETTE.ember],
      ['frost', PALETTE.frost],
      ['coin', PALETTE.coin],
      ['alarm', PALETTE.alarm],
      ['tar', PALETTE.tar],
    ];

    const pedestalGeometry = new BoxGeometry(0.82, 0.32, 0.82);
    const probeGeometry = new OctahedronGeometry(0.3, 0);
    this.geometries.push(pedestalGeometry, probeGeometry);

    entries.forEach(([name, hex], index) => {
      const col = 2 + index * 2;
      const row = 2;
      const centre = cellToWorld(col, row);

      const pedestalMaterial = this.rustMaterial();
      const pedestal = new Mesh(pedestalGeometry, pedestalMaterial);
      pedestal.name = `probe-pedestal-${name}`;
      pedestal.position.set(centre.x, 0.16, centre.z);
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;

      const probeMaterial = this.emissiveMaterial(hex, 2.6);
      const probe = new Mesh(probeGeometry, probeMaterial);
      probe.name = `probe-${name}`;
      probe.position.set(centre.x, 0.68, centre.z);

      this.pulses.push({
        material: probeMaterial,
        base: 2.6,
        amplitude: 0.9,
        speed: 1.6,
        phase: index * 0.7,
      });

      this.root.add(pedestal, probe);
    });
  }

  /** Pure rusted iron, zero emissive: if any of this blooms, the mask is broken. */
  private buildRustControlGroup(): void {
    const slabGeometry = new BoxGeometry(3 * GRID.cellSize, 0.5, 2 * GRID.cellSize);
    const blockGeometry = new BoxGeometry(0.9, 1.4, 0.9);
    const coneGeometry = new ConeGeometry(0.55, 1.1, 6);
    this.geometries.push(slabGeometry, blockGeometry, coneGeometry);

    const slabCentre = cellToWorld(4, 8);
    const slab = new Mesh(slabGeometry, this.rustMaterial(0.9, 0.42));
    slab.name = 'rust-slab';
    slab.position.set(slabCentre.x + GRID.cellSize, 0.25, slabCentre.z + GRID.cellSize / 2);
    slab.castShadow = true;
    slab.receiveShadow = true;

    const blockCentre = cellToWorld(9, 9);
    const block = new Mesh(blockGeometry, this.rustMaterial(0.75, 0.55));
    block.name = 'rust-block';
    block.position.set(blockCentre.x, 0.7, blockCentre.z);
    block.rotation.y = Math.PI * 0.12;
    block.castShadow = true;
    block.receiveShadow = true;

    const coneCentre = cellToWorld(11, 8);
    const cone = new Mesh(coneGeometry, this.rustMaterial(0.95, 0.2));
    cone.name = 'rust-cone';
    cone.position.set(coneCentre.x, 0.55, coneCentre.z);
    cone.castShadow = true;
    cone.receiveShadow = true;

    this.root.add(slab, block, cone);
  }

  /** Stand-in for the geothermal core: matte housing, glowing innards. */
  private buildCorePylon(): void {
    const centre = cellToWorld(16, 6);

    const baseGeometry = new CylinderGeometry(0.85, 1.05, 0.45, 8);
    const shaftGeometry = new CylinderGeometry(0.34, 0.46, 2.1, 8);
    const capGeometry = new OctahedronGeometry(0.44, 0);
    const ringGeometry = new TorusGeometry(0.95, 0.045, 8, 32);
    this.geometries.push(baseGeometry, shaftGeometry, capGeometry, ringGeometry);

    const base = new Mesh(baseGeometry, this.rustMaterial(0.8, 0.5));
    base.name = 'core-base';
    base.position.set(centre.x, 0.22, centre.z);
    base.castShadow = true;
    base.receiveShadow = true;

    const shaftMaterial = this.emissiveMaterial(PALETTE.electric, 1.1, 0x101c22);
    const shaft = new Mesh(shaftGeometry, shaftMaterial);
    shaft.name = 'core-shaft';
    shaft.position.set(centre.x, 1.4, centre.z);
    shaft.castShadow = true;

    const capMaterial = this.emissiveMaterial(PALETTE.frost, 3.4);
    const cap = new Mesh(capGeometry, capMaterial);
    cap.name = 'core-cap';
    cap.position.set(centre.x, 2.7, centre.z);

    const ringMaterial = this.emissiveMaterial(PALETTE.electric, 4.2);
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.name = 'core-ring';
    ring.rotation.x = Math.PI / 2;
    ring.position.set(centre.x, 2.35, centre.z);
    this.ring = ring;

    this.pulses.push(
      { material: shaftMaterial, base: 1.1, amplitude: 0.45, speed: 2.1, phase: 0 },
      { material: capMaterial, base: 3.4, amplitude: 1.2, speed: 2.8, phase: 1.2 },
      { material: ringMaterial, base: 4.2, amplitude: 1.4, speed: 3.4, phase: 2.4 },
    );

    this.root.add(base, shaft, cap, ring);
  }

  /** Tiny emissive studs on the four corner cells; a visual grid-alignment assert. */
  private buildCornerMarkers(): void {
    const geometry = new BoxGeometry(0.22, 0.22, 0.22);
    this.geometries.push(geometry);

    const corners: Array<[number, number]> = [
      [0, 0],
      [GRID.cols - 1, 0],
      [0, GRID.rows - 1],
      [GRID.cols - 1, GRID.rows - 1],
    ];

    corners.forEach(([col, row], index) => {
      const centre = cellToWorld(col, row);
      const material = this.emissiveMaterial(PALETTE.frost, 2.0);
      const marker = new Mesh(geometry, material);
      marker.name = `corner-${col}-${row}`;
      marker.position.set(centre.x, 0.14, centre.z);

      this.pulses.push({
        material,
        base: 2.0,
        amplitude: 0.7,
        speed: 2.2,
        phase: index * 1.1,
      });

      this.root.add(marker);
    });
  }

  private rustMaterial(roughness = 0.85, metalness = 0.45): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      color: new Color(SURFACE.rustBase),
      roughness,
      metalness,
      flatShading: true,
    });
    this.materials.push(material);
    return material;
  }

  private emissiveMaterial(
    hex: number,
    intensity: number,
    bodyColor = 0x0b0705,
  ): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      color: new Color(bodyColor),
      emissive: new Color(hex),
      emissiveIntensity: intensity,
      roughness: 0.5,
      metalness: 0.1,
      flatShading: true,
    });
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.pulses.length = 0;
    this.root.clear();
  }
}
