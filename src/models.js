// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Cosmetic GLB model cache (CC0 assets). Fully fail-safe: any load error
 * leaves that model simply absent and callers fall back to procedural
 * geometry. NOTHING here touches gameplay — these are visual meshes only.
 *
 * preloadModels() is awaited once at boot; getModel(name) returns a fresh
 * deep clone (or null). Source GLBs come in wildly different units, so we
 * record each model's loaded bounding box and expose scale helpers that fit
 * a clone to a target footprint radius / height in world units.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// name -> { group:THREE.Group, size:THREE.Vector3, base:number }
const _cache = new Map();

// Every GLB we wire. Anything that fails just stays out of the cache.
const MANIFEST = {
  tree_broadleaf: "assets/models/tree_02.glb",
  tree_dead: "assets/models/dead_tree_01.glb",
  pine_a: "assets/models/pine_tree_01.glb",
  pine_b: "assets/models/pine_tree_02.glb",
  rock_a: "assets/models/rock_01.glb",
  rock_b: "assets/models/rock_02.glb",
  boulder_a: "assets/models/boulder_01.glb",
  boulder_b: "assets/models/boulder_02.glb",
  bush: "assets/models/bush_01.glb",
  shrub: "assets/models/shrub_01.glb",
  stump: "assets/models/stump_01.glb",
  vehicle: "assets/models/vehicle_quaternius.glb",
};

export async function preloadModels() {
  let loader;
  try {
    loader = new GLTFLoader();
  } catch {
    return; // GLTFLoader unavailable -> everything falls back procedurally
  }
  await Promise.all(
    Object.entries(MANIFEST).map(([name, url]) =>
      load(loader, url)
        .then((gltf) => store(name, gltf))
        .catch(() => { /* absent -> procedural fallback */ })
    )
  );
}

function load(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function store(name, gltf) {
  const group = gltf.scene || gltf.scenes?.[0];
  if (!group) return;
  // Bake shadows + sanity on materials; normalize so the model rests on y=0
  // centered on XZ, with a known unit size for later scaling.
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!isFinite(size.x) || size.x <= 0 || size.y <= 0 || size.z <= 0) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  // shift so XZ is centered and the base sits at y=0
  group.position.set(-center.x, -box.min.y, -center.z);
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = true;
    }
  });
  _cache.set(name, { group, size: size.clone(), base: box.min.y });
}

/** Fresh deep clone of a cached model, or null if absent. */
export function getModel(name) {
  const entry = _cache.get(name);
  if (!entry) return null;
  return entry.group.clone(true);
}

/** Loaded XZ footprint radius (world units) of a cached model, or 0. */
export function modelFootprint(name) {
  const e = _cache.get(name);
  if (!e) return 0;
  return Math.max(e.size.x, e.size.z) * 0.5;
}

/** Loaded height (world units) of a cached model, or 0. */
export function modelHeight(name) {
  const e = _cache.get(name);
  return e ? e.size.y : 0;
}

/**
 * Clone `name` and uniformly scale it so its visual XZ footprint roughly
 * matches `targetRadius` world units (the prop's collider radius). Returns
 * null if the model is absent. Cosmetic only — the collider is unchanged.
 */
export function getModelForRadius(name, targetRadius) {
  const e = _cache.get(name);
  if (!e) return null;
  const m = e.group.clone(true);
  const r = Math.max(e.size.x, e.size.z) * 0.5;
  if (r > 0.0001 && isFinite(targetRadius) && targetRadius > 0) {
    m.scale.setScalar(targetRadius / r);
  }
  return m;
}
