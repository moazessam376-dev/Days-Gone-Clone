/**
 * Data-driven weapon definitions. All feel/balance numbers for guns live HERE,
 * not in code. Recoil patterns are deterministic sequences (pitch, yaw) in
 * radians consumed per shot and wrapped.
 */

/** Grip offset in the gun's oriented frame + local euler tweak (rad). */
export interface GripPose {
  pos: [number, number, number];
  rot: [number, number, number];
}

/**
 * Per-stance grip poses, rig-portable: when R2 swaps the character, only
 * these offsets (and the hand-bone name) need retuning — no rig code.
 * `foregrip` is reserved for the R2 two-hand pose (unused by the mannequin,
 * whose armature's 100x bone scale makes bone overrides unsafe).
 */
export interface WeaponPoses {
  carry: GripPose;
  ads: GripPose;
  foregrip?: [number, number, number];
}

export interface WeaponDef {
  name: string;
  auto: boolean;
  rpm: number;
  damage: number; // per bullet/pellet
  headshotMult: number;
  pellets: number;
  range: number;
  /** Base spread half-angle (radians): [hip, ads]. */
  spread: [number, number];
  /** Extra spread at full bloom (radians). */
  bloomSpread: number;
  /** Bloom added per shot (0..1 scale) and decay per second. */
  bloomPerShot: number;
  bloomDecay: number;
  recoilPattern: Array<[number, number]>; // [pitch up, yaw] per shot
  magSize: number;
  reserveAmmo: number;
  reloadTime: number;
  /** Procedural audio profile. */
  sound: { sub: number; crack: number; body: number; pitch: number };
  /** In-hand model: AssetLoader key (Synty GLB, barrel toward -Z) + scale. */
  model: { asset: string; scale: number };
  /** Plays the full Pistol_Shoot anim per shot (semi-autos only). */
  shootAnim: boolean;
  pose: WeaponPoses;
}

/** Offsets are in the GUN's oriented frame (x right, y up, z toward the
 * stock — see WeaponRig): they slide the gun so its grip meets the palm.
 * The gun's world ORIENTATION is composed by WeaponRig (character yaw +
 * HANDLING.carryPitch in carry, exact camera aim in ADS) — rot here is only
 * a local tweak on top. Exports are bbox-centered, so a gun whose grip sits
 * toward the stock needs a small -z (forward) push. */
const DEFAULT_POSE: WeaponPoses = {
  carry: { pos: [0, 0.04, -0.12], rot: [0, 0, 0] },
  ads: { pos: [0, 0.04, -0.12], rot: [0, 0, 0] },
};
// `foregrip` (gun frame, barrel -z): where the LEFT hand plants — drives the
// two-hand IK in PlayerAvatar. Long guns only; pistols stay one-handed.
const RIFLE_POSE: WeaponPoses = {
  carry: { pos: [0, 0.04, -0.2], rot: [0, 0, 0] },
  ads: { pos: [0, 0.04, -0.2], rot: [0, 0, 0] },
  foregrip: [0, -0.02, -0.3],
};
const SHOTGUN_POSE: WeaponPoses = {
  carry: { pos: [0, 0.04, -0.16], rot: [0, 0, 0] },
  ads: { pos: [0, 0.04, -0.16], rot: [0, 0, 0] },
  foregrip: [0, -0.03, -0.26],
};
const SAWNOFF_POSE: WeaponPoses = {
  carry: { pos: [0, 0.03, -0.12], rot: [0, 0, 0] },
  ads: { pos: [0, 0.03, -0.12], rot: [0, 0, 0] },
  foregrip: [0, -0.03, -0.2],
};

/** In-hand grip poses for throwable props. Both exports have their origin at
 * the model BASE (bbox min y = 0): the -y offset drops them so the palm wraps
 * mid-body instead of holding them by the very bottom. */
export const THROWABLE_POSES: Record<string, GripPose> = {
  grenade: { pos: [0, -0.08, 0], rot: [0, 0, 0] },
  molotov: { pos: [0, -0.15, 0], rot: [0.25, 0, 0.2] },
};

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    name: 'Pistol',
    auto: false,
    rpm: 320,
    damage: 26,
    headshotMult: 2.5,
    pellets: 1,
    range: 120,
    spread: [0.018, 0.004],
    bloomSpread: 0.03,
    bloomPerShot: 0.35,
    bloomDecay: 2.4,
    recoilPattern: [
      [0.028, 0.002],
      [0.03, -0.003],
      [0.032, 0.004],
    ],
    magSize: 12,
    reserveAmmo: 60,
    reloadTime: 1.4,
    sound: { sub: 90, crack: 0.5, body: 0.16, pitch: 1.0 },
    model: { asset: 'wep_pistol', scale: 1 },
    shootAnim: true,
    pose: DEFAULT_POSE,
  },
  rifle: {
    name: 'Rifle',
    auto: true,
    rpm: 600,
    damage: 17,
    headshotMult: 2.5,
    pellets: 1,
    range: 200,
    spread: [0.03, 0.006],
    bloomSpread: 0.045,
    bloomPerShot: 0.16,
    bloomDecay: 1.6,
    recoilPattern: [
      [0.014, 0.001],
      [0.016, -0.002],
      [0.017, 0.003],
      [0.015, 0.004],
      [0.018, -0.004],
      [0.016, -0.001],
    ],
    magSize: 30,
    reserveAmmo: 120,
    reloadTime: 2.1,
    sound: { sub: 70, crack: 0.65, body: 0.13, pitch: 1.1 },
    model: { asset: 'wep_rifle', scale: 1 },
    shootAnim: false,
    pose: RIFLE_POSE,
  },
  shotgun: {
    name: 'Shotgun',
    auto: false,
    rpm: 75,
    damage: 12,
    headshotMult: 1.8,
    pellets: 8,
    range: 40,
    spread: [0.05, 0.032],
    bloomSpread: 0.02,
    bloomPerShot: 0.6,
    bloomDecay: 1.8,
    recoilPattern: [[0.075, 0.006]],
    magSize: 6,
    reserveAmmo: 30,
    reloadTime: 2.6,
    sound: { sub: 55, crack: 0.85, body: 0.28, pitch: 0.8 },
    model: { asset: 'wep_shotgun', scale: 1 },
    shootAnim: true,
    pose: SHOTGUN_POSE,
  },
  sawnoff: {
    name: 'Sawn-Off',
    auto: false,
    rpm: 140,
    damage: 15,
    headshotMult: 1.8,
    pellets: 9,
    range: 22,
    // Brutal up close, useless past ~15m: the panic gun for horde breaks.
    spread: [0.085, 0.06],
    bloomSpread: 0.02,
    bloomPerShot: 0.7,
    bloomDecay: 2.2,
    recoilPattern: [[0.11, 0.01], [0.12, -0.012]],
    magSize: 2,
    reserveAmmo: 18,
    reloadTime: 2.0,
    sound: { sub: 48, crack: 0.9, body: 0.34, pitch: 0.72 },
    model: { asset: 'wep_sawnoff', scale: 1 },
    shootAnim: true,
    pose: SAWNOFF_POSE,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sawnoff'] as const;
