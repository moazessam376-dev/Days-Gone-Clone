import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS } from '../config';

interface SyncedBody {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  prevPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
  currPos: THREE.Vector3;
  currRot: THREE.Quaternion;
}

/**
 * Wraps the Rapier world with fixed-step integration and render interpolation.
 *
 * Dynamic bodies registered via `syncObject` have their previous/current
 * transforms captured every fixed step; `interpolate(alpha)` writes the
 * blended transform into the associated Object3D each render frame.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private synced: SyncedBody[] = [];

  constructor() {
    this.world = new RAPIER.World(new RAPIER.Vector3(0, PHYSICS.gravity, 0));
    this.world.timestep = PHYSICS.fixedDt;
  }

  step(): void {
    for (const s of this.synced) {
      s.prevPos.copy(s.currPos);
      s.prevRot.copy(s.currRot);
    }
    this.world.step();
    for (const s of this.synced) {
      const t = s.body.translation();
      const r = s.body.rotation();
      s.currPos.set(t.x, t.y, t.z);
      s.currRot.set(r.x, r.y, r.z, r.w);
    }
  }

  syncObject(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    const t = body.translation();
    const r = body.rotation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.synced.push({
      body,
      object,
      prevPos: pos.clone(),
      prevRot: rot.clone(),
      currPos: pos,
      currRot: rot,
    });
  }

  unsyncObject(body: RAPIER.RigidBody): void {
    this.synced = this.synced.filter((s) => s.body !== body);
  }

  interpolate(alpha: number): void {
    for (const s of this.synced) {
      s.object.position.lerpVectors(s.prevPos, s.currPos, alpha);
      s.object.quaternion.slerpQuaternions(s.prevRot, s.currRot, alpha);
    }
  }
}
