import { clamp } from "./math.js";

export class JuiceSystem {
  constructor(maxParticles = 2500) {
    this.maxParticles = maxParticles;
    this.count = 0;
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.life = new Float32Array(maxParticles);
    this.size = new Float32Array(maxParticles);
    this.groundY = 0;
    this.totalVolume = 0;

    this.splatters = [];
    this.maxSplatters = 120;
  }

  reset() {
    this.count = 0;
    this.totalVolume = 0;
    this.splatters.length = 0;
  }

  emit(point, normal, count, intensity = 1) {
    for (let i = 0; i < count && this.count < this.maxParticles; i++) {
      const idx = this.count++;
      const i3 = idx * 3;

      const spread = 0.35 + Math.random() * 0.55 * intensity;
      const angle = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.9;

      this.positions[i3] = point.x + (Math.random() - 0.5) * 0.06;
      this.positions[i3 + 1] = point.y + (Math.random() - 0.5) * 0.06;
      this.positions[i3 + 2] = point.z + (Math.random() - 0.5) * 0.06;

      this.velocities[i3] = Math.cos(angle) * spread + normal.x * 1.4;
      this.velocities[i3 + 1] = up * intensity + normal.y * 0.8;
      this.velocities[i3 + 2] = Math.sin(angle) * spread + normal.z * 1.4;

      this.life[idx] = 0.6 + Math.random() * 1.4;
      this.size[idx] = 0.012 + Math.random() * 0.028 * intensity;
      this.totalVolume += this.size[idx] * 900;
    }
  }

  emitSeeds(point, count = 4) {
    for (let i = 0; i < count && this.count < this.maxParticles; i++) {
      const idx = this.count++;
      const i3 = idx * 3;

      this.positions[i3] = point.x;
      this.positions[i3 + 1] = point.y;
      this.positions[i3 + 2] = point.z;

      this.velocities[i3] = (Math.random() - 0.5) * 2.5;
      this.velocities[i3 + 1] = 0.5 + Math.random() * 2.2;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 2.5;

      this.life[idx] = 2 + Math.random() * 2;
      this.size[idx] = 0.035 + Math.random() * 0.02;
    }
  }

  step(dt) {
    const gravity = -9.81;
    const drag = 0.985;
    let write = 0;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;

      this.velocities[i3 + 1] += gravity * dt;
      this.velocities[i3] *= drag;
      this.velocities[i3 + 1] *= drag;
      this.velocities[i3 + 2] *= drag;

      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      if (this.positions[i3 + 1] <= this.groundY + this.size[i]) {
        this.positions[i3 + 1] = this.groundY + this.size[i];
        this.velocities[i3 + 1] *= -0.12;
        this.velocities[i3] *= 0.55;
        this.velocities[i3 + 2] *= 0.55;

        if (Math.abs(this.velocities[i3 + 1]) < 0.15 && this.life[i] < 0.3) {
          this._addSplatter(this.positions[i3], this.positions[i3 + 2], this.size[i]);
          continue;
        }
      }

      if (write !== i) {
        const w3 = write * 3;
        this.positions[w3] = this.positions[i3];
        this.positions[w3 + 1] = this.positions[i3 + 1];
        this.positions[w3 + 2] = this.positions[i3 + 2];
        this.velocities[w3] = this.velocities[i3];
        this.velocities[w3 + 1] = this.velocities[i3 + 1];
        this.velocities[w3 + 2] = this.velocities[i3 + 2];
        this.life[write] = this.life[i];
        this.size[write] = this.size[i];
      }
      write++;
    }

    this.count = write;
  }

  _addSplatter(x, z, size) {
    if (this.splatters.length >= this.maxSplatters) {
      this.splatters.shift();
    }
    this.splatters.push({
      x,
      z,
      radius: size * (8 + Math.random() * 14),
      opacity: 0.35 + Math.random() * 0.35,
      rotation: Math.random() * Math.PI,
    });
  }

  getVolumeMl() {
    return Math.round(this.totalVolume + this.count * 0.35);
  }
}

export class SeedSystem {
  constructor(count = 80) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.count = count;
    this.groundY = 0;
    this.active = 0;
  }

  reset() {
    this.active = 0;
  }

  burst(origin, count = 20) {
    for (let i = 0; i < count && this.active < this.count; i++) {
      const idx = this.active++;
      const i3 = idx * 3;
      this.positions[i3] = origin.x + (Math.random() - 0.5) * 0.15;
      this.positions[i3 + 1] = origin.y + Math.random() * 0.1;
      this.positions[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.15;
      this.velocities[i3] = (Math.random() - 0.5) * 3;
      this.velocities[i3 + 1] = 1 + Math.random() * 2.5;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 3;
    }
  }

  step(dt) {
    for (let i = 0; i < this.active; i++) {
      const i3 = i * 3;
      this.velocities[i3 + 1] -= 9.81 * dt;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      if (this.positions[i3 + 1] < this.groundY + 0.015) {
        this.positions[i3 + 1] = this.groundY + 0.015;
        this.velocities[i3 + 1] *= -0.25;
        this.velocities[i3] *= 0.6;
        this.velocities[i3 + 2] *= 0.6;
      }
    }
  }
}
