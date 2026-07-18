/** Close-up grip QA: ADS + carry, cropped around the hands. */
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';
const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const OUT = process.env.OUT_DIR ?? '/tmp';
async function main(): Promise<void> {
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
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 960, height: 600 } });
    const page = await browser.newPage();
    await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });
    await page.evaluate(`
      const g = window.__game;
      g.enemies.reset(); g.enemyRenderer.reset();
      g.enemies.spawn = () => -1; // keep the frame clean
      window.__h = { g,
        mdown: (b) => document.dispatchEvent(new MouseEvent('mousedown', {button: b, bubbles: true})),
        mup: (b) => document.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true})) };
    `);
    // Carry closeup: camera close, aimed camera-side view of the model.
    await page.evaluate(`{ const {g} = window.__h; g.cameraRig.pitch = 0.05; g.debugStep(60, true); }`);
    await page.screenshot({ path: OUT + '/grip-carry.png' });
    await page.evaluate(`{ const {g, mdown} = window.__h; mdown(2); g.debugStep(45, true); }`);
    await page.screenshot({ path: OUT + '/grip-ads.png' });
    await page.evaluate(`{ const {g} = window.__h; g.weapons.switchTo('rifle'); g.swapT = 0; g.debugStep(30, true); }`);
    await page.screenshot({ path: OUT + '/grip-ads-rifle.png' });
    await page.close();
  } finally { await browser?.close(); preview?.kill(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
