# R2 — Asset Round: Decisions & Implementation Spec

Decisions locked with the user on 2026-07-18 (gallery session; the choice
gallery artifact renders every candidate from the user's own packs).
Sources: user-licensed **Synty POLYGON Apocalypse v1.09** + **POLYGON City
Zombies v1.4** (local `.unitypackage`s, extracted to gitignored
`assets/raw/synty/`) and the user's own `Bike.glb` (AI-generated).

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Player character | **Hunter_Male_01** |
| D2 | Zombie cast | **Civilian set of 12**: Hobo_Male_01, Hoodie_Male_01, Jacket_Male_01, Jacket_Female_01, Coat_Female_01, Punk_Male_01, Roadworker_Male_01, Businessman_Male_01, ShopKeeper_Female_01, Tourist_Male_01, Father_Male_01, Mother_Female_01 — each spawnable in any of the 12 texture colorways |
| D3 | Guns | **Revolver_01** (pistol slot), **AssaultRifle_01** (rifle), **Shotgun_01** (shotgun) **+ Hybrid_02 as a 4th gun** (sawn-off, new wheel slot). Molotov_01 + Grenade_01 throwable models |
| D4 | Bike | **User's Bike.glb is THE bike**: extract spokes+rim+hub along mesh connectivity, spin around fitted axle centers (static tire ring stays with body), compress 30 MB → ~3 MB, rescale/orient. **Also prepare Synty Motorbike_01 with animated wheels** as a ready fallback — user decides after riding both; they want the personal bike to work if at all possible |
| D5 | Car | **Muscle_01** + apocalypse attachments (bull-bar/plating), replacing the Kenney sedan |
| D6 | World kit | **Full replacement** — buildings, roads, terrain props, barricades, wrecks, junk all go Synty; ends the mixed-asset look. Exact town layout spec'd below before build |

## Licensing constraint (drives the pipeline)

Synty assets are paid/licensed: **no Synty-derived file may be committed to
the public repo** (raw packs are already gitignored, and so is
`public/assets/synty/`). Implementation (revised during the build): processed
game-ready GLBs are zipped and attached to a **release on this same repo**
(tag `synty-assets-v1`); both CI jobs download+unzip it into
`public/assets/synty/` before building. This needs zero secrets or extra
repos, and the exposure is identical to what the deployed site already
serves at runtime — the git history stays clean either way. Locally,
`scripts/synty-export.mts` + `scripts/bike-export.mts` regenerate the files
from `assets/raw/synty/` and `assets/Game Assets/`. CC0 Kenney/Quaternius
assets stay committed as before. CREDITS.md carries a "Licensed (not
redistributed)" section for Synty.

## Implementation order

1. **Pipeline** — extend `scripts/fetch-assets.mts`: stage chosen models
   from `assets/raw/synty/staged/`, gltf-transform (prune/quantize/meshopt),
   private-release upload script + CI download step. Deploy must stay green.
2. **Guns** — 4 gun models + throwables mapped into the existing data-driven
   grip-pose system (`weapons.data.ts`); Hybrid_02 gets a wheel slot + stats.
3. **Player** — Hunter_Male_01 replacing the mannequin: retarget the R1 clip
   list (Quaternius UAL clips → Synty humanoid rig) via a bake script;
   verify every R1 handling state against `docs/r1-player-handling.md`
   (S18–S22 CI scenarios must stay green).
4. **Zombies** — 12 meshes × 12 colorways into the SkinnedMesh pool
   (per-instance texture pick at spawn); ZombieIdle/Walk/Run/Bite retarget.
5. **Vehicles** — Bike.glb surgery (spoke extraction — probe scripts
   `scripts/bike-probe.*` already verify the cut), compression, rescale;
   Motorbike_01 fallback prep; Muscle_01 + attachments on the car
   controller. Physics regression suite (23 scenarios) must stay green.
6. **World** — the big one: new town layout from Apocalypse building kit
   (barricaded main street), Synty roads/props/wrecks, nature swap.
   Layout sketch gets a quick user check before the full build.
7. **Verification** — `npm run build` + physics suite + visual QA script,
   then user playtest. R2 closes on playtest sign-off.

## Weapon animation & bike stance status (2026-07-19)

- The real gun-handling clips ARE active: 12 Mixamo rifle/pistol clips
  (built by the merge-anims job from `scripts/mixamo-anims.json` into
  `assets/raw/mixamo/mixamo-anims.glb`, retargeted in the Hunter job) ship
  in the player GLB; `PlayerAvatar.hasGunClips === true` on the live build.
  The old procedural pistol pose and finger curl are the FALLBACK, gated
  behind `!hasGunClips` — they must never run on top of the clips.
- Attachment model (user decision, 2026-07-19): keep the palm-socket +
  palm→palm two-hand framing from round 8; per-weapon grip offsets get
  tuned WITH the user in the Pose Lab (`?dev=1`) and exported into
  `src/config.ts`. The alternative (one fixed grip transform on the hand
  bone) is round 7's rejected look — do not revert to it.
- Bike stance: `BikeController.updateVisuals` fits the rigid model through
  BOTH per-wheel physics-hub deltas (vertical lift + pitch on a stance
  wrapper group). Averaging them into lift-only was the ground-clipping
  bug (user bike measured +20 mm front / −20 mm rear; both bikes now
  0 mm/0 mm at rest, verified via Playwright per CLAUDE.md).

## Notes

- All 30 Synty characters share one skeleton — D1 is swappable later at
  near-zero cost; same for zombie meshes.
- R1 playtest sign-off is still pending and can happen in parallel; R1
  feel-tuning dials land independently of R2 asset swaps.
