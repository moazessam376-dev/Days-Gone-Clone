import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads GLB models from public/assets/ (BASE_URL-aware for GitHub Pages).
 * All loads happen up front during the boot loading screen.
 */
export class AssetLoader {
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private cache = new Map<string, GLTF>();
  private texCache = new Map<string, THREE.Texture>();

  /** GitHub Pages occasionally 503s single files right after a deploy while
   * the CDN warms — one flaky fetch must not brick the whole boot. */
  private async retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw new Error(`asset failed after retries: ${label}: ${String(lastErr)}`);
  }

  async loadAll(
    models: Record<string, string>,
    textures: Record<string, string> = {},
  ): Promise<void> {
    await Promise.all([
      ...Object.entries(models).map(async ([key, path]) => {
        const gltf = await this.retry(
          () => this.loader.loadAsync(import.meta.env.BASE_URL + path),
          path,
        );
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            // Skinned bounds don't track animation; culling pops bodies out
            // of view at close range. Characters are few — skip culling.
            if ((obj as THREE.SkinnedMesh).isSkinnedMesh) obj.frustumCulled = false;
          }
        });
        this.cache.set(key, gltf);
      }),
      ...Object.entries(textures).map(async ([key, path]) => {
        const tex = await this.retry(
          () => this.texLoader.loadAsync(import.meta.env.BASE_URL + path),
          path,
        );
        // Default flipY=true matches our Synty exports' FBX-convention UVs.
        tex.colorSpace = THREE.SRGBColorSpace;
        this.texCache.set(key, tex);
      }),
    ]);
  }

  get(key: string): GLTF {
    const gltf = this.cache.get(key);
    if (!gltf) throw new Error(`Asset not loaded: ${key}`);
    return gltf;
  }

  texture(key: string): THREE.Texture {
    const tex = this.texCache.get(key);
    if (!tex) throw new Error(`Texture not loaded: ${key}`);
    return tex;
  }
}
