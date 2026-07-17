import * as THREE from 'three';
import { FIRE } from '../fire/FireGrid';
import type { FireGrid } from '../fire/FireGrid';

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

/** Procedural radial flame sprite — no texture assets needed. */
function makeFlameTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size * 0.62, 2, size / 2, size * 0.55, size * 0.5);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.25, 'rgba(255,190,80,0.9)');
  grad.addColorStop(0.55, 'rgba(255,110,30,0.55)');
  grad.addColorStop(1, 'rgba(255,60,10,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Makes the FireGrid READ as fire: pooled instanced flame billboards
 * (layered, flickering, additive) over every burning cell near the camera,
 * plus persistent scorch-mark decals where the ground has burned.
 * Two draw calls total regardless of fire size.
 */
export class FireRenderer {
  private flames: THREE.InstancedMesh;
  private scorch: THREE.InstancedMesh;
  private scorchCursor = 0;
  private scorched = new Set<number>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    const flameGeo = new THREE.PlaneGeometry(1, 1.4);
    flameGeo.translate(0, 0.55, 0); // pivot at flame base
    const flameMat = new THREE.MeshBasicMaterial({
      map: makeFlameTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flames = new THREE.InstancedMesh(flameGeo, flameMat, FIRE.flameInstances);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = false;
    scene.add(this.flames);

    const scorchGeo = new THREE.CircleGeometry(0.85, 10);
    scorchGeo.rotateX(-Math.PI / 2);
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x14100c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.scorch = new THREE.InstancedMesh(scorchGeo, scorchMat, FIRE.scorchInstances);
    this.scorch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scorch.frustumCulled = false;
    for (let i = 0; i < FIRE.scorchInstances; i++) this.scorch.setMatrixAt(i, _zero);
    scene.add(this.scorch);
  }

  update(dt: number, fire: FireGrid, camera: THREE.Camera): void {
    this.time += dt;
    let fi = 0;
    const perCell = FIRE.flamesPerCell;

    for (const [key, cell] of fire.cells) {
      // Scorch the ground once per cell — the mark outlives the fire.
      if (!this.scorched.has(key)) {
        this.scorched.add(key);
        if (this.scorched.size > 4096) this.scorched.clear(); // unbounded-set guard
        _pos.set(cell.x + (Math.random() - 0.5) * 0.4, cell.y + 0.03, cell.z + (Math.random() - 0.5) * 0.4);
        _scale.setScalar(0.8 + Math.random() * 0.6);
        _mat.compose(_pos, _quat.identity(), _scale);
        this.scorch.setMatrixAt(this.scorchCursor, _mat);
        this.scorchCursor = (this.scorchCursor + 1) % FIRE.scorchInstances;
        this.scorch.instanceMatrix.needsUpdate = true;
      }

      if (fi >= FIRE.flameInstances - perCell) continue;
      const dx = cell.x - camera.position.x;
      const dz = cell.z - camera.position.z;
      if (dx * dx + dz * dz > 90 * 90) continue;

      // Layered billboards with per-instance phase so the fire shimmers.
      const phase = (key % 97) * 0.7;
      for (let l = 0; l < perCell; l++) {
        const flick = 0.75 + 0.3 * Math.sin(this.time * (11 + l * 4.7) + phase + l * 2.1);
        const grow = Math.min(1, (FIRE.burnMax - cell.burnLeft + 1.2) * 1.2); // young fires start small
        const s = (0.9 + l * 0.45) * flick * grow;
        _pos.set(
          cell.x + Math.sin(phase + l * 2.4) * 0.22,
          cell.y,
          cell.z + Math.cos(phase * 1.3 + l) * 0.22,
        );
        _scale.set(s, s * (1 + 0.12 * Math.sin(this.time * 9 + phase + l)), s);
        _mat.compose(_pos, camera.quaternion, _scale);
        this.flames.setMatrixAt(fi, _mat);
        _color.setHSL(0.06 + 0.03 * Math.sin(phase + l), 1, 0.55 + l * 0.08);
        this.flames.setColorAt(fi, _color);
        fi++;
      }
    }

    // Park unused instances at zero scale.
    for (let i = fi; i < FIRE.flameInstances; i++) this.flames.setMatrixAt(i, _zero);
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
  }
}
