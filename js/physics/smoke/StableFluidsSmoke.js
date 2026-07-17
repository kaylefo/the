/**
 * Stable-fluids smoke / steam on a uniform 3D grid.
 * Density + temperature + incompressible velocity with buoyancy.
 */
export class StableFluidsSmoke {
  constructor(nx, ny, nz, origin, dx) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.origin = origin;
    this.dx = dx;
    this.count = nx * ny * nz;

    this.density = new Float32Array(this.count);
    this.temperature = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.vz = new Float32Array(this.count);

    this.densityTmp = new Float32Array(this.count);
    this.vxTmp = new Float32Array(this.count);
    this.vyTmp = new Float32Array(this.count);
    this.vzTmp = new Float32Array(this.count);
    this.pressure = new Float32Array(this.count);
    this.divergence = new Float32Array(this.count);

    this.ambientTemp = 22;
    this.buoyancy = 2.8;
    this.dissipation = 0.65;
    this.tempDissipation = 1.2;
    this.projectIterations = 18;
    this.active = new Uint8Array(this.count);
    this.useActiveCells = true;
  }

  idx(i, j, k) {
    return i + j * this.nx + k * this.nx * this.ny;
  }

  reset() {
    this.density.fill(0);
    this.temperature.fill(this.ambientTemp);
    this.vx.fill(0);
    this.vy.fill(0);
    this.vz.fill(0);
    this.active.fill(0);
  }

  worldPos(i, j, k, out = new Float32Array(3)) {
    out[0] = this.origin[0] + i * this.dx;
    out[1] = this.origin[1] + j * this.dx;
    out[2] = this.origin[2] + k * this.dx;
    return out;
  }

  inject(x, y, z, amount, tempBoost, opts = {}) {
    const r = opts.radius ?? this.dx * 3;
    const r2 = r * r;
    const cx = opts.vx ?? 0, cy = opts.vy ?? 1, cz = opts.vz ?? 0;
    const temp = opts.temp ?? 100;

    const ax = (x - this.origin[0]) / this.dx;
    const ay = (y - this.origin[1]) / this.dx;
    const az = (z - this.origin[2]) / this.dx;
    const ri = Math.ceil(r / this.dx);

    const i0 = Math.max(1, Math.floor(ax) - ri);
    const i1 = Math.min(this.nx - 2, Math.floor(ax) + ri);
    const j0 = Math.max(1, Math.floor(ay) - ri);
    const j1 = Math.min(this.ny - 2, Math.floor(ay) + ri);
    const k0 = Math.max(1, Math.floor(az) - ri);
    const k1 = Math.min(this.nz - 2, Math.floor(az) + ri);

    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const pos = this.worldPos(i, j, k);
          const dx = pos[0] - x, dy = pos[1] - y, dz = pos[2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          const w = Math.exp(-d2 / (r2 * 0.35));
          const idx = this.idx(i, j, k);
          this.density[idx] = Math.min(1.5, this.density[idx] + amount * w * 120);
          this.temperature[idx] = Math.max(this.temperature[idx], this.ambientTemp + (temp - this.ambientTemp) * w);
          this.vy[idx] += cy * w * 0.5;
          this.vx[idx] += cx * w * 0.3;
          this.vz[idx] += cz * w * 0.3;
          this._markActive(i, j, k);
        }
      }
    }
  }

  _markActive(i, j, k) {
    if (!this.useActiveCells) return;
    for (let dk = -1; dk <= 1; dk++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj, kk = k + dk;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= this.nx || jj >= this.ny || kk >= this.nz) continue;
          this.active[this.idx(ii, jj, kk)] = 1;
        }
      }
    }
  }

  step(dt, opts = {}) {
    dt = Math.min(dt, 0.016);
    let maxD = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.density[i] > maxD) maxD = this.density[i];
    }
    if (maxD < 1e-6) return;

    this._addBuoyancy(dt);
    if (!opts.skipDensityAdvect) {
      this._advect(this.density, this.densityTmp, dt);
      this.density.set(this.densityTmp);
    }
    this._advect(this.vx, this.vxTmp, dt);
    this._advect(this.vy, this.vyTmp, dt);
    this._advect(this.vz, this.vzTmp, dt);
    this.vx.set(this.vxTmp);
    this.vy.set(this.vyTmp);
    this.vz.set(this.vzTmp);
    this._project(this.projectIterations);
    this._dissipate(dt);
    if (this.useActiveCells) this._decayActive();
  }

  _decayActive() {
    for (let i = 0; i < this.count; i++) {
      if (this.density[i] < 1e-4) this.active[i] = 0;
    }
  }

  _forEachActive(fn) {
    if (!this.useActiveCells) {
      for (let k = 1; k < this.nz - 1; k++) {
        for (let j = 1; j < this.ny - 1; j++) {
          for (let i = 1; i < this.nx - 1; i++) fn(i, j, k);
        }
      }
      return;
    }
    for (let k = 1; k < this.nz - 1; k++) {
      for (let j = 1; j < this.ny - 1; j++) {
        for (let i = 1; i < this.nx - 1; i++) {
          const idx = this.idx(i, j, k);
          if (this.active[idx] || this.density[idx] > 1e-5) fn(i, j, k);
        }
      }
    }
  }

  _addBuoyancy(dt) {
    this._forEachActive((i, j, k) => {
      const idx = this.idx(i, j, k);
      const d = this.density[idx];
      if (d < 1e-5) return;
      const tDiff = (this.temperature[idx] - this.ambientTemp) / 100;
      this.vy[idx] += dt * this.buoyancy * tDiff * (0.5 + d);
      this.vx[idx] += dt * 0.15 * (Math.random() - 0.5) * d;
      this.vz[idx] += dt * 0.15 * (Math.random() - 0.5) * d;
    });
  }

  _advect(field, out, dt) {
    this._forEachActive((i, j, k) => {
      const idx = this.idx(i, j, k);
      const pos = this.worldPos(i, j, k);
      const px = pos[0] - this.vx[idx] * dt;
      const py = pos[1] - this.vy[idx] * dt;
      const pz = pos[2] - this.vz[idx] * dt;
      out[idx] = this._sampleField(field, px, py, pz);
    });
  }

  _sampleField(field, x, y, z) {
    const ax = (x - this.origin[0]) / this.dx;
    const ay = (y - this.origin[1]) / this.dx;
    const az = (z - this.origin[2]) / this.dx;
    const i = Math.floor(ax), j = Math.floor(ay), k = Math.floor(az);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx - 1 || j >= this.ny - 1 || k >= this.nz - 1) return 0;
    const fx = ax - i, fy = ay - j, fz = az - k;
    const c000 = field[this.idx(i, j, k)];
    const c100 = field[this.idx(i + 1, j, k)];
    const c010 = field[this.idx(i, j + 1, k)];
    const c110 = field[this.idx(i + 1, j + 1, k)];
    const c001 = field[this.idx(i, j, k + 1)];
    const c101 = field[this.idx(i + 1, j, k + 1)];
    const c011 = field[this.idx(i, j + 1, k + 1)];
    const c111 = field[this.idx(i + 1, j + 1, k + 1)];
    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  }

  _project(iterations) {
    this.divergence.fill(0);
    const dx = this.dx;
    for (let k = 1; k < this.nz - 1; k++) {
      for (let j = 1; j < this.ny - 1; j++) {
        for (let i = 1; i < this.nx - 1; i++) {
          const idx = this.idx(i, j, k);
          this.divergence[idx] =
            (this.vx[this.idx(i + 1, j, k)] - this.vx[this.idx(i - 1, j, k)]) / (2 * dx) +
            (this.vy[this.idx(i, j + 1, k)] - this.vy[this.idx(i, j - 1, k)]) / (2 * dx) +
            (this.vz[this.idx(i, j, k + 1)] - this.vz[this.idx(i, j, k - 1)]) / (2 * dx);
        }
      }
    }

    this.pressure.fill(0);
    for (let it = 0; it < iterations; it++) {
      for (let k = 1; k < this.nz - 1; k++) {
        for (let j = 1; j < this.ny - 1; j++) {
          for (let i = 1; i < this.nx - 1; i++) {
            const idx = this.idx(i, j, k);
            const sum =
              this.pressure[this.idx(i + 1, j, k)] +
              this.pressure[this.idx(i - 1, j, k)] +
              this.pressure[this.idx(i, j + 1, k)] +
              this.pressure[this.idx(i, j - 1, k)] +
              this.pressure[this.idx(i, j, k + 1)] +
              this.pressure[this.idx(i, j, k - 1)];
            this.pressure[idx] = (sum - this.divergence[idx] * dx * dx) / 6;
          }
        }
      }
    }

    for (let k = 1; k < this.nz - 1; k++) {
      for (let j = 1; j < this.ny - 1; j++) {
        for (let i = 1; i < this.nx - 1; i++) {
          const idx = this.idx(i, j, k);
          this.vx[idx] -= (this.pressure[this.idx(i + 1, j, k)] - this.pressure[this.idx(i - 1, j, k)]) / (2 * dx);
          this.vy[idx] -= (this.pressure[this.idx(i, j + 1, k)] - this.pressure[this.idx(i, j - 1, k)]) / (2 * dx);
          this.vz[idx] -= (this.pressure[this.idx(i, j, k + 1)] - this.pressure[this.idx(i, j, k - 1)]) / (2 * dx);
        }
      }
    }
  }

  _dissipate(dt) {
    const dFactor = Math.exp(-this.dissipation * dt);
    const tLerp = Math.min(1, dt / this.tempDissipation);
    for (let i = 0; i < this.count; i++) {
      this.density[i] *= dFactor;
      if (this.density[i] < 1e-4) this.density[i] = 0;
      this.temperature[i] += (this.ambientTemp - this.temperature[i]) * tLerp;
    }
  }

  packTextureData(out) {
    for (let i = 0; i < this.count; i++) {
      out[i * 4] = Math.min(1, this.density[i]);
      out[i * 4 + 1] = (this.temperature[i] - this.ambientTemp) / 200;
      out[i * 4 + 2] = 0;
      out[i * 4 + 3] = 1;
    }
  }
}

export function smokeGridFromTank(tank, smokeRes) {
  const pad = 0.04;
  const dx = (tank.width + pad * 2) / smokeRes;
  const origin = [
    tank.origin[0] - pad,
    tank.origin[1] - pad * 0.5,
    tank.origin[2] - pad,
  ];
  const ny = Math.round((tank.height + pad * 2.5) / dx);
  return { nx: smokeRes, ny, nz: smokeRes, origin, dx };
}
