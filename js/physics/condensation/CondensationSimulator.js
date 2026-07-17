import * as THREE from "three";
import { tankBounds } from "../WaterTank.js";

/**
 * Accumulates moisture on inner glass faces from nearby steam density + temperature.
 */
export class CondensationSimulator {
  constructor(tank, faceRes = 48) {
    this.tank = tank;
    this.res = faceRes;
    this.bounds = tankBounds(tank);
    this.atlasW = faceRes * 2;
    this.atlasH = faceRes * 2;
    this.moisture = new Float32Array(this.atlasW * this.atlasH);
    this.streak = new Float32Array(this.atlasW * this.atlasH);
    this.data = new Uint8Array(this.atlasW * this.atlasH * 4);

    this.texture = new THREE.DataTexture(
      this.data,
      this.atlasW,
      this.atlasH,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  reset() {
    this.moisture.fill(0);
    this.streak.fill(0);
    this._pack();
  }

  _atlasIdx(ax, ay) {
    return ax + ay * this.atlasW;
  }

  _faceUV(face, u, v) {
    const col = face % 2;
    const row = Math.floor(face / 2);
    return { ax: col * this.res + u, ay: row * this.res + v };
  }

  _faceWorld(face, u, v) {
    const b = this.bounds;
    const fu = u / (this.res - 1);
    const fv = v / (this.res - 1);
    const y = b.yMin + fv * (b.yMax - b.yMin);
    switch (face) {
      case 0: return [b.xMin, y, b.zMin + fu * (b.zMax - b.zMin)];
      case 1: return [b.xMax, y, b.zMin + fu * (b.zMax - b.zMin)];
      case 2: return [b.xMin + fu * (b.xMax - b.xMin), y, b.zMin];
      case 3: return [b.xMin + fu * (b.xMax - b.xMin), y, b.zMax];
      default: return [0, y, 0];
    }
  }

  _sampleSmoke(smoke, x, y, z) {
    const ax = (x - smoke.origin[0]) / smoke.dx;
    const ay = (y - smoke.origin[1]) / smoke.dx;
    const az = (z - smoke.origin[2]) / smoke.dx;
    const i = Math.floor(ax), j = Math.floor(ay), k = Math.floor(az);
    if (i < 0 || j < 0 || k < 0 || i >= smoke.nx || j >= smoke.ny || k >= smoke.nz) return { d: 0, t: 0 };
    const idx = smoke.idx(i, j, k);
    return { d: smoke.density[idx], t: smoke.temperature[idx] };
  }

  step(smoke, dt) {
    if (!smoke) return;
    const deposit = dt * 0.35;

    for (let face = 0; face < 4; face++) {
      for (let v = 0; v < this.res; v++) {
        for (let u = 0; u < this.res; u++) {
          const [wx, wy, wz] = this._faceWorld(face, u, v);
          const { d, t } = this._sampleSmoke(smoke, wx, wy, wz);
          const tempFactor = Math.max(0, (t - smoke.ambientTemp) / 80);
          const { ax, ay } = this._faceUV(face, u, v);
          const idx = this._atlasIdx(ax, ay);
          this.moisture[idx] += d * deposit * (0.3 + tempFactor * 0.7);
          this.moisture[idx] = Math.min(2, this.moisture[idx]);
        }
      }
    }

    const drip = new Float32Array(this.moisture.length);
    drip.set(this.moisture);
    for (let face = 0; face < 4; face++) {
      for (let v = 1; v < this.res; v++) {
        for (let u = 0; u < this.res; u++) {
          const cur = this._faceUV(face, u, v);
          const above = this._faceUV(face, u, v - 1);
          const ci = this._atlasIdx(cur.ax, cur.ay);
          const ai = this._atlasIdx(above.ax, above.ay);
          drip[ci] += this.moisture[ai] * 0.04 * dt * 60;
        }
      }
    }
    this.moisture.set(drip);

    for (let ay = 1; ay < this.atlasH; ay++) {
      for (let ax = 0; ax < this.atlasW; ax++) {
        const idx = this._atlasIdx(ax, ay);
        const above = this.moisture[this._atlasIdx(ax, ay - 1)];
        this.streak[idx] = this.streak[idx] * 0.92 + Math.max(0, above - this.moisture[idx]) * 0.35;
      }
    }

    const evap = Math.exp(-dt * 0.08);
    for (let i = 0; i < this.moisture.length; i++) {
      this.moisture[i] *= evap;
      this.streak[i] *= 0.985;
    }

    this._pack();
  }

  _pack() {
    for (let i = 0; i < this.moisture.length; i++) {
      const m = this.moisture[i];
      const s = this.streak[i];
      const droplet = Math.max(0, m - 0.4) * (0.5 + 0.5 * Math.sin(i * 0.17));
      this.data[i * 4] = Math.min(255, m * 110);
      this.data[i * 4 + 1] = Math.min(255, s * 180);
      this.data[i * 4 + 2] = Math.min(255, droplet * 90);
      this.data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}
