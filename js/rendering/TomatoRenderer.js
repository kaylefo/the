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

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vDamage;
  varying float vThickness;

  // Jensen dipole diffusion approximation (BSSRDF)
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

    // Dual-lobe specular (dry skin + wet film)
    float alphaDry = 0.18;
    float alphaWet = 0.04;
    float Ddry = exp((NdotH * NdotH - 1.0) / (alphaDry * alphaDry));
    float Dwet = exp((NdotH * NdotH - 1.0) / (alphaWet * alphaWet));
    float spec = mix(Ddry * 0.35, Dwet * 0.85, uWetness + vDamage * 0.5);

    vec3 sss = subsurface(n, l, v, vThickness);
    vec3 base = mix(vec3(0.72, 0.1, 0.06), vec3(0.95, 0.35, 0.2), vDamage);
    vec3 diffuse = base * NdotL * uLightColor * 0.35 + sss;

    vec3 fresnel = vec3(0.04 + 0.96 * pow(1.0 - NdotV, 5.0));
    vec3 color = diffuse + fresnel * spec * uLightColor;

    // Internal glow at rupture
    color += vec3(1.0, 0.3, 0.1) * vDamage * vDamage * 0.4;

    gl_FragColor = vec4(color, 1.0 - vDamage * 0.15);
  }
`;

export class TomatoRenderer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.damageAttr = null;
    this.thicknessAttr = null;
    this.wetness = 0;

    this._initMaterial();
    this._initFluidPoints();
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

  _initFluidPoints() {
    const maxPts = 8000;
    const geo = new THREE.BufferGeometry();
    this.fluidPositions = new Float32Array(maxPts * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.fluidPositions, 3));
    this.fluidPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xff1800,
        size: 0.003,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.fluidCount = 0;
    this.scene.add(this.fluidPoints);
  }

  updateMesh(mcResult, damageField, nx, ny, nz) {
    const geo = this.mesh.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(mcResult.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(mcResult.normals, 3));

    const vertCount = mcResult.positions.length / 3;
    const damage = new Float32Array(vertCount);
    const thickness = new Float32Array(vertCount);

    for (let v = 0; v < vertCount; v++) {
      const x = mcResult.positions[v * 3];
      const y = mcResult.positions[v * 3 + 1];
      const z = mcResult.positions[v * 3 + 2];
      const d = this._sampleField(damageField, x, y, z, nx, ny, nz);
      damage[v] = d;
      thickness[v] = 0.02 + (1 - d) * 0.04;
    }

    geo.setAttribute("aDamage", new THREE.BufferAttribute(damage, 1));
    geo.setAttribute("aThickness", new THREE.BufferAttribute(thickness, 1));
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
    this.fluidCount = Math.min(markers.length, this.fluidPositions.length / 3);
    for (let i = 0; i < this.fluidCount; i++) {
      this.fluidPositions[i * 3] = markers[i].x;
      this.fluidPositions[i * 3 + 1] = markers[i].y;
      this.fluidPositions[i * 3 + 2] = markers[i].z;
    }
    this.fluidPoints.geometry.attributes.position.needsUpdate = true;
    this.fluidPoints.geometry.setDrawRange(0, this.fluidCount);
    this.wetness = Math.min(1, this.fluidCount / 2000);
    this.material.uniforms.uWetness.value = this.wetness;
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }
}
