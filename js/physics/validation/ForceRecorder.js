/** Records press force vs displacement for validation overlay. */
export class ForceRecorder {
  constructor(maxSamples = 600) {
    this.maxSamples = maxSamples;
    this.forces = [];
    this.displacements = [];
    this.timestamps = [];
    this.peakForce = 0;
    this.totalEnergyDissipated = 0;
    this.lastForce = 0;
  }

  reset() {
    this.forces.length = 0;
    this.displacements.length = 0;
    this.timestamps.length = 0;
    this.peakForce = 0;
    this.totalEnergyDissipated = 0;
    this.lastForce = 0;
  }

  record(force, displacement, time) {
    this.forces.push(force);
    this.displacements.push(displacement);
    this.timestamps.push(time);
    this.peakForce = Math.max(this.peakForce, force);

    if (this.forces.length > 1) {
      const df = force - this.lastForce;
      const dh = displacement - this.displacements[this.displacements.length - 2];
      if (dh > 0) this.totalEnergyDissipated += Math.abs(df * dh);
    }
    this.lastForce = force;

    if (this.forces.length > this.maxSamples) {
      this.forces.shift();
      this.displacements.shift();
      this.timestamps.shift();
    }
  }

  drawChart(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(8,6,10,0.85)";
    ctx.fillRect(0, 0, w, h);

    if (this.forces.length < 2) {
      ctx.fillStyle = "#888";
      ctx.font = "11px monospace";
      ctx.fillText("F–h curve (compress to record)", 8, h / 2);
      return;
    }

    const maxF = Math.max(this.peakForce, 0.01);
    const maxD = Math.max(...this.displacements, 0.001);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.moveTo(30, h - 20);
    ctx.lineTo(w - 8, h - 20);
    ctx.moveTo(30, 8);
    ctx.lineTo(30, h - 20);
    ctx.stroke();

    ctx.strokeStyle = "#ff5a3c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.forces.length; i++) {
      const x = 30 + (this.displacements[i] / maxD) * (w - 40);
      const y = h - 20 - (this.forces[i] / maxF) * (h - 32);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#ffd4c8";
    ctx.font = "10px monospace";
    ctx.fillText(`F_max: ${this.peakForce.toFixed(2)} N`, 34, 16);
    ctx.fillText(`E_diss: ${this.totalEnergyDissipated.toFixed(3)} J`, 34, 28);
    ctx.fillText("h →", w - 30, h - 6);
    ctx.fillText("F ↑", 6, 14);
  }
}
