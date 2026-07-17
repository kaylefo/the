import * as THREE from "three";

const HDR_URL =
  "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr";

/**
 * Load HDR studio IBL or fall back to procedural equirectangular.
 * Returns { envMap, equirect }:
 * - envMap: PMREM for scene.environment / MeshStandardMaterial
 * - equirect: 2D lat-long map for custom ShaderMaterials (sampler2D)
 */
export async function loadStudioEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const e2e =
    typeof window !== "undefined" &&
    (window.__E2E__ || new URLSearchParams(window.location.search).has("e2e"));

  const mobile =
    typeof window !== "undefined" &&
    (window.matchMedia("(max-width: 768px)").matches ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 900));

  if (e2e || mobile) {
    return _proceduralStudio(pmrem, scene);
  }

  try {
    const { RGBELoader } = await import("three/addons/loaders/RGBELoader.js");
    const loader = new RGBELoader();
    const hdr = await Promise.race([
      loader.loadAsync(HDR_URL),
      new Promise((_, reject) => setTimeout(() => reject(new Error("HDR timeout")), 8000)),
    ]);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = 0.85;
    return { envMap, equirect: hdr };
  } catch (err) {
    console.warn("[WaterLab] HDR load failed, using procedural studio:", err?.message);
    return _proceduralStudio(pmrem, scene);
  }
}

function _proceduralStudio(pmrem, scene) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#3a4558");
  grad.addColorStop(0.35, "#a8b8d0");
  grad.addColorStop(0.55, "#e8eef5");
  grad.addColorStop(0.75, "#8898a8");
  grad.addColorStop(1, "#1a1816");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const spot = ctx.createRadialGradient(w * 0.65, h * 0.25, 0, w * 0.65, h * 0.25, w * 0.35);
  spot.addColorStop(0, "rgba(255,248,240,0.9)");
  spot.addColorStop(1, "rgba(255,248,240,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);

  const equirect = new THREE.CanvasTexture(canvas);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;
  const envMap = pmrem.fromEquirectangular(equirect).texture;
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.75;
  return { envMap, equirect };
}

export function applyEnvironmentToScene(scene, envMap, intensity = 0.85) {
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if ("envMap" in m) {
        m.envMap = envMap;
        m.envMapIntensity = intensity;
        m.needsUpdate = true;
      }
    }
  });
}
