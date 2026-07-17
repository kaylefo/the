import * as THREE from "three";

const waterVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vReflectDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vReflectDir = reflect(-vViewDir, vNormal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const waterFragmentShader = /* glsl */ `
  uniform sampler2D uSceneColor;
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uWaterColor;
  uniform float uTime;
  uniform float uQuality;
  uniform float uSSRStrength;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform mat4 uProjectionMatrixInverse;
  uniform mat4 uViewMatrixInverse;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vReflectDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec3 traceSSR(vec3 wp, vec3 n, vec3 v, vec2 baseUV) {
    if (uSSRStrength < 0.01) return vec3(-1.0);
    vec3 rd = reflect(-v, n);
    vec3 p = wp;
    float stride = 0.012;
    float maxDist = 0.35;

    for (int i = 0; i < 32; i++) {
      p += rd * stride;
      if (length(p - wp) > maxDist) break;
      vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
      vec3 proj = clip.xyz / clip.w;
      vec2 uv = proj.xy * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sceneZ = texture2D(uSceneDepth, uv).r;
      if (proj.z > sceneZ + 0.0008) {
        return texture2D(uSceneColor, uv).rgb;
      }
    }
    return vec3(-1.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    vec3 l = normalize(uLightDir);

    // Micro ripples
    vec2 uv = vWorldPos.xz * 12.0 + uTime * 0.15;
    float rip = noise(uv) * 0.5 + noise(uv * 2.3 + 1.7) * 0.25;
    n = normalize(n + vec3(rip * 0.08, 0.0, rip * 0.06));

    float NdotV = max(dot(n, v), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

    // Screen-space refraction
    vec4 clipPos = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
    vec2 screenUV = (clipPos.xy / clipPos.w) * 0.5 + 0.5;
    vec2 refrOffset = n.xz * 0.025 * (1.0 - NdotV);
    vec3 refrColor = texture2D(uSceneColor, screenUV + refrOffset).rgb;

    // Water absorption (Beer-Lambert)
    vec3 absorb = exp(-vec3(0.8, 0.15, 0.05) * 0.35);
    vec3 baseColor = mix(uWaterColor * 0.4, refrColor * absorb, 0.65);

    // Specular (GGX-ish)
    vec3 h = normalize(l + v);
    float NdotH = max(dot(n, h), 0.0);
    float alpha = mix(0.04, 0.02, uQuality);
    float spec = pow(NdotH, 1.0 / alpha) * 0.35;

    // Fake caustic shimmer on floor-facing normals
    float caustic = noise(vWorldPos.xz * 24.0 + uTime * 0.4) * max(0.0, -n.y) * 0.25;

    vec3 skyReflect = mix(vec3(0.15, 0.2, 0.28), vec3(0.85, 0.9, 0.95), pow(max(dot(vReflectDir, vec3(0, 1, 0)), 0.0), 4.0));
    vec3 ssr = traceSSR(vWorldPos, n, v, screenUV);
    vec3 reflectColor = ssr.x >= 0.0 ? ssr : skyReflect;
    vec3 color = mix(baseColor, reflectColor, fresnel * (0.35 + uSSRStrength * 0.45));
    color += uLightColor * spec;
    color += vec3(0.6, 0.75, 0.9) * caustic;

    float alpha = mix(0.82, 0.95, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class WaterRenderer {
  constructor(scene, renderer, quality = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this._maxVerts = 0;
    this._posBuffer = null;
    this._nrmBuffer = null;
    this.foamParticles = [];
    this.bubbleParticles = [];

    this._initRenderTargets();
    this._initMaterial();
    this._initFoam(quality.foamMax ?? 600);
    this._initBubbles(quality.bubbleMax ?? 300);
  }

  _initRenderTargets() {
    const w = this.renderer.domElement.width || 512;
    const h = this.renderer.domElement.height || 512;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h);
  }

  resize(w, h) {
    const rw = w || this.renderer.domElement.width || 512;
    const rh = h || this.renderer.domElement.height || 512;
    this.sceneRT.setSize(rw, rh);
  }

  _initMaterial() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: {
        uSceneColor: { value: this.sceneRT.texture },
        uSceneDepth: { value: this.sceneRT.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLightDir: { value: new THREE.Vector3(0.4, 1, 0.25).normalize() },
        uLightColor: { value: new THREE.Vector3(1, 0.97, 0.92) },
        uWaterColor: { value: new THREE.Vector3(0.05, 0.35, 0.55) },
        uTime: { value: 0 },
        uQuality: { value: 1 },
        uSSRStrength: { value: 1 },
        uCameraNear: { value: 0.01 },
        uCameraFar: { value: 30 },
        uProjectionMatrixInverse: { value: new THREE.Matrix4() },
        uViewMatrixInverse: { value: new THREE.Matrix4() },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
  }

  _initFoam(maxFoam) {
    const geo = new THREE.BufferGeometry();
    this.foamPositions = new Float32Array(maxFoam * 3);
    this.foamLife = new Float32Array(maxFoam);
    geo.setAttribute("position", new THREE.BufferAttribute(this.foamPositions, 3));
    this.foamPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.008,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.foamPoints.renderOrder = 3;
    this.foamMax = maxFoam;
    this.scene.add(this.foamPoints);
  }

  _initBubbles(maxBubbles) {
    const geo = new THREE.BufferGeometry();
    this.bubblePositions = new Float32Array(maxBubbles * 3);
    this.bubbleSizes = new Float32Array(maxBubbles);
    geo.setAttribute("position", new THREE.BufferAttribute(this.bubblePositions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(this.bubbleSizes, 1));
    this.bubblePoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xd0eeff,
        size: 0.006,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.bubblePoints.renderOrder = 3;
    this.bubbleMax = maxBubbles;
    this.scene.add(this.bubblePoints);
  }

  _initGlassTank() {
    // Placeholder — tank mesh added by simulation
  }

  applyQuality(quality) {
    this.quality = quality;
    this.material.uniforms.uQuality.value = quality.waterGridSize >= 36 ? 1 : quality.waterGridSize >= 28 ? 0.7 : 0.4;
    this.material.uniforms.uSSRStrength.value = quality.waterGridSize >= 32 ? 1 : quality.waterGridSize >= 28 ? 0.5 : 0;
  }

  setCameraParams(near, far) {
    this.material.uniforms.uCameraNear.value = near;
    this.material.uniforms.uCameraFar.value = far;
  }

  setLightDir(dir) {
    this.material.uniforms.uLightDir.value.copy(dir);
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }

  _ensureBuffers(vertCount) {
    if (vertCount <= this._maxVerts) return;
    this._maxVerts = Math.max(vertCount, Math.ceil(vertCount * 1.25));
    this._posBuffer = new Float32Array(this._maxVerts * 3);
    this._nrmBuffer = new Float32Array(this._maxVerts * 3);
  }

  updateMesh(mcResult) {
    const vertCount = mcResult.positions.length / 3;
    if (vertCount === 0) return;

    this._ensureBuffers(vertCount);
    this._posBuffer.set(mcResult.positions.subarray(0, vertCount * 3));
    this._nrmBuffer.set(mcResult.normals.subarray(0, vertCount * 3));

    const geo = this.mesh.geometry;
    if (!geo.getAttribute("position") || geo.getAttribute("position").count < vertCount) {
      geo.setAttribute("position", new THREE.BufferAttribute(this._posBuffer.slice(0, vertCount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(this._nrmBuffer.slice(0, vertCount * 3), 3));
    } else {
      geo.getAttribute("position").array.set(this._posBuffer.subarray(0, vertCount * 3));
      geo.getAttribute("normal").array.set(this._nrmBuffer.subarray(0, vertCount * 3));
      geo.getAttribute("position").needsUpdate = true;
      geo.getAttribute("normal").needsUpdate = true;
    }
    geo.setDrawRange(0, vertCount);
    geo.computeBoundingSphere();
  }

  spawnFoam(events, scale) {
    for (const e of events) {
      if (this.foamParticles.length >= this.foamMax) this.foamParticles.shift();
      this.foamParticles.push({
        x: e.x * scale,
        y: e.y * scale,
        z: e.z * scale,
        vy: 0.3 + Math.random() * 0.4,
        life: 0.4 + Math.random() * 0.8,
      });
    }
  }

  updateFoam(dt, scale) {
    for (let i = this.foamParticles.length - 1; i >= 0; i--) {
      const p = this.foamParticles[i];
      p.y += p.vy * dt * scale * 0.01;
      p.life -= dt;
      if (p.life <= 0) this.foamParticles.splice(i, 1);
    }

    const count = Math.min(this.foamParticles.length, this.foamMax);
    for (let i = 0; i < count; i++) {
      const p = this.foamParticles[i];
      this.foamPositions[i * 3] = p.x;
      this.foamPositions[i * 3 + 1] = p.y;
      this.foamPositions[i * 3 + 2] = p.z;
    }
    this.foamPoints.geometry.attributes.position.needsUpdate = true;
    this.foamPoints.geometry.setDrawRange(0, count);
  }

  updateBubbles(bubbleSystem, scale) {
    const bubbles = bubbleSystem.bubbles;
    const count = Math.min(bubbles.length, this.bubbleMax);
    for (let i = 0; i < count; i++) {
      const b = bubbles[i];
      this.bubblePositions[i * 3] = b.x * scale;
      this.bubblePositions[i * 3 + 1] = b.y * scale;
      this.bubblePositions[i * 3 + 2] = b.z * scale;
      this.bubbleSizes[i] = b.r * scale * 800;
    }
    this.bubblePoints.geometry.attributes.position.needsUpdate = true;
    this.bubblePoints.geometry.setDrawRange(0, count);
    this.bubblePoints.material.size = 0.004 + scale * 0.0003;
  }

  /** Render opaque scene to RT, then water on top. */
  renderWaterPass(mainRenderer, scene, camera, smokeMesh) {
    const w = mainRenderer.domElement.width;
    const h = mainRenderer.domElement.height;
    this.material.uniforms.uResolution.value.set(w, h);
    this.material.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    this.material.uniforms.uViewMatrixInverse.value.copy(camera.matrixWorld);
    this.setCameraParams(camera.near, camera.far);

    this.mesh.visible = false;
    if (smokeMesh) smokeMesh.visible = false;
    this.foamPoints.visible = false;
    this.bubblePoints.visible = false;

    mainRenderer.setRenderTarget(this.sceneRT);
    mainRenderer.clear();
    mainRenderer.render(scene, camera);

    mainRenderer.setRenderTarget(null);
    this.mesh.visible = true;
    if (smokeMesh) smokeMesh.visible = true;
    this.foamPoints.visible = true;
    this.bubblePoints.visible = true;

    this.material.uniforms.uSceneColor.value = this.sceneRT.texture;
    this.material.uniforms.uSceneDepth.value = this.sceneRT.depthTexture;
  }
}
