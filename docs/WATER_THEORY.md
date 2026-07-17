# Water Physics Lab — Mathematical Formulation

This document specifies the continuous and discrete models implemented in `WaterFLIPSolver` and coupled subsystems. Notation follows standard CFD literature (Chorin & Marsden; Fedkiw et al.; Jiang et al.).

## 1. Governing equations (incompressible flow)

On fluid domain Ω(t) with free surface Γ(t):

\[
\rho \left( \frac{\partial \mathbf{u}}{\partial t} + \mathbf{u} \cdot \nabla \mathbf{u} \right) = -\nabla p + \mu \nabla^2 \mathbf{u} + \rho \mathbf{g} + \mathbf{f}_{\sigma} + \mathbf{f}_{Ma} + \mathbf{f}_{\omega}
\]

\[
\nabla \cdot \mathbf{u} = 0
\]

| Term | Model |
|------|--------|
| \(\rho\) | 998 kg/m³ (water at 20°C) |
| \(\mu\) | 1 mPa·s |
| \(\mathbf{g}\) | \((0, -9.81, 0)\) m/s² |
| \(\mathbf{f}_{\sigma}\) | CSF surface tension (Brackbill et al. 1992) |
| \(\mathbf{f}_{Ma}\) | Marangoni thermocapillary stress |
| \(\mathbf{f}_{\omega}\) | Vorticity confinement (Fedkiw et al.) |

### Level-set free surface

Signed distance \(\phi(\mathbf{x}, t)\): \(\phi < 0\) in liquid, \(\phi > 0\) in gas. Reinitialized each step via narrow-band fast sweeping (Sussman et al. 1994) to maintain \(|\nabla\phi| \approx 1\).

### CSF surface tension

\[
\mathbf{f}_{\sigma} = \sigma \kappa \mathbf{n} \delta_\epsilon(\phi), \quad \mathbf{n} = \frac{\nabla\phi}{|\nabla\phi|}, \quad \kappa = \nabla \cdot \mathbf{n}
\]

Implemented with \(\sigma = 0.072\) N/m on a 7-point discrete Laplacian stencil of \(\phi\).

### Marangoni stress

\[
\mathbf{f}_{Ma} = \frac{1}{\rho} \frac{d\sigma}{dT} \left( \nabla T - (\nabla T \cdot \mathbf{n})\mathbf{n} \right)
\]

with \(d\sigma/dT \approx -8 \times 10^{-5}\) N/(m·K) for water (negative — hot regions pull fluid away from heat source along surface).

## 2. Temperature field

\[
\frac{\partial T}{\partial t} + \mathbf{u} \cdot \nabla T = \alpha \nabla^2 T + \frac{\dot{Q}}{\rho c_p}
\]

| Constant | Value |
|----------|-------|
| \(\alpha\) | 1.43×10⁻⁷ m²/s (thermal diffusivity) |
| \(c_p\) | 4182 J/(kg·K) |
| \(T_{sat}\) | 100°C (nucleate boiling threshold) |

**Boiling nucleation** (phenomenological superheat model):

\[
\dot{m}_{vap} \propto \max(0, T - T_{sat})^n, \quad n = 1.8
\]

Coupled to `VaporizationCoupler` for mass transfer to the smoke field.

## 3. Operator splitting (per substep)

1. **P2G (APIC)** — Affine momentum transfer (Jiang et al. 2015):
   \[
   \mathbf{v}_{apic} = \mathbf{v}_p + \mathbf{C}_p (\mathbf{x}_g - \mathbf{x}_p)
   \]
   Quadratic B-spline weights on a uniform collocated grid.

2. **Level-set build + redistancing + fluid mask + GFM face weights \(\theta_{ij}\)**

3. **Explicit forces** — viscosity, gravity, CSF, Marangoni

4. **Temperature advection–diffusion** (semi-Lagrangian + explicit Laplacian)

5. **Divergence** — \(\nabla\cdot\mathbf{u}\) via central differences

6. **Pressure Poisson** (Ghost-Fluid weighted):
   \[
   \sum_j \theta_{ij}(p_i - p_j) = \Delta t\, \nabla\cdot\mathbf{u}^* \cdot \Delta x^2
   \]
   Dirichlet \(p = 0\) in air neighbours. Solved by RB-GS warm-up + **Jacobi-preconditioned CG**.

7. **Pressure gradient** — project \(\mathbf{u}^{n+1}\) to divergence-free field

8. **G2P (FLIP/APIC)**:
   \[
   \mathbf{v}_p^{n+1} = \gamma (\mathbf{v}_p + \Delta\mathbf{u}_{grid}) + (1-\gamma)\mathbf{u}_{PIC}, \quad \gamma = 0.97
   \]
   APIC affine matrix \(\mathbf{C}\) updated from grid velocity gradient.

9. **XSPH cohesion** (spatial-hash O(n)) + periodic marker separation

## 4. Ghost-Fluid Method (GFM)

For cell \(i\) adjacent to air at face \((i,j)\):

\[
\theta_{ij} = \begin{cases} 1 & \text{fluid neighbour} \\ \max(0.15, \min(1, 0.5 - \phi_i/\Delta x)) & \text{air neighbour} \end{cases}
\]

This partial-cell weighting reduces spurious currents at the free surface compared to uniform Dirichlet enforcement.

## 5. Pressure solver

**Hybrid RB-GS + PCG** with Jacobi preconditioner \(M^{-1} = \mathrm{diag}(A)^{-1}\):

- Warm-up: \(\lfloor 0.35 \times N_{iter} \rfloor\) red-black Gauss–Seidel sweeps
- Polish: up to 16 preconditioned conjugate gradient iterations
- Stopping: \(\|\mathbf{r}\|_M < 10^{-14}\)

## 6. CFL condition

\[
\Delta t \leq C \frac{\Delta x}{\|\mathbf{u}\|_{\max}}, \quad C = 0.45
\]

Clamped additionally to \(\Delta t \leq 4\times10^{-4}\) s.

## 7. Coupled subsystems

| Coupling | Mechanism |
|----------|-----------|
| Water ↔ smoke | `WaterSmokeCoupler`: interface shear + submerged drag |
| Water ↔ bubbles | FLIP velocity advection + buoyancy |
| Heat ↔ vapor | Temperature field → superheat → mass removal → smoke injection |
| \(\phi\) ↔ caustics | Zero-crossing height field → Laplacian caustic intensity |
| Slosh ↔ audio/shader | Surface kinetic energy → Gerstner ripple amplitude |

## References

- Jiang C. et al. (2015) — APIC transfer
- Brackbill J. et al. (1992) — CSF surface tension
- Fedkiw R. et al. (2001) — Vorticity confinement; ghost fluids
- Enright D. et al. (2002) — Level-set hybrid particle level set
- Gibou F. et al. (2007) — GFM for Poisson problems
- Sussman M. et al. (1994) — Level-set reinitialization
