/**
 * One-off: orthographic side view of Bike.glb in RAW mesh space with a 10cm
 * grid, to locate wheel axles visually. Also supports a wheel-split rotation
 * test: EXPERIMENT env JSON {front:{y,z,r,halfW}, rear:{...}, spinDeg}.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4181;
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
<style>html,body{margin:0;background:#222}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const W=1024,H=768;
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(W,H); document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x222222);
scene.add(new THREE.HemisphereLight(0xffffff,0x445566,1.4));
const sun=new THREE.DirectionalLight(0xffffff,1.6); sun.position.set(5,3,4); scene.add(sun);
const g=await new GLTFLoader().loadAsync('/assets/Game%20Assets/Bike.glb');
let srcMesh=null; g.scene.traverse(o=>{if(o.isMesh)srcMesh=o;});
// Bake node transform → WORLD space: x lateral, y up, z length.
g.scene.updateMatrixWorld(true);
const geo=srcMesh.geometry.clone();
geo.applyMatrix4(srcMesh.matrixWorld);
window.__bounds=(()=>{geo.computeBoundingBox();const b=geo.boundingBox;
  return [b.min.toArray(),b.max.toArray()];})();
// Build weld + adjacency once (position-welded edges).
const _p=geo.attributes.position.array, _idx=geo.index.array;
const _nV=_p.length/3, _nT=_idx.length/3;
const _remap=new Int32Array(_nV);
{const km=new Map();
 for(let v=0;v<_nV;v++){const k=_p[v*3]+','+_p[v*3+1]+','+_p[v*3+2];
   if(km.has(k))_remap[v]=km.get(k); else {km.set(k,v);_remap[v]=v;}}}
const _adj=Array.from({length:_nT},()=>[]);
{const em=new Map();
 for(let t=0;t<_nT;t++)for(let e=0;e<3;e++){
   const a=_remap[_idx[t*3+e]],b=_remap[_idx[t*3+(e+1)%3]];
   const k=a<b?a+"_"+b:b+"_"+a;
   if(em.has(k)){const o=em.get(k);_adj[t].push(o);_adj[o].push(t);}else em.set(k,t);}}
/** Connectivity-grow wheel selection from a tread-annulus seed. */
function growWheel(w){
  const _n=geo.attributes.normal.array;
  const dOf=(v)=>Math.hypot(_p[v*3+1]-w.y,_p[v*3+2]-w.z);
  const inCyl=(t)=>{
    let dAvg=0,dot=0;
    for(let e=0;e<3;e++){const v=_idx[t*3+e];
      const d=dOf(v);
      if(d>w.r||Math.abs(_p[v*3]-w.cx)>w.halfW)return false;
      dAvg+=d/3;
      // radial-outward dot: (y,z)-plane radial dir · vertex normal
      if(d>1e-6)dot+=((_p[v*3+1]-w.y)*_n[v*3+1]+(_p[v*3+2]-w.z)*_n[v*3+2])/d/3;}
    // fender guard: outer-radius tris facing INWARD are fender undersides
    if(w.guardR&&dAvg>w.guardR&&dot<(w.guardDot??0))return false;
    return true;};
  const state=new Int8Array(_nT); const stack=[];
  if(w.sym){
    // Rotational-symmetry mode: within the cylinder, keep only connected
    // components whose triangles cover (nearly) the full circle around the
    // axle — spokes/rim/hub do, fender arcs and fork legs don't.
    for(let t=0;t<_nT;t++) if(inCyl(t)) state[t]=1;
    const comp=new Int32Array(_nT).fill(-1); let nc=0;
    for(let t=0;t<_nT;t++){
      if(state[t]!==1||comp[t]>=0)continue;
      const st=[t]; comp[t]=nc;
      while(st.length){const q=st.pop();
        for(const o of _adj[q]) if(state[o]===1&&comp[o]<0){comp[o]=nc;st.push(o);}}
      nc++;
    }
    const cover=Array.from({length:nc},()=>new Set());
    for(let t=0;t<_nT;t++){
      if(comp[t]<0)continue;
      let cy2=0,cz2=0;
      for(let e=0;e<3;e++){const v=_idx[t*3+e];cy2+=_p[v*3+1]/3;cz2+=_p[v*3+2]/3;}
      cover[comp[t]].add(Math.floor(((Math.atan2(cy2-w.y,cz2-w.z)+Math.PI)/(2*Math.PI))*24)%24);
    }
    const keep=new Set();
    for(let c=0;c<nc;c++) if(cover[c].size>=(w.symBins??22)) keep.add(c);
    const sel=[];for(let t=0;t<_nT;t++)if(comp[t]>=0&&keep.has(comp[t]))sel.push(t);
    return sel;
  }
  for(let t=0;t<_nT;t++){
    if(!inCyl(t))continue; state[t]=1;
    let d=0;for(let e=0;e<3;e++)d+=dOf(_idx[t*3+e])/3;
    if(d>=w.seedLo&&d<=w.seedHi){state[t]=2;stack.push(t);}}
  while(stack.length){const t=stack.pop();
    for(const o of _adj[t])if(state[o]===1){state[o]=2;stack.push(o);}}
  const sel=[];for(let t=0;t<_nT;t++)if(state[t]===2)sel.push(t);
  return sel;
}
window.__setup=(exp)=>{
  const group=new THREE.Group();
  if(!exp){
    group.add(new THREE.Mesh(geo,srcMesh.material));
  } else {
    const selF=new Set(growWheel(exp.front)), selR=new Set(growWheel(exp.rear));
    const wheelTris={front:[],rear:[]}, bodyTris=[];
    for(let t=0;t<_nT;t++){
      const vs=[_idx[t*3],_idx[t*3+1],_idx[t*3+2]];
      if(selF.has(t))wheelTris.front.push(...vs);
      else if(selR.has(t))wheelTris.rear.push(...vs);
      else bodyTris.push(...vs);
    }
    const mk=(tris)=>{const ge=new THREE.BufferGeometry();
      ge.setAttribute('position',geo.attributes.position);
      ge.setAttribute('normal',geo.attributes.normal);
      ge.setAttribute('uv',geo.attributes.uv); ge.setIndex(tris); return ge;};
    group.add(new THREE.Mesh(mk(bodyTris),srcMesh.material));
    for(const k of ['front','rear']){
      const w=exp[k];
      const mat=exp.paint?new THREE.MeshStandardMaterial({color:0xff2222,roughness:0.6}):srcMesh.material;
      const m=new THREE.Mesh(mk(wheelTris[k]),mat);
      const piv=new THREE.Group(); piv.position.set(w.cx,w.y,w.z);
      m.position.set(-w.cx,-w.y,-w.z); piv.add(m);
      piv.rotation.x=((exp.spinDeg||0)*Math.PI)/180; group.add(piv);
      window['__'+k]=wheelTris[k].length/3;
    }
  }
  scene.clear();
  scene.add(new THREE.HemisphereLight(0xffffff,0x445566,1.4));
  const s2=new THREE.DirectionalLight(0xffffff,1.6); s2.position.set(5,3,4); scene.add(s2);
  scene.add(group);
  // grid every 0.1: horizontal = world z (length), vertical = world y (up)
  const lines=[]; const gmat=new THREE.LineBasicMaterial({color:0x00ff88,transparent:true,opacity:0.5});
  for(let y=-0.1;y<=0.701;y+=0.1){lines.push(new THREE.Vector3(-0.35,y,-0.7),new THREE.Vector3(-0.35,y,0.7));}
  for(let z=-0.7;z<=0.701;z+=0.1){lines.push(new THREE.Vector3(-0.35,-0.1,z),new THREE.Vector3(-0.35,0.7,z));}
  const lg=new THREE.BufferGeometry().setFromPoints(lines);
  scene.add(new THREE.LineSegments(lg,gmat));
  // marker circles at experiment axles, if any
  if(exp){for(const k of ['front','rear']){const w=exp[k];const pts=[];
    for(let a=0;a<=64;a++){const t=a/64*Math.PI*2;
      pts.push(new THREE.Vector3(-0.36,w.y+Math.sin(t)*w.r,w.z+Math.cos(t)*w.r));}
    const cg=new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(cg,new THREE.LineBasicMaterial({color:0xff4444})));}}
  // ortho side view: camera on -x axis so +z (length) runs right
  const v=(exp&&exp.view)||{y:0.3,z:0,half:0.75};
  const cam=new THREE.OrthographicCamera(-v.half,v.half,v.half*0.75,-v.half*0.75,0.01,10);
  cam.position.set(-3,v.y,v.z); cam.up.set(0,1,0); cam.lookAt(0,v.y,v.z);
  renderer.render(scene,cam);
};
// Numeric axle finder: tires are the only geometry near the ground. Cluster
// low vertices by z sign, then the tire ring's z-extent gives center+radius.
window.__wheelStats=()=>{
  const out={};
  for(const [k,sgn] of [['front',1],['rear',-1]]){
    let minZ=1e9,maxZ=-1e9,minY=1e9,minX=1e9,maxX=-1e9;
    for(let v=0;v<_nV;v++){
      const x=_p[v*3],y=_p[v*3+1],z=_p[v*3+2];
      if(y>0.08||z*sgn<0.05)continue;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z; if(y<minY)minY=y;
      if(x<minX)minX=x; if(x>maxX)maxX=x;
    }
    // extend z-extent upward: use all verts within that z window below y<0.5
    let R=(maxZ-minZ)/2;
    const cz=(minZ+maxZ)/2;
    out[k]={cx:+((minX+maxX)/2).toFixed(3),z:+cz.toFixed(3),y:+(minY+R).toFixed(3),R:+R.toFixed(3),minY:+minY.toFixed(3)};
  }
  return out;
};
// Robust tire-circle fit: cluster verts by z sign, then iterate {per-angle-bin
// outermost points -> Kasa circle fit -> trim outliers}. The tire outer ring
// dominates the per-bin maxima; frame/exhaust bits get trimmed.
window.__fitWheel=(sgn)=>{
  const pts=[];
  for(let v=0;v<_nV;v++){
    const x=_p[v*3],y=_p[v*3+1],z=_p[v*3+2];
    if(Math.abs(x)>0.12||y>0.55||z*sgn<0.08)continue;
    pts.push([y,z]);
  }
  let cy=pts.reduce((s,p)=>s+p[0],0)/pts.length, cz=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  let R=0.2, ring=[];
  for(let it=0;it<4;it++){
    const bins=new Array(36).fill(null);
    for(const p of pts){
      const dy=p[0]-cy,dz=p[1]-cz,r=Math.hypot(dy,dz);
      if(it>0&&r>R*1.15)continue; // trim outliers after first pass
      const a=Math.floor(((Math.atan2(dy,dz)+Math.PI)/(2*Math.PI))*36)%36;
      if(!bins[a]||r>bins[a][2])bins[a]=[p[0],p[1],r];
    }
    ring=bins.filter(Boolean);
    // Kasa algebraic circle fit on ring points
    let sy=0,sz=0,syy=0,szz=0,syz=0,syr=0,szr=0,sr=0;
    for(const [y,z] of ring){const q=y*y+z*z;sy+=y;sz+=z;syy+=y*y;szz+=z*z;syz+=y*z;syr+=y*q;szr+=z*q;sr+=q;}
    const n=ring.length;
    const A=[[syy-sy*sy/n,syz-sy*sz/n],[syz-sy*sz/n,szz-sz*sz/n]];
    const b=[(syr-sy*sr/n)/2,(szr-sz*sr/n)/2];
    const det=A[0][0]*A[1][1]-A[0][1]*A[1][0];
    cy=(b[0]*A[1][1]-b[1]*A[0][1])/det; cz=(A[0][0]*b[1]-A[1][0]*b[0])/det;
    R=ring.reduce((s,[y,z])=>s+Math.hypot(y-cy,z-cz),0)/n;
  }
  return {y:+cy.toFixed(3),z:+cz.toFixed(3),R:+R.toFixed(3),ringPts:ring.length};
};
// Lateral histogram near an axle: where do spokes/hub actually live in x?
window.__xHist=(cy,cz,rMax)=>{
  const bins={};
  for(let v=0;v<_nV;v++){
    const x=_p[v*3],y=_p[v*3+1],z=_p[v*3+2];
    const r=Math.hypot(y-cy,z-cz);
    if(r>rMax)continue;
    const b=(Math.round(x*100)/100).toFixed(2);
    bins[b]=(bins[b]||0)+1;
  }
  return bins;
};
window.__setup(null);
window.__ready=true;
</script></body></html>`;

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  writeFileSync(join(ROOT, 'scripts/bike-probe.html'), PAGE);
  await page.goto(`http://localhost:${PORT}/scripts/bike-probe.html`, { timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  const exp = process.env.EXPERIMENT ? JSON.parse(process.env.EXPERIMENT) : null;
  console.log('xhist front:', JSON.stringify(await page.evaluate('window.__xHist(0.262,0.313,0.16)'))); console.log('xhist rear:', JSON.stringify(await page.evaluate('window.__xHist(0.218,-0.311,0.15)')));
  if (exp) {
    await page.evaluate((e) => (window as any).__setup(e), exp);
    console.log('front tris:', await page.evaluate('window.__front'), 'rear tris:', await page.evaluate('window.__rear'));
  }
  await page.screenshot({ path: (process.env.OUT ?? '/tmp/bike-probe.png') as `${string}.png` });
  await browser.close();
  server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
