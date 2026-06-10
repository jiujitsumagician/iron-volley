// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/** @typedef {{ pan?: number, gain?: number }} AudioOpts */
/** @typedef {{ setIntensity(v: number): void, setPan(p: number): void, stop(): void }} EngineHandle */

const EPS = 0.0001;

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let masterGain = null;
/** @type {DynamicsCompressorNode | null} */
let compressor = null;
/** @type {GainNode | null} */
let musicGain = null;
/** @type {GainNode | null} */
let musicBus = null;
/** @type {AudioBuffer | null} */
let noiseBuffer = null;
let enabled = true;
let volume = 0.8;
let musicVolume = 0.35;
let gestureAttached = false;
/** @type {ReturnType<typeof createMusicState> | null} */
let music = null;

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function updateMasterGain() {
  if (!masterGain || !ctx) return;
  masterGain.gain.cancelScheduledValues(ctx.currentTime);
  masterGain.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.02);
}

function attachResumeGesture() {
  if (gestureAttached || typeof window === "undefined") return;
  gestureAttached = true;
  const resume = () => {
    if (ctx && ctx.state !== "closed") void ctx.resume();
  };
  window.addEventListener("pointerdown", resume, { once: true, passive: true });
  window.addEventListener("keydown", resume, { once: true, passive: true });
}

function makeNoiseBuffer(ac) {
  const length = ac.sampleRate * 2;
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtor) return null;
  ctx = new AudioCtor();
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -15;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  masterGain = ctx.createGain();
  musicGain = ctx.createGain();
  musicGain.gain.value = musicVolume;
  compressor.connect(masterGain);
  masterGain.connect(ctx.destination);
  musicGain.connect(compressor);
  noiseBuffer = makeNoiseBuffer(ctx);
  updateMasterGain();
  attachResumeGesture();
  return ctx;
}

function usable() {
  return ctx && compressor && masterGain && noiseBuffer && ctx.state !== "closed";
}

function voice(opts, gain = 1) {
  if (!usable()) return null;
  const ac = /** @type {AudioContext} */ (ctx);
  const out = ac.createGain();
  out.gain.value = clamp(opts?.gain ?? 1) * gain;
  let input = out;
  if (opts && Number.isFinite(opts.pan)) {
    const pan = ac.createStereoPanner();
    pan.pan.value = clamp(/** @type {number} */ (opts.pan), -1, 1);
    out.connect(pan);
    pan.connect(/** @type {DynamicsCompressorNode} */ (compressor));
  } else {
    out.connect(/** @type {DynamicsCompressorNode} */ (compressor));
  }
  return { ac, input, out };
}

function cleanup(node, t) {
  if (!ctx) return;
  globalThis.setTimeout(() => {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }, Math.max(20, (t - ctx.currentTime + 0.1) * 1000));
}

function env(param, t, points) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(Math.max(EPS, points[0][1]), t + points[0][0]);
  for (let i = 1; i < points.length; i += 1) {
    param.exponentialRampToValueAtTime(Math.max(EPS, points[i][1]), t + points[i][0]);
  }
}

function noiseSource(ac, loop = false) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = loop;
  return src;
}

function osc(ac, type, freq, detune = 0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

function filteredNoise(ac, type, freq, q = 0.8) {
  const src = noiseSource(ac);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter);
  return { src, filter };
}

function thump(freqA, freqB, dur, gain, opts) {
  const v = voice(opts, gain);
  if (!v) return;
  const t = v.ac.currentTime;
  const o = osc(v.ac, "sine", freqA);
  const g = v.ac.createGain();
  o.frequency.exponentialRampToValueAtTime(freqB, t + dur);
  env(g.gain, t, [[0, 1], [0.03, 0.8], [dur, EPS]]);
  o.connect(g).connect(v.input);
  o.start(t);
  o.stop(t + dur + 0.03);
  cleanup(v.out, t + dur + 0.1);
}

function cannon(opts) {
  const v = voice(opts, 1);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const sub = osc(ac, "sine", 80);
  const subG = ac.createGain();
  sub.frequency.exponentialRampToValueAtTime(20, t + 0.1);
  sub.frequency.setValueAtTime(20, t + 0.1);
  env(subG.gain, t, [[0, 1.4], [0.04, 1.1], [0.5, 0.4], [1.8, EPS]]);
  sub.connect(subG).connect(v.input);
  const body = osc(ac, "sine", 140);
  const bodyG = ac.createGain();
  body.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  env(bodyG.gain, t, [[0, 0.9], [0.05, 0.7], [0.45, EPS]]);
  body.connect(bodyG).connect(v.input);
  const crack = filteredNoise(ac, "bandpass", 3200, 3.5);
  const crackG = ac.createGain();
  env(crackG.gain, t, [[0, 0.9], [0.002, 0.5], [0.012, EPS]]);
  crack.filter.connect(crackG).connect(v.input);
  const rumble = filteredNoise(ac, "lowpass", 900, 0.6);
  const rumbleG = ac.createGain();
  env(rumbleG.gain, t, [[0, 0.55], [0.08, 0.8], [0.6, 0.4], [1.9, EPS]]);
  rumble.filter.frequency.exponentialRampToValueAtTime(90, t + 1.9);
  rumble.filter.connect(rumbleG).connect(v.input);
  const bite = filteredNoise(ac, "bandpass", 420, 1.4);
  const biteG = ac.createGain();
  env(biteG.gain, t, [[0, 0.6], [0.05, 0.3], [0.28, EPS]]);
  bite.filter.connect(biteG).connect(v.input);
  sub.start(t); sub.stop(t + 1.9);
  body.start(t); body.stop(t + 0.5);
  crack.src.start(t); crack.src.stop(t + 0.02);
  rumble.src.start(t); rumble.src.stop(t + 2.0);
  bite.src.start(t); bite.src.stop(t + 0.32);
  cleanup(v.out, t + 2.1);
}

function mg(opts) {
  const v = voice(opts, 0.72);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const thmpOsc = osc(ac, "sine", 95);
  const thmpG = ac.createGain();
  thmpOsc.frequency.exponentialRampToValueAtTime(38, t + 0.055);
  env(thmpG.gain, t, [[0, 0.55], [0.012, 0.3], [0.06, EPS]]);
  thmpOsc.connect(thmpG).connect(v.input);
  const n = filteredNoise(ac, "bandpass", 1600 + Math.random() * 800, 2.2);
  const g = ac.createGain();
  env(g.gain, t, [[0, 0.6], [0.01, 0.28], [0.07, EPS]]);
  n.filter.connect(g).connect(v.input);
  thmpOsc.start(t); thmpOsc.stop(t + 0.07);
  n.src.start(t); n.src.stop(t + 0.09);
  cleanup(v.out, t + 0.12);
}

function laser(opts) {
  const v = voice(opts, 0.85);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const main = osc(ac, "sawtooth", 2100);
  const g = ac.createGain();
  const f = ac.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 2800;
  f.Q.value = 6;
  main.frequency.exponentialRampToValueAtTime(210, t + 0.48);
  env(g.gain, t, [[0, 0.5], [0.05, 0.9], [0.5, EPS]]);
  main.connect(f).connect(g).connect(v.input);
  for (let i = 0; i < 3; i += 1) {
    const s = osc(ac, "triangle", 2400 + i * 410, i * 9);
    const sg = ac.createGain();
    env(sg.gain, t, [[0.02, 0.08], [0.45, EPS]]);
    s.connect(sg).connect(v.input);
    s.start(t); s.stop(t + 0.5);
  }
  main.start(t); main.stop(t + 0.54);
  cleanup(v.out, t + 0.62);
}

function explosion(size = 0.5, opts) {
  const s = clamp(size);
  const v = voice(opts, 0.85 + s * 0.5);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const dur = 0.45 + s * 1.4;
  const sub = osc(ac, "sine", 78 - s * 20);
  const subG = ac.createGain();
  sub.frequency.exponentialRampToValueAtTime(22 - s * 6, t + dur * 0.5);
  env(subG.gain, t, [[0, 0.6 + s * 0.9], [0.07, 1.1 + s * 0.3], [dur * 0.75, EPS]]);
  sub.connect(subG).connect(v.input);
  const n = filteredNoise(ac, "lowpass", 2200 - s * 600, 0.5);
  const ng = ac.createGain();
  env(ng.gain, t, [[0, 1.0], [0.06, 0.8], [dur, EPS]]);
  n.filter.frequency.exponentialRampToValueAtTime(110 + s * 90, t + dur);
  n.filter.connect(ng).connect(v.input);
  const crunch = filteredNoise(ac, "bandpass", 100 + s * 140, 4.5);
  const cg = ac.createGain();
  env(cg.gain, t, [[0, EPS], [0.005, 0.7 + s * 0.3], [0.22 + s * 0.14, EPS]]);
  crunch.filter.connect(cg).connect(v.input);
  sub.start(t); sub.stop(t + dur + 0.05);
  n.src.start(t); n.src.stop(t + dur + 0.06);
  crunch.src.start(t); crunch.src.stop(t + dur * 0.4);
  cleanup(v.out, t + dur + 0.14);
}

function nuke(opts) {
  const v = voice(opts, 1.15);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const swell = osc(ac, "sine", 34);
  const sg = ac.createGain();
  swell.frequency.exponentialRampToValueAtTime(24, t + 2.2);
  env(sg.gain, t, [[0, EPS], [0.45, 0.75], [2.9, EPS]]);
  swell.connect(sg).connect(v.input);

  const roar = filteredNoise(ac, "lowpass", 4200, 0.35);
  const rg = ac.createGain();
  env(rg.gain, t, [[0.12, EPS], [0.55, 1], [2.9, EPS]]);
  roar.filter.frequency.exponentialRampToValueAtTime(260, t + 2.8);
  roar.filter.connect(rg).connect(v.input);

  const rumble = osc(ac, "sawtooth", 44, -8);
  const rumbleF = ac.createBiquadFilter();
  const rumbleG = ac.createGain();
  rumbleF.type = "lowpass";
  rumbleF.frequency.value = 90;
  env(rumbleG.gain, t, [[1.2, EPS], [1.7, 0.35], [3.8, EPS]]);
  rumble.connect(rumbleF).connect(rumbleG).connect(v.input);

  swell.start(t); swell.stop(t + 3.05);
  roar.src.start(t); roar.src.stop(t + 3.05);
  rumble.start(t); rumble.stop(t + 3.9);
  cleanup(v.out, t + 4.05);
}

function fire(opts) {
  const v = voice(opts, 0.75);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const n = filteredNoise(ac, "bandpass", 360, 0.9);
  const g = ac.createGain();
  n.filter.frequency.exponentialRampToValueAtTime(1700, t + 0.58);
  env(g.gain, t, [[0, EPS], [0.08, 0.8], [0.68, EPS]]);
  n.filter.connect(g).connect(v.input);
  n.src.start(t); n.src.stop(t + 0.74);
  cleanup(v.out, t + 0.82);
}

function ricochet(opts) {
  const v = voice(opts, 0.7);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const base = 1200 + Math.random() * 1800;
  const o = osc(ac, "sine", base);
  const m = osc(ac, "sine", base * 2.71);
  const mgain = ac.createGain();
  const g = ac.createGain();
  mgain.gain.value = 180;
  m.connect(mgain).connect(o.frequency);
  o.frequency.exponentialRampToValueAtTime(base * 0.58, t + 0.2);
  env(g.gain, t, [[0, 0.65], [0.025, 0.9], [0.22, EPS]]);
  o.connect(g).connect(v.input);
  m.start(t); o.start(t);
  m.stop(t + 0.24); o.stop(t + 0.24);
  cleanup(v.out, t + 0.32);
}

function hit(opts) {
  const v = voice(opts, 0.85);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const carrier = osc(ac, "triangle", 190);
  const mod = osc(ac, "square", 580);
  const modG = ac.createGain();
  const g = ac.createGain();
  modG.gain.value = 260;
  mod.connect(modG).connect(carrier.frequency);
  env(g.gain, t, [[0, 0.95], [0.035, 0.46], [0.25, EPS]]);
  carrier.connect(g).connect(v.input);
  mod.start(t); carrier.start(t);
  mod.stop(t + 0.28); carrier.stop(t + 0.28);
  cleanup(v.out, t + 0.35);
}

function pickup(opts) {
  const notes = [76, 80, 83];
  const v = voice(opts, 0.55);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  notes.forEach((note, i) => {
    const start = t + i * 0.11;
    const o = osc(ac, "triangle", midi(note));
    const g = ac.createGain();
    env(g.gain, start, [[0, EPS], [0.018, 0.8], [0.16, EPS]]);
    o.connect(g).connect(v.input);
    o.start(start); o.stop(start + 0.18);
  });
  cleanup(v.out, t + 0.48);
}

function reload(opts) {
  const v = voice(opts, 0.75);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  [0, 0.16].forEach((off, i) => {
    const n = filteredNoise(ac, "bandpass", i ? 380 : 520, 3.2);
    const g = ac.createGain();
    env(g.gain, t + off, [[0, 0.75], [0.035, EPS]]);
    n.filter.connect(g).connect(v.input);
    n.src.start(t + off); n.src.stop(t + off + 0.06);
  });
  cleanup(v.out, t + 0.38);
}

function death(opts) {
  explosion(1.0, opts);
  const v = voice(opts, 0.7);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const subDet = osc(ac, "sine", 55);
  const subDetG = ac.createGain();
  subDet.frequency.exponentialRampToValueAtTime(16, t + 0.25);
  env(subDetG.gain, t, [[0, 1.2], [0.06, 0.9], [0.8, EPS]]);
  subDet.connect(subDetG).connect(v.input);
  const crack = filteredNoise(ac, "bandpass", 2800, 4.0);
  const crackG = ac.createGain();
  env(crackG.gain, t, [[0, 1.0], [0.003, 0.5], [0.018, EPS]]);
  crack.filter.connect(crackG).connect(v.input);
  const debris = filteredNoise(ac, "bandpass", 900, 2.0);
  const debrisG = ac.createGain();
  env(debrisG.gain, t, [[0.05, 0.55], [0.35, 0.65], [1.6, EPS]]);
  debris.filter.frequency.exponentialRampToValueAtTime(140, t + 1.6);
  debris.filter.connect(debrisG).connect(v.input);
  [-8, 11].forEach((detune) => {
    const o = osc(ac, "sawtooth", 100, detune);
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    f.type = "lowpass";
    f.frequency.value = 320;
    o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    env(g.gain, t, [[0, 0.3], [1.4, EPS]]);
    o.connect(f).connect(g).connect(v.input);
    o.start(t); o.stop(t + 1.5);
  });
  subDet.start(t); subDet.stop(t + 0.9);
  crack.src.start(t); crack.src.stop(t + 0.025);
  debris.src.start(t); debris.src.stop(t + 1.7);
  cleanup(v.out, t + 1.8);
}

function uiMove(opts) {
  thump(620, 460, 0.06, 0.22, opts);
}

function uiSelect(opts) {
  const v = voice(opts, 0.28);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  [760, 1160].forEach((f, i) => {
    const st = t + i * 0.07;
    const o = osc(ac, "triangle", f);
    const g = ac.createGain();
    env(g.gain, st, [[0, EPS], [0.015, 0.85], [0.09, EPS]]);
    o.connect(g).connect(v.input);
    o.start(st); o.stop(st + 0.11);
  });
  cleanup(v.out, t + 0.22);
}

function countdown(opts) {
  thump(800, 800, 0.1, 0.32, opts);
}

function go(opts) {
  thump(1300, 1300, 0.25, 0.38, opts);
}

function victory(opts) {
  const v = voice(opts, 0.5);
  if (!v) return;
  const ac = v.ac;
  const t = ac.currentTime;
  const notes = [60, 64, 67, 72];
  notes.forEach((note, i) => {
    const st = t + i * 0.23;
    ["square", "sawtooth"].forEach((type, j) => {
      const o = osc(ac, type, midi(note), j ? 7 : -5);
      const g = ac.createGain();
      env(g.gain, st, [[0, EPS], [0.025, j ? 0.34 : 0.5], [0.28, EPS]]);
      o.connect(g).connect(v.input);
      o.start(st); o.stop(st + 0.32);
    });
  });
  cleanup(v.out, t + 1.24);
}

function engineStart() {
  if (!usable()) {
    return { setIntensity() {}, setPan() {}, stop() {} };
  }
  const ac = ctx;
  const t = ac.currentTime;
  const out = ac.createGain();
  const pan = ac.createStereoPanner();
  out.connect(pan);
  pan.connect(compressor);
  out.gain.value = 0.15;
  const rumbleOsc = osc(ac, "sine", 32);
  const chugLfo = osc(ac, "sine", 7.5);
  const chugLfoG = ac.createGain();
  chugLfoG.gain.value = 0.25;
  const chugBias = ac.createConstantSource();
  chugBias.offset.value = 0.5;
  const chugMod = ac.createGain();
  chugMod.gain.value = 1;
  chugBias.connect(chugMod);
  chugLfo.connect(chugLfoG).connect(chugMod);
  const chugDepth = ac.createGain();
  chugDepth.gain.value = 0;
  chugMod.connect(chugDepth.gain);
  rumbleOsc.connect(chugDepth).connect(out);
  const buzzOsc = osc(ac, "sawtooth", 85);
  const buzzF = ac.createBiquadFilter();
  const buzzG = ac.createGain();
  buzzF.type = "lowpass";
  buzzF.frequency.value = 280;
  buzzF.Q.value = 1.2;
  buzzG.gain.value = 0.12;
  buzzOsc.connect(buzzF).connect(buzzG).connect(out);
  const treadNoise = noiseSource(ac, true);
  const treadBP = ac.createBiquadFilter();
  treadBP.type = "bandpass";
  treadBP.frequency.value = 1100;
  treadBP.Q.value = 3.5;
  const treadG = ac.createGain();
  treadG.gain.value = 0.0;
  const treadLfo = osc(ac, "square", 3.5);
  const treadLfoG = ac.createGain();
  treadLfoG.gain.value = 0.5;
  const treadBias = ac.createConstantSource();
  treadBias.offset.value = 0.5;
  const treadMod = ac.createGain();
  treadMod.gain.value = 1;
  treadBias.connect(treadMod);
  treadLfo.connect(treadLfoG).connect(treadMod);
  const treadGateG = ac.createGain();
  treadGateG.gain.value = 0;
  treadMod.connect(treadGateG.gain);
  treadNoise.connect(treadBP).connect(treadGateG).connect(treadG).connect(out);
  rumbleOsc.start(t);
  chugLfo.start(t);
  chugBias.start(t);
  buzzOsc.start(t);
  treadNoise.start(t);
  treadLfo.start(t);
  treadBias.start(t);
  let stopped = false;
  const handle = {
    setIntensity(v) {
      if (stopped) return;
      const x = clamp(v);
      const at = ac.currentTime;
      const tc = 0.12;
      rumbleOsc.frequency.setTargetAtTime(28 + x * 14, at, tc);
      chugLfo.frequency.setTargetAtTime(6 + x * 4, at, tc);
      buzzOsc.frequency.setTargetAtTime(75 + x * 40, at, tc);
      buzzF.frequency.setTargetAtTime(200 + x * 400, at, tc);
      buzzG.gain.setTargetAtTime(0.08 + x * 0.14, at, tc);
      treadLfo.frequency.setTargetAtTime(2.5 + x * 11.5, at, tc);
      treadBP.frequency.setTargetAtTime(900 + x * 800, at, tc);
      treadBP.Q.value = 2.5 + x * 3;
      treadG.gain.setTargetAtTime(x * x * 0.18, at, tc);
      out.gain.setTargetAtTime(0.14 + x * 0.18, at, tc);
    },
    setPan(p) {
      if (stopped) return;
      pan.pan.setTargetAtTime(clamp(p, -1, 1), ac.currentTime, 0.04);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const at = ac.currentTime;
      out.gain.setTargetAtTime(EPS, at, 0.06);
      const stopAt = at + 0.28;
      rumbleOsc.stop(stopAt);
      chugLfo.stop(stopAt);
      chugBias.stop(stopAt);
      buzzOsc.stop(stopAt);
      treadNoise.stop(stopAt);
      treadLfo.stop(stopAt);
      treadBias.stop(stopAt);
      cleanup(out, stopAt);
    },
  };
  handle.setIntensity(0);
  return handle;
}

function createMusicState() {
  return {
    track: "",
    timer: 0,
    nextTime: 0,
    step: 0,
    root: 45,
    nodes: /** @type {AudioNode[]} */ ([]),
  };
}

function musicVoice(gain = 1) {
  if (!usable() || !musicBus) return null;
  const ac = /** @type {AudioContext} */ (ctx);
  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(musicBus);
  return { ac, out };
}

function scheduleKick(ac, t, out) {
  const o = osc(ac, "sine", 115);
  const g = ac.createGain();
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  env(g.gain, t, [[0, 0.75], [0.12, EPS]]);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.14);
}

function scheduleBass(ac, t, out, freq) {
  const o = osc(ac, "sawtooth", freq);
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  f.type = "lowpass";
  f.frequency.value = 620;
  f.Q.value = 1.4;
  env(g.gain, t, [[0, EPS], [0.01, 0.24], [0.105, EPS]]);
  o.connect(f).connect(g).connect(out);
  o.start(t); o.stop(t + 0.12);
}

function scheduleLead(ac, t, out, freq) {
  const o = osc(ac, "square", freq, -6);
  const g = ac.createGain();
  env(g.gain, t, [[0, EPS], [0.02, 0.16], [0.22, EPS]]);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.25);
}

function schedulePad(ac, t, out, freqs, dur) {
  freqs.forEach((f, i) => {
    const o = osc(ac, i % 2 ? "triangle" : "sawtooth", f, i * 5 - 8);
    const filt = ac.createBiquadFilter();
    const g = ac.createGain();
    filt.type = "lowpass";
    filt.frequency.value = 540;
    env(g.gain, t, [[0, EPS], [0.25, 0.12], [dur - 0.1, 0.1], [dur, EPS]]);
    o.connect(filt).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.03);
  });
}

function scheduleMusic() {
  if (!music || !usable()) return;
  const ac = /** @type {AudioContext} */ (ctx);
  const horizon = ac.currentTime + 0.2;
  const mv = musicVoice(1);
  if (!mv) return;
  const out = mv.out;
  cleanup(out, horizon + 5);

  if (music.track === "battle") {
    const stepDur = 60 / 128 / 4;
    const bassPattern = [0, 0, 7, 0, 3, 0, 10, 7, 0, 0, 12, 10, 7, 3, 5, 7];
    while (music.nextTime < horizon) {
      const st = music.step % 16;
      if (st % 4 === 0) scheduleKick(ac, music.nextTime, out);
      scheduleBass(ac, music.nextTime, out, midi(music.root + bassPattern[st]));
      if (st === 6 || st === 14) scheduleLead(ac, music.nextTime, out, midi(music.root + 24 + bassPattern[st]));
      music.nextTime += stepDur;
      music.step += 1;
    }
  } else {
    const beat = 60 / 70;
    const chords = [[0, 3, 7, 10], [-2, 2, 5, 9], [-5, -2, 2, 7], [-7, -3, 0, 5]];
    while (music.nextTime < horizon) {
      const chord = chords[music.step % chords.length].map((n) => midi(40 + n));
      schedulePad(ac, music.nextTime, out, chord, beat * 4);
      music.nextTime += beat * 4;
      music.step += 1;
    }
  }
}

function musicStart(trackName = "battle") {
  if (!usable()) return;
  musicStop(0);
  const ac = /** @type {AudioContext} */ (ctx);
  musicBus = ac.createGain();
  musicBus.gain.value = 1;
  musicBus.connect(/** @type {GainNode} */ (musicGain));
  music = createMusicState();
  music.track = trackName === "menu" ? "menu" : "battle";
  music.nextTime = ac.currentTime + 0.03;
  music.step = 0;
  music.timer = globalThis.setInterval(scheduleMusic, 100);
  scheduleMusic();
}

function musicStop(fade = 0.5) {
  if (music) {
    globalThis.clearInterval(music.timer);
    music = null;
  }
  if (!musicBus || !ctx) return;
  const t = ctx.currentTime;
  const bus = musicBus;
  musicBus = null;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0, t + fade);
  globalThis.setTimeout(() => {
    try {
      bus.disconnect();
    } catch {
      // Already disconnected.
    }
  }, Math.max(0, fade * 1000 + 20));
}

export const audio = {
  init() {
    const ac = ensureContext();
    if (ac && ac.state === "suspended") attachResumeGesture();
  },
  setEnabled(on) {
    enabled = Boolean(on);
    updateMasterGain();
  },
  setVolume(v) {
    volume = clamp(v);
    updateMasterGain();
  },
  cannon,
  mg,
  laser,
  explosion,
  nuke,
  fire,
  ricochet,
  hit,
  pickup,
  reload,
  death,
  uiMove,
  uiSelect,
  countdown,
  go,
  victory,
  engineStart,
  musicStart,
  musicStop,
  setMusicVolume(v) {
    musicVolume = clamp(v);
    if (musicGain && ctx) musicGain.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.03);
  },
};
