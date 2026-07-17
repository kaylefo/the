import * as THREE from "three";
import { SoftBody } from "./physics/SoftBody.js";
import { JuiceSystem, SeedSystem } from "./physics/JuiceSystem.js";
import { Vec3, clamp } from "./physics/math.js";

const GROUND_Y = 0;
const TOMATO_RADIUS = 0.72;

export class TomatoSimulation {
  constructor(canvas) {
    this.canvas = canvas;
    this.squeezeForce = 1.2;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.isDragging = false;
    this.dragDepth = 0;
    this.lastRuptureTime = 0;

    this._initRenderer();
    this._initScene();
    this._initTomato();
    this._initParticles();
    this._initSplatters();
    this._initInput();
    this._initLights();

    this.clock = new THREE.Clock();
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x121018);
    this.scene.fog = new THREE.Fog(0x121018, 8, 22);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      50
    );
    this.camera.position.set(2.8, 2.0, 3.4);
    this.camera.lookAt(0, 0.55, 0);

    const groundGeo = new THREE.CircleGeometry(6, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a2420,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = GROUND_Y - 0.001;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const boardGeo = new THREE.BoxGeometry(4.2, 0.08, 4.2);
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x5c3d2e,
      roughness: 0.78,
      metalness: 0,
    });
    this.board = new THREE.Mesh(boardGeo, boardMat);
    this.board.position.y = GROUND_Y - 0.04;
    this.board.receiveShadow = true;
    this.board.castShadow = true;
    this.scene.add(this.board);
  }

  _initTomato() {
    const radius = TOMATO_RADIUS;
    const geo = new THREE.IcosahedronGeometry(radius, 4);
    geo.computeVertexNormals();

    this.skinGeo = geo;
    this.pulpGeo = geo.clone();
    this.pulpGeo.scale(0.94, 0.9, 0.94);

    this.skinMat = new THREE.MeshPhysicalMaterial({
      color: 0xd42b2b,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      sheen: 0.35,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xff8888),
      emissive: new THREE.Color(0x220000),
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.97,
      side: THREE.DoubleSide,
    });

    this.pulpMat = new THREE.MeshStandardMaterial({
      color: 0xff6a4a,
      roughness: 0.95,
      emissive: new THREE.Color(0x661100),
      emissiveIntensity: 0.15,
      side: THREE.DoubleSide,
    });

    this.skinMesh = new THREE.Mesh(this.skinGeo, this.skinMat);
    this.pulpMesh = new THREE.Mesh(this.pulpGeo, this.pulpMat);
    this.skinMesh.castShadow = true;
    this.pulpMesh.castShadow = true;

    const restBottom = -radius * 0.88;
    this.softBodyGround = GROUND_Y + 0.02;

    this.softBody = new SoftBody(this.skinGeo, {
      restScale: new Vec3(1, 0.88, 1),
      mass: 0.16,
      pressure: 1.6,
      groundY: this.softBodyGround,
    });
    this.softBody.translate(0, -restBottom + this.softBodyGround, 0);
    this.pulpGeo.attributes.position.array.set(this.skinGeo.attributes.position.array);
    this.pulpGeo.computeVertexNormals();

    this._buildStem();
    this.scene.add(this.pulpMesh, this.skinMesh, this.stemGroup);
  }

  _buildStem() {
    this.stemGroup = new THREE.Group();

    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x3d6b32,
      roughness: 0.85,
    });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.18, 8), stemMat);
    stem.position.y = 0.09;
    stem.castShadow = true;

    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(0.12, 0.04, 0.22, 0);
    leafShape.quadraticCurveTo(0.12, -0.04, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.012, bevelEnabled: false });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a8c3f, roughness: 0.8, side: THREE.DoubleSide });

    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.rotation.y = (i / 5) * Math.PI * 2;
      leaf.rotation.x = -0.5;
      leaf.position.set(Math.cos(leaf.rotation.y) * 0.06, 0.16, Math.sin(leaf.rotation.y) * 0.06);
      leaf.castShadow = true;
      this.stemGroup.add(leaf);
    }

    this.stemGroup.add(stem);
    this._updateStemPosition();
  }

  _initParticles() {
    this.juice = new JuiceSystem(3000);
    this.juice.groundY = this.softBodyGround + 0.01;
    this.seeds = new SeedSystem(100);
    this.seeds.groundY = this.softBodyGround + 0.01;

    const juiceGeo = new THREE.BufferGeometry();
    this.juicePosAttr = new THREE.BufferAttribute(this.juice.positions, 3);
    juiceGeo.setAttribute("position", this.juicePosAttr);

    this.juiceMat = new THREE.PointsMaterial({
      color: 0xff2200,
      size: 0.045,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.juicePoints = new THREE.Points(juiceGeo, this.juiceMat);
    this.scene.add(this.juicePoints);

    const seedGeo = new THREE.BufferGeometry();
    this.seedPosAttr = new THREE.BufferAttribute(this.seeds.positions, 3);
    seedGeo.setAttribute("position", this.seedPosAttr);
    const seedMat = new THREE.PointsMaterial({
      color: 0xf5eed5,
      size: 0.06,
      sizeAttenuation: true,
    });
    this.seedPoints = new THREE.Points(seedGeo, seedMat);
    this.scene.add(this.seedPoints);
  }

  _initSplatters() {
    this.splatterGroup = new THREE.Group();
    this.splatterGroup.position.y = this.softBodyGround + 0.012;
    this.scene.add(this.splatterGroup);
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0xfff0e8, 0x1a1210, 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff5ee, 1.4);
    key.position.set(4, 7, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 18;
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff6644, 0.35);
    rim.position.set(-3, 2, -4);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0xffaa88, 0.4, 8);
    fill.position.set(-1.5, 1.2, 2);
    this.scene.add(fill);
  }

  _initInput() {
    this._onPointerDown = (e) => {
      this.isDragging = true;
      this._updatePointer(e);
      this._pickSurface();
    };
    this._onPointerMove = (e) => {
      this._updatePointer(e);
      if (this.isDragging) this._pickSurface();
    };
    this._onPointerUp = () => {
      this.isDragging = false;
    };
    this._onWheel = (e) => {
      this.squeezeForce = clamp(this.squeezeForce + e.deltaY * -0.001, 0.3, 3);
      const slider = document.getElementById("force-slider");
      if (slider) slider.value = this.squeezeForce.toFixed(2);
    };
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    this.canvas.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    this.canvas.addEventListener("wheel", this._onWheel, { passive: true });
    window.addEventListener("resize", this._onResize);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.reset();
      if (e.code === "Space") {
        e.preventDefault();
        this.softBody.drop(2.5);
      }
    });

    const slider = document.getElementById("force-slider");
    slider?.addEventListener("input", (e) => {
      this.squeezeForce = parseFloat(e.target.value);
    });

    document.getElementById("reset-btn")?.addEventListener("click", () => this.reset());
  }

  _updatePointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pickSurface() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.skinMesh);
    if (hits.length === 0) return;

    const hit = hits[0];
    const normal = hit.face.normal.clone().transformDirection(this.skinMesh.matrixWorld);
    const squeezeDir = normal.clone().negate();

    const force = this.squeezeForce * (this.isDragging ? 18 : 0);
    const result = this.softBody.applyImpulseAt(
      new Vec3(hit.point.x, hit.point.y, hit.point.z),
      new Vec3(squeezeDir.x, squeezeDir.y, squeezeDir.z),
      force
    );

    if (result.point && this.softBody.maxStrain > 0.35) {
      const intensity = clamp(this.softBody.maxStrain, 0.3, 1.2);
      this.juice.emit(
        new Vec3(result.point.x, result.point.y, result.point.z),
        new Vec3(normal.x, normal.y, normal.z),
        Math.floor(2 + intensity * 6),
        intensity
      );
    }
  }

  reset() {
    this.softBody.reset();
    this.juice.reset();
    this.seeds.reset();
    this.splatterGroup.clear();
    this.skinGeo.computeVertexNormals();
    this.pulpGeo.attributes.position.array.set(this.skinGeo.attributes.position.array);
    this.pulpGeo.computeVertexNormals();
    this._updateStemPosition();
    this.skinMat.opacity = 0.97;
    this.skinMat.emissiveIntensity = 0.08;
  }

  _updateStemPosition() {
    let topY = -Infinity;
    const pos = this.skinGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      topY = Math.max(topY, pos[i + 1]);
    }
    this.stemGroup.position.set(this.softBody.center.x, topY - 0.02, this.softBody.center.z);
  }

  _syncPulpMesh() {
    const skin = this.skinGeo.attributes.position.array;
    const pulp = this.pulpGeo.attributes.position.array;
    const cx = this.softBody.center.x;
    const cy = this.softBody.center.y;
    const cz = this.softBody.center.z;

    for (let i = 0; i < skin.length; i += 3) {
      const dx = skin[i] - cx;
      const dy = skin[i + 1] - cy;
      const dz = skin[i + 2] - cz;
      const shrink = 0.93 - this.softBody.totalRupture * 0.08;
      pulp[i] = cx + dx * shrink;
      pulp[i + 1] = cy + dy * (shrink - 0.02);
      pulp[i + 2] = cz + dz * shrink;
    }
    this.pulpGeo.attributes.position.needsUpdate = true;
    this.pulpGeo.computeVertexNormals();
  }

  _updateVisualStrain() {
    const strain = this.softBody.maxStrain;
    this.skinMat.emissiveIntensity = 0.08 + strain * 0.25;
    this.skinMat.opacity = clamp(0.97 - this.softBody.totalRupture * 0.35, 0.55, 0.97);
    this.pulpMat.emissiveIntensity = 0.15 + strain * 0.4;
  }

  _updateSplatters() {
    while (this.splatterGroup.children.length < this.juice.splatters.length) {
      const tex = this._makeSplatterTexture();
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      this.splatterGroup.add(mesh);
    }

    this.juice.splatters.forEach((s, i) => {
      const mesh = this.splatterGroup.children[i];
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.z = s.rotation;
      mesh.scale.set(s.radius, s.radius, 1);
      mesh.material.opacity = s.opacity;
      mesh.visible = true;
    });

    for (let i = this.juice.splatters.length; i < this.splatterGroup.children.length; i++) {
      this.splatterGroup.children[i].visible = false;
    }
  }

  _makeSplatterTexture() {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, "rgba(210, 30, 10, 0.9)");
    grd.addColorStop(0.45, "rgba(160, 20, 5, 0.55)");
    grd.addColorStop(1, "rgba(80, 5, 0, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 16;
      ctx.beginPath();
      ctx.arc(
        size / 2 + Math.cos(angle) * dist,
        size / 2 + Math.sin(angle) * dist,
        3 + Math.random() * 5,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = `rgba(180, 20, 5, ${0.2 + Math.random() * 0.3})`;
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _updateHUD(dt) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      document.getElementById("stat-fps").textContent = `FPS: ${fps}`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    document.getElementById("stat-strain").textContent =
      `Strain: ${this.softBody.getStrainPercent().toFixed(0)}%`;
    document.getElementById("stat-juice").textContent =
      `Juice: ${this.juice.getVolumeMl()} ml`;
  }

  _subtleCameraSway(t) {
    this.camera.position.x = 2.8 + Math.sin(t * 0.25) * 0.06;
    this.camera.position.y = 2.0 + Math.cos(t * 0.18) * 0.04;
    this.camera.lookAt(this.softBody.center.x, this.softBody.center.y + 0.05, this.softBody.center.z);
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.033);

    const ruptures = this.softBody.step(dt);
    for (const r of ruptures) {
      const now = performance.now();
      if (now - this.lastRuptureTime > 40) {
        this.lastRuptureTime = now;
        this.juice.emit(r.point, new Vec3(0, 1, 0), 12 + Math.floor(r.intensity * 20), r.intensity);
        this.seeds.burst(r.point, 6 + Math.floor(r.intensity * 8));
      }
    }

    this.juice.step(dt);
    this.seeds.step(dt);

    this.skinGeo.computeVertexNormals();
    this._syncPulpMesh();
    this._updateStemPosition();
    this._updateVisualStrain();
    this._updateSplatters();

    this.juicePosAttr.needsUpdate = true;
    this.seedPosAttr.needsUpdate = true;
    this.juicePoints.geometry.setDrawRange(0, this.juice.count);
    this.seedPoints.geometry.setDrawRange(0, this.seeds.active);

    this._subtleCameraSway(this.clock.elapsedTime);
    this._updateHUD(dt);

    this.renderer.render(this.scene, this.camera);
  }

  start() {
    const loading = document.getElementById("loading");
    loading?.classList.add("hidden");
    const loop = () => {
      this.update();
      requestAnimationFrame(loop);
    };
    loop();
  }
}
