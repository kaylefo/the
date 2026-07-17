/**
 * Tracks weighted loading stages, percent complete, timing metrics, and console logging.
 */
export class LoadingManager {
  constructor(stages, onUpdate) {
    this.stages = stages;
    this.totalWeight = stages.reduce((sum, s) => sum + s.weight, 0);
    this.onUpdate = onUpdate;
    this.metrics = [];
    this.errors = [];
    this.currentStage = null;
    this.stageStartMs = 0;
    this.bootStartMs = 0;
    this.subProgress = 0;
  }

  markBootStart() {
    this.bootStartMs = performance.now();
    this._log("boot", "User initiated load");
  }

  async runStage(id, fn) {
    const stage = this.stages.find((s) => s.id === id);
    if (!stage) throw new Error(`Unknown load stage: ${id}`);

    this.currentStage = stage;
    this.stageStartMs = performance.now();
    this.subProgress = 0;
    this._emit();

    try {
      const result = await fn();
      this._finishStage(id, stage.label, true);
      return result;
    } catch (err) {
      this._finishStage(id, stage.label, false, err);
      throw err;
    } finally {
      this.currentStage = null;
      this.subProgress = 0;
    }
  }

  setSubProgress(fraction) {
    this.subProgress = Math.max(0, Math.min(1, fraction));
    this._emit();
  }

  _finishStage(id, label, ok, err = null) {
    const durationMs = performance.now() - this.stageStartMs;
    const entry = {
      id,
      label,
      durationMs: Math.round(durationMs * 10) / 10,
      ok,
      error: err?.message ?? null,
      percentAfter: this.getPercent(),
      timestamp: new Date().toISOString(),
    };
    this.metrics.push(entry);

    const status = ok ? "OK" : "FAIL";
    console.log(
      `[TomatoLoad] ${status} ${id} — ${label} (${entry.durationMs}ms) → ${entry.percentAfter}%`
    );
    if (err) {
      console.error(`[TomatoLoad] ${id} error:`, err);
      this.errors.push({ id, message: err.message, stack: err.stack });
    }

    this._emit();
  }

  _log(tag, message) {
    console.log(`[TomatoLoad] ${tag}: ${message}`);
  }

  getCompletedWeight() {
    let weight = 0;
    for (const m of this.metrics) {
      if (!m.ok) continue;
      const stage = this.stages.find((s) => s.id === m.id);
      if (stage) weight += stage.weight;
    }
    return weight;
  }

  getPercent() {
    let weight = this.getCompletedWeight();
    if (this.currentStage) {
      weight += this.currentStage.weight * this.subProgress;
    }
    return Math.min(100, Math.round((weight / this.totalWeight) * 100));
  }

  getCurrentLabel() {
    if (this.currentStage) return this.currentStage.label;
    if (this.metrics.length === this.stages.length) return "Complete";
    return "Waiting…";
  }

  getReport() {
    return {
      totalMs: this.bootStartMs ? Math.round(performance.now() - this.bootStartMs) : 0,
      percent: this.getPercent(),
      stages: [...this.metrics],
      errors: [...this.errors],
      success: this.errors.length === 0 && this.metrics.every((m) => m.ok),
    };
  }

  _emit() {
    this.onUpdate?.(this);
  }
}

export const LOAD_STAGES = [
  { id: "webgl_probe", label: "Checking WebGL support", weight: 8 },
  { id: "device_profile", label: "Detecting device & quality tier", weight: 7 },
  { id: "scene_3d", label: "Creating 3D scene & camera", weight: 10 },
  { id: "webgl_renderer", label: "Initializing WebGL renderer", weight: 12 },
  { id: "tomato_renderer", label: "Compiling tomato shaders", weight: 10 },
  { id: "lights_input", label: "Setting up lights & controls", weight: 8 },
  { id: "mpm_grid", label: "Allocating MPM simulation grid", weight: 15 },
  { id: "anatomy_particles", label: "Building anatomical tissue particles", weight: 22 },
  { id: "surface_mesh", label: "Extracting surface mesh (marching cubes)", weight: 13 },
  { id: "finalize", label: "Finalizing simulation", weight: 5 },
];
