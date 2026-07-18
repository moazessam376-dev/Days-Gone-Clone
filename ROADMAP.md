# Roadmap

The agreed development roadmap after the two V1 playtests (2026-07-18). Work
proceeds phase by phase; **each phase gets its own detailed planning session
with the user before any code**, and every phase ends with the game runnable,
verified, and deployed. Sessions: check this file plus `docs/` specs before
starting work; the current phase is marked below.

**Guiding principle (user's words): "I want to create a good game, not slop."**
Design decisions are made explicitly with the user BEFORE implementation —
never bolted on feature-by-feature. Details matter more than feature count.

## Diagnosis that produced this roadmap

Two systemic causes were behind the "everything feels mid" state of V1:

1. **No designed physics interaction matrix.** Collision pairs were patched
   one at a time (zombie↔car, wheel-ray↔zombie, player↔car…); every unpatched
   pair became a "flying object" clip. Fix the system, not the pairs.
2. **No designed player handling model.** There is no concept of holstered /
   carry / ready / aiming; one static grip transform is reused for every
   weapon in every pose, and shooting doesn't change the body's stance.
   Also the mannequin rig only ships pistol-aim clips — real rifle/shotgun
   poses can only arrive with the asset round (R2), so R1's design must be
   rig-portable.

## Phases

### R0 — Stabilize the simulation  ✅ DONE (2026-07-18)
- Collision matrix designed and enforced: `docs/collision-matrix.md` +
  `src/physics/layers.ts` as the single source of truth (named group
  constants; no inline masks anywhere).
- Player↔vehicle is a wall (solver pair severed, KCC query keeps solidity);
  zombies steer around parked/slow vehicles; corpses knocked aside by cars
  with a hard speed cap.
- `npm run test:physics`: 14-scenario headless regression suite
  (`scripts/physics-tests.mts`), wired as a GitHub Actions job that BLOCKS
  the Pages deploy on failure.

**Known issue (deferred to R3):** the boarding launch — car/bike sometimes
flies when the player presses E to board — still reproduces in REAL play on
build `f8ae9ec` (user-confirmed via the on-screen stamp) but has never
reproduced under the deterministic `debugStep` harness. The trigger therefore
lives in the real rAF loop (variable dt / multiple fixedUpdates per frame /
alpha<1 interpolation / pause-resume), which the harness bypasses. Plan:
ship a vehicle "flight recorder" (rolling ~3 s state buffer, console dump on
height/velocity anomaly) so a normal play session captures the root cause,
and fix it during R3's boarding rework — the current teleport-based boarding
code is scaffolding R3 replaces anyway.

### R1 — Player handling model (big design phase, user decisions)  ◀ CURRENT
**Status: spec locked + implemented (2026-07-18), awaiting the user's
playtest sign-off.** Full spec: `docs/r1-player-handling.md` (aim-to-shoot,
sprint-lowers-gun, Tab weapon wheel with slow-mo, stamina, over-shoulder
ADS kit + Q swap, throwable arc trace + inventory, reticle only in ADS,
grip-pose data). CI suite now 23 scenarios (S18–S22 cover the handling
rules). R1 closes when the user has walked the matrix in real play and
any feel-tuning (debug panel dials → written back to config + spec) lands.
- Weapon states: holstered → carry (low ready) → hip-fire ready → ADS;
  triggers, transition times, sprint behavior (gun down? fire breaks sprint?).
- The movement × weapon matrix: a table crossing every movement state with
  every weapon action; each cell = what the body does + what the camera does.
  The table IS the spec and the review checklist.
- Camera per state: shoulder offset/distance/FOV per state, aim punch,
  sprint FOV, optional shoulder-side toggle.
- Weapon attachment: per-weapon per-pose grip transforms + simple two-hand
  look, designed rig-portable so R2's character drops in.
- Exit criteria: a written spec the user approved, then an implementation
  matching it cell-by-cell.

### R2 — Asset round (user picks all art)  ◀ IN PROGRESS (2026-07-18)
Decisions locked with the user (gallery session): see `docs/r2-asset-round.md`.
Landed so far: Synty export pipeline (FBX→GLB + skeleton reconstruction +
animation retarget), 4 gun models (+ sawn-off as 4th weapon, wheel now 7
sectors), Hunter_Male_01 player (hat+beard baked, clips retargeted),
civilian-12 zombie cast × 12 colorways, user's Bike.glb with spinning spoke
wheels + Synty Motorbike_01 fallback parked beside it, Muscle_01 armored
car, full pose-QA pass across handling states, licensed-asset distribution
via the `synty-assets-v1` release, Barricaded Main Street town + Synty
forest, first-playtest fix round (world-space weapon orientation — carry
low-ready / ADS tracks the reticle; bike steering un-reversed + stance from
wheel nodes; car suspension retune — wheels seat in the fenders, springs no
longer saturate; slope-park launch fixed by gating the upright assist on
airborne wheels + vertical velocity caps; town buildings grounded at their
lowest footprint corner; suite now 25 scenarios), second-playtest fix round
(A/D un-inverted on ALL vehicles — rendered chase-cam frames are the ground
truth, Rapier steers about the down-pointing suspension axis; two-handed
long guns + throw wind-up via procedural arm IK; car wheels spin/steer via
pivot groups with per-axle stance; vehicle spawns searched clear of the
town; motorbike chassis stance from its real wheel geometry), third-playtest
fix round (car steering restored to the bike's positive-left convention —
the round-2 "down-axis" car negation was wrong; parked vehicles no longer
self-launch or spin their wheels: Rapier's updateVehicle pumps suspension
impulses into SLEEPING bodies' stored velocity, so undriven sleeping
vehicles now skip the controller and scrub stored velocity, and `speed`
projects real linvel instead of currentVehicleSpeed(); carry yaw un-flipped
(charYaw already contains the model's π offset); Days Gone-style two-hand
carry — long guns anchor across the chest with BOTH hands IK'd to
grip/foregrip, blending to hand-follow in sprint and to the aim clip in
ADS; throw wind-up hand moved beside-and-behind the ear; S24 rewritten to
accumulate travel-velocity heading in sub-steps — the bike turns >180° in
the hold window and the old endpoint delta wrapped, which is how a bogus
steering "fix" once passed CI), fourth-playtest fix round (hand-follow
weapons attach at the PALM — bone origins are joints, so the hand bone
alone is the wrist and the pistol rode the forearm; throw wind-up runs
BEFORE the rig reads the hand so the bottle rides the raised arm instead
of floating at the hip; bike physics wheel radii measured from live-world
bboxes after a matrix update and clamped to the smallest wheel — stale
matrices had inflated them ~1.25-1.7x, floating the Synty moto 13cm and
the user's bike 15cm above their tires; sleeping vehicles with zero wheel
contacts self-heal by waking and dropping instead of freezing mid-air),
fifth-playtest fix round (REAL throw animation — the CC0 Quaternius UAL2
OverhandThrow swing-retargeted onto the Synty rig via new `extraAnims`
multi-source support in the export; the aim-hold freezes the clip at its
cocked frame, the release plays cock→follow-through timed to the windup;
per-bike rendered stance — the rigid bike model slides vertically to the
measured physics-hub vs authored-hub gap so tires meet the ground on both
bikes at any suspension load), sixth-playtest fix round (long guns get a
REAL two-hand ADS — the gun anchors to the chest in the aim frame with
both hands IK'd to grip/foregrip, instead of riding the animated hand
through the only aim clips the rig has, which are pistol clips (that was
"all weapons aim the same"); procedural finger-curl grips both hands —
no clip ever animates fingers, so every hand read as an open palm; bike
wheel radii FINAL: per-wheel pivot height above the lowest tire VERTEX
(`Box3.setFromObject(node, true)`) — the default corner-transformed bbox
had inflated the moto's rotated wheel node ~1.4x, which is what the
round-4/5 "fender" clamps were actually fighting; both bikes now rest
within 3cm of exact tire contact; pause hint updated to the real binds).
**Status after round 6: the user reports "nothing is fixed" — weapon
holds/aim still read wrong to them and a bike still clips the ground.
Six rounds of attachment-math fixes have passed headless verification
while failing the real playtest; the next session must reproduce the
problems from the user's own view (their build stamp, their footage, or
driving the live site) before writing any more code, and should treat
"held weirdly" as a pose-QUALITY problem (no gun animations exist in any
owned library — sourcing real rifle/pistol anim assets is on the table).

### R3 — Vehicles as a real system
- Enter/exit animations, visible rider on the bike, per-vehicle handling
  tuned on roads, engine audio, vehicle damage/health, per-vehicle camera.

### R4 — Enemy AI depth
- Perception (sight/sound, not omniscient), idle/wander/aggro states,
  flow-field horde pathing (replace axis-slide), hit reactions, attack variety.

### R5 — Combat feel & fire polish
- Per-weapon recoil/audio identity, impact feedback pass, fire/explosion
  visuals, ragdolls replacing tumble-boxes.

### R6 — Game structure
- Spawning/difficulty pacing, day/night, objectives, save. Only after the
  moment-to-moment feel is right.
