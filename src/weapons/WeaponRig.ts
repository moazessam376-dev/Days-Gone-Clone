import * as THREE from 'three';
import { FEEL, HANDLING } from '../config';
import { WEAPONS, WEAPON_ORDER, THROWABLE_POSES } from './weapons.data';
import type { AssetLoader } from '../core/AssetLoader';

const _muzzle = new THREE.Vector3();
const _box = new THREE.Box3();
const _palmR = new THREE.Vector3();
const _palmL = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _dWorld = new THREE.Vector3();
const _dLocal = new THREE.Vector3();
const _aimAxis = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _holdQ = new THREE.Quaternion();
const _swingQ = new THREE.Quaternion();
const _tweakQ = new THREE.Quaternion();
const _carryQ = new THREE.Quaternion();
const _adsQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _off = new THREE.Vector3();
const _backQ = new THREE.Quaternion();

/** Bones the rig follows; refs are stable, looked up once by Game. */
export interface RigBones {
  handR: THREE.Object3D | null;
  fingerR: THREE.Object3D | null;
  handL: THREE.Object3D | null;
  fingerL: THREE.Object3D | null;
  /** Chest bone — back-holster anchor for stowed long guns. */
  chest: THREE.Object3D | null;
}

/**
 * In-hand weapon models (Synty GLBs, barrel toward -Z, ~1u = 1m, baked by
 * scripts/synty-export.mts).
 *
 * Placement contract (grip-first): every prop has a GRIP SOCKET
 * (`pose.grip`, gun frame) — the point the right PALM wraps. The palm is
 * approximated as wrist→index-knuckle at 60% (bone origins are joints; there
 * is no palm bone). The socket is glued to the palm in every stance.
 *
 * - One-hand guns: orientation = hand world × class holdRot × per-weapon rot.
 * - Two-hand guns: the clips animate BOTH hands holding the virtual gun, so
 *   the grip→foregrip axis is swung onto the right-palm→left-palm line every
 *   frame (roll still comes from the hand). Idle fidgets then carry the gun
 *   naturally instead of levering it through the torso.
 * - ADS: orientation slerps to the camera's exact yaw/pitch; the pivot is
 *   the grip socket, so the palm stays glued while the barrel tracks the
 *   reticle precisely.
 * - Throwables keep the world-upright carry frame.
 *
 * Stowed long guns ride the back (Days Gone style), anchored to the chest
 * bone in the character's yaw frame.
 */
export class WeaponRig {
  private holder = new THREE.Group();
  private guns = new Map<string, THREE.Group>();
  private muzzles = new Map<string, THREE.Object3D>();
  private backMounts = new Map<string, THREE.Group>();
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

      // Stowed copy for the back holster (long guns only, wired in update).
      if (WEAPONS[key]?.pose.foregrip) {
        const back = new THREE.Group();
        const bm = assets.get(assetKey).scene.clone(true);
        bm.scale.setScalar(scale);
        back.add(bm);
        back.visible = false;
        back.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        scene.add(back);
        this.backMounts.set(key, back);
      }
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
    for (const [, b] of this.backMounts) b.visible = v && b.visible;
  }

  kick(): void {
    this.kickZ = FEEL.recoil.weaponKick;
  }

  /**
   * Call every render frame after animation update (the hand bones must hold
   * this frame's animated pose).
   * @param aiming drives the hand-follow↔ADS-exact blend.
   * @param lower 0..1 swap dip — the gun sinks and pitches away mid-swap.
   * @param charYaw character model yaw (throwable carry + back holster frame).
   * @param camYaw / @param camPitch the camera rig's aim (ADS frame).
   */
  update(
    dt: number,
    bones: RigBones,
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
    this.updateBackMounts(bones.chest, charYaw);
    const g = this.guns.get(this.active);
    if (!g) return;

    const palm = (hand: THREE.Object3D | null, finger: THREE.Object3D | null, out: THREE.Vector3): boolean => {
      if (!hand) return false;
      hand.getWorldPosition(out);
      if (finger) {
        finger.getWorldPosition(_tmp);
        out.lerp(_tmp, 0.6); // wrist -> mid-palm (bone origins are joints)
      }
      return true;
    };
    const hasPalmR = palm(bones.handR, bones.fingerR, _palmR);
    if (!hasPalmR) _palmR.copy(this.holder.position);

    const def = WEAPONS[this.active];
    const b = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);

    if (def && hasPalmR) {
      // ---- Gun: grip socket glued to the right palm ----
      bones.handR!.getWorldQuaternion(_handQ);
      const hr = def.cls === 'pistol' ? HANDLING.holdRotPistol : HANDLING.holdRot;
      _carryQ.copy(_handQ).multiply(_holdQ.setFromEuler(_euler.set(hr[0], hr[1], hr[2], 'YXZ')));
      const wr = def.pose.rot;
      if (wr[0] || wr[1] || wr[2]) {
        _carryQ.multiply(_holdQ.setFromEuler(_euler.set(wr[0], wr[1], wr[2], 'YXZ')));
      }
      const grip = def.pose.grip;
      // Two-hand: swing the grip→foregrip axis onto the palm→palm line (the
      // clips animate both hands on the virtual gun; this reproduces it).
      if (def.pose.foregrip && palm(bones.handL, bones.fingerL, _palmL)) {
        const fg = def.pose.foregrip;
        _dLocal.set(fg[0] - grip[0], fg[1] - grip[1], fg[2] - grip[2]).normalize();
        _dWorld.copy(_palmL).sub(_palmR);
        if (_dWorld.lengthSq() > 1e-4) {
          _dWorld.normalize();
          _aimAxis.copy(_dLocal).applyQuaternion(_carryQ);
          _swingQ.setFromUnitVectors(_aimAxis, _dWorld);
          _carryQ.premultiply(_swingQ);
        }
      }
      // ADS: exact camera yaw/pitch so the barrel tracks the reticle.
      _adsQ.setFromEuler(_euler.set(camPitch, camYaw, 0, 'YXZ'));
      this.holder.quaternion.copy(_carryQ).slerp(_adsQ, b);
      // Socket-to-palm: position so the grip point lands on the palm.
      this.holder.position
        .copy(_palmR)
        .sub(_off.set(grip[0], grip[1], grip[2]).applyQuaternion(this.holder.quaternion));
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
      .copy(_palmR)
      .add(_off.set(tp.pos[0], tp.pos[1], tp.pos[2]).applyQuaternion(_carryQ));
    this.holder.position.y -= 0.15 * lower;

    _tweakQ.setFromEuler(_euler.set(tp.rot[0] - 1.05 * lower, tp.rot[1], tp.rot[2], 'YXZ'));
    g.quaternion.copy(_tweakQ);
    g.position.set(0, 0, this.kickZ);
  }

  /** Stowed long guns ride the back, Days Gone style: mounted in the CHEST
   * BONE's local frame so they lean with the spine (a yaw-frame mount
   * clipped through the torso whenever the body leaned), staggered so two
   * guns never z-fight. */
  private updateBackMounts(chest: THREE.Object3D | null, _charYaw: number): void {
    let slot = 0;
    for (const [key, back] of this.backMounts) {
      const show = key !== this.active && !!chest && this.holder.visible;
      back.visible = show;
      if (!show || !chest) continue;
      chest.getWorldPosition(_tmp);
      chest.getWorldQuaternion(_backQ);
      const bo = HANDLING.backOffset;
      _off.set(bo[0] + slot * -0.05, bo[1] + slot * -0.09, bo[2] + slot * 0.05).applyQuaternion(_backQ);
      back.position.copy(_tmp).add(_off);
      const br = HANDLING.backRot;
      back.quaternion
        .copy(_backQ)
        .multiply(_holdQ.setFromEuler(_euler.set(br[0], br[1], br[2] + slot * 0.12, 'YXZ')));
      slot++;
    }
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
