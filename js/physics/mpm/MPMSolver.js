import { Grid3D } from "./Grid3D.js";
import { Mat3 } from "./Mat3.js";
import { computeStress, stressForceContribution, MATERIAL_PARAMS } from "./NeoHookean.js";
import { clamp } from "../math.js";

const _w = [0, 0, 0];
const _dw = [0, 0, 0];
const _cellDist = new Float32Array(3);
const _force = new Float32Array(3);
const _gradV = new Mat3();
const _dF = new Mat3();
const _Fnew = new Mat3();

export class MPMSolver {
  constructor(options = {}) {
    this.dx = options.dx ?? 0.004;
    this.origin = options.origin ?? [-0.08, -0.01, -0.08];
    this.nx = options.nx ?? 40;
    this.ny = options.ny ?? 40;
    this.nz = options.nz ?? 40;
    this.gravity = options.gravity ?? -9.81;
    this.groundY = options.groundY ?? 0;
    this.friction = options.friction ?? 0.35;

    this.grid = new Grid3D(this.nx, this.ny, this.nz, this.origin, this.dx);
    this.particles = [];
    this.maxParticles = options.maxParticles ?? 50000;

    this.pressPlateY = 0.09;
    this.pressPlateActive = false;
    this.pressForce = 0;
    this.pressDisplacement = 0;
    this.pressRestY = 0.09;

    this.totalEnergy = 0;
    this.maxStrainEnergy = 0;
  }

  addParticle(p) {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push({
      x: new Float32Array(p.x),
      v: new Float32Array(p.v ?? [0, 0, 0]),
      F: new Mat3().identity(),
      C: new Mat3(),
      volume: p.volume,
      mass: p.mass,
      material: p.material,
      damage: 0,
      active: true,
      fluidConverted: false,
    });
  }

  reset() {
    this.particles.length = 0;
    this.grid.reset();
    this.pressPlateY = this.pressRestY;
    this.pressForce = 0;
    this.pressDisplacement = 0;
    this.totalEnergy = 0;
    this.maxStrainEnergy = 0;
  }

  setPressPlate(y, active) {
    this.pressPlateY = y;
    this.pressPlateActive = active;
    this.pressDisplacement = this.pressRestY - y;
  }

  step(dt) {
    dt = Math.min(dt, 2e-4);
    const substeps = 1;
    const sdt = dt / substeps;
    let ruptureEvents = [];

    for (let s = 0; s < substeps; s++) {
      ruptureEvents = ruptureEvents.concat(this._substep(sdt));
    }

    return ruptureEvents;
  }

  _substep(dt) {
    const grid = this.grid;
    grid.reset();
    const dx = this.dx;
    const invDx = grid.invDx;
    const ruptureEvents = [];

    // P2G
    for (const p of this.particles) {
      if (!p.active || p.fluidConverted) continue;

      const { base, frac } = grid.nodeFromWorld(p.x[0], p.x[1], p.x[2]);
      Grid3D.bsplineWeights(frac[0], _w, _dw);
      const wx = _w.slice();
      const dwx = _dw.slice();
      Grid3D.bsplineWeights(frac[1], _w, _dw);
      const wy = _w.slice();
      const dwy = _dw.slice();
      Grid3D.bsplineWeights(frac[2], _w, _dw);
      const wz = _w.slice();
      const dwz = _dw.slice();

      const { stress, psi } = computeStress(p.F, p.material, p.damage, p.volume);
      const params = MATERIAL_PARAMS[p.material];

      for (let gi = 0; gi < 3; gi++) {
        for (let gj = 0; gj < 3; gj++) {
          for (let gk = 0; gk < 3; gk++) {
            const i = base[0] + gi;
            const j = base[1] + gj;
            const k = base[2] + gk;
            if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) continue;

            const w = wx[gi] * wy[gj] * wz[gk];
            if (w < 1e-12) continue;

            const idx = grid.idx(i, j, k);
            grid.mass[idx] += w * p.mass;
            grid.active[idx] = 1;

            grid.worldPos(i, j, k, _cellDist);
            _cellDist[0] = (_cellDist[0] - p.x[0]) * invDx;
            _cellDist[1] = (_cellDist[1] - p.x[1]) * invDx;
            _cellDist[2] = (_cellDist[2] - p.x[2]) * invDx;

            const mv0 = w * p.mass * (p.v[0] + p.C.m[0] * _cellDist[0] + p.C.m[3] * _cellDist[1] + p.C.m[6] * _cellDist[2]);
            const mv1 = w * p.mass * (p.v[1] + p.C.m[1] * _cellDist[0] + p.C.m[4] * _cellDist[1] + p.C.m[7] * _cellDist[2]);
            const mv2 = w * p.mass * (p.v[2] + p.C.m[2] * _cellDist[0] + p.C.m[5] * _cellDist[1] + p.C.m[8] * _cellDist[2]);

            grid.vx[idx] += mv0;
            grid.vy[idx] += mv1;
            grid.vz[idx] += mv2;

            const dwxi = dwx[gi] * wy[gj] * wz[gk] * invDx;
            const dwyj = wx[gi] * dwy[gj] * wz[gk] * invDx;
            const dwzk = wx[gi] * wy[gj] * dwz[gk] * invDx;

            _force[0] = 0; _force[1] = 0; _force[2] = 0;
            stressForceContribution(stress, p.volume, dwxi, [1, 0, 0], _force);
            stressForceContribution(stress, p.volume, dwyj, [0, 1, 0], _force);
            stressForceContribution(stress, p.volume, dwzk, [0, 0, 1], _force);

            grid.fx[idx] += _force[0];
            grid.fy[idx] += _force[1];
            grid.fz[idx] += _force[2];

            grid.psi[idx] = Math.max(grid.psi[idx], psi);
            if (psi > params.psiCrit * 0.5) {
              grid.damage[idx] = Math.min(1, grid.damage[idx] + params.damageRate * dt * (psi / params.psiCrit));
            }
          }
        }
      }
    }

    // Grid update
    this.pressForce = 0;
    let ke = 0;

    for (let k = 0; k < grid.nz; k++) {
      for (let j = 0; j < grid.ny; j++) {
        for (let i = 0; i < grid.nx; i++) {
          const idx = grid.idx(i, j, k);
          const m = grid.mass[idx];
          if (m < 1e-12) continue;

          let vx = grid.vx[idx] / m + dt * grid.fx[idx] / m;
          let vy = grid.vy[idx] / m + dt * grid.fy[idx] / m + dt * this.gravity;
          let vz = grid.vz[idx] / m + dt * grid.fz[idx] / m;

          const pos = grid.worldPos(i, j, k);

          // Ground contact (Signorini + Coulomb)
          if (pos[1] < this.groundY && vy < 0) {
            vy = -vy * this.friction;
            vx *= 1 - this.friction * 0.5;
            vz *= 1 - this.friction * 0.5;
          }

          // Press plate contact
          if (this.pressPlateActive && pos[1] > this.pressPlateY && vy > 0) {
            const penetration = pos[1] - this.pressPlateY;
            vy = -Math.abs(vy) * 0.1;
            this.pressForce += m * Math.abs(this.gravity) + penetration * 1e5 * dt;
          }

          // Domain walls
          const pad = 2;
          if (i <= pad && vx < 0) vx = 0;
          if (i >= grid.nx - pad - 1 && vx > 0) vx = 0;
          if (k <= pad && vz < 0) vz = 0;
          if (k >= grid.nz - pad - 1 && vz > 0) vz = 0;
          if (j <= 1 && vy < 0) vy = 0;

          grid.vx[idx] = vx;
          grid.vy[idx] = vy;
          grid.vz[idx] = vz;

          ke += 0.5 * m * (vx * vx + vy * vy + vz * vz);
        }
      }
    }

    this.totalEnergy = ke + this.maxStrainEnergy;

    // G2P
    for (const p of this.particles) {
      if (!p.active || p.fluidConverted) continue;

      const { base, frac } = grid.nodeFromWorld(p.x[0], p.x[1], p.x[2]);
      Grid3D.bsplineWeights(frac[0], _w, _dw);
      const wx = _w.slice();
      Grid3D.bsplineWeights(frac[1], _w, _dw);
      const wy = _w.slice();
      Grid3D.bsplineWeights(frac[2], _w, _dw);
      const wz = _w.slice();

      let newV = [0, 0, 0];
      p.C.identity();
      let maxGridDamage = 0;
      let maxPsi = 0;

      for (let gi = 0; gi < 3; gi++) {
        for (let gj = 0; gj < 3; gj++) {
          for (let gk = 0; gk < 3; gk++) {
            const i = base[0] + gi;
            const j = base[1] + gj;
            const k = base[2] + gk;
            if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) continue;

            const w = wx[gi] * wy[gj] * wz[gk];
            if (w < 1e-12) continue;

            const idx = grid.idx(i, j, k);
            const vx = grid.vx[idx];
            const vy = grid.vy[idx];
            const vz = grid.vz[idx];

            newV[0] += w * vx;
            newV[1] += w * vy;
            newV[2] += w * vz;

            grid.worldPos(i, j, k, _cellDist);
            _cellDist[0] = (_cellDist[0] - p.x[0]) * invDx;
            _cellDist[1] = (_cellDist[1] - p.x[1]) * invDx;
            _cellDist[2] = (_cellDist[2] - p.x[2]) * invDx;

            const cScale = 4 * invDx * w;
            p.C.m[0] += cScale * vx * _cellDist[0]; p.C.m[3] += cScale * vx * _cellDist[1]; p.C.m[6] += cScale * vx * _cellDist[2];
            p.C.m[1] += cScale * vy * _cellDist[0]; p.C.m[4] += cScale * vy * _cellDist[1]; p.C.m[7] += cScale * vy * _cellDist[2];
            p.C.m[2] += cScale * vz * _cellDist[0]; p.C.m[5] += cScale * vz * _cellDist[1]; p.C.m[8] += cScale * vz * _cellDist[2];

            maxGridDamage = Math.max(maxGridDamage, grid.damage[idx]);
            maxPsi = Math.max(maxPsi, grid.psi[idx]);
          }
        }
      }

      p.v[0] = newV[0]; p.v[1] = newV[1]; p.v[2] = newV[2];
      p.x[0] += newV[0] * dt;
      p.x[1] += newV[1] * dt;
      p.x[2] += newV[2] * dt;

      // Update F: F = (I + dt*∇v) F
      _gradV.copy(p.C);
      Mat3.scale(_gradV, dt, _dF);
      Mat3.addScaledIdentity(_dF, 1, _dF);
      Mat3.mul(_dF, p.F, _Fnew);
      p.F.copy(_Fnew);

      // Phase-field damage transfer
      p.damage = Math.max(p.damage, maxGridDamage);
      this.maxStrainEnergy = Math.max(this.maxStrainEnergy, maxPsi * p.volume);

      const params = MATERIAL_PARAMS[p.material];
      if (p.damage > 0.85 && p.material !== 3 && !p.fluidConverted) {
        p.fluidConverted = true;
        ruptureEvents.push({
          x: p.x.slice(),
          v: p.v.slice(),
          material: p.material,
          intensity: p.damage,
          volume: p.volume,
        });
      }
    }

    return ruptureEvents;
  }

  /** Sample mass density field for marching cubes. */
  sampleDensity(out, scale = 1) {
    out.fill(0);
    const grid = this.grid;
    for (const p of this.particles) {
      if (!p.active || p.fluidConverted) continue;
      const { base, frac } = grid.nodeFromWorld(p.x[0], p.x[1], p.x[2]);
      Grid3D.bsplineWeights(frac[0], _w, _dw);
      const wx = _w.slice();
      Grid3D.bsplineWeights(frac[1], _w, _dw);
      const wy = _w.slice();
      Grid3D.bsplineWeights(frac[2], _w, _dw);
      const wz = _w.slice();

      for (let gi = 0; gi < 3; gi++) {
        for (let gj = 0; gj < 3; gj++) {
          for (let gk = 0; gk < 3; gk++) {
            const i = base[0] + gi;
            const j = base[1] + gj;
            const k = base[2] + gk;
            if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) continue;
            const w = wx[gi] * wy[gj] * wz[gk];
            out[grid.idx(i, j, k)] += w * p.mass * scale;
          }
        }
      }
    }
  }

  getActiveCount() {
    return this.particles.filter((p) => p.active && !p.fluidConverted).length;
  }

  getMaxDamage() {
    let d = 0;
    for (const p of this.particles) d = Math.max(d, p.damage);
    return d;
  }
}
