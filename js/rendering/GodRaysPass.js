import * as THREE from "three";

/** Radial god-ray scatter toward screen-space key light. */
export const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLightPos: { value: new THREE.Vector2(0.72, 0.82) },
    uStrength: { value: 0.4 },
    uDecay: { value: 0.965 },
    uExposure: { value: 0.22 },
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
    uniform vec2 uLightPos;
    uniform float uStrength;
    uniform float uDecay;
    uniform float uExposure;
    varying vec2 vUv;

    void main() {
      vec2 delta = uLightPos - vUv;
      vec2 step = delta * uExposure;
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      vec3 accum = vec3(0.0);
      float illumination = 1.0;
      vec2 uv = vUv;
      for (int i = 0; i < 32; i++) {
        uv += step;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        accum += s * lum * illumination * uStrength;
        illumination *= uDecay;
      }
      gl_FragColor = vec4(color + accum, 1.0);
    }
  `,
};
