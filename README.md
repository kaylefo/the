# Hyper-Realistic Tomato Squashing Physics

**Live demo:** [https://kaylefo.github.io/the/](https://kaylefo.github.io/the/)

Multiphysics browser simulation: **MPM solid mechanics**, **neo-Hookean hyperelasticity**, **phase-field fracture**, **FLIP Navier-Stokes juice**, anatomical tissue layers, and **BSSRDF subsurface rendering**.

## Physics stack

| System | Model | Equations |
|--------|-------|-----------|
| **Solid** | MLS-MPM + APIC | \(\mathbf{F}\), neo-Hookean \(\Psi = \frac{\mu}{2}(I_1-3) - \mu\ln J + \frac{\lambda}{2}(\ln J)^2\) |
| **Fracture** | Phase-field on grid | Damage \(\phi\) evolves with strain energy density; stiffness degrades as \((1-\phi)^2\) |
| **Fluid** | FLIP incompressible NS | \(\nabla\cdot\mathbf{u}=0\), \(\rho D\mathbf{u}/Dt = -\nabla p + \mu\nabla^2\mathbf{u} + \rho\mathbf{g}\) |
| **Anatomy** | Voxelized composite | Exocarp shell, mesocarp, placenta, 4 locule cavities, seeds, locule fluid reservoirs |
| **Contact** | Signorini ground + press plate | Coulomb friction on cutting board |
| **Rendering** | Marching cubes + custom GLSL | Jensen dipole SSS, dual-lobe wet/dry specular |

## Architecture

```
TomatoAnatomy → MPMSolver (P2G → grid → G2P)
                    ↓ damage > 0.85
               FLIPSolver (markers + pressure projection)
                    ↓
         density field → Marching Cubes → BSSRDF mesh
                    ↓
              ForceRecorder (F–h validation chart)
```

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Controls

| Input | Action |
|-------|--------|
| Click + drag | Lower press plate onto tomato |
| Scroll | Squeeze rate |
| R | Reset |
| Space | Drop tomato |

## Files

- `js/physics/mpm/MPMSolver.js` — MPM/APIC time integration
- `js/physics/mpm/NeoHookean.js` — constitutive model + material params
- `js/physics/TomatoAnatomy.js` — anatomical particle generator
- `js/physics/fluid/FLIPSolver.js` — juice dynamics
- `js/physics/validation/ForceRecorder.js` — F–h curve
- `js/rendering/MarchingCubes.js` — isosurface extraction
- `js/rendering/TomatoRenderer.js` — SSS + wetness shaders
- `js/TomatoSimulation.js` — orchestrator

## Roadmap to 1000/1000

This implementation (~150–350 on the fidelity scale) replaces mass-springs with real continuum mechanics. Remaining gaps for experimental-grade fidelity:

- GPU CUDA/WebGPU MPM (10⁶+ particles)
- Adjoint-based parameter identification against Instron data
- CT-derived geometry
- Spectral path-traced BSSRDF from measured tissue optical properties
