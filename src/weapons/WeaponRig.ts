import * as THREE from 'three';
import { FEEL } from '../config';
import { WEAPONS, WEAPON_ORDER } from './weapons.data';

const _muzzle = new THREE.Vector3();

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
      // Local fit inside the hand frame — tuned visually against the
      // two-handed pistol aim pose. Barrel ends up along the hand's +X.
      g.position.set(0, 0, 0);
      g.rotation.set(0, -Math.PI / 2, 0);
      g.visible = false;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.holder.add(g);
      this.guns.set(key, g);
      this.muzzles.set(key, muzzle);
    }
  }

  setActive(key: string): void {
    if (this.active === key) return;
    for (const [k, g] of this.guns) g.visible = k === key;
    this.active = key;
  }

  kick(): void {
    this.kickZ = FEEL.recoil.weaponKick;
  }

  /** Call every render frame after animation update. */
  update(dt: number, handBone: THREE.Object3D | null): void {
    if (handBone) {
      handBone.getWorldPosition(this.holder.position);
      handBone.getWorldQuaternion(this.holder.quaternion);
    }
    this.kickZ *= Math.exp(-14 * dt);
    const g = this.guns.get(this.active);
    if (g) g.position.x = -this.kickZ; // recoil back along the barrel axis
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const m = this.muzzles.get(this.active);
    if (!m) return out.set(0, 0, 0);
    return m.getWorldPosition(out ?? _muzzle);
  }
}
