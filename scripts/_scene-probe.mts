import { spawn, type ChildProcess } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';
const BASE = 'http://localhost:4173/Days-Gone-Clone/';
async function main(): Promise<void> {
  let preview: ChildProcess | null = null; let browser: Browser | null = null;
  try {
    preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
    const deadline = Date.now() + 30_000;
    for (;;) { try { if ((await fetch(BASE)).ok) break; } catch {} if (Date.now() > deadline) throw new Error('down'); await new Promise((r) => setTimeout(r, 300)); }
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 400, height: 300 } });
    const page = await browser.newPage();
    page.on('console', (m) => console.log('[' + m.type() + ']', m.text().slice(0, 200)));
    await page.goto(BASE + '?mockinput', { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction('!!window.__game', { timeout: 90_000 });
    const info = await page.evaluate(`(() => {
      const out = [];
      window.__game.scene.traverse(o => {
        if (o.isInstancedMesh) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          out.push({count: o.count, size: [b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z].map(v=>+v.toFixed(1))});
        }
      });
      return out;
    })()`);
    console.log(JSON.stringify(info));
    await page.setViewport({ width: 960, height: 600 });
    await page.evaluate(`(() => {
      const g = window.__game;
      g.enemies.reset(); g.enemyRenderer.reset(); g.enemies.spawn = () => -1;
      g.player.body.setTranslation({x: -8, y: g.world.height(-8, 45) + 1, z: 45}, true);
      g.cameraRig.pitch = 0.12; g.cameraRig.yaw = 2.6;
      g.debugStep(30, true);
    })()`);
    await page.evaluate(`(() => {
      const report = [];
      window.__game.scene.traverse(o => {
        if (o.isInstancedMesh && o.count > 1000) {
          const pos = o.geometry.attributes.position.array;
          const nrm = o.geometry.attributes.normal ? o.geometry.attributes.normal.array : null;
          const uv = o.geometry.attributes.uv ? o.geometry.attributes.uv.array : null;
          const nan = (a) => { if (!a) return 'missing'; let c = 0; for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) c++; return c; };
          const im = o.instanceMatrix.array;
          report.push({ posNaN: nan(pos), nrmNaN: nan(nrm), uvNaN: nan(uv), imNaN: nan(im),
            m0: Array.from(im.slice(12, 15)).map(v=>+v.toFixed(1)) });
          o.visible = false;
        }
      });
      console.log('nanReport:', JSON.stringify(report));
      window.__game.debugStep(2, true);
    })()`);
    const stats = await page.evaluate(`(() => {
      const g = window.__game;
      const r = g.renderer.renderer ?? g.renderer;
      return { calls: r.info ? r.info.render.calls : -1, tris: r.info ? r.info.render.triangles : -1,
               camY: +g.renderer.camera.position.y.toFixed(2), plY: +g.player.root.position.y.toFixed(2) };
    })()`);
    console.log('stats:', JSON.stringify(stats));
    await page.screenshot({ path: process.env.OUT ?? '/tmp/forest.png' });
    console.log('shot taken');
  } finally { await browser?.close(); preview?.kill(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
