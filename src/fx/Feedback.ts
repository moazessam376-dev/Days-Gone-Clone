import * as THREE from 'three';
import { FEEL } from '../config';

/**
 * Trauma-based screen shake: sources add trauma (0..1); shake magnitude is
 * trauma² driven by layered sine "noise", so small hits barely register and
 * big ones rattle. Applied additively to the camera AFTER the rig update.
 */
export class ScreenShake {
  private trauma = 0;
  private t = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Apply to camera; call after CameraRig.update. */
  apply(dt: number, camera: THREE.PerspectiveCamera): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - FEEL.shake.decay * dt);
    if (this.trauma <= 0) return;
    const shake = this.trauma * this.trauma;
    const f = FEEL.shake.freq;
    // Cheap value-noise from incommensurate sines.
    const nx = Math.sin(this.t * f * 2.7) * 0.6 + Math.sin(this.t * f * 6.3 + 1.7) * 0.4;
    const ny = Math.sin(this.t * f * 3.1 + 4.2) * 0.6 + Math.sin(this.t * f * 7.7 + 0.4) * 0.4;
    const nr = Math.sin(this.t * f * 2.2 + 2.9) * 0.7 + Math.sin(this.t * f * 5.9 + 3.3) * 0.3;
    const offset = new THREE.Vector3(
      nx * FEEL.shake.maxOffset * shake,
      ny * FEEL.shake.maxOffset * shake,
      0,
    ).applyQuaternion(camera.quaternion);
    camera.position.add(offset);
    camera.rotation.z += nr * FEEL.shake.maxRoll * shake;
  }
}

/** Brief global time-dilation on kill shots. Scales the game loop's delta. */
export class Hitstop {
  private untilRealTime = 0;

  trigger(): void {
    this.untilRealTime = performance.now() + FEEL.hitstop.durationMs;
  }

  get timeScale(): number {
    return performance.now() < this.untilRealTime ? FEEL.hitstop.scale : 1;
  }
}

/**
 * Camera recoil: shots add a pitch/yaw impulse that springs back to zero.
 * The offset is composed into the camera orientation by the rig each frame
 * (never written into the rig's stored yaw/pitch, so it always recovers).
 */
export class Recoil {
  pitch = 0;
  yaw = 0;

  kick(pitchUp: number, yaw: number): void {
    this.pitch += pitchUp;
    this.yaw += yaw;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-FEEL.recoil.recoverSpeed * dt);
    this.pitch -= this.pitch * k;
    this.yaw -= this.yaw * k;
  }
}
