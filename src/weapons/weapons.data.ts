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
 * Hand-follow gun pose (Mixamo gun-clip era): the character's gun clips pose
 * the wrist meaningfully, so the gun rides the RIGHT-HAND bone — position AND
 * orientation — instead of a world-composed frame.
 * `hold.pos` slides the grip into the palm (gun frame: x right, y up, z
 * toward the stock); `hold.rot` is a per-weapon euler tweak composed on top
 * of the shared HANDLING.holdRot hand→gun orientation.
 */
export interface WeaponPoses {
  hold: GripPose;
  /** Left-hand IK pin target (gun frame) — long guns; pistols one-handed. */
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
  /** Plays the class fire anim per shot (semi-autos only). */
  shootAnim: boolean;
  /** Animation class: which gun-handling clip set the avatar plays. */
  cls: 'pistol' | 'long';
  pose: WeaponPoses;
}

/** `hold.pos` is in the GUN's frame (x right, y up, z toward the stock):
 * exports are bbox-centered with the pistol grip near the origin, so small
 * offsets seat the grip in the palm. Calibrated against rendered frames
 * (scripts/grip-check.mts). */
const PISTOL_POSE: WeaponPoses = {
  hold: { pos: [0, 0.04, -0.02], rot: [-0.45, 0, 0] },
};
// `foregrip` (gun frame, barrel -z): where the LEFT hand IK pins — polish on
// top of the clip's own two-hand pose. Long guns only.
const RIFLE_POSE: WeaponPoses = {
  hold: { pos: [0, 0.04, -0.08], rot: [0, 0, 0] },
  foregrip: [0, -0.02, -0.22],
};
const SHOTGUN_POSE: WeaponPoses = {
  hold: { pos: [0, 0.04, -0.06], rot: [0, 0, 0] },
  foregrip: [0, -0.03, -0.2],
};
const SAWNOFF_POSE: WeaponPoses = {
  hold: { pos: [0, 0.03, -0.02], rot: [0, 0, 0] },
  foregrip: [0, -0.03, -0.15],
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
    cls: 'pistol',
    pose: PISTOL_POSE,
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
    cls: 'long',
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
    cls: 'long',
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
    cls: 'long',
    pose: SAWNOFF_POSE,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sawnoff'] as const;
