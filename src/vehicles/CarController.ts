import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Layer, interactionGroups } from '../physics/layers';

export const CAR = {
  chassisHalf: { x: 1.0, y: 0.4, z: 2.2 },
  wheelRadius: 0.38,
  suspensionRest: 0.55,
  engineForce: 9000,
  reverseForce: 4500,
  brakeForce: 15,
  handbrakeForce: 120,
  maxSteer: 0.55,
  steerSpeedFalloff: 18, // m/s at which steering is halved
  runOverSpeed: 2.5,
};

/**
 * Rapier raycast-vehicle car with a procedural low-poly body. Rear-wheel
 * drive, speed-sensitive steering, Space handbrake (locks rears + cuts their
 * grip for slides). Wheels are visual cylinders driven by controller state.
 */
export class CarController {
  readonly body: RAPIER.RigidBody;
  readonly root = new THREE.Group();
  private controller: RAPIER.DynamicRayCastVehicleController;
  private wheels: THREE.Mesh[] = [];
  private steer = 0;

  constructor(physics: PhysicsWorld, private scene: THREE.Scene, position: THREE.Vector3) {
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.1)
        .setAngularDamping(1.2),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CAR.chassisHalf.x, CAR.chassisHalf.y, CAR.chassisHalf.z)
        .setDensity(120)
        .setCollisionGroups(interactionGroups(Layer.VEHICLE, 0xffff)),
      this.body,
    );

    this.controller = physics.world.createVehicleController(this.body);
    const y = -CAR.chassisHalf.y + 0.05;
    const positions: Array<[number, number]> = [
      [-0.85, -1.5], // FL
      [0.85, -1.5], // FR
      [-0.85, 1.45], // RL
      [0.85, 1.45], // RR
    ];
    for (const [x, z] of positions) {
      this.controller.addWheel(
        { x, y, z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        CAR.suspensionRest,
        CAR.wheelRadius,
      );
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, 28);
      this.controller.setWheelFrictionSlip(i, 12);
    }

    this.buildVisual();
    physics.syncObject(this.body, this.root);
    scene.add(this.root);
  }

  private buildVisual(): void {
    const paint = new THREE.MeshStandardMaterial({ color: 0x7a2f28, roughness: 0.45, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fa8c0, roughness: 0.2, metalness: 0.6 });

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.55, 4.4), paint);
    bodyMesh.position.y = -0.05;
    bodyMesh.castShadow = true;
    this.root.add(bodyMesh);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.0), glass);
    cabin.position.set(0, 0.4, 0.25);
    cabin.castShadow = true;
    this.root.add(cabin);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.25, 0.3), dark);
    bumper.position.set(0, -0.25, -2.2);
    this.root.add(bumper);

    const wheelGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.28, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.castShadow = true;
      this.root.add(w);
      this.wheels.push(w);
    }
  }

  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  fixedUpdate(dt: number, input: Input, driven: boolean): void {
    let engine = 0;
    let steerTarget = 0;
    const brake = 0.5; // rolling resistance

    if (driven) {
      const fwd = input.isDown('KeyW') ? 1 : 0;
      const back = input.isDown('KeyS') ? 1 : 0;
      engine = fwd * CAR.engineForce - back * CAR.reverseForce;
      const steerInput = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      const speedScale = 1 / (1 + Math.abs(this.speed) / CAR.steerSpeedFalloff);
      steerTarget = steerInput * CAR.maxSteer * speedScale;
      if (input.isDown('Space')) {
        // Handbrake: lock rears, cut rear grip for slides.
        this.controller.setWheelBrake(2, CAR.handbrakeForce);
        this.controller.setWheelBrake(3, CAR.handbrakeForce);
        this.controller.setWheelFrictionSlip(2, 3.5);
        this.controller.setWheelFrictionSlip(3, 3.5);
      } else {
        this.controller.setWheelBrake(2, brake);
        this.controller.setWheelBrake(3, brake);
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

    this.controller.updateVehicle(dt);
  }

  /** Position the visual wheels from controller state (render frame). */
  updateVisuals(): void {
    for (let i = 0; i < this.wheels.length; i++) {
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const susp = this.controller.wheelSuspensionLength(i) ?? CAR.suspensionRest * 0.6;
      if (conn) {
        this.wheels[i].position.set(conn.x, conn.y - susp, conn.z);
      }
      const rot = this.controller.wheelRotation(i) ?? 0;
      const steer = this.controller.wheelSteering(i) ?? 0;
      this.wheels[i].rotation.set(0, steer, 0);
      this.wheels[i].rotateX(rot);
    }
  }

  /** Velocity for run-over checks. */
  linvel(): { x: number; z: number } {
    const v = this.body.linvel();
    return { x: v.x, z: v.z };
  }

  destroy(): void {
    void this.scene;
  }
}
