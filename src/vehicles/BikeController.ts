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
  /** Hard cap on upward velocity (m/s) — see CarController.maxRiseSpeed. */
  maxRiseSpeed: 6.5,
  /** Parking brake — see CAR.brakeForce. */
  brakeForce: 45,
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
      // Wheel pivots: our bike export names them WheelF/WheelR; the Synty
      // motorbike keeps its FBX names (SM_Veh_Motorbike_Front_Wheel_01 …).
      if (/^Wheel[FR]$/.test(o.name) || /_(Front|Rear)_Wheel/i.test(o.name)) {
        // userData.radius is in model units (needs the scale); a bbox measured
        // after setScalar above is already in world units.
        let radius = ((o.userData.radius as number) ?? 0) * scale;
        if (!radius) {
          const wb = new THREE.Box3().setFromObject(o);
          radius = Math.max(0.1, (wb.max.y - wb.min.y) / 2);
        }
        this.spinWheels.push({ node: o, radius });
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
    // Suspension anchors + radii from the model's own wheel nodes so the
    // physics stance matches the visual (a hardcoded 0.32 radius sank the
    // big-wheeled bike into the ground). Fallback: bbox-derived guesses.
    this.root.updateMatrixWorld(true);
    const _wp = new THREE.Vector3();
    const wheelInfo = this.spinWheels
      .map((w) => {
        w.node.getWorldPosition(_wp); // root is at origin → local offset
        return { y: _wp.y, z: _wp.z, radius: w.radius };
      })
      .sort((a, b) => b.z - a.z);
    const front = wheelInfo[0] ?? { y: -0.1, z: size.z / 2 - 0.25, radius: 0.32 };
    const rear = wheelInfo[wheelInfo.length - 1] ?? { y: -0.1, z: -(size.z / 2 - 0.25), radius: 0.32 };
    // Anchor sits suspSettle above the modeled wheel center: the spring
    // settles near mid-travel with the wheels exactly where the model put them.
    const suspSettle = 0.25;
    const restLength = 0.4;
    // Wheel 0 = FRONT (steered), wheel 1 = rear (driven). Both bike models'
    // noses point +z after alignment — steering the -z wheel is rear-wheel
    // steering, which reverses the felt A/D turn direction.
    for (const w of [front, rear]) {
      this.controller.addWheel(
        { x: 0, y: w.y + suspSettle, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        restLength,
        w.radius,
      );
    }
    for (let i = 0; i < 2; i++) {
      this.controller.setWheelSuspensionStiffness(i, 30);
      this.controller.setWheelFrictionSlip(i, 10);
    }

    physics.syncObject(this.body, this.root);
    scene.add(this.root);
  }

  get speed(): number {
    // Real body velocity projected on the nose direction — never Rapier's
    // currentVehicleSpeed(), which reads frozen garbage for sleeping parked
    // bodies and spun the wheels while standing still. See CarController.
    const r = this.body.rotation();
    const v = this.body.linvel();
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    return (v.x * fx + v.z * fz) * BIKE.forwardSign;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  fixedUpdate(dt: number, input: Input, driven: boolean): void {
    // Parked + asleep: skip updateVehicle entirely — it pumps suspension
    // impulses into the sleeping body's stored velocity until the bike
    // launches itself on wake. Scrub any accumulated charge (wake=false).
    if (!driven && this.body.isSleeping()) {
      const sv = this.body.linvel();
      if (sv.x !== 0 || sv.y !== 0 || sv.z !== 0) {
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      }
      return;
    }
    if (driven && this.body.isSleeping()) this.body.wakeUp();

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
      // POSITIVE steering = LEFT turn, the same sign as the car. User-
      // confirmed in play (2026-07-18) after two wrong "fixes" — trust
      // rendered chase-cam frames + playtests over heading math here.
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
    // Never fly (see CarController.maxRiseSpeed).
    const vNow = this.body.linvel();
    if (vNow.y > BIKE.maxRiseSpeed) {
      this.body.setLinvel({ x: vNow.x, y: BIKE.maxRiseSpeed, z: vNow.z }, true);
    }

    // Visual cornering lean proportional to steer × speed.
    const leanTarget = -this.steer * Math.min(1, Math.abs(this.speed) / 8) * BIKE.leanMax;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);

    // Spin the extracted spoke wheels by rolled distance (positive rotation
    // about +x rolls the tread toward +z, the nose direction).
    for (const w of this.spinWheels) {
      w.node.rotation.x += (this.speed * dt) / w.radius;
    }
  }

  updateVisuals(_dt = 0): void {
    this.model.rotation.z = this.lean;
  }

  linvel(): { x: number; z: number } {
    const v = this.body.linvel();
    return { x: v.x, z: v.z };
  }
}
