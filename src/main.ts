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
      player: 'assets/synty/characters/player.glb',
      muscle: 'assets/synty/vehicles/muscle.glb',
      bike: 'assets/synty/vehicles/bike.glb',
      motorbike_synty: 'assets/synty/vehicles/motorbike_synty.glb',
      // Zombie cast (12 civilian meshes; colorway textures loaded below).
      zombie_0: 'assets/synty/zombies/hobo_male_01.glb',
      zombie_1: 'assets/synty/zombies/hoodie_male_01.glb',
      zombie_2: 'assets/synty/zombies/jacket_male_01.glb',
      zombie_3: 'assets/synty/zombies/jacket_female_01.glb',
      zombie_4: 'assets/synty/zombies/coat_female_01.glb',
      zombie_5: 'assets/synty/zombies/punk_male_01.glb',
      zombie_6: 'assets/synty/zombies/roadworker_male_01.glb',
      zombie_7: 'assets/synty/zombies/businessman_male_01.glb',
      zombie_8: 'assets/synty/zombies/shopkeeper_female_01.glb',
      zombie_9: 'assets/synty/zombies/tourist_male_01.glb',
      zombie_10: 'assets/synty/zombies/father_male_01.glb',
      zombie_11: 'assets/synty/zombies/mother_female_01.glb',
      // Synty-derived GLBs (assets/synty is produced by scripts/synty-export
      // locally and downloaded from the release in CI — never committed).
      wep_pistol: 'assets/synty/weapons/revolver.glb',
      wep_rifle: 'assets/synty/weapons/rifle.glb',
      wep_shotgun: 'assets/synty/weapons/shotgun.glb',
      wep_sawnoff: 'assets/synty/weapons/sawnoff.glb',
      wep_grenade: 'assets/synty/weapons/grenade.glb',
      wep_molotov: 'assets/synty/weapons/molotov.glb',
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
    }, Object.fromEntries(
      ['01_a', '01_b', '01_c', '02_a', '02_b', '02_c', '03_a', '03_b', '03_c', '04_a', '04_b', '04_c']
        .map((c, i) => [`zombie_tex_${i}`, `assets/synty/textures/zombie_${c}.png`]),
    )),
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
