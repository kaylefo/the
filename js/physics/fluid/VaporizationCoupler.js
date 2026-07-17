/**
 * Click-driven heat injection, temperature-coupled boiling, liquid → smoke transfer.
 *
 * Boiling rate modulated by local superheat from WaterTemperatureField:
 *   ṁ_vap ∝ max(0, T − T_sat)^n
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
    const g = water.grid;

    for (let si = this.activeSources.length - 1; si >= 0; si--) {
      const src = this.activeSources[si];
      src.age += dt;
      if (src.age >= src.duration) {
        this.activeSources.splice(si, 1);
        continue;
      }

      const Q = this.baseHeatFlux * src.intensity * heatMultiplier;
      water.injectHeat(src.x, src.y, src.z, Q, dt, this.radius);

      const boilFactor = water.temperature.boilingIntensity(g, water.fluidMask, src.x, src.y, src.z);
      const heatScale = 0.35 + boilFactor * 0.85;

      const r2 = this.radius * this.radius;
      const underwater = src.y < this.surfaceY - 0.004;
      const toRemove = [];
      const recoil = [];
      const bubbleSpawns = [];
      let maxW = 0;
      let ringStrength = 0;

      for (const m of water.markers) {
        const dx = m.x - src.x, dy = m.y - src.y, dz = m.z - src.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;

        const w = Math.exp(-d2 / (r2 * 0.4));
        maxW = Math.max(maxW, w);
        const dm = Math.min(
          m.mass ?? water.markerMass,
          (Q * w * dt * heatScale) / this.latentHeat
        );
        if (dm < 1e-8) continue;

        vaporMass += dm;
        m.mass = (m.mass ?? water.markerMass) - dm;
        if (m.mass <= water.markerMass * 0.15) toRemove.push(m);

        const injectY = underwater ? this.surfaceY + 0.003 : src.y;
        const localBoil = water.temperature.boilingIntensity(g, water.fluidMask, m.x, m.y, m.z);
        smoke.inject(src.x, injectY, src.z, (dm / water.rho) * (0.6 + localBoil * 0.8), 120 + 180 * w, {
          vx: dx * 2 + (Math.random() - 0.5) * 0.5,
          vy: underwater ? 2.5 + Math.random() * 1.5 + localBoil : 1.5 + Math.random() * 2.5,
          vz: dz * 2 + (Math.random() - 0.5) * 0.5,
          temp: 100 + 80 * w + localBoil * 40,
          radius: this.radius * (underwater ? 1.2 : 0.8),
        });

        if (underwater && bubbles && w > 0.2 && Math.random() < 0.15 + localBoil * 0.35) {
          bubbleSpawns.push({ x: m.x, y: m.y, z: m.z, w: w * (0.5 + localBoil) });
        }

        if (!underwater && w > 0.3 && Math.random() < 0.15 + boilFactor * 0.2) {
          foamEvents.push({ x: m.x, y: m.y + 0.002, z: m.z, scale: w });
        }

        recoil.push({ x: m.x, y: m.y, z: m.z, strength: w * 3 });
        ringStrength = Math.max(ringStrength, w * src.intensity * (0.5 + localBoil));
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

      if (underwater && ringStrength > 0.2) {
        water.applySurfaceRingImpulse(
          src.x, this.surfaceY, src.z,
          this.radius * 1.8,
          ringStrength * 0.35
        );
      }
    }

    this.lastVaporRate = Math.min(1, vaporMass / (water.markerMass * 8 + 1e-6));
    return { removed: totalRemoved, foamEvents, vaporRate: this.lastVaporRate };
  }
}
