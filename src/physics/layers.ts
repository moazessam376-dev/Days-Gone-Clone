/**
 * THE collision matrix — single source of truth.
 *
 * Rapier interaction groups pack two 16-bit masks: high bits = memberships,
 * low bits = filter. Two colliders form a solver contact (or match a query)
 * iff EACH one's membership overlaps the OTHER's filter — the test is two-way.
 *
 * Every collider and every physics query in the game takes its groups from a
 * named constant in THIS file. Never call interactionGroups() or write mask
 * literals anywhere else; when behavior between two systems must change,
 * change the matrix here and record the rationale in docs/collision-matrix.md.
 *
 * | pair                | result                                  |
 * |---------------------|-----------------------------------------|
 * | player ↔ static     | wall (character controller)             |
 * | player ↔ enemy      | wall (KCC query; both kinematic)        |
 * | player ↔ vehicle    | wall via KCC query ONLY — see note      |
 * | player ↔ corpse     | pass through                            |
 * | enemy ↔ vehicle     | no contact; steering block + run-over   |
 * | corpse ↔ vehicle    | knock-aside (velocity-capped)           |
 * | throwable ↔ world   | bounce off static + vehicles only       |
 * | hitscan → targets   | static, enemies, vehicles               |
 * | camera → world      | static only                             |
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

// ---- Body/collider groups (assigned via setCollisionGroups) ----

/** World geometry: terrain, buildings, trees, crates, breakables. */
export const STATIC_GROUPS = interactionGroups(Layer.STATIC, ALL_LAYERS);

/** The player's kinematic capsule. */
export const PLAYER_BODY_GROUPS = interactionGroups(Layer.PLAYER, ALL_LAYERS);

/** Enemy kinematic capsules + head balls (excludes VEHICLE: cars plow through;
 * run-over kills come from EnemyManager.runOverSweep, not the solver). */
export const ENEMY_BODY_GROUPS = interactionGroups(Layer.ENEMY, 0xffff & ~Layer.VEHICLE);

/** Corpse boxes: world + each other. */
export const CORPSE_GROUPS = interactionGroups(Layer.RAGDOLL, Layer.STATIC | Layer.RAGDOLL);

/** Car/bike chassis. */
export const VEHICLE_GROUPS = interactionGroups(Layer.VEHICLE, ALL_LAYERS);

/** Grenades/molotovs: bounce off the world and vehicles, sail past bodies. */
export const THROWABLE_GROUPS = interactionGroups(Layer.PROJECTILE, Layer.STATIC | Layer.VEHICLE);

// ---- Query-only groups (never assigned to a collider) ----

/** What the character controller treats as walls/ground. */
export const KCC_OBSTACLE_GROUPS = interactionGroups(Layer.PLAYER, ALL_LAYERS);

/** Hitscan bullets: world, flesh, vehicles. */
export const HIT_SCAN_GROUPS = interactionGroups(
  Layer.PROJECTILE,
  Layer.STATIC | Layer.ENEMY | Layer.VEHICLE,
);

/** Vehicle suspension rays: ONLY static ground — a ray landing on a kinematic
 * enemy capsule reads as terrain and catapults the chassis. */
export const WHEEL_RAY_GROUPS = interactionGroups(Layer.VEHICLE, Layer.STATIC);

/** Camera occlusion casts: only the static world should push the camera in. */
export const CAMERA_CAST_GROUPS = interactionGroups(Layer.CAMERA, Layer.STATIC);
