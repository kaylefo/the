# Tomato Squash Lab — Quality Assurance

**Live:** [https://kaylefo.github.io/the/](https://kaylefo.github.io/the/)

This document defines what “high quality” means for this project, how to test it, and the quality tiers implemented for flagship mobile (iPhone 16 Pro Max class) through low-end devices.

---

## 1. Quality definition

High quality for this app means **all** of the following:

| Pillar | High-quality bar |
|--------|------------------|
| **Functional** | Simulation starts, runs, and recovers on first load without refresh |
| **Interactive** | Press plate responds to touch/mouse within 1 frame of input |
| **Stable** | No runaway FPS collapse; adaptive tier keeps ≥45 FPS on target devices |
| **Readable** | HUD legible; controls reachable with thumb; safe-area respected |
| **Physically plausible** | Tomato compresses, damages, releases juice — no silent physics freeze |
| **Visual** | Mesh updates during squash; SSS shader visible; fluid markers appear on rupture |
| **Accessible** | Works without keyboard; 44px min touch targets; reduced-motion respected |
| **Resilient** | Graceful WebGL error; pauses when tab hidden; survives rotation/resize |

---

## 2. Device tiers

| Tier | Target hardware | Grid | FPS target | Shadows | DPR cap |
|------|-----------------|------|------------|---------|---------|
| **Ultra** | iPhone 16 Pro Max, M-series desktop | 32³ | 90 | 2048 | 2.0 |
| **High** | iPhone 14+, modern Android | 28³ | 60 | 1024 | 2.0 |
| **Medium** | iPhone SE, budget Android | 24³ | 60 | off | 1.5 |
| **Low** | Old/low-memory mobile | 20³ | 45 | off | 1.0 |

**iPhone 16 Pro Max optimizations:**
- Auto-detected via iOS + DPR ≥3 + viewport ≥420×900 + WebGL2
- Starts at **Ultra** tier
- DPR capped at **2** (renders ~1320p wide — sharp on 2796×1290 panel without 3× full cost)
- Collapsible HUD defaults closed so the canvas is unobstructed
- Touch squeeze rate boosted 1.4× vs desktop slider equivalent
- `visualViewport` used for Safari dynamic toolbar resize

**Adaptive quality:** if FPS stays >10 below target for ~0.5s, tier downgrades; upgrades after ~2s stable headroom.

---

## 3. Test matrix

### 3.1 Smoke tests (every release)

- [ ] Page loads at `/the/` on GitHub Pages
- [ ] Loading screen dismisses within 5s on desktop
- [ ] Loading screen dismisses within 8s on mobile
- [ ] WebGL failure shows retry panel (simulate by disabling WebGL in devtools)
- [ ] Tomato mesh visible after init
- [ ] Drag lowers press plate; tomato deforms
- [ ] Reset button restores tomato
- [ ] Drop button adds downward velocity

### 3.2 Mobile / touch (iPhone Safari priority)

- [ ] No page scroll while dragging canvas
- [ ] No pinch-zoom on canvas
- [ ] Pointer capture: drag continues if finger moves off canvas
- [ ] HUD toggle (☰) opens/closes panel
- [ ] Slider usable with thumb (≥44px hit area)
- [ ] Drop + Reset buttons respond on first tap
- [ ] Safe area: HUD clears home indicator in portrait
- [ ] Landscape: canvas fills screen; HUD still usable
- [ ] Add to Home Screen: `theme-color` + status bar style apply

### 3.3 Performance

- [ ] iPhone 16 Pro Max: FPS ≥55 in Ultra during active squash
- [ ] iPhone 12 class: FPS ≥45 in High
- [ ] Tab backgrounded → simulation pauses (CPU drops)
- [ ] Tab foregrounded → simulation resumes without crash
- [ ] 30s continuous squash → no memory runaway (Safari timeline)

### 3.4 Visual / simulation

- [ ] Damage φ increases under compression
- [ ] Juice ml increases after rupture
- [ ] F–h chart draws on desktop; hidden when HUD collapsed on mobile
- [ ] Quality badge shows correct tier (e.g. “Ultra · Pro Max”)
- [ ] Fluid particles visible after heavy squash
- [ ] Mesh does not flicker/disappear for >3 consecutive frames

### 3.5 Regression / edge cases

- [ ] Rotate device during drag — no permanent stuck drag state
- [ ] Rapid Reset spam — no crash
- [ ] Offline after first load (CDN three.js cached) — still runs
- [ ] Desktop keyboard: R, Space still work

---

## 4. Manual test procedure (iPhone 16 Pro Max)

1. Open **Safari** → [kaylefo.github.io/the](https://kaylefo.github.io/the/)
2. Confirm badge reads **Ultra · Pro Max**
3. Tap ☰ → panel slides up; verify stats + slider + Drop/Reset
4. Tap ☰ to collapse — full-screen canvas
5. **Drag down** on tomato/plate area for 5s — damage and juice increase
6. Tap **Drop** — tomato falls and rebounds
7. Tap **Reset** — tomato restored, stats zeroed
8. Rotate to landscape — no layout break; drag still works
9. Background tab 10s → return — FPS recovers
10. Add to Home Screen → launch standalone — full viewport, no URL bar overlap

**Pass criteria:** steps 2–9 complete without refresh; FPS display ≥50 during step 5.

---

## 5. Known limitations (current codebase)

| Item | Status |
|------|--------|
| GPU MPM (WebGPU) | Not implemented — CPU MPM limits particle count |
| Haptic feedback on rupture | Not implemented |
| Offline-first service worker | Not implemented |
| Instron reference curve overlay | Chart is live only, no golden reference |
| iPhone 120Hz ProMotion sync | Fixed timestep, not display-linked |

---

## 6. Release checklist

1. Run smoke tests on **desktop Chrome**
2. Run mobile test procedure on **iPhone Safari** (or Simulator)
3. Verify GitHub Actions Pages deploy green
4. Confirm [live URL](https://kaylefo.github.io/the/) serves new `index.html` (cache-bust if needed)
5. Check quality badge + FPS in Ultra on Pro Max class device

---

## 7. File map (QA-relevant)

| File | Responsibility |
|------|----------------|
| `js/platform/DeviceProfile.js` | Tier detection + adaptive quality |
| `js/platform/WebGLProbe.js` | WebGL gate + fatal errors |
| `js/ui/MobileHUD.js` | Collapsible HUD, mobile hints |
| `js/TomatoSimulation.js` | Touch input, pause, resize, quality apply |
| `css/style.css` | Safe areas, 44px targets, mobile HUD |
| `index.html` | PWA meta, viewport-fit=cover |
