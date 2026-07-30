// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Tank art: materials, generated armor textures, and the cosmetic geometry
 * builders (hull, running gear, turret furniture, gun).
 *
 * PURELY VISUAL. Nothing here reads or writes gameplay state — tank.js owns
 * the rig contract (the `turret` / `barrel` / `muzzle` / `mgMuzzle` groups and
 * their exact offsets) and this module only decorates around it.
 *
 * Two hard constraints, both learned the hard way:
 *  - Textures may be cached and shared between tanks; MATERIALS and GEOMETRIES
 *    may not. thumbs.js snapshots a tank and then disposes every geometry and
 *    material it can reach, so anything shared would be freed out from under
 *    the live tanks. Material.dispose() does NOT touch textures, which is why
 *    the texture cache is safe.
 *  - Static parts are merged per-material to keep the draw count sane; only
 *    parts that actually animate (road wheels, track belts) stay separate.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clamp, lerp } from "./util.js";

// ── generated texture cache (shared; never disposed — see header) ──
let _armor = null;   // { normal, rough }
let _tread = null;   // { color, normal }

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

/**
 * Sobel a greyscale height canvas into a tangent-space normal map. Cheaper
 * and far more controllable than hand-authoring normals, and it lets every
 * surface feature below be drawn as "how high is this bump".
 */
function heightToNormal(src, strength = 2.0) {
  const n = src.width;
  const sctx = src.getContext("2d");
  const h = sctx.getImageData(0, 0, n, n).data;
  const out = canvas(n);
  const octx = out.getContext("2d");
  const img = octx.createImageData(n, n);
  const at = (x, y) => h[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // 3x3 Sobel on the height field
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * n + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Rolled/welded armour plate: panel seams on a jittered grid, weld beads
 * proud of the seams, rivet lines, and scattered scuffs. Returns a normal map
 * plus a matching roughness map (seams and scuffs read rougher than the plate).
 */
function armorMaps() {
  if (_armor) return _armor;
  const N = 512;
  const hc = canvas(N), rc = canvas(N);
  const h = hc.getContext("2d"), r = rc.getContext("2d");

  h.fillStyle = "#808080"; h.fillRect(0, 0, N, N);
  r.fillStyle = "#9e9e9e"; r.fillRect(0, 0, N, N); // ~0.62 roughness base

  // deterministic jitter — the armour plate should look the same every boot
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // panel seams: a few long cuts across the plate, both axes
  const seams = [];
  for (let i = 0; i < 5; i++) seams.push({ v: false, p: (i + 0.5) / 5 * N + (rnd() - 0.5) * 40 });
  for (let i = 0; i < 4; i++) seams.push({ v: true, p: (i + 0.5) / 4 * N + (rnd() - 0.5) * 40 });

  for (const s of seams) {
    // the seam groove itself
    h.strokeStyle = "#5c5c5c"; h.lineWidth = 3;
    r.strokeStyle = "#c8c8c8"; r.lineWidth = 4;
    h.beginPath(); r.beginPath();
    if (s.v) { h.moveTo(s.p, 0); h.lineTo(s.p, N); r.moveTo(s.p, 0); r.lineTo(s.p, N); }
    else { h.moveTo(0, s.p); h.lineTo(N, s.p); r.moveTo(0, s.p); r.lineTo(N, s.p); }
    h.stroke(); r.stroke();

    // weld bead riding alongside it
    h.strokeStyle = "#9c9c9c"; h.lineWidth = 2.2;
    h.beginPath();
    const off = 3;
    if (s.v) {
      for (let y = 0; y <= N; y += 6) {
        const x = s.p + off + Math.sin(y * 0.28) * 0.9;
        y === 0 ? h.moveTo(x, y) : h.lineTo(x, y);
      }
    } else {
      for (let x = 0; x <= N; x += 6) {
        const y = s.p + off + Math.sin(x * 0.28) * 0.9;
        x === 0 ? h.moveTo(x, y) : h.lineTo(x, y);
      }
    }
    h.stroke();

    // rivet line
    for (let t = 12; t < N; t += 26) {
      const x = s.v ? s.p - 7 : t, y = s.v ? t : s.p - 7;
      h.fillStyle = "#b8b8b8";
      h.beginPath(); h.arc(x, y, 2.6, 0, Math.PI * 2); h.fill();
      h.fillStyle = "#6a6a6a";
      h.beginPath(); h.arc(x, y, 3.4, 0, Math.PI * 2); h.stroke?.();
      r.fillStyle = "#8a8a8a";
      r.beginPath(); r.arc(x, y, 3.0, 0, Math.PI * 2); r.fill();
    }
  }

  // scuffs and scratches — worn edges catch the light differently
  for (let i = 0; i < 90; i++) {
    const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, len = 8 + rnd() * 46;
    h.strokeStyle = rnd() > 0.5 ? "#6e6e6e" : "#909090";
    h.lineWidth = 0.6 + rnd() * 1.3;
    h.beginPath(); h.moveTo(x, y);
    h.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    h.stroke();
    r.strokeStyle = "#bdbdbd"; r.lineWidth = 1.4;
    r.beginPath(); r.moveTo(x, y);
    r.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    r.stroke();
  }

  // grime blotches in the roughness only — dirt doesn't deform the plate
  for (let i = 0; i < 34; i++) {
    r.fillStyle = `rgba(200,200,200,${0.10 + rnd() * 0.16})`;
    r.beginPath();
    r.ellipse(rnd() * N, rnd() * N, 18 + rnd() * 52, 12 + rnd() * 40, rnd() * Math.PI, 0, Math.PI * 2);
    r.fill();
  }

  const normal = new THREE.CanvasTexture(heightToNormal(hc, 1.7));
  const rough = new THREE.CanvasTexture(rc);
  for (const t of [normal, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  rough.colorSpace = THREE.NoColorSpace;
  _armor = { normal, rough };
  return _armor;
}

/**
 * Track belt surface: cast steel links with centre guide horns and end
 * connectors, tiling along the belt's length so it can be scrolled.
 */
function treadMaps() {
  if (_tread) return _tread;
  const W = 128, H = 128;
  const cc = document.createElement("canvas"); cc.width = W; cc.height = H;
  const hh = document.createElement("canvas"); hh.width = W; hh.height = H;
  const c = cc.getContext("2d"), h = hh.getContext("2d");

  c.fillStyle = "#26292e"; c.fillRect(0, 0, W, H);
  h.fillStyle = "#6a6a6a"; h.fillRect(0, 0, W, H);

  // U runs ALONG the belt and V across its width, so a link is a bar that
  // spans the full width and repeats down the length. (Drawing these the
  // other way round is what made the first pass look like fine checkerplate
  // instead of track — the links ran parallel to travel.)
  for (let i = 0; i < 2; i++) {
    const x0 = i * (W / 2) + 3, wid = W / 2 - 6;
    c.fillStyle = "#3a3f46";
    c.fillRect(x0, 0, wid, H);
    h.fillStyle = "#b4b4b4";
    h.fillRect(x0, 0, wid, H);

    // centre guide horn, running down the middle of the belt
    c.fillStyle = "#4a5058";
    c.fillRect(x0 + 2, H * 0.42, wid - 4, H * 0.16);
    h.fillStyle = "#e8e8e8";
    h.fillRect(x0 + 2, H * 0.42, wid - 4, H * 0.16);

    // end connectors / pin bosses at both edges of the link
    for (const y of [H * 0.06, H * 0.82]) {
      c.fillStyle = "#4f555d";
      c.fillRect(x0 + 3, y, wid - 6, H * 0.12);
      h.fillStyle = "#d4d4d4";
      h.fillRect(x0 + 3, y, wid - 6, H * 0.12);
    }

    // polished contact faces either side of the guide horn — this is the
    // part that actually rides the ground, so it wears bright
    c.fillStyle = "rgba(158,168,180,0.20)";
    c.fillRect(x0 + 2, H * 0.22, wid - 4, H * 0.16);
    c.fillRect(x0 + 2, H * 0.62, wid - 4, H * 0.16);
  }

  const color = new THREE.CanvasTexture(cc);
  const normal = new THREE.CanvasTexture(heightToNormal(hh, 2.6));
  for (const t of [color, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  color.colorSpace = THREE.SRGBColorSpace;
  _tread = { color, normal };
  return _tread;
}

/**
 * Free a material and every texture hanging off it.
 *
 * Callers used to dispose only `.map`, which was fine when that was the only
 * texture a tank material carried. Armour plate now brings a normal map and a
 * roughness map, and each tank clones its own, so a match's worth of tanks
 * would leak a dozen GPU textures per teardown without this.
 *
 * envMap is deliberately excluded: that slot points at the shared per-map PMREM
 * probe, which outlives any one material.
 */
const TEX_SLOTS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
  "aoMap", "alphaMap", "bumpMap", "displacementMap", "lightMap", "specularMap",
];
export function disposeMaterial(m) {
  if (!m) return;
  for (const slot of TEX_SLOTS) m[slot]?.dispose?.();
  m.dispose?.();
}

/** Per-part texture clone so texel density can be tuned without sharing state. */
function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

// ── paint shop: generated camo, cached per skin ────────────────
const _camoCache = new Map();
export function camoTexture(skin) {
  if (_camoCache.has(skin.id)) return _camoCache.get(skin.id);
  const c = canvas(256);
  const ctx = c.getContext("2d");
  const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = hex(skin.colors[0]);
  ctx.fillRect(0, 0, 256, 256);
  if (skin.stripes) {
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = hex(skin.colors[i % 2 === 0 ? 1 : 2]);
      ctx.lineWidth = 6 + Math.random() * 12;
      ctx.beginPath();
      const y = Math.random() * 256;
      ctx.moveTo(-20, y);
      ctx.bezierCurveTo(80, y + (Math.random() - 0.5) * 90, 180, y + (Math.random() - 0.5) * 90, 286, y + (Math.random() - 0.5) * 60);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = hex(skin.colors[1 + (i % (skin.colors.length - 1))]);
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * 256, Math.random() * 256,
        14 + Math.random() * 30, 9 + Math.random() * 20,
        Math.random() * Math.PI, 0, Math.PI * 2
      );
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(0.12, 0.12);
  _camoCache.set(skin.id, tex);
  return tex;
}

/**
 * Fresh material set for one tank. Every material is a new instance (see the
 * disposal note in the header); only the underlying textures are shared.
 */
export function tankMaterials(team, skin) {
  const { normal, rough } = armorMaps();

  const paint = {};
  if (skin && skin.kind === "solid") paint.color = skin.color;
  else if (skin && skin.kind === "camo") { paint.color = 0xffffff; paint.map = tiled(camoTexture(skin), 1, 1); }
  else paint.color = team.body;

  const armorTex = {
    normalMap: tiled(normal, 2.2, 2.2),
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: tiled(rough, 2.2, 2.2),
  };

  // Painted armour is a DIELECTRIC. The first pass ran metalness ~0.5, which
  // is why every tank came out looking like polished brass instead of a
  // painted steel box. Bare metal (gun tube, tracks) keeps its metalness.
  const body = new THREE.MeshStandardMaterial({
    ...paint, ...armorTex,
    roughness: 0.74, metalness: 0.08, envMapIntensity: 0.85,
  });
  // Turret plate gets a finer texel density than the long hull sides. The
  // repeat MUST be a whole number here: the dome is a sphere whose U wraps,
  // and a fractional repeat leaves a visible seam running down the turret.
  const bodyFine = new THREE.MeshStandardMaterial({
    ...paint,
    normalMap: tiled(normal, 4, 4),
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tiled(rough, 4, 4),
    roughness: 0.72, metalness: 0.08, envMapIntensity: 0.85,
  });

  const dark = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    normalMap: tiled(normal, 3.0, 3.0),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.9, metalness: 0.3, envMapIntensity: 0.7,
  });

  // gun steel: darker, smoother, distinctly metal against the painted armour
  const gun = new THREE.MeshStandardMaterial({
    color: 0x34383e,
    normalMap: tiled(normal, 6, 1.5),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.42, metalness: 0.86, envMapIntensity: 1.15,
  });

  const rubber = new THREE.MeshStandardMaterial({
    color: 0x14161a, roughness: 0.97, metalness: 0.05, envMapIntensity: 0.4,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: team.accent, roughness: 0.35, metalness: 0.3,
    emissive: team.accent, emissiveIntensity: 0.35, envMapIntensity: 0.8,
  });

  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b1016, roughness: 0.12, metalness: 0.9, envMapIntensity: 1.6,
  });

  const tread = treadMaps();
  const track = new THREE.MeshStandardMaterial({
    map: tiled(tread.color, 1, 1),
    normalMap: tiled(tread.normal, 1, 1),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.85, metalness: 0.55, envMapIntensity: 0.65,
  });

  return { body, bodyFine, dark, gun, rubber, accent, glass, track };
}

// ── small geometry helpers ─────────────────────────────────────
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

/**
 * Merge a bucket of pre-transformed geometries into one mesh, or null.
 *
 * mergeGeometries() bails out (returns null, logs an error) if the batch mixes
 * indexed and non-indexed geometry — and it always does here, because
 * ExtrudeGeometry is non-indexed while Box/Cylinder are indexed. Flattening
 * everything to non-indexed first is what keeps the hull from silently
 * vanishing.
 */
function mergeInto(geos, material) {
  if (!geos.length) return null;
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  for (let i = 0; i < geos.length; i++) {
    if (flat[i] !== geos[i]) flat[i].dispose();
    geos[i].dispose();
  }
  if (!merged) return null;
  const m = new THREE.Mesh(merged, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── track belt ─────────────────────────────────────────────────
/**
 * Build the outline of a real track run: the convex hull of the front idler
 * and rear drive sprocket — two arcs joined by their external tangents. This
 * is what gives the belt its taut top run and flat ground run instead of the
 * flat box the tanks used to wear.
 *
 * Returns samples of { z, y, nz, ny, u } where u is cumulative arc length, so
 * the tread UVs follow the belt and scroll correctly around the curves.
 */
function beltPath(zFront, rFront, zRear, rRear, yc) {
  const d = zFront - zRear;
  // external tangent angle; guard the degenerate case where one wheel
  // swallows the other (never happens with sane builds, but the acos would NaN)
  const phi = Math.acos(clamp((rRear - rFront) / d, -1, 1));
  const pts = [];
  const push = (z, y, nz, ny) => pts.push({ z, y, nz, ny, u: 0 });

  const arc = (cz, r, a0, a1, steps) => {
    for (let i = 0; i <= steps; i++) {
      const a = lerp(a0, a1, i / steps);
      push(cz + Math.cos(a) * r, yc + Math.sin(a) * r, Math.cos(a), Math.sin(a));
    }
  };

  // nose: front idler, from the top tangent down around the front to the bottom
  arc(zFront, rFront, phi, -phi, 14);
  // ground run, front -> rear (normal is constant along an external tangent)
  push(zRear + Math.cos(-phi) * rRear, yc + Math.sin(-phi) * rRear, Math.cos(-phi), Math.sin(-phi));
  // rear sprocket, around the back
  arc(zRear, rRear, -phi, phi - Math.PI * 2, 16);
  // top run, rear -> front, closing on the start point
  push(zFront + Math.cos(phi) * rFront, yc + Math.sin(phi) * rFront, Math.cos(phi), Math.sin(phi));

  // cumulative arc length for the U coordinate
  let u = 0;
  for (let i = 1; i < pts.length; i++) {
    u += Math.hypot(pts[i].z - pts[i - 1].z, pts[i].y - pts[i - 1].y);
    pts[i].u = u;
  }
  return { pts, len: u };
}

/**
 * A closed track belt as real geometry: an outer tread face, an inner face,
 * and two sidewalls. UVs run along the belt so the tread can be scrolled by
 * offsetting the map.
 */
function trackBeltGeometry(path, width, thick, tile) {
  const { pts, len } = path;
  const n = pts.length;
  const hw = width / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  const uScale = Math.max(1, Math.round(len / tile)) / len;

  // 4 rings of vertices: outer-left, outer-right, inner-right, inner-left.
  // Walking them in order and stitching consecutive rings wraps the belt in
  // a single closed shell.
  const rings = [
    { off: 0, x: -hw, nx: 0, sign: 1 },
    { off: 0, x: hw, nx: 0, sign: 1 },
    { off: -thick, x: hw, nx: 0, sign: -1 },
    { off: -thick, x: -hw, nx: 0, sign: -1 },
  ];

  for (let ri = 0; ri < rings.length; ri++) {
    const R = rings[ri];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      pos.push(R.x, p.y + p.ny * R.off, p.z + p.nz * R.off);
      nrm.push(0, p.ny * R.sign, p.nz * R.sign);
      uv.push(p.u * uScale, ri === 0 || ri === 3 ? 0 : 1);
    }
  }

  const V = (ri, i) => ri * n + (i % n);
  for (let ri = 0; ri < 4; ri++) {
    const rn = (ri + 1) % 4;
    for (let i = 0; i < n - 1; i++) {
      const a = V(ri, i), b = V(ri, i + 1), c = V(rn, i + 1), d = V(rn, i);
      idx.push(a, b, c, a, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Full running gear for one side: belt, road wheels, drive sprocket, idler and
 * return rollers. Wheels are returned separately because they spin.
 */
function buildRunningGear(b, mats, side, out) {
  const hw = b.hullW / 2;
  const x = side * (hw + 0.55);
  const rW = clamp(b.hullH * 0.42, 0.68, 1.32);
  const rS = rW * 1.18;                       // drive sprocket, rear
  const rI = rW * 1.02;                       // idler, front
  const yc = rW + 0.06;
  const zF = b.hullL * 0.44, zR = -b.hullL * 0.44;
  const width = clamp(b.hullW * 0.22, 1.25, 2.0);
  const thick = 0.3;

  // belt
  const path = beltPath(zF, rI + thick * 0.5, zR, rS + thick * 0.5, yc);
  const beltGeo = trackBeltGeometry(path, width, thick, 0.92);
  beltGeo.translate(x, 0, 0);
  const belt = new THREE.Mesh(beltGeo, mats.track);
  belt.castShadow = true;
  belt.receiveShadow = true;
  out.group.add(belt);
  out.belts.push(belt);

  // road wheels — the build's wheel count finally means something again
  const count = Math.max(3, b.wheels || 5);
  const span = (zF - rI) - (zR + rS);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const z = (zR + rS) + span * t;
    const g = cyl(rW, rW, width * 0.62, 16);
    g.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(g, mats.rubber);
    wheel.position.set(x, yc, z);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    out.group.add(wheel);
    out.wheels.push(wheel);

    // hub cap so the wheel reads as machined rather than a rubber puck
    const hg = cyl(rW * 0.42, rW * 0.42, width * 0.66, 10);
    hg.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hg, mats.dark);
    hub.position.set(x, yc, z);
    hub.castShadow = true;
    out.group.add(hub);
    out.wheels.push(hub);
  }

  // drive sprocket (rear) — hub and teeth are one mesh: same material, same
  // centre, same rotation, so splitting them only bought extra draw calls
  const sproParts = [place(cyl(rS * 0.72, rS * 0.72, width * 0.5, 14), 0, 0, 0, 0, 0, Math.PI / 2)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    sproParts.push(place(box(0.26, 0.5, 0.26), 0, Math.sin(a) * rS * 0.86, Math.cos(a) * rS * 0.86));
  }
  const spro = mergeInto(sproParts, mats.dark);
  if (spro) {
    spro.position.set(x, yc, zR);
    out.group.add(spro);
    out.wheels.push(spro);
  }

  // idler (front)
  const ig = cyl(rI * 0.8, rI * 0.8, width * 0.5, 14);
  ig.rotateZ(Math.PI / 2);
  const idler = new THREE.Mesh(ig, mats.dark);
  idler.position.set(x, yc, zF);
  idler.castShadow = true;
  out.group.add(idler);
  out.wheels.push(idler);

  // return rollers along the top run
  const statics = [];
  for (let i = 0; i < 3; i++) {
    const z = lerp(zR + rS, zF - rI, (i + 0.5) / 3);
    statics.push(place(cyl(rW * 0.3, rW * 0.3, width * 0.42, 8), 0, yc + rW * 0.92, z, 0, 0, Math.PI / 2));
  }
  // fender over the top run — a thin lip, not the wing the first pass grew
  statics.push(place(box(width * 0.9, 0.12, b.hullL * 0.9), 0, yc + rW * 1.42, 0));
  const st = mergeInto(statics, mats.dark);
  if (st) { st.position.x = x; out.group.add(st); }

  return { rW, width, x, yc };
}

// ── hull ───────────────────────────────────────────────────────
/**
 * Per-chassis hull. The build flags drive the actual silhouette now: low
 * profile chassis get a long raked glacis and a shallow deck, plated ones get
 * a slab superstructure with bolt-on armour, and everything else lands in
 * between. Read at a glance, which the shared GLB blob could never do.
 */
function buildHull(b, mats, out) {
  const hw = b.hullW / 2, hl = b.hullL / 2, hh = b.hullH;
  const bodyGeos = [], darkGeos = [], accentGeos = [];
  // The turret rig is frozen at y = 1.5 + hullH + 0.2, so the hull floor has
  // to stay at 1.5 and the deck at 1.5 + hullH. Move this and the turret
  // detaches from the hull (and the muzzle moves, which is a mechanics change).
  const yFloor = 1.5;

  // side profile: a raked glacis, a deck, and a sloped tail
  const nose = b.lowProfile ? 0.52 : b.plated ? 0.34 : 0.42;  // glacis rake
  const tail = b.plated ? 0.22 : 0.3;
  const deckY = yFloor + hh;
  const noseDrop = b.lowProfile ? 0.18 : 0.3;

  // the two points that define the glacis; the add-on plate below is derived
  // from these same numbers so it lies flush instead of floating off the nose
  const gTopZ = hl - hl * nose * 0.9, gTopY = deckY;
  const gBotZ = hl, gBotY = yFloor + hh * noseDrop;

  const gdz0 = gBotZ - gTopZ, gdy0 = gBotY - gTopY;
  const gA = Math.atan2(-gdy0, gdz0);
  const gnY0 = Math.cos(gA), gnZ0 = Math.sin(gA); // glacis outward normal

  const shape = new THREE.Shape();
  shape.moveTo(-hl, yFloor);
  shape.lineTo(-hl, yFloor + hh * 0.5);
  shape.lineTo(-hl + hl * tail * 0.6, deckY);
  shape.lineTo(gTopZ, gTopY);
  // Upper and lower glacis meeting at a shallow break, built INTO the hull
  // profile. An earlier pass bolted a separate full-width plate onto the nose
  // instead; sitting proud of a face it already matched, it just read as a
  // fin floating off the front of every tank.
  shape.lineTo(gTopZ + gdz0 * 0.5 + gnZ0 * 0.2, gTopY + gdy0 * 0.5 + gnY0 * 0.2);
  shape.lineTo(gBotZ, gBotY);
  shape.lineTo(hl - 0.2, yFloor);
  shape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: b.hullW, bevelEnabled: false });
  // The shape is authored in XY (x = length, y = height) and extruded along
  // +Z (width). rotateY(-PI/2) is the one that lands it correctly:
  //   x -> +z  (nose stays the nose)   z -> -x  (width spans -hullW..0)
  // rotateY(+PI/2) instead maps x -> -z, which mirrors the hull front-to-back
  // so the glacis ends up on the tail, and leaves width at 0..hullW so the
  // whole body sits a full hull-width off centre.
  hullGeo.rotateY(-Math.PI / 2);
  hullGeo.translate(hw, 0, 0);
  bodyGeos.push(hullGeo);

  // belly plate below the deck, slightly inset — gives the hull a real bottom
  bodyGeos.push(place(box(b.hullW * 0.94, yFloor + 0.1, b.hullL * 0.96), 0, yFloor * 0.5, 0));

  const gdz = gdz0, gdy = gdy0, gAngle = gA;
  // tow eyes on the lower nose
  for (const s of [-1, 1]) {
    darkGeos.push(place(box(0.32, 0.32, 0.44), s * hw * 0.6, gBotY + 0.2, gBotZ - 0.16));
  }

  // driver's hatch + vision block on the deck
  darkGeos.push(place(cyl(0.52, 0.52, 0.16, 12), -hw * 0.42, deckY + 0.08, hl * 0.52));
  out.glass.push(place(box(0.5, 0.16, 0.1), -hw * 0.42, deckY + 0.16, hl * 0.62));

  // engine deck at the rear: louvred grilles and exhaust
  const deckZ = -hl * 0.66;
  for (let i = 0; i < 4; i++) {
    darkGeos.push(place(box(b.hullW * 0.62, 0.08, 0.22), 0, deckY + 0.06, deckZ + (i - 1.5) * 0.42));
  }
  for (const s of [-1, 1]) {
    darkGeos.push(place(cyl(0.26, 0.3, 1.5, 8), s * hw * 0.78, deckY + 0.1, -hl * 0.86, 0, 0, Math.PI / 2));
  }

  // stowage: bins along the fenders, spare track links on the glacis
  for (const s of [-1, 1]) {
    darkGeos.push(place(box(0.5, 0.62, b.hullL * 0.2), s * (hw + 0.1), deckY - 0.1, -hl * 0.3));
  }
  for (let i = 0; i < 4; i++) {
    darkGeos.push(place(box(1.0, 0.14, 0.3), hw * 0.1, deckY + 0.08, hl * 0.2 - i * 0.36));
  }

  // bolt-on armour + skirts on plated chassis
  if (b.plated) {
    const rW = clamp(hh * 0.42, 0.68, 1.32); // same road-wheel radius the gear uses
    for (const s of [-1, 1]) {
      // spaced armour bolted to the hull side
      bodyGeos.push(place(box(0.26, hh * 0.5, b.hullL * 0.68), s * (hw + 0.02), yFloor + hh * 0.58, 0));
      // side skirt: hangs DOWN over the track run rather than standing off the
      // hull as a billboard, which is what made it read as a floating slab
      bodyGeos.push(place(box(0.14, rW * 1.5, b.hullL * 0.82), s * (hw + 1.0), rW * 1.5, 0));
    }
    // applique block on the glacis face (the earlier flat bar sat at deck
    // height inside the hull, where nothing could ever see it)
    const ap = box(b.hullW * 0.34, 0.22, 0.9);
    ap.rotateX(-gAngle);
    ap.translate(0, gTopY + gdy * 0.62 + Math.cos(gAngle) * 0.2, gTopZ + gdz * 0.62 + Math.sin(gAngle) * 0.2);
    bodyGeos.push(ap);
  }

  // Headlights, seated ON the glacis. Hanging them at deck height off the
  // nose left them floating in clear air in front of the tank, because the
  // hull has already raked away to nothing by that Z.
  const gnY = Math.cos(gAngle), gnZ = Math.sin(gAngle); // glacis outward normal
  for (const s of [-1, 1]) {
    const lamp = box(0.62, 0.34, 0.16);
    lamp.rotateX(-gAngle);
    lamp.translate(
      s * hw * 0.62,
      gTopY + gdy * 0.34 + gnY * 0.14,
      gTopZ + gdz * 0.34 + gnZ * 0.14
    );
    accentGeos.push(lamp);
    // guard bar over each lamp
    const guard = box(0.7, 0.08, 0.1);
    guard.rotateX(-gAngle);
    guard.translate(
      s * hw * 0.62,
      gTopY + gdy * 0.34 + gnY * 0.3,
      gTopZ + gdz * 0.34 + gnZ * 0.3
    );
    darkGeos.push(guard);
  }
  accentGeos.push(place(box(0.22, 0.1, b.hullL * 0.5), hw * 0.86, deckY + 0.04, 0));
  accentGeos.push(place(box(0.22, 0.1, b.hullL * 0.5), -hw * 0.86, deckY + 0.04, 0));

  out.body.push(...bodyGeos);
  out.dark.push(...darkGeos);
  out.accent.push(...accentGeos);
  return { deckY, yFloor };
}

/** Hover chassis: plenum skirt, lift strips, intake pods, vents. */
function buildHoverBody(b, mats, out) {
  const hw = b.hullW / 2, hl = b.hullL / 2, hh = b.hullH;
  const yFloor = 1.5; // same frozen turret seating as the tracked hull
  const deckY = yFloor + hh;

  const shape = new THREE.Shape();
  shape.moveTo(-hl, yFloor);
  shape.lineTo(-hl + hl * 0.2, deckY);
  shape.lineTo(hl - hl * 0.44, deckY);
  shape.lineTo(hl, yFloor + hh * 0.22);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.hullW, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // see buildHull — the other sign mirrors and offsets
  g.translate(hw, 0, 0);
  out.body.push(g);

  // plenum skirt (kept at the original y=1.0 so the hover ride height reads
  // exactly as it did — this chassis floats, and the gap under it is the look)
  out.dark.push(place(box(b.hullW + 1.6, 1.1, b.hullL * 0.94), 0, 1.05, 0));

  // Lift glow as narrow strips along the skirt's underside edges. A single
  // full-footprint emissive slab just read as a glowing plank bolted to the
  // bottom of the tank.
  for (const s of [-1, 1]) {
    out.accent.push(place(box(0.42, 0.13, b.hullL * 0.86), s * (hw + 0.62), 0.5, 0));
    out.accent.push(place(box(0.12, 0.44, b.hullL * 0.78), s * (hw + 0.84), 1.15, 0));
    // thrust nacelles, running fore-aft rather than poking out sideways
    out.dark.push(place(cyl(0.78, 0.92, 2.0, 10), s * (hw + 0.5), 1.15, -hl * 0.5, Math.PI / 2));
    out.accent.push(place(cyl(0.58, 0.58, 0.18, 10), s * (hw + 0.5), 1.15, -hl * 0.5 - 1.05, Math.PI / 2));
  }
  // centre lift strip, short so it reads as a vent and not a floor panel
  out.accent.push(place(box(b.hullW * 0.42, 0.11, b.hullL * 0.44), 0, 0.5, 0));
  // deck vents
  for (let i = 0; i < 5; i++) {
    out.dark.push(place(box(b.hullW * 0.5, 0.07, 0.18), 0, deckY + 0.05, -hl * 0.7 + i * 0.34));
  }
  out.glass.push(place(box(0.6, 0.18, 0.12), -hw * 0.4, deckY + 0.16, hl * 0.4));
  return { deckY, yFloor };
}

// ── turret furniture ───────────────────────────────────────────
/**
 * Everything bolted to the turret that isn't the gun: cupola, hatches, vision
 * blocks, smoke launchers, stowage basket, antennae. Merged per material.
 */
export function turretFurniture(b, mats, turret) {
  const r = b.turretR;
  // actual roof height of each dome variant, so furniture sits ON the turret:
  // box is a 1.9-tall box lifted 0.92; angular is a 1.7-tall prism lifted 0.92;
  // the default is a hemisphere of radius r, whose surface at the cupola's
  // x-offset is r*0.9, not r.
  const top = b.boxTurret ? 1.87 : b.angular ? 1.77 : r * 0.9;
  const bodyG = [], darkG = [], glassG = [], accentG = [];

  // commander's cupola with a ring of vision blocks
  bodyG.push(place(cyl(r * 0.42, r * 0.46, 0.55, 12), -r * 0.42, top + 0.2, -r * 0.18));
  darkG.push(place(cyl(r * 0.38, r * 0.38, 0.12, 12), -r * 0.42, top + 0.53, -r * 0.18));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    glassG.push(place(
      box(0.2, 0.16, 0.08),
      -r * 0.42 + Math.sin(a) * r * 0.44, top + 0.3, -r * 0.18 + Math.cos(a) * r * 0.44,
      0, a, 0
    ));
  }

  // loader's hatch
  darkG.push(place(cyl(r * 0.34, r * 0.34, 0.12, 10), r * 0.46, top + 0.16, -r * 0.3));

  // smoke grenade launchers, angled out from the turret cheeks
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const g = cyl(0.13, 0.13, 0.62, 8);
      g.rotateX(Math.PI / 2);
      g.rotateY(s * 0.5);
      g.translate(s * (r * 0.82 - i * 0.05), top - 0.24, r * 0.36 + i * 0.3);
      darkG.push(g);
    }
  }

  // Rear stowage bustle — thin rails, reads as mesh at distance. It has to
  // sit against the turret's rear face and low enough to be carried by it;
  // pushed further back it just hovers in the air behind the tank.
  const bz = -r * 0.86;
  const by = top * 0.5;
  darkG.push(place(box(r * 1.25, 0.08, 0.06), 0, by - 0.24, bz - 0.5));
  darkG.push(place(box(r * 1.25, 0.08, 0.06), 0, by + 0.24, bz - 0.5));
  for (const s of [-1, 1]) {
    darkG.push(place(box(0.06, 0.52, 0.06), s * r * 0.6, by, bz - 0.5));
    darkG.push(place(box(0.06, 0.08, 0.54), s * r * 0.6, by + 0.24, bz - 0.24));
  }
  darkG.push(place(box(r * 1.15, 0.42, 0.44), 0, by, bz - 0.42));

  // antennae — two, different lengths, so the turret reads asymmetric
  darkG.push(place(cyl(0.035, 0.035, 3.4, 4), -r * 0.78, top + 1.6, -r * 0.5));
  darkG.push(place(cyl(0.03, 0.03, 2.3, 4), r * 0.7, top + 1.05, -r * 0.62));

  // rangefinder blister + team stripe across the turret roof
  bodyG.push(place(box(r * 0.5, 0.22, 0.4), r * 0.72, top + 0.02, r * 0.1));
  accentG.push(place(box(r * 1.1, 0.06, 0.22), 0, top + 0.03, -r * 0.62));

  for (const [geos, mat] of [[bodyG, mats.bodyFine], [darkG, mats.dark], [glassG, mats.glass], [accentG, mats.accent]]) {
    const m = mergeInto(geos, mat);
    if (m) turret.add(m);
  }
}

/**
 * Gun tube with a thermal sleeve, fume extractor and a ported muzzle brake —
 * the silhouette details that make a barrel read as a gun and not a pipe.
 */
export function buildGunTube(b, mats, barrel, ox) {
  const R = b.barrelR, L = b.barrelL, z0 = b.turretR * 0.4;
  const geos = [];

  // tapered tube
  geos.push(place(cyl(R, R * 1.28, L, 14), ox, 0, z0 + L / 2, Math.PI / 2));
  // thermal sleeve over the inner half
  geos.push(place(cyl(R * 1.5, R * 1.5, L * 0.46, 14), ox, 0, z0 + L * 0.27, Math.PI / 2));
  // fume extractor bulge
  geos.push(place(cyl(R * 1.85, R * 1.85, L * 0.1, 14), ox, 0, z0 + L * 0.62, Math.PI / 2));
  // muzzle brake with side ports
  geos.push(place(cyl(R * 1.75, R * 1.75, 0.95, 12), ox, 0, z0 + L - 0.45, Math.PI / 2));
  for (const s of [-1, 1]) {
    geos.push(place(box(R * 0.55, R * 2.2, 0.3), ox + s * R * 1.55, 0, z0 + L - 0.62));
    geos.push(place(box(R * 0.55, R * 2.2, 0.3), ox + s * R * 1.55, 0, z0 + L - 0.24));
  }
  // mantlet collar at the trunnion
  geos.push(place(cyl(R * 3.0, R * 3.4, 0.7, 12), ox, 0, z0 - 0.1, Math.PI / 2));

  const m = mergeInto(geos, mats.gun);
  if (m) barrel.add(m);
}

export { buildHull, buildHoverBody, buildRunningGear, mergeInto };
