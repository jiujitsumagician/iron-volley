// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Runtime menu thumbnails: hero renders of each tank and a vista of
 * each map, produced by a small offscreen renderer and cached as data
 * URLs. No image assets — the previews always match the actual game.
 */

import * as THREE from "three";
import { buildTankMesh } from "./tank.js";
import { chassisById, TEAM_COLORS, skinById } from "./tanks.js";
import { mapById, makeHeightFn, WORLD_SIZE } from "./maps.js";
import { clamp, lerp } from "./util.js";

const W = 300, H = 170;
let renderer = null;
const cache = new Map();

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

function snap(scene, cam) {
  const r = getRenderer();
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/png");
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
    }
  });
  return url;
}

/** Hero shot of a chassis on a display plinth (optionally in a skin). */
export function tankThumb(chassisId, skinId = null) {
  const key = `tank:${chassisId}:${skinId ?? "factory"}`;
  if (cache.has(key)) return cache.get(key);

  const chassis = chassisById(chassisId);
  const skin = skinId ? skinById(skinId) : null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151d);
  scene.fog = new THREE.Fog(0x10151d, 40, 90);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x21160c, 1.1));
  const key1 = new THREE.DirectionalLight(0xfff1d6, 2.6);
  key1.position.set(18, 22, 14);
  scene.add(key1);
  const rim = new THREE.DirectionalLight(0x6fb4ff, 1.6);
  rim.position.set(-16, 10, -18);
  scene.add(rim);

  // floor disc
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 40),
    new THREE.MeshStandardMaterial({ color: 0x1a212b, roughness: 0.6, metalness: 0.3 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const tank = buildTankMesh(chassis.build, TEAM_COLORS[0], skin);
  tank.rotation.y = 2.45; // 3/4 hero angle, barrel sweeping toward camera-left
  const barrel = tank.getObjectByName("barrel");
  if (barrel) barrel.rotation.x = -0.2;
  scene.add(tank);

  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
  const s = 0.65 + 0.35 * (chassis.build.hullL / 12); // frame larger chassis
  cam.position.set(11.5 * s, 6.5 * s, 13.5 * s);
  cam.lookAt(0, 3.4, 0);

  const url = snap(scene, cam);
  cache.set(key, url);
  return url;
}

/** Aerial vista of a map (low-res terrain + sky + water, no props). */
export function mapThumb(mapId) {
  const key = `map:${mapId}`;
  if (cache.has(key)) return cache.get(key);

  const map = mapById(mapId);
  const heightAt = makeHeightFn(map);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(map.fog.color, map.fog.near * 0.8, map.fog.far);

  scene.add(new THREE.HemisphereLight(map.hemi.sky, map.hemi.ground, map.hemi.intensity * 1.1));
  const sun = new THREE.DirectionalLight(map.sunlight.color, map.sunlight.intensity);
  sun.position.set(...map.sky.sunPos).multiplyScalar(700);
  scene.add(sun);

  // low-res terrain with the same palette logic as the real one
  const GRID = 90;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID, GRID);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const pal = map.palette;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i), up = nrm.getY(i);
    let c0 = pal[0], c1 = pal[pal.length - 1];
    for (let p = 0; p < pal.length - 1; p++) {
      if (h >= pal[p].h && h <= pal[p + 1].h) { c0 = pal[p]; c1 = pal[p + 1]; break; }
      if (h > pal[pal.length - 1].h) c0 = c1 = pal[pal.length - 1];
    }
    const t = c1.h === c0.h ? 0 : clamp((h - c0.h) / (c1.h - c0.h), 0, 1);
    const steep = clamp((0.82 - up) * 3.2, 0, 1);
    colors[i * 3] = lerp(lerp(c0.c[0], c1.c[0], t), map.slopeColor[0], steep);
    colors[i * 3 + 1] = lerp(lerp(c0.c[1], c1.c[1], t), map.slopeColor[1], steep);
    colors[i * 3 + 2] = lerp(lerp(c0.c[2], c1.c[2], t), map.slopeColor[2], steep);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));

  if (map.water) {
    const w = map.water;
    const wm = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({
        color: w.color, transparent: true, opacity: w.opacity,
        emissive: w.emissive ? w.color : 0x000000,
        emissiveIntensity: w.emissive ?? 0,
      })
    );
    wm.rotation.x = -Math.PI / 2;
    wm.position.y = w.level;
    scene.add(wm);
  }

  // simple gradient sky via large background sphere
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2300, 16, 10),
    new THREE.MeshBasicMaterial({ color: map.sky.horizon, side: THREE.BackSide, fog: false })
  );
  scene.add(sky);

  const cam = new THREE.PerspectiveCamera(52, W / H, 1, 4000);
  cam.position.set(-WORLD_SIZE * 0.32, 210, WORLD_SIZE * 0.42);
  cam.lookAt(60, 0, -120);

  const url = snap(scene, cam);
  cache.set(key, url);
  return url;
}
