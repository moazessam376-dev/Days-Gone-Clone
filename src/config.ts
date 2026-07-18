/**
 * Central tuning configuration. Every gameplay-feel constant lives here so it
 * can be tweaked in one place and exposed through the debug panel (lil-gui).
 * Systems read from these objects live — the debug panel mutates them directly.
 */

export const PHYSICS = {
  fixedDt: 1 / 60,
  gravity: -9.81,
  maxFrameDelta: 0.25,
};

export const CAMERA = {
  fov: 55,
  near: 0.1,
  far: 600,
};

export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  walkSpeed: 2.2,
  jogSpeed: 4.6,
  sprintSpeed: 7.0,
  sprintWindup: 0.25,
  accel: 40,
  decel: 30,
  aimMoveScale: 0.45,
  turnSpeed: 14,
  /** After the last shot, keep facing the camera/aim direction this long. */
  combatFaceTime: 1.5,
  gravity: -25,
  maxFallSpeed: 40,
  roll: {
    duration: 0.55,
    speed: 8.5,
    cooldown: 0.25,
    iframeStart: 0.08,
    iframeEnd: 0.38,
  },
};

export const CAMERA_RIG = {
  // Relative to the player root (capsule CENTER, ~0.9m above feet):
  // 0.6 puts the pivot at chest/shoulder height (~1.5m above ground).
  pivotHeight: 0.6,
  shoulderX: 0.45,
  restDistance: 2.8,
  aimShoulderX: 0.62,
  aimDistance: 1.55,
  aimFov: 42,
  aimLerpTime: 0.12,
  sensitivity: 0.0022,
  pitchMin: -1.15,
  pitchMax: 1.3,
  collisionRadius: 0.2,
  collisionRecoverSpeed: 5,
  /** Chase-cam follow spring stiffness while driving (higher = tighter). */
  vehicleFollow: 5,
  /** Hide the player model when the camera arm shrinks below this... */
  hideAvatarBelow: 0.85,
  /** ...and show it again above this (hysteresis kills boundary flicker). */
  showAvatarAbove: 1.0,
};

export const FEEL = {
  shake: {
    decay: 2.2, // trauma units/s
    maxOffset: 0.09, // meters at trauma=1
    maxRoll: 0.035, // radians at trauma=1
    freq: 11,
  },
  hitstop: {
    scale: 0.05,
    durationMs: 45,
  },
  recoil: {
    recoverSpeed: 9, // spring-back of camera kick
    weaponKick: 0.05, // meters of visual gun kick per shot
  },
};

export const ENEMY = {
  capacity: 512,
  health: 70,
  walkSpeed: 1.3,
  runSpeed: 3.6,
  runDistance: 22, // start sprinting at the player inside this range
  attackRange: 1.7,
  attackDamage: 12,
  attackWindup: 0.45, // seconds into the bite when damage lands
  attackCooldown: 1.3,
  staggerTime: 0.35,
  separationRadius: 0.9,
  separationForce: 2.5,
  /** Separation may contribute at most this fraction of move speed (seek wins). */
  separationCap: 0.6,
  /** Yaw added to the zombie model so it renders facing its heading. */
  modelYawOffset: 0,
  corpseTime: 4,
  /** Corpse rigid bodies weigh this much (kg) — knock-downs, not launches. */
  corpseMass: 70,
  // Death velocities are set directly (impulses are unreliable on a body the
  // same tick it is re-enabled — Rapier reports mass 0 until the next step).
  corpseKnockSpeed: 2.7, // m/s along the shot direction
  corpseUpSpeed: 0.9,
  corpseSpinSpeed: 3.5, // rad/s topple
  /** Hard cap on corpse speed — vehicles shove bodies, never moon-launch them. */
  corpseMaxSpeed: 12,
  headshotHeight: 1.45, // hit above this (local) = headshot
  physicsPoolSize: 32,
  corpsePoolSize: 8,
  aiLod: { nearDist: 30, midDist: 80, farTickDivider: 8 },
};

export const PLAYER_HEALTH = {
  max: 100,
  regenDelay: 5,
  regenRate: 8, // hp/s
};

/** Cross-action exclusivity: one deliberate action at a time. */
export const ACTIONS = {
  meleeLock: 0.4, // seconds firing/throwing are blocked after a melee swing
  throwLock: 0.5, // seconds firing/melee are blocked after starting a throw
  throwWindup: 0.25, // wind-up before the projectile actually leaves the hand
  throwCooldown: 0.8, // min time between throws
  switchFireDelay: 0.3, // can't fire immediately after a weapon switch
};

export const MELEE = {
  range: 1.9,
  arcDeg: 70,
  damage: 45,
  cooldown: 0.7,
  knockback: 4,
};

export const VEHICLES = {
  /** Below this speed a vehicle is a steering obstacle zombies walk around;
   * above it (and past runOverSpeed 2.5) the car plows through instead —
   * the 0.5 m/s overlap means there is no dead zone. */
  obstacleMaxSpeed: 3,
  /** Extra clearance around the chassis footprint for the steering rect. */
  obstacleMargin: 0.45,
};

export const AMMO_CRATES = {
  /** [x, z] spots around town; a hideout crate is added at setup. */
  townSpots: [
    [26, -18],
    [-30, 24],
    [12, 55],
  ] as Array<[number, number]>,
  pickupRadius: 1.6,
  respawnTime: 30,
  pulseSpeed: 3,
};

export const DEBUG = {
  showStats: true,
};
