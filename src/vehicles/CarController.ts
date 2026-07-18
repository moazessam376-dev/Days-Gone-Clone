import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { VEHICLE_GROUPS, WHEEL_RAY_GROUPS } from '../physics/layers';

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export const CAR = {
  targetLength: 4.4, // meters, sedan scaled to this
  engineForce: 9000,
  reverseForce: 4500,
  /** Top speed (m/s). Without it engine force accumulates unbounded — the
   * playtests hit 40+ m/s and every terrain crest became a launch ramp. */
  maxSpeed: 22,
  /** Parking brake. Must actually hold on hills: with real suspension travel
   * (post maxSuspensionForce fix) the chassis no longer beaches on its own
   * collider, so weak brakes let parked cars roll away downhill. */
  brakeForce: 80,
  handbrakeForce: 120,
  maxSteer: 0.55,
  steerSpeedFalloff: 18,
  runOverSpeed: 2.5,
  maxAngvel: 6, // rad/s cap — no violent tumbles
  /** Hard cap on upward velocity (m/s) — small crest hops ok, launches never. */
  maxRiseSpeed: 6.5,
  /** Suspension travel + where in it the springs settle (see constructor). */
  suspRest: 0.4,
  suspSettle: 0.2,
  airDamping: 2.5, // extra angular damping while airborne (per second)
  uprightTorque: 14, // rad/s² of righting acceleration when tipped
  uprightMaxUpY: 0.5, // consider "flipped" below this chassis-up.y
  uprightMaxSpeed: 2.5, // only auto-right when this slow
  uprightResetTime: 1.5, // still flipped after this long → snap upright
};

/** Wheel suspension rays must only see the world, never enemies/players —
 * a raycast landing on an (infinite-mass) kinematic zombie capsule reads as
 * ground and catapults the chassis. */

/**
 * Rapier raycast-vehicle car with the Kenney sedan model. The GLB's own
 * wheel nodes provide both the visual wheels and the suspension connection
 * points, so the wheels sit exactly where the model expects them.
 */
export class CarController {
  readonly body: RAPIER.RigidBody;
  readonly root = new THREE.Group();
  private controller: RAPIER.DynamicRayCastVehicleController;
  private wheels: THREE.Object3D[] = [];
  private wheelRadius = 0.35;
  private steer = 0;
  private flippedT = 0;
  /** Chassis footprint half-extents (for the zombie steering obstacle). */
  readonly halfExtents = { hw: 1, hd: 2.2 };
  /** +1 if the model's nose points +z, -1 if -z (drives engine sign). */
  private forwardSign = 1;

  constructor(physics: PhysicsWorld, scene: THREE.Scene, position: THREE.Vector3, gltf: GLTF) {
    // ---- Visual from the kit model ----
    const model = gltf.scene.clone(true);
    const preBox = new THREE.Box3().setFromObject(model);
    const preSize = preBox.getSize(new THREE.Vector3());
    const scale = CAR.targetLength / preSize.z;
    model.scale.setScalar(scale);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    // Collect wheels and their (scaled) connection points before re-rooting.
    // Kenney kits name them "wheel-*", Synty "SM_Veh_*_Wheel_fl" etc.
    const wheelNodes: THREE.Object3D[] = [];
    model.traverse((o) => {
      if (/^wheel-|_Wheel_/i.test(o.name)) wheelNodes.push(o);
    });
    model.updateMatrixWorld(true);
    const connections: THREE.Vector3[] = [];
    for (const w of wheelNodes) {
      const p = new THREE.Vector3();
      w.getWorldPosition(p); // model at origin → this is the local offset
      connections.push(p);
      const wb = new THREE.Box3().setFromObject(w);
      this.wheelRadius = Math.max(0.2, (wb.max.y - wb.min.y) / 2);
    }
    // Center the chassis on the bbox center so the physics box matches.
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    // Re-parent wheels to the root so suspension can drive them directly.
    for (let i = 0; i < wheelNodes.length; i++) {
      const w = wheelNodes[i];
      w.removeFromParent();
      w.scale.setScalar(scale);
      this.root.add(w);
      connections[i].sub(center);
    }
    this.root.add(model);

    // ---- Physics ----
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.1)
        .setAngularDamping(1.2)
        // CCD: without it two vehicles interpenetrate deeply in one frame at
        // speed and the solver ejects both skyward.
        .setCcdEnabled(true),
    );
    this.halfExtents.hw = size.x / 2;
    this.halfExtents.hd = size.z / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2.6, size.z / 2)
        .setDensity(160)
        .setCollisionGroups(VEHICLE_GROUPS),
      this.body,
    );

    this.controller = physics.world.createVehicleController(this.body);
    // Wheels [FL, FR, RL, RR] using the model's OWN naming for front/rear —
    // steering goes on the model's front pair, and forwardSign makes W drive
    // hood-first regardless of which axis the model's nose points along.
    const order = connections
      .map((c, i) => ({ c, i, front: /front|_f[lr]$/i.test(wheelNodes[i].name) }))
      .sort((a, b) => Number(b.front) - Number(a.front) || a.c.x - b.c.x);
    const frontZ = order.filter((o) => o.front).reduce((acc, o) => acc + o.c.z, 0) / 2;
    this.forwardSign = frontZ >= 0 ? 1 : -1;
    // Suspension geometry (probed 2026-07-18): Rapier's spring force scales
    // with chassis mass, so settle compression ≈ (g/4) / stiffness. With
    // stiffness 12.5 the springs settle ~0.2 into their 0.4 travel — anchors
    // sit 0.2 above the modeled hubs so at rest the wheels are exactly where
    // the model put them, with equal droop and compression headroom (full
    // droop under throttle used to lift the fronts clean off the ground).
    const sortedWheels: THREE.Object3D[] = [];
    for (const { c, i } of order) {
      this.controller.addWheel(
        { x: c.x, y: c.y + CAR.suspSettle, z: c.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        CAR.suspRest,
        this.wheelRadius,
      );
      sortedWheels.push(wheelNodes[i]);
    }
    this.wheels = sortedWheels;
    for (let i = 0; i < this.wheels.length; i++) {
      this.controller.setWheelSuspensionStiffness(i, 12.5);
      this.controller.setWheelFrictionSlip(i, 12);
      // The default max suspension force (~6 kN) saturates under this heavy
      // chassis (~2.3 t → ~5.6 kN/wheel): springs ride bottomed-out and the
      // wheels tuck up into the fenders. Give them real headroom.
      this.controller.setWheelMaxSuspensionForce(i, 16000);
    }

    physics.syncObject(this.body, this.root);
    scene.add(this.root);
  }

  get speed(): number {
    // Rapier reports currentVehicleSpeed negative when moving along +z
    // (probed 2026-07-18) — negate so nose-first motion reads positive.
    return -this.controller.currentVehicleSpeed() * this.forwardSign;
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
      engine = (fwd * CAR.engineForce - back * CAR.reverseForce) * this.forwardSign;
      // Engine tapers to zero at top speed.
      const spd = Math.abs(this.speed);
      if (spd > CAR.maxSpeed) engine = 0;
      else engine *= 1 - (spd / CAR.maxSpeed) ** 3 * 0.7;
      const steerInput = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      const speedScale = 1 / (1 + Math.abs(this.speed) / CAR.steerSpeedFalloff);
      steerTarget = steerInput * CAR.maxSteer * speedScale * this.forwardSign;
      if (input.isDown('Space')) {
        this.controller.setWheelBrake(2, CAR.handbrakeForce);
        this.controller.setWheelBrake(3, CAR.handbrakeForce);
        this.controller.setWheelFrictionSlip(2, 3.5);
        this.controller.setWheelFrictionSlip(3, 3.5);
      } else {
        this.controller.setWheelBrake(2, 0.5);
        this.controller.setWheelBrake(3, 0.5);
        this.controller.setWheelFrictionSlip(2, 12);
        this.controller.setWheelFrictionSlip(3, 12);
      }
    } else {
      this.controller.setWheelBrake(2, CAR.brakeForce);
      this.controller.setWheelBrake(3, CAR.brakeForce);
    }

    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    this.controller.setWheelSteering(0, this.steer);
    this.controller.setWheelSteering(1, this.steer);
    this.controller.setWheelEngineForce(2, engine);
    this.controller.setWheelEngineForce(3, engine);
    this.controller.setWheelBrake(0, driven ? 0.5 : CAR.brakeForce);
    this.controller.setWheelBrake(1, driven ? 0.5 : CAR.brakeForce);

    this.controller.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);

    // ---- Safety nets: no sky-launches, no ending stuck on the roof ----
    // Hard horizontal speed clamp (downhill gravity ignores the engine taper).
    const hv = this.body.linvel();
    const hSpeed = Math.hypot(hv.x, hv.z);
    const hCap = CAR.maxSpeed * 1.15;
    if (hSpeed > hCap) {
      const k = hCap / hSpeed;
      this.body.setLinvel({ x: hv.x * k, y: hv.y, z: hv.z * k }, true);
    }
    const av = this.body.angvel();
    let avLen = Math.hypot(av.x, av.y, av.z);
    if (avLen > CAR.maxAngvel) {
      const s = CAR.maxAngvel / avLen;
      this.body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
      avLen = CAR.maxAngvel;
    }
    // Vehicles must never fly: nothing legit accelerates a car upward faster
    // than a small crest hop. (The launch pathways vary — solver kicks,
    // interpenetration pops — this clamp ends all of them.)
    const vNow = this.body.linvel();
    if (vNow.y > CAR.maxRiseSpeed) {
      this.body.setLinvel({ x: vNow.x, y: CAR.maxRiseSpeed, z: vNow.z }, true);
    }
    let contacts = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      if (this.controller.wheelIsInContact(i)) contacts++;
    }
    if (contacts === 0 && avLen > 0.01) {
      const s = Math.max(0, 1 - CAR.airDamping * dt);
      this.body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
    }
    // Auto-upright. A gentle torque rights side-tips; a fully-flipped heavy
    // chassis can't be torqued over its own roof edge (the contact solver
    // absorbs the spin), so if it stays flipped we snap it level after a
    // moment, keeping its yaw — the car must never end up undrivable.
    //
    // ONLY when the wheels are off the ground (contacts < 2): a car parked
    // across a ~23° hillside has chassis-up.y < 0.92 while sitting on all
    // four wheels, and torquing against pinned contacts pumps energy into
    // the solver until the car pops airborne (the "boarding launch" — caught
    // on video parked on a slope, 2026-07-18).
    const rot = this.body.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    const lv = this.body.linvel();
    const slow = Math.hypot(lv.x, lv.z) < CAR.uprightMaxSpeed;
    const wheelsFree = contacts < 2;
    if (_up.y < 0.92 && slow && wheelsFree) {
      // Torque assist all the way back to level (also settles part-tips).
      _axis.crossVectors(_up, _worldUp);
      const len = _axis.length();
      if (len > 0.01) {
        _axis.multiplyScalar((CAR.uprightTorque * dt) / len);
        const av2 = this.body.angvel();
        this.body.setAngvel(
          { x: av2.x * 0.9 + _axis.x, y: av2.y * 0.9, z: av2.z * 0.9 + _axis.z },
          true,
        );
      }
    }
    if (_up.y < CAR.uprightMaxUpY && slow) {
      this.flippedT += dt;
      if (this.flippedT >= CAR.uprightResetTime) {
        this.flippedT = 0;
        _fwd.set(0, 0, 1).applyQuaternion(_q);
        const yaw = Math.atan2(_fwd.x, _fwd.z);
        const t = this.body.translation();
        this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
        this.body.setTranslation({ x: t.x, y: t.y + 1.0, z: t.z }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else {
      this.flippedT = 0;
    }
  }

  updateVisuals(): void {
    for (let i = 0; i < this.wheels.length; i++) {
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      // Off the ground the suspension length reads 0/stale, which snapped the
      // wheels up through the fenders whenever the car bounced — hang free
      // wheels at full droop instead, and never let compression pull a wheel
      // more than a whisker above its modeled stance (susp = 0.15 at rest).
      const inContact = this.controller.wheelIsInContact(i);
      const raw = this.controller.wheelSuspensionLength(i);
      const susp = THREE.MathUtils.clamp(
        inContact && raw != null ? raw : CAR.suspRest,
        0.05,
        CAR.suspRest,
      );
      if (conn) this.wheels[i].position.set(conn.x, conn.y - susp, conn.z);
      const rot = this.controller.wheelRotation(i) ?? 0;
      const steer = this.controller.wheelSteering(i) ?? 0;
      this.wheels[i].rotation.set(0, steer, 0);
      this.wheels[i].rotateX(rot);
    }
  }

  linvel(): { x: number; z: number } {
    const v = this.body.linvel();
    return { x: v.x, z: v.z };
  }
}
