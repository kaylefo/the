/**
 * Underwater vaporization bubbles — expand, rise, advect with FLIP water, pop at surface.
 */
export class BubbleSystem {
  constructor(maxBubbles = 300) {
    this.bubbles = [];
    this.maxBubbles = maxBubbles;
    this.popEvents = [];
    this.waterDrag = 4.5;
    this.wobbleFreq = 18;
  }

  reset() {
    this.bubbles.length = 0;
    this.popEvents.length = 0;
  }

  spawn(x, y, z, count, intensity = 1) {
    for (let i = 0; i < count && this.bubbles.length < this.maxBubbles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = 0.008 * intensity;
      this.bubbles.push({
        x: x + Math.cos(angle) * spread * Math.random(),
        y: y + (Math.random() - 0.5) * spread,
        z: z + Math.sin(angle) * spread * Math.random(),
        r: 0.0008 + Math.random() * 0.0012,
        r0: 0.0008,
        vy: 0.25 + Math.random() * 0.45,
        vx: (Math.random() - 0.5) * 0.08,
        vz: (Math.random() - 0.5) * 0.08,
        life: 0.4 + Math.random() * 0.9,
        grow: 1.2 + intensity * 0.8,
        intensity,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * @param {number} surfaceY - approximate water surface height (sim units)
   * @param {(x:number,y:number,z:number)=>[number,number,number]|null} sampleWaterVel
   * @returns {{ pops: Array, active: number }}
   */
  step(dt, surfaceY, sampleWaterVel = null) {
    this.popEvents.length = 0;
    const drag = this.waterDrag;

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life -= dt;
      b.r = Math.min(b.r0 * b.grow * 3, b.r + dt * 0.004 * b.grow);
      b.phase += dt * this.wobbleFreq;

      if (sampleWaterVel) {
        const [wx, wy, wz] = sampleWaterVel(b.x, b.y, b.z);
        b.vx += (wx - b.vx) * drag * dt;
        b.vy += (wy + 0.35 - b.vy) * drag * dt * 0.6;
        b.vz += (wz - b.vz) * drag * dt;
      } else {
        b.vy += dt * 0.6;
      }

      const wobble = Math.sin(b.phase) * b.r * 2;
      b.x += (b.vx + wobble) * dt;
      b.y += b.vy * dt;
      b.z += (b.vz + wobble * 0.5) * dt;

      const surfaceAt = surfaceY;
      if (b.y >= surfaceAt - b.r || b.life <= 0) {
        this.popEvents.push({
          x: b.x,
          y: Math.max(surfaceAt, b.y),
          z: b.z,
          intensity: b.intensity,
          r: b.r,
        });
        this.bubbles.splice(i, 1);
      }
    }

    return { pops: this.popEvents, active: this.bubbles.length };
  }
}
