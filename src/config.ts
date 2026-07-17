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
  pivotHeight: 1.5,
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
};

export const DEBUG = {
  showStats: true,
};
