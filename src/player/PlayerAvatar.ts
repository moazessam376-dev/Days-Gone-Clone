import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER } from '../config';

/** Bones above the hips — used to mask aim poses onto the upper body only. */
const UPPER_BONE_RE = /(spine\.?00[23]|neck|head|shoulder|upper_arm|forearm|hand|f_index|f_middle|f_ring|f_pinky|thumb)/;
/** Everything else (hips, spine.001, legs, feet) keeps playing locomotion. */

export interface AvatarState {
  speed: number;
  aiming: boolean;
  rolling: boolean;
  /** Camera pitch in radians; positive = looking up. */
  pitch: number;
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
    // on the capsule), and flip 180°: the GLB's natural forward is -Z but the
    // controller's yaw convention treats +Z as forward.
    this.object.position.y = -PLAYER.height / 2;
    this.object.rotation.y = Math.PI;

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

    this.shootAction = this.mixer.clipAction(maskClip(clip('Pistol_Shoot'), true, 'upper'));
    this.shootAction.setLoop(THREE.LoopOnce, 1);
    this.reloadAction = this.mixer.clipAction(maskClip(clip('Pistol_Reload'), true, 'upper'));
    this.reloadAction.setLoop(THREE.LoopOnce, 1);
    this.reloadBaseDuration = clip('Pistol_Reload').duration;
  }

  private shootAction!: THREE.AnimationAction;
  private reloadAction!: THREE.AnimationAction;
  private reloadBaseDuration = 1;

  /** Right-hand bone — mount point for weapon models. */
  get handBone(): THREE.Object3D | null {
    let bone: THREE.Object3D | null = null;
    this.object.traverse((o) => {
      if (!bone && /hand\.?R$/i.test(o.name)) bone = o;
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

  update(dt: number, state: AvatarState): void {
    // Roll interrupts everything: fire the one-shot on the rising edge.
    if (state.rolling && !this.wasRolling) {
      this.rollAction.reset().fadeIn(0.05).play();
    } else if (!state.rolling && this.wasRolling) {
      this.rollAction.fadeOut(0.12);
    }
    this.wasRolling = state.rolling;

    this.aimBlend = THREE.MathUtils.clamp(
      this.aimBlend + (state.aiming ? dt : -dt) / 0.12,
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
    this.setTarget('aim_down', wDown * a * rollSuppress);
    this.setTarget('aim_neutral', wNeutral * a * rollSuppress);
    this.setTarget('aim_up', wUp * a * rollSuppress);

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
}
