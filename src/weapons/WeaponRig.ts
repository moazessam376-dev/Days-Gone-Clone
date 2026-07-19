import * as THREE from 'three';
import { FEEL, HANDLING } from '../config';
import { WEAPONS, WEAPON_ORDER, THROWABLE_POSES } from './weapons.data';
import type { AssetLoader } from '../core/AssetLoader';

const _muzzle = new THREE.Vector3();
const _box = new THREE.Box3();
const _handPos = new THREE.Vector3();
const _fingerPos = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _holdQ = new THREE.Quaternion();
const _tweakQ = new THREE.Quaternion();
const _carryQ = new THREE.Quaternion();
const _adsQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _off = new THREE.Vector3();

/**
 * In-hand weapon models (Synty GLBs, barrel toward -Z, ~1u = 1m, baked by
 * scripts/synty-export.mts).
 *
 * Placement contract (Mixamo gun-clip era): the character's clips pose the
 * right wrist meaningfully in every stance, so guns follow the HAND —
 * position AND orientation. The gun's orientation = hand world orientation ×
 * HANDLING.holdRot × the weapon's own hold.rot tweak; its position = palm
 * (wrist lerped toward the index-finger base) + hold.pos in the gun's frame.
 *
 * ADS keeps the reticle honest: the orientation slerps to the camera's exact
 * yaw/pitch by aimBlend, pivoting around the grip (exports keep the pistol
 * grip near the origin) so the palm stays glued while the barrel tracks the
 * crosshair precisely.
 *
 * Throwables keep the old world-composed carry frame (they sit upright in
 * the palm; the throw arm is animated separately).
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
   * Call every render frame after animation update (the hand bone must hold
   * this frame's animated pose).
   * @param aiming drives the hand-follow↔ADS-exact blend.
   * @param lower 0..1 swap dip — the gun sinks and pitches away mid-swap.
   * @param charYaw the character model's yaw (throwable carry frame).
   * @param camYaw / @param camPitch the camera rig's aim (ADS frame).
   * @param fingerBone index-finger base: bone origins are JOINTS, so the
   *   hand bone alone is the wrist — lerping toward the finger base lands
   *   props in the palm instead of on the forearm.
   */
  update(
    dt: number,
    handBone: THREE.Object3D | null,
    aiming = false,
    lower = 0,
    charYaw = 0,
    camYaw = 0,
    camPitch = 0,
    fingerBone: THREE.Object3D | null = null,
  ): void {
    this.kickZ *= Math.exp(-14 * dt);
    this.aimBlend = THREE.MathUtils.clamp(
      this.aimBlend + (aiming ? dt / HANDLING.aimInTime : -dt / HANDLING.aimOutTime),
      0,
      1,
    );
    const g = this.guns.get(this.active);
    if (!g) return;
    if (handBone) {
      handBone.getWorldPosition(_handPos);
      if (fingerBone) {
        fingerBone.getWorldPosition(_fingerPos);
        _handPos.lerp(_fingerPos, 0.6); // wrist → mid-palm
      }
    } else _handPos.copy(this.holder.position);

    const def = WEAPONS[this.active];
    const b = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);

    if (def && handBone) {
      // ---- Gun: ride the animated hand ----
      handBone.getWorldQuaternion(_handQ);
      const hr = HANDLING.holdRot;
      const wr = def.pose.hold.rot;
      _holdQ.setFromEuler(_euler.set(hr[0], hr[1], hr[2], 'YXZ'));
      _handQ.multiply(_holdQ);
      if (wr[0] || wr[1] || wr[2]) {
        _handQ.multiply(_holdQ.setFromEuler(_euler.set(wr[0], wr[1], wr[2], 'YXZ')));
      }
      // ADS: exact camera yaw/pitch so the barrel tracks the reticle; the
      // slerp pivots around the grip (near origin) so the palm stays glued.
      _adsQ.setFromEuler(_euler.set(camPitch, camYaw, 0, 'YXZ'));
      this.holder.quaternion.copy(_handQ).slerp(_adsQ, b);
      const hp = def.pose.hold.pos;
      this.holder.position
        .copy(_handPos)
        .add(_off.set(hp[0], hp[1], hp[2]).applyQuaternion(this.holder.quaternion));
      this.holder.position.y -= 0.15 * lower;

      // Swap-dip pitch-away + recoil kick straight back along the barrel.
      _tweakQ.setFromEuler(_euler.set(-1.05 * lower, 0, 0, 'YXZ'));
      g.quaternion.copy(_tweakQ);
      g.position.set(0, 0, this.kickZ);
      return;
    }

    // ---- Throwable (or no hand bone): world-composed upright carry ----
    const tp = THROWABLE_POSES[this.active] ?? { pos: [0, 0, 0], rot: [0, 0, 0] };
    _carryQ.setFromEuler(_euler.set(0, charYaw, 0, 'YXZ'));
    _adsQ.setFromEuler(_euler.set(camPitch, camYaw, 0, 'YXZ'));
    this.holder.quaternion.copy(_carryQ).slerp(_adsQ, b);
    this.holder.position
      .copy(_handPos)
      .add(_off.set(tp.pos[0], tp.pos[1], tp.pos[2]).applyQuaternion(_carryQ));
    this.holder.position.y -= 0.15 * lower;

    _tweakQ.setFromEuler(_euler.set(tp.rot[0] - 1.05 * lower, tp.rot[1], tp.rot[2], 'YXZ'));
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
