import * as THREE from "three";
import { MPMSolver } from "./physics/mpm/MPMSolver.js";
import { buildTomatoParticles, getTomatoBounds } from "./physics/TomatoAnatomy.js";
import { FLIPSolver } from "./physics/fluid/FLIPSolver.js";
import { ForceRecorder } from "./physics/validation/ForceRecorder.js";
import { marchingCubes } from "./rendering/MarchingCubes.js";
import { TomatoRenderer } from "./rendering/TomatoRenderer.js";
import { DeviceProfile, AdaptiveQuality } from "./platform/DeviceProfile.js";
import { MobileHUD } from "./ui/MobileHUD.js";

const GROUND_Y = 0;
const SCALE = 8;

export class TomatoSimulation {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.device = options.device ?? new DeviceProfile();
    this.quality = this.device.getSettings();
    this.hud = options.hud ?? null;

    this.squeezeForce = 1.5;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.activePointerId = null;
    this.isDragging = false;
    this.frame = 0;
    this.simScale = SCALE;
    this.paused = false;
    this.running = false;

    this.densityField = null;
    this.damageField = { data: null, origin: null, dx: 0 };

    this.adaptive = new AdaptiveQuality(this.device, (q) => this.applyQuality(q));

    // Scene must exist before renderer (camera required for resize)
    this._initScene();
    this._initRenderer();
    this._initRendering();
    this._initValidation();
    this._initInput();
    this._initLights();
    this._applyRendererQuality();

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.fixedDt = 1 / this.quality.fixedFps;
    this.fpsFrames = 0;
    this.fpsTime = 0;

    window.__tomatoSim = this;
  }

  /** Heavy physics setup — call async so loading UI can update. */
  async initialize(onProgress) {
    onProgress?.(`Initializing MPM grid (${this.quality.gridSize}³)…`);
    await this._yield();

    this._initPhysicsShell();
    onProgress?.("Building tomato tissue particles…");
    await this._yield();

    this.resetTomato();
    onProgress?.("Generating surface mesh…");
    await this._yield();

    this._updateMesh();
    onProgress?.("Ready");
  }

  _yield() {
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  applyQuality(settings) {
    this.quality = settings;
    this.fixedDt = 1 / settings.fixedFps;
    this._rebuildPhysics(settings);
    this.tomatoRenderer?.applyQuality(settings);
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
    this.renderer.toneMappingExposure = 1.2;
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
    this._updateCameraForViewport(w, h);
  }

  _updateCameraForViewport(w, h) {
    const aspect = w / h;
    const isPortrait = h > w;
    const dist = isPortrait ? 0.72 : 0.65;
    const height = isPortrait ? 0.42 : 0.45;
    this.camera.position.set(dist * 0.85, height, dist);
    this.camera.lookAt(0, 0.32 * SCALE, 0);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0c10);
    this.scene.fog = new THREE.Fog(0x0e0c10, 2.5, 6);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);

    const groundGeo = new THREE.CircleGeometry(1.2, this.quality.gridSize >= 28 ? 64 : 32);
    this.ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.9 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = GROUND_Y * SCALE - 0.001;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.012, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.75 })
    );
    board.position.y = GROUND_Y * SCALE - 0.006;
    board.receiveShadow = true;
    this.scene.add(board);

    this.plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.012, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.7, roughness: 0.25 })
    );
    this.plate.castShadow = true;
    this.scene.add(this.plate);
  }

  _initPhysicsShell() {
    this._rebuildPhysics(this.quality);
  }

  _rebuildPhysics(q) {
    const origin = [-0.08, -0.01, -0.08];
    const dx = 0.004;
    const n = q.gridSize;

    this.mpm = new MPMSolver({ nx: n, ny: n, nz: n, origin, dx, groundY: GROUND_Y });
    this.flip = new FLIPSolver(n, n, n, origin, dx);
    this.flip.groundY = GROUND_Y;
    this.flip.maxMarkers = q.flipMaxMarkers;
    this.flip.pressureIterations = q.flipIterations;

    this.mpmOrigin = origin;
    this.mpmDx = dx;
    this.densityField = new Float32Array(n * n * n);
    this.damageField.data = this.mpm.grid.damage;
    this.damageField.origin = origin;
    this.damageField.dx = dx;
    this._particleOptions = {
      spacing: q.particleSpacing,
      seedCount: q.seedCount,
      loculeFluidCount: q.loculeFluidCount,
    };
  }

  _initRendering() {
    this.tomatoRenderer = new TomatoRenderer(this.scene, this.quality);
    this.tomatoRenderer.mesh.scale.setScalar(this.simScale);
    this.tomatoRenderer.fluidPoints.scale.setScalar(this.simScale);
  }

  _initValidation() {
    this.forceRecorder = new ForceRecorder();
    this.chartCanvas = document.getElementById("force-chart");
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0xfff2ea, 0x1a1410, 0.5);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff5ee, 1.5);
    this.keyLight.position.set(1.2, 2, 0.8);
    this.keyLight.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      this.keyLight.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    }
    this.scene.add(this.keyLight);

    const rim = new THREE.DirectionalLight(0xff6644, 0.4);
    rim.position.set(-1, 0.8, -1);
    this.scene.add(rim);
  }

  _initInput() {
    const onDown = (e) => {
      if (e.target.closest("#hud")) return;
      e.preventDefault();
      this.isDragging = true;
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this._updatePointer(e);
    };

    const onMove = (e) => {
      if (this.activePointerId !== e.pointerId) return;
      this._updatePointer(e);
    };

    const onUp = (e) => {
      if (this.activePointerId !== e.pointerId) return;
      this.isDragging = false;
      this.activePointerId = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    this.canvas.addEventListener("pointerdown", onDown, { passive: false });
    this.canvas.addEventListener("pointermove", onMove, { passive: true });
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointercancel", onUp);

    // Prevent iOS scroll/zoom gestures on canvas
    this.canvas.addEventListener("touchstart", (e) => {
      if (!e.target.closest("#hud")) e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener("wheel", (e) => {
      if (this.device.mobile) return;
      this.squeezeForce = Math.max(0.5, Math.min(4, this.squeezeForce - e.deltaY * 0.002));
      this._syncSlider();
    }, { passive: true });

    const onResize = () => this._resize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    window.addEventListener("orientationchange", () => setTimeout(onResize, 150));

    document.addEventListener("visibilitychange", () => {
      this.paused = document.hidden;
      this.hud?.setPaused(this.paused);
      if (!this.paused) this.clock.getDelta();
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.resetTomato();
      if (e.code === "Space") { e.preventDefault(); this.dropTomato(); }
    });

    document.getElementById("force-slider")?.addEventListener("input", (e) => {
      this.squeezeForce = parseFloat(e.target.value);
    });
  }

  _syncSlider() {
    const slider = document.getElementById("force-slider");
    if (slider) slider.value = this.squeezeForce.toFixed(2);
  }

  _updatePointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  resetTomato() {
    this.mpm.reset();
    this.flip.reset();
    this.forceRecorder.reset();
    buildTomatoParticles(this.mpm, {
      radius: 0.038,
      center: [0, 0.043, 0],
      ...this._particleOptions,
    });
    const bounds = getTomatoBounds(this.mpm);
    this.mpm.pressRestY = bounds.maxY + 0.06;
    this.mpm.pressPlateY = this.mpm.pressRestY;
    this._updatePlateVisual();
  }

  dropTomato() {
    for (const p of this.mpm.particles) {
      p.x[1] += 0.08;
      p.v[1] = -0.5;
    }
  }

  _updatePressFromPointer() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3 * SCALE);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;

    if (this.isDragging) {
      const simY = hit.y / SCALE;
      const bounds = getTomatoBounds(this.mpm);
      const minY = bounds.maxY + 0.005;
      const maxY = this.mpm.pressRestY;
      this.mpm.setPressPlate(Math.max(minY, Math.min(maxY, simY)), true);
    } else {
      this.mpm.setPressPlate(this.mpm.pressPlateY, false);
    }
    this._updatePlateVisual();
  }

  _updatePlateVisual() {
    this.plate.position.set(0, this.mpm.pressPlateY * SCALE, 0);
  }

  _coupleRupture(events) {
    for (const e of events) {
      this.flip.emit(e.x, e.v, 8 + Math.floor(e.intensity * 20), 0.002);
    }
  }

  _physicsStep(dt) {
    if (this.isDragging) {
      const rate = this.device.mobile ? this.squeezeForce * 1.4 : this.squeezeForce;
      this.mpm.setPressPlate(this.mpm.pressPlateY - rate * dt * 0.003, true);
      this._updatePlateVisual();
    }

    const ruptures = this.mpm.step(dt);
    this._coupleRupture(ruptures);
    this.flip.step(dt);

    this.forceRecorder.record(
      this.mpm.pressForce,
      this.mpm.pressDisplacement,
      performance.now() / 1000
    );
  }

  _updateMesh() {
    this.mpm.sampleDensity(this.densityField, 1.2);
    const mc = marchingCubes(
      this.densityField,
      this.mpm.nx, this.mpm.ny, this.mpm.nz,
      this.mpmOrigin, this.mpmDx, 0.8
    );

    if (mc.triangleCount > 0) {
      this.tomatoRenderer.updateMesh(mc, this.damageField, this.mpm.nx, this.mpm.ny, this.mpm.nz);
    }

    this.tomatoRenderer.updateFluid(this.flip.markers);
    this.tomatoRenderer.setTime(this.clock.elapsedTime);
  }

  _updateHUD(fpsDt) {
    this.fpsFrames++;
    this.fpsTime += fpsDt;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      const el = document.getElementById("stat-fps");
      if (el) el.textContent = `FPS: ${fps}`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const damage = this.mpm.getMaxDamage();
    document.getElementById("stat-strain").textContent = `Damage φ: ${(damage * 100).toFixed(0)}%`;
    document.getElementById("stat-juice").textContent = `Juice: ${this.flip.getVolumeMl()} ml`;
    document.getElementById("stat-particles").textContent =
      `MPM: ${this.mpm.getActiveCount()} · FLIP: ${this.flip.markers.length}`;
    document.getElementById("stat-energy").textContent = `Energy: ${this.mpm.totalEnergy.toFixed(1)} J`;

    if (!this.device.mobile || !document.getElementById("hud")?.classList.contains("collapsed")) {
      this.forceRecorder.drawChart(this.chartCanvas);
    }
  }

  update() {
    if (this.paused) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.adaptive.recordFrame(dt);
    this.adaptive.update(performance.now());

    this._updatePressFromPointer();

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.quality.maxPhysicsSteps) {
      this._physicsStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }

    if (this.frame % this.quality.meshInterval === 0) this._updateMesh();
    this.frame++;

    if (!this.device.mobile) {
      this.camera.position.x = 0.55 + Math.sin(this.clock.elapsedTime * 0.2) * 0.02;
    }
    this.camera.lookAt(0, 0.32 * SCALE, 0);

    this._updateHUD(dt);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.getElementById("loading")?.classList.add("hidden");
    const loop = () => {
      this.update();
      requestAnimationFrame(loop);
    };
    loop();
  }
}

export async function createSimulation(canvas, onProgress) {
  const device = new DeviceProfile();
  const hud = new MobileHUD(device);
  hud.setQuality(device.summary());

  await new Promise((r) => requestAnimationFrame(r));

  const sim = new TomatoSimulation(canvas, { device, hud });
  await sim.initialize(onProgress);
  return sim;
}
