import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * Bloom post-process for steam glow and specular highlights.
 */
export class PostProcessPipeline {
  constructor(renderer, scene, camera, quality = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = quality.bloom ?? false;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = null;
    if (this.enabled) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        quality.bloomStrength ?? 0.35,
        quality.bloomRadius ?? 0.45,
        quality.bloomThreshold ?? 0.78
      );
      this.composer.addPass(this.bloomPass);
    }
  }

  applyQuality(quality) {
    this.enabled = quality.bloom ?? false;
    if (this.bloomPass) {
      this.bloomPass.strength = quality.bloomStrength ?? 0.35;
      this.bloomPass.radius = quality.bloomRadius ?? 0.45;
      this.bloomPass.threshold = quality.bloomThreshold ?? 0.78;
      this.bloomPass.enabled = this.enabled;
    }
  }

  resize(width, height) {
    this.composer.setSize(width, height);
  }

  render() {
    if (this.enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
