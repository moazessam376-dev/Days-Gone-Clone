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

export const DEBUG = {
  showStats: true,
};
