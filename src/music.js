// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Sample-based music player. Plays the downloaded CC0 tracks via
 * HTMLAudioElement, loops them, and crossfades (~1s) between tracks at the
 * stored music volume. Entirely fail-safe: a missing or unloadable file
 * leaves the game silent with no thrown error — the caller (audio.js) falls
 * back to its procedural music in that case.
 *
 * Only methods this module owns touch <audio> elements; it never reaches into
 * the WebAudio graph, so it can't disturb gameplay SFX.
 */

const BASE = new URL("../assets/music/", import.meta.url).href;

// Track lists. The 'battle' kind picks one at random each match.
const TRACKS = {
  menu: ["menu_01.ogg", "menu_02.ogg"],
  battle: ["battle_01.mp3", "battle_02.ogg", "battle_03.mp3", "battle_04.ogg"],
};

const FADE_MS = 1000;
const STEP_MS = 50;

let volume = 0.35; // 0..1, mirrors the stored music volume
let enabled = true;
let current = null; // { kind, audio, fade, target }
let fadeTimer = 0;

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

function canPlay() {
  return typeof Audio !== "undefined";
}

function pickTrack(kind) {
  const list = TRACKS[kind] || TRACKS.battle;
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function makeAudio(file) {
  try {
    const a = new Audio(BASE + file);
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    // Swallow load/play errors so a missing file is silent, not fatal.
    a.addEventListener("error", () => stopElement(a), { once: true });
    return a;
  } catch {
    return null;
  }
}

function stopElement(a) {
  if (!a) return;
  try {
    a.pause();
    a.src = "";
    a.load?.();
  } catch {
    // already torn down
  }
}

function clearTimer() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = 0;
  }
}

/**
 * Drives all volume ramps each tick: the incoming track rises toward
 * `volume`, any outgoing track falls to 0 and is then discarded.
 */
function tick(outgoing) {
  const dv = STEP_MS / FADE_MS;
  let done = true;
  if (current?.audio) {
    const tgt = enabled ? volume : 0;
    const cur = current.audio.volume;
    if (Math.abs(cur - tgt) > 0.001) {
      current.audio.volume = clamp(cur + Math.sign(tgt - cur) * dv);
      done = false;
    } else {
      current.audio.volume = tgt;
    }
  }
  for (let i = outgoing.length - 1; i >= 0; i -= 1) {
    const a = outgoing[i];
    const nv = clamp(a.volume - dv);
    a.volume = nv;
    if (nv <= 0.001) {
      stopElement(a);
      outgoing.splice(i, 1);
    } else {
      done = false;
    }
  }
  if (done && !outgoing.length) clearTimer();
}

export const sampleMusic = {
  /** True only when a sample track is actually loaded and playing. */
  active() {
    return !!current?.audio;
  },

  /**
   * Start a kind of music ('menu' | 'battle'), crossfading from whatever was
   * playing. Returns true if a sample element was created and started, false
   * if samples are unavailable (so the caller can fall back to synth music).
   */
  start(kind) {
    if (!canPlay()) return false;
    const file = pickTrack(kind);
    if (!file) return false;
    const next = makeAudio(file);
    if (!next) return false;

    const outgoing = [];
    if (current?.audio) outgoing.push(current.audio);

    current = { kind, audio: next };

    // play() may reject before a user gesture; that's fine — once the audio
    // context resumes the menu re-triggers, and either way we never throw.
    const p = next.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});

    clearTimer();
    fadeTimer = setInterval(() => tick(outgoing), STEP_MS);
    return true;
  },

  /** Fade the current track out and stop. */
  stop() {
    if (!current?.audio) {
      clearTimer();
      return;
    }
    const outgoing = [current.audio];
    current = null;
    clearTimer();
    fadeTimer = setInterval(() => tick(outgoing), STEP_MS);
  },

  setVolume(v) {
    volume = clamp(v);
    // If no fade is running, apply immediately so a slider drag is audible.
    if (!fadeTimer && current?.audio) current.audio.volume = enabled ? volume : 0;
  },

  setEnabled(on) {
    enabled = Boolean(on);
    if (!fadeTimer && current?.audio) current.audio.volume = enabled ? volume : 0;
  },
};
