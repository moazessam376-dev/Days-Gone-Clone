import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { STATIC_GROUPS } from '../physics/layers';
import { mulberry32 } from './Noise';
import { fbm } from './Noise';
import { WORLD, WorldData } from './WorldGen';

/** Merge ALL meshes of a Synty export into one baked geometry + material
 * (trees ship trunk/foliage as separate meshes sharing the atlas). */
function extractGeo(gltf: GLTF): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  const geos: THREE.BufferGeometry[] = [];
  let mat: THREE.Material | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const geo = mesh.geometry.clone();
      // The exports are quantized (Int16 + dequantize scale in the node
      // transform); applyMatrix4 on a normalized int attribute corrupts it,
      // so expand to float32 first.
      for (const name of ['position', 'normal', 'uv']) {
        const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (!attr) continue;
        const arr = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) {
          arr[i * attr.itemSize] = attr.getX(i);
          if (attr.itemSize > 1) arr[i * attr.itemSize + 1] = attr.getY(i);
          if (attr.itemSize > 2) arr[i * attr.itemSize + 2] = attr.getZ(i);
        }
        geo.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
      }
      // Drop non-shared attributes so merge succeeds across pieces.
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      }
      geo.applyMatrix4(mesh.matrixWorld);
      geos.push(geo);
      mat ??= mesh.material as THREE.Material;
    }
  });
  if (!geos.length || !mat) throw new Error('no mesh in vegetation model');
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
  return { geo, mat };
}

const TREE_COLLIDER_POOL = 32;
const TREE_COLLIDER_RANGE = 45;

interface TreeInstance {
  x: number;
  z: number;
  y: number;
  scale: number;
}

/**
 * Procedural pine forest + rock scatter, rendered as a handful of
 * InstancedMesh draws (trunks, two foliage cone tiers, rocks). Trees get
 * pooled cylinder colliders only near the player, refreshed at 4 Hz.
 */
export class Vegetation {
  private trees: TreeInstance[] = [];
  private treeGrid = new Map<string, TreeInstance[]>();
  private colliderPool: RAPIER.Collider[] = [];
  private refreshTimer = 0;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    data: WorldData,
    models: Record<string, GLTF>,
  ) {
    const rand = mulberry32(1337);

    // Jittered-grid scatter with biome rejection.
    const spacing = 15;
    for (let gz = -WORLD.half + 20; gz < WORLD.half - 20; gz += spacing) {
      for (let gx = -WORLD.half + 20; gx < WORLD.half - 20; gx += spacing) {
        const x = gx + (rand() - 0.5) * spacing * 0.9;
        const z = gz + (rand() - 0.5) * spacing * 0.9;
        // Forest density mask: patchy woods, no trees on roads/town/steep rock.
        const density = fbm(x * 0.004, z * 0.004, 555);
        if (rand() > density * 1.35) continue;
        if (data.inTown(x, z)) continue;
        if (data.roadDistance(x, z) < WORLD.roadWidth + 4) continue;
        if (data.slope(x, z) > 0.5) continue;
        this.trees.push({ x, z, y: data.height(x, z), scale: 0.75 + rand() * 0.6 });
      }
    }

    // Coarse lookup grid for the collider pool.
    for (const t of this.trees) {
      const key = `${Math.floor(t.x / 64)},${Math.floor(t.z / 64)}`;
      let list = this.treeGrid.get(key);
      if (!list) {
        list = [];
        this.treeGrid.set(key, list);
      }
      list.push(t);
    }

    // ---- Instanced rendering: Synty tree/rock models, one draw per species.
    // Species mix: mostly Tree_01, some Tree_02, occasional dead tree.
    const dummy = new THREE.Object3D();
    const species: Array<{ key: string; members: number[] }> = [
      { key: 'tree1', members: [] },
      { key: 'tree2', members: [] },
      { key: 'tree_dead', members: [] },
    ];
    for (let i = 0; i < this.trees.length; i++) {
      const roll = i % 10;
      species[roll < 6 ? 0 : roll < 9 ? 1 : 2].members.push(i);
    }
    // Region-chunked instancing (256m cells): one InstancedMesh per species
    // per region so off-screen forest frustum-culls away — the full-detail
    // Synty forest in a single draw is ~10M tris, far past budget.
    const REGION = 256;
    for (const sp of species) {
      const { geo, mat } = extractGeo(models[sp.key]);
      const regions = new Map<string, number[]>();
      for (const ti of sp.members) {
        const t = this.trees[ti];
        const key = `${Math.floor(t.x / REGION)},${Math.floor(t.z / REGION)}`;
        let list = regions.get(key);
        if (!list) regions.set(key, (list = []));
        list.push(ti);
      }
      for (const members of regions.values()) {
        const m = new THREE.InstancedMesh(geo, mat, members.length);
        m.castShadow = true;
        m.receiveShadow = false;
        members.forEach((ti, slot) => {
          const t = this.trees[ti];
          dummy.position.set(t.x, t.y - 0.15, t.z);
          dummy.scale.setScalar(t.scale);
          dummy.rotation.set(0, (ti * 2.39996) % (Math.PI * 2), 0);
          dummy.updateMatrix();
          m.setMatrixAt(slot, dummy.matrix);
        });
        m.computeBoundingSphere();
        scene.add(m);
      }
    }

    // Rocks (two Synty variants split by parity).
    const rocks: TreeInstance[] = [];
    for (let i = 0; i < 700; i++) {
      const x = (rand() * 2 - 1) * (WORLD.half - 30);
      const z = (rand() * 2 - 1) * (WORLD.half - 30);
      if (data.roadDistance(x, z) < WORLD.roadWidth + 2) continue;
      if (data.inTown(x, z) && rand() > 0.15) continue;
      rocks.push({ x, z, y: data.height(x, z), scale: 0.4 + rand() * 1.4 });
    }
    for (const [key, parity] of [['rock1', 0], ['rock2', 1]] as Array<[string, number]>) {
      const subset = rocks.filter((_, i) => i % 2 === parity);
      const { geo, mat } = extractGeo(models[key]);
      const m = new THREE.InstancedMesh(geo, mat, subset.length);
      m.castShadow = true;
      subset.forEach((r, slot) => {
        dummy.position.set(r.x, r.y - 0.05, r.z);
        dummy.scale.set(r.scale, r.scale * (0.6 + (slot % 5) * 0.1), r.scale);
        dummy.rotation.set(0, slot * 1.7, 0);
        dummy.updateMatrix();
        m.setMatrixAt(slot, dummy.matrix);
      });
      scene.add(m);
    }

    // Pooled tree colliders (parked below the world when unused).
    const groups = STATIC_GROUPS;
    for (let i = 0; i < TREE_COLLIDER_POOL; i++) {
      this.colliderPool.push(
        physics.world.createCollider(
          RAPIER.ColliderDesc.cylinder(2.5, 0.3)
            .setTranslation(0, -300 - i * 6, 0)
            .setCollisionGroups(groups),
        ),
      );
    }
  }

  get treeCount(): number {
    return this.trees.length;
  }

  /** Refresh pooled tree colliders around the player (4 Hz is plenty). */
  update(dt: number, x: number, z: number): void {
    this.refreshTimer -= dt;
    if (this.refreshTimer > 0) return;
    this.refreshTimer = 0.25;

    const near: TreeInstance[] = [];
    const gx = Math.floor(x / 64);
    const gz = Math.floor(z / 64);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = this.treeGrid.get(`${gx + di},${gz + dj}`);
        if (!list) continue;
        for (const t of list) {
          if (Math.hypot(t.x - x, t.z - z) < TREE_COLLIDER_RANGE) near.push(t);
        }
      }
    }
    near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (let i = 0; i < this.colliderPool.length; i++) {
      const c = this.colliderPool[i];
      if (i < near.length) {
        c.setTranslation({ x: near[i].x, y: near[i].y + 2.4, z: near[i].z });
      } else {
        c.setTranslation({ x: 0, y: -300 - i * 6, z: 0 });
      }
    }
  }
}
