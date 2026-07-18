import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER } from '../config';
import { Input } from '../core/Input';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PLAYER_BODY_GROUPS, KCC_OBSTACLE_GROUPS } from '../physics/layers';

const _moveDir = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * Kinematic third-person character controller.
 *
 * Movement model: camera-relative WASD produces a desired velocity; the actual
 * velocity accelerates toward it (accel while moving, decel when stopping) so
 * starts/stops have weight. Rapier's KinematicCharacterController resolves
 * sliding, stair steps, and slopes. Gravity is integrated manually.
 *
 * Facing: the visual model turns toward the velocity direction while running,
 * and locks to the camera direction while aiming (strafe mode) — the Days Gone
 * over-shoulder scheme.
 */
export class PlayerController {
  /** Position-synced root (from the physics body). */
  readonly root = new THREE.Group();
  /** Child of root; yaw applied here. Replaced by the character model in M2. */
  readonly model = new THREE.Group();

  readonly body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  private velocity = new THREE.Vector3(); // horizontal, m/s
  private vy = 0;
  grounded = false;
  aiming = false;
  sprinting = false;
  private sprintT = 0;

  private rollT = -1; // <0 = not rolling
  private rollCooldown = 0;
  private rollDir = new THREE.Vector3(0, 0, 1);
  invulnerable = false;

  // Face away from the camera (which spawns looking down -Z) at start.
  private targetYaw = Math.PI;
  private modelYaw = Math.PI;

  constructor(physics: PhysicsWorld, spawn: THREE.Vector3) {
    this.root.add(this.model);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    const halfHeight = PLAYER.height / 2 - PLAYER.radius;
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, PLAYER.radius).setCollisionGroups(
        PLAYER_BODY_GROUPS,
      ),
      this.body,
    );

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.4, 0.15, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((70 * Math.PI) / 180);
    // The capsule must never push dynamic bodies — corpses ignore the player
    // and vehicles are walls (see docs/collision-matrix.md).
    this.controller.setApplyImpulsesToDynamicBodies(false);

    physics.syncObject(this.body, this.root);
  }

  get isRolling(): boolean {
    return this.rollT >= 0;
  }

  /** 0..1 progress through the roll (0 when not rolling). */
  get rollProgress(): number {
    return this.rollT >= 0 ? this.rollT / PLAYER.roll.duration : 0;
  }

  /** Unit facing vector of the visual model. */
  get facing(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.model.rotation.y), 0, Math.cos(this.model.rotation.y));
  }

  /** Horizontal speed in m/s (for animation blending later). */
  get speed(): number {
    return this.velocity.length();
  }

  fixedUpdate(dt: number, input: Input, cameraYaw: number, combatFacing = false): void {
    this.aiming = input.locked && input.isMouseDown(2) && !this.isRolling;

    // Camera-relative input direction.
    const ix = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const iz = (input.isDown('KeyS') ? 1 : 0) - (input.isDown('KeyW') ? 1 : 0);
    _moveDir.set(ix, 0, iz);
    const hasInput = _moveDir.lengthSq() > 0;
    if (hasInput) _moveDir.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, cameraYaw);

    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    if (
      input.consumePressed('Space') &&
      !this.isRolling &&
      this.rollCooldown <= 0 &&
      this.grounded
    ) {
      this.rollT = 0;
      this.rollDir.copy(hasInput ? _moveDir : this.forwardFromYaw(this.modelYaw));
    }

    if (this.isRolling) {
      const cfg = PLAYER.roll;
      const t = this.rollT / cfg.duration;
      // Ease-out speed curve: fast launch, decelerating finish.
      const speed = cfg.speed * (1 - t * t * 0.75);
      this.velocity.copy(this.rollDir).multiplyScalar(speed);
      this.invulnerable = t >= cfg.iframeStart / cfg.duration && t <= cfg.iframeEnd / cfg.duration;
      this.rollT += dt;
      if (this.rollT >= cfg.duration) {
        this.rollT = -1;
        this.rollCooldown = cfg.cooldown;
        this.invulnerable = false;
      }
    } else {
      // Sprint winds up over sprintWindup seconds rather than snapping.
      this.sprinting = input.isDown('ShiftLeft') && hasInput && !this.aiming;
      this.sprintT = this.sprinting
        ? Math.min(1, this.sprintT + dt / PLAYER.sprintWindup)
        : Math.max(0, this.sprintT - dt / (PLAYER.sprintWindup * 0.5));

      let speed = THREE.MathUtils.lerp(PLAYER.jogSpeed, PLAYER.sprintSpeed, this.sprintT);
      if (this.aiming) speed = PLAYER.jogSpeed * PLAYER.aimMoveScale;

      _targetVel.copy(_moveDir).multiplyScalar(hasInput ? speed : 0);
      const rate = (hasInput ? PLAYER.accel : PLAYER.decel) * dt;
      _delta.subVectors(_targetVel, this.velocity);
      const dLen = _delta.length();
      if (dLen <= rate) this.velocity.copy(_targetVel);
      else this.velocity.addScaledVector(_delta.normalize(), rate);
    }

    // Gravity (small downward bias while grounded keeps snap-to-ground engaged).
    this.vy = this.grounded && this.vy < 0 ? -2 : Math.max(this.vy + PLAYER.gravity * dt, -PLAYER.maxFallSpeed);

    _delta.set(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt);
    this.controller.computeColliderMovement(
      this.collider,
      _delta,
      undefined,
      KCC_OBSTACLE_GROUPS,
    );
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const pos = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });

    // Adopt the resolved horizontal velocity so wall contact bleeds speed
    // instead of accumulating it (prevents "rocket off the wall edge").
    if (!this.isRolling && dt > 0) {
      this.velocity.set(corrected.x / dt, 0, corrected.z / dt);
    }

    // Facing target: camera direction while aiming OR shooting (hip fire must
    // address the target even mid-run), velocity direction otherwise. Model
    // yaw convention: facing = (sin yaw, 0, cos yaw); the camera looks along
    // (-sin camYaw, 0, -cos camYaw), hence the π offset.
    if ((this.aiming || combatFacing) && !this.isRolling) {
      this.targetYaw = cameraYaw + Math.PI;
    } else if (this.velocity.lengthSq() > 0.05) {
      this.targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
    }
  }

  /** Per-render-frame: smooth the visual model's yaw toward the target. */
  renderUpdate(dt: number): void {
    let diff = this.targetYaw - this.modelYaw;
    diff = THREE.MathUtils.euclideanModulo(diff + Math.PI, Math.PI * 2) - Math.PI;
    this.modelYaw += diff * (1 - Math.exp(-PLAYER.turnSpeed * dt));
    this.model.rotation.y = this.modelYaw;
  }

  private forwardFromYaw(yaw: number): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  }
}
