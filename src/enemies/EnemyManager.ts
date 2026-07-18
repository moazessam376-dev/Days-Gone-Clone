import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ENEMY } from '../config';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { ENEMY_BODY_GROUPS, CORPSE_GROUPS } from '../physics/layers';
import { DamageRegistry, type Damageable } from '../weapons/WeaponSystem';
import { SpatialHash } from './SpatialHash';

export const enum EnemyState {
  INACTIVE = 0,
  CHASE = 1,
  ATTACK = 2,
  STAGGER = 3,
  CORPSE = 4,
}

export interface EnemyEvents {
  /** An attack connected with the player. */
  onPlayerHit: (damage: number, fromX: number, fromZ: number) => void;
  /** An enemy died: forward the ragdoll impulse info for effects. */
  onDeath: (index: number, point: THREE.Vector3, dir: THREE.Vector3) => void;
  /** An enemy is banging on a breakable barrier. */
  onBarrierHit?: (x: number, z: number) => void;
}

export interface EnemyBreakable {
  takeDamage(amount: number): boolean;
  x: number;
  z: number;
}

export type EnemyBlock = null | { wall: true } | { breakable: EnemyBreakable };

interface PoolSlot {
  body: RAPIER.RigidBody;
  bodyCollider: RAPIER.Collider;
  headCollider: RAPIER.Collider;
  enemy: number; // -1 = unassigned
  adapter: PoolDamageAdapter;
}

interface CorpseSlot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  enemy: number;
  releaseAt: number; // game time seconds
}

class PoolDamageAdapter implements Damageable {
  headColliderHandle = -1;

  constructor(
    private manager: EnemyManager,
    private slot: () => number,
  ) {}

  takeDamage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, headshot: boolean): boolean {
    const enemy = this.manager.poolSlotEnemy(this.slot());
    if (enemy < 0) return false;
    return this.manager.damage(enemy, amount, point, dir, headshot);
  }
}

/**
 * Data-oriented enemy system (struct-of-arrays, capacity 512).
 *
 * Gameplay state lives in typed arrays; rendering (EnemyRenderer) and physics
 * (a pooled set of ~32 kinematic capsules for the nearest enemies — Rapier
 * never sees the whole crowd) are thin views over this data. This is the
 * architecture contract that lets phase 2 scale to 100–300-freaker hordes by
 * swapping only the renderer (vertex-animation-texture instancing).
 *
 * AI LOD: near enemies get full logic + physics; mid enemies steer without
 * physics; far enemies tick at 1/8 rate.
 */
export class EnemyManager {
  readonly posX = new Float32Array(ENEMY.capacity);
  readonly posY = new Float32Array(ENEMY.capacity);
  readonly posZ = new Float32Array(ENEMY.capacity);
  readonly velX = new Float32Array(ENEMY.capacity);
  readonly velZ = new Float32Array(ENEMY.capacity);
  readonly yaw = new Float32Array(ENEMY.capacity);
  readonly health = new Float32Array(ENEMY.capacity);
  readonly state = new Uint8Array(ENEMY.capacity);
  readonly attackT = new Float32Array(ENEMY.capacity);
  readonly staggerT = new Float32Array(ENEMY.capacity);
  /** 0 idle, 1 walk, 2 run, 3 bite — consumed by the renderer. */
  readonly animId = new Uint8Array(ENEMY.capacity);
  /** Seconds of burning remaining per enemy (fire DoT). */
  readonly burnT = new Float32Array(ENEMY.capacity);

  readonly active: number[] = [];
  // Covers the full 2048m world — queries outside the grid clamp to edge
  // cells and silently miss, so the extent must match WORLD.size.
  private hash = new SpatialHash(-1024, -1024, 2048, 4, ENEMY.capacity);
  private pool: PoolSlot[] = [];
  private corpses: CorpseSlot[] = [];
  private tick = 0;
  private time = 0;
  private attackDidHit = new Uint8Array(ENEMY.capacity);
  /** Terrain height sampler (flat world until M5 wires the real one). */
  heightFn: (x: number, z: number) => number = () => 0;
  /** Static-world steering query (buildings, breakable barriers). */
  obstacles: ((x: number, z: number) => EnemyBlock) | null = null;
  private barrierDps = 14;

  constructor(physics: PhysicsWorld, registry: DamageRegistry, private events: EnemyEvents) {
    // Enemies don't physically block the car — run-over kills are handled by
    // the sweep, so the car must be able to plow through the crowd.
    const groups = ENEMY_BODY_GROUPS;
    for (let s = 0; s < ENEMY.physicsPoolSize; s++) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100 - s * 3, 0),
      );
      const bodyCollider = physics.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.55, 0.32).setCollisionGroups(groups),
        body,
      );
      const headCollider = physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.17).setTranslation(0, 0.75, 0).setCollisionGroups(groups),
        body,
      );
      const slotIndex = s;
      const adapter = new PoolDamageAdapter(this, () => slotIndex);
      adapter.headColliderHandle = headCollider.handle;
      registry.register(bodyCollider.handle, adapter);
      registry.register(headCollider.handle, adapter);
      this.pool.push({ body, bodyCollider, headCollider, enemy: -1, adapter });
    }

    const corpseGroups = CORPSE_GROUPS;
    for (let c = 0; c < ENEMY.corpsePoolSize; c++) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -200 - c * 3, 0),
      );
      body.setEnabled(false);
      // Human-weight body: box is 0.4×0.28×1.6 m = 0.1792 m³.
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 0.14, 0.8)
          .setDensity(ENEMY.corpseMass / 0.1792)
          .setCollisionGroups(corpseGroups),
        body,
      );
      this.corpses.push({ body, collider, enemy: -1, releaseAt: 0 });
    }
  }

  poolSlotEnemy(slot: number): number {
    return this.pool[slot].enemy;
  }

  /** Corpse transform for the renderer (null if enemy isn't a corpse). */
  corpseTransform(enemy: number): { body: RAPIER.RigidBody } | null {
    for (const c of this.corpses) if (c.enemy === enemy) return { body: c.body };
    return null;
  }

  spawn(x: number, z: number): number {
    for (let i = 0; i < ENEMY.capacity; i++) {
      if (this.state[i] === EnemyState.INACTIVE) {
        this.posX[i] = x;
        this.posY[i] = this.heightFn(x, z);
        this.posZ[i] = z;
        this.velX[i] = 0;
        this.velZ[i] = 0;
        this.health[i] = ENEMY.health;
        this.state[i] = EnemyState.CHASE;
        this.yaw[i] = Math.random() * Math.PI * 2;
        this.attackT[i] = 0;
        this.staggerT[i] = 0;
        this.animId[i] = 1;
        this.active.push(i);
        return i;
      }
    }
    return -1;
  }

  damage(i: number, amount: number, point: THREE.Vector3, dir: THREE.Vector3, _headshot: boolean): boolean {
    if (this.state[i] === EnemyState.INACTIVE || this.state[i] === EnemyState.CORPSE) return false;
    this.health[i] -= amount;
    if (this.health[i] <= 0) {
      this.kill(i, point, dir);
      return true;
    }
    this.state[i] = EnemyState.STAGGER;
    this.staggerT[i] = ENEMY.staggerTime;
    return false;
  }

  private kill(i: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    this.state[i] = EnemyState.CORPSE;
    // Grab a corpse body (steal the oldest if all are busy).
    let slot = this.corpses.find((c) => c.enemy === -1);
    if (!slot) {
      slot = this.corpses.reduce((a, b) => (a.releaseAt < b.releaseAt ? a : b));
      if (slot.enemy >= 0) this.releaseEnemy(slot.enemy);
      slot.enemy = -1;
    }
    slot.enemy = i;
    slot.releaseAt = this.time + ENEMY.corpseTime;
    slot.body.setEnabled(true);
    slot.body.setTranslation({ x: this.posX[i], y: this.posY[i] + 0.9, z: this.posZ[i] }, true);
    slot.body.setRotation({ x: 0, y: Math.sin(this.yaw[i] / 2), z: 0, w: Math.cos(this.yaw[i] / 2) }, true);
    // Velocities are set directly: impulses are silently dropped on a body
    // re-enabled this same tick (its mass reads 0 until the next step).
    if (Math.abs(dir.y) > 0.9) {
      // Fire/vertical kill: crumple in place with a lazy random topple.
      const a = Math.random() * Math.PI * 2;
      slot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      slot.body.setAngvel(
        { x: Math.cos(a) * ENEMY.corpseSpinSpeed * 0.5, y: 0, z: Math.sin(a) * ENEMY.corpseSpinSpeed * 0.5 },
        true,
      );
    } else {
      slot.body.setLinvel(
        { x: dir.x * ENEMY.corpseKnockSpeed, y: ENEMY.corpseUpSpeed, z: dir.z * ENEMY.corpseKnockSpeed },
        true,
      );
      slot.body.setAngvel(
        { x: dir.z * ENEMY.corpseSpinSpeed, y: 0, z: -dir.x * ENEMY.corpseSpinSpeed },
        true,
      );
    }
    this.events.onDeath(i, point, dir);
  }

  private releaseEnemy(i: number): void {
    this.state[i] = EnemyState.INACTIVE;
    const k = this.active.indexOf(i);
    if (k >= 0) this.active.splice(k, 1);
  }

  fixedUpdate(dt: number, playerX: number, playerZ: number): void {
    this.tick++;
    this.time += dt;

    // Corpse lifetimes + speed cap (vehicles shove bodies; the clamp keeps a
    // solver kick from ever launching one — see docs/collision-matrix.md).
    for (const c of this.corpses) {
      if (c.enemy < 0) continue;
      if (this.time >= c.releaseAt) {
        this.releaseEnemy(c.enemy);
        c.enemy = -1;
        c.body.setEnabled(false);
        c.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
        continue;
      }
      const v = c.body.linvel();
      const s = Math.hypot(v.x, v.y, v.z);
      if (s > ENEMY.corpseMaxSpeed) {
        const k = ENEMY.corpseMaxSpeed / s;
        c.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      }
    }

    // Rebuild the spatial hash from live (non-corpse) enemies.
    const live = this.active.filter((i) => this.state[i] !== EnemyState.CORPSE);
    this.hash.rebuild(live, this.posX, this.posZ);

    for (const i of live) {
      const dx = playerX - this.posX[i];
      const dz = playerZ - this.posZ[i];
      const dist = Math.hypot(dx, dz);

      // Far enemies tick at 1/8 rate with scaled dt.
      const far = dist > ENEMY.aiLod.midDist;
      if (far && (this.tick + i) % ENEMY.aiLod.farTickDivider !== 0) continue;
      const stepDt = far ? dt * ENEMY.aiLod.farTickDivider : dt;

      if (this.state[i] === EnemyState.STAGGER) {
        this.staggerT[i] -= stepDt;
        this.velX[i] *= 0.8;
        this.velZ[i] *= 0.8;
        if (this.staggerT[i] <= 0) this.state[i] = EnemyState.CHASE;
        this.animId[i] = 0;
        continue;
      }

      if (this.state[i] === EnemyState.ATTACK) {
        const prevT = this.attackT[i];
        this.attackT[i] += stepDt;
        this.yaw[i] = Math.atan2(dx, dz);
        this.velX[i] = 0;
        this.velZ[i] = 0;
        this.animId[i] = 3;
        // Damage lands once, at the windup point, if still in range.
        if (
          prevT < ENEMY.attackWindup &&
          this.attackT[i] >= ENEMY.attackWindup &&
          !this.attackDidHit[i] &&
          dist < ENEMY.attackRange * 1.25
        ) {
          this.attackDidHit[i] = 1;
          this.events.onPlayerHit(ENEMY.attackDamage, this.posX[i], this.posZ[i]);
        }
        if (this.attackT[i] >= ENEMY.attackCooldown) {
          this.attackT[i] = 0;
          this.attackDidHit[i] = 0;
          this.state[i] = EnemyState.CHASE;
        }
        continue;
      }

      // CHASE: steer at the player with neighbor separation.
      let sx = 0;
      let sz = 0;
      this.hash.query(this.posX[i], this.posZ[i], ENEMY.separationRadius, (j) => {
        if (j === i) return;
        const ox = this.posX[i] - this.posX[j];
        const oz = this.posZ[i] - this.posZ[j];
        const d2 = ox * ox + oz * oz;
        if (d2 > 0.0001 && d2 < ENEMY.separationRadius * ENEMY.separationRadius) {
          const d = Math.sqrt(d2);
          const push = (ENEMY.separationRadius - d) / ENEMY.separationRadius;
          sx += (ox / d) * push;
          sz += (oz / d) * push;
        }
      });

      const speed = dist < ENEMY.runDistance ? ENEMY.runSpeed : ENEMY.walkSpeed;
      const inv = dist > 0.001 ? 1 / dist : 0;
      // Cap separation below seek so a dense pack can never steer itself
      // away from the player — crowding spreads the pack, not the pursuit.
      let sepX = sx * ENEMY.separationForce;
      let sepZ = sz * ENEMY.separationForce;
      const sepLen = Math.hypot(sepX, sepZ);
      const sepMax = speed * ENEMY.separationCap;
      if (sepLen > sepMax) {
        sepX *= sepMax / sepLen;
        sepZ *= sepMax / sepLen;
      }
      let vx = dx * inv * speed + sepX;
      let vz = dz * inv * speed + sepZ;
      const vLen = Math.hypot(vx, vz);
      if (vLen > speed) {
        vx = (vx / vLen) * speed;
        vz = (vz / vLen) * speed;
      }
      const nx = this.posX[i] + vx * stepDt;
      const nz = this.posZ[i] + vz * stepDt;
      let biteX = 0;
      let biteZ = 0;
      let biting = false;
      // If already inside blocked space (bad spawn, edge case), walk free to escape.
      const curBlocked = this.obstacles ? this.obstacles(this.posX[i], this.posZ[i]) : null;
      const block = this.obstacles && !curBlocked ? this.obstacles(nx, nz) : null;
      if (!block) {
        this.posX[i] = nx;
        this.posZ[i] = nz;
        this.animId[i] = speed === ENEMY.runSpeed ? 2 : 1;
      } else {
        // Wall in the way: slide at FULL speed along whichever axis is free,
        // preferring the one with more desired motion. The leftover-component
        // slide it replaces marched whole packs slowly along walls in lockstep.
        const canX = Math.abs(vx) > 0.01 && !this.obstacles!(this.posX[i] + Math.sign(vx) * speed * stepDt, this.posZ[i]);
        const canZ = Math.abs(vz) > 0.01 && !this.obstacles!(this.posX[i], this.posZ[i] + Math.sign(vz) * speed * stepDt);
        let mx = 0;
        let mz = 0;
        if (canX && (!canZ || Math.abs(vx) >= Math.abs(vz))) mx = Math.sign(vx) * speed;
        else if (canZ) mz = Math.sign(vz) * speed;
        this.posX[i] += mx * stepDt;
        this.posZ[i] += mz * stepDt;
        vx = mx;
        vz = mz;
        if ('breakable' in block && block.breakable) {
          this.animId[i] = 3; // bite the barrier
          biting = true;
          biteX = block.breakable.x;
          biteZ = block.breakable.z;
          block.breakable.takeDamage(this.barrierDps * stepDt);
          if (Math.random() < stepDt * 4) {
            this.events.onBarrierHit?.(block.breakable.x, block.breakable.z);
          }
        } else {
          this.animId[i] = mx !== 0 || mz !== 0 ? (speed === ENEMY.runSpeed ? 2 : 1) : 0;
        }
      }
      this.velX[i] = vx;
      this.velZ[i] = vz;
      this.posY[i] = this.heightFn(this.posX[i], this.posZ[i]);
      // Face the motion actually applied this tick; biting a barrier faces it.
      if (biting) {
        this.yaw[i] = Math.atan2(biteX - this.posX[i], biteZ - this.posZ[i]);
      } else if (Math.hypot(vx, vz) > 0.1) {
        this.yaw[i] = Math.atan2(vx, vz);
      }

      if (dist < ENEMY.attackRange) {
        this.state[i] = EnemyState.ATTACK;
        this.attackT[i] = 0;
        this.attackDidHit[i] = 0;
      }
    }

    this.assignPhysicsPool(playerX, playerZ, live);
  }

  /** Nearest live enemies get the pooled kinematic bodies (shootable + solid). */
  private assignPhysicsPool(px: number, pz: number, live: number[]): void {
    const byDist = live
      .map((i) => {
        const dx = px - this.posX[i];
        const dz = pz - this.posZ[i];
        return { i, d2: dx * dx + dz * dz };
      })
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, this.pool.length)
      .map((e) => e.i);

    const wanted = new Set(byDist);
    // Free slots whose enemy is no longer wanted.
    for (const slot of this.pool) {
      if (slot.enemy >= 0 && (!wanted.has(slot.enemy) || this.state[slot.enemy] === EnemyState.CORPSE)) {
        slot.enemy = -1;
      } else {
        wanted.delete(slot.enemy);
      }
    }
    // Assign remaining wanted enemies to free slots.
    for (const i of wanted) {
      const slot = this.pool.find((s) => s.enemy === -1);
      if (!slot) break;
      slot.enemy = i;
    }
    // Move bodies to their enemies (parked far below when unassigned).
    for (let s = 0; s < this.pool.length; s++) {
      const slot = this.pool[s];
      if (slot.enemy >= 0) {
        const i = slot.enemy;
        slot.body.setNextKinematicTranslation({ x: this.posX[i], y: this.posY[i] + 0.87, z: this.posZ[i] });
      } else {
        slot.body.setNextKinematicTranslation({ x: 0, y: -100 - s * 3, z: 0 });
      }
    }
  }

  /** Melee sweep: damage live enemies within range and facing arc. */
  meleeSweep(
    originX: number,
    originZ: number,
    facingYaw: number,
    range: number,
    arcRad: number,
    amount: number,
    events: { onHit: (i: number, x: number, z: number, killed: boolean) => void },
  ): void {
    const point = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.hash.query(originX, originZ, range, (i) => {
      if (this.state[i] === EnemyState.CORPSE || this.state[i] === EnemyState.INACTIVE) return;
      const dx = this.posX[i] - originX;
      const dz = this.posZ[i] - originZ;
      const dist = Math.hypot(dx, dz);
      if (dist > range) return;
      const angTo = Math.atan2(dx, dz);
      let diff = angTo - facingYaw;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(diff) > arcRad / 2) return;
      point.set(this.posX[i], 1.1, this.posZ[i]);
      dir.set(dx / (dist || 1), 0, dz / (dist || 1));
      const killed = this.damage(i, amount, point, dir, false);
      // Knockback surviving enemies.
      if (!killed) {
        this.posX[i] += dir.x * 0.5;
        this.posZ[i] += dir.z * 0.5;
      }
      events.onHit(i, this.posX[i], this.posZ[i], killed);
    });
  }

  /** Fire DoT: ignite enemies standing in fire, drain burning ones. */
  burnTick(dt: number, isBurningAt: (x: number, z: number) => boolean, dps: number, duration: number): void {
    const point = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const i of this.active) {
      if (this.state[i] === EnemyState.CORPSE) continue;
      if (this.burnT[i] <= 0 && isBurningAt(this.posX[i], this.posZ[i])) {
        this.burnT[i] = duration;
      }
      if (this.burnT[i] > 0) {
        this.burnT[i] -= dt;
        this.health[i] -= dps * dt;
        if (this.health[i] <= 0) {
          point.set(this.posX[i], this.posY[i] + 1, this.posZ[i]);
          this.kill(i, point, up);
          this.burnT[i] = 0;
        }
      }
    }
  }

  /** Explosion AoE with linear falloff and outward kill impulses. */
  explosionAt(x: number, z: number, radius: number, maxDamage: number): number {
    const point = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let kills = 0;
    this.hash.query(x, z, radius, (i) => {
      if (this.state[i] === EnemyState.CORPSE || this.state[i] === EnemyState.INACTIVE) return;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) return;
      const dmg = maxDamage * (1 - dist / radius);
      point.set(this.posX[i], this.posY[i] + 1, this.posZ[i]);
      dir.set(dx / (dist || 1), 0.4, dz / (dist || 1)).normalize();
      if (this.damage(i, dmg, point, dir, false)) kills++;
    });
    return kills;
  }

  /** Molotov splash: set live enemies in the radius burning immediately. */
  igniteInRadius(x: number, z: number, radius: number, duration: number): void {
    this.hash.query(x, z, radius, (i) => {
      if (this.state[i] === EnemyState.CORPSE || this.state[i] === EnemyState.INACTIVE) return;
      if (Math.hypot(this.posX[i] - x, this.posZ[i] - z) > radius) return;
      this.burnT[i] = duration;
    });
  }

  /**
   * Vehicle run-over: kill live enemies inside the radius and FLING the
   * corpses clear to the side. The corpse body must never spawn overlapping
   * the chassis — corpses collide with vehicles, and a 70 kg box
   * materializing interpenetrated with the car ejects BOTH violently (this
   * was the "car launches when boarding inside a mob" bug).
   */
  runOverSweep(x: number, z: number, radius: number, velX: number, velZ: number,
    onKill: (px: number, pz: number) => void): void {
    const point = new THREE.Vector3();
    const speed = Math.hypot(velX, velZ) || 1;
    const dir = new THREE.Vector3(velX / speed, 0, velZ / speed);
    // Unit perpendicular to the drive direction (the fling axis).
    const px = -dir.z;
    const pz = dir.x;
    this.hash.query(x, z, radius, (i) => {
      if (this.state[i] === EnemyState.CORPSE || this.state[i] === EnemyState.INACTIVE) return;
      if (Math.hypot(this.posX[i] - x, this.posZ[i] - z) > radius) return;
      point.set(this.posX[i], this.posY[i] + 1, this.posZ[i]);
      const ex = this.posX[i];
      const ez = this.posZ[i];
      this.damage(i, 1000, point, dir, false);
      // Relocate the fresh corpse outside the sweep radius on whichever side
      // the victim was, and send it tumbling that way.
      const slot = this.corpses.find((c) => c.enemy === i);
      if (slot) {
        const side = Math.sign((ex - x) * px + (ez - z) * pz) || 1;
        const cx = x + px * side * (radius + 0.7);
        const cz = z + pz * side * (radius + 0.7);
        slot.body.setTranslation({ x: cx, y: this.heightFn(cx, cz) + 0.9, z: cz }, true);
        slot.body.setLinvel(
          {
            x: velX * 0.35 + px * side * 3.5,
            y: 1.8,
            z: velZ * 0.35 + pz * side * 3.5,
          },
          true,
        );
      }
      onKill(ex, ez);
    });
  }

  reset(): void {
    for (const i of [...this.active]) this.releaseEnemy(i);
    for (const c of this.corpses) {
      c.enemy = -1;
      c.body.setEnabled(false);
    }
    for (const s of this.pool) s.enemy = -1;
  }
}
