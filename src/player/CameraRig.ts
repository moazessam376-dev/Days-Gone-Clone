import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CAMERA, CAMERA_RIG } from '../config';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CAMERA_CAST_GROUPS } from '../physics/layers';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rot = new THREE.Quaternion();
const _pivot = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Over-the-shoulder spring-arm camera.
 *
 * - Yaw/pitch from pointer-locked mouse; sensitivity scales with current FOV
 *   so aimed sensitivity feels consistent.
 * - Aim (RMB) blends FOV, shoulder offset, and arm length over aimLerpTime.
 * - Occlusion: a sphere-cast from the pivot toward the desired camera position
 *   snaps the camera in instantly on hit and recovers outward smoothly.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.15;
  private aimBlend = 0;
  private currentDistance = CAMERA_RIG.restDistance;
  private castShape: RAPIER.Ball;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private physics: PhysicsWorld,
  ) {
    this.castShape = new RAPIER.Ball(CAMERA_RIG.collisionRadius);
  }

  update(dt: number, input: Input, target: THREE.Vector3, aiming: boolean): void {
    const cfg = CAMERA_RIG;

    const fovScale = this.camera.fov / CAMERA.fov;
    if (input.locked) {
      const { dx, dy } = input.consumeMouseDelta();
      this.yaw -= dx * cfg.sensitivity * fovScale;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - dy * cfg.sensitivity * fovScale,
        cfg.pitchMin,
        cfg.pitchMax,
      );
    }

    // Aim state blend (drives FOV, shoulder, and arm length together).
    const blendStep = dt / cfg.aimLerpTime;
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (aiming ? blendStep : -blendStep), 0, 1);
    const b = THREE.MathUtils.smoothstep(this.aimBlend, 0, 1);

    const fov = THREE.MathUtils.lerp(CAMERA.fov, cfg.aimFov, b);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const shoulderX = THREE.MathUtils.lerp(cfg.shoulderX, cfg.aimShoulderX, b);
    const distance = THREE.MathUtils.lerp(cfg.restDistance, cfg.aimDistance, b);

    _euler.set(this.pitch, this.yaw, 0);
    _rot.setFromEuler(_euler);

    _pivot.copy(target).y += cfg.pivotHeight;
    _offset.set(shoulderX, 0, distance).applyQuaternion(_rot);
    _desired.copy(_pivot).add(_offset);

    // Occlusion sphere-cast from pivot toward the desired position.
    const armLength = _offset.length();
    _dir.copy(_offset).divideScalar(armLength);
    const hit = this.physics.world.castShape(
      _pivot,
      IDENTITY_ROT,
      _dir,
      this.castShape,
      0,
      armLength,
      true,
      undefined,
      CAMERA_CAST_GROUPS,
    );
    const allowed = hit ? Math.max(hit.time_of_impact - 0.05, 0.2) : armLength;

    if (allowed < this.currentDistance) {
      this.currentDistance = allowed; // snap in instantly — never clip through walls
    } else {
      this.currentDistance = Math.min(
        this.currentDistance + cfg.collisionRecoverSpeed * dt,
        allowed,
      );
    }

    this.camera.position.copy(_pivot).addScaledVector(_dir, this.currentDistance);
    this.camera.quaternion.copy(_rot);
  }
}
