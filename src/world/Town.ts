import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, ALL_LAYERS, interactionGroups } from '../physics/layers';
import { mulberry32 } from './Noise';
import { WORLD, WorldData } from './WorldGen';

const TARGET_WIDTH_RANGE: [number, number] = [9, 14];

/**
 * Town built from Kenney City Kit (Suburban) buildings placed along the
 * roads inside the town radius. Each building is a cloned GLB scaled to a
 * believable footprint, with a matching cuboid collider; `buildingSpots`
 * feeds the enemy steering block-field.
 */
export class Town {
  readonly reservedLot = new THREE.Vector3();
  readonly buildingSpots: Array<{ x: number; z: number; w: number; d: number; rot: number }> = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld, data: WorldData, buildingGltfs: GLTF[]) {
    const rand = mulberry32(4242);
    const group = new THREE.Group();

    // Pre-measure each building type once.
    const types = buildingGltfs.map((g) => {
      const box = new THREE.Box3().setFromObject(g.scene);
      return { gltf: g, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
    });

    const used: THREE.Vector2[] = [];
    for (const rp of data.roadSamples) {
      if (!data.inTown(rp.x, rp.z)) continue;
      if (rand() > 0.16) continue;
      const side = rand() > 0.5 ? 1 : -1;
      const off = WORLD.roadWidth + 7 + rand() * 8;
      const bx = rp.x + -rp.dirZ * off * side;
      const bz = rp.z + rp.dirX * off * side;
      if (used.some((u) => Math.hypot(u.x - bx, u.y - bz) < 20)) continue;
      if (Math.hypot(bx - 40, bz - 40) < 18) continue; // hideout lot
      if (data.roadDistance(bx, bz) < 13) continue;
      used.push(new THREE.Vector2(bx, bz));

      const type = types[(rand() * types.length) | 0];
      const targetW = TARGET_WIDTH_RANGE[0] + rand() * (TARGET_WIDTH_RANGE[1] - TARGET_WIDTH_RANGE[0]);
      const s = targetW / type.size.x;
      const rot = Math.atan2(rp.dirX, rp.dirZ) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const y = data.height(bx, bz);

      const model = type.gltf.scene.clone(true);
      model.scale.setScalar(s);
      model.rotation.y = rot;
      // Sit the model's base on the terrain.
      model.position.set(bx, y - type.min.y * s - 0.15, bz);
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      group.add(model);

      const w = type.size.x * s;
      const h = type.size.y * s;
      const d = type.size.z * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(bx, y + h / 2 - 0.15, bz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(interactionGroups(Layer.STATIC, ALL_LAYERS)),
      );
      this.buildingSpots.push({ x: bx, z: bz, w, d, rot });
    }

    // Crate piles for cover in the town square.
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let p = 0; p < 5; p++) {
      const cx = (rand() * 2 - 1) * 60;
      const cz = (rand() * 2 - 1) * 60;
      if (data.roadDistance(cx, cz) < WORLD.roadWidth) continue;
      const baseY = data.height(cx, cz);
      for (let c = 0; c < 3; c++) {
        const mesh = new THREE.Mesh(crateGeo, crateMat);
        mesh.castShadow = true;
        const ox = (rand() - 0.5) * 1.6;
        const oz = (rand() - 0.5) * 1.6;
        mesh.position.set(cx + ox, baseY + 0.5 + (c === 2 ? 1 : 0), cz + oz);
        mesh.rotation.y = rand() * Math.PI;
        group.add(mesh);
        const q = new THREE.Quaternion().setFromEuler(mesh.rotation);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(interactionGroups(Layer.STATIC, ALL_LAYERS)),
        );
      }
    }

    scene.add(group);
    this.reservedLot.set(40, data.height(40, 40), 40);
  }
}
