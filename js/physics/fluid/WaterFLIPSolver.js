import { Grid3D } from "../mpm/Grid3D.js";
import { Mat3 } from "../mpm/Mat3.js";
import { tankBounds } from "../WaterTank.js";
import { SpatialHash } from "./SpatialHash.js";
import { WaterTemperatureField } from "./WaterTemperatureField.js";

/**
 * Research-grade FLIP/APIC water solver:
 * - Affine Particle-In-Cell transfer (Jiang et al. 2015)
 * - Signed-distance φ + Ghost-Fluid weighted Poisson (Gibou et al.)
 * - RB-GS warm-up + Jacobi-preconditioned CG pressure solve
 * - CSF surface tension + Marangoni stress from ∇T
 * - Semi-Lagrangian temperature advection–diffusion with boiling nucleation
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
    this.apicEnabled = true;
    this.vorticityEpsilon = 0.15;
    this.xsphStrength = 0.04;
    this.marangoniCoeff = -8e-5;
    this.cflTarget = 0.45;
    this.resampleInterval = 8;
    this._stepCount = 0;

    this.markers = [];
    this.maxMarkers = 12000;
    this.markerMass = this.rho * dx ** 3 * 0.125;
    this.pressureIterations = 35;
    this.pcgIterations = 16;
    this.rbgWarmupRatio = 0.35;

    const n = this.grid.count;
    this.pressure = new Float32Array(n);
    this.pressureScratch = new Float32Array(n);
    this.phiScratch = new Float32Array(n);
    this.divergence = new Float32Array(n);
    this.phi = new Float32Array(n);
    this.densityField = new Float32Array(n);
    this.fluidMask = new Uint8Array(n);
    this.prevVx = new Float32Array(n);
    this.prevVy = new Float32Array(n);
    this.prevVz = new Float32Array(n);
    this.cgR = new Float32Array(n);
    this.cgZ = new Float32Array(n);
    this.cgP = new Float32Array(n);
    this.cgAp = new Float32Array(n);
    this.faceWeight = new Float32Array(n * 6);
    this.spatialHash = new SpatialHash(dx * 1.2);
    this.temperature = new WaterTemperatureField(n, dx);
    this.phi.fill(1e3);

    this.surfaceY = this.bounds.yMin + (this.bounds.yMax - this.bounds.yMin) * tank.fillRatio;
    this.sloshEnergy = 0;
    this.surfaceRipple = 0;
    this.maxTemperature = 22;
    this.lastPressureResidual = 0;
  }

  reset() {
    this.markers.length = 0;
    this.phi.fill(1e3);
    this.pressure.fill(0);
    this.densityField.fill(0);
    this.sloshEnergy = 0;
    this.surfaceRipple = 0;
    this.maxTemperature = 22;
    this.lastPressureResidual = 0;
    this._stepCount = 0;
    this.temperature.reset();
  }

  _createMarker(props) {
    const C = new Mat3();
    C.m.fill(0);
    return {
      vx: 0, vy: 0, vz: 0,
      mass: this.markerMass,
      C,
      ...props,
    };
  }

  step(dt) {
    dt = this._clampCfl(dt);
    const g = this.grid;
    g.reset();

    for (const m of this.markers) {
      this._transferMarker(m, g);
    }

    this._buildLevelSet(g);
    this._reinitializePhi(g);
    this._classifyFluidCells(g);
    this._computeFaceWeights(g);
    this._normalizeAndSaveGridVelocities(g);
    this._enforceGridWalls(g);

    this._applyForces(g, dt);
    this._applyMarangoni(g, dt);
    this._vorticityConfinement(g, dt);
    this._enforceGridWalls(g);

    this.temperature.step(g, this.fluidMask, dt, (x, y, z) => this._sampleGridVelocity(g, x, y, z));

    this._computeDivergence(g);
    this._solvePressure(this.pressureIterations);
    this._applyPressure(g, dt);
    this._enforceGridWalls(g);

    this._updateMarkers(g, dt);

    this._stepCount++;
    if (this._stepCount % this.resampleInterval === 0) {
      this._separateMarkers(this.dx * 0.55);
    }

    this._updateSurfaceMetrics();
    this.maxTemperature = this.temperature.getMaxTemp();
  }

  _clampCfl(dt) {
    let vmax = 0;
    for (const m of this.markers) {
      const s2 = m.vx * m.vx + m.vy * m.vy + m.vz * m.vz;
      if (s2 > vmax) vmax = s2;
    }
    vmax = Math.sqrt(vmax);
    const cflDt = this.cflTarget * this.dx / (vmax + 1e-6);
    return Math.min(dt, 4e-4, cflDt);
  }

  _faceWeightIdx(idx, face) {
    return idx * 6 + face;
  }

  /** Ghost-Fluid face fractions θ ∈ [0,1] from φ (Gibou partial-cell weighting). */
  _computeFaceWeights(g) {
    const dx = this.dx;
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          const phi = this.phi[idx];
          const thetaAir = Math.max(0.15, Math.min(1, 0.5 - phi / dx));

          const set = (face, nIdx) => {
            this.faceWeight[this._faceWeightIdx(idx, face)] = this._isFluid(nIdx) ? 1 : thetaAir;
          };
          set(0, g.idx(i + 1, j, k));
          set(1, g.idx(i - 1, j, k));
          set(2, g.idx(i, j + 1, k));
          set(3, g.idx(i, j - 1, k));
          set(4, g.idx(i, j, k + 1));
          set(5, g.idx(i, j, k - 1));
        }
      }
    }
  }

  _theta(idx, face) {
    return this.faceWeight[this._faceWeightIdx(idx, face)] || 1;
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
    const C = m.C?.m;
    const apic = this.apicEnabled && C;

    for (let gi = 0; gi < 3; gi++) {
      for (let gj = 0; gj < 3; gj++) {
        for (let gk = 0; gk < 3; gk++) {
          const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
          const weight = wx[gi] * wy[gj] * wz[gk];
          if (weight < 1e-10) continue;
          const idx = g.idx(i, j, k);

          let vx = m.vx, vy = m.vy, vz = m.vz;
          if (apic) {
            const pos = g.worldPos(i, j, k);
            const d0 = pos[0] - m.x, d1 = pos[1] - m.y, d2 = pos[2] - m.z;
            vx += C[0] * d0 + C[3] * d1 + C[6] * d2;
            vy += C[1] * d0 + C[4] * d1 + C[7] * d2;
            vz += C[2] * d0 + C[5] * d1 + C[8] * d2;
          }

          g.mass[idx] += weight * mp;
          g.vx[idx] += weight * mp * vx;
          g.vy[idx] += weight * mp * vy;
          g.vz[idx] += weight * mp * vz;
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
    const next = this.phiScratch;
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
            const nx = gradX / gradLen, ny = gradY / gradLen, nz = gradZ / gradLen;
            const kappa = (
              (phiR + phiL + phiU + phiD + phiB + phiF - 6 * phi) / dx2
            );
            const stScale = this.sigma * kappa / this.rho;
            vx += dt * stScale * nx;
            vy += dt * stScale * ny;
            vz += dt * stScale * nz;
          }

          g.vx[idx] = vx;
          g.vy[idx] = vy;
          g.vz[idx] = vz;
        }
      }
    }
  }

  /** Marangoni traction τ = (dσ/dT) ∇T_⊥ at the free surface (thermocapillary). */
  _applyMarangoni(g, dt) {
    const dx = this.dx;
    const dSigmaDT = this.marangoniCoeff;

    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          if (Math.abs(this.phi[idx]) > dx * 2.5) continue;

          const [gx, gy, gz] = this.temperature.gradientAt(g, i, j, k, this.fluidMask);
          const phiL = this.phi[g.idx(i - 1, j, k)], phiR = this.phi[g.idx(i + 1, j, k)];
          const phiD = this.phi[g.idx(i, j - 1, k)], phiU = this.phi[g.idx(i, j + 1, k)];
          const phiB = this.phi[g.idx(i, j, k - 1)], phiF = this.phi[g.idx(i, j, k + 1)];
          const nx = (phiR - phiL) / (2 * dx);
          const ny = (phiU - phiD) / (2 * dx);
          const nz = (phiF - phiB) / (2 * dx);
          const nLen = Math.hypot(nx, ny, nz) + 1e-8;
          const nnx = nx / nLen, nny = ny / nLen, nnz = nz / nLen;
          const gDotN = gx * nnx + gy * nny + gz * nnz;
          const tgx = gx - gDotN * nnx;
          const tgy = gy - gDotN * nny;
          const tgz = gz - gDotN * nnz;
          const scale = dSigmaDT / this.rho;
          g.vx[idx] += dt * scale * tgx;
          g.vy[idx] += dt * scale * tgy;
          g.vz[idx] += dt * scale * tgz;
        }
      }
    }
  }

  _diagWeight(idx) {
    return (
      this._theta(idx, 0) + this._theta(idx, 1) +
      this._theta(idx, 2) + this._theta(idx, 3) +
      this._theta(idx, 4) + this._theta(idx, 5)
    );
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
    const warmup = Math.max(4, Math.floor(iterations * this.rbgWarmupRatio));
    this._solvePressureRBGS(warmup);
    this._solvePressurePCG(Math.min(this.pcgIterations, iterations - warmup + 8));
  }

  _solvePressureRBGS(iterations) {
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

            const idxR = g.idx(i + 1, j, k), idxL = g.idx(i - 1, j, k);
            const idxU = g.idx(i, j + 1, k), idxD = g.idx(i, j - 1, k);
            const idxF = g.idx(i, j, k + 1), idxB = g.idx(i, j, k - 1);

            const wR = this._theta(idx, 0), wL = this._theta(idx, 1);
            const wU = this._theta(idx, 2), wD = this._theta(idx, 3);
            const wF = this._theta(idx, 4), wB = this._theta(idx, 5);
            const diag = wR + wL + wU + wD + wF + wB;

            const sum =
              wR * this._boundaryPressure(idxR, cur) +
              wL * this._boundaryPressure(idxL, cur) +
              wU * this._boundaryPressure(idxU, cur) +
              wD * this._boundaryPressure(idxD, cur) +
              wF * this._boundaryPressure(idxF, cur) +
              wB * this._boundaryPressure(idxB, cur);

            nxt[idx] = (sum - this.divergence[idx] * dx2) / diag;
          }
        }
      }

      const tmp = cur;
      cur = nxt;
      nxt = tmp;
    }

    if (cur !== this.pressure) this.pressure.set(cur);
  }

  _applyPoisson(x, out) {
    const g = this.grid;
    out.fill(0);
    for (let k = 1; k < g.nz - 1; k++) {
      for (let j = 1; j < g.ny - 1; j++) {
        for (let i = 1; i < g.nx - 1; i++) {
          const idx = g.idx(i, j, k);
          if (!this._isFluid(idx)) continue;
          const idxR = g.idx(i + 1, j, k), idxL = g.idx(i - 1, j, k);
          const idxU = g.idx(i, j + 1, k), idxD = g.idx(i, j - 1, k);
          const idxF = g.idx(i, j, k + 1), idxB = g.idx(i, j, k - 1);
          const wR = this._theta(idx, 0), wL = this._theta(idx, 1);
          const wU = this._theta(idx, 2), wD = this._theta(idx, 3);
          const wF = this._theta(idx, 4), wB = this._theta(idx, 5);
          const sum =
            wR * this._boundaryPressure(idxR, x) +
            wL * this._boundaryPressure(idxL, x) +
            wU * this._boundaryPressure(idxU, x) +
            wD * this._boundaryPressure(idxD, x) +
            wF * this._boundaryPressure(idxF, x) +
            wB * this._boundaryPressure(idxB, x);
          out[idx] = this._diagWeight(idx) * x[idx] - sum;
        }
      }
    }
  }

  _fluidDot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      if (this.fluidMask[i]) s += a[i] * b[i];
    }
    return s;
  }

  _solvePressurePCG(maxIter) {
    const g = this.grid;
    const dx2 = this.dx * this.dx;
    const p = this.pressure;
    const r = this.cgR;
    const z = this.cgZ;
    const q = this.cgP;
    const Ap = this.cgAp;

    for (let idx = 0; idx < g.count; idx++) {
      r[idx] = this._isFluid(idx) ? this.divergence[idx] * dx2 : 0;
    }
    this._applyPoisson(p, Ap);
    for (let idx = 0; idx < g.count; idx++) {
      if (this._isFluid(idx)) r[idx] -= Ap[idx];
    }

    for (let idx = 0; idx < g.count; idx++) {
      if (this._isFluid(idx)) {
        const d = this._diagWeight(idx);
        z[idx] = d > 1e-8 ? r[idx] / d : r[idx];
      }
    }

    let rz = this._fluidDot(r, z);
    if (rz < 1e-20) return;

    q.set(z);

    for (let it = 0; it < maxIter; it++) {
      this._applyPoisson(q, Ap);
      const alpha = rz / (this._fluidDot(q, Ap) + 1e-20);
      for (let idx = 0; idx < g.count; idx++) {
        if (this._isFluid(idx)) p[idx] += alpha * q[idx];
      }
      for (let idx = 0; idx < g.count; idx++) {
        if (this._isFluid(idx)) r[idx] -= alpha * Ap[idx];
      }
      for (let idx = 0; idx < g.count; idx++) {
        if (this._isFluid(idx)) {
          const d = this._diagWeight(idx);
          z[idx] = d > 1e-8 ? r[idx] / d : r[idx];
        }
      }
      const rzNew = this._fluidDot(r, z);
      if (rzNew < 1e-14) break;
      const beta = rzNew / rz;
      for (let idx = 0; idx < g.count; idx++) {
        if (this._isFluid(idx)) q[idx] = z[idx] + beta * q[idx];
      }
      rz = rzNew;
    }
    this.lastPressureResidual = Math.sqrt(this._fluidDot(r, r));
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
    const invDx = g.invDx;
    const w = [0, 0, 0], dw = [0, 0, 0];
    const cellDist = new Float32Array(3);

    for (const m of this.markers) {
      const [dVx, dVy, dVz] = this._sampleGridDelta(g, m.x, m.y, m.z);
      const flipVx = m.vx + dVx;
      const flipVy = m.vy + dVy;
      const flipVz = m.vz + dVz;

      const [picVx, picVy, picVz] = this._sampleGridVelocity(g, m.x, m.y, m.z);

      m.vx = r * flipVx + (1 - r) * picVx;
      m.vy = r * flipVy + (1 - r) * picVy;
      m.vz = r * flipVz + (1 - r) * picVz;

      if (this.apicEnabled && m.C) {
        m.C.m.fill(0);
        const { base, frac } = g.nodeFromWorld(m.x, m.y, m.z);
        Grid3D.bsplineWeights(frac[0], w, dw);
        const wx = w.slice();
        Grid3D.bsplineWeights(frac[1], w, dw);
        const wy = w.slice();
        Grid3D.bsplineWeights(frac[2], w, dw);
        const wz = w.slice();

        for (let gi = 0; gi < 3; gi++) {
          for (let gj = 0; gj < 3; gj++) {
            for (let gk = 0; gk < 3; gk++) {
              const i = base[0] + gi, j = base[1] + gj, k = base[2] + gk;
              if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) continue;
              const weight = wx[gi] * wy[gj] * wz[gk];
              if (weight < 1e-10) continue;
              const idx = g.idx(i, j, k);
              if (!this._isFluid(idx)) continue;
              g.worldPos(i, j, k, cellDist);
              cellDist[0] = (cellDist[0] - m.x) * invDx;
              cellDist[1] = (cellDist[1] - m.y) * invDx;
              cellDist[2] = (cellDist[2] - m.z) * invDx;
              const cScale = 4 * invDx * weight;
              const vx = g.vx[idx], vy = g.vy[idx], vz = g.vz[idx];
              const C = m.C.m;
              C[0] += cScale * vx * cellDist[0]; C[3] += cScale * vx * cellDist[1]; C[6] += cScale * vx * cellDist[2];
              C[1] += cScale * vy * cellDist[0]; C[4] += cScale * vy * cellDist[1]; C[7] += cScale * vy * cellDist[2];
              C[2] += cScale * vz * cellDist[0]; C[5] += cScale * vz * cellDist[1]; C[8] += cScale * vz * cellDist[2];
            }
          }
        }
      }

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;

      this._resolveTankWalls(m);
    }

    if (this.xsphStrength > 0 && this.markers.length > 1) {
      this._applyXsph(h);
    }
  }

  /** Public velocity sample for smoke/bubble coupling (uses last step's grid state). */
  sampleVelocityAt(x, y, z) {
    return this._sampleGridVelocity(this.grid, x, y, z);
  }

  /** Free-surface height from level-set φ zero crossing at (x, z). */
  sampleSurfaceHeightAt(x, z) {
    const g = this.grid;
    const { base } = g.nodeFromWorld(x, this.surfaceY, z);
    const i = Math.max(1, Math.min(g.nx - 2, base[0]));
    const k = Math.max(1, Math.min(g.nz - 2, base[2]));

    for (let j = 1; j < g.ny - 2; j++) {
      const phi0 = this.phi[g.idx(i, j, k)];
      const phi1 = this.phi[g.idx(i, j + 1, k)];
      if (phi0 < 0 && phi1 >= 0) {
        const t = phi0 / (phi0 - phi1 + 1e-10);
        const y0 = g.worldPos(i, j, k)[1];
        return y0 + t * this.dx;
      }
    }
    return this.surfaceY;
  }

  /** Radial impulse on surface markers (boil splash / recoil ring). */
  applySurfaceRingImpulse(x, y, z, radius, strength) {
    const r2 = radius * radius;
    const surfaceY = this.sampleSurfaceHeightAt(x, z);
    const band = this.dx * 3;

    for (const m of this.markers) {
      if (Math.abs(m.y - surfaceY) > band) continue;
      const dx = m.x - x, dz = m.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 || d2 < 1e-12) continue;
      const w = Math.exp(-d2 / (r2 * 0.45));
      const invDist = 1 / Math.sqrt(d2);
      m.vx += dx * invDist * strength * w;
      m.vy += strength * w * 0.35;
      m.vz += dz * invDist * strength * w;
    }
  }

  _applyXsph(h) {
    const s = this.xsphStrength;
    const markers = this.markers;
    const n = markers.length;
    if (n < 2) return;

    const hash = this.spatialHash;
    hash.clear();
    for (let a = 0; a < n; a++) {
      const m = markers[a];
      hash.insert(a, m.x, m.y, m.z);
    }

    const avgVx = new Float32Array(n);
    const avgVy = new Float32Array(n);
    const avgVz = new Float32Array(n);
    const wSum = new Float32Array(n);

    for (let a = 0; a < n; a++) {
      const ma = markers[a];
      hash.forEachNeighbor(ma.x, ma.y, ma.z, h, (b, r2) => {
        if (a === b) return;
        const mb = markers[b];
        const dx = ma.x - mb.x, dy = ma.y - mb.y, dz = ma.z - mb.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) return;
        const w = 1 - Math.sqrt(d2) / h;
        avgVx[a] += mb.vx * w;
        avgVy[a] += mb.vy * w;
        avgVz[a] += mb.vz * w;
        wSum[a] += w;
      });
    }

    for (let a = 0; a < n; a++) {
      if (wSum[a] < 1e-8) continue;
      const inv = 1 / wSum[a];
      const m = markers[a];
      m.vx += s * (avgVx[a] * inv - m.vx);
      m.vy += s * (avgVy[a] * inv - m.vy);
      m.vz += s * (avgVz[a] * inv - m.vz);
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

  /** Inject heat [W] at world position (feeds temperature field). */
  injectHeat(x, y, z, powerWatts, dt, radius = this.dx * 3) {
    this.temperature.injectHeat(this.grid, this.fluidMask, x, y, z, powerWatts, dt, radius);
  }

  _separateMarkers(minDist) {
    const markers = this.markers;
    const n = markers.length;
    if (n < 2) return;
    const minD2 = minDist * minDist;
    const hash = this.spatialHash;
    hash.clear();
    for (let a = 0; a < n; a++) hash.insert(a, markers[a].x, markers[a].y, markers[a].z);

    for (let a = 0; a < n; a++) {
      const ma = markers[a];
      hash.forEachNeighbor(ma.x, ma.y, ma.z, minDist, (b, r2) => {
        if (a >= b) return;
        const mb = markers[b];
        const dx = ma.x - mb.x, dy = ma.y - mb.y, dz = ma.z - mb.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minD2 || d2 < 1e-16) return;
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        ma.x += nx * push; ma.y += ny * push; ma.z += nz * push;
        mb.x -= nx * push; mb.y -= ny * push; mb.z -= nz * push;
      });
    }
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

  sampleDensity(outField, opts = {}) {
    const smooth = opts.smooth !== false;
    outField.fill(0);
    const g = this.grid;
    const invR = 1 / (this.dx * 1.2);
    const r2 = (this.dx * 1.5) ** 2;

    for (const m of this.markers) {
      const { base } = g.nodeFromWorld(m.x, m.y, m.z);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let dk = -1; dk <= 1; dk++) {
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

    if (!smooth) return;

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

  /** Runtime diagnostics for QA / E2E assertions. */
  getDiagnostics() {
    let fluidCells = 0;
    for (let i = 0; i < this.fluidMask.length; i++) {
      if (this.fluidMask[i]) fluidCells++;
    }
    return {
      markers: this.markers.length,
      volumeL: parseFloat(this.getVolumeLiters()),
      surfaceY: this.surfaceY,
      sloshEnergy: this.sloshEnergy,
      surfaceRipple: this.surfaceRipple,
      maxTemperature: this.maxTemperature,
      pressureResidual: this.lastPressureResidual,
      fluidCells,
      apicEnabled: this.apicEnabled,
      gridSize: [this.grid.nx, this.grid.ny, this.grid.nz],
      dx: this.dx,
    };
  }
}
