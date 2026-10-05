# AGENTS.md — EDOLUS

Repository memory for future agent sessions. Keep this file current.

## What this is
Zero-build static single-page site: a cinematic WebGL "Edolus" experience
(low-orbit Earth, scroll-driven orbital story, ambient spatial audio, HUD UI).

## Run / verify
- Serve statically (ES modules + textures need HTTP, not `file://`):
  `python3 -m http.server 8000` then open `http://localhost:8000`.
- There is no build step, no package.json, no test runner. Do not add one unless asked.
- Debug hook: append `?debug=1` to expose `window.__EDOLUS__` = `{ scene, audio, lenis }`.
  Used by automated puppeteer checks. Keep this hook working.

## Layout
- `index.html` — all four sections + boot overlay + fixed canvas + HUD + inspector.
- `assets/css/style.css` — design tokens (`:root`) and all HUD/glass/responsive styles.
- `assets/js/main.js` — orchestrator: boot, Lenis+ScrollTrigger, HUD widgets, forms, audio.
- `assets/js/scene.js` — `EdolusScene` class: Three.js scene, camera curves, post FX.
- `assets/js/shaders.js` — all GLSL as exported template strings (no external shader files).
- `assets/js/audio.js` — `AudioManager` (Web Audio graph).
- `assets/vendor/`, `assets/textures/` — vendored libs and Earth maps (offline-safe).

## Conventions / gotchas
- Three.js is imported via an **importmap** mapping `"three"` to the vendored module.
  `import * as THREE from "three"` in any new module.
- GSAP / ScrollTrigger / Lenis are classic globals (`window.gsap`, `window.ScrollTrigger`,
  `window.Lenis`) loaded before the module script.
- Post-processing is hand-rolled in `scene.js` (bright pass -> blur -> composite). Do NOT
  pull in `three/examples` addons; that is deliberate to avoid version-mismatch risk.
- The WebGL canvas is `pointer-events:none`; DOM UI must stay clickable. Globe node
  picking is a **window-level** raycaster in `scene.js` that ignores events whose target
  is interactive chrome. Do not re-enable pointer events on `#gl`.
- Lenis smooth scroll is wired into the GSAP ticker; ScrollTrigger is refreshed on `load`.
- `prefers-reduced-motion` is respected (short boot, no smooth scroll, static reveals).
- `formatNum` (main.js) handles thousands separators for counters.

## Verified
Rendered and interaction-tested headlessly with puppeteer-core + system chromium
(`--use-angle=swiftshader`): WebGL context, boot completion, INITIATE flow, node
inspector, audio unlock + mute, camera path progression, live counters/sparkline/gauges,
form validation, mobile viewport. No console/page errors.
