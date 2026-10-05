/* =====================================================================
   EDOLUS — main orchestrator
   Boot sequence, Lenis smooth scroll + GSAP ScrollTrigger choreography,
   WebGL scene lifecycle, HUD widgets, telemetry simulation, node
   inspector, access-request terminal, and the audio manager wiring.
   ===================================================================== */

import * as THREE from "three";
import { EdolusScene } from "./scene.js";
import { AudioManager } from "./audio.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const audio = new AudioManager();
let scene = null;
let lenis = null;

/* ------------------------------------------------------------------ */
/*  BOOT                                                               */
/* ------------------------------------------------------------------ */
function boot() {
  const el = $("#boot");
  const fill = $("#bootFill");
  const pctEl = $("#bootPct");
  const msgEl = $("#bootMsg");
  const messages = [
    [0, "ESTABLISHING UPLINK"],
    [22, "SYNCHRONISING ORBITAL SHELL"],
    [48, "LOADING ATMOSPHERIC SHADERS"],
    [72, "MESHING 1,204 EDGE NODES"],
    [90, "CALIBRATING TELEMETRY"],
    [100, "SYSTEM NOMINAL"],
  ];

  document.body.classList.add("is-locked");

  let p = 0;
  let msgIdx = 0;
  const dur = reduceMotion ? 700 : 2400;
  const t0 = performance.now();

  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    // ease with a couple of holds so it feels like real boot steps
    p = Math.min(100, Math.round(k * 100));
    fill.style.right = (100 - p) + "%";
    pctEl.textContent = String(p).padStart(3, "0");
    while (msgIdx < messages.length - 1 && p >= messages[msgIdx + 1][0]) msgIdx++;
    msgEl.textContent = messages[msgIdx][1];
    if (k < 1) requestAnimationFrame(tick);
    else finishBoot();
  };
  requestAnimationFrame(tick);

  function finishBoot() {
    el.classList.add("is-done");
    document.body.classList.add("is-ready");
    document.body.classList.remove("is-locked");
    if (lenis) lenis.start();
    setTimeout(() => { el.setAttribute("aria-hidden", "true"); }, 1000);
    playHeroIntro();
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
}

/* ------------------------------------------------------------------ */
/*  WEBGL                                                              */
/* ------------------------------------------------------------------ */
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (_) { return false; }
}

function initScene() {
  if (!hasWebGL()) {
    document.body.classList.add("no-webgl");
    return;
  }
  scene = new EdolusScene($("#gl"), {
    quality: window.innerWidth < 900 || reduceMotion ? "low" : "high",
    reducedMotion: reduceMotion,
    onNodeSelect: showInspector,
  });
}

/* ------------------------------------------------------------------ */
/*  SCROLL + GSAP CHOREOGRAPHY                                         */
/* ------------------------------------------------------------------ */
function initScroll() {
  if (window.Lenis) {
    lenis = new Lenis({
      duration: reduceMotion ? 0 : 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: !reduceMotion,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    if (window.ScrollTrigger) {
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  if (!window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  // Master scroll -> camera path progress
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: "top top",
    end: "bottom bottom",
    onUpdate: (self) => {
      if (scene) scene.setProgress(self.progress);
      updateRailFill(self.progress);
      // Hero overlay yields to the orbital story once travel begins, and
      // returns if the visitor scrolls back to the top.
      document.body.classList.toggle("is-engaged", self.progress > 0.035);
    },
  });

  // Section reveals (hero handled separately after boot)
  $$("[data-reveal]").forEach((el) => {
    if (el.closest("#hero")) return;
    ScrollTrigger.create({
      trigger: el,
      start: "top 88%",
      once: true,
      onEnter: () => el.classList.add("is-in"),
    });
  });

  // Rail active state per section
  $$(".section[data-section]").forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => { if (self.isActive) setActiveRail(sec.dataset.section); },
    });
  });

  // Counters
  $$("[data-count]").forEach((el) => animateCounter(el));

  // Meters + gauges
  ScrollTrigger.create({
    trigger: "#compute", start: "top 70%", once: true,
    onEnter: () => {
      const m = $("[data-meter]");
      if (m) { m.style.right = (100 - parseFloat(m.dataset.meter)) + "%"; }
    },
  });
  ScrollTrigger.create({
    trigger: "#telemetry", start: "top 70%", once: true,
    onEnter: () => {
      $$(".gauge").forEach((g) => {
        const v = parseFloat(g.dataset.gauge);
        const fill = $(".g-fill", g);
        fill.style.strokeDashoffset = String(327 * (1 - v / 100));
      });
    },
  });
}

function playHeroIntro() {
  const els = $$("#hero [data-reveal]");
  if (reduceMotion) { els.forEach((e) => e.classList.add("is-in")); return; }
  els.forEach((el, i) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 1.1, ease: "power3.out",
      delay: 0.15 + i * 0.12,
      onStart: () => el.classList.add("is-in"),
    });
  });
  // Rail / HUD fade handled by CSS .is-ready
}

/* ------------------------------------------------------------------ */
/*  HUD HELPERS                                                        */
/* ------------------------------------------------------------------ */
function updateRailFill(p) {
  const fill = $("#railFill");
  if (fill) fill.style.height = (p * 100) + "%";
}
function setActiveRail(id) {
  $$("#railNodes li").forEach((li) => li.classList.toggle("is-active", li.dataset.target === id));
}

function animateCounter(el) {
  const target = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || "0", 10);
  const compact = el.dataset.compact === "1";
  const obj = { v: 0 };
  ScrollTrigger.create({
    trigger: el, start: "top 90%", once: true,
    onEnter: () => {
      gsap.to(obj, {
        v: target, duration: reduceMotion ? 0.01 : 1.8, ease: "power2.out",
        onUpdate: () => { el.textContent = formatNum(obj.v, decimals, compact); },
      });
    },
  });
}

function formatNum(v, decimals, compact) {
  if (compact) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "K";
    return Math.round(v).toString();
  }
  return v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ------------------------------------------------------------------ */
/*  LIVE CLOCKS + TELEMETRY SIMULATION                                 */
/* ------------------------------------------------------------------ */
function initHud() {
  const clockEls = [$("#hudClock"), $("#footerClock")].filter(Boolean);
  const updateClock = () => {
    const d = new Date();
    const s = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
      .map((n) => String(n).padStart(2, "0")).join(":");
    clockEls.forEach((el) => (el.textContent = s + " UTC"));
  };
  updateClock();
  setInterval(updateClock, 1000);

  // Orbital coordinates drift (hero readout)
  const latEl = $("#heroLat"), lonEl = $("#heroLon");
  if (latEl && lonEl) {
    let lat = 12.4, lon = -38.2;
    setInterval(() => {
      lat = ((lat + (Math.random() - 0.5) * 0.6 + 90) % 180) - 90;
      lon = ((lon + 0.42 + 540) % 360) - 180;
      latEl.textContent = lat.toFixed(3).padStart(7, "0");
      lonEl.textContent = lon.toFixed(3).padStart(7, "0");
    }, 1200);
  }

  // Node count jitter
  const nodesEl = $("#hudNodes");
  const lat2 = $("#hudLat");
  setInterval(() => {
    if (nodesEl) nodesEl.textContent = (1200 + Math.floor(Math.random() * 8)).toLocaleString();
    if (lat2) lat2.textContent = (11.8 + Math.random() * 1.4).toFixed(1);
  }, 2600);

  initSparkline();
}

function initSparkline() {
  const cv = $("#spark");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const history = new Array(120).fill(0).map(() => 40 + Math.random() * 20);
  let tput = 0;

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = "rgba(244,246,251,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (H / 4) * i + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // area + line
    const max = 100;
    const step = W / (history.length - 1);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(91,140,255,0.35)");
    grad.addColorStop(1, "rgba(91,140,255,0)");
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = i * step;
      const y = H - (v / max) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    history.forEach((v, i) => {
      const x = i * step;
      const y = H - (v / max) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#8fb4ff";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(91,140,255,0.9)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  setInterval(() => {
    tput = 38 + Math.sin(performance.now() * 0.0004) * 22 + Math.random() * 18;
    history.push(tput); history.shift();
    const el = $("#tputVal");
    if (el) el.textContent = tput.toFixed(1);
    const loss = $("#lossVal");
    if (loss) loss.textContent = (0.01 + Math.random() * 0.04).toFixed(2);
    draw();
  }, 400);

  // gauges drift
  setInterval(() => {
    $$(".gauge").forEach((g) => {
      const base = parseFloat(g.dataset.gauge);
      const v = Math.max(40, Math.min(99, base + (Math.random() - 0.5) * 6));
      const fill = $(".g-fill", g);
      const val = $("[data-gauge-val]", g);
      if (fill) fill.style.strokeDashoffset = String(327 * (1 - v / 100));
      if (val) val.textContent = Math.round(v);
    });
    const m = $("[data-meter-val]");
    if (m) {
      const v = Math.round(68 + Math.random() * 12);
      m.textContent = v + "%";
      const bar = $("[data-meter]");
      if (bar) bar.style.right = (100 - v) + "%";
    }
  }, 3000);

  draw();
}

/* ------------------------------------------------------------------ */
/*  NODE INSPECTOR                                                     */
/* ------------------------------------------------------------------ */
function showInspector(node) {
  const box = $("#inspector");
  if (!box) return;
  $("#inspNodeTag").textContent = "NODE // " + node.name.split("-")[1];
  $("#inspNodeName").textContent = node.name;
  $("#inspRegion").textContent = node.region;
  $("#inspLoad").textContent = node.load + " %";
  $("#inspLatency").textContent = node.latency + " ms";
  $("#inspUptime").textContent = node.uptime + " %";
  box.hidden = false;
  audio.blip(1200, 0.05, 0.1);
  toast(`UPLINK ${node.name} — ${node.region}`);
}

function initInspector() {
  const close = $("#inspectorClose");
  if (close) close.addEventListener("click", () => { $("#inspector").hidden = true; audio.blip(500, 0.05, 0.08); });
}

/* ------------------------------------------------------------------ */
/*  TOAST                                                              */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 3200);
}

/* ------------------------------------------------------------------ */
/*  AUDIO CONTROLS                                                     */
/* ------------------------------------------------------------------ */
function initAudioControls() {
  const fab = $("#audioFab");
  const fabLabel = $("#audioFabLabel");
  const top = $("#audioToggleTop");

  const sync = () => {
    const st = audio.state;
    if (fab) {
      fab.classList.toggle("is-muted", st.muted);
      if (fabLabel) fabLabel.textContent = st.muted ? "SOUND OFF" : "SOUND ON";
    }
    if (top) top.classList.toggle("is-muted", st.muted);
  };
  audio.onStateChange(sync);
  sync();

  const toggle = async () => {
    if (!audio.ready) { await audio.start(); }
    else audio.toggleMute();
    sync();
  };
  if (fab) fab.addEventListener("click", toggle);
  if (top) top.addEventListener("click", toggle);

  // Mechanical hover feedback on interactive chrome
  $$(".btn-cta, .rail__nodes li, .hud-card").forEach((el) => {
    el.addEventListener("pointerenter", () => audio.blip(1500, 0.035, 0.05, "sine"));
  });
}

/* ------------------------------------------------------------------ */
/*  INITIATE SYSTEM                                                    */
/* ------------------------------------------------------------------ */
function initInitiate() {
  const btn = $("#initiateBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    audio.whoosh(1.8);
    await audio.start();
    $("#audioFab").hidden = false;

    if (scene) scene.punchZoom();

    // Fade the hero content and travel to the first orbit layer
    gsap.to("#hero .hero__content", { opacity: 0, y: -30, duration: 0.9, ease: "power2.in" });
    gsap.to(".hero__coords", { opacity: 0, duration: 0.6 });

    setTimeout(() => {
      if (lenis) lenis.scrollTo("#mesh", { duration: reduceMotion ? 0 : 2.4 });
      else $("#mesh").scrollIntoView({ behavior: "smooth" });
    }, 650);

    toast("SYSTEM INITIATED — AMBIENT SPATIAL AUDIO ONLINE");
    audio.thump(70, 0.8);
  });
}

/* ------------------------------------------------------------------ */
/*  ACCESS FORM                                                        */
/* ------------------------------------------------------------------ */
function initAccessForm() {
  const form = $("#accessForm");
  if (!form) return;
  const status = $("#accessStatus");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const org = $("#fOrg").value.trim();
    const mail = $("#fMail").value.trim();
    const validMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);

    if (!org || !validMail) {
      status.textContent = "TRANSMISSION REJECTED — ORGANISATION AND VALID SECURE EMAIL REQUIRED.";
      status.classList.add("err");
      audio.blip(320, 0.12, 0.12, "sawtooth");
      return;
    }
    status.classList.remove("err");
    status.textContent = "TRANSMITTING…";
    audio.thump(120, 0.5);

    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 22;
      status.textContent = `TRANSMITTING… ${Math.min(100, Math.round(p))}%`;
      if (p >= 100) {
        clearInterval(iv);
        status.textContent = "REQUEST RECEIVED — ORBITAL OPS WILL RESPOND WITHIN ONE ORBITAL PERIOD.";
        toast("ACCESS REQUEST TRANSMITTED");
        audio.blip(1400, 0.09, 0.12);
        form.reset();
      }
    }, 220);
  });
}

/* ------------------------------------------------------------------ */
/*  RAIL NAV                                                           */
/* ------------------------------------------------------------------ */
function initRailNav() {
  $$("#railNodes li").forEach((li) => {
    li.addEventListener("click", () => {
      const id = "#" + li.dataset.target;
      audio.blip(900, 0.05, 0.08);
      if (lenis) lenis.scrollTo(id, { duration: 1.4 });
      else $(id) && $(id).scrollIntoView({ behavior: "smooth" });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  RAF LOOP for the 3D scene                                          */
/* ------------------------------------------------------------------ */
function startLoop() {
  if (!scene) return;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    scene.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/*  BOOTSTRAP                                                          */
/* ------------------------------------------------------------------ */
function main() {
  if (reduceMotion) document.body.classList.add("reduce-motion");
  initScene();
  initScroll();
  initHud();
  initInspector();
  initAudioControls();
  initInitiate();
  initAccessForm();
  initRailNav();
  startLoop();
  boot();

  // Keep ScrollTrigger honest once fonts/textures settle
  window.addEventListener("load", () => { if (window.ScrollTrigger) ScrollTrigger.refresh(); });

  if (location.search.includes("debug")) {
    window.__EDOLUS__ = { get scene() { return scene; }, audio, get lenis() { return lenis; } };
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
