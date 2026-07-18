import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { STATIC_GROUPS } from '../physics/layers';
import { mulberry32 } from './Noise';
import { WORLD, WorldData } from './WorldGen';

/**
 * "Barricaded Main Street" town (R2 layout, user-approved): anchor buildings
 * hand-placed parametrically along the main-street spline — apartment at the
 * north end, church at the south, diner/café/shops/auto-repair facing each
 * other between them — with barricade chokepoints + abandoned cars at both
 * street ends, a motel out on the highway, and houses scattered on the side
 * lots. All models are Synty Apocalypse exports (1u = 1m, base at y=0).
 *
 * Every placement registers one cuboid collider and one `buildingSpots` rect
 * (the enemy steering block-field).
 */
export class Town {
  readonly reservedLot = new THREE.Vector3();
  readonly buildingSpots: Array<{ x: number; z: number; w: number; d: number; rot: number }> = [];

  private group = new THREE.Group();
  private measured = new Map<string, { gltf: GLTF; size: THREE.Vector3 }>();

  constructor(
    scene: THREE.Scene,
    private physics: PhysicsWorld,
    private data: WorldData,
    private models: Record<string, GLTF>,
  ) {
    const rand = mulberry32(4242);

    // --- main street anchors (u = arc-length param along the street) ---
    const anchors: Array<[number, number, string]> = [
      [0.03, 1, 'apartment'],
      [0.06, -1, 'shop_m1'],
      [0.09, 1, 'diner'],
      [0.12, -1, 'cafe'],
      [0.15, 1, 'shop_s1'],
      [0.18, -1, 'autorepair'],
      [0.21, 1, 'shop_s2'],
      [0.235, -1, 'commercial_s'],
      [0.26, 1, 'church'],
    ];
    for (const [u, side, key] of anchors) {
      const { x, z, rot } = this.alongStreet(data.mainStreet, u, side, 6 + this.half(key).z);
      this.place(key, x, z, rot);
    }

    // Motel out on the highway (northeast of town).
    {
      const { x, z, rot } = this.alongStreet(data.highway, 0.64, 1, 8 + this.half('motel').z);
      this.place('motel', x, z, rot);
    }

    // --- barricade chokepoints at both street ends + abandoned cars ---
    for (const u of [0.02, 0.23]) {
      const p = data.mainStreet.getPointAt(u);
      const t = data.mainStreet.getTangentAt(u);
      const across = Math.atan2(t.x, t.y) + Math.PI / 2;
      const pieces = ['barricade_conc', 'barricade1', 'barricade_wire'];
      for (let i = -1; i <= 1; i++) {
        const x = p.x + -t.y * i * 4.2;
        const z = p.y + t.x * i * 4.2;
        this.place(pieces[i + 1], x, z, across, 0.55);
      }
    }
    this.placeStreet('wreck_car', 0.045, 2.6, 0.5);
    this.placeStreet('wreck_ute', 0.105, -2.8, -0.35);
    this.placeStreet('wreck_car', 0.17, 2.4, 2.6);

    // --- houses scattered on the side lots (seeded, like the old town) ---
    const houseKeys = ['house1', 'house2', 'house3', 'house_burnt'];
    for (const rp of data.roadSamples) {
      if (!data.inTown(rp.x, rp.z)) continue;
      if (rand() > 0.1) continue;
      const side = rand() > 0.5 ? 1 : -1;
      const off = WORLD.roadWidth + 10 + rand() * 9;
      const bx = rp.x + -rp.dirZ * off * side;
      const bz = rp.z + rp.dirX * off * side;
      if (this.buildingSpots.some((s) => Math.hypot(s.x - bx, s.z - bz) < 24)) continue;
      if (Math.hypot(bx - 40, bz - 40) < 18) continue; // hideout lot
      if (data.roadDistance(bx, bz) < 12) continue;
      const rot = Math.atan2(rp.dirX, rp.dirZ) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.place(houseKeys[(rand() * houseKeys.length) | 0], bx, bz, rot);
    }

    // Crate piles for cover in the town square (procedural, from V1).
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
        this.group.add(mesh);
        const q = new THREE.Quaternion().setFromEuler(mesh.rotation);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(STATIC_GROUPS),
        );
      }
    }

    scene.add(this.group);
    this.reservedLot.set(40, data.height(40, 40), 40);
  }

  private measure(key: string): { gltf: GLTF; size: THREE.Vector3 } {
    let m = this.measured.get(key);
    if (!m) {
      const gltf = this.models[key];
      if (!gltf) throw new Error(`Town model missing: ${key}`);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      m = { gltf, size: box.getSize(new THREE.Vector3()) };
      this.measured.set(key, m);
    }
    return m;
  }

  private half(key: string): THREE.Vector3 {
    return this.measure(key).size.clone().multiplyScalar(0.5);
  }

  /** Point beside a road spline: u along the curve, side ±1, setback meters. */
  private alongStreet(
    curve: THREE.SplineCurve,
    u: number,
    side: number,
    setback: number,
  ): { x: number; z: number; rot: number } {
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const off = WORLD.roadWidth / 2 + setback;
    const x = p.x + -t.y * off * side;
    const z = p.y + t.x * off * side;
    // Face the road: model fronts are +Z in the Synty exports.
    const rot = Math.atan2(t.x, t.y) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    return { x, z, rot };
  }

  /** Prop ON the street: lateral offset in meters from the centerline. */
  private placeStreet(key: string, u: number, lateral: number, rotOffset: number): void {
    const p = this.data.mainStreet.getPointAt(u);
    const t = this.data.mainStreet.getTangentAt(u);
    this.place(
      key,
      p.x + -t.y * lateral,
      p.y + t.x * lateral,
      Math.atan2(t.x, t.y) + rotOffset,
      0.6,
    );
  }

  /** Clone + ground + collide + register a model at (x, z). */
  private place(key: string, x: number, z: number, rot: number, spotShrink = 1): void {
    const { gltf, size } = this.measure(key);
    const y = this.data.height(x, z);
    const model = gltf.scene.clone(true);
    model.rotation.y = rot;
    model.position.set(x, y - 0.1, z); // exports are grounded at y=0
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(model);

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(x, y + size.y / 2 - 0.1, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(STATIC_GROUPS),
    );
    this.buildingSpots.push({ x, z, w: size.x * spotShrink, d: size.z * spotShrink, rot });
  }
}
