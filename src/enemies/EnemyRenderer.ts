import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ENEMY } from '../config';
import { EnemyManager, EnemyState } from './EnemyManager';

interface RenderSlot {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  weights: number[];
  enemy: number;
}

/**
 * V1 enemy visuals: a pool of cloned SkinnedMeshes with per-slot mixers,
 * assigned to enemies each frame. This whole class is the swappable layer that
 * phase 2 replaces with vertex-animation-texture instancing — gameplay code
 * never touches it.
 *
 * animId mapping: 0 idle, 1 walk, 2 run, 3 bite.
 */
export class EnemyRenderer {
  private slots: RenderSlot[] = [];
  private colorways: THREE.MeshStandardMaterial[] = [];

  /**
   * @param zombieGltfs mesh variants, distributed round-robin over the pool.
   * @param colorwayTextures optional texture swaps; each slot assignment picks
   *   one deterministically from the enemy index so a given freaker keeps its
   *   outfit color for its whole life.
   */
  constructor(
    scene: THREE.Scene,
    zombieGltfs: GLTF[],
    colorwayTextures: THREE.Texture[] = [],
    poolSize = ENEMY.physicsPoolSize,
  ) {
    this.colorways = colorwayTextures.map(
      (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }),
    );

    const clipNames = ['ZombieIdle', 'ZombieWalk', 'ZombieRun', 'ZombieBite'];
    const variants = zombieGltfs.map((gltf) => {
      // Normalize scale so each zombie stands ~1.75m tall regardless of export.
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const scale = 1.75 / (bbox.max.y - bbox.min.y);
      const clips = clipNames.map((n) => {
        const c = THREE.AnimationClip.findByName(gltf.animations, `Zombie|${n}`);
        if (!c) throw new Error(`Missing zombie clip ${n}`);
        return c;
      });
      return { gltf, scale, clips };
    });

    for (let s = 0; s < poolSize; s++) {
      const v = variants[s % variants.length];
      const root = cloneSkeleton(v.gltf.scene);
      root.scale.setScalar(v.scale);
      root.visible = false;
      root.traverse((o: THREE.Object3D) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const actions = v.clips.map((c) => {
        const a = mixer.clipAction(c);
        a.play();
        a.setEffectiveWeight(0);
        // Desync crowd animation phases.
        a.time = Math.random() * c.duration;
        return a;
      });
      this.slots.push({ root, mixer, actions, weights: [0, 0, 0, 0], enemy: -1 });
    }
  }

  /** Outfit colorway keyed to the enemy index — stable for its lifetime. */
  private applyColorway(slot: RenderSlot, enemy: number): void {
    if (!this.colorways.length) return;
    const mat = this.colorways[(enemy * 7 + 3) % this.colorways.length];
    slot.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
    });
  }

  update(dt: number, manager: EnemyManager): void {
    // Keep stable assignments; free slots for dead/inactive enemies not
    // rendered as corpses, then assign unrendered live enemies.
    const rendered = new Set<number>();
    for (const slot of this.slots) {
      if (slot.enemy >= 0) {
        const st = manager.state[slot.enemy];
        if (st === EnemyState.INACTIVE) {
          slot.enemy = -1;
          slot.root.visible = false;
        } else {
          rendered.add(slot.enemy);
        }
      }
    }
    for (const i of manager.active) {
      if (rendered.has(i)) continue;
      const slot = this.slots.find((sl) => sl.enemy === -1);
      if (!slot) break;
      slot.enemy = i;
      slot.root.visible = true;
      this.applyColorway(slot, i);
    }

    for (const slot of this.slots) {
      if (slot.enemy < 0) continue;
      const i = slot.enemy;

      if (manager.state[i] === EnemyState.CORPSE) {
        // Follow the corpse physics body with the pose frozen.
        const corpse = manager.corpseTransform(i);
        if (corpse) {
          const t = corpse.body.translation();
          const r = corpse.body.rotation();
          slot.root.position.set(t.x, t.y - 0.55, t.z);
          slot.root.quaternion.set(r.x, r.y, r.z, r.w);
        }
        continue; // mixer intentionally not updated — frozen pose
      }

      slot.root.position.set(manager.posX[i], manager.posY[i], manager.posZ[i]);
      slot.root.rotation.set(0, manager.yaw[i] + ENEMY.modelYawOffset, 0);

      const target = manager.animId[i];
      for (let a = 0; a < slot.actions.length; a++) {
        const w = a === target ? 1 : 0;
        slot.weights[a] += (w - slot.weights[a]) * Math.min(1, dt * 10);
        slot.actions[a].setEffectiveWeight(slot.weights[a]);
      }
      slot.mixer.update(dt);
    }
  }

  reset(): void {
    for (const slot of this.slots) {
      slot.enemy = -1;
      slot.root.visible = false;
    }
  }
}
