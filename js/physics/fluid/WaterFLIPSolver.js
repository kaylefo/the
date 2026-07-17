import { Grid3D } from "../mpm/Grid3D.js";
import { tankBounds } from "../WaterTank.js";

/**
 * FLIP water solver with signed-distance free surface, red-black Gauss–Seidel
 * pressure projection, grid wall BCs, vorticity confinement, and proper FLIP
 * velocity transfer (particle += Δu_grid).
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
    this.vorticityEpsilon = 0.15;
    this.xsphStrength = 0.04;

    this.markers = [];
    this.maxMarkers = 12000;
    this.markerMass = this.rho * dx ** 3 * 0.125;
    this.pressureIterations = 35;

    const n = this.grid.count;
    this.pressure = new Float32Array(n);
    this.pressureScratch = new Float32Array(n);
    this.divergence = new Float32Array(n);
    this.phi = new Float32Array(n);
    this.densityField = new Float32Array(n);
    this.fluidMask = new Uint8Array(n);
    this.prevVx = new Float32Array(n);
    this.prevVy = new Float32Array(n);
    this.prevVz = new Float32Array(n);
    this.phi.fill(1e3);

    this.surfaceY = this.bounds.yMin + (this.bounds.yMax - this.bounds.yMin) * tank.fillRatio;
    this.sloshEnergy = 0;
    this.surfaceRipple = 0;
  }

  reset() {
    this.markers.length = 0;
    this.phi.fill(1e3);
    this.pressure.fill(0);
    this.densityField.fill(0);
    this.sloshEnergy = 0;
    this.surfaceRipple = 0;
  }

  step(dt) {
    dt = Math.min(dt, 4e-4);
    const g = this.grid;
    g.reset();

    for (const m of this.markers) {
      this._transferMarker(m, g);
    }

    this._buildLevelSet(g);
    this._reinitializePhi(g);
    this._classifyFluidCells(g);
    this._normalizeAndSaveGridVelocities(g);
    this._enforceGridWalls(g);

    this._applyForces(g, dt);
    this._vorticityConfinement(g, dt);
    this._enforceGridWalls(g);

    this._computeDivergence(g);
    this._solvePressure(this.pressureIterations);
    this._applyPressure(g, dt);
    this._enforceGridWalls(g);

    this._updateMarkers(g, dt);
    this._updateSurfaceMetrics();
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
    const r = this.dx * 0.48;
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

  /** One-pass narrow-band redistancing to restore |∇φ| ≈ 1 near the interface. */
  _reinitializePhi(g) {
    const dx = this.dx;
    const band = dx * 3;
    const next = this.pressureScratch;
    next.set(this.phi);

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          const phi = this.phi[idx];
          if (Math.abs(phi) > band) continue;

          const neighbors = [
            this.phi[g.idx(i + 1, j, k)],
            this.phi[g.idx(i - 1, j, k)],
            this.phi[g.idx(i, j + 1, k)],
            this.phi[g.idx(i, j - 1, k)],
            this.phi[g.idx(i, j, k + 1)],
            this.phi[g.idx(i, j, k - 1)],
          ];

          let best = phi;
          for (const nPhi of neighbors) {
            const sign = phi < 0 ? -1 : 1;
            const candidate = nPhi + sign * dx;
            if (Math.abs(candidate) < Math.abs(best)) best = candidate;
          }
          next[idx] = best;
        }
      }
    }

    this.phi.set(next);
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
            g.vx[idx] = 0;
            g.vy[idx] = 0;
            g.vz[idx] = 0;
            this.prevVx[idx] = 0;
            this.prevVy[idx] = 0;
            this.prevVz[idx] = 0;
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

  _enforceGridWalls(g) {
    const b = this.bounds;
    const pad = this.dx * 0.6;
    const rest = 0.05;

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const pos = g.worldPos(i, j, k);
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;

          let vx = g.vx[idx], vy = g.vy[idx], vz = g.vz[idx];

          if (pos[0] <= b.xMin + pad && vx < 0) vx = -vx * rest;
          if (pos[0] >= b.xMax - pad && vx > 0) vx = -vx * rest;
          if (pos[1] <= b.yMin + pad && vy < 0) vy = -vy * rest;
          if (pos[1] >= b.yMax - pad && vy > 0) vy = -vy * rest;
          if (pos[2] <= b.zMin + pad && vz < 0) vz = -vz * rest;
          if (pos[2] >= b.zMax - pad && vz > 0) vz = -vz * rest;

          g.vx[idx] = vx;
          g.vy[idx] = vy;
          g.vz[idx] = vz;
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
          if (!this._isFluid(idx)) continue;

          let vx = g.vx[idx];
          let vy = g.vy[idx] + dt * this.gravity;
          let vz = g.vz[idx];

          const idxL = g.idx(i - 1, j, k), idxR = g.idx(i + 1, j, k);
          const idxD = g.idx(i, j - 1, k), idxU = g.idx(i, j + 1, k);
          const idxB = g.idx(i, j, k - 1), idxF = g.idx(i, j, k + 1);

          const vxU = g.vx[g.idx(i, j + 1, k)], vxD = g.vx[g.idx(i, j - 1, k)];
          const vxF = g.vx[g.idx(i, j, k + 1)], vxB = g.vx[g.idx(i, j, k - 1)];
          const vyL = g.vy[idxL], vyR = g.vy[idxR];
          const vyF = g.vy[g.idx(i, j, k + 1)], vyB = g.vy[g.idx(i, j, k - 1)];
          const vzL = g.vz[idxL], vzR = g.vz[idxR];
          const vzU = g.vz[idxU], vzD = g.vz[idxD];

          vx += dt * nu * ((g.vx[idxR] - 2 * vx + g.vx[idxL]) / dx2 + (vxU - 2 * vx + vxD) / dx2 + (vxF - 2 * vx + vxB) / dx2);
          vy += dt * nu * ((vyR - 2 * vy + vyL) / dx2 + (g.vy[idxU] - 2 * vy + g.vy[idxD]) / dx2 + (vyF - 2 * vy + vyB) / dx2);
          vz += dt * nu * ((vzR - 2 * vz + vzL) / dx2 + (vzU - 2 * vz + vzD) / dx2 + (g.vz[idxF] - 2 * vz + g.vz[idxB]) / dx2);

          const phi = this.phi[idx];
          if (Math.abs(phi) < dx * 2.5) {
            const phiL = this.phi[idxL], phiR = this.phi[idxR];
            const phiD = this.phi[idxD], phiU = this.phi[idxU];
            const phiB = this.phi[idxB], phiF = this.phi[idxF];
            const gradX = (phiR - phiL) / (2 * dx);
            const gradY = (phiU - phiD) / (2 * dx);
            const gradZ = (phiF - phiB) / (2 * dx);
            const gradLen = Math.hypot(gradX, gradY, gradZ) + 1e-8;
            const kappa = (phiR + phiL + phiU + phiD + phiB + phiF - 6 * phi) / dx2;
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

  _curlAt(g, i, j, k) {
    const dx = this.dx;
    const inv = 1 / (2 * dx);
    const curlX = (g.vz[g.idx(i, j + 1, k)] - g.vz[g.idx(i, j - 1, k)] - g.vy[g.idx(i, j, k + 1)] + g.vy[g.idx(i, j, k - 1)]) * inv;
    const curlY = (g.vx[g.idx(i, j, k + 1)] - g.vx[g.idx(i, j, k - 1)] - g.vz[g.idx(i + 1, j, k)] + g.vz[g.idx(i - 1, j, k)]) * inv;
    const curlZ = (g.vy[g.idx(i + 1, j, k)] - g.vy[g.idx(i - 1, j, k)] - g.vx[g.idx(i, j + 1, k)] + g.vx[g.idx(i, j - 1, k)]) * inv;
    return [curlX, curlY, curlZ, Math.hypot(curlX, curlY, curlZ)];
  }

  _vorticityConfinement(g, dt) {
    const dx = this.dx;
    const eps = this.vorticityEpsilon * dx;

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;

          const [cx, cy, cz, curlMag] = this._curlAt(g, i, j, k);
          if (curlMag < 1e-6) continue;

          const [, , , magL] = this._curlAt(g, i - 1, j, k);
          const [, , , magR] = this._curlAt(g, i + 1, j, k);
          const [, , , magD] = this._curlAt(g, i, j - 1, k);
          const [, , , magU] = this._curlAt(g, i, j + 1, k);
          const [, , , magB] = this._curlAt(g, i, j, k - 1);
          const [, , , magF] = this._curlAt(g, i, j, k + 1);

          const gradMagX = (magR - magL) / (2 * dx);
          const gradMagY = (magU - magD) / (2 * dx);
          const gradMagZ = (magF - magB) / (2 * dx);
          const gradMagLen = Math.hypot(gradMagX, gradMagY, gradMagZ) + 1e-8;

          const nx = gradMagX / gradMagLen;
          const ny = gradMagY / gradMagLen;
          const nz = gradMagZ / gradMagLen;

          const fx = eps * (ny * cz - nz * cy);
          const fy = eps * (nz * cx - nx * cz);
          const fz = eps * (nx * cy - ny * cx);

          g.vx[idx] += dt * fx;
          g.vy[idx] += dt * fy;
          g.vz[idx] += dt * fz;
        }
      }
    }
  }

  _boundaryPressure(idxN, pressureBuf = this.pressure) {
    return this._isFluid(idxN) ? pressureBuf[idxN] : 0;
  }

  _computeDivergence(g) {
    const dx = this.dx;
    this.divergence.fill(0);

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;

          this.divergence[idx] =
            (g.vx[g.idx(i + 1, j, k)] - g.vx[g.idx(i - 1, j, k)]) / (2 * dx) +
            (g.vy[g.idx(i, j + 1, k)] - g.vy[g.idx(i, j - 1, k)]) / (2 * dx) +
            (g.vz[g.idx(i, j, k + 1)] - g.vz[g.idx(i, j, k - 1)]) / (2 * dx);
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

            const pR = this._boundaryPressure(g.idx(i + 1, j, k), cur);
            const pL = this._boundaryPressure(g.idx(i - 1, j, k), cur);
            const pU = this._boundaryPressure(g.idx(i, j + 1, k), cur);
            const pD = this._boundaryPressure(g.idx(i, j - 1, k), cur);
            const pF = this._boundaryPressure(g.idx(i, j, k + 1), cur);
            const pB = this._boundaryPressure(g.idx(i, j, k - 1), cur);

            nxt[idx] = (pR + pL + pU + pD + pF + pB - this.divergence[idx] * dx2) / 6;
          }
        }
      }

      const tmp = cur;
      cur = nxt;
      nxt = tmp;
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

          const pR = this._boundaryPressure(g.idx(i + 1, j, k));
          const pL = this._boundaryPressure(g.idx(i - 1, j, k));
          const pU = this._boundaryPressure(g.idx(i, j + 1, k));
          const pD = this._boundaryPressure(g.idx(i, j - 1, k));
          const pF = this._boundaryPressure(g.idx(i, j, k + 1));
          const pB = this._boundaryPressure(g.idx(i, j, k - 1));

          g.vx[idx] -= scale * (pR - pL);
          g.vy[idx] -= scale * (pU - pD);
          g.vz[idx] -= scale * (pF - pB);
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
    const h = this.dx * 1.1;
    const h2 = h * h;

    for (const m of this.markers) {
      const [dVx, dVy, dVz] = this._sampleGridDelta(g, m.x, m.y, m.z);
      const flipVx = m.vx + dVx;
      const flipVy = m.vy + dVy;
      const flipVz = m.vz + dVz;

      const [picVx, picVy, picVz] = this._sampleGridVelocity(g, m.x, m.y, m.z);

      m.vx = r * flipVx + (1 - r) * picVx;
      m.vy = r * flipVy + (1 - r) * picVy;
      m.vz = r * flipVz + (1 - r) * picVz;

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;

      this._resolveTankWalls(m);
    }

    if (this.xsphStrength > 0 && this.markers.length > 1) {
      this._applyXsph(h, h2);
    }
  }

  _applyXsph(h, h2) {
    const s = this.xsphStrength;
    const n = this.markers.length;
    const avgVx = new Float32Array(n);
    const avgVy = new Float32Array(n);
    const avgVz = new Float32Array(n);
    const weights = new Float32Array(n);

    for (let a = 0; a < n; a++) {
      const ma = this.markers[a];
      let wSum = 0;
      for (let b = 0; b < n; b++) {
        if (a === b) continue;
        const mb = this.markers[b];
        const dx = ma.x - mb.x, dy = ma.y - mb.y, dz = ma.z - mb.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > h2) continue;
        const w = 1 - Math.sqrt(d2) / h;
        avgVx[a] += mb.vx * w;
        avgVy[a] += mb.vy * w;
        avgVz[a] += mb.vz * w;
        wSum += w;
      }
      if (wSum > 1e-8) {
        avgVx[a] /= wSum;
        avgVy[a] /= wSum;
        avgVz[a] /= wSum;
        weights[a] = wSum;
      }
    }

    for (let a = 0; a < n; a++) {
      if (weights[a] < 1e-8) continue;
      const m = this.markers[a];
      m.vx += s * (avgVx[a] - m.vx);
      m.vy += s * (avgVy[a] - m.vy);
      m.vz += s * (avgVz[a] - m.vz);
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

  _updateSurfaceMetrics() {
    const b = this.bounds;
    const cx = (b.xMin + b.xMax) * 0.5;
    const cz = (b.zMin + b.zMax) * 0.5;
    const g = this.grid;
    const { base } = g.nodeFromWorld(cx, this.surfaceY, cz);

    let bestY = this.surfaceY;
    let bestAbsPhi = 1e6;
    for (let j = Math.max(1, base[1] - 4); j <= Math.min(g.ny - 2, base[1] + 8); j++) {
      const pos = g.worldPos(base[0], j, base[2]);
      const idx = g.idx(base[0], j, base[2]);
      const absPhi = Math.abs(this.phi[idx]);
      if (absPhi < bestAbsPhi) {
        bestAbsPhi = absPhi;
        bestY = pos[1];
      }
    }
    this.surfaceY = bestY;

    let velSum = 0;
    let rippleSum = 0;
    let count = 0;
    const band = this.dx * 2.5;

    for (const m of this.markers) {
      if (Math.abs(m.y - this.surfaceY) < band) {
        velSum += m.vx * m.vx + m.vy * m.vy + m.vz * m.vz;
        rippleSum += Math.abs(m.y - this.surfaceY);
        count++;
      }
    }

    this.sloshEnergy = count ? Math.min(1, Math.sqrt(velSum / count) * 6) : 0;
    this.surfaceRipple = count ? Math.min(1, (rippleSum / count) / (this.dx * 1.5) * 4) : 0;
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

    // Light smoothing pass for cleaner marching-cubes isosurface
    const scratch = this.pressureScratch;
    scratch.set(outField);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (scratch[idx] < 1e-6) continue;
          outField[idx] =
            scratch[idx] * 0.4 +
            (scratch[g.idx(i + 1, j, k)] + scratch[g.idx(i - 1, j, k)] +
             scratch[g.idx(i, j + 1, k)] + scratch[g.idx(i, j - 1, k)] +
             scratch[g.idx(i, j, k + 1)] + scratch[g.idx(i, j, k - 1)]) * 0.1;
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
    return this.sloshEnergy || (() => {
      let sum = 0, n = 0;
      for (const m of this.markers) {
        if (Math.abs(m.y - surfaceY) < band) {
          sum += m.vx * m.vx + m.vy * m.vy + m.vz * m.vz;
          n++;
        }
      }
      return n ? Math.min(1, Math.sqrt(sum / n) * 6) : 0;
    })();
  }

  getVolumeLiters() {
    return (this.markers.length * this.markerMass / this.rho * 1000).toFixed(1);
  }
}
