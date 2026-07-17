import * as THREE from "three";
import { TANK } from "../physics/WaterTank.js";

const glassVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vFaceUV;
  attribute vec2 aFaceAtlas;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    vFaceUV = aFaceAtlas;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glassFragmentShader = /* glsl */ `
  uniform sampler2D uCondensation;
  uniform sampler2D uEnvMap;
  uniform float uEnvStrength;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vFaceUV;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec3 sampleEquirect(vec3 dir) {
    vec3 d = normalize(dir);
    float phi = atan(d.z, d.x);
    float theta = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(phi * 0.15915494309 + 0.5, theta * 0.31830988618 + 0.5);
    return texture2D(uEnvMap, uv).rgb;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float NdotV = max(dot(n, v), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);

    vec4 cond = texture2D(uCondensation, vFaceUV);
    float moisture = cond.r;
    float streak = cond.g;
    float droplets = cond.b;

    // Perturb normals with droplets
    vec2 dropUV = vFaceUV * 24.0 + uTime * 0.02;
    float bump = (hash(floor(dropUV)) * droplets * 0.015);
    n = normalize(n + vec3(bump, bump * 0.5, bump));

    vec3 rd = reflect(-v, n);
    vec3 env = uEnvStrength > 0.01
      ? sampleEquirect(rd) * uEnvStrength
      : vec3(0.15, 0.18, 0.22);

    vec3 base = mix(vec3(0.85, 0.92, 0.98) * 0.15, env, fresnel * 0.85);
    base += vec3(0.9, 0.95, 1.0) * moisture * 0.12;
    base += vec3(0.75, 0.82, 0.9) * streak * 0.08;

    float alpha = uOpacity + moisture * 0.15 + streak * 0.05;
    gl_FragColor = vec4(base, clamp(alpha, 0.0, 0.55));
  }
`;

/**
 * Glass tank with condensation-mapped walls and bottom.
 */
export class GlassTankRenderer {
  constructor(scene, tank, scale, condensationTexture) {
    this.scene = scene;
    this.tank = tank;
    this.scale = scale;
    this.group = new THREE.Group();

    this.material = new THREE.ShaderMaterial({
      vertexShader: glassVertexShader,
      fragmentShader: glassFragmentShader,
      uniforms: {
        uCondensation: { value: condensationTexture },
        uEnvMap: { value: null },
        uEnvStrength: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: 0.14 },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this._build(tank, scale);
    scene.add(this.group);
  }

  _addPanel(w, h, d, px, py, pz, atlasRect) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const [u0, v0, u1, v1] = atlasRect;
    const atlasAttr = new Float32Array(geo.attributes.position.count * 2);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      atlasAttr[i * 2] = (u0 + u1) * 0.5;
      atlasAttr[i * 2 + 1] = (v0 + v1) * 0.5;
    }
    geo.setAttribute("aFaceAtlas", new THREE.BufferAttribute(atlasAttr, 2));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(px, py, pz);
    this.group.add(mesh);
  }

  _build(t, s) {
    const cx = (t.origin[0] + t.width * 0.5) * s;
    const cy = (t.origin[1] + t.height * 0.5) * s;
    const cz = (t.origin[2] + t.depth * 0.5) * s;
    const wt = t.wallThickness * s;

    // Atlas UV rects (normalized 0-1) for 2×2 face layout
    const faces = {
      nx: [0, 0, 0.5, 0.5],
      px: [0.5, 0, 1, 0.5],
      nz: [0, 0.5, 0.5, 1],
      pz: [0.5, 0.5, 1, 1],
    };

    this._addPanel(t.width * s, wt, t.depth * s, cx, t.origin[1] * s + wt * 0.5, cz, [0.25, 0.25, 0.75, 0.75]);

    const walls = [
      { w: wt, h: t.height * s, d: t.depth * s, x: t.origin[0] * s + wt * 0.5, z: cz, atlas: faces.nx },
      { w: wt, h: t.height * s, d: t.depth * s, x: (t.origin[0] + t.width) * s - wt * 0.5, z: cz, atlas: faces.px },
      { w: t.width * s, h: t.height * s, d: wt, x: cx, z: t.origin[2] * s + wt * 0.5, atlas: faces.nz },
      { w: t.width * s, h: t.height * s, d: wt, x: cx, z: (t.origin[2] + t.depth) * s - wt * 0.5, atlas: faces.pz },
    ];
    for (const w of walls) {
      this._addPanel(w.w, w.h, w.d, w.x, cy, w.z, w.atlas);
    }
  }

  setEnvMap(envMap, strength = 0.85) {
    this.material.uniforms.uEnvMap.value = envMap;
    this.material.uniforms.uEnvStrength.value = envMap ? strength : 0;
  }

  setCondensationTexture(tex) {
    this.material.uniforms.uCondensation.value = tex;
  }

  setTime(t) {
    this.material.uniforms.uTime.value = t;
  }
}
