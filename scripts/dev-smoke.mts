/** Smoke test: ?dev=1 boots, panel exists, scrub + tweak + export work. */
import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';
const BASE = 'http://localhost:4173/Days-Gone-Clone/';
async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    const deadline = Date.now() + 30_000;
    for (;;) { try { if ((await fetch(BASE)).ok) break; } catch {} if (Date.now() > deadline) throw new Error('down'); await new Promise(r => setTimeout(r, 300)); }
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1200, height: 700 } });
    const page = await browser.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '?dev=1', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 3000)); // let a few frames run
    const dbg = await page.evaluate(`(() => {
      const g = window.__game;
      const cam = g.renderer.camera;
      return JSON.stringify({ cam: cam.position.toArray().map(v=>+v.toFixed(2)),
        player: g.player.root.position.toArray().map(v=>+v.toFixed(2)),
        avatarVisible: g.avatar.object.visible,
        terrainH: g.world.height(cam.position.x, cam.position.z) });
    })()`);
    console.log('dbg:', dbg);

    const out = await page.evaluate(`(() => {
      const g = window.__game;
      const dev = g.dev;
      const rig = g.weaponRig;
      // equip rifle + scrub a clip + inject a tweak programmatically
      g.devEquip('rifle');
      g.avatar.devOverride = { clip: 'Rig|Rifle_Idle', time: 1.0 };
      const V = g.player.root.position.constructor;
      const Q = rig.lastBaseQ.constructor;
      rig.devTweaks.set('rifle', { pos: new V(0.01, 0.02, -0.03), quat: new Q(0, 0, 0, 1) });
      return JSON.stringify({
        hasDev: !!dev, panels: document.querySelectorAll('.lil-gui').length,
        clips: g.avatar.clipList.length,
        devUnlocked: g.input.devUnlocked, locked: g.input.locked,
        overlayHidden: document.getElementById('click-to-play')?.classList.contains('hidden'),
      });
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const shot = '/tmp/dev-smoke.png';
    await page.screenshot({ path: shot });
    // export path: call private via evaluate
    const exp = await page.evaluate(`(() => {
      const g = window.__game;
      g.dev.exportTuning();
      return 'ok';
    })()`).catch((e: Error) => 'export-err: ' + e.message);
    console.log(out);
    console.log('export:', exp);
    console.log('pageerrors:', JSON.stringify(errs.slice(0, 5)));
    await page.close();
  } finally { await browser?.close(); preview?.kill(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
