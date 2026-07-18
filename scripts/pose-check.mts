/**
 * Weapon/throwable pose QA across ALL handling states (R2 rig swap check):
 * carry idle/walk/sprint, ADS per gun, swap dip, throwable carry + arc,
 * melee and reload mid-swing. Boots the BUILT game (vite preview) with
 * ?mockinput and steps deterministically; screenshots to OUT_DIR.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const OUT = process.env.OUT_DIR ?? '/tmp/pose-check';

async function shot(page: Page, name: string, code: string): Promise<void> {
  await page.evaluate(`{ const {g, mdown, mup, kdown, kup} = window.__h; ${code} }`);
  await page.screenshot({ path: `${OUT}/${name}.png` as `${string}.png` });
  console.log('captured', name);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let preview: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ }
      if (Date.now() > deadline) throw new Error('preview down');
      await new Promise((r) => setTimeout(r, 300));
    }
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
      defaultViewport: { width: 960, height: 600 },
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });
    await page.evaluate(`
      const g = window.__game;
      g.enemies.reset(); g.enemyRenderer.reset();
      g.enemies.spawn = () => -1; // keep the frame clean
      window.__h = { g,
        mdown: (b) => document.dispatchEvent(new MouseEvent('mousedown', {button: b, bubbles: true})),
        mup: (b) => document.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true})),
        kdown: (c) => document.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true})),
        kup: (c) => document.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true})) };
      g.cameraRig.pitch = 0.05;
    `);

    // -- carry states (pistol) --
    await shot(page, '01-carry-idle', `g.weapons.switchTo('pistol'); g.swapT = 0; g.actionLock = 0; g.debugStep(60, true);`);
    await shot(page, '02-carry-walk', `kdown('KeyW'); g.debugStep(40, true);`);
    await shot(page, '03-carry-sprint', `kdown('ShiftLeft'); g.debugStep(45, true);`);
    await shot(page, '04-sprint-stop', `kup('ShiftLeft'); kup('KeyW'); g.debugStep(30, true);`);

    // -- ADS per gun --
    for (const w of ['pistol', 'rifle', 'shotgun', 'sawnoff']) {
      await shot(page, `05-ads-${w}`, `g.weapons.switchTo('${w}'); g.swapT = 0; g.actionLock = 0; g.debugStep(5, true); mdown(2); g.debugStep(45, true); mup(2); g.debugStep(1, true);`);
    }
    await shot(page, '06-carry-rifle', `g.debugStep(40, true);`);
    await shot(page, '07-carry-shotgun', `g.weapons.switchTo('shotgun'); g.swapT = 0; g.debugStep(60, true);`);

    // -- swap dip (capture mid-swap) --
    await shot(page, '08-swap-dip', `g.weapons.switchTo('pistol'); g.debugStep(12, true);`);
    await shot(page, '09-swap-done', `g.debugStep(40, true);`);

    // -- throwables --
    await shot(page, '10-molotov-carry', `g.equippedThrowable = 'molotov'; g.weaponRig.setActive('molotov'); g.lockHandling ? 0 : 0; g.debugStep(30, true);`);
    await shot(page, '11-molotov-arc', `mdown(2); g.debugStep(35, true);`);
    await shot(page, '12-grenade-carry', `mup(2); g.debugStep(5, true); g.equippedThrowable = 'grenade'; g.weaponRig.setActive('grenade'); g.debugStep(30, true);`);

    // -- melee + reload (mid-anim) --
    await shot(page, '13-melee-mid', `g.equippedThrowable = null; g.weapons.switchTo('pistol'); g.weaponRig.setActive('pistol'); g.swapT = 0; g.actionLock = 0; g.debugStep(20, true); kdown('KeyV'); g.debugStep(8, true); kup('KeyV');`);
    await shot(page, '14-reload-mid', `g.debugStep(60, true); kdown('KeyR'); g.debugStep(2, true); kup('KeyR'); g.debugStep(25, true);`);

    await page.close();
  } finally {
    await browser?.close();
    preview?.kill();
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
