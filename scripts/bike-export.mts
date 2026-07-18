/**
 * Production export of the user's Bike.glb with spinning wheels:
 * - bakes the node transform, splits spoke/hub geometry per wheel via the
 *   verified connectivity-grow (params from the bike-probe sessions),
 *   re-pivots each wheel about its fitted axle as nodes WheelF / WheelR
 * - downscales the AI-generated 4K textures to 1024 (30 MB -> ~3 MB)
 * - leaves overall scale/orientation raw (BikeController normalizes)
 * Output: public/assets/synty/vehicles/bike.glb  (gitignored like all
 * non-CC0 runtime assets; distributed via the release bundle)
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import puppeteer from 'puppeteer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_PATH = join(ROOT, 'public/assets/synty/vehicles/bike.glb');
const PORT = 4189;

// Verified wheel-split parameters (bike-probe sel11, 2026-07-18).
const WHEELS = {
  front: { cx: 0.01, y: 0.262, z: 0.313, r: 0.17, halfW: 0.02, seedLo: 0.03, seedHi: 0.10, guardR: 0.13 },
  rear: { cx: -0.04, y: 0.218, z: -0.311, r: 0.15, halfW: 0.025, seedLo: 0.03, seedHi: 0.10, guardR: 0.12 },
};

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
};

const server = createServer((req, res) => {
  try {
    const path = join(ROOT, decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!path.startsWith(ROOT) || !statSync(path).isFile()) throw new Error('nope');
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT);

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const g = await new GLTFLoader().loadAsync('/assets/Game%20Assets/Bike.glb');
let srcMesh = null; g.scene.traverse(o => { if (o.isMesh) srcMesh = o; });
g.scene.updateMatrixWorld(true);
const geo = srcMesh.geometry.clone();
geo.applyMatrix4(srcMesh.matrixWorld);

// weld + adjacency (same as bike-probe)
const _p = geo.attributes.position.array, _idx = geo.index.array;
const _nV = _p.length / 3, _nT = _idx.length / 3;
const _remap = new Int32Array(_nV);
{ const km = new Map();
  for (let v = 0; v < _nV; v++) { const k = _p[v*3].toFixed(5)+","+_p[v*3+1].toFixed(5)+","+_p[v*3+2].toFixed(5);
    if (km.has(k)) _remap[v] = km.get(k); else { km.set(k, v); _remap[v] = v; } } }
const _adj = Array.from({ length: _nT }, () => []);
{ const em = new Map();
  for (let t = 0; t < _nT; t++) for (let e = 0; e < 3; e++) {
    const a = _remap[_idx[t*3+e]], b = _remap[_idx[t*3+(e+1)%3]];
    const k = a < b ? a+"_"+b : b+"_"+a;
    if (em.has(k)) { const o = em.get(k); _adj[t].push(o); _adj[o].push(t); } else em.set(k, t); } }

function growWheel(w) {
  const _n = geo.attributes.normal.array;
  const dOf = (v) => Math.hypot(_p[v*3+1]-w.y, _p[v*3+2]-w.z);
  const inCyl = (t) => {
    let dAvg = 0, dot = 0;
    for (let e = 0; e < 3; e++) { const v = _idx[t*3+e];
      const d = dOf(v);
      if (d > w.r || Math.abs(_p[v*3]-w.cx) > w.halfW) return false;
      dAvg += d/3;
      if (d > 1e-6) dot += ((_p[v*3+1]-w.y)*_n[v*3+1]+(_p[v*3+2]-w.z)*_n[v*3+2])/d/3; }
    if (w.guardR && dAvg > w.guardR && dot < 0) return false;
    return true; };
  const state = new Int8Array(_nT); const stack = [];
  for (let t = 0; t < _nT; t++) {
    if (!inCyl(t)) continue; state[t] = 1;
    let d = 0; for (let e = 0; e < 3; e++) d += dOf(_idx[t*3+e])/3;
    if (d >= w.seedLo && d <= w.seedHi) { state[t] = 2; stack.push(t); } }
  while (stack.length) { const t = stack.pop();
    for (const o of _adj[t]) if (state[o] === 1) { state[o] = 2; stack.push(o); } }
  const sel = []; for (let t = 0; t < _nT; t++) if (state[t] === 2) sel.push(t);
  return sel;
}

window.__export = async (wheels) => {
  const selF = new Set(growWheel(wheels.front)), selR = new Set(growWheel(wheels.rear));
  const tris = { front: [], rear: [], body: [] };
  for (let t = 0; t < _nT; t++) {
    const vs = [_idx[t*3], _idx[t*3+1], _idx[t*3+2]];
    if (selF.has(t)) tris.front.push(...vs);
    else if (selR.has(t)) tris.rear.push(...vs);
    else tris.body.push(...vs);
  }
  // Downscale every texture map on the material to 1024.
  const mat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
  for (const slot of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) {
    const tex = mat[slot];
    if (!tex || !tex.image) continue;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    cv.getContext('2d').drawImage(tex.image, 0, 0, 1024, 1024);
    tex.image = cv;
    tex.needsUpdate = true;
  }
  const mk = (list) => { const ge = new THREE.BufferGeometry();
    ge.setAttribute('position', geo.attributes.position);
    ge.setAttribute('normal', geo.attributes.normal);
    ge.setAttribute('uv', geo.attributes.uv); ge.setIndex(list); return ge; };
  const root = new THREE.Group();
  root.name = 'bike';
  const body = new THREE.Mesh(mk(tris.body), mat);
  body.name = 'Body';
  root.add(body);
  for (const [key, name] of [['front', 'WheelF'], ['rear', 'WheelR']]) {
    const w = wheels[key];
    const piv = new THREE.Group();
    piv.name = name;
    piv.position.set(w.cx, w.y, w.z);
    piv.userData.radius = key === 'front' ? 0.258 : 0.231; // fitted tire radii
    const m = new THREE.Mesh(mk(tris[key]), mat);
    m.position.set(-w.cx, -w.y, -w.z);
    piv.add(m);
    root.add(piv);
  }
  const buf = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
window.__ready = true;
</script></body></html>`;

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    writeFileSync(join(ROOT, 'scripts/bike-export.html'), PAGE);
    await page.goto(`http://localhost:${PORT}/scripts/bike-export.html`, { timeout: 60000 });
    await page.waitForFunction('window.__ready === true', { timeout: 120000 });
    const b64 = (await page.evaluate((w) => (window as any).__export(w), WHEELS)) as string;
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, Buffer.from(b64, 'base64'));
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(OUT_PATH);
    await doc.transform(dedup(), prune(), quantize());
    await io.write(OUT_PATH, doc);
    console.log(`✓ bike.glb (${(statSync(OUT_PATH).size / 1048576).toFixed(1)} MB)`);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
