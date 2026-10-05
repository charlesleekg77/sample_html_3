/* =====================================================================
   EDOLUS — WebGL scene
   Earth + atmosphere + clouds + particle constellation + orbital assets
   + custom bloom post-processing + scroll-bound camera choreography.
   ===================================================================== */

import * as THREE from "three";
import {
  earthVert, earthFrag,
  atmosphereVert, atmosphereFrag,
  cloudVert, cloudFrag,
  particleVert, particleFrag,
  arcVert, arcFrag,
  fullscreenVert, brightPassFrag, blurFrag, compositeFrag,
} from "./shaders.js";

const EARTH_RADIUS = 1;
const DEG = Math.PI / 180;

/* lat/lon (degrees) -> position on sphere of given radius */
function latLonToVec3(lat, lon, radius = EARTH_RADIUS) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta)
  );
}

export class EdolusScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = opts.quality || "high";
    this.reducedMotion = opts.reducedMotion || false;

    this.clock = new THREE.Clock();
    this.time = 0;
    this.scrollProgress = 0;
    this.introT = 0;             // 0 -> 1 settle on load
    this.pointer = new THREE.Vector2(0, 0);
    this.smoothPointer = new THREE.Vector2(0, 0);
    this.fovBase = 46;
    this.fov = this.fovBase;

    this.sunDirection = new THREE.Vector3(0.72, 0.22, 0.66).normalize();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 0.06;

    this.onNodeSelect = opts.onNodeSelect || (() => {});
    this.onFrame = opts.onFrame || (() => {});

    this._initRenderer();
    this._initScene();
    this._initCameraPath();
    this._initEarth();
    this._initAtmosphere();
    this._initClouds();
    this._initConstellation();
    this._initOrbitalAssets();
    this._initDataMesh();
    this._initPost();

    this._bindEvents();
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality === "high",
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 2 : 1.25);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x050505, 1);
    this.renderer.toneMapping = THREE.NoToneMapping; // toned in composite pass
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = null;

    // Lights (mostly emissive/shader driven, but satellites need a key)
    this.sunLight = new THREE.DirectionalLight(0xbfd4ff, 2.2);
    this.sunLight.position.copy(this.sunDirection.clone().multiplyScalar(5));
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x223055, 0.6));

    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);
  }

  _initCameraPath() {
    this.camera = new THREE.PerspectiveCamera(this.fovBase, 1, 0.01, 100);

    // Keyframed camera positions + look-at targets across the scroll story
    const positions = [
      new THREE.Vector3(0.05, 0.55, 2.95),   // hero — low orbit
      new THREE.Vector3(1.35, 0.85, 2.05),   // mesh — swing east
      new THREE.Vector3(-1.55, 0.35, 1.75),  // compute — near constellation
      new THREE.Vector3(0.35, 1.85, 1.95),   // telemetry — high inclination
      new THREE.Vector3(-0.35, -0.75, 2.6),  // specs — wide south
      new THREE.Vector3(0.0, 0.15, 3.35),    // access — pull back
    ];
    const targets = [
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(0.35, 0.1, 0),
      new THREE.Vector3(-0.3, 0.15, 0),
      new THREE.Vector3(0, 0.3, 0),
      new THREE.Vector3(0, -0.1, 0),
      new THREE.Vector3(0, 0.05, 0),
    ];
    this.posCurve = new THREE.CatmullRomCurve3(positions, false, "catmullrom", 0.5);
    this.tgtCurve = new THREE.CatmullRomCurve3(targets, false, "catmullrom", 0.5);
    this.posCurve.updateArcLengths();
    this.tgtCurve.updateArcLengths();

    // Intro framing (slightly further back + off-axis) eases into path start
    this.introPos = new THREE.Vector3(-0.6, 1.1, 4.2);
    this.introTarget = new THREE.Vector3(0, 0, 0);

    this._camPos = new THREE.Vector3().copy(this.introPos);
    this._camTarget = new THREE.Vector3().copy(this.introTarget);
    this._lookAt = new THREE.Vector3().copy(this.introTarget);
  }

  _initEarth() {
    const loader = new THREE.TextureLoader();
    const day = loader.load("assets/textures/earth-blue-marble.jpg");
    const night = loader.load("assets/textures/earth-night.jpg");
    [day, night].forEach((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    });

    this.earthUniforms = {
      uDay: { value: day },
      uNight: { value: night },
      uSunDirection: { value: this.sunDirection },
      uAtmosphere: { value: new THREE.Color(0x5b8cff) },
      uTime: { value: 0 },
      uNightBoost: { value: 1.15 },
      uCameraPos: { value: new THREE.Vector3() },
    };

    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, this.quality === "high" ? 128 : 64, this.quality === "high" ? 128 : 64),
      new THREE.ShaderMaterial({
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        uniforms: this.earthUniforms,
      })
    );
    this.earth.rotation.y = -1.2;
    this.earthGroup.add(this.earth);
  }

  _initAtmosphere() {
    this.atmoUniforms = {
      uColor: { value: new THREE.Color(0x5b8cff) },
      uSunDirection: { value: this.sunDirection },
      uCameraPos: { value: new THREE.Vector3() },
      uIntensity: { value: 1.15 },
      uPower: { value: 3.4 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVert,
      fragmentShader: atmosphereFrag,
      uniforms: this.atmoUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.19, 96, 96), mat);
    this.earthGroup.add(this.atmosphere);

    // Outer soft halo
    const haloMat = mat.clone();
    haloMat.uniforms = {
      uColor: { value: new THREE.Color(0x2f4fbf) },
      uSunDirection: { value: this.sunDirection },
      uCameraPos: { value: new THREE.Vector3() },
      uIntensity: { value: 0.5 },
      uPower: { value: 5.0 },
    };
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.45, 64, 64), haloMat);
    this.halo.rotation.x = 0.4;
    this.earthGroup.add(this.halo);
  }

  _initClouds() {
    this.cloudUniforms = {
      uTime: { value: 0 },
      uSunDirection: { value: this.sunDirection },
      uCameraPos: { value: new THREE.Vector3() },
      uOpacity: { value: 0.55 },
    };
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.012, 96, 96),
      new THREE.ShaderMaterial({
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        uniforms: this.cloudUniforms,
        transparent: true,
        depthWrite: false,
      })
    );
    this.clouds.rotation.y = -1.2;
    this.earthGroup.add(this.clouds);
  }

  _initConstellation() {
    const count = this.quality === "high" ? 4200 : 1800;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const cA = new THREE.Color(0x9fc0ff);
    const cB = new THREE.Color(0xffffff);
    const cC = new THREE.Color(0x6a7dff);

    for (let i = 0; i < count; i++) {
      // Shell distribution far outside the planet
      const r = 6 + Math.pow(Math.random(), 0.6) * 22;
      const theta = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3 + 0] = r * s * Math.cos(theta);
      positions[i * 3 + 1] = r * u * 0.7;
      positions[i * 3 + 2] = r * s * Math.sin(theta);
      sizes[i] = 0.6 + Math.random() * 2.6;
      phases[i] = Math.random();
      const c = Math.random() < 0.12 ? cC : Math.random() < 0.6 ? cA : cB;
      colors[i * 3 + 0] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    this.particleUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: this.pixelRatio },
      uSizeScale: { value: 1.0 },
    };
    this.stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: this.particleUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.scene.add(this.stars);
  }

  _initOrbitalAssets() {
    this.satellites = new THREE.Group();
    this.orbits = new THREE.Group();
    this.scene.add(this.satellites);
    this.scene.add(this.orbits);

    const satCount = 14;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8e2ff, metalness: 0.85, roughness: 0.35, emissive: 0x1b2a5b, emissiveIntensity: 0.6 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1b2a5b, metalness: 0.6, roughness: 0.5, emissive: 0x0a1330, emissiveIntensity: 0.8 });

    for (let i = 0; i < satCount; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), bodyMat);
      g.add(body);
      const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.035), panelMat);
      panelL.position.x = -0.07; g.add(panelL);
      const panelR = panelL.clone(); panelR.position.x = 0.07; g.add(panelR);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x8fb4ff })
      );
      beacon.position.z = 0.03; g.add(beacon);

      const radius = 1.28 + Math.random() * 0.75;
      const incl = (Math.random() * 70 + 20) * DEG;
      const raan = Math.random() * Math.PI * 2;
      const speed = 0.06 + Math.random() * 0.12;
      const phase = Math.random() * Math.PI * 2;

      const orbitLine = this._makeOrbitLine(radius, incl, raan);
      this.orbits.add(orbitLine);

      g.userData = { radius, incl, raan, speed, phase };
      this.satellites.add(g);

      // Beacon pulse point (for bloom)
      beacon.userData.pulse = Math.random() * 10;
    }

    // Equatorial "constellation shell" ring highlight
    const shellRing = this._makeOrbitLine(1.55, 53 * DEG, 0, 0.6);
    this.orbits.add(shellRing);
  }

  _makeOrbitLine(radius, incl, raan, opacity = 0.28) {
    const pts = [];
    const N = 128;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      v.applyAxisAngle(new THREE.Vector3(1, 0, 0), incl);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), raan);
      pts.push(v);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x3a5bd9, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    return new THREE.Line(geo, mat);
  }

  /* ------------------------- DATA MESH ------------------------------ */
  _initDataMesh() {
    const NODES = 64;
    const positions = new Float32Array(NODES * 3);
    const sizes = new Float32Array(NODES);
    const phases = new Float32Array(NODES);
    const colors = new Float32Array(NODES * 3);
    const cNode = new THREE.Color(0x8fb4ff);
    const cHot = new THREE.Color(0xffffff);

    // Rough continental anchors so the mesh reads as "global coverage"
    const anchors = [
      [40.7, -74.0], [34.0, -118.2], [51.5, -0.1], [48.8, 2.3], [55.7, 37.6],
      [35.6, 139.6], [37.5, 127.0], [31.2, 121.4], [1.3, 103.8], [19.0, 72.8],
      [25.2, 55.3], [30.0, 31.2], [-1.3, 36.8], [-26.2, 28.0], [6.5, 3.4],
      [-33.9, 151.2], [-23.5, -46.6], [19.4, -99.1], [4.7, -74.1], [43.6, -79.4],
    ];
    this.nodeMeta = [];

    for (let i = 0; i < NODES; i++) {
      let lat, lon;
      if (i < anchors.length) {
        lat = anchors[i][0]; lon = anchors[i][1];
      } else {
        lat = Math.asin(Math.random() * 2 - 1) / DEG;
        lon = Math.random() * 360 - 180;
      }
      const v = latLonToVec3(lat, lon, EARTH_RADIUS * 1.004);
      positions[i * 3 + 0] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      sizes[i] = i < anchors.length ? 5.5 : 2.6 + Math.random() * 2.2;
      phases[i] = Math.random();
      const c = i < anchors.length ? cHot : cNode;
      colors[i * 3 + 0] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;

      const region = this._regionFor(lat, lon);
      this.nodeMeta.push({
        name: `NODE-${String(i + 1).padStart(3, "0")}`,
        region,
        load: (30 + Math.random() * 60).toFixed(1),
        latency: (6 + Math.random() * 22).toFixed(1),
        uptime: (99.5 + Math.random() * 0.49).toFixed(2),
        lat, lon,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    this.nodeUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: this.pixelRatio },
      uSizeScale: { value: 1.0 },
    };
    this.nodePoints = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: this.nodeUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.nodePoints.userData.isNodes = true;
    this.earthGroup.add(this.nodePoints);

    this._initArcs();
  }

  _initArcs() {
    this.arcGroup = new THREE.Group();
    this.earthGroup.add(this.arcGroup);
    const arcColor = new THREE.Color(0x8fb4ff);

    const pairs = [];
    for (let i = 0; i < 16; i++) {
      const a = Math.floor(Math.random() * this.nodeMeta.length);
      let b = Math.floor(Math.random() * this.nodeMeta.length);
      if (b === a) b = (b + 7) % this.nodeMeta.length;
      pairs.push([a, b]);
    }

    pairs.forEach(([a, b], idx) => {
      const start = latLonToVec3(this.nodeMeta[a].lat, this.nodeMeta[a].lon, EARTH_RADIUS * 1.005);
      const end = latLonToVec3(this.nodeMeta[b].lat, this.nodeMeta[b].lon, EARTH_RADIUS * 1.005);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const lift = 1 + start.distanceTo(end) * 0.35;
      mid.normalize().multiplyScalar(EARTH_RADIUS * lift);

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const N = 48;
      const pts = curve.getPoints(N);
      const pos = new Float32Array(pts.length * 3);
      const prog = new Float32Array(pts.length);
      pts.forEach((p, i) => {
        pos[i * 3 + 0] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        prog[i] = i / N;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aProgress", new THREE.BufferAttribute(prog, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader: arcVert,
        fragmentShader: arcFrag,
        uniforms: {
          uColor: { value: arcColor },
          uTime: { value: 0 },
          uOpacity: { value: 0.9 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mat.userData.offset = idx * 0.37;
      const line = new THREE.Line(geo, mat);
      this.arcGroup.add(line);
    });
  }

  _regionFor(lat, lon) {
    if (lat > 15 && lon > -30 && lon < 60) return "EMEA / EUROPE";
    if (lat > 15 && lon >= 60 && lon < 180) return "APAC / NORTH";
    if (lat <= 15 && lon >= 60) return "APAC / OCEANIA";
    if (lon < -30 && lat > 15) return "AMER / NORTH";
    if (lon < -30) return "AMER / LATAM";
    if (lat < -10 && lon > -30 && lon < 60) return "AFRICA / SOUTH";
    return "GLOBAL MESH";
  }

  /* ------------------------- POST FX -------------------------------- */
  _initPost() {
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.rtBright = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtBlurA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtBlurB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: brightPassFrag,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.62 } },
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: blurFrag,
      uniforms: { tDiffuse: { value: null }, uDirection: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: compositeFrag,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uBloomStrength: { value: this.quality === "high" ? 0.85 : 0.55 },
        uTime: { value: 0 },
        uVignette: { value: 0.9 },
        uGrain: { value: 0.028 },
      },
      depthTest: false, depthWrite: false,
    });
  }

  _renderPass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.postScene, this.postCam);
  }

  /* ------------------------------------------------------------------ */
  _bindEvents() {
    this._onResize = () => this.resize();
    this._onMove = (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    this._onDown = (e) => this._onPointerDown(e);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("pointermove", this._onMove, { passive: true });
    window.addEventListener("pointerdown", this._onDown);
  }

  _onPointerDown(e) {
    // The canvas is pointer-events:none so page UI stays clickable; ignore
    // events that originate on interactive DOM chrome.
    const t = e.target;
    if (t && t.closest && t.closest("button, a, input, textarea, .panel, .hud-card, .inspector, .access__form")) return;
    if (e.button !== undefined && e.button !== 0) return;

    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.nodePoints, false);
    if (hits.length && hits[0].index != null && hits[0].index < this.nodeMeta.length) {
      this.onNodeSelect(this.nodeMeta[hits[0].index]);
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    const pr = this.pixelRatio;
    this.rtScene.setSize(w * pr, h * pr);
    const halfW = Math.max(1, Math.floor((w * pr) / 2));
    const halfH = Math.max(1, Math.floor((h * pr) / 2));
    this.rtBright.setSize(halfW, halfH);
    this.rtBlurA.setSize(halfW, halfH);
    this.rtBlurB.setSize(halfW, halfH);

    if (this.particleUniforms) this.particleUniforms.uPixelRatio.value = pr;
    if (this.nodeUniforms) this.nodeUniforms.uPixelRatio.value = pr;
  }

  setProgress(t) {
    this.scrollProgress = THREE.MathUtils.clamp(t, 0, 1);
  }

  punchZoom() {
    // Cinematic FOV punch used by "INITIATE SYSTEM"
    if (typeof gsap !== "undefined") {
      gsap.killTweensOf(this);
      gsap.to(this, { fov: 30, duration: 1.1, ease: "power2.in" });
      gsap.to(this, { fov: this.fovBase, duration: 1.6, delay: 1.1, ease: "power3.out" });
    }
  }

  /* ------------------------------------------------------------------ */
  update(dt) {
    this.time += dt;
    const t = this.time;

    // Intro settle
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 2.6);
    }

    // Pointer parallax (damped)
    this.smoothPointer.lerp(this.pointer, 1 - Math.pow(0.001, dt));

    // Sun slowly drifts
    const sd = this.sunDirection;
    const baseAngle = t * 0.015;
    sd.set(Math.cos(baseAngle) * 0.85, 0.18 + Math.sin(t * 0.05) * 0.08, Math.sin(baseAngle) * 0.85).normalize();
    this.sunLight.position.copy(sd).multiplyScalar(6);

    // Planet + cloud rotation
    this.earth.rotation.y += dt * 0.012;
    this.clouds.rotation.y += dt * 0.016;

    // Satellites orbit
    this.satellites.children.forEach((g) => {
      const d = g.userData;
      const a = d.phase + t * d.speed;
      const v = new THREE.Vector3(Math.cos(a) * d.radius, 0, Math.sin(a) * d.radius);
      v.applyAxisAngle(new THREE.Vector3(1, 0, 0), d.incl);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), d.raan);
      g.position.copy(v);
      g.lookAt(0, 0, 0);
      g.rotateY(Math.PI);
    });

    // Camera along the scroll-bound path
    const p = this.scrollProgress;
    const heroDrift = (1 - Math.min(1, p * 6)) * 1;
    const pathPos = this.posCurve.getPointAt(p);
    const pathTgt = this.tgtCurve.getPointAt(p);

    // Hero drift: slow orbital sway before the user engages
    const driftX = Math.sin(t * 0.08) * 0.16 * heroDrift;
    const driftY = Math.cos(t * 0.06) * 0.1 * heroDrift;

    const introPos = this.introPos.clone().lerp(pathPos, this._easeOutCubic(this.introT));
    const introTgt = this.introTarget.clone().lerp(pathTgt, this._easeOutCubic(this.introT));

    this._camPos.copy(introPos);
    this._camPos.x += driftX + this.smoothPointer.x * 0.09;
    this._camPos.y += driftY + this.smoothPointer.y * 0.06;
    this._camTarget.copy(introTgt);

    this.camera.position.copy(this._camPos);
    this._lookAt.lerp(this._camTarget, 1 - Math.pow(0.002, dt));
    this.camera.lookAt(this._lookAt);

    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Uniforms
    this.earthUniforms.uTime.value = t;
    this.earthUniforms.uCameraPos.value.copy(this.camera.position);
    this.atmoUniforms.uCameraPos.value.copy(this.camera.position);
    this.halo.material.uniforms.uCameraPos.value.copy(this.camera.position);
    this.cloudUniforms.uTime.value = t;
    this.cloudUniforms.uCameraPos.value.copy(this.camera.position);
    this.particleUniforms.uTime.value = t;
    this.nodeUniforms.uTime.value = t;
    this.arcGroup.children.forEach((l) => { l.material.uniforms.uTime.value = t + l.material.userData.offset; });
    this.compositeMat.uniforms.uTime.value = t;

    // Arc + node visibility tied to the mesh layer
    const meshReveal = THREE.MathUtils.smoothstep(p, 0.02, 0.18);
    this.arcGroup.visible = meshReveal > 0.01;
    this.arcGroup.children.forEach((l) => { l.material.uniforms.uOpacity.value = 0.9 * meshReveal; });

    this.stars.rotation.y += dt * 0.004;

    this.render();
    this.onFrame({ progress: p, camera: this.camera });
  }

  _easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  render() {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    // Bright pass
    this.brightMat.uniforms.tDiffuse.value = this.rtScene.texture;
    this._renderPass(this.brightMat, this.rtBright);

    // Separable blur (two iterations for a wider glow)
    const halfW = this.rtBlurA.width;
    const halfH = this.rtBlurA.height;
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tDiffuse.value = i === 0 ? this.rtBright.texture : this.rtBlurA.texture;
      this.blurMat.uniforms.uDirection.value.set(1.0 / halfW, 0);
      this._renderPass(this.blurMat, this.rtBlurB);

      this.blurMat.uniforms.tDiffuse.value = this.rtBlurB.texture;
      this.blurMat.uniforms.uDirection.value.set(0, 1.0 / halfH);
      this._renderPass(this.blurMat, this.rtBlurA);
    }

    // Composite to screen
    this.compositeMat.uniforms.tScene.value = this.rtScene.texture;
    this.compositeMat.uniforms.tBloom.value = this.rtBlurA.texture;
    this._renderPass(this.compositeMat, null);
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerdown", this._onDown);
    this.renderer.dispose();
  }
}
