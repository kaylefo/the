/**
 * Click-driven heat injection and liquid → smoke mass transfer.
 */
export class VaporizationCoupler {
  constructor(options = {}) {
    this.latentHeat = 2.26e6;
    this.baseHeatFlux = 4e6;
    this.radius = options.radius ?? 0.018;
    this.maxRemovePerFrame = options.maxRemovePerFrame ?? 80;
    this.activeSources = [];
    this.lastVaporRate = 0;
    this.surfaceY = 0.08;
  }

  setSurfaceY(y) {
    this.surfaceY = y;
  }

  addHeatSource(x, y, z, intensity = 1, duration = 0.12) {
    this.activeSources.push({
      x, y, z,
      intensity,
      duration,
      age: 0,
      sustained: duration > 0.5,
    });
  }

  setSustainedSource(x, y, z, intensity = 1) {
    const existing = this.activeSources.find((s) => s.sustained);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.intensity = intensity;
      existing.age = 0;
      existing.duration = 999;
    } else {
      this.addHeatSource(x, y, z, intensity, 999);
      this.activeSources[this.activeSources.length - 1].sustained = true;
    }
  }

  clearSustained() {
    this.activeSources = this.activeSources.filter((s) => !s.sustained);
  }

  step(water, smoke, dt, heatMultiplier = 1, bubbles = null) {
    let totalRemoved = 0;
    let vaporMass = 0;
    const foamEvents = [];

    for (let si = this.activeSources.length - 1; si >= 0; si--) {
      const src = this.activeSources[si];
      src.age += dt;
      if (src.age >= src.duration) {
        this.activeSources.splice(si, 1);
        continue;
      }

      const Q = this.baseHeatFlux * src.intensity * heatMultiplier;
      const r2 = this.radius * this.radius;
      const underwater = src.y < this.surfaceY - 0.004;
      const toRemove = [];
      const recoil = [];
      const bubbleSpawns = [];

      for (const m of water.markers) {
        const dx = m.x - src.x, dy = m.y - src.y, dz = m.z - src.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;

        const w = Math.exp(-d2 / (r2 * 0.4));
        const dm = Math.min(m.mass ?? water.markerMass, (Q * w * dt) / this.latentHeat);
        if (dm < 1e-8) continue;

        vaporMass += dm;
        m.mass = (m.mass ?? water.markerMass) - dm;
        if (m.mass <= water.markerMass * 0.15) toRemove.push(m);

        const injectY = underwater ? this.surfaceY + 0.003 : src.y;
        smoke.inject(src.x, injectY, src.z, dm / water.rho, 120 + 180 * w, {
          vx: dx * 2 + (Math.random() - 0.5) * 0.5,
          vy: underwater ? 2.5 + Math.random() * 1.5 : 1.5 + Math.random() * 2.5,
          vz: dz * 2 + (Math.random() - 0.5) * 0.5,
          temp: 100 + 80 * w,
          radius: this.radius * (underwater ? 1.2 : 0.8),
        });

        if (underwater && bubbles && w > 0.2 && Math.random() < 0.25) {
          bubbleSpawns.push({ x: m.x, y: m.y, z: m.z, w });
        }

        if (!underwater && w > 0.3 && Math.random() < 0.15) {
          foamEvents.push({ x: m.x, y: m.y + 0.002, z: m.z, scale: w });
        }

        recoil.push({ x: m.x, y: m.y, z: m.z, strength: w * 3 });
        totalRemoved++;
        if (totalRemoved >= this.maxRemovePerFrame) break;
      }

      if (toRemove.length) {
        const set = new Set(toRemove);
        water.markers = water.markers.filter((m) => !set.has(m));
      }

      for (const e of recoil) {
        water.applyStirImpulse(e.x, e.y, e.z, 0, underwater ? 1.2 : 0.8, 0, this.radius * 1.5, e.strength * 0.4);
      }

      if (underwater && bubbles && bubbleSpawns.length) {
        for (const b of bubbleSpawns) {
          bubbles.spawn(b.x, b.y, b.z, 1 + Math.floor(b.w * 3), src.intensity);
        }
      }
    }

    this.lastVaporRate = Math.min(1, vaporMass / (water.markerMass * 8 + 1e-6));
    return { removed: totalRemoved, foamEvents, vaporRate: this.lastVaporRate };
  }
}
