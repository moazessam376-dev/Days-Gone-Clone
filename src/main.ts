import RAPIER from '@dimforge/rapier3d-compat';
import { AssetLoader } from './core/AssetLoader';
import { Game } from './Game';

async function boot(): Promise<void> {
  // rapier3d-compat inlines its WASM as base64, so init needs no asset URL —
  // this is what makes the build path-independent for GitHub Pages.
  const assets = new AssetLoader();
  await Promise.all([
    RAPIER.init(),
    assets.loadAll({
      player: 'assets/models/player_base.glb',
      zombie: 'assets/models/zombie.glb',
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
