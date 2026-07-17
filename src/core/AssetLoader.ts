import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads GLB models from public/assets/ (BASE_URL-aware for GitHub Pages).
 * All loads happen up front during the boot loading screen.
 */
export class AssetLoader {
  private loader = new GLTFLoader();
  private cache = new Map<string, GLTF>();

  async loadAll(models: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(models).map(async ([key, path]) => {
        const gltf = await this.loader.loadAsync(import.meta.env.BASE_URL + path);
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
    );
  }

  get(key: string): GLTF {
    const gltf = this.cache.get(key);
    if (!gltf) throw new Error(`Asset not loaded: ${key}`);
    return gltf;
  }
}
