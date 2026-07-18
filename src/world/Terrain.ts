import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { STATIC_GROUPS } from '../physics/layers';
import { WORLD, WorldData } from './WorldGen';

const CHUNK_CELLS = 32; // 32 cells of 4m = 128m chunks
const CHUNKS = (WORLD.samples - 1) / CHUNK_CELLS; // 16×16
const PHYS_POOL = 9;

/**
 * Terrain rendering + physics.
 *
 * Visuals: 16×16 chunk meshes (33×33 verts each) with per-vertex biome colors
 * (grass/dirt/rock by height+slope, asphalt near roads). three.js frustum
 * culling keeps drawn chunks reasonable.
 *
 * Physics: a pool of 9 heightfield colliders covering the 3×3 chunks around
 * the player, reassigned when the player crosses chunk boundaries — Rapier
 * never holds the whole map.
 */
export class Terrain {
  private physChunks = new Map<string, RAPIER.Collider>();
  private group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private physics: PhysicsWorld,
    private data: WorldData,
  ) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const grass = new THREE.Color(0x4f5c38);
    const grassDry = new THREE.Color(0x6b6a42);
    const dirt = new THREE.Color(0x5c4d3a);
    const rock = new THREE.Color(0x62605c);
    const road = new THREE.Color(0x2e2d2f);
    const roadEdge = new THREE.Color(0x4a4640);
    const tmp = new THREE.Color();

    for (let cj = 0; cj < CHUNKS; cj++) {
      for (let ci = 0; ci < CHUNKS; ci++) {
        const geo = new THREE.PlaneGeometry(
          CHUNK_CELLS * WORLD.cell,
          CHUNK_CELLS * WORLD.cell,
          CHUNK_CELLS,
          CHUNK_CELLS,
        );
        geo.rotateX(-Math.PI / 2);
        const originX = ci * CHUNK_CELLS * WORLD.cell - WORLD.half;
        const originZ = cj * CHUNK_CELLS * WORLD.cell - WORLD.half;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const colors = new Float32Array(pos.count * 3);

        for (let v = 0; v < pos.count; v++) {
          const lx = pos.getX(v);
          const lz = pos.getZ(v);
          const wx = originX + lx + (CHUNK_CELLS * WORLD.cell) / 2;
          const wz = originZ + lz + (CHUNK_CELLS * WORLD.cell) / 2;
          const h = this.data.height(wx, wz);
          pos.setY(v, h);

          const slope = this.data.slope(wx, wz);
          const rd = this.data.roadDistance(wx, wz);
          if (rd < WORLD.roadWidth * 0.55) tmp.copy(road);
          else if (rd < WORLD.roadWidth) tmp.copy(roadEdge);
          else if (slope > 0.55) tmp.copy(rock);
          else if (slope > 0.32) tmp.copy(dirt);
          else tmp.lerpColors(grass, grassDry, (Math.sin(wx * 0.05) + Math.sin(wz * 0.07)) * 0.25 + 0.5);
          // Slight height tint variation.
          const shade = 0.92 + 0.08 * Math.min(1, h / 60);
          colors[v * 3] = tmp.r * shade;
          colors[v * 3 + 1] = tmp.g * shade;
          colors[v * 3 + 2] = tmp.b * shade;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(originX + (CHUNK_CELLS * WORLD.cell) / 2, 0, originZ + (CHUNK_CELLS * WORLD.cell) / 2);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    scene.add(this.group);
  }

  /** Ensure heightfield colliders exist for the 3×3 chunks around (x, z). */
  updatePhysics(x: number, z: number): void {
    const pci = Math.floor((x + WORLD.half) / (CHUNK_CELLS * WORLD.cell));
    const pcj = Math.floor((z + WORLD.half) / (CHUNK_CELLS * WORLD.cell));
    const wanted = new Set<string>();
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ci = pci + di;
        const cj = pcj + dj;
        if (ci < 0 || cj < 0 || ci >= CHUNKS || cj >= CHUNKS) continue;
        wanted.add(`${ci},${cj}`);
      }
    }
    // Drop colliders that fell out of range.
    for (const [key, collider] of this.physChunks) {
      if (!wanted.has(key)) {
        this.physics.world.removeCollider(collider, false);
        this.physChunks.delete(key);
      }
    }
    // Create missing ones (bounded by pool size).
    for (const key of wanted) {
      if (this.physChunks.has(key) || this.physChunks.size >= PHYS_POOL) continue;
      const [ci, cj] = key.split(',').map(Number);
      this.physChunks.set(key, this.createHeightfield(ci, cj));
    }
  }

  private createHeightfield(ci: number, cj: number): RAPIER.Collider {
    const n = WORLD.samples;
    const size = CHUNK_CELLS; // cells per side; (size+1)² samples
    const heights = new Float32Array((size + 1) * (size + 1));
    // Rapier heightfields are column-major with COLUMNS along X and ROWS
    // along Z (verified empirically — the transposed mapping reads hills
    // into the town). The shape spans scale.x × scale.z centered on the
    // collider translation.
    for (let col = 0; col <= size; col++) {
      for (let row = 0; row <= size; row++) {
        const gi = ci * CHUNK_CELLS + col;
        const gj = cj * CHUNK_CELLS + row;
        heights[col * (size + 1) + row] = this.data.heights[gj * n + gi];
      }
    }
    const extent = CHUNK_CELLS * WORLD.cell;
    const centerX = ci * extent - WORLD.half + extent / 2;
    const centerZ = cj * extent - WORLD.half + extent / 2;
    return this.physics.world.createCollider(
      RAPIER.ColliderDesc.heightfield(size, size, heights, new RAPIER.Vector3(extent, 1, extent))
        .setTranslation(centerX, 0, centerZ)
        .setCollisionGroups(STATIC_GROUPS),
    );
  }
}
