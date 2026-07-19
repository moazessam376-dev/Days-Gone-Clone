# Dev Mode — Pose & Grip Lab (phase 1)

An in-game tuning editor, Days Gone Clone's answer to "open the scene in the
engine and fix it". Ships in every build behind a URL flag, so it works on
the live site too.

## Activation

Add `?dev=1` to the URL (combinable with the usual site URL or `npm run dev`).
The game boots normally, plus a **Pose Lab** panel (top-left) and a free
camera. There is no pointer lock in dev mode.

## Controls

- **Orbit camera**: left-drag = orbit, wheel = zoom, middle-drag = pan.
- **WASD / Shift** still move the character (watch locomotion live).
- Gameplay mouse actions come from the panel (Aim toggle, Fire button) so
  the real mouse stays free for the camera and gizmos.
- **T / R**: switch the gizmo between translate and rotate.

## Panel

- **Sim** — pause the simulation, slow time (0.05–1×), freeze enemies.
- **Animation** — pick any player clip, scrub its timeline, play at any
  speed, or return to `(live)` game-driven animation.
- **Pose** — choose the gizmo target (held weapon / back mount), drag it
  into place. Tweaks apply on top of the live animation every frame, persist
  in `localStorage` across refreshes, and can be reset per weapon.
- **State** — equip any weapon or throwable instantly.

## Export / collaboration workflow

1. Equip the weapon, scrub to the frame that looks wrong, orbit in close.
2. Drag/rotate the gun (or back mount) until it reads right.
3. **Export Tuning** — final data values (not raw deltas) are copied to the
   clipboard and printed to the console:
   `{ "weapons": { "rifle": { "grip": [...], "rot": [...] } },
      "HANDLING": { "backOffset": [...], "backRot": [...] } }`
4. Paste the JSON to Claude in chat. Claude bakes it into
   `src/weapons/weapons.data.ts` / `src/config.ts` and deploys; baked values
   make the localStorage tweaks redundant (use Reset to clear them).

The values are computed so that pasting them into the data files reproduces
exactly what the gizmo showed — same math, opposite direction.

## Phase 2 (parked)

Scene inspector: click-select world objects (buildings, vehicles, props),
move them with the same gizmo, export placements back to world config.
