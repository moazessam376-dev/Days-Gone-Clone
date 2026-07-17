import * as THREE from 'three';
import { AMMO_CRATES } from '../config';

interface Crate {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  x: number;
  z: number;
  active: boolean;
  respawnT: number;
}

/**
 * Walk-over ammo resupply: a few pulsing crates around town + the hideout.
 * Picking one up refills every weapon's reserve; the crate returns after
 * AMMO_CRATES.respawnTime.
 */
export class AmmoCrates {
  private crates: Crate[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, spots: Array<[number, number]>, heightFn: (x: number, z: number) => number) {
    const geo = new THREE.BoxGeometry(0.7, 0.5, 0.5);
    for (const [x, z] of spots) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2f5a30,
        roughness: 0.6,
        emissive: 0x3aff5a,
        emissiveIntensity: 1.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, heightFn(x, z) + 0.25, z);
      mesh.castShadow = true;
      scene.add(mesh);
      const light = new THREE.PointLight(0x46ff6a, 4, 7, 1.8);
      light.position.set(x, mesh.position.y + 0.8, z);
      scene.add(light);
      this.crates.push({ mesh, light, x, z, active: true, respawnT: 0 });
    }
  }

  /** Fixed-tick: respawn timers + pickup check. Returns true on a pickup. */
  fixedUpdate(dt: number, px: number, pz: number): boolean {
    let picked = false;
    for (const c of this.crates) {
      if (!c.active) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) {
          c.active = true;
          c.mesh.visible = true;
        }
        continue;
      }
      if (Math.hypot(px - c.x, pz - c.z) < AMMO_CRATES.pickupRadius) {
        c.active = false;
        c.respawnT = AMMO_CRATES.respawnTime;
        c.mesh.visible = false;
        picked = true;
      }
    }
    return picked;
  }

  /** Render-tick: pulse the glow. */
  render(dt: number): void {
    this.time += dt;
    for (const c of this.crates) {
      if (!c.active) {
        c.light.intensity = 0;
        continue;
      }
      const pulse = 0.6 + 0.4 * Math.sin(this.time * AMMO_CRATES.pulseSpeed);
      (c.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + pulse;
      c.light.intensity = 2.5 + pulse * 3;
    }
  }
}
