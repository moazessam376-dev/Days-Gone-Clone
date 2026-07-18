import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER, HANDLING } from '../config';

/** Bones above the hips — used to mask aim poses onto the upper body only.
 * Covers both rig conventions: Quaternius/Rigify (spine002, upper_arm,
 * f_index…) and Synty (Spine_02, Clavicle, Elbow, IndexFinger…). */
const UPPER_BONE_RE =
  /(spine[._]?0{1,2}[23]|neck|head|clavicle|shoulder|upper_arm|forearm|elbow|hand|f_index|f_middle|f_ring|f_pinky|thumb|finger_0)/i;
/** Everything else (hips, spine 01, legs, feet) keeps playing locomotion. */

/** OverhandThrow (1.33s) landmarks, found by frame-stepping the retargeted
 * clip: arm fully cocked overhead at 0.35s, bottle leaves the hand ~0.6s. */
const THROW_COCK_T = 0.35;
const THROW_RELEASE_T = 0.6;

export interface AvatarState {
  speed: number;
  aiming: boolean;
  rolling: boolean;
  /** Weapon in hands (on foot): a light aim-pose blend stops the free arm
   * swinging through the gun while carrying. Sprint pumps the arms again. */
  carrying?: boolean;
  /** 0..1 roll progress (unused by this rig — the Roll clip is time-scaled). */
  rollT?: number;
  /** Camera pitch in radians; positive = looking up. */
  pitch: number;
  /** What `aiming` means: gun ADS uses the pistol aim poses; a throwable
   * wind-up keeps the idle upper body and cocks the arm procedurally. */
  aimMode?: 'gun' | 'throw';
}

interface WeightedAction {
  action: THREE.AnimationAction;
  weight: number; // current
  target: number;
}

/**
 * The player's visual body: Quaternius animated base character driven by a
 * weight-blended animation graph (everything always "playing", weights lerp):
 *
 * - Locomotion: Idle/Walk/Jog/Sprint blended piecewise by speed.
 * - Aiming: locomotion is swapped to lower-body-masked variants while the
 *   upper body blends the three Pistol_Aim_{Down,Neutral,Up} poses by camera
 *   pitch — the standard AAA aim-offset setup.
 * - Roll: full-body one-shot, time-scaled to the controller's roll duration.
 */
export class PlayerAvatar {
  readonly object: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, WeightedAction>();
  private rollAction: THREE.AnimationAction;
  private aimBlend = 0;
  private wasRolling = false;

  constructor(gltf: GLTF) {
    this.object = gltf.scene;
    // Drop the model so feet sit at the capsule bottom (root group is centered
    // on the capsule). The Synty rig's natural forward is +Z, matching the
    // controller's yaw convention — no flip needed (the old Quaternius rig
    // faced -Z and needed rotation.y = π here).
    this.object.position.y = -PLAYER.height / 2;

    this.mixer = new THREE.AnimationMixer(this.object);

    const clip = (name: string): THREE.AnimationClip => {
      const c = THREE.AnimationClip.findByName(gltf.animations, `Rig|${name}`);
      if (!c) throw new Error(`Missing animation clip: ${name}`);
      return c;
    };

    const maskClip = (c: THREE.AnimationClip, upper: boolean, suffix: string): THREE.AnimationClip => {
      const tracks = c.tracks.filter((t) => UPPER_BONE_RE.test(t.name) === upper);
      return new THREE.AnimationClip(`${c.name}_${suffix}`, c.duration, tracks);
    };

    const addWeighted = (key: string, c: THREE.AnimationClip): void => {
      const action = this.mixer.clipAction(c);
      action.play();
      action.setEffectiveWeight(0);
      this.actions.set(key, { action, weight: 0, target: 0 });
    };

    // Full-body locomotion (used when not aiming).
    addWeighted('idle', clip('Idle_Loop'));
    addWeighted('walk', clip('Walk_Loop'));
    addWeighted('jog', clip('Jog_Fwd_Loop'));
    addWeighted('sprint', clip('Sprint_Loop'));
    // Lower-body locomotion variants (legs keep moving while aiming).
    addWeighted('idle_lower', maskClip(clip('Idle_Loop'), false, 'lower'));
    addWeighted('walk_lower', maskClip(clip('Walk_Loop'), false, 'lower'));
    // Upper-body aim poses, blended by camera pitch.
    addWeighted('aim_down', maskClip(clip('Pistol_Aim_Down'), true, 'upper'));
    addWeighted('aim_neutral', maskClip(clip('Pistol_Aim_Neutral'), true, 'upper'));
    addWeighted('aim_up', maskClip(clip('Pistol_Aim_Up'), true, 'upper'));

    const rollClip = clip('Roll');
    this.rollAction = this.mixer.clipAction(rollClip);
    this.rollAction.setLoop(THREE.LoopOnce, 1);
    this.rollAction.clampWhenFinished = false;
    this.rollAction.timeScale = rollClip.duration / PLAYER.roll.duration;

    // Upper-body idle for the throw wind-up: keeps the torso animated while
    // the pistol-aim poses are (deliberately) not used.
    addWeighted('idle_upper', maskClip(clip('Idle_Loop'), true, 'upper'));

    this.shootAction = this.mixer.clipAction(maskClip(clip('Pistol_Shoot'), true, 'upper'));
    this.shootAction.setLoop(THREE.LoopOnce, 1);
    this.meleeAction = this.mixer.clipAction(maskClip(clip('Punch_Cross'), true, 'upper'));
    this.meleeAction.setLoop(THREE.LoopOnce, 1);
    this.reloadAction = this.mixer.clipAction(maskClip(clip('Pistol_Reload'), true, 'upper'));
    this.reloadAction.setLoop(THREE.LoopOnce, 1);
    this.reloadBaseDuration = clip('Pistol_Reload').duration;

    // Real throw animation (UAL2 OverhandThrow retargeted in the export).
    // Aiming HOLDS the clip at its cocked frame; the release plays through.
    // Optional so an older cached player.glb without the clip still boots —
    // applyThrowPose falls back to the procedural arm.
    try {
      const throwClip = maskClip(clip('OverhandThrow'), true, 'upper');
      this.throwAction = this.mixer.clipAction(throwClip);
      this.throwAction.setLoop(THREE.LoopOnce, 1);
      this.throwAction.clampWhenFinished = true;
    } catch {
      this.throwAction = null;
    }

    // Arm bones for the procedural layers (two-hand grips, throw wind-up).
    this.object.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.boneByName.set(o.name, o);
    });
  }

  private boneByName = new Map<string, THREE.Object3D>();

  private shootAction!: THREE.AnimationAction;
  private reloadAction!: THREE.AnimationAction;
  private meleeAction!: THREE.AnimationAction;
  private reloadBaseDuration = 1;
  private throwAction: THREE.AnimationAction | null = null;
  private throwReleasing = 0;

  /** Right-hand bone — mount point for weapon models. */
  get handBone(): THREE.Object3D | null {
    let bone: THREE.Object3D | null = null;
    this.object.traverse((o) => {
      if (!bone && /hand[._]?R$/i.test(o.name)) bone = o;
    });
    return bone;
  }

  playShoot(): void {
    this.shootAction.reset().setEffectiveWeight(1).fadeIn(0.02).play();
    this.shootAction.timeScale = 2.2;
  }

  playReload(duration: number): void {
    this.reloadAction.timeScale = this.reloadBaseDuration / duration;
    this.reloadAction.reset().setEffectiveWeight(1).fadeIn(0.08).play();
  }

  playMelee(): void {
    if (!this.meleeAction) return;
    this.meleeAction.reset().setEffectiveWeight(1).fadeIn(0.03).play();
    this.meleeAction.timeScale = 1.6;
  }

  update(dt: number, state: AvatarState): void {
    // Roll interrupts everything: fire the one-shot on the rising edge.
    if (state.rolling && !this.wasRolling) {
      this.rollAction.reset().fadeIn(0.05).play();
    } else if (!state.rolling && this.wasRolling) {
      this.rollAction.fadeOut(0.12);
    }
    this.wasRolling = state.rolling;

    // Pose raise/drop matches the camera's weighty-responsive blend times.
    this.aimBlend = THREE.MathUtils.clamp(
      this.aimBlend + (state.aiming ? dt / HANDLING.aimInTime : -dt / HANDLING.aimOutTime),
      0,
      1,
    );

    // Piecewise locomotion weights by speed.
    const s = state.speed;
    let wIdle = 0;
    let wWalk = 0;
    let wJog = 0;
    let wSprint = 0;
    if (s < PLAYER.walkSpeed) {
      wWalk = THREE.MathUtils.smoothstep(s, 0.1, PLAYER.walkSpeed);
      wIdle = 1 - wWalk;
    } else if (s < PLAYER.jogSpeed) {
      wJog = THREE.MathUtils.smoothstep(s, PLAYER.walkSpeed, PLAYER.jogSpeed);
      wWalk = 1 - wJog;
    } else {
      wSprint = THREE.MathUtils.smoothstep(s, PLAYER.jogSpeed, PLAYER.sprintSpeed);
      wJog = 1 - wSprint;
    }

    const a = this.aimBlend;
    const rollSuppress = state.rolling ? 0 : 1;
    this.sprintWeight = wSprint;
    this.rollingNow = state.rolling;
    // Throw wind-up: legs behave like aiming, but the upper body stays on
    // idle (the arm is cocked procedurally) — pistol poses on a molotov
    // read as "aiming a gun", which the playtest called out.
    const throwing = state.aimMode === 'throw' ? 1 : 0;
    const gunAim = a * (1 - throwing);

    // Aim pitch → three-pose blend. Poses cover roughly ±60° of pitch.
    const p = THREE.MathUtils.clamp(state.pitch / 1.05, -1, 1);
    const wUp = Math.max(0, p);
    const wDown = Math.max(0, -p);
    const wNeutral = 1 - wUp - wDown;

    this.setTarget('idle', wIdle * (1 - a) * rollSuppress);
    this.setTarget('walk', wWalk * (1 - a) * rollSuppress);
    this.setTarget('jog', wJog * (1 - a) * rollSuppress);
    this.setTarget('sprint', wSprint * (1 - a) * rollSuppress);
    this.setTarget('idle_lower', (wIdle + wJog + wSprint) * a * rollSuppress);
    this.setTarget('walk_lower', wWalk * a * rollSuppress);
    // With the real OverhandThrow clip the wind-up owns the whole upper
    // body — idle_upper at equal weight would average it down to a half-
    // raised arm. Keep idle_upper only for the procedural fallback.
    this.setTarget('idle_upper', this.throwAction ? 0 : a * throwing * rollSuppress);
    // Carry: partial neutral aim pose on the upper body (PropertyMixer
    // normalizes by cumulative weight, so legs stay full locomotion).
    const carry =
      (state.carrying ? HANDLING.carryBlend : 0) * (1 - a) * rollSuppress * (1 - wSprint);
    this.setTarget('aim_down', wDown * gunAim * rollSuppress);
    this.setTarget('aim_neutral', wNeutral * gunAim * rollSuppress + carry);
    this.setTarget('aim_up', wUp * gunAim * rollSuppress);

    // Fast exponential approach keeps blends snappy but pop-free.
    const k = 1 - Math.exp(-15 * dt);
    for (const wa of this.actions.values()) {
      wa.weight += (wa.target - wa.weight) * k;
      wa.action.setEffectiveWeight(wa.weight);
    }

    this.mixer.update(dt);
  }

  private setTarget(key: string, target: number): void {
    const wa = this.actions.get(key);
    if (wa) wa.target = target;
  }

  // ---- Procedural arm layer (runs AFTER update()/mixer, before render) ----
  //
  // Two-bone swing IK, world-space: no assumptions about the rig's rest pose
  // or bone axes (the reconstructed Synty skeleton has non-trivial bind
  // transforms — same reason the zombie retarget uses swing matching).

  /** Smoothed weights so grips engage/release without popping. */
  private ikWeightL = 0;
  private ikWeightR = 0;
  private ikWeightRGrip = 0;

  /** Chest bone — the two-hand carry anchors the gun here. */
  get chestBone(): THREE.Object3D | null {
    return this.boneByName.get('Spine_03') ?? null;
  }

  /** Index-finger base — bone origins sit at JOINTS, so Hand_R alone is the
   * wrist; lerping toward this bone lands weapons in the palm. */
  get fingerBone(): THREE.Object3D | null {
    return this.boneByName.get('IndexFinger_01_R') ?? null;
  }

  /**
   * Plant the RIGHT hand on the pistol grip of a chest-anchored long gun.
   * Mutually exclusive with the throw pose (Game gates them).
   */
  applyRightHandIK(target: THREE.Vector3 | null, weight: number, dt: number): void {
    this.ikWeightRGrip += ((target ? weight : 0) - this.ikWeightRGrip) * Math.min(1, dt * 14);
    if (this.ikWeightRGrip < 0.02 || !target) return;
    this.solveArm('R', target, this.ikWeightRGrip);
  }
  /** Last frame's sprint blend / roll flag — Game gates the grip IK on them
   * (sprint pumps the arms one-handed; a roll tumbles the whole body). */
  sprintWeight = 0;
  rollingNow = false;

  /**
   * Plant the LEFT hand on `target` (world) — the long-gun foregrip.
   * @param weight desired 0..1; smoothed internally.
   */
  applyLeftHandIK(target: THREE.Vector3 | null, weight: number, dt: number): void {
    this.ikWeightL += ((target ? weight : 0) - this.ikWeightL) * Math.min(1, dt * 14);
    if (this.ikWeightL < 0.02 || !target) return;
    this.solveArm('L', target, this.ikWeightL);
  }

  /**
   * Throw wind-up. With the retargeted UAL2 OverhandThrow clip the aim-hold
   * FREEZES the clip at its cocked frame (weight-blended in/out); the bottle
   * follows the hand bone via WeaponRig's hand-follow. Fallback when the
   * clip is missing: the old procedural cocked-arm IK.
   */
  applyThrowPose(weight: number, dt: number): void {
    this.ikWeightR += (weight - this.ikWeightR) * Math.min(1, dt * 12);
    if (this.throwAction) {
      if (this.throwReleasing > 0) {
        // Release in flight — it owns the action until the clip finishes.
        this.throwReleasing -= dt;
        if (this.throwReleasing <= 0) this.throwAction.stop();
        return;
      }
      if (this.ikWeightR < 0.02) {
        this.throwAction.setEffectiveWeight(0);
        return;
      }
      const a = this.throwAction;
      if (!a.isRunning()) a.play();
      a.paused = true;
      a.time = THROW_COCK_T;
      a.setEffectiveWeight(this.ikWeightR);
      return;
    }
    if (this.ikWeightR < 0.02) return;
    const head = this.boneByName.get('Head');
    if (!head) return;
    head.getWorldPosition(_ikTarget);
    this.object.getWorldQuaternion(_charQ);
    // Beside-and-BEHIND the ear, raised — a real wind-up. Model space:
    // +x = character right, +z = behind (the rig faces -z).
    _ikOffset.set(0.34, 0.28, 0.16).applyQuaternion(_charQ);
    _ikTarget.add(_ikOffset);
    this.solveArm('R', _ikTarget, this.ikWeightR);
  }

  /**
   * Play the throw release: from the cocked frame through the follow-through.
   * @param windup seconds until the projectile leaves the hand — the clip's
   *   cock→release span is time-scaled to land exactly on it.
   */
  playThrowRelease(windup: number): void {
    if (!this.throwAction) {
      this.playMelee(); // legacy fallback: overhand punch as the swing
      return;
    }
    const a = this.throwAction;
    a.reset();
    a.time = THROW_COCK_T;
    a.paused = false;
    a.timeScale = (THROW_RELEASE_T - THROW_COCK_T) / Math.max(windup, 0.05);
    a.setEffectiveWeight(1);
    a.play();
    this.throwReleasing = (a.getClip().duration - THROW_COCK_T) / a.timeScale;
  }

  private solveArm(side: 'L' | 'R', target: THREE.Vector3, weight: number): void {
    const shoulder = this.boneByName.get(`Shoulder_${side}`);
    const elbow = this.boneByName.get(`Elbow_${side}`);
    const hand = this.boneByName.get(`Hand_${side}`);
    if (!shoulder || !elbow || !hand || !shoulder.parent) return;

    shoulder.updateWorldMatrix(true, false);
    elbow.updateWorldMatrix(false, false);
    hand.updateWorldMatrix(false, false);
    const S = _ikS.setFromMatrixPosition(shoulder.matrixWorld);
    const E = _ikE.setFromMatrixPosition(elbow.matrixWorld);
    const W = _ikW.setFromMatrixPosition(hand.matrixWorld);
    const l1 = S.distanceTo(E);
    const l2 = E.distanceTo(W);
    if (l1 < 1e-4 || l2 < 1e-4) return;

    const d = Math.min(Math.max(_ikDir.subVectors(target, S).length(), 0.02), (l1 + l2) * 0.999);
    _ikDir.normalize();

    // Elbow plane: pole points down-and-outward so the elbow never flips up.
    this.object.getWorldQuaternion(_charQ);
    _ikPole
      .set(side === 'L' ? -0.6 : 0.6, -1, -0.15)
      .applyQuaternion(_charQ)
      .normalize();
    _ikN.crossVectors(_ikDir, _ikPole);
    if (_ikN.lengthSq() < 1e-6) _ikN.set(0, 0, 1).cross(_ikDir);
    _ikN.normalize();
    _ikBend.crossVectors(_ikN, _ikDir).normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _ikElbowTgt.copy(S).addScaledVector(_ikDir, l1 * cosA).addScaledVector(_ikBend, l1 * sinA);

    // Swing the upper arm: current S→E direction onto S→elbowTarget.
    this.swingBoneWorld(shoulder, _ikA.subVectors(E, S), _ikB.subVectors(_ikElbowTgt, S), weight);

    // Recompute and swing the forearm onto the target.
    elbow.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(false, false);
    const E2 = _ikE.setFromMatrixPosition(elbow.matrixWorld);
    const W2 = _ikW.setFromMatrixPosition(hand.matrixWorld);
    this.swingBoneWorld(elbow, _ikA.subVectors(W2, E2), _ikB.subVectors(target, E2), weight);
  }

  /** Rotate `bone` so world direction `from` maps toward `to`, slerped. */
  private swingBoneWorld(
    bone: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3,
    weight: number,
  ): void {
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8 || !bone.parent) return;
    _ikSwing.setFromUnitVectors(_ikA2.copy(from).normalize(), _ikB2.copy(to).normalize());
    if (weight < 1) _ikSwing.slerp(_ikIdentity, 1 - weight);
    bone.getWorldQuaternion(_ikBoneQ);
    bone.parent.getWorldQuaternion(_ikParentQ);
    _ikBoneQ.premultiply(_ikSwing); // new world orientation
    bone.quaternion.copy(_ikParentQ.invert().multiply(_ikBoneQ));
    bone.updateMatrixWorld(true);
  }
}

const _ikS = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikW = new THREE.Vector3();
const _ikDir = new THREE.Vector3();
const _ikPole = new THREE.Vector3();
const _ikN = new THREE.Vector3();
const _ikBend = new THREE.Vector3();
const _ikElbowTgt = new THREE.Vector3();
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikA2 = new THREE.Vector3();
const _ikB2 = new THREE.Vector3();
const _ikTarget = new THREE.Vector3();
const _ikOffset = new THREE.Vector3();
const _charQ = new THREE.Quaternion();
const _ikSwing = new THREE.Quaternion();
const _ikIdentity = new THREE.Quaternion();
const _ikBoneQ = new THREE.Quaternion();
const _ikParentQ = new THREE.Quaternion();
