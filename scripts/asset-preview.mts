/**
 * Renders preview screenshots of Synty pack contents (and the Bike.glb) so
 * asset choices can be made visually. Serves the project root over HTTP,
 * drives scripts/asset-preview.html in headless Chromium.
 *
 * Usage: npx tsx scripts/asset-preview.mts <job> [...args]
 *   list <fbxPath>                 — print mesh names inside an FBX
 *   shoot <manifest.json> <outDir> — render every entry in the manifest
 * Manifest entry: { out, url, tex?, mesh?, yaw?, pitch? }
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4179;

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

async function main() {
  const [job, ...args] = process.argv.slice(2);
  const server = serve();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512 });
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('console:', m.text());
    });
    await page.goto(`http://localhost:${PORT}/scripts/asset-preview.html`);
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });

    if (job === 'list') {
      const names = await page.evaluate(
        (u) => (window as any).loadModel(u, null),
        `http://localhost:${PORT}/${args[0]}`,
      );
      console.log(JSON.stringify(names, null, 1));
    } else if (job === 'shoot') {
      const manifest = JSON.parse(readFileSync(args[0], 'utf8')) as Array<{
        out: string;
        url: string;
        tex?: string;
        mesh?: string;
        yaw?: number;
        pitch?: number;
      }>;
      const outDir = args[1];
      mkdirSync(outDir, { recursive: true });
      let lastUrl = '';
      let lastTex = '';
      const report: Record<string, unknown> = {};
      for (const e of manifest) {
        const url = `http://localhost:${PORT}/${e.url}`;
        const tex = e.tex ? `http://localhost:${PORT}/${e.tex}` : null;
        if (url !== lastUrl) {
          await page.evaluate((u, t) => (window as any).loadModel(u, t), url, tex);
          lastUrl = url;
          lastTex = tex ?? '';
        } else if ((tex ?? '') !== lastTex) {
          await page.evaluate((t) => (window as any).setTexture(t), tex);
          lastTex = tex ?? '';
        }
        await page.evaluate((m) => (window as any).showOnly(m ?? ''), e.mesh ?? '');
        const info = await page.evaluate(
          (y, p) => (window as any).frameAndRender(y, p),
          e.yaw ?? 30,
          e.pitch ?? 12,
        );
        report[e.out] = info;
        await page.screenshot({
          path: join(outDir, `${e.out}.jpg`) as `${string}.jpg`,
          type: 'jpeg',
          quality: 82,
        });
      }
      writeFileSync(join(outDir, '_report.json'), JSON.stringify(report, null, 1));
      console.log(`shot ${manifest.length} previews -> ${outDir}`);
    } else if (job === 'montage-batch') {
      // montage-batch <batch.json>: [{srcDir, outFile, names: [...]}]
      const batch = JSON.parse(readFileSync(args[0], 'utf8'));
      for (const b of batch) {
        await montage(page, b.srcDir, b.outFile, b.names);
      }
      console.log(`montaged ${batch.length} sheets`);
    } else if (job === 'montage') {
      // montage <srcDir> <outFile.jpg> <name1,name2,...> — labeled contact sheet
      const [srcDir, outFile, namesArg] = args;
      await montage(page, srcDir, outFile, namesArg.split(','));
    } else {
      throw new Error(`unknown job: ${job}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function montage(
  page: import('puppeteer').Page,
  srcDir: string,
  outFile: string,
  names: string[],
): Promise<void> {
  const COLS = 6;
      const CELL = 168;
      const LABEL = 16;
      const rows = Math.ceil(names.length / COLS);
      const dataUrl = await page.evaluate(
        async (srcs, cols, cell, label, rowsN) => {
          const cv = document.createElement('canvas');
          cv.width = cols * cell;
          cv.height = rowsN * (cell + label);
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#2e3238';
          ctx.fillRect(0, 0, cv.width, cv.height);
          for (let i = 0; i < srcs.length; i++) {
            const img = new Image();
            img.src = srcs[i].url;
            await new Promise((res) => { img.onload = res; img.onerror = res; });
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * (cell + label);
            ctx.drawImage(img, x, y, cell, cell);
            ctx.fillStyle = '#12151a';
            ctx.fillRect(x, y + cell, cell, label);
            ctx.fillStyle = '#cfd8e3';
            ctx.font = '10px monospace';
            ctx.fillText(srcs[i].name.slice(0, 27), x + 3, y + cell + 11);
          }
          return cv.toDataURL('image/jpeg', 0.78);
        },
        names.map((n) => ({ url: `http://localhost:${PORT}/${srcDir}/${n}.jpg`, name: n })),
        COLS, CELL, LABEL, rows,
      );
  writeFileSync(outFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`montage ${names.length} -> ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
