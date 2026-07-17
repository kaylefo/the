import * as THREE from "three";

const tomatoVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vDamage;
  varying float vThickness;

  attribute float aDamage;
  attribute float aThickness;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vDamage = aDamage;
    vThickness = aThickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const tomatoFragmentShader = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uTime;
  uniform float uWetness;
  uniform float uQuality;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vDamage;
  varying float vThickness;

  vec3 subsurface(vec3 n, vec3 l, vec3 rd, float thickness) {
    float wrap = max(0.0, (dot(n, l) + 0.45) / 1.45);
    float back = max(0.0, dot(-n, l)) * exp(-thickness * 8.0);
    vec3 scatterColor = mix(vec3(0.95, 0.25, 0.12), vec3(1.0, 0.55, 0.35), vDamage);
    return scatterColor * (wrap * 0.6 + back * 0.4) * 1.4;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uLightDir);
    vec3 v = normalize(vViewDir);
    vec3 h = normalize(l + v);

    float NdotL = max(dot(n, l), 0.0);
    float NdotH = max(dot(n, h), 0.0);
    float NdotV = max(dot(n, v), 0.0);

    float alphaDry = mix(0.22, 0.18, uQuality);
    float alphaWet = 0.04;
    float Ddry = exp((NdotH * NdotH - 1.0) / (alphaDry * alphaDry));
    float Dwet = exp((NdotH * NdotH - 1.0) / (alphaWet * alphaWet));
    float spec = mix(Ddry * 0.35, Dwet * 0.85, uWetness + vDamage * 0.5);

    vec3 sss = subsurface(n, l, v, vThickness);
    vec3 base = mix(vec3(0.72, 0.1, 0.06), vec3(0.95, 0.35, 0.2), vDamage);
    vec3 diffuse = base * NdotL * uLightColor * 0.35 + sss;

    vec3 fresnel = vec3(0.04 + 0.96 * pow(1.0 - NdotV, 5.0));
    vec3 color = diffuse + fresnel * spec * uLightColor;
    color += vec3(1.0, 0.3, 0.1) * vDamage * vDamage * 0.4;

    gl_FragColor = vec4(color, 1.0 - vDamage * 0.15);
  }
`;

export class TomatoRenderer {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.quality = quality;
    this.mesh = null;
    this.wetness = 0;
    this._maxVerts = 0;
    this._posBuffer = null;
    this._nrmBuffer = null;
    this._dmgBuffer = null;
    this._thkBuffer = null;

    this._initMaterial();
    this._initFluidPoints(quality.flipMaxMarkers ?? 8000, quality.fluidPointSize ?? 0.003);
  }

  applyQuality(quality) {
    this.quality = quality;
    this.material.uniforms.uQuality.value = quality.gridSize >= 32 ? 1 : quality.gridSize >= 24 ? 0.6 : 0.3;
    if (this.fluidPoints) {
      this.fluidPoints.material.size = quality.fluidPointSize ?? 0.003;
    }
  }

  _initMaterial() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: tomatoVertexShader,
      fragmentShader: tomatoFragmentShader,
      uniforms: {
        uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
        uLightColor: { value: new THREE.Vector3(1, 0.95, 0.9) },
        uTime: { value: 0 },
        uWetness: { value: 0 },
        uQuality: { value: 1 },
      },
      transparent: true,
      side: THREE.DoubleSide,
    });

    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
  }

  _initFluidPoints(maxPts, pointSize) {
    const geo = new THREE.BufferGeometry();
    this.fluidPositions = new Float32Array(maxPts * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.fluidPositions, 3));
    this.fluidPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xff1800,
        size: pointSize,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.fluidMax = maxPts;
    this.scene.add(this.fluidPoints);
  }

  _ensureBuffers(vertCount) {
    if (vertCount <= this._maxVerts) return;
    this._maxVerts = Math.max(vertCount, Math.ceil(vertCount * 1.25));
    this._posBuffer = new Float32Array(this._maxVerts * 3);
    this._nrmBuffer = new Float32Array(this._maxVerts * 3);
    this._dmgBuffer = new Float32Array(this._maxVerts);
    this._thkBuffer = new Float32Array(this._maxVerts);
  }

  updateMesh(mcResult, damageField, nx, ny, nz) {
    const vertCount = mcResult.positions.length / 3;
    if (vertCount === 0) return;

    this._ensureBuffers(vertCount);
    this._posBuffer.set(mcResult.positions.subarray(0, vertCount * 3));
    this._nrmBuffer.set(mcResult.normals.subarray(0, vertCount * 3));

    for (let v = 0; v < vertCount; v++) {
      const x = mcResult.positions[v * 3];
      const y = mcResult.positions[v * 3 + 1];
      const z = mcResult.positions[v * 3 + 2];
      const d = this._sampleField(damageField, x, y, z, nx, ny, nz);
      this._dmgBuffer[v] = d;
      this._thkBuffer[v] = 0.02 + (1 - d) * 0.04;
    }

    const geo = this.mesh.geometry;
    if (!geo.getAttribute("position") || geo.getAttribute("position").count < vertCount) {
      geo.setAttribute("position", new THREE.BufferAttribute(this._posBuffer.slice(0, vertCount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(this._nrmBuffer.slice(0, vertCount * 3), 3));
      geo.setAttribute("aDamage", new THREE.BufferAttribute(this._dmgBuffer.slice(0, vertCount), 1));
      geo.setAttribute("aThickness", new THREE.BufferAttribute(this._thkBuffer.slice(0, vertCount), 1));
    } else {
      geo.getAttribute("position").array.set(this._posBuffer.subarray(0, vertCount * 3));
      geo.getAttribute("normal").array.set(this._nrmBuffer.subarray(0, vertCount * 3));
      geo.getAttribute("aDamage").array.set(this._dmgBuffer.subarray(0, vertCount));
      geo.getAttribute("aThickness").array.set(this._thkBuffer.subarray(0, vertCount));
      geo.getAttribute("position").needsUpdate = true;
      geo.getAttribute("normal").needsUpdate = true;
      geo.getAttribute("aDamage").needsUpdate = true;
      geo.getAttribute("aThickness").needsUpdate = true;
    }
    geo.setDrawRange(0, vertCount);
    geo.computeBoundingSphere();
  }

  _sampleField(field, x, y, z, nx, ny, nz) {
    const ox = field.origin[0], oy = field.origin[1], oz = field.origin[2];
    const dx = field.dx;
    const fx = (x - ox) / dx;
    const fy = (y - oy) / dx;
    const fz = (z - oz) / dx;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
    return field.data[i + j * nx + k * nx * ny] ?? 0;
  }

  updateFluid(markers) {
    const count = Math.min(markers.length, this.fluidMax);
    for (let i = 0; i < count; i++) {
      this.fluidPositions[i * 3] = markers[i].x;
      this.fluidPositions[i * 3 + 1] = markers[i].y;
      this.fluidPositions[i * 3 + 2] = markers[i].z;
    }
    this.fluidPoints.geometry.attributes.position.needsUpdate = true;
    this.fluidPoints.geometry.setDrawRange(0, count);
    this.wetness = Math.min(1, count / 2000);
    this.material.uniforms.uWetness.value = this.wetness;
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }
}
