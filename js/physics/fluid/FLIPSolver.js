import { Grid3D } from "../mpm/Grid3D.js";

/**
 * FLIP fluid solver (Marker-and-Cell) for released tomato juice.
 * Incompressible Navier–Stokes with signed-distance free surface and
 * Dirichlet p = 0 at the air interface.
 */
export class FLIPSolver {
  constructor(nx, ny, nz, origin, dx) {
    this.grid = new Grid3D(nx, ny, nz, origin, dx);
    this.dx = dx;
    this.origin = origin;
    this.rho = 1040;
    this.mu = 0.004;
    this.gravity = -9.81;
    this.groundY = 0;
    this.flipRatio = 0.96;

    this.markers = [];
    this.maxMarkers = 8000;
    this.pressureIterations = 40;
    this.markerMass = this.rho * dx ** 3 * 0.125;

    const n = this.grid.count;
    this.pressure = new Float32Array(n);
    this.pressureScratch = new Float32Array(n);
    this.divergence = new Float32Array(n);
    this.phi = new Float32Array(n);
    this.fluidMask = new Uint8Array(n);
    this.prevVx = new Float32Array(n);
    this.prevVy = new Float32Array(n);
    this.prevVz = new Float32Array(n);
    this.phi.fill(1e3);
  }

  reset() {
    this.markers.length = 0;
    this.phi.fill(1e3);
    this.pressure.fill(0);
  }

  emit(pos, vel, count, jitter = 0.001) {
    for (let i = 0; i < count && this.markers.length < this.maxMarkers; i++) {
      this.markers.push({
        x: pos[0] + (Math.random() - 0.5) * jitter,
        y: pos[1] + (Math.random() - 0.5) * jitter,
        z: pos[2] + (Math.random() - 0.5) * jitter,
        vx: vel[0] + (Math.random() - 0.5) * 2,
        vy: vel[1] + Math.random() * 2,
        vz: vel[2] + (Math.random() - 0.5) * 2,
        life: 3 + Math.random() * 4,
      });
    }
  }

  step(dt) {
    dt = Math.min(dt, 5e-4);
    const g = this.grid;
    g.reset();

    for (const m of this.markers) {
      this._transferMarker(m, g);
    }

    this._buildLevelSet(g);
    this._classifyFluidCells(g);
    this._normalizeAndSaveGridVelocities(g);
    this._applyForces(g, dt);
    this._computeDivergence(g);
    this._solvePressure(this.pressureIterations);
    this._applyPressure(g, dt);
    this._updateMarkers(g, dt);

    this.markers = this.markers.filter((m) => m.life > 0 && m.y > this.groundY - 0.01);
  }

  _transferMarker(m, g) {
    const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
    const w = [0, 0, 0], dw = [0, 0, 0];
    Grid3D.bsplineWeights(frac[0], w, dw);
    const wx = w.slice();
    Grid3D.bsplineWeights(frac[1], w, dw);
    const wy = w.slice();
    Grid3D.bsplineWeights(frac[2], w, dw);
    const wz = w.slice();

    const mp = this.markerMass;

    for (let gi = 0; gi < 3; gi++) {
      for (let gj = 0; gj < 3; gj++) {
        for (let gk = 0; gk < 3; gk++) {
          const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
          const weight = wx[gi] * wy[gj] * wz[gk];
          if (weight < 1e-10) continue;
          const idx = g.idx(i, j, k);
          g.mass[idx] += weight * mp;
          g.vx[idx] += weight * mp * m.vx;
          g.vy[idx] += weight * mp * m.vy;
          g.vz[idx] += weight * mp * m.vz;
        }
      }
    }
  }

  _buildLevelSet(g) {
    const r = this.dx * 0.45;
    this.phi.fill(1e3);

    for (const m of this.markers) {
      const { base } = g.nodeFromWorld(m.x, m.y, m.z);
      const i0 = Math.max(0, base[0] - 1), j0 = Math.max(0, base[1] - 1), k0 = Math.max(0, base[2] - 1);
      const i1 = Math.min(g.nx - 1, base[0] + 3);
      const j1 = Math.min(g.ny - 1, base[1] + 3);
      const k1 = Math.min(g.nz - 1, base[2] + 3);

      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          for (let k = k0; k <= k1; k++) {
            const pos = g.worldPos(i, j, k);
            const dist = Math.hypot(m.x - pos[0], m.y - pos[1], m.z - pos[2]) - r;
            const idx = g.idx(i, j, k);
            this.phi[idx] = Math.min(this.phi[idx], dist);
          }
        }
      }
    }
  }

  _classifyFluidCells(g) {
    const eps = this.dx * 0.25;
    this.fluidMask.fill(0);
    for (let k = 0; k < g.nz; k++) {
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const idx = g.idx(i, j, k);
          if (this.phi[idx] < eps || g.mass[idx] > 1e-10) {
            this.fluidMask[idx] = 1;
          }
        }
      }
    }
  }

  _isFluid(idx) {
    return this.fluidMask[idx] === 1;
  }

  _normalizeAndSaveGridVelocities(g) {
    for (let k = 0; k < g.nz; k++) {
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const idx = g.idx(i, j, k);
          const m = g.mass[idx];
          if (m < 1e-10) {
            g.vx[idx] = g.vy[idx] = g.vz[idx] = 0;
            this.prevVx[idx] = this.prevVy[idx] = this.prevVz[idx] = 0;
            continue;
          }
          const invM = 1 / m;
          const vx = g.vx[idx] * invM;
          const vy = g.vy[idx] * invM;
          const vz = g.vz[idx] * invM;
          this.prevVx[idx] = vx;
          this.prevVy[idx] = vy;
          this.prevVz[idx] = vz;
          g.vx[idx] = vx;
          g.vy[idx] = vy;
          g.vz[idx] = vz;
        }
      }
    }
  }

  _applyForces(g, dt) {
    const dx2 = this.dx * this.dx;
    const nu = this.mu / this.rho;

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;

          let vx = g.vx[idx];
          let vy = g.vy[idx] + dt * this.gravity;
          let vz = g.vz[idx];

          const idxL = g.idx(i - 1, j, k), idxR = g.idx(i + 1, j, k);
          const idxD = g.idx(i, j - 1, k), idxU = g.idx(i, j + 1, k);
          const idxB = g.idx(i, j, k - 1), idxF = g.idx(i, j, k + 1);

          const ml = g.mass[idxL] || m, mr = g.mass[idxR] || m;
          const md = g.mass[idxD] || m, mu = g.mass[idxU] || m;
          const mb = g.mass[idxB] || m, mf = g.mass[idxF] || m;

          vx += dt * nu * (
            (g.vx[idxR] / mr - 2 * vx + g.vx[idxL] / ml) / dx2 +
            (g.vx[g.idx(i, j + 1, k)] / (g.mass[g.idx(i, j + 1, k)] || m) - 2 * vx + g.vx[g.idx(i, j - 1, k)] / (g.mass[g.idx(i, j - 1, k)] || m)) / dx2
          );
          vy += dt * nu * (
            (g.vy[idxU] - 2 * vy + g.vy[idxD]) / dx2
          );
          vz += dt * nu * (
            (g.vz[idxF] - 2 * vz + g.vz[idxB]) / dx2
          );

          const pos = g.worldPos(i, j, k);
          if (pos[1] <= this.groundY && vy < 0) {
            vy *= -0.05;
            vx *= 0.5;
            vz *= 0.5;
          }

          g.vx[idx] = vx;
          g.vy[idx] = vy;
          g.vz[idx] = vz;
        }
      }
    }
  }

  _boundaryPressure(idxN, buf = this.pressure) {
    return this._isFluid(idxN) ? buf[idxN] : 0;
  }

  _computeDivergence(g) {
    this.divergence.fill(0);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          this.divergence[idx] =
            (g.vx[g.idx(i + 1, j, k)] - g.vx[g.idx(i - 1, j, k)]) / (2 * this.dx) +
            (g.vy[g.idx(i, j + 1, k)] - g.vy[g.idx(i, j - 1, k)]) / (2 * this.dx) +
            (g.vz[g.idx(i, j, k + 1)] - g.vz[g.idx(i, j, k - 1)]) / (2 * this.dx);
        }
      }
    }
  }

  _solvePressure(iterations) {
    const g = this.grid;
    const dx2 = this.dx * this.dx;
    let cur = this.pressure;
    let nxt = this.pressureScratch;
    cur.fill(0);

    for (let it = 0; it < iterations; it++) {
      const color = it & 1;
      nxt.fill(0);
      for (let k = 1; k < g.nz - 1; k++) {
        for (let j = 1; j < g.ny - 1; j++) {
          for (let i = 1; i < g.nx - 1; i++) {
            if (((i + j + k) & 1) !== color) {
              nxt[g.idx(i, j, k)] = cur[g.idx(i, j, k)];
              continue;
            }
            const idx = g.idx(i, j, k);
            if (!this._isFluid(idx)) continue;
            nxt[idx] = (
              this._boundaryPressure(g.idx(i + 1, j, k), cur) +
              this._boundaryPressure(g.idx(i - 1, j, k), cur) +
              this._boundaryPressure(g.idx(i, j + 1, k), cur) +
              this._boundaryPressure(g.idx(i, j - 1, k), cur) +
              this._boundaryPressure(g.idx(i, j, k + 1), cur) +
              this._boundaryPressure(g.idx(i, j, k - 1), cur) -
              this.divergence[idx] * dx2
            ) / 6;
          }
        }
      }
      const tmp = cur; cur = nxt; nxt = tmp;
    }
    if (cur !== this.pressure) this.pressure.set(cur);
  }

  _applyPressure(g, dt) {
    const scale = dt / (this.rho * this.dx);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          g.vx[idx] -= scale * (this._boundaryPressure(g.idx(i + 1, j, k)) - this._boundaryPressure(g.idx(i - 1, j, k)));
          g.vy[idx] -= scale * (this._boundaryPressure(g.idx(i, j + 1, k)) - this._boundaryPressure(g.idx(i, j - 1, k)));
          g.vz[idx] -= scale * (this._boundaryPressure(g.idx(i, j, k + 1)) - this._boundaryPressure(g.idx(i, j, k - 1)));
        }
      }
    }
  }

  _sampleGridDelta(g, x, y, z) {
    const { base, frac } = g.nodeFromWorld(x, y, z);
    const w = [0, 0, 0], dw = [0, 0, 0];
    Grid3D.bsplineWeights(frac[0], w, dw);
    const wx = w.slice();
    Grid3D.bsplineWeights(frac[1], w, dw);
    const wy = w.slice();
    Grid3D.bsplineWeights(frac[2], w, dw);
    const wz = w.slice();

    let dVx = 0, dVy = 0, dVz = 0;
    for (let gi = 0; gi < 3; gi++) {
      for (let gj = 0; gj < 3; gj++) {
        for (let gk = 0; gk < 3; gk++) {
          const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
          const weight = wx[gi] * wy[gj] * wz[gk];
          if (weight < 1e-10) continue;
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          dVx += weight * (g.vx[idx] - this.prevVx[idx]);
          dVy += weight * (g.vy[idx] - this.prevVy[idx]);
          dVz += weight * (g.vz[idx] - this.prevVz[idx]);
        }
      }
    }
    return [dVx, dVy, dVz];
  }

  _sampleGridVelocity(g, x, y, z) {
    const { base, frac } = g.nodeFromWorld(x, y, z);
    const w = [0, 0, 0], dw = [0, 0, 0];
    Grid3D.bsplineWeights(frac[0], w, dw);
    const wx = w.slice();
    Grid3D.bsplineWeights(frac[1], w, dw);
    const wy = w.slice();
    Grid3D.bsplineWeights(frac[2], w, dw);
    const wz = w.slice();

    let vx = 0, vy = 0, vz = 0;
    for (let gi = 0; gi < 3; gi++) {
      for (let gj = 0; gj < 3; gj++) {
        for (let gk = 0; gk < 3; gk++) {
          const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
          const weight = wx[gi] * wy[gj] * wz[gk];
          if (weight < 1e-10) continue;
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          vx += weight * g.vx[idx];
          vy += weight * g.vy[idx];
          vz += weight * g.vz[idx];
        }
      }
    }
    return [vx, vy, vz];
  }

  _updateMarkers(g, dt) {
    const r = this.flipRatio;
    for (const m of this.markers) {
      const [dVx, dVy, dVz] = this._sampleGridDelta(g, m.x, m.y, m.z);
      const [picVx, picVy, picVz] = this._sampleGridVelocity(g, m.x, m.y, m.z);

      m.vx = r * (m.vx + dVx) + (1 - r) * picVx;
      m.vy = r * (m.vy + dVy) + (1 - r) * picVy;
      m.vz = r * (m.vz + dVz) + (1 - r) * picVz;

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;

      if (m.y < this.groundY) {
        m.y = this.groundY;
        m.vy *= -0.08;
        m.vx *= 0.6;
        m.vz *= 0.6;
      }

      m.life -= dt;
    }
  }

  getVolumeMl() {
    return Math.round(this.markers.length * 0.015);
  }
}
