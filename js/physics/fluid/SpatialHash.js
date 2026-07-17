/**
 * Uniform-grid spatial hash for O(n) neighbor queries on marker particles.
 */
export class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.buckets = new Map();
  }

  clear() {
    this.buckets.clear();
  }

  _key(ix, iy, iz) {
    return ix + (iy << 10) + (iz << 20);
  }

  _cell(x, y, z) {
    return [
      Math.floor(x * this.invCellSize),
      Math.floor(y * this.invCellSize),
      Math.floor(z * this.invCellSize),
    ];
  }

  insert(index, x, y, z) {
    const [ix, iy, iz] = this._cell(x, y, z);
    const k = this._key(ix, iy, iz);
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = [];
      this.buckets.set(k, bucket);
    }
    bucket.push(index);
  }

  /**
   * Invoke fn(neighborIndex) for all markers within radius of (x,y,z).
   */
  forEachNeighbor(x, y, z, radius, fn) {
    const [cx, cy, cz] = this._cell(x, y, z);
    const cells = Math.ceil(radius * this.invCellSize);
    const r2 = radius * radius;

    for (let dz = -cells; dz <= cells; dz++) {
      for (let dy = -cells; dy <= cells; dy++) {
        for (let dx = -cells; dx <= cells; dx++) {
          const bucket = this.buckets.get(this._key(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const idx of bucket) fn(idx, r2);
        }
      }
    }
  }
}
