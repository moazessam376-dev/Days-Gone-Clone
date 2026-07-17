import * as THREE from 'three';
import { fbm } from './Noise';

/**
 * World layout: 2048×2048m centered on the origin, sampled on a 4m grid
 * (513×513 samples). The final carved heightmap is precomputed at boot:
 * base FBM hills → town basin flattening → road carving. Everything that
 * needs terrain height (chunks, physics, enemies, scatter) reads the same
 * data through `WorldData.height()`.
 */

export const WORLD = {
  size: 2048,
  half: 1024,
  cell: 4,
  samples: 513, // size/cell + 1
  seed: 20260717,
  hillAmp: 46,
  hillFreq: 1 / 420,
  townCenter: new THREE.Vector2(0, 0),
  townRadius: 130,
  townHeight: 6,
  roadWidth: 7,
  roadFalloff: 15,
};

export interface RoadPoint {
  x: number;
  z: number;
  y: number;
  /** Forward direction along the road at this sample. */
  dirX: number;
  dirZ: number;
}

export class WorldData {
  readonly heights: Float32Array;
  /** Distance to nearest road centerline (m), clamped to 40. */
  readonly roadDist: Float32Array;
  readonly roadSamples: RoadPoint[] = [];

  constructor() {
    const n = WORLD.samples;
    this.heights = new Float32Array(n * n);
    this.roadDist = new Float32Array(n * n).fill(40);

    // 1. Base terrain: rolling hills, gentler near the town.
    for (let jz = 0; jz < n; jz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = ix * WORLD.cell - WORLD.half;
        const z = jz * WORLD.cell - WORLD.half;
        this.heights[jz * n + ix] = this.baseHeight(x, z);
      }
    }

    // 2. Roads: sample the splines, splat distance + target height.
    const roadY = new Float32Array(n * n);
    const curves = this.buildRoadCurves();
    for (const curve of curves) {
      const length = curve.getLength();
      const steps = Math.ceil(length / 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        // Road elevation: smoothed base terrain along the line.
        const y = this.smoothedBase(p.x, p.y, 24);
        this.roadSamples.push({ x: p.x, z: p.y, y, dirX: tangent.x, dirZ: tangent.y });
        this.splatRoad(p.x, p.y, y, roadY);
      }
    }

    // 3. Carve roads into the heightmap.
    for (let i = 0; i < this.heights.length; i++) {
      const d = this.roadDist[i];
      if (d < WORLD.roadFalloff) {
        const t = 1 - d / WORLD.roadFalloff;
        const w = t * t * (3 - 2 * t);
        this.heights[i] = THREE.MathUtils.lerp(this.heights[i], roadY[i], Math.min(1, w * 1.15));
      }
    }
  }

  private baseHeight(x: number, z: number): number {
    let h = fbm(x * WORLD.hillFreq, z * WORLD.hillFreq, WORLD.seed) * WORLD.hillAmp;
    // Broad second layer for large-scale variation.
    h += fbm(x * WORLD.hillFreq * 0.23, z * WORLD.hillFreq * 0.23, WORLD.seed + 999) * WORLD.hillAmp * 1.4;
    // Town basin: flatten smoothly toward townHeight.
    const td = Math.hypot(x - WORLD.townCenter.x, z - WORLD.townCenter.y);
    if (td < WORLD.townRadius * 2) {
      const t = THREE.MathUtils.clamp(1 - td / (WORLD.townRadius * 2), 0, 1);
      const w = t * t * (3 - 2 * t);
      h = THREE.MathUtils.lerp(h, WORLD.townHeight, Math.min(1, w * 1.6));
    }
    return h;
  }

  private smoothedBase(x: number, z: number, radius: number): number {
    let sum = 0;
    let count = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        sum += this.baseHeight(x + dx * radius, z + dz * radius);
        count++;
      }
    }
    return sum / count;
  }

  private buildRoadCurves(): THREE.SplineCurve[] {
    // 2D curves stored as Vector2 via CatmullRomCurve3 with y→z mapping is
    // awkward; use SplineCurve (2D) — x maps to world x, y maps to world z.
    const highway = new THREE.SplineCurve([
      new THREE.Vector2(-900, -700),
      new THREE.Vector2(-500, -350),
      new THREE.Vector2(-150, -120),
      new THREE.Vector2(0, 0),
      new THREE.Vector2(180, 150),
      new THREE.Vector2(450, 250),
      new THREE.Vector2(800, 600),
    ]);
    const mainStreet = new THREE.SplineCurve([
      new THREE.Vector2(-120, 60),
      new THREE.Vector2(0, 20),
      new THREE.Vector2(60, -10),
      new THREE.Vector2(150, -60),
      new THREE.Vector2(400, -300),
      new THREE.Vector2(600, -650),
    ]);
    const dirtLoop = new THREE.SplineCurve([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(-200, 180),
      new THREE.Vector2(-450, 400),
      new THREE.Vector2(-650, 550),
    ]);
    return [highway, mainStreet, dirtLoop];
  }

  private splatRoad(px: number, pz: number, y: number, roadY: Float32Array): void {
    const n = WORLD.samples;
    const reach = Math.ceil((WORLD.roadFalloff + 4) / WORLD.cell);
    const ci = Math.round((px + WORLD.half) / WORLD.cell);
    const cj = Math.round((pz + WORLD.half) / WORLD.cell);
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const wx = i * WORLD.cell - WORLD.half;
        const wz = j * WORLD.cell - WORLD.half;
        const d = Math.hypot(wx - px, wz - pz);
        const idx = j * n + i;
        if (d < this.roadDist[idx]) {
          this.roadDist[idx] = d;
          roadY[idx] = y;
        }
      }
    }
  }

  /** Bilinear terrain height at any world position. */
  height(x: number, z: number): number {
    const n = WORLD.samples;
    const fx = THREE.MathUtils.clamp((x + WORLD.half) / WORLD.cell, 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((z + WORLD.half) / WORLD.cell, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.heights[j * n + i];
    const h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i];
    const h11 = this.heights[(j + 1) * n + i + 1];
    return (
      h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
    );
  }

  /** Distance to nearest road centerline (clamped at 40m). */
  roadDistance(x: number, z: number): number {
    const n = WORLD.samples;
    const i = Math.round(THREE.MathUtils.clamp((x + WORLD.half) / WORLD.cell, 0, n - 1));
    const j = Math.round(THREE.MathUtils.clamp((z + WORLD.half) / WORLD.cell, 0, n - 1));
    return this.roadDist[j * n + i];
  }

  /** Approximate slope (rise over 4m run) at a position. */
  slope(x: number, z: number): number {
    const h = this.height(x, z);
    const hx = this.height(x + WORLD.cell, z);
    const hz = this.height(x, z + WORLD.cell);
    return Math.max(Math.abs(hx - h), Math.abs(hz - h)) / WORLD.cell;
  }

  inTown(x: number, z: number): boolean {
    return Math.hypot(x - WORLD.townCenter.x, z - WORLD.townCenter.y) < WORLD.townRadius;
  }
}
