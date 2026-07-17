/**
 * Collision layers. Rapier interaction groups pack two 16-bit masks:
 * high bits = memberships, low bits = filter (what it collides with).
 * Two colliders interact iff each one's membership overlaps the other's filter.
 */
export const enum Layer {
  STATIC = 1 << 0,
  PLAYER = 1 << 1,
  ENEMY = 1 << 2,
  RAGDOLL = 1 << 3,
  VEHICLE = 1 << 4,
  PROJECTILE = 1 << 5,
  CAMERA = 1 << 6,
}

export function interactionGroups(memberships: number, filter: number): number {
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}

export const ALL_LAYERS = 0xffff;

/** Camera occlusion casts: only the static world should push the camera in. */
export const CAMERA_CAST_GROUPS = interactionGroups(Layer.CAMERA, Layer.STATIC);
