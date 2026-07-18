import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { STATIC_GROUPS } from '../physics/layers';
import { WorldData } from './WorldGen';

export interface BreakableWindow {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  hp: number;
  broken: boolean;
  /** Center for effects/sounds. */
  x: number;
  z: number;
  takeDamage(amount: number): boolean; // true when it breaks
}

/** Block-query result for enemy steering. */
export type BlockResult = null | { wall: true } | { breakable: BreakableWindow };

const H = { cx: 40, cz: 40, halfX: 6, halfZ: 5, wallT: 0.35, height: 3.1 };
const DOOR = { x0: -1.1, x1: 1.3 }; // gap in the front (+z) wall, local coords
const WINDOWS: Array<{ side: 'back' | 'left'; a0: number; a1: number }> = [
  { side: 'back', a0: -1.6, a1: 1.6 },
  { side: 'left', a0: -1.6, a1: 1.6 },
];

/**
 * The hideout house: enterable through an open doorway, with boarded windows
 * that freakers (and bullets) can smash. Walls physically block the player,
 * and the same geometry answers `blockAt` queries for enemy steering.
 */
export class EnterableBuilding {
  readonly windows: BreakableWindow[] = [];
  private baseY: number;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    world: WorldData,
    private onBreak: (w: BreakableWindow) => void,
  ) {
    this.baseY = world.height(H.cx, H.cz);
    const y = this.baseY;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x847a6a, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x453a32, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5c5248, roughness: 1 });
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x6b4f33, roughness: 1 });

    const group = new THREE.Group();
    scene.add(group);

    const staticGroups = STATIC_GROUPS;
    const addBox = (
      sx: number,
      sy: number,
      sz: number,
      px: number,
      py: number,
      pz: number,
      mat: THREE.Material,
    ): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
          .setTranslation(px, py, pz)
          .setCollisionGroups(staticGroups),
      );
    };

    const wh = H.height;
    const wy = y + wh / 2;
    // Floor + roof slab.
    addBox(H.halfX * 2, 0.25, H.halfZ * 2, H.cx, y + 0.12, H.cz, floorMat);
    addBox(H.halfX * 2 + 0.7, 0.3, H.halfZ * 2 + 0.7, H.cx, y + wh + 0.15, H.cz, roofMat);

    // Front wall (+z) with door gap.
    const zF = H.cz + H.halfZ;
    const segAw = DOOR.x0 - -H.halfX;
    addBox(segAw, wh, H.wallT, H.cx - H.halfX + segAw / 2, wy, zF, wallMat);
    const segBw = H.halfX - DOOR.x1;
    addBox(segBw, wh, H.wallT, H.cx + DOOR.x1 + segBw / 2, wy, zF, wallMat);
    // Door lintel above the gap.
    addBox(DOOR.x1 - DOOR.x0, wh - 2.2, H.wallT, H.cx + (DOOR.x0 + DOOR.x1) / 2, y + 2.2 + (wh - 2.2) / 2, zF, wallMat);

    // Back wall (-z) with window gap.
    const zB = H.cz - H.halfZ;
    const wb = WINDOWS[0];
    addBox(wb.a0 + H.halfX, wh, H.wallT, H.cx - H.halfX + (wb.a0 + H.halfX) / 2, wy, zB, wallMat);
    addBox(H.halfX - wb.a1, wh, H.wallT, H.cx + wb.a1 + (H.halfX - wb.a1) / 2, wy, zB, wallMat);
    addBox(wb.a1 - wb.a0, 0.9, H.wallT, H.cx + (wb.a0 + wb.a1) / 2, y + 0.45, zB, wallMat); // sill
    addBox(wb.a1 - wb.a0, wh - 2.3, H.wallT, H.cx + (wb.a0 + wb.a1) / 2, y + 2.3 + (wh - 2.3) / 2, zB, wallMat); // header

    // Left wall (-x) with window gap.
    const xL = H.cx - H.halfX;
    const wl = WINDOWS[1];
    addBox(H.wallT, wh, wl.a0 + H.halfZ, xL, wy, H.cz - H.halfZ + (wl.a0 + H.halfZ) / 2, wallMat);
    addBox(H.wallT, wh, H.halfZ - wl.a1, xL, wy, H.cz + wl.a1 + (H.halfZ - wl.a1) / 2, wallMat);
    addBox(H.wallT, 0.9, wl.a1 - wl.a0, xL, y + 0.45, H.cz + (wl.a0 + wl.a1) / 2, wallMat);
    addBox(H.wallT, wh - 2.3, wl.a1 - wl.a0, xL, y + 2.3 + (wh - 2.3) / 2, H.cz + (wl.a0 + wl.a1) / 2, wallMat);

    // Right wall (+x), solid.
    addBox(H.wallT, wh, H.halfZ * 2, H.cx + H.halfX, wy, H.cz, wallMat);

    // Boarded windows (breakables).
    this.makeWindow(scene, physics, boardMat, 'back', wb.a0, wb.a1);
    this.makeWindow(scene, physics, boardMat, 'left', wl.a0, wl.a1);
  }

  private makeWindow(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    mat: THREE.Material,
    side: 'back' | 'left',
    a0: number,
    a1: number,
  ): void {
    const y = this.baseY;
    const len = a1 - a0;
    const cx = side === 'back' ? H.cx + (a0 + a1) / 2 : H.cx - H.halfX;
    const cz = side === 'back' ? H.cz - H.halfZ : H.cz + (a0 + a1) / 2;
    const sx = side === 'back' ? len : 0.22;
    const sz = side === 'back' ? 0.22 : len;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.4, sz), mat);
    mesh.position.set(cx, y + 1.6, cz);
    mesh.castShadow = true;
    scene.add(mesh);

    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, 0.7, sz / 2)
        .setTranslation(cx, y + 1.6, cz)
        .setCollisionGroups(STATIC_GROUPS),
    );

    const self = this;
    const w: BreakableWindow = {
      mesh,
      collider,
      hp: 80,
      broken: false,
      x: cx,
      z: cz,
      takeDamage(amount: number): boolean {
        if (this.broken) return false;
        this.hp -= amount;
        // Rattle the boards while under attack.
        this.mesh.rotation.z = (Math.random() - 0.5) * 0.06;
        if (this.hp <= 0) {
          this.broken = true;
          this.mesh.visible = false;
          this.collider.setEnabled(false);
          self.onBreak(this);
          return true;
        }
        return false;
      },
    };
    this.windows.push(w);
  }

  /**
   * Enemy steering query in the house's wall band. Door gap and broken
   * windows are passable; intact windows return their breakable.
   */
  blockAt(x: number, z: number): BlockResult {
    const dx = x - H.cx;
    const dz = z - H.cz;
    const pad = 0.4;
    const inOuter = Math.abs(dx) < H.halfX + pad && Math.abs(dz) < H.halfZ + pad;
    if (!inOuter) return null;
    const inInner = Math.abs(dx) < H.halfX - H.wallT - pad && Math.abs(dz) < H.halfZ - H.wallT - pad;
    if (inInner) return null; // interior is free
    // Door gap (front, +z).
    if (dz > 0 && dx > DOOR.x0 && dx < DOOR.x1) return null;
    // Back window.
    const wb = WINDOWS[0];
    if (dz < 0 && dx > wb.a0 && dx < wb.a1) {
      const w = this.windows[0];
      return w.broken ? null : { breakable: w };
    }
    // Left window.
    const wl = WINDOWS[1];
    if (dx < 0 && dz > wl.a0 && dz < wl.a1) {
      const w = this.windows[1];
      return w.broken ? null : { breakable: w };
    }
    return { wall: true };
  }
}
