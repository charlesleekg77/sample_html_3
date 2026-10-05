/* =====================================================================
   EDOLUS — Audio Manager (Web Audio API)
   Ambient drone + filtered wind bed, spatial beacon pings, mechanical
   UI feedback, and a master mute toggle unlocked by "INITIATE SYSTEM".
   ===================================================================== */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = true;
    this.master = null;
    this.ambientGain = null;
    this.nodes = [];
    this._windSrc = null;
    this._pingTimer = null;
    this._listeners = new Set();
  }

  onStateChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { this._listeners.forEach((fn) => fn(this.state)); }

  get state() { return { ready: this.ready, muted: this.muted, playing: this.ready && !this.muted }; }

  /* Lazily build the graph on the first user gesture. */
  async init() {
    if (this.ctx) { await this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Gentle bus compression keeps the drone from clipping on blips.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.35;
    comp.connect(this.master);

    this.bus = comp;

    this._buildAmbient();
    this.ready = true;
    this._emit();
  }

  _buildAmbient() {
    const ctx = this.ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.0;
    this.ambientGain.connect(this.bus);

    // --- Drone: stacked detuned oscillators through a slow-moving lowpass
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 320;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(this.ambientGain);

    const chord = [55, 82.41, 110, 164.81]; // A1, E2, A2, E3
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 6;
      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);
      osc.connect(g).connect(droneFilter);
      osc.start();
      this.nodes.push(osc);
    });

    // Slow filter sweep LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(droneFilter.frequency);
    lfo.start();
    this.nodes.push(lfo);

    // --- Wind bed: looping filtered noise
    const noiseBuffer = this._noiseBuffer(6);
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(this.ambientGain);
    wind.start();
    this._windSrc = wind;
    this.nodes.push(wind);

    // Wind movement LFO
    const wLfo = ctx.createOscillator();
    wLfo.frequency.value = 0.07;
    const wLfoGain = ctx.createGain();
    wLfoGain.gain.value = 0.03;
    wLfo.connect(wLfoGain).connect(windGain.gain);
    wLfo.start();
    this.nodes.push(wLfo);
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      data[i] = last * 3.5;
    }
    return buf;
  }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch (_) {}
    }
  }

  /* Called by "INITIATE SYSTEM" — unlocks + fades the ambient bed in. */
  async start() {
    await this.init();
    await this.resume();
    if (!this.ctx) return;
    this.muted = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.9, now + 3.5);
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.7, now + 5);
    this._schedulePings();
    this._emit();
  }

  toggleMute() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    const now = this.ctx.currentTime;
    const target = this.muted ? 0 : 0.9;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.6);
    if (!this.muted) this._schedulePings();
    this._emit();
    return !this.muted;
  }

  /* --------------------------- SFX ---------------------------------- */

  // Mechanical UI tick for hover/click.
  blip(freq = 880, dur = 0.06, gain = 0.14, type = "triangle") {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.bus);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  // Rising whoosh used for the INITIATE transition.
  whoosh(dur = 1.6) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(Math.max(1, dur));
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(160, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.75);
    filter.frequency.exponentialRampToValueAtTime(320, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.4, now + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter).connect(g).connect(this.bus);
    src.start(now);
    src.stop(now + dur);
  }

  // Low confirmation thump.
  thump(freq = 90, dur = 0.5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.bus);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  // Spatial beacon ping that orbits the listener (used during the story).
  _schedulePings() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this.muted || !this.ctx) return;
      this._spatialPing();
    }, 7000);
  }

  _spatialPing() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1320, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    if (pan) {
      pan.pan.value = Math.random() * 2 - 1;
      osc.connect(g).connect(pan).connect(this.bus);
    } else {
      osc.connect(g).connect(this.bus);
    }
    osc.start(now);
    osc.stop(now + 1.2);
  }

  dispose() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this.nodes.forEach((n) => { try { n.stop && n.stop(); } catch (_) {} });
    if (this.ctx) this.ctx.close();
  }
}
