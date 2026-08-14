// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Tank entity: procedural chassis mesh (hull + turret + barrel + MG),
 * arcade physics over the heightfield, turret aiming, weapon state.
 * Used identically by players and AI — control inputs arrive via
 * tank.input = { throttle, steer, turretTurn, pitch, fire, mg }.
 */

import * as THREE from "three";
import { clamp, lerp, angleDelta } from "./util.js";
import { WORLD_SIZE } from "./maps.js";
import {
  tankMaterials, buildHull, buildHoverBody, buildRunningGear,
  turretFurniture, buildGunTube, mergeInto,
} from "./tankart.js";

// hard playable boundary — sits just inside the rim wall's base. With the
// new climb-through traction a tank could otherwise crest the rim ramp and
// escape onto the flat plateau beyond the world; this is the backstop.
const RIM_RADIUS = WORLD_SIZE * 0.45;

const UP = new THREE.Vector3(0, 1, 0);
// reused scratch — tank.update runs for every tank every frame, so
// allocating fresh vectors/matrices here was steady GC pressure (a
// prime suspect for the periodic frame hitches)
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _f2 = new THREE.Vector3();
const _basisN = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _dirQuat = new THREE.Quaternion();

export class Tank {
  constructor({ chassis, team, name, isBot = false, faction = null, skin = null }) {
    this.chassis = chassis;
    this.team = team;
    this.name = name;
    this.isBot = isBot;
    this.faction = faction; // damage/minimap allegiance (null = lone)
    this.skin = skin;
    this.stunnedUntil = 0; // EMP

    const s = chassis.stats;
    this.hp = s.hp;
    this.maxHp = s.hp;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;

    // pose
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.turretYaw = 0; // relative to hull
    this.barrelPitch = 0.18; // radians above horizontal
    this.vel = new THREE.Vector3();

    // weapons
    this.reloadLeft = 0;
    this.mgHeat = 0;
    this.mgCooldown = 0;
    this.special = null; // { type, ammo }
    this.fireRequested = false;
    this.mgFiring = false;

    // control state (written by player input or AI each frame)
    this.input = { throttle: 0, steer: 0, turretTurn: 0, pitch: 0, fire: false, mg: false };

    this.respawnTimer = 0;
    this.smokeAcc = 0;

    this.root = buildTankMesh(chassis.build, team, skin);
    this.turret = this.root.getObjectByName("turret");
    this.barrel = this.root.getObjectByName("barrel");
    this.muzzle = this.root.getObjectByName("muzzle");
    this.mgMuzzle = this.root.getObjectByName("mgMuzzle");
    this.wheels = this.root.userData.wheels ?? [];
  }

  /** World position of the cannon muzzle. */
  muzzleWorld(out = new THREE.Vector3()) {
    return this.muzzle.getWorldPosition(out);
  }

  /** World direction the cannon points. */
  muzzleDir(out = new THREE.Vector3()) {
    out.set(0, 0, 1).applyQuaternion(this.barrel.getWorldQuaternion(_dirQuat));
    return out.normalize();
  }

  mgMuzzleWorld(out = new THREE.Vector3()) {
    return this.mgMuzzle.getWorldPosition(out);
  }

  absoluteTurretYaw() {
    return this.yaw + this.turretYaw;
  }

  update(dt, world) {
    if (!this.alive) return;
    const s = this.chassis.stats;
    const inp = this.input;

    // EMP: a stunned tank is a paperweight — no drive, no turret, no guns
    if (performance.now() / 1000 < this.stunnedUntil) {
      inp.throttle = 0; inp.steer = 0; inp.turretTurn = 0;
      inp.pitch = 0; inp.fire = false; inp.mg = false;
    }

    // ── drive ────────────────────────────────────────────────
    const target = clamp(inp.throttle, -0.6, 1) * s.speed;
    const accel = s.accel * (Math.abs(target) > Math.abs(this.speed) ? 1 : 2.2);
    this.speed = approach(this.speed, target, accel * dt);
    this.yaw -= inp.steer * s.turn * dt * (0.45 + 0.55 * Math.min(1, Math.abs(this.speed) / s.speed)) * Math.sign(this.speed >= -0.5 ? 1 : -1);

    const dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw);
    let nx = this.pos.x + dirX * this.speed * dt;
    let nz = this.pos.z + dirZ * this.speed * dt;

    // slope resistance: climbing steep faces slows you down
    const hHere = world.heightAt(this.pos.x, this.pos.z);
    const hThere = world.heightAt(nx, nz);
    const rise = (hThere - hHere) / Math.max(0.001, Math.hypot(nx - this.pos.x, nz - this.pos.z));
    // Arcade traction: tanks MUSCLE up grades. Only near-vertical faces
    // resist, and even then we creep (a fraction of the step) instead of
    // hard-freezing, so you can always climb out of a crater rim or hill
    // rather than getting pinned against it.
    if (rise > 2.4) {
      // Only a near-vertical wall actually checks you now — keep most of the
      // step and barely bleed speed so tanks power up grades and crater rims.
      nx = this.pos.x + (nx - this.pos.x) * 0.55;
      nz = this.pos.z + (nz - this.pos.z) * 0.55;
      this.speed *= 0.94;
    } else if (rise > 1.1) {
      this.speed *= 1 - clamp((rise - 1.1) * 0.4, 0, 0.16) * dt * 6;
    }

    // obstacle collision (cylinders) — soft props (trees, cacti) can't stop
    // 40 tons of tank: they get crushed under the treads instead
    for (let oi = world.obstacles.length - 1; oi >= 0; oi--) {
      const o = world.obstacles[oi];
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const minD = o.r + 4.2;
      if (d < minD && d > 0.001) {
        if (o.kind === "tree" || o.kind === "cactus") {
          world.crushObstacle?.(o);
          this.speed *= 0.93;
          continue;
        }
        nx = o.x + (dx / d) * minD;
        nz = o.z + (dz / d) * minD;
        this.speed *= 0.82;
      }
    }
    // tank-tank collision
    for (const other of world.tanks) {
      if (other === this || !other.alive) continue;
      const dx = nx - other.pos.x, dz = nz - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 9 && d > 0.001) {
        nx = other.pos.x + (dx / d) * 9;
        nz = other.pos.z + (dz / d) * 9;
        this.speed *= 0.85;
      }
    }

    // clamp inside the playable bowl so nobody drives off the world
    const rr = Math.hypot(nx, nz);
    if (rr > RIM_RADIUS) { const k = RIM_RADIUS / rr; nx *= k; nz *= k; this.speed *= 0.6; }

    this.pos.set(nx, world.heightAt(nx, nz), nz);

    // ── turret + barrel ──────────────────────────────────────
    this.turretYaw += inp.turretTurn * s.turretTurn * dt;
    // allow real depression below horizontal so you can aim down at close /
    // downhill targets (cannon and MG both follow this)
    this.barrelPitch = clamp(this.barrelPitch + inp.pitch * 0.9 * dt, -0.35, 1.05);

    // ── timers ───────────────────────────────────────────────
    this.reloadLeft = Math.max(0, this.reloadLeft - dt);
    this.mgCooldown = Math.max(0, this.mgCooldown - dt);
    this.mgHeat = Math.max(0, this.mgHeat - dt * 0.55);

    this.poseMesh(world, dt);
  }

  /**
   * Pose the meshes from current state (also used by the online guest,
   * which never runs physics — only this).
   */
  poseMesh(world, dt) {
    const dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw);
    const n = world.normalAt(this.pos.x, this.pos.z, _basisN);
    const forward = _fwd.set(dirX, 0, dirZ);
    const right = _right.crossVectors(UP, forward).normalize();
    const f2 = _f2.crossVectors(right, n).normalize().negate();
    const m = _mat.makeBasis(right, n, f2.negate());
    const q = _quat.setFromRotationMatrix(m);
    this.root.quaternion.slerp(q, Math.min(1, dt * 10));
    this.root.position.copy(this.pos);
    this.turret.rotation.y = this.turretYaw;

    // Gun stabilization: barrelPitch is a WORLD angle. The hull tilts
    // with the terrain, so measure how much the hull pitches along the
    // turret's aim azimuth and counter it — the gun holds the angle the
    // gunner set no matter what the tracks are doing.
    _fwd.set(Math.sin(this.turretYaw), 0, Math.cos(this.turretYaw))
      .applyQuaternion(this.root.quaternion);
    const hullPitch = Math.asin(clamp(_fwd.y, -1, 1));
    this.barrel.rotation.x = -clamp(this.barrelPitch - hullPitch, -0.5, 1.35);

    this.animateRunningGear(dt);
  }

  /**
   * Spin the road wheels and scroll the track belts with ground speed. Purely
   * cosmetic — no gameplay state is read or written. This lives in poseMesh
   * rather than update() on purpose: the online guest only ever calls
   * poseMesh, so running it from update() left guest tanks skating along on
   * dead, motionless tracks.
   */
  animateRunningGear(dt) {
    const roll = (this.speed / 0.95) * dt;
    for (const w of this.wheels) w.rotation.x += roll;
    const maps = this.root.userData.trackMaps;
    if (maps) {
      // belt UVs run along the belt, so sliding U walks the links past the
      // wheels at the same rate the hull is actually moving
      const slide = this.speed * dt * 0.42;
      for (const t of maps) t.offset.x -= slide;
    }
  }

  canFire() {
    return this.alive && this.reloadLeft <= 0;
  }

  didFire() {
    this.reloadLeft = this.chassis.stats.reload;
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      this.respawnTimer = 4;
      if (attacker && attacker !== this) attacker.kills++;
      return true; // died
    }
    return false;
  }

  respawn(spawn, world) {
    this.alive = true;
    this.hp = this.maxHp;
    this.pos.set(spawn.x, world.heightAt(spawn.x, spawn.z), spawn.z);
    this.yaw = spawn.yaw ?? Math.random() * Math.PI * 2;
    this.speed = 0;
    this.turretYaw = 0;
    this.barrelPitch = 0.18;
    this.reloadLeft = 1;
    this.special = null;
    this.root.visible = true;
  }
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

// ── mesh construction (exported for menu thumbnails + title screen) ────
/**
 * Assemble one tank. The RIG is frozen: the `turret` / `barrel` / `muzzle` /
 * `mgMuzzle` groups keep the exact offsets they have always had, because
 * weapons.js spawns shells from muzzleWorld() — moving them would be a
 * mechanics change wearing a paint job. Everything else here is cosmetic.
 *
 * Materials and geometry are built fresh per tank (thumbs.js disposes both
 * after snapshotting); only the generated textures inside tankart are shared.
 */
export function buildTankMesh(b, team, skin = null) {
  const root = new THREE.Group();
  root.userData.wheels = [];
  root.userData.belts = [];

  const mats = tankMaterials(team, skin);
  const hullH = b.hullH;

  // ── lower body ───────────────────────────────────────────────
  // Static detail is accumulated into per-material buckets and merged once,
  // so a tank that gained ~40 greebles did not gain ~40 draw calls.
  const out = {
    body: [], dark: [], accent: [], glass: [],
    group: root, wheels: root.userData.wheels, belts: root.userData.belts,
  };

  if (b.hover) {
    buildHoverBody(b, mats, out);
  } else {
    buildHull(b, mats, out);
    for (const side of [-1, 1]) buildRunningGear(b, mats, side, out);
  }

  for (const [geos, mat] of [
    [out.body, mats.body], [out.dark, mats.dark],
    [out.accent, mats.accent], [out.glass, mats.glass],
  ]) {
    const m = mergeInto(geos, mat);
    if (m) root.add(m);
  }

  // ── turret ───────────────────────────────────────────────────
  const turret = new THREE.Group();
  turret.name = "turret";
  turret.position.set(0, 1.5 + hullH + 0.2, b.longGun ? -0.8 : 0.2);
  root.add(turret);

  const domeGeo = b.boxTurret
    ? new THREE.BoxGeometry(b.turretR * 2.1, 1.9, b.turretR * 2.4)
    : b.angular
      ? new THREE.CylinderGeometry(b.turretR * 0.78, b.turretR * 1.18, 1.7, 6)
      : new THREE.SphereGeometry(b.turretR, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, mats.bodyFine);
  if (b.angular || b.boxTurret) dome.position.y = 0.92;
  dome.castShadow = true;
  dome.receiveShadow = true;
  turret.add(dome);

  // turret cheeks / spaced armour on plated builds
  if (b.plated) {
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(b.turretR * 1.8, 1.4, 1.2), mats.dark);
    mantlet.position.set(0, 0.8, b.turretR * 0.8);
    turret.add(mantlet);
  }

  turretFurniture(b, mats, turret);

  // ── gun ──────────────────────────────────────────────────────
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  barrel.position.set(0, b.angular ? 1.1 : b.turretR * 0.5, 0);
  turret.add(barrel);

  const tubeOffsets = b.twin ? [-b.barrelR * 2.4, b.barrelR * 2.4] : [0];
  for (const ox of tubeOffsets) buildGunTube(b, mats, barrel, ox);

  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.z = b.barrelL + b.turretR * 0.4 + 0.4;
  barrel.add(muzzle);

  // ── mounted machine gun on the turret roof ───────────────────
  const mg = new THREE.Group();
  mg.position.set(b.turretR * 0.55, b.angular ? 1.8 : b.turretR * 0.95, -0.2);
  const mgParts = [];
  mgParts.push(new THREE.BoxGeometry(0.4, 0.44, 2.1).translate(0, 0, 0.6));
  // receiver detail + ammo box + pintle mount, so the MG is not a lone stick
  mgParts.push(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.02, -0.25));
  mgParts.push(new THREE.BoxGeometry(0.52, 0.42, 0.7).translate(-0.42, -0.16, 0.1));
  mgParts.push(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8).translate(0, -0.42, 0.1));
  const mgBarrel = new THREE.CylinderGeometry(0.085, 0.095, 1.6, 8);
  mgBarrel.rotateX(Math.PI / 2);
  mgBarrel.translate(0, 0, 2.2);
  mgParts.push(mgBarrel);
  // perforated cooling jacket
  const jacket = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8);
  jacket.rotateX(Math.PI / 2);
  jacket.translate(0, 0, 1.85);
  mgParts.push(jacket);
  const mgMesh = mergeInto(mgParts, mats.gun);
  if (mgMesh) mg.add(mgMesh);

  const mgMuzzle = new THREE.Object3D();
  mgMuzzle.name = "mgMuzzle";
  mgMuzzle.position.z = 3.0;
  mg.add(mgMuzzle);
  turret.add(mg);

  // scrolling tread maps, driven from Tank.animateRunningGear()
  root.userData.trackMaps = [mats.track.map, mats.track.normalMap].filter(Boolean);

  // Wave 3 gave the sun a tightly fitted shadow map; tanks only benefit from
  // it if they also RECEIVE. Every part cast before, none received.
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  return root;
}
