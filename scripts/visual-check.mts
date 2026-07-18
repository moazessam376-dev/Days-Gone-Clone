/**
 * One-off visual QA screenshots for the R1 handling work (not a CI gate).
 * Boots the built game under headless Chromium with real draws and captures
 * the states that can only be judged by eye: carry pose, ADS frame, weapon
 * wheel, throwable arc, stamina bar. PNGs land in OUT_DIR.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';

const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const OUT_DIR = process.env.OUT_DIR ?? '/tmp';

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
      stdio: 'ignore',
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('vite preview did not start');
      await new Promise((r) => setTimeout(r, 300));
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
      defaultViewport: { width: 960, height: 600 },
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e));
    await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });

    const prelude = `
      const g = window.__game;
      const down = (c) => document.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}));
      const up = (c) => document.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true}));
      const mdown = (b) => document.dispatchEvent(new MouseEvent('mousedown', {button: b, bubbles: true}));
      const mup = (b) => document.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true}));
      const mmove = (dx, dy) => document.dispatchEvent(new MouseEvent('mousemove', {movementX: dx, movementY: dy, bubbles: true}));
      g.enemies.reset(); g.enemyRenderer.reset();
      window.__h = { g, down, up, mdown, mup, mmove };
    `;
    await page.evaluate(prelude);
    const shot = async (name: string, body: string) => {
      await page.evaluate(`(async () => { const {g, down, up, mdown, mup, mmove} = window.__h; ${body} })()`);
      await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
      console.log(`captured ${name}`);
    };

    await shot('1-carry-idle', `g.debugStep(90, true);`);
    await shot('2-ads', `mdown(2); g.debugStep(40, true);`);
    await shot('3-ads-shoulder-left', `down('KeyQ'); g.debugStep(1, true); up('KeyQ'); g.debugStep(30, true);`);
    await shot('4-wheel-open', `
      down('KeyQ'); g.debugStep(1, true); up('KeyQ'); g.debugStep(30, true); // swap shoulder back
      mup(2); g.debugStep(30, true);
      down('Tab'); g.debugStep(6, true); mmove(40, 40); g.debugStep(6, true);
    `);
    await shot('5-throwable-arc', `
      up('Tab'); g.debugStep(6, true);
      g.equipFromWheel('molotov'); g.debugStep(40, true);
      g.cameraRig.pitch = 0.25; mdown(2); g.debugStep(40, true);
    `);
    await shot('6-stamina-bar', `
      mup(2); g.debugStep(20, true);
      down('KeyW'); down('ShiftLeft'); g.debugStep(240, true);
      up('KeyW'); up('ShiftLeft');
    `);
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
