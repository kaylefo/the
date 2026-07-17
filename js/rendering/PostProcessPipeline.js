import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { HeatShimmerShader, FilmGrainShader } from "./HeatShimmerPass.js";

/**
 * Post-process chain: render → heat shimmer → bloom → film grain.
 */
export class PostProcessPipeline {
  constructor(renderer, scene, camera, quality = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.shimmerPass = null;
    if (quality.heatShimmer !== false) {
      this.shimmerPass = new ShaderPass(HeatShimmerShader);
      this.composer.addPass(this.shimmerPass);
    }

    this.bloomPass = null;
    if (quality.bloom) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        quality.bloomStrength ?? 0.35,
        quality.bloomRadius ?? 0.45,
        quality.bloomThreshold ?? 0.78
      );
      this.composer.addPass(this.bloomPass);
    }

    this.grainPass = null;
    if (quality.filmGrain) {
      this.grainPass = new ShaderPass(FilmGrainShader);
      this.grainPass.uniforms.uAmount.value = quality.grainAmount ?? 0.035;
      this.composer.addPass(this.grainPass);
    }
  }

  applyQuality(quality) {
    this.quality = quality;
    if (this.bloomPass) {
      this.bloomPass.strength = quality.bloomStrength ?? 0.35;
      this.bloomPass.radius = quality.bloomRadius ?? 0.45;
      this.bloomPass.threshold = quality.bloomThreshold ?? 0.78;
      this.bloomPass.enabled = quality.bloom ?? false;
    }
    if (this.shimmerPass) {
      this.shimmerPass.enabled = quality.heatShimmer !== false;
      this.shimmerPass.uniforms.uStrength.value = quality.shimmerStrength ?? 0.45;
    }
    if (this.grainPass) {
      this.grainPass.enabled = quality.filmGrain ?? false;
    }
  }

  setHeatPoints(points, time, globalStrength = 1) {
    if (!this.shimmerPass) return;
    const u = this.shimmerPass.uniforms;
    const keys = ["uHeat0", "uHeat1", "uHeat2", "uHeat3"];
    for (let i = 0; i < 4; i++) {
      const p = points[i];
      if (p) u[keys[i]].value.set(p.x, p.y, p.z * globalStrength);
      else u[keys[i]].value.set(0, 0, 0);
    }
    u.uTime.value = time;
  }

  resize(width, height) {
    this.composer.setSize(width, height);
  }

  render(time = 0) {
    if (this.grainPass) this.grainPass.uniforms.uTime.value = time;
    this.composer.render();
  }
}
