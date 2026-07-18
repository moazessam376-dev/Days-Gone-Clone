/**
 * Physics regression suite — the R0 CI gate.
 *
 * Runs the BUILT game (dist/) under headless Chromium via the ?mockinput
 * harness and asserts the simulation invariants that past playtests broke:
 * nothing launches, vehicles stay drivable, corpses stay grounded, fire
 * lands where thrown. A failure here blocks the GitHub Pages deploy.
 *
 * Rules learned the hard way (keep them):
 * - Drive ONLY via window.__game.debugStep + synthetic document events +
 *   body teleports. No wall-clock waits — everything is deterministic.
 * - Assert on POSITIONS, never velocities: sleeping bodies report stale
 *   linvel values.
 * - Scenarios reset/clear enemies explicitly — a forgotten horde kills the
 *   player mid-scenario and freezes the sim (fixedUpdate early-returns).
 * - Corpses release after ENEMY.corpseTime (4s) — corpse assertions must
 *   finish inside that window.
 * - Driving tests happen in open wilderness (200,200): town roads have a
 *   building corner that legitimately stops the car.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { existsSync } from 'node:fs';

const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const DEFAULT_TIMEOUT_MS = 120_000;

interface Result {
  name: string;
  pass: boolean;
  details: Record<string, unknown>;
}

/** Uncaught page errors during the current scenario (reset per scenario). */
const pageErrors: string[] = [];

type Scenario = {
  name: string;
  run: (page: Page) => Promise<Record<string, unknown>>;
  /** CI SwiftShader is slow — long scenarios declare their own budget. */
  timeoutMs?: number;
};

/** Boilerplate injected into every scenario's page context. `softReset()`
 * replaces page reloads between scenarios: CI SwiftShader intermittently
 * hangs for minutes creating a WebGL context, so we create exactly ONE. */
const HARNESS = `
  const g = window.__game;
  // Step without WebGL draws: CI software rasterization is ~100x slower
  // than the simulation and was timing scenarios out. All gameplay-side
  // render work (interpolation, yaw, camera) still runs.
  if (!g.__rawDebugStep) {
    g.__rawDebugStep = g.debugStep.bind(g);
    g.debugStep = (n) => g.__rawDebugStep(n, false);
  }
  const em = g.enemies;
  const V = Object.getPrototypeOf(g.player.root.position).constructor;
  const down = (c) => document.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}));
  const up = (c) => document.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true}));
  const press = (c) => { down(c); g.debugStep(1); up(c); };
  const mdown = (b) => document.dispatchEvent(new MouseEvent('mousedown', {button: b, bubbles: true}));
  const mup = (b) => document.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true}));
  const mmove = (dx, dy) => document.dispatchEvent(new MouseEvent('mousemove', {movementX: dx, movementY: dy, bubbles: true}));
  /** Equip a throwable via the internal wheel path and wait out the raise. */
  const equipThrowable = (kind) => { g.equipFromWheel(kind); g.debugStep(30); };
  const clearEnemies = () => { em.reset(); g.enemyRenderer.reset(); };
  const terrain = (x, z) => g.world.height(x, z);
  const upY = (body) => { const r = body.rotation(); return 1 - 2 * (r.x * r.x + r.z * r.z); };
  const finite = (...vals) => vals.every(Number.isFinite);
  const softReset = () => {
    for (const code of ['KeyW','KeyA','KeyS','KeyD','ShiftLeft','Space','Tab']) up(code);
    mup(0); mup(2);
    if (g.driving) { press('KeyE'); g.debugStep(2); }
    clearEnemies();
    g.fire.cells.clear();
    for (const p of g.throwables.pool) if (p.active) {
      p.active = false; p.mesh.visible = false;
      p.body.setEnabled(false); p.body.setTranslation({x: 0, y: -400, z: 0}, true);
    }
    g.playerHealth = 100; g.dead = false; g.hud.showDeath(false);
    g.pendingThrow = null; g.actionLock = 0; g.combatFaceT = 0; g.throwTimer = 0;
    g.swapT = 0; g.equippedThrowable = null;
    if (g.wheelOpen) { g.wheelOpen = false; g.wheelUi.close(); }
    g.throwableCounts.grenade = 2; g.throwableCounts.molotov = 2;
    g.player.stamina = 100; g.player.winded = false; g.player.sprintBlockT = 0;
    // Park vehicles at known open-ground spots, upright and still.
    const park = (v, x, z) => {
      v.body.setTranslation({x, y: terrain(x, z) + 1.0, z}, true);
      v.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
      v.body.setLinvel({x: 0, y: 0, z: 0}, true);
      v.body.setAngvel({x: 0, y: 0, z: 0}, true);
    };
    park(g.car, 200, 200);
    park(g.bike, 190, 200);
    g.player.body.setTranslation({x: 205, y: terrain(205, 200) + 1.2, z: 200}, true);
    g.cameraRig.yaw = 0; g.cameraRig.pitch = -0.15;
    g.debugStep(10);
  };
  softReset();
`;

async function boot(page: Page): Promise<void> {
  await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction('!!window.__game', { timeout: 90_000 });
}

/** Evaluate a scenario body (string) with the harness prelude. */
async function run(page: Page, body: string): Promise<Record<string, unknown>> {
  return (await page.evaluate(`(async () => { ${HARNESS} ${body} })()`)) as Record<string, unknown>;
}

const scenarios: Scenario[] = [
  {
    name: 'S0 boot',
    run: async (page) => {
      await run(page, `g.debugStep(60); return {};`);
      return { pass: pageErrors.length === 0, errors: [...pageErrors] };
    },
  },
  {
    name: 'S1 player-vs-car is a wall',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const cp0 = g.car.body.translation();
        g.player.body.setTranslation({x: cp0.x, y: cp0.y + 0.5, z: cp0.z + 4}, true);
        g.cameraRig.yaw = 0; g.debugStep(2);
        down('KeyW');
        for (let f = 0; f < 300; f++) g.debugStep(1);
        up('KeyW');
        const cp1 = g.car.body.translation();
        const pp = g.player.body.translation();
        const disp = Math.hypot(cp1.x - cp0.x, cp1.z - cp0.z);
        const yDrift = Math.abs(cp1.y - cp0.y);
        const dist = Math.hypot(pp.x - cp1.x, pp.z - cp1.z);
        return { pass: disp < 0.5 && yDrift < 0.5 && upY(g.car.body) > 0.95 && dist > 0.9,
                 carDisp: disp, carYDrift: yDrift, carUpY: upY(g.car.body), playerDist: dist };
      `),
  },
  {
    name: 'S2 player-vs-bike is a wall',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const bp0 = g.bike.body.translation();
        g.player.body.setTranslation({x: bp0.x, y: bp0.y + 0.5, z: bp0.z + 4}, true);
        g.cameraRig.yaw = 0; g.debugStep(2);
        down('KeyW');
        for (let f = 0; f < 240; f++) g.debugStep(1);
        up('KeyW');
        const bp1 = g.bike.body.translation();
        const pp = g.player.body.translation();
        const disp = Math.hypot(bp1.x - bp0.x, bp1.z - bp0.z);
        const dist = Math.hypot(pp.x - bp1.x, pp.z - bp1.z);
        return { pass: disp < 0.5 && dist > 0.6, bikeDisp: disp, playerDist: dist };
      `),
  },
  {
    name: 'S3 drive through horde stays planted',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const y = terrain(200, 200) + 1.0;
        g.car.body.setTranslation({x: 200, y, z: 200}, true);
        g.car.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        g.player.body.setTranslation({x: 202, y: y + 0.3, z: 200}, true);
        g.cameraRig.yaw = 0; g.debugStep(20);
        // Horde grid ahead on the drive line (the sedan's nose points +Z, so
        // W drives +Z from its spawn orientation).
        for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) em.spawn(197 + c * 1.2, 208 + r * 1.5);
        press('KeyE'); g.debugStep(2);
        if (!g.driving) return { pass: false, reason: 'failed to board' };
        down('KeyW');
        let maxH = -1, maxAv = 0;
        for (let f = 0; f < 300; f++) {
          g.debugStep(1);
          if (f % 10 === 0) {
            const t = g.car.body.translation();
            const h = t.y - terrain(t.x, t.z);
            if (h > maxH) maxH = h;
            const av = g.car.body.angvel();
            const a = Math.hypot(av.x, av.y, av.z);
            if (a > maxAv) maxAv = a;
          }
        }
        up('KeyW');
        let kills = 0;
        for (const i of em.active) if (em.state[i] === 4) kills++;
        const t = g.car.body.translation();
        press('KeyE'); g.debugStep(2);
        return { pass: maxH < 1.5 && maxAv <= 6.05 && kills >= 1 && upY(g.car.body) > 0.9 && finite(t.x, t.y, t.z),
                 maxHeightOverTerrain: maxH, maxAngvel: maxAv, kills, carUpY: upY(g.car.body) };
      `),
  },
  {
    name: 'S4 roof-flip recovery',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        // Terrain PHYSICS is pooled around the player — the player must be
        // near the car or it falls through the world.
        g.player.body.setTranslation({x: 246, y: terrain(246, 250) + 1.2, z: 250}, true);
        g.debugStep(3);
        const y = terrain(250, 250) + 1.5;
        g.car.body.setTranslation({x: 250, y, z: 250}, true);
        g.car.body.setRotation({x: 1, y: 0, z: 0, w: 0}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        for (let f = 0; f < 240; f++) g.debugStep(1);
        const t = g.car.body.translation();
        return { pass: upY(g.car.body) > 0.9 && Math.abs(t.y - terrain(t.x, t.z)) < 3,
                 carUpY: upY(g.car.body), heightOverTerrain: t.y - terrain(t.x, t.z) };
      `),
  },
  {
    name: 'S5 side-tip recovery',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.player.body.setTranslation({x: 246, y: terrain(246, 250) + 1.2, z: 250}, true);
        g.debugStep(3);
        const y = terrain(250, 250) + 1.3;
        g.car.body.setTranslation({x: 250, y, z: 250}, true);
        g.car.body.setRotation({x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4)}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        for (let f = 0; f < 180; f++) g.debugStep(1);
        return { pass: upY(g.car.body) > 0.9, carUpY: upY(g.car.body) };
      `),
  },
  {
    name: 'S6 shot kill knocks down, not launches',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        // Player far away so the corpse is undisturbed.
        g.player.body.setTranslation({x: 300, y: terrain(300, 300) + 1.2, z: 300}, true);
        g.debugStep(2);
        const i = em.spawn(320, 320);
        g.debugStep(2);
        const kx = em.posX[i], kz = em.posZ[i];
        em.damage(i, 1000, new V(kx, 1, kz), new V(1, 0, 0), false);
        for (let f = 0; f < 200; f++) g.debugStep(1);
        const c = em.corpseTransform(i);
        if (!c) return { pass: false, reason: 'corpse released early' };
        const t = c.body.translation();
        const travel = Math.hypot(t.x - kx, t.z - kz);
        const h = t.y - terrain(t.x, t.z);
        return { pass: travel < 3 && h >= -0.2 && h < 1.2, travel, heightOverTerrain: h };
      `),
  },
  {
    name: 'S7 burn kill crumples in place',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.player.body.setTranslation({x: 300, y: terrain(300, 300) + 1.2, z: 300}, true);
        g.debugStep(2);
        const i = em.spawn(320, 320);
        g.debugStep(2);
        const kx = em.posX[i], kz = em.posZ[i];
        em.damage(i, 1000, new V(kx, 1, kz), new V(0, 1, 0), false);
        for (let f = 0; f < 200; f++) g.debugStep(1);
        const c = em.corpseTransform(i);
        if (!c) return { pass: false, reason: 'corpse released early' };
        const t = c.body.translation();
        const travel = Math.hypot(t.x - kx, t.z - kz);
        return { pass: travel < 1, travel };
      `),
  },
  {
    name: 'S8 drive over corpse: shoved, capped, grounded',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const y = terrain(200, 200) + 1.0;
        g.car.body.setTranslation({x: 200, y, z: 200}, true);
        g.car.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        g.player.body.setTranslation({x: 202, y: y + 0.3, z: 200}, true);
        g.cameraRig.yaw = 0; g.debugStep(20);
        press('KeyE'); g.debugStep(2);
        if (!g.driving) return { pass: false, reason: 'failed to board' };
        // Rolling start so the hit happens well inside the corpse's 4s lifetime.
        down('KeyW');
        for (let f = 0; f < 60; f++) g.debugStep(1);
        const cp = g.car.body.translation();
        const v = g.car.body.linvel();
        const sp = Math.hypot(v.x, v.z);
        if (sp < 1) { up('KeyW'); return { pass: false, reason: 'car not moving', speed: sp }; }
        const hx = v.x / sp, hz = v.z / sp;
        const kx = cp.x + hx * 10, kz = cp.z + hz * 10;
        const i = em.spawn(kx, kz);
        em.damage(i, 1000, new V(kx, 1, kz), new V(0, 1, 0), false);
        g.debugStep(3);
        const c0 = em.corpseTransform(i).body.translation();
        let maxS = 0;
        for (let f = 0; f < 150; f++) {
          g.debugStep(1);
          const c = em.corpseTransform(i);
          if (!c) break;
          const cv = c.body.linvel();
          const s = Math.hypot(cv.x, cv.y, cv.z);
          if (s > maxS) maxS = s;
        }
        up('KeyW');
        const c = em.corpseTransform(i);
        press('KeyE'); g.debugStep(2);
        if (!c) return { pass: false, reason: 'corpse released early' };
        const t = c.body.translation();
        const disp = Math.hypot(t.x - c0.x, t.z - c0.z);
        const h = t.y - terrain(t.x, t.z);
        return { pass: disp >= 0.3 && maxS <= 18 && h < 2, corpseDisp: disp, maxCorpseSpeed: maxS, heightOverTerrain: h };
      `),
  },
  {
    name: 'S9 molotov breaks on the ground and ignites',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.player.body.setTranslation({x: 300, y: terrain(300, 300) + 1.2, z: 300}, true);
        g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.5; g.debugStep(2);
        // A zombie near where the lob lands (-Z arc, roughly 8-14m out).
        const zi = em.spawn(300, 289);
        // R1 flow: equip from the wheel, aim (RMB shows the arc), LMB throws.
        equipThrowable('molotov');
        mdown(2); g.debugStep(3);
        mdown(0); g.debugStep(1); mup(0); mup(2);
        let broke = false;
        for (let f = 0; f < 300 && !broke; f++) {
          g.debugStep(1);
          if (g.fire.cells.size > 0) broke = true;
        }
        if (!broke) return { pass: false, reason: 'no fire after 300 frames' };
        let maxCellDy = 0;
        for (const cell of g.fire.cells.values()) {
          const dy = Math.abs(cell.y - terrain(cell.x, cell.z));
          if (dy > maxCellDy) maxCellDy = dy;
        }
        g.debugStep(30);
        return { pass: maxCellDy < 0.6 && em.burnT[zi] >= 0,
                 cells: g.fire.cells.size, maxCellHeightError: maxCellDy, zombieBurnT: em.burnT[zi] };
      `),
  },
  {
    name: 'S10 grenade kills and leaves sane state',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.player.body.setTranslation({x: 300, y: terrain(300, 300) + 1.2, z: 300}, true);
        g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.2; g.debugStep(2);
        equipThrowable('grenade');
        mdown(2); g.debugStep(3);
        mdown(0); g.debugStep(1); mup(0); mup(2);
        // Wind-up (15f) + almost the whole 2.2s fuse; ring the zombies around
        // the grenade JUST before it detonates (it can roll downhill, and the
        // ring chases the player, so late+tight placement keeps them in blast).
        for (let f = 0; f < 138; f++) g.debugStep(1);
        const gp = g.throwables.pool.find(p => p.active && p.kind === 'grenade');
        if (!gp) return { pass: false, reason: 'no live grenade at frame 138' };
        const gt = gp.body.translation();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          em.spawn(gt.x + Math.cos(a) * 1.5, gt.z + Math.sin(a) * 1.5);
        }
        for (let f = 0; f < 60; f++) g.debugStep(1);
        let kills = 0, sane = true;
        for (const i of em.active) {
          if (em.state[i] === 4) kills++;
          if (!finite(em.posX[i], em.posZ[i], em.yaw[i])) sane = false;
        }
        return { pass: kills >= 1 && sane, kills, sane };
      `),
  },
  {
    name: 'S11 3600-frame soak: time advances, no NaN anywhere',
    timeoutMs: 420_000,
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        for (let k = 0; k < 24; k++) em.spawn(280 + (k % 6) * 2, 280 + Math.floor(k / 6) * 2);
        g.player.body.setTranslation({x: 300, y: terrain(300, 300) + 1.2, z: 300}, true);
        const t0 = g.gameTime;
        for (let f = 0; f < 3600; f++) g.debugStep(1);
        const elapsed = g.gameTime - t0;
        let sane = true;
        for (const i of em.active) {
          if (!finite(em.posX[i], em.posY[i], em.posZ[i], em.velX[i], em.velZ[i], em.yaw[i])) sane = false;
        }
        const pp = g.player.body.translation();
        const ct = g.car.body.translation();
        const bt = g.bike.body.translation();
        sane = sane && finite(pp.x, pp.y, pp.z, ct.x, ct.y, ct.z, bt.x, bt.y, bt.z);
        for (const c of em.corpses) {
          const t = c.body.translation();
          if (!finite(t.x, t.y, t.z)) sane = false;
        }
        // Player may die in the soak — that's fine; time keeps advancing.
        return { pass: Math.abs(elapsed - 60) < 0.1 && sane, elapsed, sane };
      `),
  },
  {
    name: 'S12 exit placement is never blocked',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        // Park beside the hideout wall (hideout at 40,40, halfX 6).
        const px = 48.5, pz = 40;
        const y = terrain(px, pz) + 1.0;
        g.car.body.setTranslation({x: px, y, z: pz}, true);
        g.car.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        g.player.body.setTranslation({x: px + 2, y: y + 0.3, z: pz}, true);
        g.debugStep(10);
        press('KeyE'); g.debugStep(2);
        if (!g.driving) return { pass: false, reason: 'failed to board' };
        press('KeyE'); g.debugStep(2);
        const pp = g.player.body.translation();
        const dist = Math.hypot(pp.x - px, pp.z - pz);
        const yOk = Math.abs(pp.y - (terrain(pp.x, pp.z) + 1.2)) < 0.6;
        // Access the block fields through the game's own debug surface:
        const blocked = !!(g.enemyBlockAt(pp.x, pp.z) ?? g.vehicleBlockAt(pp.x, pp.z));
        return { pass: !g.driving && !blocked && dist > 1.0 && yOk, blocked, dist, y: pp.y };
      `),
  },
  {
    name: 'S14 boarding from standstill never launches',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const results = [];
        for (const veh of [g.car, g.bike]) {
          const cp0 = veh.body.translation();
          g.player.body.setTranslation({x: cp0.x + 2.2, y: cp0.y + 0.3, z: cp0.z}, true);
          g.debugStep(10);
          press('KeyE'); g.debugStep(2);
          const boarded = g.driving && g.activeVehicle === veh;
          let maxH = -1, maxCamY = -1;
          for (let f = 0; f < 120; f++) {
            g.debugStep(1);
            const t = veh.body.translation();
            const h = t.y - terrain(t.x, t.z);
            if (h > maxH) maxH = h;
            if (g.renderer.camera.position.y > maxCamY) maxCamY = g.renderer.camera.position.y;
          }
          const t1 = veh.body.translation();
          const camAbove = maxCamY - terrain(t1.x, t1.z);
          press('KeyE'); g.debugStep(5);
          results.push({boarded, maxHeightOverTerrain: +maxH.toFixed(2), camAboveTerrain: +camAbove.toFixed(1)});
        }
        const pass = results.every(r => r.boarded && r.maxHeightOverTerrain < 1.5 && r.camAboveTerrain < 10);
        return { pass, results };
      `),
  },
  {
    name: 'S15 boarding inside a zombie mob stays planted',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        // The playtest launcher: a mob crowded against the parked car when
        // you board and drive — run-over corpses must not eject the chassis.
        const cp = g.car.body.translation();
        g.player.body.setTranslation({x: cp.x + 2.2, y: cp.y + 0.3, z: cp.z}, true);
        g.debugStep(2);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          em.spawn(cp.x + Math.cos(a) * 3.2, cp.z + Math.sin(a) * 3.2);
        }
        for (let f = 0; f < 120; f++) { g.playerHealth = 100; g.debugStep(1); } // crowd in
        press('KeyE'); g.debugStep(2);
        if (!g.driving) return { pass: false, reason: 'failed to board' };
        down('KeyW');
        let maxH = -1, minUp = 1;
        for (let f = 0; f < 300; f++) {
          g.playerHealth = 100;
          g.debugStep(1);
          const t = g.car.body.translation();
          const h = t.y - terrain(t.x, t.z);
          if (h > maxH) maxH = h;
          const u = upY(g.car.body);
          if (u < minUp) minUp = u;
        }
        up('KeyW');
        press('KeyE'); g.debugStep(2);
        // Kill coverage lives in S3 — this scenario asserts launch-safety only.
        return { pass: maxH < 1.6 && minUp > 0.85,
                 maxHeightOverTerrain: maxH, minUpY: minUp };
      `),
  },
  {
    name: 'S16 bike ramming the car launches neither',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        // Car parked ahead on the bike's drive line (bike nose +Z from reset).
        const bp = g.bike.body.translation();
        g.car.body.setTranslation({x: bp.x, y: terrain(bp.x, bp.z + 25) + 1.0, z: bp.z + 25}, true);
        g.car.body.setRotation({x: 0, y: Math.sin(Math.PI/4), z: 0, w: Math.cos(Math.PI/4)}, true);
        g.car.body.setLinvel({x: 0, y: 0, z: 0}, true); g.car.body.setAngvel({x: 0, y: 0, z: 0}, true);
        g.player.body.setTranslation({x: bp.x + 1.5, y: bp.y + 0.3, z: bp.z}, true);
        g.debugStep(10);
        press('KeyE'); g.debugStep(2);
        if (!(g.driving && g.activeVehicle === g.bike)) return { pass: false, reason: 'failed to board bike' };
        down('KeyW');
        let maxBikeH = -1, maxCarH = -1;
        for (let f = 0; f < 360; f++) {
          g.debugStep(1);
          const bt = g.bike.body.translation();
          const ct = g.car.body.translation();
          const bh = bt.y - terrain(bt.x, bt.z);
          const ch = ct.y - terrain(ct.x, ct.z);
          if (bh > maxBikeH) maxBikeH = bh;
          if (ch > maxCarH) maxCarH = ch;
        }
        up('KeyW');
        press('KeyE'); g.debugStep(2);
        return { pass: maxBikeH < 2.5 && maxCarH < 2.5 && upY(g.car.body) > 0.85,
                 maxBikeHeight: maxBikeH, maxCarHeight: maxCarH, carUpY: upY(g.car.body) };
      `),
  },
  {
    name: 'S17 vehicles have a top speed and stay grounded at it',
    timeoutMs: 180_000,
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const results = [];
        for (const [veh, cap] of [[g.car, 22], [g.bike, 24]]) {
          // Fresh park facing +Z on open ground; player boards and floors it 15s.
          veh.body.setTranslation({x: 200, y: terrain(200, 200) + 1.0, z: 200}, true);
          veh.body.setRotation({x: 0, y: 0, z: 0, w: 1}, true);
          veh.body.setLinvel({x: 0, y: 0, z: 0}, true); veh.body.setAngvel({x: 0, y: 0, z: 0}, true);
          g.player.body.setTranslation({x: 202, y: terrain(202, 200) + 1.3, z: 200}, true);
          g.debugStep(10);
          press('KeyE'); g.debugStep(2);
          if (!g.driving) { results.push({boarded: false}); continue; }
          down('KeyW');
          let maxSpeed = 0, maxH = -1;
          for (let f = 0; f < 900; f++) {
            g.debugStep(1);
            const v = veh.body.linvel();
            const s = Math.hypot(v.x, v.z);
            if (s > maxSpeed) maxSpeed = s;
            const t = veh.body.translation();
            const h = t.y - terrain(t.x, t.z);
            if (h > maxH) maxH = h;
          }
          up('KeyW');
          press('KeyE'); g.debugStep(2);
          results.push({boarded: true, maxSpeed: +maxSpeed.toFixed(1), maxHeight: +maxH.toFixed(2), cap});
        }
        const pass = results.every(r => r.boarded && r.maxSpeed <= r.cap * 1.2 && r.maxHeight < 2.5);
        return { pass, results };
      `),
  },
  {
    name: 'S13 zombies path around a parked car',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        const cp = g.car.body.translation();
        g.player.body.setTranslation({x: cp.x, y: cp.y + 0.5, z: cp.z - 8}, true);
        g.debugStep(2);
        for (let k = 0; k < 8; k++) em.spawn(cp.x - 3.5 + k, cp.z + 10);
        let violations = 0;
        for (let f = 0; f < 900; f++) {
          g.playerHealth = 100; // scenario measures pathing, not survival
          g.debugStep(1);
          if (f % 30 === 0) {
            for (const i of em.active) {
              if (em.state[i] === 4) continue;
              const dx = em.posX[i] - cp.x, dz = em.posZ[i] - cp.z;
              if (Math.abs(dx) < g.car.halfExtents.hw - 0.1 && Math.abs(dz) < g.car.halfExtents.hd - 0.1) violations++;
            }
          }
        }
        const pp = g.player.root.position;
        let near = 0;
        for (const i of em.active) {
          if (em.state[i] === 4) continue;
          if (Math.hypot(em.posX[i] - pp.x, em.posZ[i] - pp.z) < 2.5 || em.state[i] === 2) near++;
        }
        return { pass: violations === 0 && near >= 4, violations, reachedPlayer: near };
      `),
  },
  {
    name: 'S18 sprinting blocks fire',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.weapons.switchTo('pistol'); g.swapT = 0; g.actionLock = 0; g.debugStep(2);
        const ammo0 = g.weapons.magAmmo;
        down('KeyW'); down('ShiftLeft'); g.debugStep(10);
        const sprinting = g.player.sprinting;
        let sawSprint = false;
        for (let f = 0; f < 120; f++) {
          if (f % 10 === 0) mdown(0);
          if (f % 10 === 5) mup(0);
          g.debugStep(1);
          if (g.player.sprinting) sawSprint = true;
        }
        up('KeyW'); up('ShiftLeft'); mup(0); g.debugStep(5);
        return { pass: sprinting && sawSprint && g.weapons.magAmmo === ammo0,
                 wasSprinting: sprinting, ammoBefore: ammo0, ammoAfter: g.weapons.magAmmo };
      `),
  },
  {
    name: 'S19 aim-to-shoot: LMB alone never fires, RMB+LMB does',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.weapons.switchTo('pistol'); g.swapT = 0; g.actionLock = 0; g.debugStep(2);
        const ammo0 = g.weapons.magAmmo;
        for (let k = 0; k < 6; k++) { mdown(0); g.debugStep(2); mup(0); g.debugStep(8); }
        const afterUnaimed = g.weapons.magAmmo;
        mdown(2); g.debugStep(20); // ADS raise
        mdown(0); g.debugStep(2); mup(0); g.debugStep(5); mup(2);
        const afterAimed = g.weapons.magAmmo;
        return { pass: afterUnaimed === ammo0 && afterAimed === ammo0 - 1,
                 ammo0, afterUnaimed, afterAimed };
      `),
  },
  {
    name: 'S20 stamina: sprint winds, regen recovers, winded roll denied',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.player.stamina = 100; g.player.winded = false;
        down('KeyW'); down('ShiftLeft');
        // 12/s drain empties the bar at ~8.3s (frame ~500). Assert winded at
        // 9s, BEFORE regen (starts 1s after the last drain) can clear it.
        let lateSpeedSum = 0, lateSamples = 0;
        for (let f = 0; f < 540; f++) {
          g.debugStep(1);
          if (f >= 510) { lateSpeedSum += g.player.speed; lateSamples++; }
        }
        const winded = g.player.winded;
        const lateSpeed = lateSpeedSum / lateSamples; // sprint locked -> jog pace
        // Roll denied while winded (Space is dropped, not buffered).
        press('Space'); g.debugStep(2);
        const rolledWhileWinded = g.player.isRolling;
        up('KeyW'); up('ShiftLeft');
        for (let f = 0; f < 300; f++) g.debugStep(1); // 5s quiet: 1s delay + 4s regen
        const recovered = g.player.stamina;
        return { pass: winded && lateSpeed < 5.2 && !rolledWhileWinded && recovered >= 25 && !g.player.winded,
                 winded, lateSpeed: +lateSpeed.toFixed(2), rolledWhileWinded,
                 recovered: +recovered.toFixed(0), stillWinded: g.player.winded };
      `),
  },
  {
    name: 'S21 weapon wheel: slow-mo while held, release equips selection',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.weapons.switchTo('pistol'); g.swapT = 0; g.actionLock = 0; g.debugStep(2);
        down('Tab'); g.debugStep(3);
        const openTs = g.loop.timeScale;
        const wasOpen = g.wheelOpen;
        mmove(0, 60); g.debugStep(2); // straight down = sector 3 = molotov
        const sel = g.wheelSel;
        up('Tab'); g.debugStep(3);
        const closedTs = g.loop.timeScale;
        return { pass: wasOpen && Math.abs(openTs - 0.2) < 0.011 && sel === 3 &&
                       g.equippedThrowable === 'molotov' && Math.abs(closedTs - 1) < 0.011,
                 wasOpen, openTs, sel, equipped: g.equippedThrowable, closedTs };
      `),
  },
  {
    name: 'S22 throw flow: arc-aim only, one throw, gun re-equips',
    run: (page) =>
      run(page, `
        g.debugStep(5); clearEnemies();
        g.weapons.switchTo('pistol'); g.swapT = 0; g.actionLock = 0;
        g.throwableCounts.molotov = 2; g.debugStep(2);
        equipThrowable('molotov');
        // LMB without RMB: nothing leaves the hand.
        mdown(0); g.debugStep(2); mup(0); g.debugStep(15);
        const liveAfterUnaimed = g.throwables.pool.filter(p => p.active).length;
        const countAfterUnaimed = g.throwableCounts.molotov;
        // RMB (arc) + LMB: the throw commits after the wind-up.
        mdown(2); g.debugStep(5);
        mdown(0); g.debugStep(2); mup(0);
        g.debugStep(25); // wind-up is 15 frames
        const liveAfterThrow = g.throwables.pool.filter(p => p.active).length;
        const countAfterThrow = g.throwableCounts.molotov;
        g.debugStep(40); // re-equip window (0.5s = 30f)
        const backOnGun = g.equippedThrowable === null;
        mup(2);
        return { pass: liveAfterUnaimed === 0 && countAfterUnaimed === 2 &&
                       liveAfterThrow === 1 && countAfterThrow === 1 && backOnGun,
                 liveAfterUnaimed, countAfterUnaimed, liveAfterThrow, countAfterThrow, backOnGun };
      `),
  },
];

async function main(): Promise<void> {
  if (!existsSync('dist/index.html')) {
    console.error('dist/index.html missing — run `npm run build` first.');
    process.exit(1);
  }

  let preview: ChildProcess | null = null;
  let browser: Browser | null = null;
  const results: Result[] = [];

  try {
    preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
      stdio: 'ignore',
      detached: false,
    });
    // Poll until the server responds.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch(BASE);
        if (res.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('vite preview did not start');
      await new Promise((r) => setTimeout(r, 300));
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
      defaultViewport: { width: 320, height: 240 },
    });

    // ONE page reused for all scenarios (reload isolates state): repeated
    // fresh pages make SwiftShader WebGL context creation intermittently
    // hang for minutes on CI runners.
    const page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // Boot exactly once — scenarios isolate via softReset() in the harness.
    await boot(page);

    for (const s of scenarios) {
      try {
        const details = await Promise.race([
          s.run(page),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('scenario timeout')), s.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          ),
        ]);
        const pass = details.pass === true;
        results.push({ name: s.name, pass, details });
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${s.name}  ${JSON.stringify(details)}`);
      } catch (e) {
        results.push({ name: s.name, pass: false, details: { error: String(e) } });
        console.log(`FAIL  ${s.name}  ${String(e)}`);
      } finally {
        // Cleared at the END so boot-time errors are still visible to S0.
        pageErrors.length = 0;
      }
    }
    await page.close();
  } finally {
    await browser?.close();
    preview?.kill();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  if (failed.length > 0) {
    console.error('FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  // Explicit exit: the pending watchdog setTimeouts would otherwise keep the
  // process alive for minutes after the last scenario.
  process.exit(0);
}

await main();
