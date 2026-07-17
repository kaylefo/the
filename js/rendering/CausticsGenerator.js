import * as THREE from "three";

/**
 * Derive caustic intensity map from water density field (surface height laplacian).
 */
export class CausticsGenerator {
  constructor(res = 128) {
    this.res = res;
    this.heights = new Float32Array(res * res);
    this.data = new Uint8Array(res * res);
    this.texture = new THREE.DataTexture(
      this.data,
      res,
      res,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  updateFromDensity(field, nx, ny, nz, origin, dx, tank) {
    const res = this.res;
    const scale = 1 / (res - 1);

    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const wx = tank.origin[0] + ix * scale * tank.width;
        const wz = tank.origin[2] + iz * scale * tank.depth;
        const gi = Math.floor((wx - origin[0]) / dx);
        const gk = Math.floor((wz - origin[2]) / dx);
        if (gi < 1 || gk < 1 || gi >= nx - 1 || gk >= nz - 1) {
          this.heights[ix + iz * res] = 0;
          continue;
        }
        let maxH = 0;
        for (let j = 1; j < ny - 1; j++) {
          const v = field[gi + j * nx + gk * nx * ny];
          if (v > maxH) maxH = v;
        }
        this.heights[ix + iz * res] = maxH;
      }
    }

    for (let iz = 1; iz < res - 1; iz++) {
      for (let ix = 1; ix < res - 1; ix++) {
        const idx = ix + iz * res;
        const h = this.heights[idx];
        const lap =
          this.heights[idx - 1] +
          this.heights[idx + 1] +
          this.heights[idx - res] +
          this.heights[idx + res] -
          4 * h;
        this.data[idx] = Math.min(255, Math.abs(lap) * 1400 + h * 40);
      }
    }

    this.texture.needsUpdate = true;
  }
}
