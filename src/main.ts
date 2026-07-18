import RAPIER from '@dimforge/rapier3d-compat';
import { AssetLoader } from './core/AssetLoader';
import { Game } from './Game';

declare const __BUILD_ID__: string;

async function boot(): Promise<void> {
  // Visible build stamp: recordings/screenshots must identify their version
  // (a stale cached bundle once sent a bug hunt in the wrong direction).
  console.info(`Days Gone Clone build ${__BUILD_ID__}`);
  const stamp = document.createElement('div');
  stamp.textContent = __BUILD_ID__;
  stamp.style.cssText =
    'position:fixed;left:6px;bottom:4px;z-index:9;font:10px monospace;' +
    'color:rgba(230,235,245,.4);pointer-events:none;';
  document.body.appendChild(stamp);

  // rapier3d-compat inlines its WASM as base64, so init needs no asset URL —
  // this is what makes the build path-independent for GitHub Pages.
  const assets = new AssetLoader();
  await Promise.all([
    RAPIER.init(),
    assets.loadAll({
      player: 'assets/models/player_base.glb',
      zombie: 'assets/models/zombie.glb',
      sedan: 'assets/models/kit/car/sedan.glb',
      motorbike: 'assets/models/motorbike.glb',
      bldg_a: 'assets/models/kit/suburban/building-type-a.glb',
      bldg_b: 'assets/models/kit/suburban/building-type-b.glb',
      bldg_c: 'assets/models/kit/suburban/building-type-c.glb',
      bldg_e: 'assets/models/kit/suburban/building-type-e.glb',
      bldg_g: 'assets/models/kit/suburban/building-type-g.glb',
      bldg_h: 'assets/models/kit/suburban/building-type-h.glb',
      bldg_k: 'assets/models/kit/suburban/building-type-k.glb',
      bldg_m: 'assets/models/kit/suburban/building-type-m.glb',
      bldg_q: 'assets/models/kit/suburban/building-type-q.glb',
      bldg_s: 'assets/models/kit/suburban/building-type-s.glb',
    }),
  ]);

  const container = document.getElementById('app')!;
  const game = new Game(container, assets);
  document.getElementById('loading')!.classList.add('hidden');
  game.start();
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Failed to start: ${err}`;
});
