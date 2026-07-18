import * as THREE from 'three';
import { FEEL, HANDLING } from '../config';
import { WEAPONS, WEAPON_ORDER, THROWABLE_POSES } from './weapons.data';
import type { AssetLoader } from '../core/AssetLoader';

const _muzzle = new THREE.Vector3();
const _box = new THREE.Box3();
const _handPos = new THREE.Vector3();
const _carryQ = new THREE.Quaternion();
const _adsQ = new THREE.Quaternion();
const _tweakQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _off = new THREE.Vector3();
const _posCarry = new THREE.Vector3();
const _posAds = new THREE.Vector3();
const IDENTITY_POSE = { pos: [0, 0, 0], rot: [0, 0, 0] } as const;

/**
 * In-hand weapon models (Synty GLBs, barrel toward -Z, ~1u = 1m, baked by
 * scripts/synty-export.mts).
 *
 * Placement contract (R2 playtest fix — guns used to inherit the hand bone's
 * noisy local axes and dangled muzzle-down at the thigh):
 * - POSITION follows the right-hand bone, plus a per-weapon offset.
 * - ORIENTATION is composed in world space and never taken from the bone:
 *   carry = character yaw + HANDLING.carryPitch (low-ready, barrel forward-
 *   down); ADS = the camera's exact yaw+pitch, so the barrel always tracks
 *   the reticle. The two blend with the same weighty-responsive aim times as
 *   the camera. Throwables use the carry frame with a small fixed tilt.
 *
 * Per-weapon `pose.pos` offsets are expressed in the GUN's oriented frame
 * (x right, y up, z toward the stock) and move the gun so its grip sits in
 * the palm; `pose.rot` is an extra local euler tweak (used by throwables).
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
   * @param aiming drives the carry↔ADS blend (weighty-responsive times).
   * @param lower 0..1 swap dip — the gun sinks and pitches away mid-swap.
   * @param charYaw the character model's yaw (carry frame).
   * @param camYaw / @param camPitch the camera rig's aim (ADS frame).
   */
  update(
    dt: number,
    handBone: THREE.Object3D | null,
    aiming = false,
    lower = 0,
    charYaw = 0,
    camYaw = 0,
    camPitch = 0,
  ): void {
    this.kickZ *= Math.exp(-14 * dt);
    this.aimBlend = THREE.MathUtils.clamp(
      this.aimBlend + (aiming ? dt / HANDLING.aimInTime : -dt / HANDLING.aimOutTime),
      0,
      1,
    );
    const g = this.guns.get(this.active);
    if (!g) return;
    if (handBone) handBone.getWorldPosition(_handPos);
    else _handPos.copy(this.holder.position);

    const def = WEAPONS[this.active];
    const tp = THROWABLE_POSES[this.active];
    const carry = def?.pose.carry ?? tp ?? IDENTITY_POSE;
    const ads = def?.pose.ads ?? tp ?? IDENTITY_POSE;
    const b = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);

    // Carry frame: barrel along the character's facing, pitched down into
    // low-ready. Throwables stay world-upright (no carry pitch).
    const carryPitch = def ? HANDLING.carryPitch : 0;
    _carryQ.setFromEuler(_euler.set(carryPitch, charYaw + Math.PI, 0, 'YXZ'));
    // ADS frame: exactly the camera's aim — the barrel tracks the reticle.
    _adsQ.setFromEuler(_euler.set(camPitch, camYaw, 0, 'YXZ'));

    _posCarry.copy(_handPos).add(_off.set(carry.pos[0], carry.pos[1], carry.pos[2]).applyQuaternion(_carryQ));
    _posAds.copy(_handPos).add(_off.set(ads.pos[0], ads.pos[1], ads.pos[2]).applyQuaternion(_adsQ));

    this.holder.quaternion.copy(_carryQ).slerp(_adsQ, b);
    this.holder.position.lerpVectors(_posCarry, _posAds, b);
    this.holder.position.y -= 0.15 * lower;

    // Local tweaks: per-pose euler (throwable tilts), swap-dip pitch-away,
    // recoil kick straight back along the barrel.
    const rot = b < 0.5 ? carry.rot : ads.rot;
    _tweakQ.setFromEuler(_euler.set(rot[0] - 1.05 * lower, rot[1], rot[2], 'YXZ'));
    g.quaternion.copy(_tweakQ);
    g.position.set(0, 0, this.kickZ);
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const m = this.muzzles.get(this.active);
    if (!m) return out.set(0, 0, 0);
    return m.getWorldPosition(out ?? _muzzle);
  }

  /** World position of the active gun's foregrip (left-hand IK target), or
   * null for one-handed weapons/throwables. Call after update(). */
  foregripWorld(out: THREE.Vector3): THREE.Vector3 | null {
    const fg = WEAPONS[this.active]?.pose.foregrip;
    const g = this.guns.get(this.active);
    if (!fg || !g) return null;
    this.holder.updateMatrixWorld(true);
    return out.set(fg[0], fg[1], fg[2]).applyMatrix4(g.matrixWorld);
  }
}
