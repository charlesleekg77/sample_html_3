# EDOLUS — Intelligence at Planetary Scale

A single-page, cinematic sci-fi / aerospace / AI-infrastructure experience: a real-time
WebGL Earth in low orbit, an ambient spatial soundscape, and a scroll-driven orbital
story. Built as a **zero-build static site** so it runs anywhere a static file server
does.

```
open index.html through any static server, e.g.:
python3 -m http.server 8000     # then visit http://localhost:8000
```

> A local server is required (ES modules + texture fetches are blocked on `file://`).

---

## 1. Brand & visual identity

| Token | Value | Use |
| --- | --- | --- |
| Space black | `#050505` | Background, canvas clear |
| Indigo / navy | `#1b2a5b` -> `#3a5bd9` | Panels, meters, accents |
| Atmospheric blue | `#5b8cff` / `#8fb4ff` | Atmosphere glow, HUD, active states |
| Stark white | `#f4f6fb` | Display type, high-contrast readouts |

- **Display type** — `Syncopate` (wide-tracked, uppercase) for headers and the wordmark.
  Chosen as a free stand-in for Neue Haas Grotesk / Monument Extended.
- **Technical type** — `Space Mono` for subtext, coordinates, telemetry and HUD chrome.
- **Body** — `Inter` (300–600) for prose.
- **Language** — corner brackets, crosshairs, scanlines, glassmorphism panels, a 1 px
  progress rail, and subtle glow only where it carries meaning (live data, active nav).

## 2. Page structure

1. **Hero overlay** — centered `EDOLUS` wordmark (top bar), "INTELLIGENCE AT PLANETARY
   SCALE", the atmospheric subtitle, a bordered **INITIATE SYSTEM** CTA, and the
   "EXPERIENCE WITH HEADPHONES" prompt. Fullscreen WebGL Earth with a live atmospheric
   shader, planet rotation and a cinematic camera drift.
2. **Orbital story** — three scroll bands the camera flies through:
   - `LAYER 01` Global coverage & data mesh (node count, mesh uptime, routes/sec)
   - `LAYER 02` Orbital AI compute (spec grid + animated inference-load meter)
   - `LAYER 03` System architecture & transmission metrics (live throughput sparkline,
     signal/thermal gauges, packet loss)
3. **Tech specs** — a four-card HUD manifest grid (orbital parameters, low-latency
   compute, transmission, mission parameters) plus an infinite ticker.
4. **Access footer** — a validated "Request Enterprise System Access" terminal form.

## 3. Technical architecture

```
index.html                     semantic markup, importmap, vendor scripts
assets/
  css/style.css                design system: tokens, HUD chrome, glass, responsive
  js/main.js                   orchestrator: boot, scroll, HUD, forms, audio wiring
  js/scene.js                  Three.js scene, camera choreography, post-processing
  js/shaders.js                all GLSL (earth, atmosphere, clouds, particles, bloom)
  js/audio.js                  Web Audio API manager
  vendor/                      three, gsap, ScrollTrigger, lenis (vendored, offline-safe)
  textures/                    blue-marble + night-lights Earth maps
```

- **WebGL** — Three.js, loaded through an **importmap** (`"three" -> vendored module`),
  so the code uses idiomatic `import * as THREE from "three"` with no bundler.
- **Scroll** — **Lenis** smooth scroll, piped into the **GSAP ticker** and
  **ScrollTrigger**. A single master trigger maps page progress `0->1` onto a
  `CatmullRomCurve3` camera position + look-at path.
- **Post-processing** — a hand-rolled bright-pass -> separable Gaussian blur -> composite
  chain (bloom, filmic tone curve, vignette, animated grain) so there is **no dependency
  on `three/examples` addons** and no version-mismatch risk.
- **Audio** — a Web Audio node graph (drone oscillators + brown-noise wind bed + bus
  compressor, spatial beacon pings, mechanical UI blips, a whoosh for INITIATE). Built
  lazily on the first gesture to satisfy autoplay policy.

### GLSL shaders (`shaders.js`)

- `earth` — day/night blend across a soft terminator, boosted night-side city lights,
  water-masked specular, fresnel atmospheric rim.
- `atmosphere` / halo — fresnel scattering on back-side shells, brightening toward the
  sun-facing limb (additive).
- `clouds` — procedural 5-octave fbm alpha on a slightly larger shell, lit by the sun.
- `particles` — twinkling constellation points with per-point size/phase/colour; the same
  program doubles as the interactive data-mesh nodes.
- `arcs` — node-to-node transmission lines with a travelling pulse.
- `bloom` — bright pass, 9-tap separable blur, composite (tone map + vignette + grain).

### Camera choreography

`posCurve` / `tgtCurve` are keyed per story beat (hero -> mesh -> compute -> telemetry ->
specs -> access). On load the camera eases from an intro framing into path start; pointer
movement adds damped parallax; hero retains a slow orbital drift until the visitor
engages. **INITIATE SYSTEM** fires a cinematic FOV punch (`46 -> 30 -> 46`) and a Lenis
travel to the first orbit layer.

## 4. Deliverables -> where they live

| Deliverable | Location |
| --- | --- |
| Single-page architecture | `index.html` |
| Three.js canvas (Earth, atmosphere, particles, scroll camera) | `assets/js/scene.js` |
| Custom GLSL (atmosphere, clouds, city lights, particle mesh) | `assets/js/shaders.js` |
| HUD UI components (brackets, buttons, glass, gauges) | `assets/css/style.css` |
| Audio manager (mute/unmute tied to INITIATE) | `assets/js/audio.js` |

## 5. Notable engineering decisions

- **Vendored, offline-safe assets.** Three.js, GSAP, ScrollTrigger, Lenis and both Earth
  textures are committed locally, so the experience has no runtime CDN dependency.
- **Graceful degradation.** A WebGL capability probe swaps in a CSS gradient fallback;
  `prefers-reduced-motion` shortens the boot, disables smooth scroll and reveals content
  statically; a `low` quality tier reduces geometry/particle counts and pixel ratio on
  small screens.
- **Accessibility.** Real semantic landmarks, labelled controls, `aria-live` status
  regions, and keyboard-operable buttons; decorative chrome is `aria-hidden`.
- **Interaction model.** The canvas is `pointer-events:none` so DOM UI stays fully
  clickable; globe node picking is done with a window-level raycaster that ignores events
  originating on interactive chrome.
- **Debug hook.** Append `?debug=1` to expose `window.__EDOLUS__` (scene, audio, lenis)
  for automated testing.
