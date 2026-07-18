/** Interactive-ish grip tuner: applies pose experiments in-page, captures crops. */
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';
const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const OUT = process.env.OUT_DIR ?? '/tmp';
// Each experiment: name + ads pos + ads rot (applied to ALL weapons).
const EXPERIMENTS: Array<{ name: string; pos: number[]; rot: number[] }> = JSON.parse(process.env.EXPERIMENTS ?? '[]');
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
      g.enemies.reset(); g.enemyRenderer.reset(); g.enemies.spawn = () => -1;
      g.cameraRig.pitch = 0.05;
      document.dispatchEvent(new MouseEvent('mousedown', {button: 2, bubbles: true}));
      g.debugStep(45, true);
    `);
    for (const e of EXPERIMENTS) {
      await page.evaluate(`
        for (const k of ['pistol','rifle','shotgun']) {
          window.__weapons[k].pose.ads = { pos: ${JSON.stringify(e.pos)}, rot: ${JSON.stringify(e.rot)} };
        }
        window.__game.debugStep(5, true);
      `);
      await page.screenshot({ path: `${OUT}/tune-${e.name}.png`, clip: { x: 100, y: 200, width: 500, height: 260 } });
      console.log('captured', e.name);
    }
    await page.close();
  } finally { await browser?.close(); preview?.kill(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
