/**
 * Flat uniform-grid spatial hash over the play area, rebuilt every fixed tick
 * with a counting sort (no per-tick allocations). Used for enemy separation,
 * melee arcs, and later fire-grid ignition queries.
 */
export class SpatialHash {
  private cellStart: Int32Array;
  private cellCount: Int32Array;
  private indices: Int32Array;
  private cellOf: Int32Array;
  private numCells: number;

  constructor(
    private originX: number,
    private originZ: number,
    private size: number, // world extent covered (square)
    private cellSize: number,
    capacity: number,
  ) {
    this.numCells = Math.ceil(size / cellSize) ** 2;
    this.cellStart = new Int32Array(this.numCells + 1);
    this.cellCount = new Int32Array(this.numCells);
    this.indices = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  private cellIndex(x: number, z: number): number {
    const cols = Math.ceil(this.size / this.cellSize);
    let cx = Math.floor((x - this.originX) / this.cellSize);
    let cz = Math.floor((z - this.originZ) / this.cellSize);
    cx = Math.max(0, Math.min(cols - 1, cx));
    cz = Math.max(0, Math.min(cols - 1, cz));
    return cz * cols + cx;
  }

  /** Rebuild from active entity indices and their positions. */
  rebuild(activeIndices: number[], posX: Float32Array, posZ: Float32Array): void {
    this.cellCount.fill(0);
    for (let k = 0; k < activeIndices.length; k++) {
      const i = activeIndices[k];
      const c = this.cellIndex(posX[i], posZ[i]);
      this.cellOf[k] = c;
      this.cellCount[c]++;
    }
    let acc = 0;
    for (let c = 0; c < this.numCells; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c];
    }
    this.cellStart[this.numCells] = acc;
    const cursor = new Int32Array(this.numCells);
    for (let k = 0; k < activeIndices.length; k++) {
      const c = this.cellOf[k];
      this.indices[this.cellStart[c] + cursor[c]] = activeIndices[k];
      cursor[c]++;
    }
  }

  /** Visit entity indices in cells overlapping the radius around (x, z). */
  query(x: number, z: number, radius: number, visit: (index: number) => void): void {
    const cols = Math.ceil(this.size / this.cellSize);
    const minCx = Math.max(0, Math.floor((x - radius - this.originX) / this.cellSize));
    const maxCx = Math.min(cols - 1, Math.floor((x + radius - this.originX) / this.cellSize));
    const minCz = Math.max(0, Math.floor((z - radius - this.originZ) / this.cellSize));
    const maxCz = Math.min(cols - 1, Math.floor((z + radius - this.originZ) / this.cellSize));
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const c = cz * cols + cx;
        const start = this.cellStart[c];
        const end = start + this.cellCount[c];
        for (let k = start; k < end; k++) visit(this.indices[k]);
      }
    }
  }
}
