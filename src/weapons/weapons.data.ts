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
 * Grip-first pose data (see WeaponRig): `grip` is the GRIP SOCKET — the
 * point on the gun (gun frame: x right, y up, z toward the stock) that the
 * right palm wraps; it is glued to the palm in every stance. `rot` is a
 * per-weapon euler tweak on the class hold orientation. `foregrip` is where
 * the LEFT palm holds; two-hand guns aim their grip→foregrip axis along the
 * animated palm→palm line.
 */
export interface WeaponPoses {
  grip: [number, number, number];
  rot: [number, number, number];
  foregrip?: [number, number, number];
  /** Left-hand IK weight pulling the palm onto `foregrip` (default 0.6).
   * The rifle clips pose both arms for a RIFLE-length gun; shorter guns
   * need a stronger pull so their tighter foregrip actually reads — this
   * is what gives each long gun its own hold instead of the rifle's. */
  leftIk?: number;
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

/**
 * Sockets are in the GUN's frame (x right, y up, z toward the stock) and in
 * UNSCALED model units — WeaponRig multiplies by `model.scale`, so resizing a
 * weapon never invalidates its grip data.
 *
 * Every value below is MEASURED off the GLB's own vertices (bin the mesh along
 * Z, find the downward protrusions off the receiver line): the rearmost
 * protrusion IS the pistol grip, the one in front of it is the magazine or
 * trigger guard. The previous hand-guessed sockets sat 13-16 cm forward of
 * every real grip, so the hand held each gun by its receiver with the grip
 * floating up by the wrist.
 */
const PISTOL_POSE: WeaponPoses = {
  // Revolver grip protrusion: z 0.119..0.186, down to y -0.103.
  grip: [0, -0.05, 0.15],
  rot: [0, 0, 0],
};
const RIFLE_POSE: WeaponPoses = {
  // Pistol grip: z 0.193..0.27 (deepest -0.094); magazine is the z≈-0.04
  // protrusion, which is what the old socket was grabbing.
  grip: [0, -0.05, 0.225],
  rot: [0, 0, 0],
  // Handguard underside y 0.019, top rail 0.142 — palm wraps mid-height.
  foregrip: [0, 0.05, -0.19],
  leftIk: 0.85,
};
const SHOTGUN_POSE: WeaponPoses = {
  // Grip protrusion z 0.162..0.301 (deepest -0.103); trigger guard z≈0.116.
  grip: [0, -0.045, 0.19],
  rot: [0, 0, 0],
  foregrip: [0, 0.045, -0.2],
  leftIk: 0.95,
};
const SAWNOFF_POSE: WeaponPoses = {
  // Grip protrusion z 0.142..0.22 (deepest -0.094 at 0.168).
  grip: [0, -0.045, 0.175],
  rot: [0, 0, 0],
  foregrip: [0, 0.06, -0.16],
  leftIk: 0.95,
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
    model: { asset: 'wep_pistol', scale: 0.709 },
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
    model: { asset: 'wep_rifle', scale: 0.777 },
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
    model: { asset: 'wep_shotgun', scale: 1.167 },
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
    model: { asset: 'wep_sawnoff', scale: 0.553 },
    shootAnim: true,
    cls: 'long',
    pose: SAWNOFF_POSE,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sawnoff'] as const;
