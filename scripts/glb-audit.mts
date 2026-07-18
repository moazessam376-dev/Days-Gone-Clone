/**
 * Audit exported GLBs for the R2 bugfix round:
 *  - world buildings: bbox center offset from origin (mis-centered colliders)
 *  - vehicles: node names + wheel node positions/sizes (steering & clipping)
 *  - weapons: bbox + origin (grip alignment)
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const bounds = getBounds;
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const base = 'public/assets/synty';

const fmt = (v: number[]) => '[' + v.map((n) => n.toFixed(2)).join(', ') + ']';

async function audit(rel: string, opts: { nodes?: boolean } = {}) {
  const doc = await io.read(join(base, rel));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = bounds(scene);
  const c = b.min.map((m, i) => (m + b.max[i]) / 2);
  const size = b.max.map((m, i) => m - b.min[i]);
  console.log(`\n== ${rel}`);
  console.log(`   bbox center ${fmt(c)} size ${fmt(size)}`);
  if (opts.nodes) {
    for (const n of doc.getRoot().listNodes()) {
      const t = n.getTranslation();
      const mesh = n.getMesh();
      let nb = '';
      if (mesh) {
        // rough size from the node's own subtree
        try {
          const bb = bounds(n);
          nb = ` size ${fmt(bb.max.map((m, i) => m - bb.min[i]))} c ${fmt(bb.min.map((m, i) => (m + bb.max[i]) / 2))}`;
        } catch {}
      }
      console.log(`   node "${n.getName()}" t ${fmt([...t])}${mesh ? ' [mesh]' + nb : ''}`);
    }
  }
}

// world buildings the town places
for (const f of readdirSync(join(base, 'world'))) {
  if (f.endsWith('.glb')) await audit(join('world', f));
}
// vehicles with node detail
for (const f of readdirSync(join(base, 'vehicles'))) {
  if (f.endsWith('.glb')) await audit(join('vehicles', f), { nodes: true });
}
// weapons
for (const f of readdirSync(join(base, 'weapons'))) {
  if (f.endsWith('.glb')) await audit(join('weapons', f));
}
