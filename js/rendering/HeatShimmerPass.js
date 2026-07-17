import * as THREE from "three";

/**
 * Screen-space heat shimmer — refractive wobble near active vaporization points.
 */
export const HeatShimmerShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHeat0: { value: new THREE.Vector3(0, 0, 0) },
    uHeat1: { value: new THREE.Vector3(0, 0, 0) },
    uHeat2: { value: new THREE.Vector3(0, 0, 0) },
    uHeat3: { value: new THREE.Vector3(0, 0, 0) },
    uStrength: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uHeat0;
    uniform vec3 uHeat1;
    uniform vec3 uHeat2;
    uniform vec3 uHeat3;
    uniform float uStrength;
    varying vec2 vUv;

    vec2 shimmer(vec2 uv, vec3 hp) {
      if (hp.z < 0.001) return vec2(0.0);
      vec2 d = uv - hp.xy;
      float dist = length(d);
      float w = exp(-dist * dist * 120.0) * hp.z;
      float n1 = sin(uv.y * 90.0 + uTime * 7.0 + hp.x * 20.0);
      float n2 = cos(uv.x * 85.0 + uTime * 6.0 + hp.y * 20.0);
      return vec2(n1, n2) * w * 0.006 * uStrength;
    }

    void main() {
      vec2 uv = vUv;
      vec2 off = shimmer(uv, uHeat0) + shimmer(uv, uHeat1) + shimmer(uv, uHeat2) + shimmer(uv, uHeat3);
      gl_FragColor = texture2D(tDiffuse, uv + off);
    }
  `,
};

export const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float grain = (rand(vUv * (uTime + 1.0)) - 0.5) * uAmount;
      col.rgb += grain;
      gl_FragColor = col;
    }
  `,
};
