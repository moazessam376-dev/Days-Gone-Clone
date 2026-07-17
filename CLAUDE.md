# Days Gone Clone

A Days Gone-inspired third-person open-world zombie shooter that runs in the browser.
Low-poly stylized art, single-player, keyboard+mouse (pointer lock). **Game feel is the
project's #1 priority** — movement, aiming, and combat feedback quality outrank feature count.

Live build: https://moazessam376-dev.github.io/Days-Gone-Clone/
Full plan: see the approved plan in `.claude/` history; V1 milestones M0–M8.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — typecheck (`tsc --noEmit`) + production build to `dist/`
- `npm run fetch-assets` — download + process assets from `assets/manifest.json` (M2+)

## Stack

Vite + TypeScript + Three.js + `@dimforge/rapier3d-compat` (WASM inlined as base64 —
`await RAPIER.init()` needs no asset URL, which keeps GitHub Pages base paths trivial).
No game engine, no ECS library: singleton systems updated in an explicit order, plain
classes for hero objects (player, car), struct-of-arrays for enemies.

## Architecture map

- `src/config.ts` — ALL tuning constants live here, grouped by system, and are bound
  into the lil-gui debug panel. Never hardcode a feel constant elsewhere.
- `src/core/` — `GameLoop` (fixed 60 Hz physics + interpolated render; gameplay logic
  goes in `fixedUpdate`, camera/animation in `render`), `Input` (pointer lock,
  `KeyboardEvent.code`), `DebugPanel` (stats.js + lil-gui), AssetLoader (M2+).
- `src/physics/` — `PhysicsWorld` wraps Rapier: fixed step + prev/curr transform
  capture; `interpolate(alpha)` writes blended transforms to registered Object3Ds.
- `src/rendering/` — `Renderer` (WebGLRenderer, ACES tone mapping, shadow map), dusk
  lighting/fog.
- `src/player/`, `src/weapons/`, `src/enemies/`, `src/vehicles/`, `src/fire/`,
  `src/world/`, `src/fx/`, `src/audio/`, `src/ui/` — per-plan systems (built across
  M1–M8).

### Conventions that must hold

- **Pooling-first**: no per-entity allocations in the hot loop (no `new` in
  fixedUpdate/render paths once systems are warm). Particles, decals, ragdolls,
  SFX sources, physics colliders — all pooled with fixed caps.
- **Enemies are data-oriented**: `EnemyManager` stores state in typed arrays
  (SoA, capacity 512). Rendering is a swappable layer (SkinnedMesh pool in V1,
  vertex-animation-texture instancing for hordes in phase 2) — never let gameplay
  code depend on the rendering representation.
- **Pooled proximity physics**: Rapier only ever sees bodies/colliders near the
  player (~32 enemy capsules, ~40 tree colliders, ≤8 ragdolls, ~9 terrain
  heightfields). Far entities are pure arithmetic.
- **Data-driven weapons**: all weapon stats in `src/weapons/weapons.data.ts`.
- Perf budget: ≤350 draw calls, ≤1.2M tris, <150 active colliders, 60 fps target.

## Assets

- Sources are pinned in `assets/manifest.json` (url, sha256, license, attribution) and
  fetched by `scripts/fetch-assets.mts` into gitignored `assets/raw/`, then processed
  into `public/assets/` which IS committed (keeps CI hermetic — Pages builds never
  hit third-party hosts).
- Only CC0 or CC-BY sources. Every manifest entry must carry a license field;
  `CREDITS.md` is auto-generated from the manifest. Key verified sources:
  Quaternius Character Soldier (player; its in-hand weapon meshes ARE the gun
  models — toggle visibility, never parent into the 100x-scaled skeleton),
  Quaternius animated zombie, Zsky motorbike (all via `static.poly.pizza`),
  Kenney car kit + suburban city kit via kenney.nl zips (CC0; URL hashes rot).
  Kit GLBs reference an external `Textures/colormap.png` — it must ship next
  to them or the models render untextured white.

## Deploy

Push to `main` → `.github/workflows/deploy.yml` builds and deploys to GitHub Pages.
Vite `base` is `/Days-Gone-Clone/`; all runtime asset URLs must go through
`import.meta.env.BASE_URL`. After pushing, verify the Actions run is green and the
live URL boots without console errors or 404s.

## Verification

Every milestone must end runnable: `npm run build` clean, then actually play it —
drive the game in a browser (pointer lock, WASD, shoot), watch the stats.js meter,
and check the console. Milestone-specific checks live in the plan's Verification
section.
