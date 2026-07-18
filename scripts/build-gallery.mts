/**
 * Builds the R2 asset-choice gallery (self-contained HTML, images inlined as
 * data URIs) from assets/raw/synty/previews + montages. Output path via argv.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PREV = `${ROOT}/assets/raw/synty/previews`;
const MONT = `${ROOT}/assets/raw/synty/montages`;
const OUT = process.argv[2];

function b64(path: string): string {
  return `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`;
}
function img(name: string, dir = PREV): string {
  const p = `${dir}/${name}.jpg`;
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return b64(p);
}
function pngB64(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const CHARS = [
  'Biker_Male_01', 'Hunter_Male_01', 'Wanderer_Male_01', 'Criminal_Male_01',
  'Sheriff_Male_01', 'Soldier_Male_01', 'Cool_Male_01', 'Homeless_Male_01',
  'Mechanic_Female_01', 'Scout_Female_01', 'Soldier_Female_01', 'Punk_Female_01',
  'Cool_Female_01', 'Emo_Female_01', 'Teen_Male_01', 'Teen_Female_01',
  'Business_Male_01', 'Press_Male_01', 'RiotCop_Male_01', 'Hazmat_Male_01',
  'Islander_Male_01', 'Eastern_Female_01', 'Nerd_Female_01', 'Waitress_Female_01',
  'Patient_Female_01', 'Nun_Female_01',
];
const SHORTLIST = ['Biker_Male_01', 'Hunter_Male_01', 'Wanderer_Male_01', 'Criminal_Male_01', 'Sheriff_Male_01', 'Mechanic_Female_01'];
const REC = new Set(['Biker_Male_01']);

const ZOMBIES = [
  'Hobo_Male_01', 'Hoodie_Male_01', 'Jacket_Male_01', 'Jacket_Female_01', 'Coat_Female_01',
  'Punk_Male_01', 'Punk_Female_01', 'Biker_Male_01', 'Gangster_Male_01', 'Hipster_Male_01',
  'Hipster_Female_01', 'Roadworker_Male_01', 'Firefighter_Male_01', 'Paramedic_Female_01',
  'Police_Male_01', 'Police_Female_01', 'RiotCop_Male_01', 'Military_Male_01', 'BioHazardSuit_Male_01',
  'Prisinor_Male_01', 'Businessman_Male_01', 'BusinessShirt_Male_01', 'Business_Female_01',
  'ShopKeeper_Male_01', 'ShopKeeper_Female_01', 'FastfoodWorker_Male_01', 'Bellboy_Male_01',
  'Tourist_Male_01', 'SummerGirl_Female_01', 'GamerGirl_Female_01', 'Cheerleader_Female_01',
  'Jock_Male_01', 'Footballer_Male_01', 'SchoolBoy_Male_01', 'SchoolGirl_Female_01',
  'Father_Male_01', 'Father_Male_02', 'Mother_Female_01', 'Mother_Female_02', 'Son_Male_01',
  'Daughter_Female_01', 'Grandpa_Male_01', 'Grandma_Female_01', 'Patient_Female_01',
  'Bride_Female_01', 'Clown_Male_01', 'HotDogSuit_Male_01', 'Diver_Male_01',
  'Underwear_Male_01', 'Underwear_Female_01',
];
const ZREC = new Set(['Hobo_Male_01', 'Hoodie_Male_01', 'Jacket_Male_01', 'Jacket_Female_01', 'Coat_Female_01', 'Punk_Male_01', 'Roadworker_Male_01', 'Businessman_Male_01', 'ShopKeeper_Female_01', 'Tourist_Male_01', 'Father_Male_01', 'Mother_Female_01']);

const COLORWAYS = ['01_A', '01_B', '01_C', '02_A', '02_B', '02_C', '03_A', '03_B', '03_C', '04_A', '04_B', '04_C'];

const PISTOLS = ['Pistol_01', 'Revolver_01', 'Revolver_02'];
const RIFLES = ['AssaultRifle_01', 'AssaultRifle_02', 'AssaultRifle_03', 'Rifle_01', 'Rifle_02', 'Rifle_03', 'HuntingRifle_01', 'SubMGun_01'];
const SHOTGUNS = ['Shotgun_01', 'Hybrid_01', 'Hybrid_02'];
const THROWN = ['Grenade_01', 'Molotov_01'];
const WREC = new Set(['Revolver_01', 'AssaultRifle_01', 'Shotgun_01']);

const BIKES = ['Motorbike_01', 'Motorbike_Apoco_01', 'Moped_01'];
const CARS = ['Muscle_01', 'Ute_01', 'HotRod_01', 'Car_Medium_01', 'Ambulance_01', 'Buggy_01', 'Camper_01', 'NewsVan_01', 'Prison_Bus_01', 'Army_Truck_01', 'BigRig_01', 'IceCream_01', 'GolfCart_01', 'Caravan_01'];

const MONTAGES: Record<string, string[]> = {
  'Buildings (210 pieces — apartment, auto repair, bunker kit, walls, roofs)': ['Bld_01', 'Bld_02', 'Bld_03', 'Bld_04', 'Bld_05'],
  'Environment (243 — roads, terrain, trees, rocks, fences)': ['Env_01', 'Env_02', 'Env_03', 'Env_04', 'Env_05', 'Env_06'],
  'Props (704 — barricades, furniture, wrecks, camp gear, junk)': ['Prop_01', 'Prop_02', 'Prop_03', 'Prop_04', 'Prop_05', 'Prop_06', 'Prop_07', 'Prop_08', 'Prop_09', 'Prop_10', 'Prop_11', 'Prop_12', 'Prop_13', 'Prop_14', 'Prop_15'],
  'Items (94 — pickups: ammo, food, meds, fuel)': ['Item_01', 'Item_02'],
  'Generic (30 — crates, pallets, barrels)': ['Generic_01'],
  'All guns (labeled)': ['Weapons_1', 'Weapons_2'],
  'All vehicles (labeled)': ['Vehicles_1'],
};

const card = (src: string, name: string, rec = false, big = false) => `
  <figure class="card${big ? ' big' : ''}${rec ? ' rec' : ''}">
    <img src="${src}" alt="${name}" loading="lazy" />
    <figcaption>${name}${rec ? '<span class="chip">pick</span>' : ''}</figcaption>
  </figure>`;

const pairCard = (front: string, back: string, name: string, rec = false) => `
  <figure class="card pair${rec ? ' rec' : ''}">
    <div class="pair-imgs"><img src="${front}" alt="${name} front" loading="lazy" /><img src="${back}" alt="${name} back" loading="lazy" /></div>
    <figcaption>${name}${rec ? '<span class="chip">my pick</span>' : ''}</figcaption>
  </figure>`;

const html = `<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>R2 Asset Round — Days Gone Clone</title>
<style>
  :root {
    --ground: #23262b; --panel: #2e3238; --line: #3c424b;
    --ink: #e8e4da; --muted: #9aa1ab; --accent: #d8b53a; --pick: #7fb069;
  }
  html { background: var(--ground); color-scheme: dark; }
  body { margin: 0; font: 16px/1.55 "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink); }
  header.masthead { padding: 48px 24px 20px; max-width: 1120px; margin: 0 auto; }
  .eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { font-size: clamp(28px, 4vw, 40px); margin: 6px 0 10px; font-weight: 700; letter-spacing: -0.01em; text-wrap: balance; }
  .lede { color: var(--muted); max-width: 62ch; margin: 0; }
  .lede strong { color: var(--ink); }
  nav.jump { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--ground) 88%, transparent); backdrop-filter: blur(8px); border-block: 1px solid var(--line); margin-top: 24px; }
  nav.jump ul { display: flex; gap: 2px; list-style: none; margin: 0 auto; padding: 0 16px; max-width: 1120px; overflow-x: auto; }
  nav.jump a { display: block; padding: 10px 12px; font-size: 13px; color: var(--muted); text-decoration: none; white-space: nowrap; }
  nav.jump a:hover, nav.jump a:focus-visible { color: var(--accent); outline: none; }
  main { max-width: 1120px; margin: 0 auto; padding: 0 24px 80px; }
  section { margin-top: 56px; }
  .dnum { font-size: 12px; letter-spacing: 0.18em; color: var(--accent); font-weight: 600; }
  h2 { font-size: 24px; margin: 4px 0 8px; }
  .note { color: var(--muted); max-width: 70ch; margin: 0 0 18px; }
  .note strong { color: var(--ink); }
  .note em { color: var(--accent); font-style: normal; }
  h3 { font-size: 15px; margin: 26px 0 10px; color: var(--ink); text-transform: uppercase; letter-spacing: 0.08em; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  .grid.wide { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
  .grid.pairs { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .card { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; background: var(--panel); }
  .card.pair .pair-imgs { display: grid; grid-template-columns: 1fr 1fr; }
  .card figcaption { padding: 6px 8px; font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; justify-content: space-between; }
  .card.rec { border-color: var(--pick); }
  .chip { font-family: "Avenir Next", sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #1c1f17; background: var(--pick); border-radius: 3px; padding: 1px 6px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; margin: 18px 0; }
  .panel h4 { margin: 0 0 6px; font-size: 15px; }
  .panel p { margin: 6px 0; color: var(--muted); font-size: 14px; }
  .panel p strong { color: var(--ink); }
  .verdict { border-left: 3px solid var(--pick); }
  .bike-hero { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .bike-hero img { width: 100%; border-radius: 6px; border: 1px solid var(--line); }
  details { border: 1px solid var(--line); border-radius: 8px; margin: 10px 0; background: var(--panel); }
  summary { cursor: pointer; padding: 12px 16px; font-weight: 600; font-size: 14px; }
  summary:hover { color: var(--accent); }
  details img { display: block; width: 100%; max-width: 1008px; margin: 0 auto 14px; }
  details .inner { padding: 0 16px 8px; }
  footer { border-top: 1px solid var(--line); margin-top: 64px; padding: 24px; text-align: center; color: var(--muted); font-size: 13px; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>
<header class="masthead">
  <div class="eyebrow">Days Gone Clone — R2 planning</div>
  <h1>Asset round: pick your cast, guns &amp; world kit</h1>
  <p class="lede">Everything below was rendered from <strong>your</strong> Synty packs (POLYGON Apocalypse + City Zombies) and your Bike.glb, using the game's own renderer. Browse here, then <strong>answer the questions in the Claude Code terminal</strong> — this page is just for looking. Green-bordered cards are my recommendations; overrule freely.</p>
</header>
<nav class="jump"><ul>
  <li><a href="#d1">D1 Player</a></li>
  <li><a href="#d2">D2 Zombies</a></li>
  <li><a href="#d3">D3 Guns</a></li>
  <li><a href="#d4">D4 Your bike</a></li>
  <li><a href="#d5">D5 Car</a></li>
  <li><a href="#d6">D6 World kit</a></li>
</ul></nav>
<main>

<section id="d1">
  <div class="dnum">Decision 1</div>
  <h2>Player character</h2>
  <p class="note">You see the <strong>back</strong> of this character for the entire game, so the shortlist shows front + back. All 30 share one skeleton, so the choice doesn't affect animation work. <em>My pick: Biker_Male_01</em> — leather vest, closest to Deacon's silhouette, reads clearly at dusk.</p>
  <h3>Shortlist — front &amp; back</h3>
  <div class="grid pairs">${SHORTLIST.map((c) => pairCard(img(`chr_${c}`), img(`back_${c}`), c, REC.has(c))).join('')}</div>
  <h3>Full roster</h3>
  <div class="grid">${CHARS.filter((c) => !SHORTLIST.includes(c)).map((c) => card(img(`chr_${c}`), c)).join('')}</div>
</section>

<section id="d2">
  <div class="dnum">Decision 2</div>
  <h2>Zombie horde cast</h2>
  <p class="note">51 zombie meshes, and every one can wear any of <strong>12 texture colorways</strong> (bottom strip) — so 8–12 meshes already gives a varied horde. More meshes = more GPU memory per horde, so a curated set beats "all 51". Green cards mark my suggested <em>civilian-apocalypse set of 12</em>; themed picks (police/military/medical) can join for special spawns later.</p>
  <div class="grid">${ZOMBIES.map((z) => card(img(`z_${z}`), z, ZREC.has(z))).join('')}</div>
  <h3>Same mesh, 12 colorways (Hoodie_Male_01)</h3>
  <div class="grid">${COLORWAYS.map((c) => card(img(`zc_${c}`), `Texture_${c}`)).join('')}</div>
</section>

<section id="d3">
  <div class="dnum">Decision 3</div>
  <h2>Gun models — mapping to your three slots</h2>
  <p class="note">The game has pistol / rifle / shotgun slots (stats stay data-driven, unchanged). Pick one model per slot. Molotov + grenade models are also in the pack. Melee models exist for the R4 melee phase.</p>
  <h3>Pistol slot</h3>
  <div class="grid wide">${PISTOLS.map((w) => card(img(`wep_${w}`), w, WREC.has(w))).join('')}</div>
  <h3>Rifle slot</h3>
  <div class="grid wide">${RIFLES.map((w) => card(img(`wep_${w}`), w, WREC.has(w))).join('')}</div>
  <h3>Shotgun slot</h3>
  <div class="grid wide">${SHOTGUNS.map((w) => card(img(`wep_${w}`), w, WREC.has(w))).join('')}</div>
  <h3>Throwables</h3>
  <div class="grid wide">${THROWN.map((w) => card(img(`wep_${w}`), w)).join('')}</div>
</section>

<section id="d4">
  <div class="dnum">Decision 4</div>
  <h2>Your bike — verdict on animated wheels</h2>
  <div class="bike-hero">
    <img src="${img('bike_glb_0')}" alt="Bike.glb three-quarter view" />
    <img src="${img('bike_glb_1')}" alt="Bike.glb rear view" />
    <img src="${img('bike_glb_2')}" alt="Bike.glb side view" />
  </div>
  <div class="panel verdict">
    <h4>Wheel animation: yes — with one honest caveat</h4>
    <p>The model is AI-generated: one single fused mesh (50,000 triangles), wheels welded to fenders and fork, no separate parts, no animations. I probed it tonight: a straight cut tears the fenders off with the wheels.</p>
    <p><strong>What works (verified with rotation tests):</strong> I can extract <strong>spokes + rim + hub</strong> along mesh connectivity and spin those around fitted axle centers. The tire ring stays with the body — and since the tire is featureless dark rubber, a static tire behind spinning spokes is undetectable. Fenders, fork and exhaust stay perfectly intact. A couple of pixel-sized slivers remain at the rim seam; I'll polish those during implementation.</p>
    <p><strong>Also needed:</strong> the file is 30&nbsp;MB (three 4K textures) and about half real-world scale — I'll compress to roughly 3&nbsp;MB and rescale/orient it for the game.</p>
  </div>
  <h3>Synty alternatives from your pack (for comparison)</h3>
  <div class="grid wide">${BIKES.map((v) => card(img(`veh_${v}`), v)).join('')}</div>
</section>

<section id="d5">
  <div class="dnum">Decision 5</div>
  <h2>The car — keep or replace?</h2>
  <p class="note">The current drivable car is the old Kenney sedan. The Apocalypse pack has full vehicles (plus bull-bars, plating and roof-rack attachments to make any of them look survivor-built). Pick a replacement, or keep the sedan for now.</p>
  <div class="grid wide">${CARS.map((v) => card(img(`veh_${v}`), v)).join('')}</div>
</section>

<section id="d6">
  <div class="dnum">Decision 6</div>
  <h2>World kit — what the town gets built from</h2>
  <p class="note">Contact sheets of everything in the pack, grouped by category. This decision is about <strong>scope</strong>: which categories replace the current Kenney town, and roughly how much (a barricaded main street? a bunker interior? camps?). We'll spec exact placement in the R2 design doc.</p>
  ${Object.entries(MONTAGES).map(([title, sheets]) => `
  <details><summary>${title}</summary><div class="inner">${sheets.map((s) => `<img src="${img(s, MONT)}" alt="${title} sheet" loading="lazy" />`).join('')}</div></details>`).join('')}
</section>

</main>
<footer>Rendered ${new Date().toISOString().slice(0, 10)} from your local packs · nothing has been committed or published from the packs themselves · licensed Synty sources stay out of the public repo</footer>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1048576).toFixed(1)} MB)`);
