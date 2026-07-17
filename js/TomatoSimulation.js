import * as THREE from "three";
import { MPMSolver } from "./physics/mpm/MPMSolver.js";
import { buildTomatoParticles, getTomatoBounds } from "./physics/TomatoAnatomy.js";
import { FLIPSolver } from "./physics/fluid/FLIPSolver.js";
import { ForceRecorder } from "./physics/validation/ForceRecorder.js";
import { marchingCubes } from "./rendering/MarchingCubes.js";
import { TomatoRenderer } from "./rendering/TomatoRenderer.js";

const GROUND_Y = 0;
const SCALE = 8; // visual scale: 1 sim-meter → 8 scene units

export class TomatoSimulation {
  constructor(canvas) {
    this.canvas = canvas;
    this.squeezeForce = 1.5;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.isDragging = false;
    this.frame = 0;
    this.simScale = SCALE;

    this.densityField = null;
    this.damageField = { data: null, origin: null, dx: 0 };

    this._initRenderer();
    this._initScene();
    this._initPhysics();
    this._initRendering();
    this._initValidation();
    this._initInput();
    this._initLights();

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.fixedDt = 1 / 120;
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0c10);
    this.scene.fog = new THREE.Fog(0x0e0c10, 2.5, 6);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0.55, 0.45, 0.65);
    this.camera.lookAt(0, 0.32 * SCALE, 0);

    const groundGeo = new THREE.CircleGeometry(1.2, 64);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.9 });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
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
    board.castShadow = true;
    this.scene.add(board);

    // Press plate (user-controlled)
    this.plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.012, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.7, roughness: 0.25 })
    );
    this.plate.castShadow = true;
    this.scene.add(this.plate);
  }

  _initPhysics() {
    const origin = [-0.08, -0.01, -0.08];
    const dx = 0.004;
    this.mpm = new MPMSolver({ nx: 32, ny: 32, nz: 32, origin, dx, groundY: GROUND_Y });
    this.flip = new FLIPSolver(32, 32, 32, origin, dx);
    this.flip.groundY = GROUND_Y;
    this.mpmOrigin = origin;
    this.mpmDx = dx;

    this.densityField = new Float32Array(32 * 32 * 32);
    this.damageField.data = this.mpm.grid.damage;
    this.damageField.origin = origin;
    this.damageField.dx = dx;

    this.resetTomato();
  }

  _initRendering() {
    this.tomatoRenderer = new TomatoRenderer(this.scene);
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

    const key = new THREE.DirectionalLight(0xfff5ee, 1.5);
    key.position.set(1.2, 2, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff6644, 0.4);
    rim.position.set(-1, 0.8, -1);
    this.scene.add(rim);
  }

  _initInput() {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.isDragging = true;
      this._updatePointer(e);
    });
    window.addEventListener("pointermove", (e) => this._updatePointer(e));
    window.addEventListener("pointerup", () => { this.isDragging = false; });

    this.canvas.addEventListener("wheel", (e) => {
      this.squeezeForce = Math.max(0.5, Math.min(4, this.squeezeForce - e.deltaY * 0.002));
      const slider = document.getElementById("force-slider");
      if (slider) slider.value = this.squeezeForce.toFixed(2);
    }, { passive: true });

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.resetTomato();
      if (e.code === "Space") { e.preventDefault(); this._dropTomato(); }
    });

    document.getElementById("force-slider")?.addEventListener("input", (e) => {
      this.squeezeForce = parseFloat(e.target.value);
    });
    document.getElementById("reset-btn")?.addEventListener("click", () => this.resetTomato());
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
    buildTomatoParticles(this.mpm, { radius: 0.038, center: [0, 0.043, 0], spacing: 0.0032 });
    const bounds = getTomatoBounds(this.mpm);
    this.mpm.pressRestY = bounds.maxY + 0.06;
    this.mpm.pressPlateY = this.mpm.pressRestY;
    this._updatePlateVisual();
  }

  _dropTomato() {
    for (const p of this.mpm.particles) {
      p.x[1] += 0.08;
      p.v[1] = -0.5;
    }
  }

  _updatePressFromPointer() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3 * SCALE);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, hit);

    if (this.isDragging) {
      const simY = hit.y / SCALE;
      const bounds = getTomatoBounds(this.mpm);
      const minY = bounds.maxY + 0.005;
      const maxY = this.mpm.pressRestY;
      this.mpm.setPressPlate(
        Math.max(minY, Math.min(maxY, simY)),
        true
      );
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
      const count = 8 + Math.floor(e.intensity * 20);
      this.flip.emit(e.x, e.v, count, 0.002);
    }
  }

  _physicsStep(dt) {
    if (this.isDragging) {
      this.mpm.setPressPlate(
        this.mpm.pressPlateY - this.squeezeForce * dt * 0.003,
        true
      );
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
    const iso = 0.8;
    const mc = marchingCubes(
      this.densityField,
      this.mpm.nx, this.mpm.ny, this.mpm.nz,
      this.mpmOrigin, this.mpmDx, iso
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
      document.getElementById("stat-fps").textContent = `FPS: ${Math.round(this.fpsFrames / this.fpsTime)}`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const damage = this.mpm.getMaxDamage();
    document.getElementById("stat-strain").textContent = `Damage φ: ${(damage * 100).toFixed(0)}%`;
    document.getElementById("stat-juice").textContent = `Juice: ${this.flip.getVolumeMl()} ml`;
    document.getElementById("stat-particles").textContent = `MPM: ${this.mpm.getActiveCount()} · FLIP: ${this.flip.markers.length}`;
    document.getElementById("stat-energy").textContent = `Energy: ${this.mpm.totalEnergy.toFixed(1)} J`;

    this.forceRecorder.drawChart(this.chartCanvas);
  }

  update() {
    this._updatePressFromPointer();

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 4) {
      this._physicsStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }

    if (this.frame % 2 === 0) this._updateMesh();
    this.frame++;

    this.camera.position.x = 0.55 + Math.sin(this.clock.elapsedTime * 0.2) * 0.02;
    this.camera.lookAt(0, 0.32 * SCALE, 0);

    this._updateHUD(dt);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    document.getElementById("loading")?.classList.add("hidden");
    const loop = () => {
      this.update();
      requestAnimationFrame(loop);
    };
    loop();
  }
}
