import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, interactionGroups } from '../physics/layers';
import { mulberry32 } from './Noise';
import { fbm } from './Noise';
import { WORLD, WorldData } from './WorldGen';

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

  constructor(scene: THREE.Scene, physics: PhysicsWorld, data: WorldData) {
    const rand = mulberry32(1337);

    // Jittered-grid scatter with biome rejection.
    const spacing = 13;
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

    // ---- Instanced rendering ----
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const lowerGeo = new THREE.ConeGeometry(2.4, 4.4, 7);
    lowerGeo.translate(0, 3.9, 0);
    const upperGeo = new THREE.ConeGeometry(1.5, 3.4, 7);
    upperGeo.translate(0, 6.6, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 1 });
    const pineMatA = new THREE.MeshStandardMaterial({ color: 0x2d4a2e, roughness: 1 });
    const pineMatB = new THREE.MeshStandardMaterial({ color: 0x3a5a38, roughness: 1 });

    const dummy = new THREE.Object3D();
    const makeInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(geo, mat, this.trees.length);
      m.castShadow = true;
      m.receiveShadow = false;
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        dummy.position.set(t.x, t.y - 0.15, t.z);
        dummy.scale.setScalar(t.scale);
        dummy.rotation.y = (i * 2.39996) % (Math.PI * 2);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      scene.add(m);
      return m;
    };
    makeInstanced(trunkGeo, trunkMat);
    makeInstanced(lowerGeo, pineMatA);
    makeInstanced(upperGeo, pineMatB);

    // Rocks.
    const rocks: TreeInstance[] = [];
    for (let i = 0; i < 700; i++) {
      const x = (rand() * 2 - 1) * (WORLD.half - 30);
      const z = (rand() * 2 - 1) * (WORLD.half - 30);
      if (data.roadDistance(x, z) < WORLD.roadWidth + 2) continue;
      if (data.inTown(x, z) && rand() > 0.15) continue;
      rocks.push({ x, z, y: data.height(x, z), scale: 0.4 + rand() * 1.4 });
    }
    const rockGeo = new THREE.IcosahedronGeometry(0.8, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5b57, roughness: 1, flatShading: true });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rockMesh.castShadow = true;
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      dummy.position.set(r.x, r.y + 0.1, r.z);
      dummy.scale.set(r.scale, r.scale * (0.6 + (i % 5) * 0.1), r.scale);
      dummy.rotation.set(0, i * 1.7, 0);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
    }
    scene.add(rockMesh);

    // Pooled tree colliders (parked below the world when unused).
    const groups = interactionGroups(Layer.STATIC, 0xffff);
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
