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

const UP = new THREE.Vector3(0, 1, 0);

export class Tank {
  constructor({ chassis, team, name, isBot = false }) {
    this.chassis = chassis;
    this.team = team;
    this.name = name;
    this.isBot = isBot;

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

    this.root = buildTankMesh(chassis.build, team);
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
    out.set(0, 0, 1).applyQuaternion(this.barrel.getWorldQuaternion(new THREE.Quaternion()));
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
    if (rise > 0.9) { nx = this.pos.x; nz = this.pos.z; this.speed *= 0.4; } // wall
    else if (rise > 0.25) this.speed *= 1 - clamp((rise - 0.25) * 1.2, 0, 0.65) * dt * 8;

    // obstacle collision (cylinders)
    for (const o of world.obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const minD = o.r + 4.2;
      if (d < minD && d > 0.001) {
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

    this.pos.set(nx, world.heightAt(nx, nz), nz);

    // ── turret + barrel ──────────────────────────────────────
    this.turretYaw += inp.turretTurn * s.turretTurn * dt;
    this.barrelPitch = clamp(this.barrelPitch + inp.pitch * 0.9 * dt, 0.02, 1.05);

    // ── timers ───────────────────────────────────────────────
    this.reloadLeft = Math.max(0, this.reloadLeft - dt);
    this.mgCooldown = Math.max(0, this.mgCooldown - dt);
    this.mgHeat = Math.max(0, this.mgHeat - dt * 0.55);

    // wheels spin with ground speed
    for (const w of this.wheels) w.rotation.x += (this.speed / 0.95) * dt;

    // ── pose the meshes ──────────────────────────────────────
    const n = world.normalAt(this.pos.x, this.pos.z);
    const forward = new THREE.Vector3(dirX, 0, dirZ);
    const right = new THREE.Vector3().crossVectors(UP, forward).normalize();
    const f2 = new THREE.Vector3().crossVectors(right, n).normalize().negate();
    const m = new THREE.Matrix4().makeBasis(right, n, f2.negate());
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.root.quaternion.slerp(q, Math.min(1, dt * 10));
    this.root.position.copy(this.pos);
    this.turret.rotation.y = this.turretYaw;
    this.barrel.rotation.x = -this.barrelPitch;
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

// ── mesh construction (exported for menu thumbnails) ───────────
export function buildTankMesh(b, team) {
  const root = new THREE.Group();
  root.userData.wheels = [];
  const body = new THREE.MeshStandardMaterial({ color: team.body, roughness: 0.62, metalness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.85, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({
    color: team.accent, roughness: 0.4, metalness: 0.3,
    emissive: team.accent, emissiveIntensity: 0.25,
  });

  // hull — beveled box silhouette via extruded shape
  const hullH = b.hullH, hw = b.hullW / 2, hl = b.hullL / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hl * 0.9, 0);
  shape.lineTo(-hl, hullH * 0.55);
  shape.lineTo(-hl * 0.72, hullH);
  shape.lineTo(hl * 0.62, hullH);
  shape.lineTo(hl, hullH * 0.5);
  shape.lineTo(hl * 0.9, 0);
  shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: b.hullW, bevelEnabled: false });
  hullGeo.rotateY(Math.PI / 2);
  hullGeo.translate(-hw + b.hullW, 1.5, 0);
  // ExtrudeGeometry extrudes along +Z then we rotated — recenter X:
  hullGeo.computeBoundingBox();
  const bb = hullGeo.boundingBox;
  hullGeo.translate(-(bb.max.x + bb.min.x) / 2, 0, -(bb.max.z + bb.min.z) / 2);
  const hull = new THREE.Mesh(hullGeo, body);
  hull.castShadow = true;
  root.add(hull);

  // accent stripe down the hull
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(b.hullW * 0.16, 0.12, b.hullL * 0.86), accent);
  stripe.position.y = 1.5 + hullH + 0.07;
  root.add(stripe);

  // tracks
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 2.1, b.hullL * 1.02),
      dark
    );
    track.position.set(side * (hw + 0.55), 1.15, 0);
    track.castShadow = true;
    root.add(track);
    // wheels
    for (let i = 0; i < b.wheels; i++) {
      const wheelGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.6, 12);
      wheelGeo.rotateZ(Math.PI / 2); // axle on X — rotation.x is the spin
      const wheel = new THREE.Mesh(wheelGeo, dark);
      const t = b.wheels === 1 ? 0.5 : i / (b.wheels - 1);
      wheel.position.set(side * (hw + 0.56), 0.95, lerp(-b.hullL * 0.42, b.hullL * 0.42, t));
      root.add(wheel);
      root.userData.wheels.push(wheel);
    }
    // fender skirts on plated builds
    if (b.plated) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, b.hullL * 0.96), body);
      skirt.position.set(side * (hw + 1.0), 2.2, 0);
      root.add(skirt);
    }
  }

  // turret
  const turret = new THREE.Group();
  turret.name = "turret";
  turret.position.set(0, 1.5 + hullH + 0.2, b.longGun ? -0.8 : 0.2);
  root.add(turret);

  const domeGeo = b.angular
    ? new THREE.CylinderGeometry(b.turretR * 0.78, b.turretR * 1.18, 1.7, 6)
    : new THREE.SphereGeometry(b.turretR, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, body);
  if (b.angular) dome.position.y = 0.85;
  dome.castShadow = true;
  turret.add(dome);

  if (b.plated) {
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(b.turretR * 1.8, 1.4, 1.2), dark);
    mantlet.position.set(0, 0.8, b.turretR * 0.8);
    turret.add(mantlet);
  }

  // barrel pivot
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  barrel.position.set(0, b.angular ? 1.1 : b.turretR * 0.5, 0);
  turret.add(barrel);

  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(b.barrelR, b.barrelR * 1.25, b.barrelL, 12),
    dark
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.z = b.barrelL / 2 + b.turretR * 0.4;
  tube.castShadow = true;
  barrel.add(tube);

  // muzzle brake
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(b.barrelR * 1.7, b.barrelR * 1.7, 0.9, 10), dark);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = b.barrelL + b.turretR * 0.4 - 0.5;
  barrel.add(brake);

  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.z = b.barrelL + b.turretR * 0.4 + 0.4;
  barrel.add(muzzle);

  // mounted machine gun on the turret roof
  const mg = new THREE.Group();
  mg.position.set(b.turretR * 0.55, b.angular ? 1.8 : b.turretR * 0.95, -0.2);
  const mgBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 2.1), dark);
  mgBody.position.z = 0.6;
  mg.add(mgBody);
  const mgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8), dark);
  mgBarrel.rotation.x = Math.PI / 2;
  mgBarrel.position.z = 2.2;
  mg.add(mgBarrel);
  const mgMuzzle = new THREE.Object3D();
  mgMuzzle.name = "mgMuzzle";
  mgMuzzle.position.z = 3.0;
  mg.add(mgMuzzle);
  turret.add(mg);

  // antenna + headlights for character
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 4), dark);
  antenna.position.set(-b.turretR * 0.7, 1.8, -b.turretR * 0.5);
  turret.add(antenna);
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.2), accent);
    light.position.set(side * hw * 0.6, 1.5 + hullH * 0.55, hl * 0.98);
    root.add(light);
  }

  return root;
}
