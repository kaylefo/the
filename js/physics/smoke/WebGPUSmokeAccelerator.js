/**
 * Optional WebGPU compute path for smoke density advection (Ultra tier).
 * Falls back silently — CPU StableFluidsSmoke remains authoritative.
 */
export class WebGPUSmokeAccelerator {
  constructor() {
    this.ready = false;
    this.device = null;
    this.mode = "cpu";
  }

  static async tryCreate() {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const acc = new WebGPUSmokeAccelerator();
      await acc._init(device);
      return acc;
    } catch (e) {
      console.warn("[WaterLab] WebGPU smoke unavailable:", e?.message);
      return null;
    }
  }

  async _init(device) {
    this.device = device;
    const code = /* wgsl */ `
      struct Params { dt: f32, dx: f32, nx: f32, ny: f32, nz: f32, ox: f32, oy: f32, oz: f32, _pad: f32 }
      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage, read> densityIn: array<f32>;
      @group(0) @binding(2) var<storage, read> vx: array<f32>;
      @group(0) @binding(3) var<storage, read> vy: array<f32>;
      @group(0) @binding(4) var<storage, read> vz: array<f32>;
      @group(0) @binding(5) var<storage, read_write> densityOut: array<f32>;

      fn idx(i: u32, j: u32, k: u32, nx: u32, ny: u32) -> u32 {
        return i + j * nx + k * nx * ny;
      }

      fn sample(d: array<f32>, x: f32, y: f32, z: f32, nx: u32, ny: u32, nz: u32) -> f32 {
        let i = u32(floor(x));
        let j = u32(floor(y));
        let k = u32(floor(z));
        if (i >= nx - 1u || j >= ny - 1u || k >= nz - 1u) { return 0.0; }
        let fx = x - f32(i);
        let fy = y - f32(j);
        let fz = z - f32(k);
        let c000 = d[idx(i, j, k, nx, ny)];
        let c100 = d[idx(i + 1u, j, k, nx, ny)];
        let c010 = d[idx(i, j + 1u, k, nx, ny)];
        let c110 = d[idx(i + 1u, j + 1u, k, nx, ny)];
        let c001 = d[idx(i, j, k + 1u, nx, ny)];
        let c101 = d[idx(i + 1u, j, k + 1u, nx, ny)];
        let c011 = d[idx(i, j + 1u, k + 1u, nx, ny)];
        let c111 = d[idx(i + 1u, j + 1u, k + 1u, nx, ny)];
        let c00 = mix(c000, c100, fx);
        let c10 = mix(c010, c110, fx);
        let c01 = mix(c001, c101, fx);
        let c11 = mix(c011, c111, fx);
        let c0 = mix(c00, c10, fy);
        let c1 = mix(c01, c11, fy);
        return mix(c0, c1, fz);
      }

      @compute @workgroup_size(4, 4, 4)
      fn advect(@builtin(global_invocation_id) gid: vec3<u32>) {
        let nx = u32(params.nx);
        let ny = u32(params.ny);
        let nz = u32(params.nz);
        let i = gid.x + 1u;
        let j = gid.y + 1u;
        let k = gid.z + 1u;
        if (i >= nx - 1u || j >= ny - 1u || k >= nz - 1u) { return; }
        let id = idx(i, j, k, nx, ny);
        let wx = params.ox + f32(i) * params.dx;
        let wy = params.oy + f32(j) * params.dx;
        let wz = params.oz + f32(k) * params.dx;
        let ui = idx(i, j, k, nx, ny);
        let px = (wx - vx[ui] * params.dt - params.ox) / params.dx;
        let py = (wy - vy[ui] * params.dt - params.oy) / params.dx;
        let pz = (wz - vz[ui] * params.dt - params.oz) / params.dx;
        densityOut[id] = sample(densityIn, px, py, pz, nx, ny, nz);
      }
    `;

    this.module = device.createShaderModule({ code });
    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: this.module, entryPoint: "advect" },
    });
    this.paramsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ready = true;
    this.mode = "webgpu";
  }

  /**
   * GPU advect density field; writes result into smoke.densityTmp then swaps.
   * @returns {boolean} true if GPU path ran
   */
  advectDensity(smoke, dt) {
    if (!this.ready) return false;
    const { device } = this;
    const n = smoke.count;
    const byteSize = n * 4;

    if (!this._bufIn || this._bufIn.size !== byteSize) {
      this._bufIn = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this._bufOut = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      this._bufVx = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this._bufVy = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this._bufVz = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this._readback = device.createBuffer({ size: byteSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }

    const params = new Float32Array([
      dt, smoke.dx, smoke.nx, smoke.ny, smoke.nz,
      smoke.origin[0], smoke.origin[1], smoke.origin[2], 0,
    ]);
    device.queue.writeBuffer(this.paramsBuffer, 0, params);
    device.queue.writeBuffer(this._bufIn, 0, smoke.density);
    device.queue.writeBuffer(this._bufVx, 0, smoke.vx);
    device.queue.writeBuffer(this._bufVy, 0, smoke.vy);
    device.queue.writeBuffer(this._bufVz, 0, smoke.vz);

    const bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this._bufIn } },
        { binding: 2, resource: { buffer: this._bufVx } },
        { binding: 3, resource: { buffer: this._bufVy } },
        { binding: 4, resource: { buffer: this._bufVz } },
        { binding: 5, resource: { buffer: this._bufOut } },
      ],
    });

    const pass = device.createCommandEncoder();
    pass.beginComputePass().setPipeline(this.pipeline).setBindGroup(0, bindGroup)
      .dispatchWorkgroups(Math.ceil((smoke.nx - 2) / 4), Math.ceil((smoke.ny - 2) / 4), Math.ceil((smoke.nz - 2) / 4))
      .end();
    pass.copyBufferToBuffer(this._bufOut, 0, this._readback, 0, byteSize);
    device.queue.submit([pass.finish()]);

    // Sync readback (acceptable on ultra every other smoke step)
    this._pendingRead = this._readback.mapAsync(GPUMapMode.READ).then(() => {
      const mapped = new Float32Array(this._readback.getMappedRange().slice(0));
      smoke.density.set(mapped);
      this._readback.unmap();
    });
    return true;
  }

  async flush() {
    if (this._pendingRead) {
      await this._pendingRead;
      this._pendingRead = null;
    }
  }
}
