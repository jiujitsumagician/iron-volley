// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * The five worlds of IRON VOLLEY. A map definition is pure data +
 * an analytic height function (terrain mesh displacement AND physics
 * collision query use the same function, so they can never disagree).
 *
 * Every map is a 1400×1400 battlefield with hills high enough to
 * volley over but passes low enough to brawl through.
 */

import { makeFbm, clamp, lerp, smoothstep } from "./util.js";

export const WORLD_SIZE = 1400;
const HALF = WORLD_SIZE / 2;

/** Soft circular falloff to a rim wall so nobody drives off the world. */
function rimWall(x, z) {
  const r = Math.hypot(x, z);
  const edge = HALF * 0.92;
  if (r < edge) return 0;
  const t = clamp((r - edge) / (HALF - edge), 0, 1);
  return smoothstep(t) * 90;
}

function makeMap(def) {
  return { props: [], water: null, ...def };
}

export const MAPS = [
  // ── 1. DUNE SEA — rolling desert ridges, sandstone mesas ──────
  makeMap({
    id: "dunes",
    name: "Dune Sea",
    blurb: "Sun-bleached ridgelines and deep sand bowls.",
    seed: 101,
    sky: { top: 0x3a73b8, horizon: 0xf2c98c, sun: 0xffe7b0, sunPos: [0.55, 0.32, 0.4] },
    fog: { color: 0xe0b780, near: 380, far: 1500 },
    hemi: { sky: 0xbfd9ff, ground: 0x8a6a40, intensity: 0.55 },
    sunlight: { color: 0xffdf9e, intensity: 2.3 },
    exposure: 1.12,
    palette: [
      { h: -10, c: [0.58, 0.4, 0.18] },
      { h: 14, c: [0.74, 0.52, 0.22] },
      { h: 34, c: [0.85, 0.62, 0.28] },
      { h: 60, c: [0.52, 0.33, 0.15] },
      { h: 100, c: [0.38, 0.24, 0.12] },
    ],
    slopeColor: [0.6, 0.42, 0.3],
    height(x, z, fbm) {
      const nx = x / 560, nz = z / 560;
      // long diagonal dune ridges + broad bowls
      const ridges = Math.pow(Math.abs(fbm(nx * 1.6 + 9, nz * 1.6 - 4)), 0.8) * 46;
      const swell = fbm(nx * 0.55, nz * 0.55) * 26;
      const detail = fbm(nx * 6, nz * 6) * 3;
      return ridges + swell + detail + rimWall(x, z);
    },
    propsSpec: { kind: "rocks+cacti", count: 90 },
  }),

  // ── 2. FROSTLINE — glacial valley, ice sheets, black pines ────
  makeMap({
    id: "frost",
    name: "Frostline",
    blurb: "A frozen valley where shells whistle through falling snow.",
    seed: 202,
    sky: { top: 0x21304a, horizon: 0xb9c9d9, sun: 0xdfeaff, sunPos: [-0.4, 0.22, 0.6] },
    fog: { color: 0xc3d2e0, near: 260, far: 1250 },
    hemi: { sky: 0xcfe2ff, ground: 0x44525f, intensity: 0.95 },
    sunlight: { color: 0xeaf2ff, intensity: 1.5 },
    palette: [
      { h: -10, c: [0.62, 0.7, 0.78] }, // frozen lake tint
      { h: 6, c: [0.82, 0.87, 0.92] },
      { h: 30, c: [0.92, 0.95, 0.98] },
      { h: 62, c: [0.75, 0.8, 0.88] },
      { h: 110, c: [0.5, 0.56, 0.66] },
    ],
    slopeColor: [0.36, 0.4, 0.48],
    snow: true,
    height(x, z, fbm) {
      const nx = x / 600, nz = z / 600;
      const valley = Math.abs(fbm(nx * 0.8, nz * 0.8)) * 64;
      const shelf = smoothstep(clamp(fbm(nx * 1.7 + 31, nz * 1.7) * 0.5 + 0.5, 0, 1)) * 22;
      const detail = fbm(nx * 5, nz * 5) * 4;
      // frozen lake: flatten a broad disc near center-west
      const lake = Math.hypot(x + 220, z - 120);
      const flat = smoothstep(clamp(1 - lake / 240, 0, 1));
      const h = valley + shelf + detail;
      return lerp(h, 1.5, flat * 0.92) + rimWall(x, z);
    },
    water: { level: 1.2, color: 0x9fd2e8, opacity: 0.85, frozen: true },
    propsSpec: { kind: "pines+boulders", count: 130 },
  }),

  // ── 3. VERDANT VALE — emerald hills, poppy fields, old stones ─
  makeMap({
    id: "verdant",
    name: "Verdant Vale",
    blurb: "Rolling green downs hiding ancient standing stones.",
    seed: 303,
    sky: { top: 0x3e8edd, horizon: 0xcfe8c9, sun: 0xfff4d6, sunPos: [0.25, 0.5, -0.3] },
    fog: { color: 0xc9dec8, near: 420, far: 1600 },
    hemi: { sky: 0xbfe1ff, ground: 0x3f5a33, intensity: 1.0 },
    sunlight: { color: 0xfff2cf, intensity: 2.0 },
    palette: [
      { h: -8, c: [0.12, 0.26, 0.1] },
      { h: 8, c: [0.18, 0.42, 0.14] },
      { h: 28, c: [0.27, 0.52, 0.17] },
      { h: 52, c: [0.36, 0.48, 0.2] },
      { h: 95, c: [0.48, 0.47, 0.42] },
    ],
    slopeColor: [0.36, 0.33, 0.24],
    height(x, z, fbm) {
      const nx = x / 520, nz = z / 520;
      const downs = fbm(nx, nz) * 46 + fbm(nx * 0.4 + 7, nz * 0.4) * 26;
      const knolls = Math.max(0, fbm(nx * 2.4 + 17, nz * 2.4 - 9)) * 24;
      const detail = fbm(nx * 7, nz * 7) * 2.2;
      const river = Math.abs(fbm(nx * 0.7 + 50, nz * 0.7 + 50)) * 999;
      const cut = Math.max(0, 16 - river * 0.5); // winding brook bed
      return downs + knolls + detail - cut + 6 + rimWall(x, z);
    },
    water: { level: -6, color: 0x2f7698, opacity: 0.82 },
    propsSpec: { kind: "trees+stones", count: 150 },
  }),

  // ── 4. CINDER PEAK — volcanic ash fields and lava channels ────
  makeMap({
    id: "cinder",
    name: "Cinder Peak",
    blurb: "Black ash, red rivers. The mountain does not care who wins.",
    seed: 404,
    sky: { top: 0x1a0d12, horizon: 0x7a2a16, sun: 0xff7a3c, sunPos: [-0.2, 0.18, -0.55] },
    fog: { color: 0x4a1d12, near: 240, far: 1150 },
    hemi: { sky: 0x8a4a4a, ground: 0x2a1612, intensity: 1.3 },
    sunlight: { color: 0xff9b66, intensity: 2.0 },
    exposure: 1.5,
    palette: [
      { h: -10, c: [0.16, 0.13, 0.13] },
      { h: 10, c: [0.26, 0.21, 0.2] },
      { h: 34, c: [0.38, 0.3, 0.27] },
      { h: 70, c: [0.3, 0.22, 0.22] },
      { h: 130, c: [0.5, 0.36, 0.3] },
    ],
    slopeColor: [0.16, 0.12, 0.11],
    embers: true,
    height(x, z, fbm) {
      const nx = x / 540, nz = z / 540;
      // central volcano cone with crater
      const r = Math.hypot(x - 60, z + 80);
      const cone = Math.max(0, 1 - r / 420) * 120;
      const crater = Math.max(0, 1 - r / 130) * 70;
      const rough = Math.abs(fbm(nx * 2.1, nz * 2.1)) * 30;
      const flows = Math.abs(fbm(nx * 1.1 + 99, nz * 1.1)) * 999;
      const channel = Math.max(0, 18 - flows * 0.55); // lava channels
      return cone - crater + rough - channel + 8 + rimWall(x, z);
    },
    water: { level: 1, color: 0xff5a18, opacity: 0.95, lava: true, emissive: 2.2 },
    propsSpec: { kind: "spires", count: 80 },
  }),

  // ── 5. NEON RIFT — synthwave canyon under a void sky ──────────
  makeMap({
    id: "neon",
    name: "Neon Rift",
    blurb: "A shattered simulation. The grid remembers every shot.",
    seed: 505,
    sky: { top: 0x070114, horizon: 0xff2e88, sun: 0x66e0ff, sunPos: [0, 0.26, -0.8] },
    fog: { color: 0x1a0533, near: 300, far: 1300 },
    hemi: { sky: 0x4422aa, ground: 0x140a26, intensity: 0.85 },
    sunlight: { color: 0x9fd0ff, intensity: 1.2 },
    exposure: 1.2,
    palette: [
      { h: -12, c: [0.05, 0.02, 0.12] },
      { h: 6, c: [0.1, 0.05, 0.22] },
      { h: 30, c: [0.16, 0.08, 0.3] },
      { h: 64, c: [0.24, 0.1, 0.36] },
      { h: 120, c: [0.36, 0.16, 0.46] },
    ],
    slopeColor: [0.07, 0.03, 0.16],
    wireframeGlow: 0xff2e88,
    stars: true,
    height(x, z, fbm) {
      const nx = x / 500, nz = z / 500;
      // terraced plateaus — quantized noise reads as stepped canyons,
      // but blended soft enough that every terrace is climbable
      const base = fbm(nx, nz) * 0.5 + 0.5;
      const terrace = Math.round(base * 5) / 5;
      const blend = lerp(base, terrace, 0.45) * 64;
      const rift = Math.abs(fbm(nx * 0.8 + 77, nz * 0.8 - 33)) * 999;
      const cut = Math.max(0, 15 - rift * 0.6); // the glowing rift channel
      const detail = fbm(nx * 5, nz * 5) * 2;
      return blend - cut + detail + rimWall(x, z);
    },
    water: { level: -8, color: 0x21e6ff, opacity: 0.9, energy: true, emissive: 1.8 },
    propsSpec: { kind: "monoliths", count: 70 },
  }),
];

export function mapById(id) {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Build the bound height sampler for a map (analytic, shared). */
export function makeHeightFn(map) {
  const fbm = makeFbm(map.seed, 5);
  return (x, z) => map.height(x, z, fbm);
}
