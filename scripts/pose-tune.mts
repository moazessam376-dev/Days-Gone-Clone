/**
 * Grip-pose tuning loop. EXPERIMENTS env: JSON array of
 *   { name, weapon, state: 'ads'|'carry', pos: [x,y,z], rot?: [x,y,z] }
 * Applies each to WEAPONS[weapon].pose[state] live, enters the state, and
 * saves a cropped close-up. Winners get written back to weapons.data.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';

const BASE = 'http://localhost:4173/Days-Gone-Clone/';
const OUT = process.env.OUT_DIR ?? '/tmp/pose-tune';

interface Exp {
  name: string;
  weapon: string;
  state: 'ads' | 'carry';
  pos: [number, number, number];
  rot?: [number, number, number];
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const exps = JSON.parse(process.env.EXPERIMENTS ?? '[]') as Exp[];
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
    await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });
    await page.evaluate(`
      const g = window.__game;
      g.enemies.reset(); g.enemyRenderer.reset(); g.enemies.spawn = () => -1;
      g.cameraRig.pitch = 0.05;
      window.__h = { g,
        mdown: (b) => document.dispatchEvent(new MouseEvent('mousedown', {button: b, bubbles: true})),
        mup: (b) => document.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true})) };
    `);
    for (const e of exps) {
      await page.evaluate(`{
        const {g, mdown, mup} = window.__h;
        const pose = window.__weapons['${e.weapon}'].pose;
        pose['${e.state}'].pos = ${JSON.stringify(e.pos)};
        ${e.rot ? `pose['${e.state}'].rot = ${JSON.stringify(e.rot)};` : ''}
        mup(2);
        g.weapons.switchTo('${e.weapon}'); g.swapT = 0; g.actionLock = 0;
        g.debugStep(3, true);
        ${e.state === 'ads' ? 'mdown(2); g.debugStep(40, true);' : 'g.debugStep(40, true);'}
      }`);
      await page.screenshot({
        path: `${OUT}/${e.name}.png` as `${string}.png`,
        clip: { x: 150, y: 180, width: 560, height: 330 },
      });
      console.log('captured', e.name);
    }
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
