import { Grid3D } from "../mpm/Grid3D.js";
import { tankBounds } from "../WaterTank.js";

/**
 * FLIP water solver with tank walls, surface tension, and persistent markers.
 */
export class WaterFLIPSolver {
  constructor(nx, ny, nz, origin, dx, tank) {
    this.grid = new Grid3D(nx, ny, nz, origin, dx);
    this.dx = dx;
    this.origin = origin;
    this.tank = tank;
    this.bounds = tankBounds(tank);

    this.rho = 998;
    this.mu = 0.001;
    this.sigma = 0.072;
    this.gravity = -9.81;
    this.flipRatio = 0.97;

    this.markers = [];
    this.maxMarkers = 12000;
    this.markerMass = this.rho * dx ** 3 * 0.125;
    this.pressureIterations = 35;

    this.pressure = new Float32Array(this.grid.count);
    this.divergence = new Float32Array(this.grid.count);
    this.phi = new Float32Array(this.grid.count);
    this.densityField = new Float32Array(this.grid.count);
    this.phi.fill(1e3);
  }

  reset() {
    this.markers.length = 0;
    this.phi.fill(1e3);
    this.pressure.fill(0);
    this.densityField.fill(0);
  }

  step(dt) {
    dt = Math.min(dt, 4e-4);
    const g = this.grid;
    g.reset();

    for (const m of this.markers) {
      this._transferMarker(m, g);
    }

    this._buildLevelSet(g);
    this._applyForces(g, dt);
    this._computeDivergence(g);
    this._solvePressure(this.pressureIterations);
    this._applyPressure(g, dt);
    this._updateMarkers(g, dt);
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

    const mp = m.mass ?? this.markerMass;

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
    this.phi.fill(1e3);
    for (const m of this.markers) {
      const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
      const i0 = Math.max(0, base[0]), j0 = Math.max(0, base[1]), k0 = Math.max(0, base[2]);
      const i1 = Math.min(g.nx - 1, base[0] + 2);
      const j1 = Math.min(g.ny - 1, base[1] + 2);
      const k1 = Math.min(g.nz - 1, base[2] + 2);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          for (let k = k0; k <= k1; k++) {
            const pos = g.worldPos(i, j, k);
            const dist = Math.hypot(m.x - pos[0], m.y - pos[1], m.z - pos[2]) - this.dx * 0.45;
            const idx = g.idx(i, j, k);
            this.phi[idx] = Math.min(this.phi[idx], dist);
          }
        }
      }
    }
  }

  _applyForces(g, dt) {
    const dx = this.dx;
    const dx2 = dx * dx;
    const nu = this.mu / this.rho;

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

          vx += dt * nu * (
            (g.vx[idxR] / mr - 2 * vx + g.vx[idxL] / ml) / dx2 +
            (g.vx[g.idx(i, j + 1, k)] / (g.mass[g.idx(i, j + 1, k)] || m) - 2 * vx + g.vx[g.idx(i, j - 1, k)] / (g.mass[g.idx(i, j - 1, k)] || m)) / dx2 +
            (g.vx[g.idx(i, j, k + 1)] / (g.mass[g.idx(i, j, k + 1)] || m) - 2 * vx + g.vx[g.idx(i, j, k - 1)] / (g.mass[g.idx(i, j, k - 1)] || m)) / dx2
          );
          vy += dt * nu * (
            (g.vy[idxU] / mu - 2 * vy + g.vy[idxD] / md) / dx2 +
            (g.vy[g.idx(i + 1, j, k)] / (g.mass[g.idx(i + 1, j, k)] || m) - 2 * vy + g.vy[g.idx(i - 1, j, k)] / (g.mass[g.idx(i - 1, j, k)] || m)) / dx2 +
            (g.vy[g.idx(i, j, k + 1)] / (g.mass[g.idx(i, j, k + 1)] || m) - 2 * vy + g.vy[g.idx(i, j, k - 1)] / (g.mass[g.idx(i, j, k - 1)] || m)) / dx2
          );
          vz += dt * nu * (
            (g.vz[idxF] / mf - 2 * vz + g.vz[idxB] / mb) / dx2 +
            (g.vz[g.idx(i + 1, j, k)] / (g.mass[g.idx(i + 1, j, k)] || m) - 2 * vz + g.vz[g.idx(i - 1, j, k)] / (g.mass[g.idx(i - 1, j, k)] || m)) / dx2 +
            (g.vz[g.idx(i, j + 1, k)] / (g.mass[g.idx(i, j + 1, k)] || m) - 2 * vz + g.vz[g.idx(i, j - 1, k)] / (g.mass[g.idx(i, j - 1, k)] || m)) / dx2
          );

          // Surface tension (CSF-lite)
          const phi = this.phi[idx];
          if (Math.abs(phi) < dx * 2) {
            const phiL = this.phi[idxL], phiR = this.phi[idxR];
            const phiD = this.phi[idxD], phiU = this.phi[idxU];
            const phiB = this.phi[idxB], phiF = this.phi[idxF];
            const gradX = (phiR - phiL) / (2 * dx);
            const gradY = (phiU - phiD) / (2 * dx);
            const gradZ = (phiF - phiB) / (2 * dx);
            const gradLen = Math.hypot(gradX, gradY, gradZ) + 1e-8;
            const kappa = (
              (phiR + phiL + phiU + phiD + phiB + phiF - 6 * phi) / dx2
            );
            const stScale = this.sigma * kappa / this.rho;
            vx += dt * stScale * (gradX / gradLen);
            vy += dt * stScale * (gradY / gradLen);
            vz += dt * stScale * (gradZ / gradLen);
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
    const b = this.bounds;

    for (const m of this.markers) {
      const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
      Grid3D.bsplineWeights(frac[0], w, dw);
      const wx = w.slice();
      Grid3D.bsplineWeights(frac[1], w, dw);
      const wy = w.slice();
      Grid3D.bsplineWeights(frac[2], w, dw);
      const wz = w.slice();

      let picVx = 0, picVy = 0, picVz = 0;
      const flipVx = m.vx, flipVy = m.vy, flipVz = m.vz;

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

      this._resolveTankWalls(m);
    }
  }

  _resolveTankWalls(m) {
    const b = this.bounds;
    const rest = 0.25;

    if (m.x < b.xMin) { m.x = b.xMin; m.vx *= -rest; }
    if (m.x > b.xMax) { m.x = b.xMax; m.vx *= -rest; }
    if (m.y < b.yMin) { m.y = b.yMin; m.vy *= -0.08; m.vx *= 0.6; m.vz *= 0.6; }
    if (m.y > b.yMax) { m.y = b.yMax; m.vy *= -0.05; }
    if (m.z < b.zMin) { m.z = b.zMin; m.vz *= -rest; }
    if (m.z > b.zMax) { m.z = b.zMax; m.vz *= -rest; }
  }

  applyStirImpulse(x, y, z, vx, vy, vz, radius, strength) {
    const r2 = radius * radius;
    for (const m of this.markers) {
      const dx = m.x - x, dy = m.y - y, dz = m.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const w = Math.exp(-d2 / (r2 * 0.35));
      m.vx += (vx * w + (-dz * strength * w));
      m.vy += vy * w * 0.3;
      m.vz += (vz * w + (dx * strength * w));
    }
  }

  sampleDensity(outField) {
    outField.fill(0);
    const g = this.grid;
    const invR = 1 / (this.dx * 1.2);
    const r2 = (this.dx * 1.5) ** 2;

    for (const m of this.markers) {
      const { base } = g.nodeFromWorld(m.x, m.y, m.z);
      for (let di = -1; di <= 2; di++) {
        for (let dj = -1; dj <= 2; dj++) {
          for (let dk = -1; dk <= 2; dk++) {
            const i = base[0] + di, j = base[1] + dj, k = base[2] + dk;
            if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
            const pos = g.worldPos(i, j, k);
            const d2 = (m.x - pos[0]) ** 2 + (m.y - pos[1]) ** 2 + (m.z - pos[2]) ** 2;
            if (d2 > r2) continue;
            const w = Math.exp(-d2 * invR * invR);
            outField[g.idx(i, j, k)] += w;
          }
        }
      }
    }
  }

  removeMarkersNear(x, y, z, radius, maxRemove) {
    const r2 = radius * radius;
    let removed = 0;
    this.markers = this.markers.filter((m) => {
      const d2 = (m.x - x) ** 2 + (m.y - y) ** 2 + (m.z - z) ** 2;
      if (d2 <= r2 && removed < maxRemove) {
        removed++;
        return false;
      }
      return true;
    });
    return removed;
  }

  getSurfaceSloshEnergy(surfaceY, band = 0.012) {
    let sum = 0;
    let n = 0;
    for (const m of this.markers) {
      if (Math.abs(m.y - surfaceY) < band) {
        sum += m.vx * m.vx + m.vy * m.vy + m.vz * m.vz;
        n++;
      }
    }
    return n ? Math.min(1, Math.sqrt(sum / n) * 6) : 0;
  }

  getVolumeLiters() {
    return (this.markers.length * this.markerMass / this.rho * 1000).toFixed(1);
  }
}
