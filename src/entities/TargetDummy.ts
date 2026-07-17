import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, interactionGroups } from '../physics/layers';
import { DamageRegistry, type Damageable } from '../weapons/WeaponSystem';

/**
 * M3 shooting-range dummy: body + head colliders (headshot testing), hit
 * flash, tips over on death, self-respawns. Replaced by real freakers in M4.
 */
export class TargetDummy implements Damageable {
  readonly root = new THREE.Group();
  headColliderHandle: number;
  private bodyCollider: RAPIER.Collider;
  private headCollider: RAPIER.Collider;
  private bodyMat: THREE.MeshStandardMaterial;
  private health = 100;
  private dead = false;
  private deathT = 0;
  private respawnAt = 0;
  private flashT = 0;

  constructor(physics: PhysicsWorld, registry: DamageRegistry, position: THREE.Vector3) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a4040, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.05, 4, 10), this.bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    this.root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.bodyMat);
    head.position.y = 1.72;
    head.castShadow = true;
    this.root.add(head);
    this.root.position.copy(position);

    const groups = interactionGroups(Layer.ENEMY, 0xffff);
    this.bodyCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.525, 0.32)
        .setTranslation(position.x, position.y + 0.85, position.z)
        .setCollisionGroups(groups),
    );
    this.headCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.16)
        .setTranslation(position.x, position.y + 1.72, position.z)
        .setCollisionGroups(groups),
    );
    this.headColliderHandle = this.headCollider.handle;
    registry.register(this.bodyCollider.handle, this);
    registry.register(this.headCollider.handle, this);
  }

  takeDamage(amount: number): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.flashT = 0.1;
    if (this.health <= 0) {
      this.dead = true;
      this.deathT = 0;
      this.respawnAt = performance.now() + 3000;
      // Move colliders out of play while dead.
      this.bodyCollider.setEnabled(false);
      this.headCollider.setEnabled(false);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.bodyMat.emissive.setHex(0xff3020);
      this.bodyMat.emissiveIntensity = this.flashT * 8;
    } else {
      this.bodyMat.emissiveIntensity = 0;
    }

    if (this.dead) {
      // Tip over, then pop back up on respawn.
      this.deathT = Math.min(1, this.deathT + dt * 3);
      this.root.rotation.x = (-Math.PI / 2) * THREE.MathUtils.smoothstep(this.deathT, 0, 1);
      if (performance.now() >= this.respawnAt) {
        this.dead = false;
        this.health = 100;
        this.root.rotation.x = 0;
        this.bodyCollider.setEnabled(true);
        this.headCollider.setEnabled(true);
      }
    }
  }
}
