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

### R2 — Asset round (user picks all art)
- Character chosen for its ANIMATION LIST first (R1 produces the clip
  shopping list), model second. Zombies, vehicles, buildings, props.

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
