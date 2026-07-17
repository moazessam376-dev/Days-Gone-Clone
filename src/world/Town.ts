import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, ALL_LAYERS, interactionGroups } from '../physics/layers';
import { mulberry32 } from './Noise';
import { WORLD, WorldData } from './WorldGen';

/**
 * Procedural town: box buildings with pitched roofs placed along the roads
 * inside the town radius, merged into a handful of draws. Each building gets
 * a static cuboid collider. One lot is reserved for M8's enterable building.
 */
export class Town {
  /** Reserved doorway-building lot (used by M8). */
  readonly reservedLot = new THREE.Vector3();
  readonly buildingSpots: Array<{ x: number; z: number; w: number; d: number; rot: number }> = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld, data: WorldData) {
    const rand = mulberry32(4242);
    const wallMats = [0x7d7468, 0x8a7f6e, 0x6e6a63, 0x74685c].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }),
    );
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4c3f38, roughness: 0.9 });
    const group = new THREE.Group();

    // Place buildings beside road samples inside the town.
    const used: THREE.Vector2[] = [];
    for (const rp of data.roadSamples) {
      if (!data.inTown(rp.x, rp.z)) continue;
      if (rand() > 0.16) continue;
      // Perpendicular offset from the road.
      const side = rand() > 0.5 ? 1 : -1;
      const off = WORLD.roadWidth + 6 + rand() * 8;
      const bx = rp.x + -rp.dirZ * off * side;
      const bz = rp.z + rp.dirX * off * side;
      if (used.some((u) => Math.hypot(u.x - bx, u.y - bz) < 18)) continue;
      if (Math.hypot(bx - 40, bz - 40) < 18) continue; // hideout lot
      // Keep clear of ALL road lanes (roads cross the town), not just our own.
      if (data.roadDistance(bx, bz) < 13) continue;
      used.push(new THREE.Vector2(bx, bz));

      const w = 8 + rand() * 8;
      const d = 8 + rand() * 10;
      const h = 4 + rand() * 4;
      const rot = Math.atan2(rp.dirX, rp.dirZ) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const y = data.height(bx, bz);

      const mat = wallMats[(rand() * wallMats.length) | 0];
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      body.position.set(bx, y + h / 2 - 0.3, bz);
      body.rotation.y = rot;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Pitched roof: stretched cone with 4 radial segments reads as a hip roof.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), roofMat);
      roof.scale.set(w * 1.08, 1.6 + rand() * 1.6, d * 1.08);
      roof.position.set(bx, y + h - 0.3 + roof.scale.y / 2, bz);
      roof.rotation.y = rot + Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);

      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(bx, y + h / 2 - 0.3, bz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(interactionGroups(Layer.STATIC, ALL_LAYERS)),
      );
      this.buildingSpots.push({ x: bx, z: bz, w, d, rot });
    }

    // A few crate piles for cover in the town square.
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
