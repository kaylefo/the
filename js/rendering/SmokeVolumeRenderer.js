import * as THREE from "three";

const smokeVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const smokeFragmentShader = /* glsl */ `
  uniform sampler3D uVolume;
  uniform vec3 uVolumeOrigin;
  uniform vec3 uVolumeSize;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uCameraPos;
  uniform float uStepSize;
  uniform int uMaxSteps;
  uniform float uQuality;

  varying vec3 vWorldPos;

  float hg(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
  }

  vec4 sampleVol(vec3 worldPos) {
    vec3 uvw = (worldPos - uVolumeOrigin) / uVolumeSize;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return vec4(0.0);
    return texture(uVolume, uvw);
  }

  void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vWorldPos - ro);

    // Ray-box intersection with volume bounds
    vec3 bMin = uVolumeOrigin;
    vec3 bMax = uVolumeOrigin + uVolumeSize;
    vec3 invRd = 1.0 / rd;
    vec3 t0 = (bMin - ro) * invRd;
    vec3 t1 = (bMax - ro) * invRd;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);
    if (tNear > tFar || tFar < 0.0) discard;

    tNear = max(tNear, 0.0);
    float stepLen = uStepSize;
    int steps = uMaxSteps;

    vec3 pos = ro + rd * tNear;
    vec3 accum = vec3(0.0);
    float transmittance = 1.0;
    float g = 0.35;

    for (int i = 0; i < 128; i++) {
      if (i >= steps) break;
      if (transmittance < 0.02) break;

      vec4 sample = sampleVol(pos);
      float density = sample.r;
      if (density > 0.001) {
        float temp = sample.g;
        vec3 smokeColor = mix(vec3(0.75, 0.78, 0.82), vec3(0.95, 0.92, 0.85), clamp(temp * 2.0, 0.0, 1.0));

        // Light march (single sample toward light for self-shadow hint)
        vec3 lPos = pos + normalize(uLightDir) * stepLen * 3.0;
        float shadow = 1.0 - sampleVol(lPos).r * 0.7 * uQuality;

        float cosTheta = dot(rd, normalize(uLightDir));
        float phase = hg(cosTheta, g);
        float alpha = 1.0 - exp(-density * stepLen * 18.0);
        vec3 scattered = smokeColor * uLightColor * phase * shadow * 1.75;
        accum += transmittance * alpha * scattered;
        transmittance *= (1.0 - alpha);
      }
      pos += rd * stepLen;
      if (dot(pos - ro, rd) > tFar) break;
    }

    if (transmittance > 0.98) discard;
    gl_FragColor = vec4(accum, 1.0 - transmittance);
  }
`;

export class SmokeVolumeRenderer {
  constructor(scene, quality = {}) {
    this.scene = scene;
    this.quality = quality;
    this.textureData = null;
    this._initVolume(quality);
  }

  _initVolume(quality) {
    const res = quality.smokeRes ?? 48;
    this.res = { nx: res, ny: Math.round(res * 0.75), nz: res };
    this.volumeOrigin = new THREE.Vector3(-0.14, -0.02, -0.14);
    this.volumeSize = new THREE.Vector3(0.28, 0.22, 0.28);

    this.texture = new THREE.Data3DTexture(
      new Uint8Array(this.res.nx * this.res.ny * this.res.nz * 4),
      this.res.nx,
      this.res.ny,
      this.res.nz
    );
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.wrapR = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: smokeVertexShader,
      fragmentShader: smokeFragmentShader,
      uniforms: {
        uVolume: { value: this.texture },
        uVolumeOrigin: { value: this.volumeOrigin.clone() },
        uVolumeSize: { value: this.volumeSize.clone() },
        uLightDir: { value: new THREE.Vector3(0.4, 1, 0.25).normalize() },
        uLightColor: { value: new THREE.Vector3(1, 0.95, 0.88) },
        uCameraPos: { value: new THREE.Vector3() },
        uStepSize: { value: 0.008 },
        uMaxSteps: { value: quality.smokeSteps ?? 48 },
        uQuality: { value: 1 },
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });

    const geo = new THREE.BoxGeometry(
      this.volumeSize.x,
      this.volumeSize.y,
      this.volumeSize.z
    );
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.copy(this.volumeOrigin).add(this.volumeSize.clone().multiplyScalar(0.5));
    this.mesh.renderOrder = 4;
    this.scene.add(this.mesh);
  }

  setVolumeBounds(origin, size) {
    this.volumeOrigin.set(origin[0], origin[1], origin[2]);
    this.volumeSize.set(size[0], size[1], size[2]);
    this.material.uniforms.uVolumeOrigin.value.copy(this.volumeOrigin);
    this.material.uniforms.uVolumeSize.value.copy(this.volumeSize);
    this.mesh.position.copy(this.volumeOrigin).add(this.volumeSize.clone().multiplyScalar(0.5));
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  }

  applyQuality(quality) {
    this.material.uniforms.uMaxSteps.value = quality.smokeSteps ?? 48;
    this.material.uniforms.uQuality.value = quality.smokeRes >= 64 ? 1 : 0.6;
    this.material.uniforms.uStepSize.value = quality.smokeRes >= 64 ? 0.006 : 0.009;
  }

  setLightDir(dir) {
    this.material.uniforms.uLightDir.value.copy(dir);
  }

  updateFromSmoke(smoke) {
    if (!this.textureData || this.textureData.length !== smoke.count * 4) {
      this.textureData = new Uint8Array(smoke.count * 4);
    }
    for (let i = 0; i < smoke.count; i++) {
      this.textureData[i * 4] = Math.min(255, smoke.density[i] * 200);
      this.textureData[i * 4 + 1] = Math.min(255, ((smoke.temperature[i] - smoke.ambientTemp) / 200) * 255);
      this.textureData[i * 4 + 2] = 0;
      this.textureData[i * 4 + 3] = 255;
    }

    if (this.res.nx !== smoke.nx || this.res.ny !== smoke.ny || this.res.nz !== smoke.nz) {
      this.res = { nx: smoke.nx, ny: smoke.ny, nz: smoke.nz };
      this.texture.dispose();
      this.texture = new THREE.Data3DTexture(
        this.textureData,
        smoke.nx,
        smoke.ny,
        smoke.nz
      );
      this.texture.format = THREE.RGBAFormat;
      this.texture.type = THREE.UnsignedByteType;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.wrapS = THREE.ClampToEdgeWrapping;
      this.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.texture.wrapR = THREE.ClampToEdgeWrapping;
      this.material.uniforms.uVolume.value = this.texture;
    } else {
      this.texture.image.data.set(this.textureData);
    }
    this.texture.needsUpdate = true;
  }

  setCameraPos(pos) {
    this.material.uniforms.uCameraPos.value.copy(pos);
  }
}
