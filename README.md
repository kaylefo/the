# Hyper-Realistic Tomato Squashing Physics

An interactive browser demo of a tomato being squashed with soft-body physics, internal pressure, skin rupture, juice spray, and seed burst.

![Tomato Squash Lab](https://img.shields.io/badge/physics-soft--body-red)

## Features

- **Soft-body simulation** — mass-spring network with Verlet integration and 5 constraint iterations per substep
- **Internal pressure** — volume preservation pushes back like real fruit flesh
- **Skin rupture** — springs break under strain, exposing pulp and releasing juice
- **Juice dynamics** — particle spray with gravity, drag, and splatter decals on the cutting board
- **Seed burst** — seeds eject from rupture points
- **PBR materials** — clearcoat tomato skin, emissive pulp, studio lighting with shadows

## Run locally

ES modules require a local server (not `file://`):

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Open [http://localhost:8080](http://localhost:8080)

## Controls

| Input | Action |
|-------|--------|
| Click + drag | Apply squeeze force at cursor |
| Scroll | Adjust squeeze strength |
| R | Reset tomato |
| Space | Drop tomato from height |

## Physics overview

```
                    ┌─────────────┐
  Mouse raycast ──► │   Impulse   │
                    └──────┬──────┘
                           ▼
              ┌────────────────────────┐
              │  Verlet integration    │
              │  + gravity             │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │  Spring constraints    │◄── strain tracking
              │  (structural + shear)  │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │  Pressure (volume)     │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │  Ground collision      │
              └───────────┬────────────┘
                          ▼
              Strain > threshold ──► Rupture ──► Juice + seeds
```

Built with [Three.js](https://threejs.org/) — no build step required.
