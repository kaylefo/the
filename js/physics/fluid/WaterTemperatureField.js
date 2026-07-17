/**
 * Scalar temperature field T(x,t) on the FLIP collocated grid.
 *
 * Governing PDE (incompressible advection–diffusion):
 *   ∂T/∂t + u·∇T = α ∇²T + Q̇/(ρ c_p)
 *
 * Boiling nucleation when T ≥ T_sat (Clausius–Clapeyron simplified):
 *   ṁ_vap ∝ max(0, T − T_sat)^n
 */
export class WaterTemperatureField {
  constructor(gridCount, dx, options = {}) {
    this.count = gridCount;
    this.dx = dx;
    this.T = new Float32Array(gridCount);
    this.TTmp = new Float32Array(gridCount);
    this.T_ambient = options.ambient ?? 22;
    this.T_sat = options.boilingPoint ?? 100;
    this.alpha = options.thermalDiffusivity ?? 1.43e-7;
    this.rho = options.density ?? 998;
    this.cp = options.specificHeat ?? 4182;
    this.boilingExponent = options.boilingExponent ?? 1.8;
    this.reset();
  }

  reset() {
    this.T.fill(this.T_ambient);
  }

  /** Semi-Lagrangian advection + explicit diffusion on fluid cells. */
  step(grid, fluidMask, dt, sampleVelocity) {
    const dx = this.dx;
    const dx2 = dx * dx;
    const g = grid;
    const nu = this.alpha;

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!fluidMask[idx]) continue;

          const pos = g.worldPos(i, j, k);
          const [vx, vy, vz] = sampleVelocity(pos[0], pos[1], pos[2]);
          const px = pos[0] - vx * dt;
          const py = pos[1] - vy * dt;
          const pz = pos[2] - vz * dt;
          const Tadv = this._sample(g, fluidMask, px, py, pz);

          const idxL = g.idx(i - 1, j, k), idxR = g.idx(i + 1, j, k);
          const idxD = g.idx(i, j - 1, k), idxU = g.idx(i, j + 1, k);
          const idxB = g.idx(i, j, k - 1), idxF = g.idx(i, j, k + 1);

          const TL = fluidMask[idxL] ? this.T[idxL] : this.T[idx];
          const TR = fluidMask[idxR] ? this.T[idxR] : this.T[idx];
          const TD = fluidMask[idxD] ? this.T[idxD] : this.T[idx];
          const TU = fluidMask[idxU] ? this.T[idxU] : this.T[idx];
          const TB = fluidMask[idxB] ? this.T[idxB] : this.T[idx];
          const TF = fluidMask[idxF] ? this.T[idxF] : this.T[idx];

          const lap = (TR + TL + TU + TD + TF + TB - 6 * this.T[idx]) / dx2;
          this.TTmp[idx] = Tadv + dt * nu * lap;
        }
      }
    }

    for (let idx = 0; idx < this.count; idx++) {
      if (fluidMask[idx]) this.T[idx] = this.TTmp[idx];
    }
  }

  _sample(g, fluidMask, x, y, z) {
    const ax = (x - g.origin[0]) / this.dx;
    const ay = (y - g.origin[1]) / this.dx;
    const az = (z - g.origin[2]) / this.dx;
    const i = Math.floor(ax), j = Math.floor(ay), k = Math.floor(az);
    if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) {
      return this.T_ambient;
    }
    const fx = ax - i, fy = ay - j, fz = az - k;
    const c000 = (!fluidMask || fluidMask[g.idx(i, j, k)]) ? this.T[g.idx(i, j, k)] : this.T_ambient;
    const c100 = (!fluidMask || fluidMask[g.idx(i + 1, j, k)]) ? this.T[g.idx(i + 1, j, k)] : this.T_ambient;
    const c010 = (!fluidMask || fluidMask[g.idx(i, j + 1, k)]) ? this.T[g.idx(i, j + 1, k)] : this.T_ambient;
    const c110 = (!fluidMask || fluidMask[g.idx(i + 1, j + 1, k)]) ? this.T[g.idx(i + 1, j + 1, k)] : this.T_ambient;
    const c001 = (!fluidMask || fluidMask[g.idx(i, j, k + 1)]) ? this.T[g.idx(i, j, k + 1)] : this.T_ambient;
    const c101 = (!fluidMask || fluidMask[g.idx(i + 1, j, k + 1)]) ? this.T[g.idx(i + 1, j, k + 1)] : this.T_ambient;
    const c011 = (!fluidMask || fluidMask[g.idx(i, j + 1, k + 1)]) ? this.T[g.idx(i, j + 1, k + 1)] : this.T_ambient;
    const c111 = (!fluidMask || fluidMask[g.idx(i + 1, j + 1, k + 1)]) ? this.T[g.idx(i + 1, j + 1, k + 1)] : this.T_ambient;
    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  }

  /** Gaussian heat source Q̇ (W) deposited over radius r. */
  injectHeat(g, fluidMask, x, y, z, powerWatts, dt, radius) {
    const r2 = radius * radius;
    const ax = (x - g.origin[0]) / this.dx;
    const ay = (y - g.origin[1]) / this.dx;
    const az = (z - g.origin[2]) / this.dx;
    const ri = Math.ceil(radius / this.dx);

    const i0 = Math.max(1, Math.floor(ax) - ri);
    const i1 = Math.min(g.nx - 2, Math.floor(ax) + ri);
    const j0 = Math.max(1, Math.floor(ay) - ri);
    const j1 = Math.min(g.ny - 2, Math.floor(ay) + ri);
    const k0 = Math.max(1, Math.floor(az) - ri);
    const k1 = Math.min(g.nz - 2, Math.floor(az) + ri);

    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = g.idx(i, j, k);
          if (!fluidMask[idx]) continue;
          const pos = g.worldPos(i, j, k);
          const d2 = (pos[0] - x) ** 2 + (pos[1] - y) ** 2 + (pos[2] - z) ** 2;
          if (d2 > r2) continue;
          const w = Math.exp(-d2 / (r2 * 0.35));
          const dT = (powerWatts * w * dt) / (this.rho * this.cp * this.dx ** 3);
          this.T[idx] += dT;
        }
      }
    }
  }

  sampleAt(g, x, y, z) {
    return this._sample(g, null, x, y, z);
  }

  /** Nucleate boiling mass flux proxy [0,1] from local superheat. */
  boilingIntensity(g, fluidMask, x, y, z) {
    const T = this._sample(g, fluidMask, x, y, z);
    if (T <= this.T_sat) return 0;
    const superheat = (T - this.T_sat) / 15;
    return Math.min(1, superheat ** this.boilingExponent);
  }

  /** ∇T at grid cell for Marangoni traction (surface band only). */
  gradientAt(g, i, j, k, fluidMask) {
    const dx = this.dx;
    const idx = g.idx(i, j, k);
    const idxL = g.idx(i - 1, j, k), idxR = g.idx(i + 1, j, k);
    const idxD = g.idx(i, j - 1, k), idxU = g.idx(i, j + 1, k);
    const idxB = g.idx(i, j, k - 1), idxF = g.idx(i, j, k + 1);
    const gx = (this.T[idxR] - this.T[idxL]) / (2 * dx);
    const gy = (this.T[idxU] - this.T[idxD]) / (2 * dx);
    const gz = (this.T[idxF] - this.T[idxB]) / (2 * dx);
    return [gx, gy, gz];
  }

  getMaxTemp() {
    let m = this.T_ambient;
    for (let i = 0; i < this.count; i++) if (this.T[i] > m) m = this.T[i];
    return m;
  }
}
