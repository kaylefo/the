# Water Physics Lab — Architecture

Browser-based interactive water tank demo built on Three.js r165 (ES modules). Click-to-vaporize FLIP water, volumetric steam, glass condensation, and photoreal post-processing.

## Entry points

| File | Role |
|------|------|
| `water.html` | UI, HUD, loading gate |
| `js/water-main.js` | Boot sequence via `LoadingManager` |
| `js/WaterLabSimulation.js` | Main orchestrator |

## Simulation pipeline (per frame)

```
Input → VaporizationCoupler → WaterFLIPSolver
                            ↘ StableFluidsSmoke (+ optional WebGPU density advect)
                            ↘ BubbleSystem
                            ↘ CondensationSimulator (glass moisture)
Density field → Marching Cubes → WaterRenderer mesh
Smoke grid    → SmokeVolumeRenderer (3D texture raymarch)
```

Physics runs at 120 Hz substeps (`PHYSICS_DT = 1/120`) with tier-dependent substep count.

## Rendering pipeline

```
Scene (glass tank, water mesh, smoke volume, caustic floor/table)
  → WaterRenderer.renderWaterPass (refraction RT + SSR)
  → PostProcessPipeline:
      RenderPass → HeatShimmer → UnrealBloom → GodRays → FilmGrain
```

## Key modules

### Physics

- **`WaterFLIPSolver`** — FLIP/APIC hybrid water with wall boundaries, surface tension, marker particles.
- **`VaporizationCoupler`** — Maps click heat to liquid mass removal and smoke injection.
- **`StableFluidsSmoke`** — CPU stable-fluids on a 3D grid; active-cell sparse iteration for buoyancy/advection.
- **`WebGPUSmokeAccelerator`** — Optional WGSL compute density advection (Ultra tier, 1-frame readback latency).
- **`BubbleSystem`** — Underwater bubble spawn/pop at heat sources.
- **`CondensationSimulator`** — Moisture atlas on four glass wall faces from nearby steam density/temperature.

### Rendering

- **`WaterRenderer`** — Photoreal water (Fresnel, refraction, SSR, foam, env map).
- **`SmokeVolumeRenderer`** — Ray-marched 3D smoke with Henyey–Greenstein phase; temporal blend for smooth steam.
- **`GlassTankRenderer`** — Custom glass shader with condensation map, droplet normal perturbation, env reflections.
- **`CausticsGenerator`** — Density laplacian caustics projected onto table/floor.
- **`PostProcessPipeline`** — Shimmer, bloom, god rays, film grain (tier-gated).

### Platform

- **`WaterDeviceProfile`** / **`WATER_QUALITY_TIERS`** — ultra/high/medium/low presets.
- **`OrbitCameraController`** — Damped orbit; right-drag / two-finger pinch on mobile.
- **`AdaptiveQuality`** — Runtime tier downgrade/upgrade from measured FPS.

## Controls

| Input | Action |
|-------|--------|
| Click / tap | Vaporize at pointer |
| Hold + drag | Sustained boil + fluid stir |
| Scroll / slider | Heat intensity |
| Shift + scroll | Camera zoom |
| Right-drag | Orbit camera |
| Two fingers (mobile) | Orbit + pinch zoom |
| R | Reset tank |
| Space | Shock boil at center |

## Quality tiers (summary)

| Tier | Water grid | Smoke res | God rays | WebGPU smoke | Condensation |
|------|------------|-----------|----------|--------------|--------------|
| Ultra | 36³ | 56 | yes | yes | 56²/face |
| High | 32³ | 48 | yes | no | 48²/face |
| Medium | 28³ | 40 | no | no | 40²/face |
| Low | 24³ | 32 | no | no | 32²/face |

## Debug

`window.__waterLab` exposes the live simulation instance after load.

## Local run

```bash
python3 -m http.server 8080
# open http://localhost:8080/water.html
```

Static hosting (GitHub Pages) requires no build step — modules load from CDN import map in `water.html`.
