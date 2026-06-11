// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Discoverable ammo crates. A few live on the map at a time, marked by
 * a colored light pillar; drive through one to load that special round.
 * Taken crates respawn elsewhere after a delay.
 */

import * as THREE from "three";
import { ROUND_TYPES } from "./weapons.js";
import { WORLD_SIZE } from "./maps.js";
import { pick, rand } from "./util.js";

const SPECIALS = ["scatter", "laser", "nuke", "incendiary", "gravity", "railgun", "barrage", "emp", "bouncer"];

/**
 * Pure crate visual (no logic) — shared with the online guest, which
 * renders crates from host snapshots without running pickup logic.
 */
export function crateVisual(type) {
  const def = ROUND_TYPES[type];
  const group = new THREE.Group();
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 3.2, 3.2),
    new THREE.MeshStandardMaterial({
      color: 0x222a33, roughness: 0.5, metalness: 0.55,
      emissive: def.color, emissiveIntensity: 0.35,
    })
  );
  crate.castShadow = true;
  crate.position.y = 2.6;
  group.add(crate);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 3.5, 3.5),
    new THREE.MeshBasicMaterial({ color: def.color, wireframe: true })
  );
  frame.position.y = 2.6;
  group.add(frame);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.8, 70, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: def.color, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  pillar.position.y = 35;
  group.add(pillar);
  return { group, crate, frame };
}
const ACTIVE_COUNT = 5;
const RESPAWN_DELAY = 16;

export class Pickups {
  constructor({ scene, world, effects, audio, events }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.events = events;
    this.crates = [];
    this.pendingRespawns = [];
    this.t = 0;
    // Fixed pool of beacon lights, added once and never removed. Adding or
    // removing a light changes the scene's active-light count, which makes
    // Three.js recompile every material — a freeze on every crate pickup /
    // respawn. A constant count compiles once. Crates borrow a slot.
    this.lightPool = [];
    this.freeLights = [];
    for (let i = 0; i < ACTIVE_COUNT; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40);
      l.visible = true;
      this.scene.add(l);
      this.lightPool.push(l);
      this.freeLights.push(i);
    }
    for (let i = 0; i < ACTIVE_COUNT; i++) this.spawnCrate(i === 0 ? "scatter" : null);
  }

  spawnCrate(forceType = null) {
    const type = forceType ?? pick(SPECIALS);
    const def = ROUND_TYPES[type];
    // find a reasonably flat, dry spot
    let x = 0, z = 0, y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = rand(-1, 1) * WORLD_SIZE * 0.4;
      z = rand(-1, 1) * WORLD_SIZE * 0.4;
      y = this.world.heightAt(x, z);
      const n = this.world.normalAt(x, z);
      const wet = this.world.map.water && y < this.world.map.water.level + 2;
      if (n.y > 0.86 && !wet) break;
    }

    const { group, crate, frame } = crateVisual(type);

    // borrow a pooled beacon light (no add/remove → no shader recompile)
    const lightIndex = this.freeLights.pop();
    if (lightIndex != null) {
      const l = this.lightPool[lightIndex];
      l.position.set(x, y + 5, z);
      l.color.setHex(def.color);
      l.intensity = 60;
    }

    group.position.set(x, y, z);
    this.scene.add(group);
    this.crates.push({ type, group, crate, frame, x, z, y, taken: false, lightIndex });
  }

  update(dt) {
    this.t += dt;
    // bob + spin
    for (const c of this.crates) {
      c.crate.rotation.y += dt * 0.9;
      c.frame.rotation.y -= dt * 0.6;
      c.crate.position.y = 2.6 + Math.sin(this.t * 2 + c.x) * 0.5;
      c.frame.position.y = c.crate.position.y;
    }
    // collect
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      for (const tank of this.world.tanks) {
        if (!tank.alive) continue;
        const dx = tank.pos.x - c.x, dz = tank.pos.z - c.z;
        if (dx * dx + dz * dz < 42) {
          const def = ROUND_TYPES[c.type];
          tank.special = { type: c.type, ammo: def.ammo };
          this.audio.pickup({});
          this.effects.shockRing(new THREE.Vector3(c.x, c.y + 0.5, c.z), 12, def.color);
          this.events.onPickup?.(tank, c.type);
          this.scene.remove(c.group);
          if (c.lightIndex != null) {
            this.lightPool[c.lightIndex].intensity = 0; // free the beacon slot
            this.freeLights.push(c.lightIndex);
          }
          this.crates.splice(i, 1);
          this.pendingRespawns.push(this.t + RESPAWN_DELAY);
          break;
        }
      }
    }
    // respawn
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      if (this.t >= this.pendingRespawns[i]) {
        this.pendingRespawns.splice(i, 1);
        this.spawnCrate();
      }
    }
  }

  clear() {
    for (const c of this.crates) this.scene.remove(c.group);
    for (const l of this.lightPool) this.scene.remove(l);
    this.lightPool.length = 0;
    this.freeLights.length = 0;
    this.crates.length = 0;
    this.pendingRespawns.length = 0;
  }
}
