// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const TAU = Math.PI * 2;

/** Shortest signed angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic seeded RNG (mulberry32). */
export function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 2D value noise + fbm (seeded, analytic — terrain height and
//    collision share the exact same function) ────────────────────
const PERM_SIZE = 256;
export function makeNoise2D(seed) {
  const rng = seededRng(seed);
  const grad = new Float32Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) grad[i] = rng();
  const perm = new Uint8Array(PERM_SIZE * 2);
  const p = [...Array(PERM_SIZE).keys()];
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < PERM_SIZE * 2; i++) perm[i] = p[i & (PERM_SIZE - 1)];

  const at = (ix, iz) => grad[perm[(perm[ix & 255] + iz) & 255]];

  return function noise2D(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = smoothstep(fx), uz = smoothstep(fz);
    const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1; // -1..1
  };
}

export function makeFbm(seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  const n = makeNoise2D(seed);
  return function fbm(x, z) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += n(x * freq, z * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm; // -1..1
  };
}
