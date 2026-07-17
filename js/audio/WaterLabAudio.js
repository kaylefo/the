/**
 * Procedural vaporization audio — band-pass hiss + crackle bursts via Web Audio API.
 */
export class WaterLabAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hissGain = null;
    this.hissSource = null;
    this.hissFilter = null;
    this.enabled = false;
    this._targetHiss = 0;
    this._currentHiss = 0;
    this._lastSizzle = 0;
  }

  /** Must be called from a user gesture (pointerdown). */
  async init() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);

      // Continuous hiss: white noise → bandpass
      const bufferSize = 2 * this.ctx.sampleRate;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      this.hissSource = this.ctx.createBufferSource();
      this.hissSource.buffer = noiseBuffer;
      this.hissSource.loop = true;

      this.hissFilter = this.ctx.createBiquadFilter();
      this.hissFilter.type = "bandpass";
      this.hissFilter.frequency.value = 2800;
      this.hissFilter.Q.value = 0.8;

      this.hissGain = this.ctx.createGain();
      this.hissGain.gain.value = 0;

      this.hissSource.connect(this.hissFilter);
      this.hissFilter.connect(this.hissGain);
      this.hissGain.connect(this.master);
      this.hissSource.start();

      this.enabled = true;
      return true;
    } catch {
      return false;
    }
  }

  resume() {
    if (this.ctx?.state === "suspended") this.ctx.resume();
  }

  /** @param {number} rate - vaporization intensity 0..1 */
  setVaporizationRate(rate) {
    if (!this.enabled) return;
    this._targetHiss = Math.min(1, Math.max(0, rate));
  }

  /** Short sizzle burst on click. */
  playSizzle(intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastSizzle < 0.04) return;
    this._lastSizzle = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200;

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180 + Math.random() * 400, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);

    gain.gain.setValueAtTime(0.08 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);

    // Noise crackle layer
    const crackleLen = Math.floor(this.ctx.sampleRate * 0.08);
    const buf = this.ctx.createBuffer(1, crackleLen, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < crackleLen; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (crackleLen * 0.15));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const cg = this.ctx.createGain();
    cg.gain.value = 0.12 * intensity;
    src.connect(cg);
    cg.connect(this.master);
    src.start(now);
  }

  /** Call each frame to smooth hiss volume. */
  update(dt) {
    if (!this.enabled || !this.hissGain) return;
    this._currentHiss += (this._targetHiss - this._currentHiss) * Math.min(1, dt * 8);
    this.hissGain.gain.setTargetAtTime(this._currentHiss * 0.25, this.ctx.currentTime, 0.05);
    if (this._targetHiss < 0.01) this._targetHiss = 0;
  }

  dispose() {
    this.hissSource?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.enabled = false;
  }
}
