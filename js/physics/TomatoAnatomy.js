import { MATERIALS, MATERIAL_PARAMS } from "./mpm/NeoHookean.js";

/**
 * Anatomically structured tomato particle generator.
 * Layers: exocarp shell, mesocarp parenchyma, placenta ridges, locule cavities, seeds.
 */
export function buildTomatoParticles(mpm, options = {}) {
  const radius = options.radius ?? 0.038;
  const center = options.center ?? [0, radius + 0.005, 0];
  const spacing = options.spacing ?? 0.0028;
  const cx = center[0], cy = center[1], cz = center[2];

  const loculeCenters = [
    [0.012, 0.008, 0.012],
    [-0.012, 0.006, 0.01],
    [0.008, 0.01, -0.014],
    [-0.01, 0.012, -0.012],
  ].map(([x, y, z]) => [cx + x, cy + y, cz + z]);

  const loculeRadius = radius * 0.28;
  const exocarpThick = radius * 0.06;
  const seedCount = options.seedCount ?? 40;
  const particleVolume = spacing ** 3;
  const seeds = [];

  // Seeds on placenta ridges
  for (let s = 0; s < seedCount; s++) {
    const theta = (s / seedCount) * Math.PI * 2 + Math.random() * 0.4;
    const phi = Math.acos(2 * Math.random() - 1) * 0.55 + 0.2;
    const r = radius * (0.25 + Math.random() * 0.35);
    seeds.push([
      cx + r * Math.sin(phi) * Math.cos(theta),
      cy + r * Math.cos(phi) * 0.6,
      cz + r * Math.sin(phi) * Math.sin(theta),
    ]);
  }

  const n = Math.ceil((radius * 2.2) / spacing);
  let added = 0;

  for (let ix = -n; ix <= n; ix++) {
    for (let iy = -n; iy <= n; iy++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = cx + ix * spacing;
        const y = cy + iy * spacing * 0.92;
        const z = cz + iz * spacing;

        const dx = x - cx, dy = (y - cy) / 0.88, dz = z - cz;
        const r = Math.hypot(dx, dy, dz);
        if (r > radius) continue;

        // Locule cavities (4 chambers)
        let inLocule = false;
        for (const lc of loculeCenters) {
          if (Math.hypot(x - lc[0], y - lc[1], z - lc[2]) < loculeRadius) {
            inLocule = true;
            break;
          }
        }
        if (inLocule) continue;

        // Seeds (ellipsoids)
        let isSeed = false;
        for (const sd of seeds) {
          const sx = (x - sd[0]) / 0.0025;
          const sy = (y - sd[1]) / 0.0018;
          const sz = (z - sd[2]) / 0.002;
          if (sx * sx + sy * sy + sz * sz < 1) {
            isSeed = true;
            break;
          }
        }

        let material = MATERIALS.MESOCARP;
        if (isSeed) {
          material = MATERIALS.SEED;
        } else if (r > radius - exocarpThick) {
          material = MATERIALS.EXOCARP;
        } else if (r < radius * 0.35 && Math.abs(dy) < radius * 0.15) {
          material = MATERIALS.PLACENTA;
        }

        const params = MATERIAL_PARAMS[material];
        const mass = params.density * particleVolume;

        mpm.addParticle({
          x: [x, y, z],
          v: [0, 0, 0],
          volume: particleVolume,
          mass,
          material,
        });
        added++;
      }
    }
  }

  // Locule fluid reservoir particles (pre-rupture juice)
  const loculeCount = options.loculeFluidCount ?? 60;
  for (const lc of loculeCenters) {
    const perLocule = Math.ceil(loculeCount / loculeCenters.length);
    for (let j = 0; j < perLocule; j++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const lr = loculeRadius * 0.65 * Math.cbrt(Math.random());
      const x = lc[0] + lr * Math.sin(phi) * Math.cos(theta);
      const y = lc[1] + lr * Math.cos(phi);
      const z = lc[2] + lr * Math.sin(phi) * Math.sin(theta);
      const params = MATERIAL_PARAMS[MATERIALS.LOCULE_FLUID];
      const vol = spacing ** 3 * 0.5;
      mpm.addParticle({
        x: [x, y, z],
        v: [0, 0, 0],
        volume: vol,
        mass: params.density * vol,
        material: MATERIALS.LOCULE_FLUID,
      });
      added++;
    }
  }

  return added;
}

export function getTomatoBounds(mpm) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of mpm.particles) {
    if (!p.active) continue;
    minY = Math.min(minY, p.x[1]);
    maxY = Math.max(maxY, p.x[1]);
  }
  return { minY, maxY, centerY: (minY + maxY) * 0.5 };
}
