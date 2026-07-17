/**
 * Data-driven weapon definitions. All feel/balance numbers for guns live HERE,
 * not in code. Recoil patterns are deterministic sequences (pitch, yaw) in
 * radians consumed per shot and wrapped.
 */

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
  /** Visual gun proportions for the placeholder boxy model. */
  model: { barrelLen: number; bodyLen: number; scale: number };
  /** Plays the full Pistol_Shoot anim per shot (semi-autos only). */
  shootAnim: boolean;
}

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
    model: { barrelLen: 0.16, bodyLen: 0.14, scale: 0.9 },
    shootAnim: true,
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
    model: { barrelLen: 0.34, bodyLen: 0.26, scale: 1.0 },
    shootAnim: false,
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
    model: { barrelLen: 0.4, bodyLen: 0.3, scale: 1.05 },
    shootAnim: true,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun'] as const;
