import {
  Color,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Points,
  PointsMaterial,
  type Scene,
  Sprite,
  SpriteMaterial,
} from 'three';

type Maskable = Object3D & { material: Material | Material[] };

type ProxyKind = 'mesh' | 'points' | 'sprite' | 'line';

interface SavedMaterial {
  object: Maskable;
  material: Material | Material[];
}

/**
 * Per-material override. Set `material.userData.bloom = true` on an additive
 * glow card that has no emissive channel, or `false` on an emissive material
 * that must stay matte.
 */
interface BloomUserData {
  bloom?: boolean;
}

const BLACK = new Color(0x000000);

function hasEmissive(
  material: Material,
): material is Material & { emissive: Color; emissiveIntensity: number } {
  return (material as { emissive?: unknown }).emissive instanceof Color;
}

function hasColor(material: Material): material is Material & { color: Color } {
  return (material as { color?: unknown }).color instanceof Color;
}

function kindOf(object: Maskable): ProxyKind {
  if (object instanceof Points) return 'points';
  if (object instanceof Sprite) return 'sprite';
  if (object instanceof Mesh) return 'mesh';
  return 'line';
}

/**
 * Renders the scene as an emissive-only mask.
 *
 * GDD §15.1 rules that bloom "only eats emissive". Thresholding the beauty
 * pass cannot honour that — a brightly lit rust plate would bloom too. So
 * every material is temporarily swapped for an unlit proxy tinted by its
 * emissive channel (everything else goes black), the bloom chain consumes that
 * buffer, and the originals are restored before the beauty pass runs.
 */
export class EmissiveMask {
  private readonly proxies = new WeakMap<Material, Partial<Record<ProxyKind, Material>>>();
  private readonly created = new Set<Material>();
  private readonly saved: SavedMaterial[] = [];
  private swapped = false;

  /** Swap every material in the scene for its emissive proxy. */
  apply(scene: Scene): void {
    if (this.swapped) return;
    this.swapped = true;

    scene.traverse((object) => {
      if (!(object as Partial<Maskable>).material) return;

      const maskable = object as Maskable;
      this.saved.push({ object: maskable, material: maskable.material });

      const kind = kindOf(maskable);
      maskable.material = Array.isArray(maskable.material)
        ? maskable.material.map((entry) => this.proxyFor(kind, entry))
        : this.proxyFor(kind, maskable.material);
    });
  }

  /** Put the real materials back. Safe to call when nothing was swapped. */
  revert(): void {
    if (!this.swapped) return;
    for (let i = this.saved.length - 1; i >= 0; i -= 1) {
      const entry = this.saved[i];
      entry.object.material = entry.material;
    }
    this.saved.length = 0;
    this.swapped = false;
  }

  dispose(): void {
    this.revert();
    for (const material of this.created) material.dispose();
    this.created.clear();
  }

  private proxyFor(kind: ProxyKind, source: Material): Material {
    let byKind = this.proxies.get(source);
    if (!byKind) {
      byKind = {};
      this.proxies.set(source, byKind);
    }

    let proxy = byKind[kind];
    if (!proxy) {
      proxy = this.createProxy(kind, source);
      byKind[kind] = proxy;
      this.created.add(proxy);
    }

    this.syncProxy(source, proxy);
    return proxy;
  }

  private createProxy(kind: ProxyKind, source: Material): Material {
    switch (kind) {
      case 'points': {
        const proxy = new PointsMaterial();
        const src = source as PointsMaterial;
        proxy.size = src.size ?? 1;
        proxy.sizeAttenuation = src.sizeAttenuation ?? true;
        return proxy;
      }
      case 'sprite':
        return new SpriteMaterial();
      case 'line':
        return new LineBasicMaterial();
      case 'mesh':
      default:
        return new MeshBasicMaterial();
    }
  }

  private syncProxy(source: Material, proxy: Material): void {
    proxy.name = `${source.name || source.type}::emissiveMask`;
    proxy.transparent = source.transparent;
    proxy.opacity = source.opacity;
    proxy.blending = source.blending;
    proxy.side = source.side;
    proxy.alphaTest = source.alphaTest;
    proxy.depthTest = source.depthTest;
    proxy.depthWrite = source.depthWrite;
    proxy.visible = source.visible;

    if (!hasColor(proxy)) return;

    const override = (source.userData as BloomUserData | undefined)?.bloom;
    if (override === false) {
      proxy.color.copy(BLACK);
      return;
    }

    if (hasEmissive(source)) {
      // emissiveIntensity is not baked into `emissive` itself, so fold it in
      // here to keep the mask energy-accurate when VFX pulse a tower's glow.
      proxy.color.copy(source.emissive).multiplyScalar(source.emissiveIntensity ?? 1);
      return;
    }

    if (override === true && hasColor(source)) {
      proxy.color.copy(source.color);
      return;
    }

    proxy.color.copy(BLACK);
  }
}
