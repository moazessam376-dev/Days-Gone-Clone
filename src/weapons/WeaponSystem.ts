import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { HIT_SCAN_GROUPS } from '../physics/layers';
import { WEAPONS, WEAPON_ORDER, type WeaponDef } from './weapons.data';
import { ACTIONS } from '../config';

export interface Damageable {
  /** Returns true if this damage killed the target. */
  takeDamage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, headshot: boolean): boolean;
  /** Collider handle of the head region, if any (headshot detection). */
  headColliderHandle?: number;
}

/** Maps Rapier collider handles to damage receivers (dummies now, freakers in M4). */
export class DamageRegistry {
  private map = new Map<number, Damageable>();

  register(handle: number, target: Damageable): void {
    this.map.set(handle, target);
  }

  unregister(handle: number): void {
    this.map.delete(handle);
  }

  lookup(handle: number): Damageable | undefined {
    return this.map.get(handle);
  }
}

export interface ShotEvents {
  onShot: (def: WeaponDef) => void;
  onHitWorld: (point: THREE.Vector3, normal: THREE.Vector3) => void;
  onHitFlesh: (point: THREE.Vector3, dir: THREE.Vector3, killed: boolean, headshot: boolean) => void;
  onReloadStart: (def: WeaponDef) => void;
  onDryFire: () => void;
}

interface AmmoState {
  mag: number;
  reserve: number;
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();


/**
 * Hitscan weapon core: trigger handling (semi/auto), ammo + reload, bloom
 * spread, deterministic recoil patterns, and pellet raycasts through the
 * reticle. Effects are emitted through ShotEvents — this class owns rules,
 * not presentation.
 */
export class WeaponSystem {
  current: string = WEAPON_ORDER[0];
  private ammo = new Map<string, AmmoState>();
  private cooldown = 0;
  private reloading = 0;
  bloom = 0;
  private patternIndex = 0;

  constructor(
    private physics: PhysicsWorld,
    private registry: DamageRegistry,
    private events: ShotEvents,
    private excludeBody: RAPIER.RigidBody,
  ) {
    for (const key of WEAPON_ORDER) {
      this.ammo.set(key, { mag: WEAPONS[key].magSize, reserve: WEAPONS[key].reserveAmmo });
    }
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  get magAmmo(): number {
    return this.ammo.get(this.current)!.mag;
  }

  get reserveAmmo(): number {
    return this.ammo.get(this.current)!.reserve;
  }

  get isReloading(): boolean {
    return this.reloading > 0;
  }

  switchTo(key: string): void {
    if (!WEAPONS[key] || key === this.current) return;
    this.current = key;
    this.reloading = 0;
    this.bloom = 0;
    this.patternIndex = 0;
    // Swapping isn't free: brief delay before the new weapon can fire.
    this.cooldown = Math.max(this.cooldown, ACTIONS.switchFireDelay);
  }

  /** Sprinting or rolling interrupts a reload (ammo only transfers at the end). */
  cancelReload(): void {
    this.reloading = 0;
  }

  /** Ammo crate pickup: top every weapon's reserve back to its data value. */
  refillReserves(): void {
    for (const key of WEAPON_ORDER) {
      this.ammo.get(key)!.reserve = WEAPONS[key].reserveAmmo;
    }
  }

  /**
   * @param camera world-space camera (ray goes through reticle center)
   * @param aiming affects spread
   * @param onRecoil camera kick callback per shot fired
   */
  fixedUpdate(
    dt: number,
    input: Input,
    camera: THREE.PerspectiveCamera,
    aiming: boolean,
    canFire: boolean,
    onRecoil: (pitch: number, yaw: number) => void,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - this.def.bloomDecay * dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const state = this.ammo.get(this.current)!;
        const take = Math.min(this.def.magSize - state.mag, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }

    if (!canFire || this.reloading > 0) {
      input.consumePressedButton(0);
      return;
    }

    const wantsFire = this.def.auto ? input.isMouseDown(0) : input.consumePressedButton(0);
    if (!wantsFire || this.cooldown > 0) return;

    const state = this.ammo.get(this.current)!;
    if (state.mag <= 0) {
      this.events.onDryFire();
      this.tryReload();
      return;
    }

    state.mag--;
    this.cooldown = 60 / this.def.rpm;
    this.fireShot(camera, aiming);
    const [rp, ry] = this.def.recoilPattern[this.patternIndex % this.def.recoilPattern.length];
    this.patternIndex++;
    onRecoil(rp, ry);
    this.bloom = Math.min(1, this.bloom + this.def.bloomPerShot);
    this.events.onShot(this.def);
    if (state.mag <= 0) this.tryReload();
  }

  tryReload(): void {
    const state = this.ammo.get(this.current)!;
    if (this.reloading > 0 || state.reserve <= 0 || state.mag >= this.def.magSize) return;
    this.reloading = this.def.reloadTime;
    this.events.onReloadStart(this.def);
  }

  /** Current effective spread half-angle in radians (drives HUD reticle too). */
  spreadAngle(aiming: boolean): number {
    const base = this.def.spread[aiming ? 1 : 0];
    return base + this.def.bloomSpread * this.bloom;
  }

  private fireShot(camera: THREE.PerspectiveCamera, aiming: boolean): void {
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _upv.setFromMatrixColumn(camera.matrixWorld, 1);

    const spread = this.spreadAngle(aiming);
    for (let p = 0; p < this.def.pellets; p++) {
      // Uniform disc sample inside the spread cone.
      const r = Math.sqrt(Math.random()) * spread;
      const theta = Math.random() * Math.PI * 2;
      const dir = _dir
        .clone()
        .addScaledVector(_right, Math.cos(theta) * r)
        .addScaledVector(_upv, Math.sin(theta) * r)
        .normalize();

      const ray = new RAPIER.Ray(_origin, dir);
      const hit = this.physics.world.castRayAndGetNormal(
        ray,
        this.def.range,
        true,
        undefined,
        HIT_SCAN_GROUPS,
        undefined,
        this.excludeBody,
      );
      if (!hit) continue;

      _point.copy(_origin).addScaledVector(dir, hit.timeOfImpact);
      _normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const target = this.registry.lookup(hit.collider.handle);
      if (target) {
        const headshot = target.headColliderHandle === hit.collider.handle;
        const dmg = this.def.damage * (headshot ? this.def.headshotMult : 1);
        const killed = target.takeDamage(dmg, _point, dir, headshot);
        this.events.onHitFlesh(_point, dir, killed, headshot);
      } else {
        this.events.onHitWorld(_point, _normal);
      }
    }
  }
}
