/**
 * Device detection and quality tier presets.
 * Tiers tuned for iPhone 16 Pro Max (A18 Pro, 3× DPR, ~430×932 viewport) through low-end mobile.
 */

export const QUALITY_TIERS = {
  ultra: {
    label: "Ultra",
    gridSize: 32,
    particleSpacing: 0.0032,
    seedCount: 40,
    loculeFluidCount: 60,
    maxPhysicsSteps: 3,
    physicsSubsteps: 1,
    fixedFps: 90,
    meshInterval: 1,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    flipIterations: 40,
    flipMaxMarkers: 8000,
    fluidPointSize: 0.003,
  },
  high: {
    label: "High",
    gridSize: 28,
    particleSpacing: 0.0035,
    seedCount: 32,
    loculeFluidCount: 48,
    maxPhysicsSteps: 2,
    physicsSubsteps: 2,
    fixedFps: 60,
    meshInterval: 1,
    shadowMapSize: 1024,
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    flipIterations: 30,
    flipMaxMarkers: 5000,
    fluidPointSize: 0.0035,
  },
  medium: {
    label: "Medium",
    gridSize: 24,
    particleSpacing: 0.004,
    seedCount: 24,
    loculeFluidCount: 36,
    maxPhysicsSteps: 2,
    physicsSubsteps: 3,
    fixedFps: 60,
    meshInterval: 2,
    shadowMapSize: 512,
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: false,
    flipIterations: 20,
    flipMaxMarkers: 3000,
    fluidPointSize: 0.004,
  },
  low: {
    label: "Low",
    gridSize: 20,
    particleSpacing: 0.0045,
    seedCount: 16,
    loculeFluidCount: 24,
    maxPhysicsSteps: 1,
    physicsSubsteps: 4,
    fixedFps: 45,
    meshInterval: 3,
    shadowMapSize: 0,
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    flipIterations: 12,
    flipMaxMarkers: 1500,
    fluidPointSize: 0.005,
  },
};

const TIER_ORDER = ["ultra", "high", "medium", "low"];

export class DeviceProfile {
  constructor() {
    this.touch = false;
    this.mobile = false;
    this.ios = false;
    this.standalone = false;
    this.dpr = 1;
    this.memoryGb = 4;
    this.cores = 4;
    this.webgl2 = false;
    this.tier = "high";
    this.isProMaxClass = false;
    this.viewport = { width: 0, height: 0 };

    this.detect();
    this.tier = this._selectInitialTier();
  }

  detect() {
    const ua = navigator.userAgent || "";
    const touch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    const mobile = touch && (/\b(iPhone|iPad|iPod|Android)\b/i.test(ua) || window.innerWidth < 768);
    const ios = /\b(iPhone|iPad|iPod)\b/i.test(ua);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    this.touch = touch;
    this.mobile = mobile;
    this.ios = ios;
    this.standalone = standalone;
    this.dpr = window.devicePixelRatio || 1;
    this.memoryGb = navigator.deviceMemory || (mobile ? 4 : 8);
    this.cores = navigator.hardwareConcurrency || 4;
    this.webgl2 = this._probeWebGL2();

    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    this.viewport = { width: vw, height: vh };

    // iPhone Pro Max class: large iOS phone viewport + high DPR + sufficient memory
    const minDim = Math.min(vw, vh);
    const maxDim = Math.max(vw, vh);
    this.isProMaxClass =
      ios &&
      this.dpr >= 3 &&
      minDim >= 420 &&
      maxDim >= 900 &&
      this.memoryGb >= 4;
  }

  _probeWebGL2() {
    try {
      const c = document.createElement("canvas");
      return !!c.getContext("webgl2");
    } catch {
      return false;
    }
  }

  _selectInitialTier() {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.has("e2e") || window.__E2E__) return "low";
    }

    if (!this.mobile) {
      if (this.memoryGb >= 8 && this.cores >= 8) return "ultra";
      return "high";
    }

    // iPhone 16 Pro Max / 15 Pro Max / similar flagship
    if (this.isProMaxClass && this.webgl2) return "ultra";

    // Standard modern phones
    if (this.webgl2 && this.memoryGb >= 4 && this.cores >= 4) return "high";

    // Older or budget phones
    if (this.memoryGb >= 2) return "medium";

    return "low";
  }

  getSettings() {
    return { ...QUALITY_TIERS[this.tier] };
  }

  getTierIndex() {
    return TIER_ORDER.indexOf(this.tier);
  }

  downgradeTier() {
    const idx = this.getTierIndex();
    if (idx < TIER_ORDER.length - 1) {
      this.tier = TIER_ORDER[idx + 1];
      return true;
    }
    return false;
  }

  upgradeTier() {
    const idx = this.getTierIndex();
    const cap = this._selectInitialTier();
    const capIdx = TIER_ORDER.indexOf(cap);
    if (idx > 0 && idx - 1 <= capIdx) {
      this.tier = TIER_ORDER[idx - 1];
      return true;
    }
    return false;
  }

  getPixelRatio(settings) {
    const cap = settings?.maxPixelRatio ?? 2;
    if (this.mobile) return Math.min(this.dpr, cap);
    return Math.min(this.dpr, cap);
  }

  summary() {
    const s = this.getSettings();
    return {
      tier: this.tier,
      label: s.label,
      mobile: this.mobile,
      ios: this.ios,
      proMaxClass: this.isProMaxClass,
      dpr: this.dpr,
      pixelRatio: this.getPixelRatio(s),
      grid: s.gridSize,
      memoryGb: this.memoryGb,
      cores: this.cores,
      webgl2: this.webgl2,
    };
  }
}

export const WATER_QUALITY_TIERS = {
  ultra: {
    label: "Ultra",
    waterGridSize: 36,
    flipMaxMarkers: 18000,
    flipIterations: 40,
    smokeRes: 56,
    smokeSteps: 64,
    smokeInterval: 1,
    smokeUploadInterval: 1,
    foamMax: 800,
    maxPhysicsSteps: 2,
    physicsSubsteps: 2,
    fixedFps: 60,
    meshInterval: 1,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    bloom: true,
    bloomStrength: 0.42,
    bloomRadius: 0.48,
    bloomThreshold: 0.75,
    causticRes: 128,
    heatShimmer: true,
    shimmerStrength: 0.5,
    filmGrain: true,
    grainAmount: 0.04,
    envStrength: 0.95,
    godRays: true,
    godRayStrength: 0.38,
    condensationRes: 56,
    useWebGPU: true,
  },
  high: {
    label: "High",
    waterGridSize: 32,
    flipMaxMarkers: 12000,
    flipIterations: 35,
    smokeRes: 48,
    smokeSteps: 48,
    smokeInterval: 1,
    smokeUploadInterval: 1,
    foamMax: 600,
    maxPhysicsSteps: 2,
    physicsSubsteps: 2,
    fixedFps: 60,
    meshInterval: 1,
    shadowMapSize: 1024,
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    bloom: true,
    bloomStrength: 0.32,
    bloomRadius: 0.42,
    bloomThreshold: 0.8,
    causticRes: 96,
    heatShimmer: true,
    shimmerStrength: 0.42,
    filmGrain: false,
    envStrength: 0.85,
    godRays: true,
    godRayStrength: 0.28,
    condensationRes: 48,
    useWebGPU: false,
  },
  medium: {
    label: "Medium",
    waterGridSize: 28,
    flipMaxMarkers: 8000,
    flipIterations: 25,
    smokeRes: 40,
    smokeSteps: 36,
    smokeInterval: 2,
    smokeUploadInterval: 2,
    foamMax: 400,
    maxPhysicsSteps: 1,
    physicsSubsteps: 3,
    fixedFps: 45,
    meshInterval: 2,
    shadowMapSize: 512,
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: false,
    bloom: false,
    causticRes: 64,
    heatShimmer: true,
    shimmerStrength: 0.3,
    filmGrain: false,
    envStrength: 0.7,
    godRays: false,
    condensationRes: 40,
    useWebGPU: false,
  },
  low: {
    label: "Low",
    waterGridSize: 24,
    flipMaxMarkers: 5000,
    flipIterations: 18,
    smokeRes: 32,
    smokeSteps: 28,
    smokeInterval: 2,
    smokeUploadInterval: 3,
    foamMax: 250,
    maxPhysicsSteps: 1,
    physicsSubsteps: 4,
    fixedFps: 40,
    meshInterval: 3,
    shadowMapSize: 0,
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    bloom: false,
    causticRes: 48,
    heatShimmer: false,
    filmGrain: false,
    envStrength: 0.5,
    godRays: false,
    condensationRes: 32,
    useWebGPU: false,
  },
};

export class WaterDeviceProfile extends DeviceProfile {
  _isE2E() {
    return typeof window !== "undefined" &&
      (window.__E2E__ || new URLSearchParams(window.location.search).has("e2e"));
  }

  getSettings() {
    const base = { ...WATER_QUALITY_TIERS[this.tier] };
    if (this._isE2E()) {
      return {
        ...base,
        label: "E2E",
        waterGridSize: 16,
        flipMaxMarkers: 600,
        flipIterations: 8,
        smokeRes: 20,
        smokeSteps: 12,
        smokeInterval: 3,
        maxPhysicsSteps: 1,
        physicsSubsteps: 1,
        meshInterval: 4,
        shadowMapSize: 0,
        maxPixelRatio: 1,
        antialias: false,
        shadows: false,
        bloom: false,
        causticRes: 32,
        heatShimmer: false,
        filmGrain: false,
        godRays: false,
        condensationRes: 16,
        useWebGPU: false,
      };
    }
    if (this.mobile) {
      return {
        ...base,
        waterGridSize: Math.min(base.waterGridSize, 28),
        flipMaxMarkers: Math.min(base.flipMaxMarkers, 8000),
        bloom: this.tier === "ultra" ? false : base.bloom,
        godRays: false,
        filmGrain: false,
        heatShimmer: base.heatShimmer && this.tier !== "ultra",
      };
    }
    return base;
  }

  summary() {
    const s = this.getSettings();
    return {
      tier: this.tier,
      label: s.label,
      mobile: this.mobile,
      ios: this.ios,
      proMaxClass: this.isProMaxClass,
      dpr: this.dpr,
      pixelRatio: this.getPixelRatio(s),
      grid: s.waterGridSize,
      memoryGb: this.memoryGb,
      cores: this.cores,
      webgl2: this.webgl2,
    };
  }
}

export class AdaptiveQuality {
  constructor(device, onTierChange) {
    this.device = device;
    this.onTierChange = onTierChange;
    this.frameTimes = [];
    this.maxSamples = 60;
    this.lowFpsSince = 0;
    this.highFpsSince = 0;
    this.lastAdjust = 0;
    this.cooldownMs = 4000;
  }

  recordFrame(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > this.maxSamples) this.frameTimes.shift();
  }

  getAverageFps() {
    if (this.frameTimes.length === 0) return 60;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return avg > 0 ? 1 / avg : 60;
  }

  update(now) {
    if (now - this.lastAdjust < this.cooldownMs) return;
    const fps = this.getAverageFps();
    const settings = this.device.getSettings();
    const target = settings.fixedFps * 0.85;

    if (fps < target - 10) {
      this.lowFpsSince += 1;
      this.highFpsSince = 0;
      if (this.lowFpsSince >= 30) {
        if (this.device.downgradeTier()) {
          this.lastAdjust = now;
          this.lowFpsSince = 0;
          this.frameTimes.length = 0;
          this.onTierChange?.(this.device.getSettings());
        }
      }
    } else if (fps > settings.fixedFps - 5) {
      this.highFpsSince += 1;
      this.lowFpsSince = 0;
      if (this.highFpsSince >= 120) {
        if (this.device.upgradeTier()) {
          this.lastAdjust = now;
          this.highFpsSince = 0;
          this.frameTimes.length = 0;
          this.onTierChange?.(this.device.getSettings());
        }
      }
    } else {
      this.lowFpsSince = 0;
      this.highFpsSince = 0;
    }
  }
}
