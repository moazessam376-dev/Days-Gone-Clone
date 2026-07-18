# R1 — Player Handling Model (spec, FINAL)

Status: **approved for implementation** (planning session with the user,
2026-07-18; user directive: "no assumptions — everything decided now").
Implementation must match this spec cell-by-cell; the matrix is the review
checklist. Where a value later proves wrong in playtest, it is tuned in the
lil-gui panel and the new number is written back HERE and into `config.ts` —
the spec and config never disagree.

## Locked user decisions

1. **Aim-to-shoot.** Hold RMB to aim (ADS); LMB fires only while aiming.
2. **Sprint lowers the gun.** No firing or aiming mid-sprint; aiming cancels
   sprint (brake to aim-walk as the gun comes up).
3. **Weapon wheel HUD** (Days Gone style): hold Tab → time slows → radial
   menu with guns AND throwables → release to equip. 1/2/3 + scroll remain
   as quick gun shortcuts. The old G/F throwable keys are REMOVED.
4. **Stamina bar ships in R1.**
5. **ADS camera: full over-shoulder kit** (tight shoulder frame, FOV change,
   aim punch, Q shoulder swap, sprint FOV widen).
6. **Reticle only while aiming.**
7. **Throwables have a trajectory trace** (Days Gone style) and use the gun
   scheme: RMB shows the arc, LMB throws, previous gun re-equips after.
8. **Melee: design slot only** — reserved state + greyed wheel sector; real
   melee ships with R2's character. (The existing V-key punch stays as an
   undocumented stopgap subject to the action-priority rules; it is NOT on
   the wheel and gets no further work in R1.)
9. **Crouch: design slot only** (R4, with enemy perception).
10. **Roll stays, stamina-priced.**
11. **Feel: weighty-responsive** (~0.25 s aim raise, ~0.6 s swap).

## Complete control map (after R1 — this is exhaustive)

| Input | Action |
|---|---|
| WASD | Move (camera-relative) |
| Mouse | Look (pointer lock) |
| LMB (button 0) | Fire / throw — **only while aiming**; unaimed press = carry-alert nudge (face camera 0.8 s, no shot, no ammo) |
| RMB (button 2, hold) | Aim (ADS) / show throwable arc |
| ShiftLeft (hold) | Sprint (needs stamina, blocks aim/fire) |
| Space | Dodge roll (costs stamina) |
| R | Reload |
| Tab (hold) | Weapon wheel (slow-mo); release = equip |
| 1 / 2 / 3 | Quick-select pistol / rifle / shotgun |
| Mouse scroll | Cycle guns only (pistol→rifle→shotgun→…); ignored while wheel open |
| Q | Shoulder swap (mirror camera side; persists until pressed again) |
| E | Enter / exit vehicle |
| V | Stopgap punch (pre-R2 melee; unchanged) |
| Enter | Respawn when dead |
| Esc | Browser pointer-lock release → pause |
| G / F | **REMOVED** (throwables live on the wheel) |

Tab and Q require `e.preventDefault()` in `Input` keydown (Tab moves browser
focus otherwise). This is the only Input.ts behavior change besides a new
scroll accumulator (`consumeScroll(): number`, wheel-event deltaY sign only).

## State model

Three layers. Layer transitions are the ONLY way behavior changes — no
per-key if-chains scattered through Game.ts.

**Locomotion:** `IDLE`, `JOG`, `SPRINT`, `AIM_WALK`, `ROLL`. Reserved:
`CROUCH` (R4), `VEHICLE` (R3; in R1 driving disables all weapon handling
and holsters the weapon — that is HOLSTERED's only R1 use).

**Weapon stance:** `HOLSTERED` (driving only in R1), `CARRY` (default on
foot), `ADS` (RMB). Throwables use the same stances; their ADS shows the
arc instead of the reticle.

**Action slot (one at a time):** `NONE`, `FIRE`, `RELOAD`, `SWAP`, `THROW`,
`WHEEL`. Reserved: `MELEE` (R2). Priority when multiple inputs arrive the
same tick: **ROLL ≻ WHEEL ≻ THROW ≻ RELOAD ≻ SWAP ≻ FIRE**. No input
buffering anywhere: an input that arrives while blocked is dropped, not
queued (sole exception: RMB is a *held state*, so aim naturally resumes
after roll/swap/sprint ends while it is still held).

Interrupt rules (complete list):
- ROLL cancels RELOAD (progress lost, restart manually or via auto-reload
  on next dry fire), suppresses ADS for its duration, cancels the arc.
  A throw wind-up already in flight (0.25 s) still completes — the bottle
  is already leaving the hand.
- SPRINT start cancels RELOAD and drops ADS. SPRINT is impossible while
  winded, while aiming, or while the wheel is open.
- RELOAD allowed in IDLE/JOG/AIM_WALK. Keeps stance. Fire blocked during.
- SWAP (keys/scroll/wheel): 0.6 s lower-then-raise; fire blocked during
  (existing `ACTIONS.switchFireDelay` 0.3 → raised to match: fire unlocks
  at swap end). Swapping cancels reload (existing `switchTo` behavior).
- Wheel open: fire/aim/reload/swap-keys blocked; movement continues; an
  in-progress reload CONTINUES (only selecting a different weapon cancels it).

## THE movement × weapon matrix

Cell = body / camera. Verified cell-by-cell before R1 closes.

| | **Aim (RMB hold)** | **Fire (LMB)** | **Reload (R)** | **Swap (1-3/scroll)** | **Wheel (Tab hold)** |
|---|---|---|---|---|---|
| **IDLE** | ADS in 0.25 s; camera to shoulder frame | ADS: shoot. Else: carry-alert nudge only | reload, stance kept | 0.6 s swap | opens; slow-mo |
| **JOG** | speed clamps to aim-walk (2.07 m/s = jog × 0.45) as ADS enters | same as IDLE | allowed moving | allowed moving | opens; jog continues slow-mo |
| **SPRINT** | cancels sprint → aim-walk, one fluid 0.25 s motion | **ignored** (not aiming by definition) | cancels sprint, reloads at jog | allowed; sprint blocked for the 0.6 s swap, resumes if Shift held | opens; sprint ends |
| **AIM_WALK** | (held) strafe at aim speed | shoot | allowed; stays ADS | allowed; ADS drops for swap, resumes if RMB held | opens; ADS drops |
| **ROLL** | suppressed; resumes on exit if held | ignored | canceled at roll start | ignored (dropped, not queued) | ignored until roll ends |
| **VEHICLE (R1)** | — | — | — | — | ignored |
| *CROUCH — reserved R4* | | | | | |

Throwable-equipped differences ONLY: RMB = dotted arc (no reticle); LMB
while arc visible = throw; LMB without arc = nothing (not even the nudge);
after the throw completes, the previously-equipped gun auto-re-equips over
0.5 s. One throw per LMB press. Everything else identical.

## Stamina (config `STAMINA`)

- `max: 100`, `sprintDrain: 12`/s (~8.3 s full sprint), `rollCost: 22`,
  `regenRate: 16`/s, `regenDelay: 1.0` s after last drain, `windedExit: 25`.
- Winded (stamina hits 0): sprint and roll locked until stamina ≥ 25.
  Move speed is otherwise UNPENALIZED (jog stays 4.6 — the punishment is
  losing escape tools, not mobility).
- Roll requires: grounded, not winded, off cooldown. It may take stamina
  to 0 (cost clamps) and thereby trigger winded.
- Sprint requires stamina > 0 and not winded; drains only while actually
  sprint-moving. Driving: full regen (no drain).
- Melee/V: no stamina interaction (stopgap feature).
- HUD: 140×6 px bar directly under the health bar, same styling; fill
  `#d8b53a`; winded → fill flashes `#b03a30` at 4 Hz until unlocked;
  fades out (0.4 s) when full for 3 s, back in on any drain.

## Camera per state (config values — current code values are the baseline)

| State | Distance | ShoulderX | FOV | Blend |
|---|---|---|---|---|
| Explore/carry | `restDistance` 2.8 | 0.45 × side | 55 | — |
| ADS | `aimDistance` 1.55 | 0.62 × side | 42 | in 0.25 s / out 0.18 s (`aimLerpTime` split: `aimInTime` 0.25, `aimOutTime` 0.18 replaces single 0.12) |
| Sprint | 2.8 | 0.45 × side | 55 + `sprintFovAdd` 6 = 61 | 0.25 s each way |
| Wheel open | unchanged | unchanged | unchanged | vignette opacity 0.45 |
| Roll | explore values | | | no snap |
| Vehicle | 7.0 (existing) | 0 | 55 | existing smoothing |

- `side` = +1 right / −1 left, toggled by Q, blended over 0.15 s
  (smoothstep on the sign flip), persists across states and deaths.
- Aim punch: existing `Recoil` camera kick is the aim punch (no extra FOV
  punch — recoil pattern already differentiates weapons).
- Sensitivity already FOV-scaled (`fovScale` in CameraRig) — unchanged.

## Weapon wheel (config `WHEEL`)

- Hold Tab → open (only when: pointer locked, alive, not driving, not
  rolling). `timeScale: 0.2` composed multiplicatively with hitstop in
  `Game.render` (`loop.timeScale = hitstop.timeScale * (wheelOpen ? 0.2 : 1)`).
- While open, mouse deltas drive SELECTION, not the camera: accumulate
  into a 2D vector, clamped to `maxPx: 80`; highlight = vector angle when
  length > `deadzonePx: 20`, else no highlight. Camera yaw/pitch frozen.
- 6 fixed sectors, clockwise from 12 o'clock: **Pistol, Rifle, Shotgun,
  Molotov, Grenade, Melee**. Melee greyed with "R2" tag, unselectable.
  Empty throwable (count 0) sectors greyed, unselectable. Each sector
  shows name + mag/reserve (guns) or count (throwables).
- Release Tab: equip highlighted sector (guns → `WeaponSystem.switchTo`,
  0.6 s swap lock; throwables → throwable-equip, 0.4 s). No highlight or
  unselectable → keep current, no lock. Selecting the already-equipped
  item → no-op, no lock.
- Pointer-lock loss while open (Esc): wheel closes, keeps current weapon,
  timeScale factor restored, then the normal pause flow runs.
- DOM/CSS implementation in `src/ui/WeaponWheel.ts` (radial divs, no
  canvas), same pattern as HUD.

## Throwables as equipment (config `THROWABLE_INV`)

- Inventory: `grenadeMax: 3`, `molotovMax: 3`, start `2` each. Ammo
  crates refill throwables to max (alongside gun reserves) — crate text
  stays "AMMO".
- Equipping a throwable hides the gun model and shows a hand prop
  (grenade: 0.12 sphere, olive; molotov: 0.3 bottle-ish cylinder, amber
  emissive — matches `Throwables.ts` materials).
- RMB (throwable ADS): camera uses the SAME ADS frame; reticle hidden;
  arc shown instead. Arc = ballistic sample of the exact throw params
  (`v = camDir × 16 + up × 4.5`, gravity −9.81, from the same origin the
  real throw uses): 40 samples × 0.06 s step, terminated at terrain
  height, rendered as a pooled dotted `THREE.Points` (one allocation at
  startup) with a 0.12-radius endpoint marker. Updated per render frame.
- LMB while arc visible: wind-up 0.25 s (existing `ACTIONS.throwWindup`,
  camera direction sampled at RELEASE moment as today), count −1, and the
  previous gun auto-re-equips over `reequipTime: 0.5` s after EVERY throw
  (one throw per equip — chaining throws means re-opening the wheel; this
  is the anti-"press everything at once" rule applied to explosives).
- Roll during arc: arc hides, throwable stays equipped, arc returns on
  exit if RMB held. Entering a vehicle with a throwable equipped:
  holstered like guns; on exit the throwable is still equipped.

## Reticle & HUD changes

- Reticle (dot + 4 bloom ticks) visible ONLY while gun-ADS: opacity fades
  0.12 s in/out. Hitmarkers still render whenever earned (vehicle
  run-overs kill with the reticle hidden — hitmarker shows regardless).
- Ammo block: unchanged for guns; when a throwable is equipped it shows
  its count (`× 2`) and name (GRENADE / MOLOTOV).
- New stamina bar (see Stamina). Everything else untouched.

## Pose & attachment (R1 scope, rig-portable)

- `weapons.data.ts` gains per-weapon `pose: { carry: Transform, ads: Transform }`
  (position + euler offsets applied to the existing hand-follow holder in
  `WeaponRig.update`), replacing the single hardcoded
  `rotation.set(0, -π/2, 0)`. Initial values = current look for ads;
  carry adds a −35° pitch (barrel down) — tuned visually before ship.
- CARRY upper-body: blend `Pistol_Aim_Neutral` masked-upper at weight
  0.35 while a weapon is in hands and not aiming/rolling/sprinting — the
  arm stops swinging through the gun. Sprint drops it to 0 (arms pump).
- **Two-hand left-hand snap: DEFERRED to R2** (decided): the Quaternius
  armature's 100× bone scale makes post-anim bone overrides high-risk,
  and the rig only has pistol clips — rifle/shotgun get real poses in R2.
  The data schema still reserves `foregrip` so R2 drops in.
- Swap visual: gun model lerps down 0.15 m + pitch −60° over the lower
  half of the swap, new gun raises over the upper half. Throwable equip:
  same raise-half only.

## Config additions (all lil-gui-bound, grouped)

`STAMINA` (above) · `HANDLING { aimInTime: .25, aimOutTime: .18, swapTime: .6,
throwableEquipTime: .4, reequipTime: .5, shoulderSwapTime: .15,
nudgeTime: .8, carryBlend: .35 }` · `WHEEL { timeScale: .2, deadzonePx: 20,
maxPx: 80, vignetteOpacity: .45 }` · `THROWABLE_INV { grenadeMax: 3,
molotovMax: 3, grenadeStart: 2, molotovStart: 2 }` ·
`CAMERA_RIG.sprintFovAdd: 6` (+ `aimInTime/aimOutTime` replace `aimLerpTime`).
`ACTIONS.switchFireDelay` 0.3 → 0.6 (fire unlocks when the swap ends).

## R2 clip shopping list (exit artifact)

Per weapon class (pistol / long-gun): carry idle, carry jog/run, aim idle,
aim walk F/B/L/R (or strafe blendables), draw/holster, reload, shoot.
Shared: sprint, roll, throw (overhand), hit reaction, deaths, idle fidget,
two-hand foregrip pose (long guns). Later phases: crouch set (R4), melee
swings (R5). A character asset qualifies ONLY if this list is covered.

## Implementation slices (each ends runnable, `npm run build` clean)

1. **C1** state machine + input rework (aim-to-shoot, sprint rules,
   priority, Tab preventDefault, scroll cycle). G/F stay alive until C4
   ships their wheel replacement — every slice ends fully playable.
2. **C2** stamina + HUD bar + winded.
3. **C3** camera kit (split aim blend times, sprint FOV, Q swap, wheel
   vignette hook, reticle-only-while-aiming).
4. **C4** weapon wheel + throwable equipment + arc trace + inventory.
5. **C5** pose/attachment data pass (grip transforms, carry blend, swap
   visual).
6. **C6** CI scenarios S18–S22 + tuning pass + deploy + live verify.

## Verification (gate for calling R1 done)

- Manual: walk every matrix cell with a gun AND a throwable; wheel usable
  mid-horde; stamina winds/recovers; no camera snaps; reticle only in ADS.
- CI additions (`scripts/physics-tests.mts`):
  - S18 sprint-fire: hold Shift+W+LMB 120f → ammo unchanged.
  - S19 aim-to-shoot: LMB alone 60f → ammo unchanged; RMB then LMB →
    ammo −1.
  - S20 stamina: sprint until winded (≥9 s) → sprint speed collapses to
    jog; stop 3 s → recovered past windedExit; roll denied while winded.
  - S21 wheel: Tab down 60 real frames → gameTime advanced ≈0.2×; mouse
    delta to Molotov sector; Tab up → throwable equipped (HUD name).
  - S22 throw flow: RMB+LMB with molotov → one projectile, count −1,
    gun re-equipped after 0.5 s; LMB without RMB → nothing thrown.
- `npm run build` clean; Actions green (existing 18 + new 5 scenarios);
  live URL: full manual matrix pass in real play.
