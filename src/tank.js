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
import { getModel } from "./models.js";

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

    // wheels spin with ground speed
    for (const w of this.wheels) w.rotation.x += (this.speed / 0.95) * dt;

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

// ── paint shop: generated camo textures, cached per skin ───────
const _camoCache = new Map();
function camoTexture(skin) {
  if (_camoCache.has(skin.id)) return _camoCache.get(skin.id);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = hex(skin.colors[0]);
  ctx.fillRect(0, 0, 256, 256);
  if (skin.stripes) {
    // tiger: wavy diagonal slashes
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
    // classic blotch camo
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
  tex.repeat.set(0.12, 0.12);
  _camoCache.set(skin.id, tex);
  return tex;
}

// ── mesh construction (exported for menu thumbnails) ───────────
export function buildTankMesh(b, team, skin = null) {
  const root = new THREE.Group();
  root.userData.wheels = [];
  let body;
  if (skin && skin.kind === "solid") {
    body = new THREE.MeshStandardMaterial({ color: skin.color, roughness: 0.62, metalness: 0.38 });
  } else if (skin && skin.kind === "camo") {
    body = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: camoTexture(skin), roughness: 0.7, metalness: 0.28,
    });
  } else {
    body = new THREE.MeshStandardMaterial({ color: team.body, roughness: 0.62, metalness: 0.38 });
  }
  const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.85, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({
    color: team.accent, roughness: 0.4, metalness: 0.3,
    emissive: team.accent, emissiveIntensity: 0.25,
  });

  const hullH = b.hullH, hw = b.hullW / 2, hl = b.hullL / 2;

  // ── cosmetic GLB hull ──────────────────────────────────────────
  // When the CC0 vehicle model is loaded we use its low-poly hull + tracks as
  // the lower-body VISUAL, scaled to this chassis's build length, and keep the
  // procedural turret/barrel/muzzle/MG rig on top (so aiming + firing are
  // driven by the same engine groups — unchanged). No model -> fully
  // procedural body below. Hover chassis stay procedural (the GLB is tracked).
  const glbHull = (!b.hover) ? buildGlbHull(b) : null;
  if (glbHull) {
    root.add(glbHull);
  } else {

  // hull — beveled box silhouette via extruded shape
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

  if (b.hover) {
    // hover chassis: no tracks — a dark plenum skirt with a glowing
    // lift strip floating beneath the hull
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(b.hullW + 1.8, 1.2, b.hullL * 0.96), dark);
    skirt.position.y = 1.0;
    skirt.castShadow = true;
    root.add(skirt);
    const lift = new THREE.Mesh(new THREE.BoxGeometry(b.hullW + 1.2, 0.25, b.hullL * 0.88), accent);
    lift.position.y = 0.42;
    root.add(lift);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 8), dark);
      pod.position.set(side * (hw + 0.7), 1.0, -b.hullL * 0.32);
      root.add(pod);
    }
  } else {
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
  }
  } // end procedural lower-body (GLB hull replaces it when present)

  // turret
  const turret = new THREE.Group();
  turret.name = "turret";
  turret.position.set(0, 1.5 + hullH + 0.2, b.longGun ? -0.8 : 0.2);
  root.add(turret);

  const domeGeo = b.boxTurret
    ? new THREE.BoxGeometry(b.turretR * 2.1, 1.9, b.turretR * 2.4)
    : b.angular
      ? new THREE.CylinderGeometry(b.turretR * 0.78, b.turretR * 1.18, 1.7, 6)
      : new THREE.SphereGeometry(b.turretR, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, body);
  if (b.angular || b.boxTurret) dome.position.y = 0.92;
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

  const tubeOffsets = b.twin ? [-b.barrelR * 2.4, b.barrelR * 2.4] : [0];
  for (const ox of tubeOffsets) {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(b.barrelR, b.barrelR * 1.25, b.barrelL, 12),
      dark
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.set(ox, 0, b.barrelL / 2 + b.turretR * 0.4);
    tube.castShadow = true;
    barrel.add(tube);

    // muzzle brake
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(b.barrelR * 1.7, b.barrelR * 1.7, 0.9, 10), dark);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(ox, 0, b.barrelL + b.turretR * 0.4 - 0.5);
    barrel.add(brake);
  }

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

// ── cosmetic GLB hull (lower body only) ────────────────────────
// Returns a low-poly vehicle hull+tracks group fitted to this chassis's build
// dimensions, or null if the model isn't loaded. We strip the model's own
// turret/gun (the engine drives a procedural turret/barrel on top), reorient
// the model's forward (-X) to the engine's +Z, scale to build length, and seat
// it so the tracks rest near y≈0. COSMETIC ONLY — colliders are untouched.
function buildGlbHull(b) {
  const model = getModel("vehicle");
  if (!model) return null;
  try {
    // drop the model's turret/gun — the engine turret rig sits on top
    for (const nm of ["Tank_Turret", "Tank_Gun"]) {
      const o = model.getObjectByName(nm);
      o?.parent?.remove(o);
    }
    const wrap = new THREE.Group();
    // forward -X -> engine +Z
    model.rotation.y = Math.PI / 2;
    wrap.add(model);

    // measure the remaining hull and fit it to the build length along Z
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (!isFinite(size.z) || size.z <= 0.001) return null;
    const targetLen = b.hullL * 1.16; // tracks read a touch longer than the box hull
    const s = targetLen / size.z;
    model.scale.multiplyScalar(s);

    // reseat: center XZ, drop tracks to y≈0.2 (procedural tracks sit ~0.1–2.2)
    wrap.updateMatrixWorld(true);
    box.setFromObject(wrap);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.x += -center.x;
    model.position.z += -center.z;
    model.position.y += 0.2 - box.min.y;

    wrap.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return wrap;
  } catch {
    return null;
  }
}
