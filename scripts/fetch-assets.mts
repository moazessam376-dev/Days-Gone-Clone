/**
 * Downloads all assets pinned in assets/manifest.json into assets/raw/
 * (gitignored), verifies sha256, copies processed output into public/assets/
 * (committed — keeps CI hermetic), and regenerates CREDITS.md from the
 * manifest's attribution fields.
 *
 * Run: npm run fetch-assets
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface AssetEntry {
  name: string;
  url: string;
  sha256: string;
  dest: string;
  title: string;
  author: string;
  source: string;
  license: string;
  /** Optional: for zip archives, the files to extract as { pathInZip: dest }. */
  extract?: Record<string, string>;
}

const ROOT = new URL('..', import.meta.url).pathname;
const RAW_DIR = join(ROOT, 'assets/raw');
const OUT_DIR = join(ROOT, 'public/assets');

async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(ROOT, 'assets/manifest.json'), 'utf8')) as {
    assets: AssetEntry[];
  };
  await mkdir(RAW_DIR, { recursive: true });

  for (const asset of manifest.assets) {
    const rawPath = join(RAW_DIR, asset.name);

    if ((await exists(rawPath)) && (await sha256Of(rawPath)) === asset.sha256) {
      console.log(`✓ ${asset.name} (cached)`);
    } else {
      console.log(`↓ ${asset.name} ← ${asset.url}`);
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error(`${asset.url}: HTTP ${res.status}`);
      await writeFile(rawPath, Buffer.from(await res.arrayBuffer()));
      const actual = await sha256Of(rawPath);
      if (actual !== asset.sha256) {
        throw new Error(
          `${asset.name}: sha256 mismatch\n  expected ${asset.sha256}\n  actual   ${actual}\n` +
            `The upstream file changed — re-verify its contents and license, then update the manifest.`,
        );
      }
    }

    if (asset.extract) {
      // Zip archive: extract the listed files into the dest directory.
      const outDir = join(OUT_DIR, asset.dest);
      await mkdir(outDir, { recursive: true });
      const { execFileSync } = await import('node:child_process');
      for (const [pathInZip, destName] of Object.entries(asset.extract)) {
        execFileSync('unzip', ['-o', '-j', rawPath, pathInZip, '-d', outDir]);
        const extracted = join(outDir, pathInZip.split('/').pop()!);
        const wanted = join(outDir, destName);
        if (extracted !== wanted) {
          await mkdir(dirname(wanted), { recursive: true });
          await copyFile(extracted, wanted);
        }
      }
    } else {
      const destPath = join(OUT_DIR, asset.dest);
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(rawPath, destPath);
    }
  }

  // CREDITS.md — CC-BY sources require attribution; generate it, don't hand-edit.
  const byLicense = new Map<string, AssetEntry[]>();
  for (const a of manifest.assets) {
    const list = byLicense.get(a.license) ?? [];
    list.push(a);
    byLicense.set(a.license, list);
  }
  let credits = `# Credits\n\nThis game uses the following third-party assets. Thank you to the creators!\n`;
  for (const [license, assets] of byLicense) {
    credits += `\n## ${license}\n\n`;
    const seen = new Set<string>();
    for (const a of assets) {
      const key = `${a.title}|${a.author}`;
      if (seen.has(key)) continue;
      seen.add(key);
      credits += `- **${a.title}** by ${a.author} — ${a.source}\n`;
    }
  }
  // Licensed (non-redistributable) sources — used under their store licenses,
  // never committed to this repo; see docs/r2-asset-round.md.
  credits += `\n## Licensed (not redistributed)\n\n`;
  credits +=
    `- **POLYGON Apocalypse Pack** and **POLYGON City Zombies** by Synty Studios — https://syntystore.com (developer's licensed copies; models ship only in the built game)\n` +
    `- **Bike.glb** — the developer's own model (AI-generated)\n`;
  await writeFile(join(ROOT, 'CREDITS.md'), credits);
  console.log(`✓ CREDITS.md regenerated (${manifest.assets.length} assets)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
