// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Terrain builder: heightfield mesh w/ vertex-color painting, water or
 * lava plane, sky dome, and scattered collidable props per map spec.
 * Physics queries (heightAt / normalAt) evaluate the SAME analytic
 * height function used to displace vertices.
 */

import * as THREE from "three";
import { WORLD_SIZE, makeHeightFn } from "./maps.js";
import { seededRng, clamp, lerp } from "./util.js";

const GRID = 220; // segments per side

export function buildWorld(map) {
  const group = new THREE.Group();
  const baseHeightAt = makeHeightFn(map);

  // ── terrain mesh ─────────────────────────────────────────────
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID, GRID);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const pal = map.palette;

  // ── dynamic crater field ─────────────────────────────────────
  // A per-vertex height offset grid layered on top of the analytic
  // base height. Both the mesh AND the physics height query read it,
  // so shell craters are real terrain — tanks sink into them, shells
  // arc into them, the battlefield scars as the fight goes on.
  const GRIDN = GRID + 1;
  const offsets = new Float32Array(GRIDN * GRIDN);
  // robustly recover the regular grid mapping straight from the verts
  const X0 = pos.getX(0), XStep = pos.getX(1) - pos.getX(0);
  const Z0 = pos.getZ(0), ZStep = pos.getZ(GRIDN) - pos.getZ(0);
  const colOf = (x) => (x - X0) / XStep;
  const rowOf = (z) => (z - Z0) / ZStep;

  function sampleOffset(x, z) {
    const fc = colOf(x), fr = rowOf(z);
    if (fc < 0 || fc > GRID || fr < 0 || fr > GRID) return 0;
    const c0 = fc | 0, r0 = fr | 0;
    const c1 = Math.min(GRID, c0 + 1), r1 = Math.min(GRID, r0 + 1);
    const tc = fc - c0, tr = fr - r0;
    const o = offsets;
    const a = o[r0 * GRIDN + c0], b = o[r0 * GRIDN + c1];
    const c = o[r1 * GRIDN + c0], d = o[r1 * GRIDN + c1];
    return lerp(lerp(a, b, tc), lerp(c, d, tc), tr);
  }

  const heightAt = (x, z) => baseHeightAt(x, z) + sampleOffset(x, z);

  const normalAt = (x, z, out = new THREE.Vector3()) => {
    const e = 1.6;
    const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
    const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = baseHeightAt(x, z);
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;

  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const up = nrm.getY(i); // 1 = flat, 0 = cliff
    // palette ramp by height
    let c0 = pal[0], c1 = pal[pal.length - 1];
    for (let p = 0; p < pal.length - 1; p++) {
      if (h >= pal[p].h && h <= pal[p + 1].h) { c0 = pal[p]; c1 = pal[p + 1]; break; }
      if (h > pal[pal.length - 1].h) { c0 = c1 = pal[pal.length - 1]; }
    }
    const t = c1.h === c0.h ? 0 : clamp((h - c0.h) / (c1.h - c0.h), 0, 1);
    let r = lerp(c0.c[0], c1.c[0], t);
    let g = lerp(c0.c[1], c1.c[1], t);
    let b = lerp(c0.c[2], c1.c[2], t);
    // steep slopes blend to rock color
    const steep = clamp((0.82 - up) * 3.2, 0, 1);
    r = lerp(r, map.slopeColor[0], steep);
    g = lerp(g, map.slopeColor[1], steep);
    b = lerp(b, map.slopeColor[2], steep);
    // subtle macro variation
    const v = 0.94 + 0.06 * Math.sin(i * 0.37);
    colors[i * 3] = r * v;
    colors[i * 3 + 1] = g * v;
    colors[i * 3 + 2] = b * v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const colorAttr = geo.attributes.color;

  // Carve a crater: deepen the offset grid in a radius, scorch the
  // vertex colors, then re-displace + re-normal ONLY the touched
  // block of vertices (rows are contiguous, so one upload range).
  const scorch = map.slopeColor.map((v) => v * 0.32);
  function deform(cx, cz, radius, depth, opts = {}) {
    if (radius <= 0 || depth <= 0) return;
    const sc = opts.scorch ?? scorch;
    const spanC = Math.ceil(radius / Math.abs(XStep)) + 1;
    const spanR = Math.ceil(radius / Math.abs(ZStep)) + 1;
    const cc = Math.round(colOf(cx)), rc = Math.round(rowOf(cz));
    const cLo = clamp(cc - spanC, 0, GRID), cHi = clamp(cc + spanC, 0, GRID);
    const rLo = clamp(rc - spanR, 0, GRID), rHi = clamp(rc + spanR, 0, GRID);
    if (cLo > cHi || rLo > rHi) return;

    // pass 1: accumulate offsets (so pass-2 normals see final heights)
    for (let r = rLo; r <= rHi; r++) {
      for (let c = cLo; c <= cHi; c++) {
        const idx = r * GRIDN + c;
        const dx = pos.getX(idx) - cx, dz = pos.getZ(idx) - cz;
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const q = d / radius;
        const bowl = -depth * (Math.cos(Math.min(1, q) * Math.PI) * 0.5 + 0.5);
        const rim = depth * 0.05 * Math.exp(-(((q - 0.95) / 0.2) ** 2));
        offsets[idx] = clamp(offsets[idx] + bowl + rim, -90, 60);
      }
    }
    // pass 2: re-displace mesh, scorch color, recompute analytic normals
    const e = Math.max(Math.abs(XStep), Math.abs(ZStep));
    for (let r = rLo; r <= rHi; r++) {
      for (let c = cLo; c <= cHi; c++) {
        const idx = r * GRIDN + c;
        const x = pos.getX(idx), z = pos.getZ(idx);
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        pos.setY(idx, baseHeightAt(x, z) + offsets[idx]);
        const burn = clamp((1 - d / radius) * (opts.burn ?? 0.85), 0, 0.92);
        const j = idx * 3;
        colors[j] = lerp(colors[j], sc[0], burn);
        colors[j + 1] = lerp(colors[j + 1], sc[1], burn);
        colors[j + 2] = lerp(colors[j + 2], sc[2], burn);
        const nx = heightAt(x - e, z) - heightAt(x + e, z);
        const nz = heightAt(x, z - e) - heightAt(x, z + e);
        const inv = 1 / Math.hypot(nx, 2 * e, nz);
        nrm.setXYZ(idx, nx * inv, 2 * e * inv, nz * inv);
      }
    }
    // contiguous vertex span (whole rows rLo..rHi) → one upload range
    const start = rLo * GRIDN;
    const count = (rHi - rLo + 1) * GRIDN;
    markRange(pos, start, count);
    markRange(nrm, start, count);
    markRange(colorAttr, start, count);
  }

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
    map: detailTexture(),
  });
  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = "terrain";
  group.add(terrainMesh);

  // Neon Rift: glowing wireframe overlay on the terrain. Shares the
  // SAME geometry as the terrain so craters deform both in lockstep.
  if (map.wireframeGlow) {
    const wire = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: map.wireframeGlow,
        wireframe: true,
        transparent: true,
        opacity: 0.17,
      })
    );
    wire.position.y += 0.25;
    group.add(wire);
  }

  // ── water / lava plane ───────────────────────────────────────
  let waterMesh = null;
  if (map.water) {
    const w = map.water;
    const wmat = new THREE.MeshStandardMaterial({
      color: w.color,
      transparent: true,
      opacity: w.opacity,
      roughness: w.frozen ? 0.25 : 0.4,
      metalness: w.frozen ? 0.35 : 0.1,
      emissive: w.emissive ? w.color : 0x000000,
      emissiveIntensity: w.emissive ?? 0,
    });
    waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 48, 48), wmat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = w.level;
    waterMesh.name = "water";
    group.add(waterMesh);
  }

  // ── sky dome (gradient shader) + sun glow sprite ─────────────
  const sky = makeSkyDome(map);
  group.add(sky);

  // ── clouds for daylight maps ─────────────────────────────────
  if (!map.stars && !map.embers) group.add(buildClouds(map));

  // ── grass for the green map ──────────────────────────────────
  if (map.grass) group.add(buildGrass(map, heightAt));

  // ── props ────────────────────────────────────────────────────
  const obstacles = []; // { x, z, r, h } cylinders for collision
  const propGroup = buildProps(map, heightAt, obstacles);
  group.add(propGroup);

  return { group, heightAt, normalAt, obstacles, waterMesh, terrainMesh, deform };
}

// Flag a contiguous run of vertices for GPU re-upload (partial range so
// a crater never re-uploads the whole 48k-vertex terrain buffer).
function markRange(attr, start, count) {
  attr.needsUpdate = true;
  attr.clearUpdateRanges?.();
  if (attr.addUpdateRange) attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize);
  else attr.updateRange = { offset: start * attr.itemSize, count: count * attr.itemSize };
}

// ── shared micro-noise detail texture (multiplies vertex colors) ──
let _detailTex = null;
function detailTexture() {
  if (_detailTex) return _detailTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 225 + Math.random() * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _detailTex = new THREE.CanvasTexture(c);
  _detailTex.wrapS = _detailTex.wrapT = THREE.RepeatWrapping;
  _detailTex.repeat.set(110, 110);
  return _detailTex;
}

// ── soft billboard clouds ──────────────────────────────────────
let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d");
  for (let i = 0; i < 16; i++) {
    const x = 30 + Math.random() * 196, y = 40 + Math.random() * 50;
    const r = 18 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  _cloudTex = new THREE.CanvasTexture(c);
  return _cloudTex;
}

function buildClouds(map) {
  const g = new THREE.Group();
  g.name = "clouds";
  const rng = seededRng(map.seed * 3 + 5);
  const mat = new THREE.SpriteMaterial({
    map: cloudTexture(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(mat);
    const a = rng() * Math.PI * 2, r = 300 + rng() * 900;
    s.position.set(Math.cos(a) * r, 200 + rng() * 130, Math.sin(a) * r);
    s.scale.set(260 + rng() * 260, 80 + rng() * 70, 1);
    g.add(s);
  }
  return g;
}

// ── instanced grass tufts (Verdant Vale) ───────────────────────
function buildGrass(map, heightAt) {
  const rng = seededRng(map.seed * 11 + 3);
  const blade = new THREE.PlaneGeometry(2.4, 2.6);
  blade.translate(0, 1.1, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3f7a2e,
    side: THREE.DoubleSide,
    roughness: 1,
    alphaTest: 0.0,
  });
  const COUNT = 2600;
  const inst = new THREE.InstancedMesh(blade, mat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < COUNT && guard++ < COUNT * 5) {
    const x = (rng() * 2 - 1) * WORLD_SIZE * 0.45;
    const z = (rng() * 2 - 1) * WORLD_SIZE * 0.45;
    const y = heightAt(x, z);
    if (y < 2 || y > 46) continue; // grass band only
    q.setFromAxisAngle(up, rng() * Math.PI);
    const s = 0.7 + rng() * 0.9;
    m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s, s, s));
    inst.setMatrixAt(placed, m);
    color.setHSL(0.27 + rng() * 0.05, 0.55, 0.26 + rng() * 0.12);
    inst.setColorAt(placed, color);
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.name = "grass";
  return inst;
}

function makeSkyDome(map) {
  const geo = new THREE.SphereGeometry(2400, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(map.sky.top) },
      horizon: { value: new THREE.Color(map.sky.horizon) },
      sunColor: { value: new THREE.Color(map.sky.sun) },
      sunDir: { value: new THREE.Vector3(...map.sky.sunPos).normalize() },
      stars: { value: map.stars ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 top, horizon, sunColor, sunDir;
      uniform float stars;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float t = clamp(vDir.y * 1.6 + 0.18, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.8));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += sunColor * (pow(s, 600.0) * 2.2 + pow(s, 18.0) * 0.45);
        if (stars > 0.5 && vDir.y > 0.02) {
          vec2 sp = vDir.xz / max(vDir.y, 0.05) * 60.0;
          float st = step(0.9975, hash(floor(sp)));
          col += vec3(st) * smoothstep(0.02, 0.3, vDir.y);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = "sky";
  return dome;
}

// ── prop kits per map ──────────────────────────────────────────
function buildProps(map, heightAt, obstacles) {
  const g = new THREE.Group();
  g.name = "props";
  const rng = seededRng(map.seed * 7 + 13);
  const spec = map.propsSpec;
  if (!spec) return g;

  const placements = [];
  let guard = 0;
  while (placements.length < spec.count && guard++ < spec.count * 14) {
    const x = (rng() * 2 - 1) * WORLD_SIZE * 0.44;
    const z = (rng() * 2 - 1) * WORLD_SIZE * 0.44;
    if (Math.hypot(x, z) < 70) continue; // keep center clear
    const y = heightAt(x, z);
    if (map.water && y < map.water.level + 1.5) continue;
    placements.push({ x, z, y, r: rng });
  }

  // shared geometries/materials per kit (instancing-light approach:
  // merged groups of simple meshes — prop counts are modest)
  for (const p of placements) {
    const v = rng();
    let mesh = null, radius = 0, height = 0;
    switch (spec.kind) {
      case "rocks+cacti":
        if (v < 0.62) { mesh = rock(rng, 0x9a7b52); radius = 4.4; height = 6; }
        else { mesh = cactus(rng); radius = 1.6; height = 9; }
        break;
      case "pines+boulders":
        if (v < 0.7) { mesh = pine(rng); radius = 2.2; height = 18; }
        else { mesh = rock(rng, 0x8d9aa8); radius = 5; height = 7; }
        break;
      case "trees+stones":
        if (v < 0.6) { mesh = broadleaf(rng); radius = 2.6; height = 14; }
        else if (v < 0.85) { mesh = rock(rng, 0x7d8579); radius = 4; height = 5; }
        else { mesh = standingStone(rng); radius = 2.4; height = 13; }
        break;
      case "spires":
        mesh = spire(rng); radius = 3.2; height = 16 + rng() * 14;
        break;
      case "monoliths":
        mesh = monolith(rng); radius = 3; height = 18 + rng() * 16;
        break;
    }
    if (!mesh) continue;
    mesh.position.set(p.x, p.y - 0.4, p.z);
    mesh.rotation.y = rng() * Math.PI * 2;
    const s = 0.8 + rng() * 0.7;
    mesh.scale.setScalar(s);
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(mesh);
    obstacles.push({ x: p.x, z: p.z, r: radius * s, h: height * s, y: p.y });
  }
  return g;
}

const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });

function rock(rng, color) {
  const geo = new THREE.IcosahedronGeometry(4 + rng() * 3, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * (0.75 + rng() * 0.5), pos.getY(i) * (0.55 + rng() * 0.4), pos.getZ(i) * (0.75 + rng() * 0.5));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, M(color, { flatShading: true }));
}

function cactus(rng) {
  const grp = new THREE.Group();
  const mat = M(0x3f7a3a);
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 7, 4, 8), mat);
  trunk.position.y = 4.5;
  grp.add(trunk);
  const arms = 1 + ((rng() * 2) | 0);
  for (let i = 0; i < arms; i++) {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 3, 4, 8), mat);
    const side = i % 2 ? 1 : -1;
    a.position.set(side * 1.6, 4 + rng() * 2.5, 0);
    a.rotation.z = side * -0.5;
    grp.add(a);
  }
  return grp;
}

function pine(rng) {
  const grp = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 6, 7), M(0x4a3526));
  trunk.position.y = 3;
  grp.add(trunk);
  const green = M(0x1e3d2f);
  let y = 5, r = 5.2;
  for (let i = 0; i < 4; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 6.5, 8), green);
    cone.position.y = y;
    grp.add(cone);
    y += 3.4; r *= 0.72;
  }
  // snow dusting
  const snow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 8), M(0xeef4fa, { roughness: 0.6 }));
  snow.position.y = y + 0.4;
  grp.add(snow);
  return grp;
}

function broadleaf(rng) {
  const grp = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 7, 7), M(0x5b4530));
  trunk.position.y = 3.5;
  grp.add(trunk);
  const leaf = M(0x2f6b2a);
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4 - i * 0.5, 1), leaf);
    blob.position.set((rng() - 0.5) * 3, 8 + i * 2.2, (rng() - 0.5) * 3);
    grp.add(blob);
  }
  return grp;
}

function standingStone(rng) {
  const geo = new THREE.BoxGeometry(2.6, 12, 1.8);
  const m = new THREE.Mesh(geo, M(0x6e7370, { flatShading: true }));
  m.position.y = 5.4;
  m.rotation.z = (rng() - 0.5) * 0.16;
  return m;
}

function spire(rng) {
  const h = 14 + rng() * 16;
  const geo = new THREE.ConeGeometry(2.6 + rng() * 1.6, h, 6);
  const m = new THREE.Mesh(geo, M(0x241a18, { flatShading: true, emissive: 0x661a08, emissiveIntensity: 0.18 }));
  m.position.y = h / 2 - 1;
  return m;
}

function monolith(rng) {
  const grp = new THREE.Group();
  const h = 16 + rng() * 16;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, h, 3.4),
    M(0x130a24, { roughness: 0.4, metalness: 0.6 })
  );
  body.position.y = h / 2 - 1;
  grp.add(body);
  const glowColor = rng() > 0.5 ? 0xff2e88 : 0x21e6ff;
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, h * 0.8, 0.2),
    new THREE.MeshBasicMaterial({ color: glowColor })
  );
  strip.position.set(0, h / 2 - 1, 1.75);
  grp.add(strip);
  const strip2 = strip.clone();
  strip2.position.z = -1.75;
  grp.add(strip2);
  return grp;
}
