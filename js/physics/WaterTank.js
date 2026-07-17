/**
 * Glass tank geometry and initial water fill for the Water Physics Lab.
 */

export const TANK = {
  origin: [-0.1, 0, -0.1],
  width: 0.2,
  height: 0.14,
  depth: 0.2,
  wallThickness: 0.004,
  fillRatio: 0.68,
};

export function tankBounds(tank = TANK) {
  return {
    xMin: tank.origin[0] + tank.wallThickness,
    xMax: tank.origin[0] + tank.width - tank.wallThickness,
    yMin: tank.origin[1] + tank.wallThickness,
    yMax: tank.origin[1] + tank.height - tank.wallThickness,
    zMin: tank.origin[2] + tank.wallThickness,
    zMax: tank.origin[2] + tank.depth - tank.wallThickness,
  };
}

export function gridFromTank(tank, gridSize) {
  const dx = tank.width / (gridSize - 2);
  const origin = [
    tank.origin[0] - dx,
    tank.origin[1] - dx * 0.5,
    tank.origin[2] - dx,
  ];
  const ny = Math.round(tank.height / dx) + 2;
  const nz = gridSize;
  const nx = gridSize;
  return { nx, ny, nz, origin, dx, tank };
}

/**
 * Seed FLIP markers on a staggered lattice inside the tank fill volume.
 */
export function fillTank(solver, tank = TANK, fillRatio = tank.fillRatio) {
  _fillTankMarkers(solver, tank, fillRatio);
}

/** Chunked fill with yields so mobile browsers stay responsive during boot. */
export async function fillTankAsync(solver, tank = TANK, fillRatio = tank.fillRatio, opts = {}) {
  const yieldEvery = opts.yieldEvery ?? 350;
  const onProgress = opts.onProgress;
  const b = tankBounds(tank);
  const fillY = b.yMin + (b.yMax - b.yMin) * fillRatio;
  const spacing = solver.dx * 0.82;
  const jitter = spacing * 0.15;

  let added = 0;
  const xs = [];
  const zs = [];
  const ys = [];
  for (let x = b.xMin + spacing * 0.5; x < b.xMax; x += spacing) xs.push(x);
  for (let z = b.zMin + spacing * 0.5; z < b.zMax; z += spacing) zs.push(z);
  for (let y = b.yMin + spacing * 0.5; y < fillY; y += spacing) ys.push(y);
  const total = Math.min(xs.length * zs.length * ys.length, solver.maxMarkers);

  for (const x of xs) {
    for (const z of zs) {
      for (const y of ys) {
        if (solver.markers.length >= solver.maxMarkers) return;
        solver.markers.push(solver._createMarker({
          x: x + (Math.random() - 0.5) * jitter,
          y: y + (Math.random() - 0.5) * jitter,
          z: z + (Math.random() - 0.5) * jitter,
        }));
        added++;
        if (added % yieldEvery === 0) {
          onProgress?.(added / total);
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        }
      }
    }
  }

  _rippleSurface(solver.markers, b, fillY, spacing);
  onProgress?.(1);
}

function _fillTankMarkers(solver, tank, fillRatio) {
  const b = tankBounds(tank);
  const fillY = b.yMin + (b.yMax - b.yMin) * fillRatio;
  const spacing = solver.dx * 0.82;
  const jitter = spacing * 0.15;

  for (let x = b.xMin + spacing * 0.5; x < b.xMax; x += spacing) {
    for (let z = b.zMin + spacing * 0.5; z < b.zMax; z += spacing) {
      for (let y = b.yMin + spacing * 0.5; y < fillY; y += spacing) {
        if (solver.markers.length >= solver.maxMarkers) return;
        solver.markers.push(solver._createMarker({
          x: x + (Math.random() - 0.5) * jitter,
          y: y + (Math.random() - 0.5) * jitter,
          z: z + (Math.random() - 0.5) * jitter,
        }));
      }
    }
  }

  _rippleSurface(solver.markers, b, fillY, spacing);
}

function _rippleSurface(markers, b, fillY, spacing) {
  for (const m of markers) {
    if (m.y > fillY - spacing * 1.5) {
      const dx = m.x - (b.xMin + b.xMax) * 0.5;
      const dz = m.z - (b.zMin + b.zMax) * 0.5;
      m.y += Math.sin(dx * 80) * Math.cos(dz * 70) * 0.0004;
    }
  }
}
