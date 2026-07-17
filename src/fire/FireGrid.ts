import { WORLD, WorldData } from '../world/WorldGen';

export const FIRE = {
  cellSize: 1,
  maxCells: 160,
  spreadInterval: 0.25, // 4 Hz
  spreadChance: 0.14,
  burnMin: 4,
  burnMax: 7,
  enemyBurnTime: 4,
  enemyBurnDps: 20,
  playerBurnDps: 10,
  // Rendering pools (see FireRenderer).
  flameInstances: 96,
  flamesPerCell: 2,
  scorchInstances: 128,
  lightCount: 4,
};

interface FireCell {
  x: number;
  z: number;
  y: number;
  burnLeft: number;
  /** Spread generation — fires stop propagating past MAX_GENERATION. */
  gen: number;
}

const MAX_GENERATION = 6;

/**
 * Sparse fire-spread simulation on a 1m grid. Only burning cells exist —
 * there is never a whole-world array. Spread rolls happen at 4 Hz against
 * orthogonal neighbors weighted by fuel (roads/asphalt don't burn), with a
 * hard cap on simultaneous cells to bound cost.
 */
export class FireGrid {
  readonly cells = new Map<number, FireCell>();
  private accumulator = 0;

  constructor(private world: WorldData) {}

  private key(ix: number, iz: number): number {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  private fuelAt(x: number, z: number): number {
    if (this.world.roadDistance(x, z) < WORLD.roadWidth * 0.8) return 0;
    return 1;
  }

  /** Ignite a disc of cells (molotov impact, explosion). */
  ignite(x: number, z: number, radius: number): void {
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        this.igniteCell(Math.round(x) + dx, Math.round(z) + dz, 0);
      }
    }
  }

  private igniteCell(ix: number, iz: number, gen: number): void {
    if (this.cells.size >= FIRE.maxCells) return;
    const k = this.key(ix, iz);
    if (this.cells.has(k)) return;
    if (this.fuelAt(ix, iz) <= 0) return;
    this.cells.set(k, {
      x: ix,
      z: iz,
      y: this.world.height(ix, iz),
      burnLeft: FIRE.burnMin + Math.random() * (FIRE.burnMax - FIRE.burnMin),
      gen,
    });
  }

  isBurningAt(x: number, z: number, radius = 0.9): boolean {
    const ix = Math.round(x);
    const iz = Math.round(z);
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (this.cells.has(this.key(ix + dx, iz + dz))) return true;
      }
    }
    return false;
  }

  update(dt: number): void {
    this.accumulator += dt;
    if (this.accumulator < FIRE.spreadInterval) return;
    this.accumulator -= FIRE.spreadInterval;

    const toRemove: number[] = [];
    const toSpread: Array<[number, number, number]> = [];
    for (const [k, cell] of this.cells) {
      cell.burnLeft -= FIRE.spreadInterval;
      if (cell.burnLeft <= 0) {
        toRemove.push(k);
        continue;
      }
      // Only mature fires spread.
      if (cell.gen < MAX_GENERATION && cell.burnLeft < FIRE.burnMax - 1 && Math.random() < FIRE.spreadChance) {
        const dir = (Math.random() * 4) | 0;
        const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
        const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
        toSpread.push([cell.x + dx, cell.z + dz, cell.gen + 1]);
      }
    }
    for (const k of toRemove) this.cells.delete(k);
    for (const [ix, iz, gen] of toSpread) this.igniteCell(ix, iz, gen);
  }
}
