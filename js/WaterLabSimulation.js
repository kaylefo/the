import * as THREE from "three";
import { WaterFLIPSolver } from "./physics/fluid/WaterFLIPSolver.js";
import { VaporizationCoupler } from "./physics/fluid/VaporizationCoupler.js";
import { StableFluidsSmoke, smokeGridFromTank } from "./physics/smoke/StableFluidsSmoke.js";
import { TANK, fillTank, gridFromTank, tankBounds } from "./physics/WaterTank.js";
import { marchingCubes } from "./rendering/MarchingCubes.js";
import { WaterRenderer } from "./rendering/WaterRenderer.js";
import { SmokeVolumeRenderer } from "./rendering/SmokeVolumeRenderer.js";
import { WaterDeviceProfile, AdaptiveQuality } from "./platform/DeviceProfile.js";
import { MobileHUD } from "./ui/MobileHUD.js";
import { WaterLabAudio } from "./audio/WaterLabAudio.js";
import { BubbleSystem } from "./physics/fluid/BubbleSystem.js";
import { WaterSmokeCoupler } from "./physics/fluid/WaterSmokeCoupler.js";
import { PostProcessPipeline } from "./rendering/PostProcessPipeline.js";
import { CausticsGenerator } from "./rendering/CausticsGenerator.js";
import { createTableCausticsMaterial, createFloorCausticsMaterial } from "./rendering/TableCausticsMaterial.js";
import { loadStudioEnvironment, applyEnvironmentToScene } from "./rendering/StudioEnvironment.js";
import { OrbitCameraController } from "./platform/OrbitCameraController.js";
import { CondensationSimulator } from "./physics/condensation/CondensationSimulator.js";
import { GlassTankRenderer } from "./rendering/GlassTankRenderer.js";
import { WebGPUSmokeAccelerator } from "./physics/smoke/WebGPUSmokeAccelerator.js";

const SCALE = 8;
const LOOK_Y = 0.35;
const PHYSICS_DT = 1 / 120;

export class WaterLabSimulation {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.device = options.device ?? new WaterDeviceProfile();
    this.quality = this.device.getSettings();
    this.hud = options.hud ?? null;

    this.simScale = SCALE;
    this.heatIntensity = 1.2;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.activePointerId = null;
    this.isPointerDown = false;
    this.orbitDrag = false;
    this.orbitPointerId = null;
    this.activePointers = new Map();
    this.lastOrbitPos = null;
    this.lastPinchDist = null;
    this.smokeSolverMode = "CPU";
    this.smokeGPU = null;
    this._smokeGpuBusy = false;
    this.lastPointerWorld = null;
    this.lastPointerTime = 0;
    this.frame = 0;
    this.paused = false;
    this.running = false;
    this.physicsSubsteps = this.quality.physicsSubsteps ?? 2;
    this.surfaceY = 0.08;
    this.audio = new WaterLabAudio();
    this.bubbles = new BubbleSystem(300);
    this.envMap = null;
    this._heatProject = new THREE.Vector3();

    this.adaptive = new AdaptiveQuality(this.device, (q) => this.applyQuality(q));
    window.__waterLab = this;
  }

  _yield() {
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  applyQuality(settings) {
    this.quality = settings;
    this.waterRenderer?.applyQuality(settings);
    this.smokeRenderer?.applyQuality(settings);
    this.postProcess?.applyQuality(settings);
    if (this.envMap) {
      this.waterRenderer?.setEnvMap(this.envMap, settings.envStrength ?? 0.85);
      this.glassRenderer?.setEnvMap(this.envMap, settings.envStrength ?? 0.85);
      applyEnvironmentToScene(this.scene, this.envMap, settings.envStrength ?? 0.85);
    }
    this._applyRendererQuality();
    this.hud?.setQuality(this.device.summary());
  }

  _applyRendererQuality() {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.setPixelRatio(this.device.getPixelRatio(q));
    this._resize();
    if (this.keyLight) {
      this.keyLight.castShadow = q.shadows;
      if (q.shadows && q.shadowMapSize > 0) {
        this.keyLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      }
    }
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality.antialias,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(this.device.getPixelRatio(this.quality));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._resize();
  }

  _resize() {
    if (!this.renderer || !this.camera) return;
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.waterRenderer?.resize(
      this.renderer.domElement.width,
      this.renderer.domElement.height
    );
    this.postProcess?.resize(w, h);
    this._updateCameraForViewport(w, h);
  }

  _updateCameraForViewport(w, h) {
    const isPortrait = h > w;
    const dist = isPortrait ? 1.5 : 1.25;
    this.orbitCamera?.reset({
      x: dist * 0.55,
      y: isPortrait ? 0.55 : 0.5,
      z: dist,
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.35);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30);
    this.orbitCamera = new OrbitCameraController(this.camera, {
      target: new THREE.Vector3(0, LOOK_Y, 0),
      minDistance: 0.85,
      maxDistance: 3.8,
    });
  }

  _initEnvironment() {
    this.caustics = new CausticsGenerator(this.quality.causticRes ?? 96);
    this.condensation = new CondensationSimulator(TANK, this.quality.condensationRes ?? 48);

    const floorMat = createFloorCausticsMaterial(this.caustics.texture, TANK, SCALE);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      floorMat
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floorMat = floorMat;

    const tableMat = createTableCausticsMaterial(this.caustics.texture, TANK, SCALE);
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.025, 0.55),
      tableMat
    );
    table.position.y = -0.012;
    table.receiveShadow = true;
    this.scene.add(table);
    this.tableMat = tableMat;

    this._buildGlassTank();
  }

  _buildGlassTank() {
    this.glassRenderer = new GlassTankRenderer(
      this.scene,
      TANK,
      SCALE,
      this.condensation.texture
    );
  }

  _initPhysics() {
    const q = this.quality;
    const grid = gridFromTank(TANK, q.waterGridSize);
    this.gridInfo = grid;

    this.water = new WaterFLIPSolver(grid.nx, grid.ny, grid.nz, grid.origin, grid.dx, TANK);
    this.water.maxMarkers = q.flipMaxMarkers;
    this.water.pressureIterations = q.flipIterations;

    const smokeGrid = smokeGridFromTank(TANK, q.smokeRes);
    this.smoke = new StableFluidsSmoke(smokeGrid.nx, smokeGrid.ny, smokeGrid.nz, smokeGrid.origin, smokeGrid.dx);
    this.smoke.projectIterations = Math.round(q.flipIterations * 0.5);

    this.vaporization = new VaporizationCoupler({
      maxRemovePerFrame: Math.round(q.flipMaxMarkers * 0.008),
    });
    this.waterSmoke = new WaterSmokeCoupler(TANK);
    const b = tankBounds(TANK);
    this.surfaceY = b.yMin + (b.yMax - b.yMin) * TANK.fillRatio;
    this.vaporization.setSurfaceY(this.surfaceY);

    if (this.quality.useWebGPU) {
      WebGPUSmokeAccelerator.tryCreate().then((acc) => {
        if (acc) {
          this.smokeGPU = acc;
          this.smokeSolverMode = "WebGPU";
        }
      });
    }
  }

  _initRendering() {
    this.waterRenderer = new WaterRenderer(this.scene, this.renderer, this.quality);
    this.waterRenderer.mesh.scale.setScalar(this.simScale);
    this.waterRenderer.foamPoints.scale.setScalar(this.simScale);

    this.smokeRenderer = new SmokeVolumeRenderer(this.scene, this.quality);
    const sg = smokeGridFromTank(TANK, this.quality.smokeRes);
    const s = this.simScale;
    this.smokeRenderer.setVolumeBounds(
      [sg.origin[0] * s, sg.origin[1] * s, sg.origin[2] * s],
      [sg.nx * sg.dx * s, sg.ny * sg.dx * s, sg.nz * sg.dx * s]
    );

    this.postProcess = new PostProcessPipeline(this.renderer, this.scene, this.camera, this.quality);
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0xd8e8ff, 0x1a1410, 0.45);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff8f0, 1.8);
    this.keyLight.position.set(1.5, 2.5, 1);
    this.keyLight.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      this.keyLight.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
      this.keyLight.shadow.camera.near = 0.1;
      this.keyLight.shadow.camera.far = 8;
      this.keyLight.shadow.camera.left = -2;
      this.keyLight.shadow.camera.right = 2;
      this.keyLight.shadow.camera.top = 2;
      this.keyLight.shadow.camera.bottom = -2;
    }
    this.scene.add(this.keyLight);

    const rim = new THREE.DirectionalLight(0x88aacc, 0.35);
    rim.position.set(-1.2, 1, -1.5);
    this.scene.add(rim);

    const lightDir = new THREE.Vector3(1.5, 2.5, 1).normalize();
    this.waterRenderer.setLightDir(lightDir);
    this.smokeRenderer.setLightDir(lightDir);
  }

  _initInput() {
    const isOrbitButton = (e) => e.button === 2 || e.button === 1 || e.altKey;
    const isOrbitMode = () => this.orbitDrag || this.activePointers.size >= 2;

    const onDown = (e) => {
      if (e.target.closest("#hud")) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (isOrbitButton(e) || this.activePointers.size >= 2) {
        e.preventDefault();
        if (this.activePointers.size >= 2 && this.isPointerDown) {
          this.isPointerDown = false;
          this.activePointerId = null;
          this.vaporization.clearSustained();
          this.lastPointerWorld = null;
        }
        this.orbitDrag = true;
        this.orbitPointerId = e.pointerId;
        this.lastOrbitPos = { x: e.clientX, y: e.clientY };
        if (this.activePointers.size >= 2) {
          this.lastPinchDist = this._pinchDistance();
        }
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
        return;
      }

      e.preventDefault();
      this.isPointerDown = true;
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this._updatePointer(e);
      this._handleInteraction(true);
      this.audio.init().then(() => {
        this.audio.resume();
        this.audio.playSizzle(this.heatIntensity * 0.6);
      });
      if (this.device.mobile && navigator.vibrate) navigator.vibrate(8);
    };

    const onMove = (e) => {
      if (this.activePointers.has(e.pointerId)) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (isOrbitMode()) {
        if (this.activePointers.size >= 2) {
          const dist = this._pinchDistance();
          if (this.lastPinchDist != null) {
            this.orbitCamera.zoom((this.lastPinchDist - dist) * 2.5);
          }
          this.lastPinchDist = dist;
          const c = this._pinchCenter();
          if (this.lastOrbitPos) {
            this.orbitCamera.rotate(c.x - this.lastOrbitPos.x, c.y - this.lastOrbitPos.y);
          }
          this.lastOrbitPos = c;
        } else if (this.orbitDrag && this.lastOrbitPos) {
          const dx = e.clientX - this.lastOrbitPos.x;
          const dy = e.clientY - this.lastOrbitPos.y;
          this.orbitCamera.rotate(dx, dy);
          this.lastOrbitPos = { x: e.clientX, y: e.clientY };
        }
        return;
      }

      if (this.activePointerId !== e.pointerId) return;
      this._updatePointer(e);
      if (this.isPointerDown) this._handleInteraction(false);
    };

    const onUp = (e) => {
      this.activePointers.delete(e.pointerId);

      if (this.orbitPointerId === e.pointerId) {
        this.orbitPointerId = this.activePointers.size > 0 ? [...this.activePointers.keys()][0] : null;
      }

      if (this.activePointers.size >= 2) {
        this.orbitDrag = true;
        this.lastPinchDist = this._pinchDistance();
        this.lastOrbitPos = this._pinchCenter();
      } else if (this.activePointers.size === 1 && this.orbitPointerId != null) {
        this.orbitDrag = true;
        this.lastOrbitPos = this.activePointers.get(this.orbitPointerId) ?? null;
        this.lastPinchDist = null;
      } else {
        this.orbitDrag = false;
        this.orbitPointerId = null;
        this.lastOrbitPos = null;
        this.lastPinchDist = null;
      }

      if (this.orbitDrag || this.orbitPointerId === e.pointerId) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }

      if (this.activePointerId !== e.pointerId) return;
      this.isPointerDown = false;
      this.activePointerId = null;
      this.vaporization.clearSustained();
      this.lastPointerWorld = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    this.canvas.addEventListener("pointerdown", onDown, { passive: false });
    this.canvas.addEventListener("pointermove", onMove, { passive: true });
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointercancel", onUp);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("touchstart", (e) => {
      if (!e.target.closest("#hud")) e.preventDefault();
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.resetTank();
      if (e.code === "Space") {
        e.preventDefault();
        const b = tankBounds(TANK);
        this.vaporization.addHeatSource(
          (b.xMin + b.xMax) * 0.5,
          b.yMin + (b.yMax - b.yMin) * 0.7,
          (b.zMin + b.zMax) * 0.5,
          2.5,
          0.2
        );
      }
    });

    document.getElementById("heat-slider")?.addEventListener("input", (e) => {
      this.heatIntensity = parseFloat(e.target.value);
    });

    this.canvas.addEventListener("wheel", (e) => {
      if (this.device.mobile) return;
      if (e.shiftKey) {
        this.orbitCamera.zoom(e.deltaY);
        return;
      }
      this.heatIntensity = Math.max(0.3, Math.min(3, this.heatIntensity - e.deltaY * 0.002));
      const slider = document.getElementById("heat-slider");
      if (slider) slider.value = this.heatIntensity.toFixed(2);
    }, { passive: true });

    document.getElementById("reset-btn")?.addEventListener("click", () => this.resetTank());

    const onResize = () => this._resize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", () => {
      this.paused = document.hidden;
      if (!this.paused) this.clock.getDelta();
    });
  }

  _pinchDistance() {
    const pts = [...this.activePointers.values()];
    if (pts.length < 2) return 0;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.hypot(dx, dy);
  }

  _pinchCenter() {
    const pts = [...this.activePointers.values()];
    if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
    return { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
  }

  _updatePointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _raycastSimPoint() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const b = tankBounds(TANK);
    const s = this.simScale;

    const meshHits = this.raycaster.intersectObject(this.waterRenderer.mesh, false);
    if (meshHits.length > 0) {
      const p = meshHits[0].point;
      return {
        x: p.x / s,
        y: p.y / s,
        z: p.z / s,
        underwater: p.y / s < this.surfaceY - 0.002,
      };
    }

    const box = new THREE.Box3(
      new THREE.Vector3(b.xMin * s, b.yMin * s, b.zMin * s),
      new THREE.Vector3(b.xMax * s, b.yMax * s, b.zMax * s)
    );
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectBox(box, hit)) {
      return {
        x: hit.x / s,
        y: hit.y / s,
        z: hit.z / s,
        underwater: hit.y / s < this.surfaceY,
      };
    }

    const planeY = this.surfaceY;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY * s);
    const planeHit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, planeHit)) {
      return {
        x: planeHit.x / s,
        y: planeHit.y / s,
        z: planeHit.z / s,
        underwater: false,
      };
    }

    return {
      x: (b.xMin + b.xMax) * 0.5,
      y: planeY,
      z: (b.zMin + b.zMax) * 0.5,
      underwater: false,
    };
  }

  _handleInteraction(isClick) {
    const pt = this._raycastSimPoint();
    const b = tankBounds(TANK);
    if (pt.x < b.xMin || pt.x > b.xMax || pt.z < b.zMin || pt.z > b.zMax) return;

    const now = performance.now();
    if (this.lastPointerWorld && !isClick) {
      const dt = Math.max(0.001, (now - this.lastPointerTime) / 1000);
      const stirVx = (pt.x - this.lastPointerWorld.x) / dt;
      const stirVz = (pt.z - this.lastPointerWorld.z) / dt;
      this.water.applyStirImpulse(pt.x, pt.y, pt.z, stirVx * 0.02, 0, stirVz * 0.02, 0.025, 2.5);
    }

    if (isClick) {
      this.vaporization.addHeatSource(pt.x, pt.y, pt.z, this.heatIntensity, 0.15);
    } else {
      this.vaporization.setSustainedSource(pt.x, pt.y, pt.z, this.heatIntensity);
    }

    this.lastPointerWorld = { x: pt.x, y: pt.y, z: pt.z };
    this.lastPointerTime = now;
  }

  resetTank() {
    this.water.reset();
    this.smoke.reset();
    this.bubbles.reset();
    this.condensation?.reset();
    this.vaporization.activeSources.length = 0;
    this.water.temperature.reset();
    fillTank(this.water);
  }

  _physicsStep(dt) {
    this.water.step(dt);

    this.surfaceY = this.water.surfaceY;
    this.vaporization.setSurfaceY(this.surfaceY);

    const vapor = this.vaporization.step(this.water, this.smoke, dt, this.heatIntensity, this.bubbles);
    if (vapor.foamEvents?.length) {
      this.waterRenderer.spawnFoam(vapor.foamEvents, this.simScale);
    }

    this.waterSmoke.step(this.water, this.smoke, dt);

    const bubbleResult = this.bubbles.step(
      dt,
      this.surfaceY,
      (x, y, z) => this.water.sampleVelocityAt(x, y, z)
    );
    for (const pop of bubbleResult.pops) {
      this.smoke.inject(pop.x, pop.y + 0.004, pop.z, 0.0015 * pop.intensity, 80, {
        vy: 2 + Math.random(),
        temp: 95,
        radius: pop.r * 6,
      });
      this.water.applyStirImpulse(pop.x, pop.y, pop.z, 0, 0.6, 0, pop.r * 5, pop.intensity * 2);
    }

    this._stepSmoke(dt);
  }

  _stepSmoke(dt) {
    const interval = this.quality.smokeInterval ?? 1;
    this._smokeTick = (this._smokeTick ?? 0) + 1;
    if (this._smokeTick % interval !== 0) return;

    const stepDt = dt * interval;
    const gpu = this.smokeGPU;

    if (gpu?.ready && this.quality.useWebGPU) {
      if (this._smokeGpuBusy && gpu._pendingRead) {
        gpu.flush().finally(() => { this._smokeGpuBusy = false; });
      }
      if (!this._smokeGpuBusy) {
        const submitted = gpu.advectDensity(this.smoke, stepDt);
        if (submitted) {
          this.smoke.step(stepDt, { skipDensityAdvect: true });
          this._smokeGpuBusy = true;
          this.smokeSolverMode = "WebGPU";
          return;
        }
      }
    }

    this.smoke.step(stepDt);
    this.smokeSolverMode = gpu?.ready && this.quality.useWebGPU ? "WebGPU*" : "CPU";
  }

  _updateMesh() {
    this.water.sampleDensity(this.water.densityField);
    let maxD = 0;
    for (let i = 0; i < this.water.densityField.length; i++) {
      if (this.water.densityField[i] > maxD) maxD = this.water.densityField[i];
    }
    const isovalue = maxD * 0.22;
    const g = this.gridInfo;

    if (isovalue > 0) {
      const mc = marchingCubes(
        this.water.densityField,
        g.nx, g.ny, g.nz,
        g.origin, g.dx, isovalue
      );
      if (mc.triangleCount > 0) {
        this.waterRenderer.updateMesh(mc);
      }
    }

    this.caustics.updateFromPhi(
      this.water.phi,
      g.nx, g.ny, g.nz,
      g.origin, g.dx, TANK
    );
    this.smokeRenderer.updateFromSmoke(this.smoke);
  }

  _updateHUD(fpsDt) {
    this.fpsFrames = (this.fpsFrames ?? 0) + 1;
    this.fpsTime = (this.fpsTime ?? 0) + fpsDt;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      const el = document.getElementById("stat-fps");
      if (el) el.textContent = `FPS: ${fps}`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const vol = document.getElementById("stat-volume");
    if (vol) vol.textContent = `Water: ${this.water.getVolumeLiters()} L`;

    const markers = document.getElementById("stat-markers");
    if (markers) markers.textContent = `Markers: ${this.water.markers.length.toLocaleString()}`;

    let smokeAmt = 0;
    for (let i = 0; i < this.smoke.density.length; i++) smokeAmt += this.smoke.density[i];
    const steam = document.getElementById("stat-steam");
    if (steam) steam.textContent = `Steam: ${(smokeAmt * 100).toFixed(0)}%`;

    const bub = document.getElementById("stat-bubbles");
    if (bub) bub.textContent = `Bubbles: ${this.bubbles.bubbles.length}`;

    const tempEl = document.getElementById("stat-temp");
    if (tempEl) tempEl.textContent = `Temp: ${this.water.maxTemperature.toFixed(0)} °C`;

    const solver = document.getElementById("stat-solver");
    if (solver) solver.textContent = `Smoke: ${this.smokeSolverMode}`;

    let condAmt = 0;
    if (this.condensation?.moisture) {
      for (let i = 0; i < this.condensation.moisture.length; i++) {
        condAmt += this.condensation.moisture[i];
      }
    }
    const condEl = document.getElementById("stat-condensation");
    if (condEl) condEl.textContent = `Glass fog: ${Math.min(100, condAmt * 2).toFixed(0)}%`;
  }

  _updateGodRayLight() {
    if (!this.postProcess || !this.keyLight) return;
    const pos = this.keyLight.position.clone().project(this.camera);
    this.postProcess.setGodRayLight(pos.x * 0.5 + 0.5, pos.y * 0.5 + 0.5);
  }

  _updateHeatScreenPoints() {
    if (!this.postProcess) return;
    const points = [];
    for (const src of this.vaporization.activeSources) {
      this._heatProject.set(
        src.x * this.simScale,
        src.y * this.simScale,
        src.z * this.simScale
      );
      this._heatProject.project(this.camera);
      points.push({
        x: this._heatProject.x * 0.5 + 0.5,
        y: this._heatProject.y * 0.5 + 0.5,
        z: Math.min(1, src.intensity * (0.35 + this.vaporization.lastVaporRate * 0.9)),
      });
    }
    this.postProcess.setHeatPoints(points, this.clock.elapsedTime, this.heatIntensity);
  }

  update() {
    if (this.paused) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.adaptive.recordFrame(dt);
    this.adaptive.update(performance.now());

    for (let s = 0; s < this.physicsSubsteps; s++) {
      this._physicsStep(PHYSICS_DT);
    }

    this.waterRenderer.updateFoam(dt, this.simScale);
    this.waterRenderer.updateBubbles(this.bubbles, this.simScale);

    if (this.frame % this.quality.meshInterval === 0) {
      this._updateMesh();
    } else if (this.frame % (this.quality.smokeUploadInterval ?? 1) === 0) {
      this.smokeRenderer.updateFromSmoke(this.smoke);
    }
    this.frame++;

    const elapsed = this.clock.elapsedTime;
    this.tableMat?.userData.causticUniforms?.uTime &&
      (this.tableMat.userData.causticUniforms.uTime.value = elapsed);
    this.floorMat?.userData.causticUniforms?.uTime &&
      (this.floorMat.userData.causticUniforms.uTime.value = elapsed);

    this.orbitCamera.update(dt, elapsed);
    this.glassRenderer?.setTime(elapsed);

    if (this.frame % 2 === 0) {
      this.condensation?.step(this.smoke, dt * 2);
    }

    this.waterRenderer.setTime(this.clock.elapsedTime);
    this.waterRenderer.setSurfaceDynamics(
      this.water.sloshEnergy,
      this.water.surfaceRipple,
      this.vaporization.lastVaporRate
    );
    this.smokeRenderer.setCameraPos(this.camera.position);

    this.waterRenderer.renderWaterPass(this.renderer, this.scene, this.camera, this.smokeRenderer.mesh);
    this._updateHeatScreenPoints();
    this._updateGodRayLight();
    this.postProcess.render(elapsed);

    this.audio.setVaporizationRate(this.vaporization.lastVaporRate);
    this.audio.setSloshEnergy(this.water.sloshEnergy);
    this.audio.update(dt);
    this._updateHUD(dt);
  }

  initClock() {
    this.clock = new THREE.Clock();
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  start(loadingUI) {
    if (this.running) return;
    this.running = true;
    loadingUI?.hide();
    document.getElementById("loading")?.classList.add("hidden");
    const loop = () => {
      this.update();
      requestAnimationFrame(loop);
    };
    loop();
  }
}

export const WATER_LOAD_STAGES = [
  { id: "webgl_probe", label: "Checking WebGL support", weight: 8 },
  { id: "engine_module", label: "Downloading water physics engine", weight: 14 },
  { id: "device_profile", label: "Detecting device & quality tier", weight: 7 },
  { id: "scene_3d", label: "Creating 3D scene & tank", weight: 10 },
  { id: "webgl_renderer", label: "Initializing WebGL renderer", weight: 10 },
  { id: "studio_env", label: "Loading HDR studio environment", weight: 8 },
  { id: "water_renderer", label: "Compiling water & smoke shaders", weight: 12 },
  { id: "lights_input", label: "Setting up lights & controls", weight: 8 },
  { id: "fluid_grid", label: "Allocating FLIP water grid", weight: 15 },
  { id: "smoke_grid", label: "Allocating volumetric smoke grid", weight: 12 },
  { id: "fill_water", label: "Filling tank with water", weight: 10 },
  { id: "surface_mesh", label: "Extracting water surface mesh", weight: 8 },
  { id: "finalize", label: "Finalizing simulation", weight: 5 },
];

export async function createWaterSimulation(canvas, loader) {
  const { device, hud } = await loader.runStage("device_profile", async () => {
    await new Promise((r) => requestAnimationFrame(r));
    const device = new WaterDeviceProfile();
    const hud = new MobileHUD(device);
    hud.setQuality(device.summary());
    return { device, hud };
  });

  const sim = new WaterLabSimulation(canvas, { device, hud });

  await loader.runStage("scene_3d", async () => {
    sim._initScene();
    sim._initEnvironment();
    await sim._yield();
  });

  await loader.runStage("webgl_renderer", async () => {
    sim._initRenderer();
    await sim._yield();
  });

  await loader.runStage("studio_env", async () => {
    sim.envMap = await loadStudioEnvironment(sim.renderer, sim.scene);
    applyEnvironmentToScene(sim.scene, sim.envMap, sim.quality.envStrength ?? 0.85);
    sim.glassRenderer?.setEnvMap(sim.envMap, sim.quality.envStrength ?? 0.85);
    await sim._yield();
  });

  await loader.runStage("water_renderer", async () => {
    sim._initRendering();
    if (sim.envMap) {
      sim.waterRenderer.setEnvMap(sim.envMap, sim.quality.envStrength ?? 0.85);
      sim.glassRenderer?.setEnvMap(sim.envMap, sim.quality.envStrength ?? 0.85);
    }
    await sim._yield();
  });

  await loader.runStage("lights_input", async () => {
    sim._initLights();
    sim._initInput();
    sim._applyRendererQuality();
    sim.initClock();
    await sim._yield();
  });

  await loader.runStage("fluid_grid", async () => {
    sim._initPhysics();
    await sim._yield();
  });

  await loader.runStage("smoke_grid", async () => {
    await sim._yield();
  });

  await loader.runStage("fill_water", async () => {
    sim.resetTank();
    await sim._yield();
  });

  await loader.runStage("surface_mesh", async () => {
    sim._updateMesh();
    await sim._yield();
  });

  await loader.runStage("finalize", async () => {
    sim.postProcess.render();
    await sim._yield();
  });

  return sim;
}
