import * as THREE from "three";

/**
 * Table material with animated water caustics projected from uCausticMap.
 */
export function createTableCausticsMaterial(causticTexture, tank, scale) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3d2e24,
    roughness: 0.55,
    metalness: 0.08,
  });

  const tankMin = new THREE.Vector2(tank.origin[0] * scale, tank.origin[2] * scale);
  const tankSize = new THREE.Vector2(tank.width * scale, tank.depth * scale);
  const uniforms = {
    uCausticMap: { value: causticTexture },
    uTime: { value: 0 },
    uTankMin: { value: tankMin },
    uTankSize: { value: tankSize },
    uCausticStrength: { value: 0.55 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticMap = uniforms.uCausticMap;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTankMin = uniforms.uTankMin;
    shader.uniforms.uTankSize = uniforms.uTankSize;
    shader.uniforms.uCausticStrength = uniforms.uCausticStrength;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform sampler2D uCausticMap;
      uniform float uTime;
      uniform vec2 uTankMin;
      uniform vec2 uTankSize;
      uniform float uCausticStrength;

      float tableCaustic(vec3 worldPos) {
        vec2 tankUV = (worldPos.xz - uTankMin) / uTankSize;
        if (any(lessThan(tankUV, vec2(0.0))) || any(greaterThan(tankUV, vec2(1.0)))) return 0.0;
        vec2 anim = tankUV + vec2(sin(uTime * 0.7), cos(uTime * 0.5)) * 0.008;
        float c0 = texture2D(uCausticMap, anim).r;
        float c1 = texture2D(uCausticMap, anim + vec2(0.012, -0.008)).r;
        return (c0 * 0.65 + c1 * 0.35) * uCausticStrength;
      }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <output_fragment>",
      `#include <output_fragment>
      {
        float c = tableCaustic(worldPosition);
        vec3 causticColor = vec3(0.35, 0.55, 0.75) * c * 1.8;
        gl_FragColor.rgb += causticColor;
      }`
    );
  };

  mat.userData.causticUniforms = uniforms;
  return mat;
}

export function createFloorCausticsMaterial(causticTexture, tank, scale) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1816,
    roughness: 0.88,
    metalness: 0.02,
  });

  const tankMin = new THREE.Vector2(tank.origin[0] * scale - 0.08, tank.origin[2] * scale - 0.08);
  const tankSize = new THREE.Vector2(tank.width * scale + 0.16, tank.depth * scale + 0.16);
  const uniforms = {
    uCausticMap: { value: causticTexture },
    uTime: { value: 0 },
    uTankMin: { value: tankMin },
    uTankSize: { value: tankSize },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticMap = uniforms.uCausticMap;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTankMin = uniforms.uTankMin;
    shader.uniforms.uTankSize = uniforms.uTankSize;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform sampler2D uCausticMap;
      uniform float uTime;
      uniform vec2 uTankMin;
      uniform vec2 uTankSize;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <output_fragment>",
      `#include <output_fragment>
      {
        vec2 tankUV = (worldPosition.xz - uTankMin) / uTankSize;
        if (all(greaterThan(tankUV, vec2(0.0))) && all(lessThan(tankUV, vec2(1.0)))) {
          float c = texture2D(uCausticMap, tankUV + uTime * 0.02).r;
          gl_FragColor.rgb += vec3(0.12, 0.18, 0.28) * c * 0.35;
        }
      }`
    );
  };

  mat.userData.causticUniforms = uniforms;
  return mat;
}
