import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { THROWABLE_GROUPS } from '../physics/layers';
import type { AssetLoader } from '../core/AssetLoader';

export const THROWABLE = {
  throwSpeed: 16,
  throwUp: 4.5,
  grenadeFuse: 2.2,
  grenadeRadius: 6.5,
  grenadeDamage: 130,
  molotovArmTime: 0.25,
  molotovMaxAge: 3.5,
  /** Molotov breaks when it comes this close to the ground while falling. */
  molotovBreakHeight: 0.35,
  fireRadius: 3,
  poolSize: 6,
};

export type ThrowableKind = 'grenade' | 'molotov';

interface Projectile {
  kind: ThrowableKind;
  body: RAPIER.RigidBody;
  /** Group holding both prop models; the active kind's child is visible. */
  mesh: THREE.Group;
  age: number;
  active: boolean;
}

export interface ThrowableEvents {
  onExplode: (pos: THREE.Vector3) => void;
  onMolotovBreak: (pos: THREE.Vector3) => void;
}

/**
 * Pooled physical throwables: grenades (timed fuse, big AoE) and molotovs
 * (break on landing, seed the FireGrid). Real Rapier dynamics with CCD so
 * fast throws never tunnel.
 */
export class ThrowableSystem {
  private pool: Projectile[] = [];
  /** Terrain height sampler — drives molotov ground-contact breaks. */
  heightFn: (x: number, z: number) => number = () => 0;

  constructor(
    private physics: PhysicsWorld,
    scene: THREE.Scene,
    assets: AssetLoader,
    private events: ThrowableEvents,
  ) {
    for (let i = 0; i < THROWABLE.poolSize; i++) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -400 - i * 3, 0).setCcdEnabled(true),
      );
      body.setEnabled(false);
      physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.11)
          .setDensity(3)
          .setRestitution(0.3)
          .setCollisionGroups(THROWABLE_GROUPS),
        body,
      );
      // Each pool slot carries both prop models; throw() toggles by kind.
      const mesh = new THREE.Group();
      for (const [kind, key] of [
        ['grenade', 'wep_grenade'],
        ['molotov', 'wep_molotov'],
      ] as const) {
        const prop = assets.get(key).scene.clone(true);
        prop.name = kind;
        prop.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        });
        mesh.add(prop);
      }
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ kind: 'grenade', body, mesh, age: 0, active: false });
      physics.syncObject(body, mesh);
    }
  }

  throw(kind: ThrowableKind, origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    const p = this.pool.find((q) => !q.active);
    if (!p) return false;
    p.kind = kind;
    p.age = 0;
    p.active = true;
    for (const child of p.mesh.children) child.visible = child.name === kind;
    p.mesh.visible = true;
    p.body.setEnabled(true);
    p.body.setTranslation({ x: origin.x, y: origin.y, z: origin.z }, true);
    p.body.setLinvel(
      {
        x: dir.x * THROWABLE.throwSpeed,
        y: dir.y * THROWABLE.throwSpeed + THROWABLE.throwUp,
        z: dir.z * THROWABLE.throwSpeed,
      },
      true,
    );
    p.body.setAngvel({ x: 4, y: 0, z: 4 }, true);
    return true;
  }

  fixedUpdate(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      const pos = p.body.translation();
      const vel = p.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);

      if (p.kind === 'grenade') {
        if (p.age >= THROWABLE.grenadeFuse) {
          this.retire(p);
          this.events.onExplode(new THREE.Vector3(pos.x, pos.y, pos.z));
        }
      } else {
        // Break on the first ground touch: slow after a bounce, or falling
        // into the near-ground band. The bottle shatters where it LANDS —
        // never mid-air (a long lob that times out while flying just fizzles).
        const groundY = this.heightFn(pos.x, pos.z);
        const nearGround = pos.y - groundY < THROWABLE.molotovBreakHeight;
        const landed =
          p.age > THROWABLE.molotovArmTime && (speed < 3 || (nearGround && vel.y <= 0));
        if (landed) {
          this.retire(p);
          this.events.onMolotovBreak(new THREE.Vector3(pos.x, Math.max(groundY, pos.y - 0.2), pos.z));
        } else if (p.age > THROWABLE.molotovMaxAge) {
          this.retire(p);
          if (nearGround) this.events.onMolotovBreak(new THREE.Vector3(pos.x, groundY, pos.z));
        }
      }
    }
  }

  private retire(p: Projectile): void {
    p.active = false;
    p.mesh.visible = false;
    p.body.setEnabled(false);
    p.body.setTranslation({ x: 0, y: -400, z: 0 }, true);
    void this.physics;
  }
}
