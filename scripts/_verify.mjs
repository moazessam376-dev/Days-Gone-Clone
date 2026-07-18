import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 320, height: 240 } });
const page = await browser.newPage();
await page.goto('http://localhost:4173/Days-Gone-Clone/?mockinput', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('!!window.__game', { timeout: 90000 });
const out = await page.evaluate(async () => {
  const g = window.__game;
  const raw = g.debugStep.bind(g);
  const step = (n) => raw(n, false);
  const down = (c) => document.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}));
  const up = (c) => document.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true}));
  step(5);
  g.enemies.reset(); g.enemyRenderer.reset();
  // Run at the bike from behind (+Z), press E while STILL HOLDING W, keep holding W after.
  const bp = g.bike.body.translation();
  g.player.body.setTranslation({x: bp.x, y: bp.y + 0.5, z: bp.z + 6}, true);
  g.cameraRig.yaw = 0; step(2);
  down('ShiftLeft'); down('KeyW');
  let boardedAt = -1;
  const track = [];
  for (let f = 0; f < 300; f++) {
    step(1);
    const pp = g.player.body.translation();
    const bt = g.bike.body.translation();
    if (boardedAt < 0 && Math.hypot(pp.x - bt.x, pp.z - bt.z) < 3.4) {
      down('KeyE'); step(1); up('KeyE');
      if (g.driving) boardedAt = f;
    }
    if (f % 20 === 0 || (boardedAt >= 0 && f - boardedAt < 6)) {
      const cam = g.renderer.camera.position;
      const v = g.bike.body.linvel();
      track.push({f, bikeY: +bt.y.toFixed(1), bikeVy: +v.y.toFixed(1),
        speed: +Math.hypot(v.x, v.z).toFixed(1),
        camY: +cam.y.toFixed(1), driving: g.driving,
        terrain: +g.world.height(bt.x, bt.z).toFixed(1)});
    }
  }
  up('KeyW'); up('ShiftLeft');
  return { boardedAt, track: track.slice(0, 24) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
