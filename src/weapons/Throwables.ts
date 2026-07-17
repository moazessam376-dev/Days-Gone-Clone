import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, interactionGroups } from '../physics/layers';

export const THROWABLE = {
  throwSpeed: 16,
  throwUp: 4.5,
  grenadeFuse: 2.2,
  grenadeRadius: 6.5,
  grenadeDamage: 130,
  molotovArmTime: 0.25,
  molotovMaxAge: 3.5,
  fireRadius: 3,
  poolSize: 6,
};

export type ThrowableKind = 'grenade' | 'molotov';

interface Projectile {
  kind: ThrowableKind;
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
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
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.6 });
  private molotovMat = new THREE.MeshStandardMaterial({
    color: 0xc06a28,
    roughness: 0.4,
    emissive: 0xff6a10,
    emissiveIntensity: 0.6,
  });

  constructor(
    private physics: PhysicsWorld,
    scene: THREE.Scene,
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
          .setCollisionGroups(interactionGroups(Layer.PROJECTILE, Layer.STATIC | Layer.VEHICLE)),
        body,
      );
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.grenadeMat);
      mesh.castShadow = true;
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
    p.mesh.material = kind === 'grenade' ? this.grenadeMat : this.molotovMat;
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
        const landed = p.age > THROWABLE.molotovArmTime && speed < 3;
        if (landed || p.age > THROWABLE.molotovMaxAge) {
          this.retire(p);
          this.events.onMolotovBreak(new THREE.Vector3(pos.x, pos.y, pos.z));
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
