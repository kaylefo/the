import { Grid3D } from "./mpm/Grid3D.js";
import { clamp } from "./math.js";

/**
 * FLIP fluid solver (Marker-and-Cell) for released tomato juice.
 * Incompressible Navier-Stokes with free surface (level-set from markers).
 * ρ ∂u/∂t + ρ u·∇u = -∇p + μ∇²u + ρg
 */
export class FLIPSolver {
  constructor(nx, ny, nz, origin, dx) {
    this.grid = new Grid3D(nx, ny, nz, origin, dx);
    this.dx = dx;
    this.origin = origin;
    this.rho = 1040;
    this.mu = 0.004; // Pa·s (tomato juice ~4 mPa·s)
    this.gravity = -9.81;
    this.groundY = 0;
    this.flipRatio = 0.96;

    this.markers = [];
    this.maxMarkers = 8000;
    this.pressureIterations = 40;

    this.pressure = new Float32Array(this.grid.count);
    this.divergence = new Float32Array(this.grid.count);
    this.phi = new Float32Array(this.grid.count); // level set
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

    // P2G markers
    for (const m of this.markers) {
      this._transferMarker(m, g, dt);
    }

    // Navier-Stokes: add viscosity + gravity on grid
    this._applyForces(g, dt);

    // Pressure projection (Jacobi Poisson solve)
    this._computeDivergence(g);
    this._solvePressure(this.pressureIterations);

    // Apply pressure gradient
    this._applyPressure(g, dt);

    // G2P (FLIP/PIC blend)
    this._updateMarkers(g, dt);

    // Cull dead markers
    this.markers = this.markers.filter((m) => m.life > 0 && m.y > this.groundY - 0.01);
  }

  _transferMarker(m, g, dt) {
    const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
    const w = [0, 0, 0], dw = [0, 0, 0];
    Grid3D.bsplineWeights(frac[0], w, dw);
    const wx = w.slice();
    Grid3D.bsplineWeights(frac[1], w, dw);
    const wy = w.slice();
    Grid3D.bsplineWeights(frac[2], w, dw);
    const wz = w.slice();

    const mp = this.rho * this.dx ** 3 * 0.125;

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
          this.phi[idx] = Math.min(this.phi[idx], -0.01);
        }
      }
    }
  }

  _applyForces(g, dt) {
    const dx2 = this.dx * this.dx;
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          const m = g.mass[idx];
          if (m < 1e-10) continue;

          let vx = g.vx[idx] / m;
          let vy = g.vy[idx] / m + dt * this.gravity;
          let vz = g.vz[idx] / m;

          const idxL = g.idx(i - 1, j, k), idxR = g.idx(i + 1, j, k);
          const idxD = g.idx(i, j - 1, k), idxU = g.idx(i, j + 1, k);
          const idxB = g.idx(i, j, k - 1), idxF = g.idx(i, j, k + 1);

          const ml = g.mass[idxL] || m, mr = g.mass[idxR] || m;
          const md = g.mass[idxD] || m, mu = g.mass[idxU] || m;
          const mb = g.mass[idxB] || m, mf = g.mass[idxF] || m;

          const nu = this.mu / this.rho;
          vx += dt * nu * (
            (g.vx[idxR] / mr - 2 * vx + g.vx[idxL] / ml) / dx2 +
            (g.vx[g.idx(i, j + 1, k)] / (g.mass[g.idx(i, j + 1, k)] || m) - 2 * vx + g.vx[g.idx(i, j - 1, k)] / (g.mass[g.idx(i, j - 1, k)] || m)) / dx2
          );
          vy += dt * nu * (
            (g.vy[idxU] / mu - 2 * vy + g.vy[idxD] / md) / dx2
          );
          vz += dt * nu * (
            (g.vz[idxF] / mf - 2 * vz + g.vz[idxB] / mb) / dx2
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

  _computeDivergence(g) {
    this.divergence.fill(0);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (g.mass[idx] < 1e-10) continue;
          const div =
            (g.vx[g.idx(i + 1, j, k)] - g.vx[g.idx(i - 1, j, k)]) / (2 * this.dx) +
            (g.vy[g.idx(i, j + 1, k)] - g.vy[g.idx(i, j - 1, k)]) / (2 * this.dx) +
            (g.vz[g.idx(i, j, k + 1)] - g.vz[g.idx(i, j, k - 1)]) / (2 * this.dx);
          this.divergence[idx] = div;
        }
      }
    }
  }

  _solvePressure(iterations) {
    const g = this.grid;
    const dx2 = this.dx * this.dx;
    this.pressure.fill(0);

    for (let it = 0; it < iterations; it++) {
      for (let k = 1; k < g.nz - 1; k++) {
        for (let j = 1; j < g.ny - 1; j++) {
          for (let i = 1; i < g.nx - 1; i++) {
            const idx = g.idx(i, j, k);
            if (g.mass[idx] < 1e-10) continue;
            const sum =
              this.pressure[g.idx(i + 1, j, k)] +
              this.pressure[g.idx(i - 1, j, k)] +
              this.pressure[g.idx(i, j + 1, k)] +
              this.pressure[g.idx(i, j - 1, k)] +
              this.pressure[g.idx(i, j, k + 1)] +
              this.pressure[g.idx(i, j, k - 1)];
            this.pressure[idx] = (sum - this.divergence[idx] * dx2) / 6;
          }
        }
      }
    }
  }

  _applyPressure(g, dt) {
    const scale = dt / (this.rho * this.dx);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (g.mass[idx] < 1e-10) continue;
          g.vx[idx] -= scale * (this.pressure[g.idx(i + 1, j, k)] - this.pressure[g.idx(i - 1, j, k)]);
          g.vy[idx] -= scale * (this.pressure[g.idx(i, j + 1, k)] - this.pressure[g.idx(i, j - 1, k)]);
          g.vz[idx] -= scale * (this.pressure[g.idx(i, j, k + 1)] - this.pressure[g.idx(i, j, k - 1)]);
        }
      }
    }
  }

  _updateMarkers(g, dt) {
    const w = [0, 0, 0], dw = [0, 0, 0];
    for (const m of this.markers) {
      const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
      Grid3D.bsplineWeights(frac[0], w, dw);
      const wx = w.slice();
      Grid3D.bsplineWeights(frac[1], w, dw);
      const wy = w.slice();
      Grid3D.bsplineWeights(frac[2], w, dw);
      const wz = w.slice();

      let picVx = 0, picVy = 0, picVz = 0;
      let flipVx = m.vx, flipVy = m.vy, flipVz = m.vz;

      for (let gi = 0; gi < 3; gi++) {
        for (let gj = 0; gj < 3; gj++) {
          for (let gk = 0; gk < 3; gk++) {
            const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
            if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
            const weight = wx[gi] * wy[gj] * wz[gk];
            if (weight < 1e-10) continue;
            const idx = g.idx(i, j, k);
            const mCell = g.mass[idx];
            if (mCell < 1e-10) continue;
            picVx += weight * g.vx[idx];
            picVy += weight * g.vy[idx];
            picVz += weight * g.vz[idx];
          }
        }
      }

      const r = this.flipRatio;
      m.vx = r * flipVx + (1 - r) * picVx;
      m.vy = r * flipVy + (1 - r) * picVy;
      m.vz = r * flipVz + (1 - r) * picVz;

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
