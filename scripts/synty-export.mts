/**
 * Converts Synty FBX sources (assets/raw/synty/staged) into game-ready GLBs
 * under public/assets/synty/ (gitignored — licensed content never enters the
 * public repo; see docs/r2-asset-round.md).
 *
 * Drives scripts/synty-export.html in headless Chromium (FBXLoader +
 * GLTFExporter + SkeletonUtils.retargetClip), then post-processes each GLB
 * with gltf-transform (prune/dedup/quantize).
 *
 * Usage:
 *   npx tsx scripts/synty-export.mts run <jobs.json> [nameFilter]
 *   npx tsx scripts/synty-export.mts inspect <fbxPath>
 *
 * Job entry (see scripts/synty-models.json):
 *   { name, out, fbx, tex?, kind: 'static'|'skinned',
 *     meshes?, rotY?, scale?, groundY?, center?, texSize?,       // static
 *     animGlb?, clips?, boneMap?, targetHeight?, hipName? }      // skinned
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_ROOT = join(ROOT, 'public/assets/synty');
const PORT = 4183;

const DEFAULT_TEX =
  'assets/raw/synty/staged/Assets/PolygonApocalypse/Textures/PolygonApocalypse_Texture_01_A.png';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.tga': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};

interface Job {
  name: string;
  out: string;
  fbx: string;
  kind: 'static' | 'skinned' | 'texture';
  tex?: string;
  // static
  meshes?: string[];
  rotY?: number;
  scale?: number;
  groundY?: boolean;
  center?: boolean;
  texSize?: number;
  // skinned
  animGlb?: string;
  clips?: Array<{ src: string; out: string; fps?: number }>;
  boneMap?: Record<string, string>;
  targetHeight?: number;
  mesh?: string;
  hip?: string;
  srcHip?: string;
  srcYaw?: number;
  method?: 'delta' | 'swing';
  simplify?: number;
  attachments?: Array<{ fbx: string; bone: string }>;
  /** Extra animation sources baked into the same skinned export (their own
   * rig + boneMap, e.g. the CC0 UAL2 library's Unreal-style mannequin). */
  extraAnims?: Array<{
    animGlb: string;
    clips: Array<{ src: string; out: string; fps?: number }>;
    boneMap: Record<string, string>;
    srcHip?: string;
    srcYaw?: number;
    method?: 'delta' | 'swing';
  }>;
}

function serve() {
  return createServer((req, res) => {
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
}

async function optimize(path: string, skinned: boolean, simplifyRatio?: number): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  // Quantization mangles skinned vertex data ranges; keep characters fp32.
  const transforms = skinned ? [dedup(), prune()] : [dedup(), prune()];
  if (simplifyRatio) {
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.01 }));
  }
  if (!skinned) transforms.push(quantize());
  await doc.transform(...transforms);
  await io.write(path, doc);
}

async function main() {
  const [job, ...args] = process.argv.slice(2);
  const server = serve();
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('console:', m.text());
    });
    await page.goto(`http://localhost:${PORT}/scripts/synty-export.html`);
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    const url = (p: string) => `http://localhost:${PORT}/${p}`;

    if (job === 'debug-retarget') {
      // debug-retarget <jobs.json> <jobName> <outDir>
      const jobs = JSON.parse(readFileSync(args[0], 'utf8')) as { models: Job[] };
      const m = jobs.models.find((x) => x.name === args[1]);
      if (!m) throw new Error(`no job ${args[1]}`);
      const outDir = args[2];
      mkdirSync(outDir, { recursive: true });
      const clipNames = (m.clips ?? []).map((c) => c.out);
      // Optional args[3]: comma-separated "clip@time@yaw" shot specs (clip
      // names may come from extraAnims sources too).
      const shots = args[3]
        ? args[3].split(',').map((s) => {
            const [clip, time, yaw] = s.split('@');
            return { clip, time: Number(time ?? 0.5), yaw: Number(yaw ?? 30) };
          })
        : [
            { clip: clipNames[0], time: 0.5, yaw: 30 },
            { clip: clipNames[0], time: 0.5, yaw: 210 },
            { clip: clipNames[Math.min(3, clipNames.length - 1)], time: 0.3, yaw: 90 },
            { clip: clipNames[Math.min(1, clipNames.length - 1)], time: 0.4, yaw: 30 },
          ];
      const r = (await page.evaluate(
        (fbx, t, anim, clips, boneMap, opts, sh) =>
          (window as any).debugRetarget(fbx, t, anim, clips, boneMap, opts, sh),
        url(m.fbx), url(m.tex ?? DEFAULT_TEX), url(m.animGlb!), m.clips ?? [], m.boneMap ?? {},
        { targetHeight: m.targetHeight, texSize: m.texSize, mesh: m.mesh, hip: m.hip, srcHip: m.srcHip, srcYaw: m.srcYaw, method: m.method, attachments: (m.attachments ?? []).map((a) => ({ url: url(a.fbx), bone: a.bone })), extraAnims: (m.extraAnims ?? []).map((e) => ({ ...e, animGlb: url(e.animGlb) })) },
        shots,
      )) as { images: Array<string | null>; warnings: string[]; restAudit?: unknown[] };
      console.log(JSON.stringify(r.restAudit ?? [], null, 0));
      r.images.forEach((img, i) => {
        if (img) writeFileSync(join(outDir, `shot-${i}.jpg`), Buffer.from(img, 'base64'));
      });
      if (r.warnings.length) console.log('warnings:', r.warnings);
      console.log(`wrote ${r.images.filter(Boolean).length} debug shots -> ${outDir}`);
      return;
    }

    if (job === 'merge-anims') {
      // merge-anims <spec.json> — spec: { out, items: [{ file, name }] }
      // Merges single-clip FBXs (Mixamo) into one anim GLB for extraAnims.
      const spec = JSON.parse(readFileSync(args[0], 'utf8')) as {
        out: string;
        items: Array<{ file: string; name: string; start?: number; end?: number }>;
      };
      const r = (await page.evaluate(
        (items) => (window as any).mergeFbxAnims(items),
        spec.items.map((it) => ({ url: url(it.file), name: it.name, start: it.start, end: it.end })),
      )) as { glb: string; bones: string[]; clipNames: string[] };
      const outPath = join(ROOT, spec.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(r.glb, 'base64'));
      console.log(`✓ merged ${r.clipNames.length} clips -> ${spec.out} (${(statSync(outPath).size / 1024).toFixed(0)} KB)`);
      console.log(`  clips: ${JSON.stringify(r.clipNames)}`);
      console.log(`  bones: ${r.bones.length}`);
      return;
    }

    if (job === 'inspect') {
      const tree = await page.evaluate((u) => (window as any).inspect(u), url(args[0]));
      console.log(JSON.stringify(tree, null, 1));
      return;
    }

    if (job !== 'run') throw new Error(`unknown job: ${job}`);
    const jobs = JSON.parse(readFileSync(args[0], 'utf8')) as { models: Job[] };
    const filter = args[1];
    const selected = jobs.models.filter((m) => !filter || m.name.includes(filter));
    if (!selected.length) throw new Error(`no jobs match "${filter}"`);

    for (const m of selected) {
      const outPath = join(OUT_ROOT, m.out);
      mkdirSync(dirname(outPath), { recursive: true });
      const tex = url(m.tex ?? DEFAULT_TEX);
      if (m.kind === 'texture') {
        const b64 = (await page.evaluate(
          (t, size) => (window as any).exportTexture(t, size),
          url(m.tex ?? m.fbx), m.texSize ?? 512,
        )) as string;
        writeFileSync(outPath, Buffer.from(b64, 'base64'));
        console.log(`✓ ${m.name} -> ${m.out} (${(statSync(outPath).size / 1024).toFixed(0)} KB)`);
        continue;
      }
      let result: { glb: string; warnings?: string[] } & Record<string, unknown>;
      if (m.kind === 'skinned') {
        result = await page.evaluate(
          (fbx, t, anim, clips, boneMap, opts) =>
            (window as any).exportSkinned(fbx, t, anim, clips, boneMap, opts),
          url(m.fbx), tex, url(m.animGlb!), m.clips ?? [], m.boneMap ?? {},
          { targetHeight: m.targetHeight, texSize: m.texSize, mesh: m.mesh, hip: m.hip, srcHip: m.srcHip, srcYaw: m.srcYaw, method: m.method, attachments: (m.attachments ?? []).map((a) => ({ url: url(a.fbx), bone: a.bone })), extraAnims: (m.extraAnims ?? []).map((e) => ({ ...e, animGlb: url(e.animGlb) })) },
        );
      } else {
        result = await page.evaluate(
          (fbx, t, opts) => (window as any).exportStatic(fbx, t, opts),
          url(m.fbx), tex,
          {
            meshes: m.meshes, rotY: m.rotY, scale: m.scale, groundY: m.groundY,
            center: m.center, texSize: m.texSize, name: m.name,
          },
        );
      }
      writeFileSync(outPath, Buffer.from(result.glb, 'base64'));
      await optimize(outPath, m.kind === 'skinned', m.simplify);
      const kb = (statSync(outPath).size / 1024).toFixed(0);
      const warn = result.warnings?.length ? `  WARNINGS: ${JSON.stringify(result.warnings)}` : '';
      console.log(`✓ ${m.name} -> ${m.out} (${kb} KB)${warn}`);
      if (m.kind === 'skinned') {
        console.log(`  clips: ${JSON.stringify(result.clipNames)}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
