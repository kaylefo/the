/** Uniform 3D staggered MPM grid (collocated nodes). */
export class Grid3D {
  constructor(nx, ny, nz, origin, dx) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.origin = origin;
    this.dx = dx;
    this.invDx = 1 / dx;
    this.count = nx * ny * nz;

    this.mass = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.vz = new Float32Array(this.count);
    this.fx = new Float32Array(this.count);
    this.fy = new Float32Array(this.count);
    this.fz = new Float32Array(this.count);
    this.damage = new Float32Array(this.count);
    this.psi = new Float32Array(this.count);
    this.active = new Uint8Array(this.count);
  }

  idx(i, j, k) {
    return i + j * this.nx + k * this.nx * this.ny;
  }

  reset() {
    this.mass.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.vz.fill(0);
    this.fx.fill(0);
    this.fy.fill(0);
    this.fz.fill(0);
    this.psi.fill(0);
    this.active.fill(0);
  }

  worldPos(i, j, k, out = new Float32Array(3)) {
    out[0] = this.origin[0] + i * this.dx;
    out[1] = this.origin[1] + j * this.dx;
    out[2] = this.origin[2] + k * this.dx;
    return out;
  }

  nodeFromWorld(x, y, z) {
    const ax = (x - this.origin[0]) * this.invDx;
    const ay = (y - this.origin[1]) * this.invDx;
    const az = (z - this.origin[2]) * this.invDx;
    const bx = Math.floor(ax - 0.5);
    const by = Math.floor(ay - 0.5);
    const bz = Math.floor(az - 0.5);
    // frac is the distance (in cells) from the base node to the particle,
    // in [0.5, 1.5), as required by the quadratic B-spline kernel below.
    return {
      base: [bx, by, bz],
      frac: [ax - bx, ay - by, az - bz],
    };
  }

  /** Quadratic B-spline weights and derivatives (3 per axis). f = distance to base node ∈ [0.5, 1.5). */
  static bsplineWeights(f, outW, outD) {
    outW[0] = 0.5 * (1.5 - f) ** 2;
    outW[1] = 0.75 - (f - 1) ** 2;
    outW[2] = 0.5 * (f - 0.5) ** 2;
    outD[0] = f - 1.5;
    outD[1] = -2 * (f - 1);
    outD[2] = f - 0.5;
  }
}
