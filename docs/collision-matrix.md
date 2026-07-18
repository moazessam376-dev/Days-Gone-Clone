# Collision Matrix

The single source of truth for these decisions in code is
`src/physics/layers.ts` — every collider and every physics query imports a
named group constant from that file. **Never** call `interactionGroups()` or
write mask literals anywhere else. To change how two systems interact, change
the matrix there and update this document's rationale.

Rapier's test is **two-way**: colliders A and B form a solver contact (or
match a query) iff `(A.memberships & B.filter) && (B.memberships & A.filter)`.
This lets one side kill a solver pair while a *query* from the other side
still sees it — used deliberately for player↔vehicle (below).

## Layers

| Layer | bit | who |
|---|---|---|
| STATIC | 1 | terrain, buildings, trees, crates, breakable boards |
| PLAYER | 2 | the player's kinematic capsule |
| ENEMY | 4 | pooled kinematic zombie capsules + head balls |
| RAGDOLL | 8 | pooled dynamic corpse boxes |
| VEHICLE | 16 | car + bike chassis (dynamic) |
| PROJECTILE | 32 | grenades/molotovs (bodies) and hitscan rays (query) |
| CAMERA | 64 | camera occlusion cast (query only) |

## Pair table

| pair | behavior | mechanism / rationale |
|---|---|---|
| player ↔ static | wall | character controller (KCC) geometric slide |
| player ↔ enemy | wall | KCC sees enemy capsules; two kinematic bodies never solver-contact |
| player ↔ vehicle | **wall, zero impulse** | the player's body filter **drops VEHICLE**, killing the solver pair (a kinematic capsule would otherwise shove the dynamic chassis with unbounded authority — the "flying car" bug). The KCC movement query uses `KCC_OBSTACLE_GROUPS` (includes VEHICLE) so vehicles remain solid walls. **The vehicle filter must keep PLAYER** for the two-way query test to pass — do not "clean it up". |
| player ↔ corpse | pass through | corpses would trip the player constantly |
| player ↔ throwable | pass through | never collide with your own grenade |
| enemy ↔ static | n/a physically | enemy movement is SoA arithmetic; buildings block via the `enemyBlockAt` steering field, not the solver |
| enemy ↔ vehicle | no contact | kinematic capsules would stonewall the car. Parked/slow vehicles block via the steering field (`vehicleBlockAt`, active < `VEHICLES.obstacleMaxSpeed`); fast cars kill via `runOverSweep`. The 3 m/s obstacle threshold sits above `runOverSpeed` 2.5 so there is no dead zone. |
| enemy ↔ corpse / throwable | ignore | — |
| corpse ↔ static / corpse | collide | bodies rest on ground, stack |
| corpse ↔ vehicle | **knock-aside** | driving over bodies shoves them; corpse linvel clamped to `ENEMY.corpseMaxSpeed` every tick so a solver kick can never moon-launch one |
| vehicle ↔ static / vehicle | collide | normal driving |
| throwable ↔ static / vehicle | bounce | grenades roll off cars; they sail past bodies (AoE handles damage) |
| hitscan → static, enemy, vehicle | hit | `HIT_SCAN_GROUPS`; the enemy filter must keep PROJECTILE for the two-way test |
| wheel rays → static only | suspension | a ray landing on a kinematic zombie capsule reads as ground and catapults the chassis |
| camera → static only | push-in | camera must never collide with bodies |

## Trip wires (do not break)

- `HIT_SCAN_GROUPS` keeps VEHICLE → bullets spark on cars.
- Enemy filter keeps PROJECTILE (hitscan) and PLAYER (KCC walls).
- Vehicle filter keeps PLAYER (KCC wall query) and RAGDOLL (corpse shove).
- `THROWABLE_GROUPS` unchanged → grenade-bounces-off-car preserved.
- KCC `applyImpulsesToDynamicBodies` stays **false** — nothing dynamic should
  ever be pushed by the capsule.

## Adding a layer

1. Add the bit to `Layer` in `src/physics/layers.ts`.
2. Decide its row against every existing layer; add/extend the group constants.
3. Update the pair table here with rationale.
4. Add a regression scenario to `scripts/physics-tests.mts` covering the new
   interaction's failure mode.
