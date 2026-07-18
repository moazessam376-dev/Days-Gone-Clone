import * as THREE from 'three';
import { FEEL, HANDLING } from '../config';
import { WEAPONS, WEAPON_ORDER, THROWABLE_POSES } from './weapons.data';
import type { AssetLoader } from '../core/AssetLoader';

const _muzzle = new THREE.Vector3();
const _box = new THREE.Box3();
const IDENTITY_POSE = { pos: [0, 0, 0], rot: [0, 0, 0] } as const;

/**
 * In-hand weapon models (Synty GLBs, barrel toward -Z, ~1u = 1m, baked by
 * scripts/synty-export.mts).
 *
 * The rig follows the right-hand bone's world position/rotation from scene
 * level rather than parenting into the skeleton — the animation rig carries
 * a bone scale that would explode any parented offsets.
 */
export class WeaponRig {
  private holder = new THREE.Group();
  private guns = new Map<string, THREE.Group>();
  private muzzles = new Map<string, THREE.Object3D>();
  private active = '';
  private kickZ = 0;
  private aimBlend = 0;

  constructor(scene: THREE.Scene, assets: AssetLoader) {
    scene.add(this.holder);

    const addProp = (key: string, assetKey: string, scale: number, muzzleFrom?: 'barrel' | 'top') => {
      const g = new THREE.Group();
      const model = assets.get(assetKey).scene.clone(true);
      model.scale.setScalar(scale);
      g.add(model);
      g.updateMatrixWorld(true);
      _box.setFromObject(model);

      // Muzzle: barrel exit sits in the upper part of the silhouette at the
      // -Z end (export bakes barrel-toward--Z). Throwable tip = bbox top.
      const muzzle = new THREE.Object3D();
      if (muzzleFrom === 'top') {
        muzzle.position.set(0, _box.max.y + 0.01, 0);
      } else {
        muzzle.position.set(0, (_box.min.y + _box.max.y) / 2 + (_box.max.y - _box.min.y) * 0.25, _box.min.z - 0.02);
      }
      g.add(muzzle);

      g.visible = false;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.holder.add(g);
      this.guns.set(key, g);
      this.muzzles.set(key, muzzle);
    };

    for (const key of WEAPON_ORDER) {
      const def = WEAPONS[key];
      addProp(key, def.model.asset, def.model.scale);
    }
    // Hand props for equipped throwables — same holder, same visibility
    // switching as guns (setActive('grenade' | 'molotov')).
    addProp('grenade', 'wep_grenade', 1, 'top');
    addProp('molotov', 'wep_molotov', 1, 'top');
  }

  setActive(key: string): void {
    if (this.active === key) return;
    for (const [k, g] of this.guns) g.visible = k === key;
    this.active = key;
  }

  /** Hide/show alongside the avatar (camera near-fade, driving). */
  setVisible(v: boolean): void {
    this.holder.visible = v;
  }

  kick(): void {
    this.kickZ = FEEL.recoil.weaponKick;
  }

  /**
   * Call every render frame after animation update.
   * @param aiming drives the carry↔ADS grip-pose blend (weighty-responsive
   *   times shared with the camera/avatar).
   * @param lower 0..1 swap dip — the gun sinks and pitches away mid-swap.
   */
  update(dt: number, handBone: THREE.Object3D | null, aiming = false, lower = 0): void {
    if (handBone) {
      handBone.getWorldPosition(this.holder.position);
      handBone.getWorldQuaternion(this.holder.quaternion);
    }
    this.kickZ *= Math.exp(-14 * dt);
    this.aimBlend = THREE.MathUtils.clamp(
      this.aimBlend + (aiming ? dt / HANDLING.aimInTime : -dt / HANDLING.aimOutTime),
      0,
      1,
    );
    const g = this.guns.get(this.active);
    if (!g) return;
    const def = WEAPONS[this.active];
    // Throwables use their own single grip pose for both stances.
    const tp = THROWABLE_POSES[this.active];
    const carry = def?.pose.carry ?? tp ?? IDENTITY_POSE;
    const ads = def?.pose.ads ?? tp ?? IDENTITY_POSE;
    const b = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);
    const carryPitch = def ? HANDLING.carryPitch : 0;
    g.position.set(
      THREE.MathUtils.lerp(carry.pos[0], ads.pos[0], b) - this.kickZ, // recoil back along barrel
      THREE.MathUtils.lerp(carry.pos[1], ads.pos[1], b) - 0.15 * lower,
      THREE.MathUtils.lerp(carry.pos[2], ads.pos[2], b),
    );
    g.rotation.set(
      THREE.MathUtils.lerp(carry.rot[0], ads.rot[0], b),
      THREE.MathUtils.lerp(carry.rot[1], ads.rot[1], b),
      THREE.MathUtils.lerp(carry.rot[2] + carryPitch, ads.rot[2], b) - 1.05 * lower,
    );
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const m = this.muzzles.get(this.active);
    if (!m) return out.set(0, 0, 0);
    return m.getWorldPosition(out ?? _muzzle);
  }
}
