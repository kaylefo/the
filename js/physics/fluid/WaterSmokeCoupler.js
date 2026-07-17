import { tankBounds } from "../WaterTank.js";

/**
 * Two-way lite coupling between FLIP water and stable-fluids steam.
 * Steam near the free surface inherits horizontal water velocity; submerged
 * steam gets buoyancy boost and drag from the liquid flow field.
 */
export class WaterSmokeCoupler {
  constructor(tank) {
    this.bounds = tankBounds(tank);
    this.surfaceBand = 0.018;
    this.couplingStrength = 0.55;
    this.submergedDrag = 0.8;
  }

  /**
   * @param {import("./WaterFLIPSolver.js").WaterFLIPSolver} water
   * @param {import("../smoke/StableFluidsSmoke.js").StableFluidsSmoke} smoke
   */
  step(water, smoke, dt) {
    if (!water || !smoke) return;
    const surfaceY = water.surfaceY;
    const band = this.surfaceBand;
    const str = this.couplingStrength;
    const drag = this.submergedDrag;

    smoke._forEachActive((i, j, k) => {
      const pos = smoke.worldPos(i, j, k);
      const idx = smoke.idx(i, j, k);
      const d = smoke.density[idx];
      if (d < 1e-5) return;

      const [wx, wy, wz] = water.sampleVelocityAt(pos[0], pos[1], pos[2]);
      const dy = pos[1] - surfaceY;

      if (dy < band && dy > -band * 2) {
        // Interface shear — steam picks up surface slosh
        smoke.vx[idx] += (wx - smoke.vx[idx]) * str * dt * 8 * d;
        smoke.vz[idx] += (wz - smoke.vz[idx]) * str * dt * 8 * d;
        if (dy > 0) {
          smoke.vy[idx] += Math.max(0, wy) * str * dt * 4 * d;
        }
      } else if (dy < -band * 2) {
        // Submerged nucleate boiling — bubbles entrained in liquid motion
        smoke.vx[idx] += (wx - smoke.vx[idx]) * drag * dt * 3 * d;
        smoke.vy[idx] += (wy - smoke.vy[idx]) * drag * dt * 2 * d + dt * 0.4 * d;
        smoke.vz[idx] += (wz - smoke.vz[idx]) * drag * dt * 3 * d;
      } else if (dy > band && water.sloshEnergy > 0.05) {
        // Just above surface — wind from slosh pushes steam sideways
        smoke.vx[idx] += wx * water.sloshEnergy * dt * 2 * d;
        smoke.vz[idx] += wz * water.sloshEnergy * dt * 2 * d;
      }

      // Clamp steam inside tank volume (soft)
      const b = this.bounds;
      if (pos[0] < b.xMin) smoke.vx[idx] += dt * 2;
      if (pos[0] > b.xMax) smoke.vx[idx] -= dt * 2;
      if (pos[2] < b.zMin) smoke.vz[idx] += dt * 2;
      if (pos[2] > b.zMax) smoke.vz[idx] -= dt * 2;
    });
  }
}
