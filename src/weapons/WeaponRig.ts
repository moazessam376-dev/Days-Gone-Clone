import * as THREE from 'three';
import { FEEL, HANDLING } from '../config';
import { WEAPONS, WEAPON_ORDER } from './weapons.data';

const _muzzle = new THREE.Vector3();
const IDENTITY_POSE = { pos: [0, 0, 0], rot: [0, 0, 0] } as const;

/**
 * Placeholder boxy gun models (replaced by real assets in a polish pass).
 *
 * The rig follows the right-hand bone's world position/rotation from scene
 * level rather than parenting into the skeleton — the Quaternius armature
 * carries a 100× bone scale that would explode any parented offsets.
 */
export class WeaponRig {
  private holder = new THREE.Group();
  private guns = new Map<string, THREE.Group>();
  private muzzles = new Map<string, THREE.Object3D>();
  private active = '';
  private kickZ = 0;
  private aimBlend = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.holder);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, metalness: 0.6 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3f3428, roughness: 0.9 });

    for (const key of WEAPON_ORDER) {
      const def = WEAPONS[key];
      const g = new THREE.Group();

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, def.model.bodyLen), metal);
      g.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, def.model.barrelLen), metal);
      barrel.position.set(0, 0.02, -(def.model.bodyLen / 2 + def.model.barrelLen / 2));
      g.add(barrel);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.09, 0.045), grip);
      handle.position.set(0, -0.07, def.model.bodyLen / 2 - 0.03);
      handle.rotation.x = 0.25;
      g.add(handle);
      if (key === 'shotgun' || key === 'rifle') {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.16), grip);
        stock.position.set(0, -0.02, def.model.bodyLen / 2 + 0.08);
        g.add(stock);
      }

      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.02, -(def.model.bodyLen / 2 + def.model.barrelLen + 0.02));
      g.add(muzzle);

      g.scale.setScalar(def.model.scale);
      // Pose (position + rotation in the hand frame) now comes from the
      // per-weapon per-stance grip data — applied every frame in update().
      g.visible = false;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.holder.add(g);
      this.guns.set(key, g);
      this.muzzles.set(key, muzzle);
    }

    // Hand props for equipped throwables — same holder, same visibility
    // switching as guns (setActive('grenade' | 'molotov')).
    const grenade = new THREE.Group();
    grenade.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.6 }),
      ),
    );
    const molotov = new THREE.Group();
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.22, 10),
      new THREE.MeshStandardMaterial({
        color: 0xc06a28,
        roughness: 0.4,
        emissive: 0xff6a10,
        emissiveIntensity: 0.6,
      }),
    );
    molotov.add(bottle);
    for (const [key, prop] of [
      ['grenade', grenade],
      ['molotov', molotov],
    ] as Array<[string, THREE.Group]>) {
      prop.visible = false;
      prop.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      const tip = new THREE.Object3D();
      prop.add(tip);
      this.holder.add(prop);
      this.guns.set(key, prop);
      this.muzzles.set(key, tip);
    }
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
    // Throwable props have no pose data — identity grip.
    const carry = def?.pose.carry ?? IDENTITY_POSE;
    const ads = def?.pose.ads ?? IDENTITY_POSE;
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
