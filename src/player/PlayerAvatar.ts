import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER } from '../config';

/** Upper-body bones of the Soldier rig (CharacterArmature). */
const UPPER_BONE_RE = /(Abdomen|Torso|Neck|Head|Shoulder|UpperArm|LowerArm|Pinky|Middle|Index|Thumb)/;

/** In-hand weapon mesh names shipped with the Soldier model. */
const WEAPON_NODES: Record<string, string> = {
  pistol: 'Pistol',
  rifle: 'AK',
  shotgun: 'Shotgun',
};
const ALL_WEAPON_NODES = [
  'Revolver', 'Sniper', 'Revolver_Small', 'Pistol', 'SMG', 'GrenadeLauncher',
  'ShortCannon', 'Shotgun', 'Sniper_2', 'RocketLauncher', 'AK', 'Shovel',
  'Knife_2', 'Knife_1',
];

export interface AvatarState {
  speed: number;
  aiming: boolean;
  rolling: boolean;
  /** 0..1 progress through the roll (drives the tucked-spin). */
  rollT: number;
  /** Camera pitch in radians; positive = looking up. */
  pitch: number;
}

interface WeightedAction {
  action: THREE.AnimationAction;
  weight: number;
  target: number;
}

/**
 * Player visuals: Quaternius Character Soldier. The model ships with real
 * weapon meshes parented into the right hand — the active one is toggled
 * visible, so the grip is always correct by construction.
 *
 * Animation graph (weight-blended):
 * - Locomotion: Idle ↔ Run (Run timeScale follows speed; sprint overdrives).
 * - Aiming: Run_Gun full-body while moving; upper-masked Idle_Shoot pose
 *   held while standing. Aim pitch additionally tilts the Torso bone
 *   procedurally so shots read up/down hill.
 * - Shoot: fast upper-body Idle_Shoot one-shot. Reload: same clip slowed.
 * - Melee: upper-body Punch. Roll: Duck pose + procedural forward spin.
 */
export class PlayerAvatar {
  readonly object: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, WeightedAction>();
  private shootAction!: THREE.AnimationAction;
  private meleeAction!: THREE.AnimationAction;
  private reloadAction!: THREE.AnimationAction;
  private reloadBaseDuration = 1;
  private aimBlend = 0;
  private torsoBone: THREE.Object3D | null = null;
  private weaponMeshes = new Map<string, THREE.Object3D>();
  private activeWeapon = '';
  private spinGroup = new THREE.Group();
  private gunKick = 0;

  constructor(gltf: GLTF) {
    this.object = new THREE.Group() as THREE.Group;
    const model = gltf.scene;

    // Normalize height to the capsule and face +Z (controller convention:
    // facing = (sin yaw, 0, cos yaw), model natural forward is -Z → flip).
    const bbox = new THREE.Box3().setFromObject(model);
    const height = bbox.max.y - bbox.min.y;
    const scale = 1.78 / height;
    model.scale.setScalar(scale);
    model.position.y = 0;

    // spinGroup owns the roll spin so it composes with the yaw on `model`.
    // The soldier faces +Z natively, matching the controller's yaw convention.
    this.spinGroup.add(model);
    this.spinGroup.position.y = -PLAYER.height / 2;
    this.object.add(this.spinGroup);

    model.traverse((o) => {
      if (o.name === 'Torso') this.torsoBone = o;
      if (ALL_WEAPON_NODES.includes(o.name)) {
        this.weaponMeshes.set(o.name, o);
        o.visible = false;
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name: string): THREE.AnimationClip => {
      const c = THREE.AnimationClip.findByName(gltf.animations, `CharacterArmature|${name}`);
      if (!c) throw new Error(`Missing soldier clip ${name}`);
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

    addWeighted('idle', clip('Idle'));
    addWeighted('run', clip('Run'));
    addWeighted('run_gun', clip('Run_Gun'));
    addWeighted('aim_pose', maskClip(clip('Idle_Shoot'), true, 'upper'));
    addWeighted('duck', clip('Duck'));

    this.shootAction = this.mixer.clipAction(maskClip(clip('Idle_Shoot'), true, 'shoot'));
    this.shootAction.setLoop(THREE.LoopOnce, 1);
    this.meleeAction = this.mixer.clipAction(maskClip(clip('Punch'), true, 'melee'));
    this.meleeAction.setLoop(THREE.LoopOnce, 1);
    this.reloadAction = this.mixer.clipAction(maskClip(clip('Idle_Shoot'), true, 'reload'));
    this.reloadAction.setLoop(THREE.LoopOnce, 1);
    this.reloadBaseDuration = clip('Idle_Shoot').duration;
  }

  /** Show the active weapon's in-hand mesh (real grip for free). */
  setWeapon(key: string): void {
    if (this.activeWeapon === key) return;
    this.activeWeapon = key;
    const wanted = WEAPON_NODES[key];
    for (const [name, mesh] of this.weaponMeshes) mesh.visible = name === wanted;
  }

  /** World-space muzzle: far edge of the active gun mesh along `facing`. */
  muzzleWorld(out: THREE.Vector3, facing: THREE.Vector3): THREE.Vector3 {
    const node = this.weaponMeshes.get(WEAPON_NODES[this.activeWeapon] ?? '');
    if (!node) return out.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(node);
    box.getCenter(out);
    const half = new THREE.Vector3();
    box.getSize(half).multiplyScalar(0.5);
    out.addScaledVector(facing, Math.abs(half.x * facing.x) + Math.abs(half.z * facing.z) + 0.05);
    return out;
  }

  kick(): void {
    this.gunKick = 1;
  }

  playShoot(): void {
    this.shootAction.reset().setEffectiveWeight(1).play();
    this.shootAction.timeScale = 3.2;
  }

  playReload(duration: number): void {
    this.reloadAction.timeScale = (this.reloadBaseDuration / duration) * 0.9;
    this.reloadAction.reset().setEffectiveWeight(1).fadeIn(0.08).play();
  }

  playMelee(): void {
    this.meleeAction.reset().setEffectiveWeight(1).play();
    this.meleeAction.timeScale = 1.7;
  }

  update(dt: number, state: AvatarState): void {
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (state.aiming ? dt : -dt) / 0.12, 0, 1);
    const a = this.aimBlend;
    const moving = state.speed > 0.4;
    const moveBlend = THREE.MathUtils.clamp(state.speed / PLAYER.jogSpeed, 0, 1);

    // Roll: Duck pose + one full forward spin.
    if (state.rolling) {
      this.setTarget('duck', 1);
      this.setTarget('idle', 0);
      this.setTarget('run', 0);
      this.setTarget('run_gun', 0);
      this.setTarget('aim_pose', 0);
      this.spinGroup.rotation.x = -Math.PI * 2 * THREE.MathUtils.smoothstep(state.rollT, 0.05, 0.95);
    } else {
      this.spinGroup.rotation.x = 0;
      this.setTarget('duck', 0);
      this.setTarget('idle', (1 - moveBlend) * (1 - a));
      this.setTarget('run', moveBlend * (1 - a));
      this.setTarget('run_gun', moveBlend * a);
      this.setTarget('aim_pose', (moving ? 0.55 : 1) * a);
      // Run cycle speed follows actual velocity.
      const run = this.actions.get('run')!.action;
      const runGun = this.actions.get('run_gun')!.action;
      run.timeScale = runGun.timeScale = THREE.MathUtils.clamp(state.speed / 4.2, 0.5, 1.6);
    }

    // Aim pitch: tilt the torso so aiming up/down reads on the body.
    if (this.torsoBone) {
      const tilt = a * -state.pitch * 0.55;
      this.torsoBone.rotation.x += tilt; // applied after mixer sampling below
    }

    const k = 1 - Math.exp(-14 * dt);
    for (const wa of this.actions.values()) {
      wa.weight += (wa.target - wa.weight) * k;
      wa.action.setEffectiveWeight(wa.weight);
    }
    this.mixer.update(dt);

    // Post-mixer additive torso pitch (mixer overwrote the rotation).
    if (this.torsoBone && a > 0.01 && !state.rolling) {
      this.torsoBone.rotation.x += a * -state.pitch * 0.55;
    }

    // Gun kick: tiny rotation punch on the visible weapon.
    this.gunKick *= Math.exp(-16 * dt);
    const gun = this.weaponMeshes.get(WEAPON_NODES[this.activeWeapon] ?? '');
    if (gun) gun.rotation.x = this.gunKick * -0.3;
  }

  private setTarget(key: string, target: number): void {
    const wa = this.actions.get(key);
    if (wa) wa.target = target;
  }
}
