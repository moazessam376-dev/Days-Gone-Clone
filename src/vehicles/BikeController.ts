import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { VEHICLE_GROUPS, WHEEL_RAY_GROUPS } from '../physics/layers';

/** Wheel rays only see the world — see CarController for why. */

export const BIKE = {
  targetLength: 2.3,
  /** Flip if the model's nose points -z after alignment. */
  forwardSign: 1,
  engineForce: 3200,
  reverseForce: 1200,
  /** Top speed (m/s) — see CarController.maxSpeed for why this must exist. */
  maxSpeed: 24,
  brakeForce: 10,
  maxSteer: 0.7,
  steerSpeedFalloff: 14,
  leanMax: 0.42, // visual lean into corners (radians)
  runOverSpeed: 2.5,
};

/**
 * The drifter bike: a two-wheel raycast vehicle. Roll and pitch rotations
 * are locked on the rigid body (arcade balance — the bike can't fall over);
 * cornering lean is applied to the visual model instead, which reads like
 * Days Gone's drifter without a balance sim.
 */
export class BikeController {
  readonly body: RAPIER.RigidBody;
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private controller: RAPIER.DynamicRayCastVehicleController;
  private steer = 0;
  private lean = 0;
  /** Named wheel pivots (WheelF/WheelR in the exported GLB) spun by speed. */
  private spinWheels: Array<{ node: THREE.Object3D; radius: number }> = [];
  /** Chassis footprint half-extents (for the zombie steering obstacle). */
  readonly halfExtents = { hw: 0.45, hd: 1.15 };

  constructor(physics: PhysicsWorld, scene: THREE.Scene, position: THREE.Vector3, gltf: GLTF) {
    this.model = gltf.scene.clone(true);
    const preBox = new THREE.Box3().setFromObject(this.model);
    const preSize = preBox.getSize(new THREE.Vector3());
    // Bike length may be along x or z depending on export — use the larger.
    const long = Math.max(preSize.x, preSize.z);
    const scale = BIKE.targetLength / long;
    this.model.scale.setScalar(scale);
    if (preSize.x > preSize.z) this.model.rotation.y = Math.PI / 2; // align length to z
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      if (/^Wheel[FR]$/.test(o.name)) {
        this.spinWheels.push({ node: o, radius: ((o.userData.radius as number) ?? 0.24) * scale });
      }
    });
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.model.position.sub(center);
    this.root.add(this.model);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.15)
        .setAngularDamping(2.5)
        .enabledRotations(false, true, false) // yaw only — arcade balance
        .setCcdEnabled(true), // see CarController — no penetration pops
    );
    this.halfExtents.hd = size.z / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, size.y / 2.4, size.z / 2)
        .setDensity(220)
        .setCollisionGroups(VEHICLE_GROUPS),
      this.body,
    );

    this.controller = physics.world.createVehicleController(this.body);
    const radius = 0.32;
    const halfZ = size.z / 2 - 0.25;
    this.controller.addWheel({ x: 0, y: 0, z: -halfZ }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.4, radius);
    this.controller.addWheel({ x: 0, y: 0, z: halfZ }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.4, radius);
    for (let i = 0; i < 2; i++) {
      this.controller.setWheelSuspensionStiffness(i, 30);
      this.controller.setWheelFrictionSlip(i, 10);
    }

    physics.syncObject(this.body, this.root);
    scene.add(this.root);
  }

  get speed(): number {
    return this.controller.currentVehicleSpeed() * BIKE.forwardSign;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  fixedUpdate(dt: number, input: Input, driven: boolean): void {
    let engine = 0;
    let steerTarget = 0;

    if (driven) {
      const fwd = input.isDown('KeyW') ? 1 : 0;
      const back = input.isDown('KeyS') ? 1 : 0;
      engine = (fwd * BIKE.engineForce - back * BIKE.reverseForce) * BIKE.forwardSign;
      // Engine tapers to zero at top speed.
      const spd = Math.abs(this.speed);
      if (spd > BIKE.maxSpeed) engine = 0;
      else engine *= 1 - (spd / BIKE.maxSpeed) ** 3 * 0.7;
      const steerInput = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      const speedScale = 1 / (1 + Math.abs(this.speed) / BIKE.steerSpeedFalloff);
      steerTarget = steerInput * BIKE.maxSteer * speedScale * BIKE.forwardSign;
      const brake = input.isDown('Space') ? 40 : 0.3;
      this.controller.setWheelBrake(0, brake * 0.6);
      this.controller.setWheelBrake(1, brake);
    } else {
      this.controller.setWheelBrake(0, BIKE.brakeForce);
      this.controller.setWheelBrake(1, BIKE.brakeForce);
    }

    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 9);
    this.controller.setWheelSteering(0, this.steer);
    this.controller.setWheelEngineForce(1, engine);
    this.controller.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);

    // Hard horizontal speed clamp (downhill runs away from the engine taper).
    const hv = this.body.linvel();
    const hSpeed = Math.hypot(hv.x, hv.z);
    const hCap = BIKE.maxSpeed * 1.15;
    if (hSpeed > hCap) {
      const k = hCap / hSpeed;
      this.body.setLinvel({ x: hv.x * k, y: hv.y, z: hv.z * k }, true);
    }

    // Visual cornering lean proportional to steer × speed.
    const leanTarget = -this.steer * Math.min(1, Math.abs(this.speed) / 8) * BIKE.leanMax;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);

    // Spin the extracted spoke wheels by rolled distance.
    for (const w of this.spinWheels) {
      w.node.rotation.x -= (this.speed * dt) / w.radius;
    }
  }

  updateVisuals(): void {
    this.model.rotation.z = this.lean;
  }

  linvel(): { x: number; z: number } {
    const v = this.body.linvel();
    return { x: v.x, z: v.z };
  }
}
