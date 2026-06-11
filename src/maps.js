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
    grass: true,
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

  // -- 6. RAZORWASH LABYRINTH - branching canyon slots under copper haze -------
  makeMap({
    id: "razorwash",
    name: "Razorwash Labyrinth",
    blurb: "High stone tables split by sly canyons that beg for bank shots.",
    seed: 606,
    sky: { top: 0x5f8fb3, horizon: 0xd6a064, sun: 0xffd58a, sunPos: [0.5, 0.25, -0.42] },
    fog: { color: 0xb87f55, near: 340, far: 1450 },
    hemi: { sky: 0xb9d6ee, ground: 0x6a4a32, intensity: 0.75 },
    sunlight: { color: 0xffc175, intensity: 2.1 },
    exposure: 1.18,
    palette: [
      { h: -12, c: [0.32, 0.2, 0.14] },
      { h: 10, c: [0.5, 0.32, 0.2] },
      { h: 34, c: [0.64, 0.42, 0.26] },
      { h: 68, c: [0.43, 0.28, 0.2] },
      { h: 118, c: [0.26, 0.18, 0.15] },
    ],
    slopeColor: [0.38, 0.24, 0.18],
    height(x, z, fbm) {
      const nx = x / 560, nz = z / 560;
      const plateau = 46 + fbm(nx * 0.7 - 4, nz * 0.7 + 2) * 18;
      const veinA = Math.abs(fbm(nx * 1.05 + 13, nz * 1.05 - 21));
      const veinB = Math.abs(fbm(nz * 1.0 - 7, nx * 1.0 + 44));
      const branch = Math.min(veinA, veinB * 1.08);
      const slot = smoothstep(clamp(1 - branch / 0.19, 0, 1)) * 44;
      const shoulders = Math.pow(Math.max(0, 0.28 - branch), 2) * 75;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 90, 0, 1));
      const h = plateau - slot + shoulders + fbm(nx * 5.5, nz * 5.5) * 2.5;
      return lerp(h, 18 + fbm(nx * 2, nz * 2) * 2, center * 0.88) + rimWall(x, z);
    },
    propsSpec: { kind: "rocks+cacti", count: 110 },
  }),

  // -- 7. LOWTIDE ATOLLS - shallow sea, sand bridges, turret islands ----------
  makeMap({
    id: "lowtide",
    name: "Lowtide Atolls",
    blurb: "Turrets trade fire across glassy water and exposed coral roads.",
    seed: 707,
    sky: { top: 0x2e9fc7, horizon: 0xd8f0da, sun: 0xfff0bd, sunPos: [-0.35, 0.46, 0.25] },
    fog: { color: 0x9ed6c7, near: 440, far: 1650 },
    hemi: { sky: 0xbcefff, ground: 0x557b6b, intensity: 1.05 },
    sunlight: { color: 0xffe6a8, intensity: 2.25 },
    exposure: 1.32,
    palette: [
      { h: -10, c: [0.32, 0.63, 0.58] },
      { h: 4, c: [0.72, 0.68, 0.44] },
      { h: 22, c: [0.82, 0.76, 0.5] },
      { h: 50, c: [0.52, 0.64, 0.38] },
      { h: 95, c: [0.34, 0.48, 0.36] },
    ],
    slopeColor: [0.42, 0.48, 0.34],
    height(x, z, fbm) {
      const nx = x / 620, nz = z / 620;
      const islands = Math.max(0, fbm(nx * 1.6 + 17, nz * 1.6 - 8) + 0.1) * 54;
      const barsA = Math.max(0, 0.2 - Math.abs(fbm(nx * 0.85 + 70, nz * 0.85))) * 95;
      const barsB = Math.max(0, 0.16 - Math.abs(fbm(nz * 0.9 - 31, nx * 0.9 + 9))) * 75;
      const lagoon = -8 + fbm(nx * 0.45, nz * 0.45) * 5;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 85, 0, 1));
      const h = lagoon + islands + barsA + barsB + fbm(nx * 7, nz * 7) * 1.6;
      return lerp(h, 10, center * 0.9) + rimWall(x, z);
    },
    water: { level: 1.5, color: 0x37b5bf, opacity: 0.7 },
    propsSpec: { kind: "rocks+cacti", count: 75 },
  }),

  // -- 8. REGOLITH SCARS - crater bowls beneath a hard star field -------------
  makeMap({
    id: "regolith",
    name: "Regolith Scars",
    blurb: "Every old impact is a bunker until someone lobs into it.",
    seed: 808,
    sky: { top: 0x03070e, horizon: 0x27303c, sun: 0xe2e8f0, sunPos: [0.15, 0.22, -0.72] },
    fog: { color: 0x2c3238, near: 520, far: 1800 },
    hemi: { sky: 0xaab6c8, ground: 0x24272b, intensity: 0.62 },
    sunlight: { color: 0xd8e1ee, intensity: 1.65 },
    exposure: 1.1,
    palette: [
      { h: -18, c: [0.16, 0.17, 0.18] },
      { h: 0, c: [0.28, 0.29, 0.29] },
      { h: 22, c: [0.42, 0.42, 0.4] },
      { h: 58, c: [0.32, 0.33, 0.34] },
      { h: 108, c: [0.52, 0.53, 0.52] },
    ],
    slopeColor: [0.24, 0.25, 0.25],
    stars: true,
    height(x, z, fbm) {
      const nx = x / 580, nz = z / 580;
      const swell = fbm(nx * 0.6, nz * 0.6) * 22 + 24;
      let craters = 0;
      const sites = [
        [-310, -260, 165, 30], [270, -320, 130, 24], [-60, -310, 105, 20],
        [-390, 120, 115, 23], [330, 170, 155, 32], [-150, 285, 145, 28],
        [120, 300, 95, 18], [-520, -40, 90, 16], [485, -75, 110, 21],
      ];
      for (const [cx, cz, radius, depth] of sites) {
        const d = Math.hypot(x - cx, z - cz) / radius;
        const bowl = smoothstep(clamp(1 - d, 0, 1));
        const rim = Math.max(0, 1 - Math.abs(d - 1.08) / 0.22);
        craters += rim * depth * 0.85 - bowl * depth;
      }
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 75, 0, 1));
      const h = swell + craters + fbm(nx * 6.5 + 3, nz * 6.5 - 5) * 3;
      return lerp(h, 12, center * 0.94) + rimWall(x, z);
    },
    propsSpec: { kind: "monoliths", count: 55 },
  }),

  // -- 9. MIRROR SALT - white flats interrupted by blunt blue mesas -----------
  makeMap({
    id: "mirrorsalt",
    name: "Mirror Salt",
    blurb: "Flat white lanes make every mesa a verdict.",
    seed: 909,
    sky: { top: 0x84bed2, horizon: 0xf5eee0, sun: 0xffffff, sunPos: [0.48, 0.62, 0.18] },
    fog: { color: 0xe8e3d4, near: 520, far: 1750 },
    hemi: { sky: 0xe6f7ff, ground: 0xb7b0a0, intensity: 1.18 },
    sunlight: { color: 0xfff4de, intensity: 2.0 },
    exposure: 1.42,
    palette: [
      { h: -8, c: [0.8, 0.78, 0.68] },
      { h: 8, c: [0.9, 0.88, 0.78] },
      { h: 28, c: [0.66, 0.69, 0.68] },
      { h: 60, c: [0.45, 0.55, 0.58] },
      { h: 115, c: [0.34, 0.42, 0.46] },
    ],
    slopeColor: [0.42, 0.45, 0.43],
    height(x, z, fbm) {
      const nx = x / 610, nz = z / 610;
      const flats = fbm(nx * 0.55 + 8, nz * 0.55 - 8) * 4;
      const mesas = [
        [-390, -250, 145, 58], [-35, -360, 110, 48], [330, -210, 150, 64],
        [-315, 185, 120, 54], [185, 250, 175, 70], [505, 115, 95, 42],
      ];
      let caps = 0;
      for (const [cx, cz, radius, height] of mesas) {
        const d = Math.hypot(x - cx, z - cz) / radius;
        const cap = smoothstep(clamp(1 - d, 0, 1));
        const skirt = smoothstep(clamp(1 - d / 1.55, 0, 1));
        caps += cap * height + skirt * height * 0.28;
      }
      const pans = -Math.max(0, fbm(nx * 1.25 - 40, nz * 1.25 + 14) - 0.3) * 10;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 80, 0, 1));
      const h = 8 + flats + caps + pans;
      return lerp(h, 7, center * 0.96) + rimWall(x, z);
    },
    water: { level: 0, color: 0xddeee9, opacity: 0.36 },
    propsSpec: { kind: "monoliths", count: 65 },
  }),

  // -- 10. GREENBRAID DELTA - jungle islands and switchback rivers ------------
  makeMap({
    id: "greenbraid",
    name: "Greenbraid Delta",
    blurb: "River fingers split the jungle into ambush lanes.",
    seed: 1010,
    sky: { top: 0x2f7fa3, horizon: 0xbddf9c, sun: 0xffefb0, sunPos: [-0.25, 0.5, 0.42] },
    fog: { color: 0x8fbf88, near: 310, far: 1320 },
    hemi: { sky: 0xb9e8f0, ground: 0x1f4728, intensity: 1.15 },
    sunlight: { color: 0xffe5a5, intensity: 1.85 },
    exposure: 1.2,
    palette: [
      { h: -10, c: [0.06, 0.22, 0.16] },
      { h: 6, c: [0.11, 0.34, 0.21] },
      { h: 28, c: [0.18, 0.45, 0.25] },
      { h: 58, c: [0.26, 0.42, 0.24] },
      { h: 106, c: [0.38, 0.36, 0.26] },
    ],
    slopeColor: [0.18, 0.22, 0.15],
    grass: true,
    height(x, z, fbm) {
      const nx = x / 570, nz = z / 570;
      const banks = 24 + fbm(nx * 0.8, nz * 0.8) * 28 + Math.max(0, fbm(nx * 2.2 - 6, nz * 2.2 + 11)) * 18;
      const riverA = Math.abs(fbm(nx * 0.95 + 10, nz * 0.95 - 30));
      const riverB = Math.abs(fbm(nx * 1.2 - 58, nz * 1.2 + 14));
      const channels = smoothstep(clamp(1 - Math.min(riverA, riverB * 1.15) / 0.16, 0, 1)) * 30;
      const levees = Math.max(0, 0.25 - Math.min(riverA, riverB)) * 38;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 85, 0, 1));
      const h = banks - channels + levees + fbm(nx * 7, nz * 7) * 2.2;
      return lerp(h, 13, center * 0.9) + rimWall(x, z);
    },
    water: { level: 2, color: 0x1c6f68, opacity: 0.78 },
    propsSpec: { kind: "trees+stones", count: 185 },
  }),

  // -- 11. PAINTED NEEDLES - striped hoodoo country in hot pastel light -------
  makeMap({
    id: "paintedneedles",
    name: "Painted Needles",
    blurb: "Candy-striped hoodoos turn every shell arc theatrical.",
    seed: 1111,
    sky: { top: 0x709ac4, horizon: 0xf0b98e, sun: 0xffdd9e, sunPos: [0.32, 0.36, -0.48] },
    fog: { color: 0xd79273, near: 360, far: 1450 },
    hemi: { sky: 0xc8dcf2, ground: 0x734033, intensity: 0.8 },
    sunlight: { color: 0xffbc87, intensity: 2.15 },
    exposure: 1.28,
    palette: [
      { h: -10, c: [0.46, 0.22, 0.19] },
      { h: 12, c: [0.72, 0.38, 0.28] },
      { h: 32, c: [0.86, 0.57, 0.4] },
      { h: 62, c: [0.75, 0.42, 0.5] },
      { h: 112, c: [0.5, 0.27, 0.36] },
    ],
    slopeColor: [0.45, 0.25, 0.22],
    height(x, z, fbm) {
      const nx = x / 560, nz = z / 560;
      const wash = 20 + fbm(nx * 0.8, nz * 0.8) * 22;
      const hoodooNoise = fbm(nx * 2.8 + 90, nz * 2.8 - 17) * 0.5 + 0.5;
      const needles = Math.pow(Math.max(0, hoodooNoise - 0.56) / 0.44, 2.2) * 72;
      const gullies = smoothstep(clamp(1 - Math.abs(fbm(nx * 1.25 - 11, nz * 1.25 + 5)) / 0.17, 0, 1)) * 18;
      const ripples = Math.sin((x + z * 0.55) * 0.035) * 2.4;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 85, 0, 1));
      const h = wash + needles - gullies + ripples + fbm(nx * 6, nz * 6) * 2;
      return lerp(h, 12, center * 0.9) + rimWall(x, z);
    },
    propsSpec: { kind: "spires", count: 125 },
  }),

  // -- 12. BLUEKNIFE GLACIER - crevasse cuts through heavy snow shelves -------
  makeMap({
    id: "blueknife",
    name: "Blueknife Glacier",
    blurb: "Frozen blue cuts divide the field without stopping the chase.",
    seed: 1212,
    sky: { top: 0x14233f, horizon: 0x93b9cf, sun: 0xf6fbff, sunPos: [-0.55, 0.28, -0.25] },
    fog: { color: 0xa9c7d5, near: 260, far: 1220 },
    hemi: { sky: 0xc7e7ff, ground: 0x4f6472, intensity: 1.05 },
    sunlight: { color: 0xeaf7ff, intensity: 1.55 },
    exposure: 1.16,
    palette: [
      { h: -12, c: [0.34, 0.57, 0.66] },
      { h: 4, c: [0.58, 0.78, 0.86] },
      { h: 24, c: [0.83, 0.91, 0.95] },
      { h: 56, c: [0.7, 0.8, 0.88] },
      { h: 108, c: [0.48, 0.6, 0.7] },
    ],
    slopeColor: [0.36, 0.46, 0.54],
    snow: true,
    height(x, z, fbm) {
      const nx = x / 590, nz = z / 590;
      const shelf = 30 + fbm(nx * 0.7, nz * 0.7) * 26 + Math.abs(fbm(nx * 1.8 + 8, nz * 1.8 - 2)) * 18;
      const crackA = Math.abs(fbm(nx * 1.05 + 31, nz * 1.05 + 60));
      const crackB = Math.abs(fbm(nz * 1.2 - 19, nx * 1.2 + 47));
      const crevasse = smoothstep(clamp(1 - Math.min(crackA, crackB) / 0.13, 0, 1)) * 36;
      const berm = Math.max(0, 0.22 - Math.min(crackA, crackB)) * 55;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 90, 0, 1));
      const h = shelf - crevasse + berm + fbm(nx * 8, nz * 8) * 1.7;
      return lerp(h, 15, center * 0.92) + rimWall(x, z);
    },
    water: { level: -4, color: 0x75c9e8, opacity: 0.82, frozen: true },
    propsSpec: { kind: "pines+boulders", count: 115 },
  }),

  // -- 13. RINGFARM BASIN - stepped fields descending to a quiet lake ---------
  makeMap({
    id: "ringfarm",
    name: "Ringfarm Basin",
    blurb: "Terraces make polite stairs for impolite artillery.",
    seed: 1313,
    sky: { top: 0x5aa3c5, horizon: 0xdde5b2, sun: 0xffedb4, sunPos: [0.4, 0.55, 0.18] },
    fog: { color: 0xc6d8ad, near: 420, far: 1550 },
    hemi: { sky: 0xd0ecff, ground: 0x4c5c32, intensity: 1.0 },
    sunlight: { color: 0xffe0a0, intensity: 1.95 },
    exposure: 1.22,
    palette: [
      { h: -10, c: [0.22, 0.31, 0.18] },
      { h: 8, c: [0.36, 0.5, 0.24] },
      { h: 28, c: [0.52, 0.58, 0.3] },
      { h: 54, c: [0.62, 0.5, 0.28] },
      { h: 98, c: [0.4, 0.36, 0.24] },
    ],
    slopeColor: [0.32, 0.31, 0.2],
    grass: true,
    height(x, z, fbm) {
      const nx = x / 600, nz = z / 600;
      const r = Math.hypot(x + 25, z - 35);
      const ring = Math.floor(clamp(r / 82, 0, 7)) * 8.5;
      const valley = 68 - ring;
      const lake = smoothstep(clamp(1 - r / 185, 0, 1)) * 54;
      const orchard = Math.max(0, fbm(nx * 2.1 + 12, nz * 2.1 - 5)) * 12;
      const lanes = Math.sin(Math.atan2(z - 35, x + 25) * 10) * 1.8;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 82, 0, 1));
      const h = valley - lake + orchard + lanes + fbm(nx * 5.5, nz * 5.5) * 1.5;
      return lerp(h, 14, center * 0.88) + rimWall(x, z);
    },
    water: { level: 5, color: 0x3f8585, opacity: 0.76 },
    propsSpec: { kind: "trees+stones", count: 160 },
  }),

  // -- 14. MAGMA HALO - ash flats wrapped around a bright lava ring -----------
  makeMap({
    id: "magmahalo",
    name: "Magma Halo",
    blurb: "A molten moat dares commanders to fight across the glow.",
    seed: 1414,
    sky: { top: 0x20191a, horizon: 0x9b5132, sun: 0xff9c55, sunPos: [-0.18, 0.2, 0.62] },
    fog: { color: 0x5b3026, near: 250, far: 1180 },
    hemi: { sky: 0x9c6658, ground: 0x211a18, intensity: 1.15 },
    sunlight: { color: 0xffa06c, intensity: 1.85 },
    exposure: 1.48,
    palette: [
      { h: -12, c: [0.1, 0.1, 0.09] },
      { h: 6, c: [0.19, 0.18, 0.16] },
      { h: 28, c: [0.32, 0.29, 0.24] },
      { h: 62, c: [0.28, 0.23, 0.2] },
      { h: 120, c: [0.45, 0.38, 0.32] },
    ],
    slopeColor: [0.14, 0.12, 0.1],
    embers: true,
    height(x, z, fbm) {
      const nx = x / 560, nz = z / 560;
      const r = Math.hypot(x - 20, z + 10);
      const ash = 20 + fbm(nx * 0.75, nz * 0.75) * 20 + Math.abs(fbm(nx * 2.4 - 8, nz * 2.4 + 4)) * 14;
      const ring = Math.max(0, 1 - Math.abs(r - 285) / 55);
      const moat = smoothstep(clamp(ring, 0, 1)) * 34;
      const rampBreaks = Math.max(0, fbm(nx * 3.1 + 80, nz * 3.1 - 2) - 0.42) * 18;
      const outerRidge = Math.max(0, 1 - Math.abs(r - 405) / 170) * 34;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 88, 0, 1));
      const h = ash + outerRidge - moat + rampBreaks + fbm(nx * 7, nz * 7) * 2;
      return lerp(h, 15, center * 0.9) + rimWall(x, z);
    },
    water: { level: 0, color: 0xff6b1a, opacity: 0.95, lava: true, emissive: 2.4 },
    propsSpec: { kind: "spires", count: 95 },
  }),

  // -- 15. FRACTAL PANES - alien plates, broken levels, cold grid light -------
  makeMap({
    id: "fractalpanes",
    name: "Fractal Panes",
    blurb: "Alien tiles tilt the battlefield into a luminous puzzle.",
    seed: 1515,
    sky: { top: 0x020915, horizon: 0x0f4b5c, sun: 0x8ffcff, sunPos: [0.05, 0.3, -0.75] },
    fog: { color: 0x08242e, near: 330, far: 1350 },
    hemi: { sky: 0x55ccdd, ground: 0x061015, intensity: 0.82 },
    sunlight: { color: 0xb6faff, intensity: 1.25 },
    exposure: 1.26,
    palette: [
      { h: -14, c: [0.03, 0.07, 0.09] },
      { h: 4, c: [0.06, 0.14, 0.16] },
      { h: 26, c: [0.1, 0.24, 0.25] },
      { h: 58, c: [0.16, 0.34, 0.33] },
      { h: 112, c: [0.24, 0.42, 0.38] },
    ],
    slopeColor: [0.05, 0.12, 0.13],
    stars: true,
    wireframeGlow: 0x36ffe2,
    height(x, z, fbm) {
      const nx = x / 520, nz = z / 520;
      const plateNoise = fbm(nx * 1.45, nz * 1.45) * 0.5 + 0.5;
      const plate = Math.round(plateNoise * 7) / 7;
      const tiltA = Math.floor((x + 700) / 140) * 2.8;
      const tiltB = Math.floor((z + 700) / 160) * -2.4;
      const seams = Math.max(0, 0.2 - Math.abs(fbm(nx * 2.4 + 18, nz * 2.4 - 33))) * 85;
      const sink = smoothstep(clamp(seams / 17, 0, 1)) * 20;
      const drift = fbm(nx * 0.65 - 44, nz * 0.65 + 2) * 18;
      const center = smoothstep(clamp(1 - Math.hypot(x, z) / 86, 0, 1));
      const h = plate * 58 + tiltA + tiltB + drift - sink + fbm(nx * 8, nz * 8) * 1.4;
      return lerp(h, 16, center * 0.9) + rimWall(x, z);
    },
    water: { level: -6, color: 0x35fff0, opacity: 0.84, energy: true, emissive: 2.0 },
    propsSpec: { kind: "monoliths", count: 90 },
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
