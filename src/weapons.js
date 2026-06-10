// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Weapons engine: ballistic shells (the volley), hitscan machine gun,
 * and the discoverable special rounds — scatter, laser, nuke,
 * incendiary, gravity well. Owns projectile simulation, splash damage,
 * fire pools, and routes every bang to Effects + audio + game events.
 */

import * as THREE from "three";
import { clamp } from "./util.js";

export const GRAVITY = 42;

export const ROUND_TYPES = {
  standard: { name: "AP SHELL", color: 0xffc163, ammo: Infinity },
  scatter: { name: "SCATTER", color: 0xffe14d, ammo: 3, desc: "Bursts into 9 bomblets" },
  laser: { name: "LANCE", color: 0x47e0ff, ammo: 4, desc: "Instant hitscan beam" },
  nuke: { name: "NUKE", color: 0x9dff47, ammo: 1, desc: "City-block eraser" },
  incendiary: { name: "INFERNO", color: 0xff6a2a, ammo: 3, desc: "Burning ground" },
  gravity: { name: "SINGULARITY", color: 0xc47aff, ammo: 2, desc: "Pulls tanks in, then pops" },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
// reused scratch — these run on the hot firing paths (MG ~12 rounds/sec)
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const _shellDir = new THREE.Vector3();

// lathe-turned artillery round: cylindrical body + ogive nose, nose on +Z
function makeShellGeo() {
  const pts = [
    new THREE.Vector2(0.001, -0.62),
    new THREE.Vector2(0.27, -0.5),
    new THREE.Vector2(0.28, 0.12),
    new THREE.Vector2(0.22, 0.46),
    new THREE.Vector2(0.10, 0.74),
    new THREE.Vector2(0.001, 0.92),
  ];
  const g = new THREE.LatheGeometry(pts, 14);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export class Weapons {
  /**
   * @param {object} ctx { scene, world, effects, audio, events }
   * events: { onDamage(tank, amount, attacker), onKill(victim, attacker, weapon) }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.shells = [];
    this.firePools = []; // { x, z, r, until, owner, tickAcc }
    this.gravityWells = []; // { pos, until, owner }
    this.shotsFired = 0; // cumulative — playtest telemetry
    this.shellGeo = makeShellGeo();
    this.shellMats = new Map();
  }

  shellMat(color) {
    if (!this.shellMats.has(color)) {
      // machined-metal round: brassy/steel body that catches the light, with
      // a touch of emissive so the projectile still reads against the terrain
      this.shellMats.set(
        color,
        new THREE.MeshStandardMaterial({
          color, metalness: 0.85, roughness: 0.32,
          emissive: color, emissiveIntensity: 0.32,
        })
      );
    }
    return this.shellMats.get(color);
  }

  /** Fire the main cannon with the tank's current round. */
  fireCannon(tank, opts = {}) {
    if (!tank.canFire()) return false;
    // bots pass allowSpecial:false at unsafe ranges so they don't
    // delete themselves with their own nuke
    const type = (opts.allowSpecial === false ? null : tank.special?.type) ?? "standard";
    const def = ROUND_TYPES[type];

    const muzzle = tank.muzzleWorld(_muzzle);
    const dir = tank.muzzleDir(_dir);

    if (type === "laser") {
      this.fireLaser(tank, muzzle, dir);
    } else {
      const speed = tank.chassis.stats.shellSpeed * (type === "nuke" ? 0.72 : 1);
      this.spawnShell({
        owner: tank,
        type,
        pos: muzzle,
        vel: dir.clone().multiplyScalar(speed),
      });
    }

    tank.didFire();
    this.shotsFired++;
    this.consumeSpecial(tank, type);
    this.ctx.effects.muzzleFlash(muzzle, dir);
    if (type === "laser") this.ctx.audio.laser({});
    else this.ctx.audio.cannon({});
    return true;
  }

  consumeSpecial(tank, type) {
    if (type !== "standard" && tank.special) {
      tank.special.ammo--;
      if (tank.special.ammo <= 0) tank.special = null;
    }
  }

  spawnShell({ owner, type, pos, vel, small = false }) {
    const def = ROUND_TYPES[type] ?? ROUND_TYPES.standard;
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat(def.color));
    if (small) mesh.scale.setScalar(0.55);
    if (type === "nuke") mesh.scale.setScalar(1.8);
    mesh.position.copy(pos);
    this.ctx.scene.add(mesh);
    this.shells.push({
      owner, type, small,
      pos: pos.clone(),
      vel: vel.clone(),
      mesh,
      age: 0,
      trailAcc: 0,
    });
  }

  fireLaser(tank, from, dir) {
    const world = this.ctx.world;
    const range = 600;
    // march the ray; check tanks + terrain
    let hitPoint = _v.copy(from).addScaledVector(dir, range);
    let hitTank = null;
    const step = 2.2;
    for (let d = 4; d < range; d += step) {
      _v.copy(from).addScaledVector(dir, d);
      if (_v.y <= world.heightAt(_v.x, _v.z)) { hitPoint = _v.clone(); break; }
      let done = false;
      for (const t of world.tanks) {
        if (t === tank || !t.alive) continue;
        if (_v.distanceToSquared(t.pos) < 30) {
          hitPoint = _v.clone();
          hitTank = t;
          done = true;
          break;
        }
      }
      if (done) break;
    }
    this.ctx.effects.laserBeam(from, hitPoint, 0x47e0ff);
    if (hitTank) {
      this.applyDamage(hitTank, 55, tank, "LANCE");
      this.ctx.effects.sparks(hitPoint, 18, 0x9deaff);
    } else {
      this.ctx.effects.sparks(hitPoint, 10, 0x9deaff);
    }
  }

  /** Hold-to-fire machine gun. Call each frame while triggered. */
  fireMg(tank, dt) {
    if (!tank.alive || tank.mgHeat >= 1) return;
    tank.mgCooldown -= dt;
    if (tank.mgCooldown > 0) return;
    tank.mgCooldown = 0.085; // ~12 rps
    tank.mgHeat = Math.min(1, tank.mgHeat + 0.045);

    const from = tank.mgMuzzleWorld(_from);
    // MG tracks the full gun elevation (not a fraction) so the crosshair is
    // honest and the player can actually depress onto close / downhill targets
    const dir = _v2.set(0, 0, 1)
      .applyAxisAngle(_AXIS_X, -tank.barrelPitch)
      .applyAxisAngle(_AXIS_Y, tank.absoluteTurretYaw());
    // spread
    dir.x += (Math.random() - 0.5) * 0.035;
    dir.y += (Math.random() - 0.5) * 0.02;
    dir.z += (Math.random() - 0.5) * 0.035;
    dir.normalize();

    const world = this.ctx.world;
    const range = 160;
    let hitPoint = _v.copy(from).addScaledVector(dir, range);
    let hitTank = null;
    for (let d = 3; d < range; d += 2.4) {
      _v.copy(from).addScaledVector(dir, d);
      if (_v.y <= world.heightAt(_v.x, _v.z)) { hitPoint = _v.clone(); break; }
      let done = false;
      for (const t of world.tanks) {
        if (t === tank || !t.alive) continue;
        if (_v.distanceToSquared(t.pos) < 26) { hitPoint = _v.clone(); hitTank = t; done = true; break; }
      }
      if (done) break;
    }

    this.ctx.effects.mgFlash(from);
    this.ctx.effects.tracer(from, hitPoint);
    this.ctx.audio.mg({ gain: 0.5 });
    if (hitTank) {
      this.applyDamage(hitTank, tank.chassis.stats.mgDamage, tank, "MG");
      if (Math.random() < 0.5) this.ctx.effects.sparks(hitPoint, 6, 0xffd27a);
      if (Math.random() < 0.3) this.ctx.audio.ricochet({ gain: 0.4 });
    }
  }

  update(dt) {
    const world = this.ctx.world;
    const fx = this.ctx.effects;

    // ── shells ───────────────────────────────────────────────
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      s.vel.y -= GRAVITY * dt;

      // gravity wells bend shells too (it's funny and it's physics-ish)
      for (const gw of this.gravityWells) {
        _v.copy(gw.pos).sub(s.pos);
        const d2 = Math.max(120, _v.lengthSq());
        s.vel.addScaledVector(_v.normalize(), (26000 / d2) * dt * 60);
      }

      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      // point the nose along the flight path
      if (s.vel.lengthSq() > 1e-5) {
        _shellDir.copy(s.vel).normalize();
        s.mesh.quaternion.setFromUnitVectors(_AXIS_Z, _shellDir);
      }

      // smoke trail
      s.trailAcc += dt;
      if (s.trailAcc > 0.035 && !s.small) {
        s.trailAcc = 0;
        fx.smokeTrail(s.pos);
      }

      // hit tanks (proximity)
      let detonated = false;
      for (const t of world.tanks) {
        if (t === s.owner || !t.alive) continue;
        if (s.pos.distanceToSquared(t.pos) < 23) {
          this.detonate(s, t);
          detonated = true;
          break;
        }
      }
      if (detonated) { this.removeShell(i); continue; }

      // hit obstacles
      for (const o of world.obstacles) {
        const dx = s.pos.x - o.x, dz = s.pos.z - o.z;
        if (dx * dx + dz * dz < o.r * o.r && s.pos.y < o.y + o.h) {
          this.detonate(s, null);
          detonated = true;
          break;
        }
      }
      if (detonated) { this.removeShell(i); continue; }

      // hit terrain
      if (s.pos.y <= world.heightAt(s.pos.x, s.pos.z)) {
        this.detonate(s, null);
        this.removeShell(i);
        continue;
      }

      // out of bounds / too old
      if (s.age > 14 || Math.abs(s.pos.x) > 1400 || Math.abs(s.pos.z) > 1400) {
        this.removeShell(i);
      }
    }

    // ── fire pools (incendiary DoT) ──────────────────────────
    const now = performance.now() / 1000;
    for (let i = this.firePools.length - 1; i >= 0; i--) {
      const p = this.firePools[i];
      if (now > p.until) { this.firePools.splice(i, 1); continue; }
      p.tickAcc += dt;
      if (p.tickAcc >= 0.5) {
        p.tickAcc -= 0.5;
        for (const t of this.ctx.world.tanks) {
          if (!t.alive) continue;
          const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
          if (dx * dx + dz * dz < p.r * p.r) {
            this.applyDamage(t, 7, p.owner, "INFERNO");
          }
        }
      }
    }

    // ── gravity wells ────────────────────────────────────────
    for (let i = this.gravityWells.length - 1; i >= 0; i--) {
      const gw = this.gravityWells[i];
      for (const t of world.tanks) {
        if (!t.alive) continue;
        _v.copy(gw.pos).sub(t.pos);
        _v.y = 0;
        const d = Math.max(8, _v.length());
        if (d < 90) {
          const pull = (1 - d / 90) * 34 * dt;
          t.pos.addScaledVector(_v.normalize(), pull);
        }
      }
      if (now > gw.until) {
        // collapse pop
        fx.explosion(gw.pos, { radius: 26, color: 0xc47aff });
        this.ctx.audio.explosion(0.7, {});
        this.ctx.world.deform?.(gw.pos.x, gw.pos.z, 22, 5, { scorch: [0.18, 0.08, 0.26] });
        this.splash(gw.pos, 26, 70, gw.owner, "SINGULARITY");
        this.gravityWells.splice(i, 1);
      }
    }
  }

  removeShell(i) {
    const s = this.shells[i];
    this.ctx.scene.remove(s.mesh);
    this.shells.splice(i, 1);
  }

  detonate(s, directHitTank) {
    const fx = this.ctx.effects;
    const p = s.pos;
    switch (s.type) {
      case "standard": {
        const r = s.small ? 7 : 12;
        fx.explosion(p, { radius: r });
        this.ctx.audio.explosion(s.small ? 0.3 : 0.5, {});
        this.ctx.world.deform?.(p.x, p.z, s.small ? 5.5 : 11, s.small ? 1.6 : 3.6);
        if (directHitTank) this.applyDamage(directHitTank, s.owner.chassis.stats.shellDamage * (s.small ? 0.4 : 1), s.owner, "AP SHELL");
        this.splash(p, r + 5, s.owner.chassis.stats.shellDamage * (s.small ? 0.4 : 0.85), s.owner, "AP SHELL", directHitTank);
        break;
      }
      case "scatter": {
        fx.explosion(p, { radius: 8, color: 0xffe14d });
        this.ctx.audio.explosion(0.45, {});
        this.ctx.world.deform?.(p.x, p.z, 9, 2.4);
        this.splash(p, 10, 26, s.owner, "SCATTER", directHitTank);
        // pop 9 bomblets in a cone upward
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const up = 26 + Math.random() * 18;
          const out = 16 + Math.random() * 22;
          this.spawnShell({
            owner: s.owner,
            type: "standard",
            small: true,
            pos: p.clone().add(new THREE.Vector3(0, 1.5, 0)),
            vel: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out),
          });
        }
        break;
      }
      case "nuke": {
        fx.nuke(p);
        this.ctx.audio.nuke({});
        this.ctx.world.deform?.(p.x, p.z, 74, 23, { burn: 0.95 });
        this.splash(p, 95, 230, s.owner, "NUKE", null, 0.35);
        this.ctx.events.onNuke?.(p);
        break;
      }
      case "incendiary": {
        fx.explosion(p, { radius: 12, color: 0xff6a2a });
        fx.firePool(p, 22, 8);
        this.ctx.audio.explosion(0.55, {});
        this.ctx.audio.fire({});
        this.ctx.world.deform?.(p.x, p.z, 13, 3.0, { scorch: [0.05, 0.03, 0.02], burn: 0.95 });
        this.splash(p, 14, 30, s.owner, "INFERNO", directHitTank);
        this.firePools.push({ x: p.x, z: p.z, r: 22, until: performance.now() / 1000 + 8, owner: s.owner, tickAcc: 0 });
        break;
      }
      case "gravity": {
        fx.shockRing(p, 40, 0xc47aff);
        this.ctx.audio.laser({ gain: 0.7 });
        this.gravityWells.push({ pos: p.clone().setY(p.y + 6), until: performance.now() / 1000 + 3.2, owner: s.owner });
        this.ctx.events.onGravityWell?.(p);
        break;
      }
    }
  }

  /** Radial splash damage with linear falloff. */
  splash(p, radius, maxDmg, attacker, weapon, skipTank = null, minFrac = 0.15) {
    for (const t of this.ctx.world.tanks) {
      if (!t.alive || t === skipTank) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      if (d < radius + 4) {
        const frac = clamp(1 - d / (radius + 4), minFrac, 1);
        this.applyDamage(t, maxDmg * frac, attacker, weapon);
      }
    }
  }

  applyDamage(tank, amount, attacker, weapon) {
    if (!tank.alive) return;
    // friendly fire: when disabled, same-faction tanks can't hurt each
    // other (self-damage still lands — don't nuke your own feet)
    if (!this.ctx.friendlyFire && attacker && attacker !== tank &&
        attacker.faction != null && attacker.faction === tank.faction) return;
    // self-damage is allowed but never earns kill credit or victory toasts
    const credited = attacker === tank ? null : attacker;
    const died = tank.takeDamage(amount, credited);
    this.ctx.events.onDamage?.(tank, amount, attacker);
    if (died) {
      this.ctx.effects.wreck(tank.pos.clone());
      this.ctx.audio.death({});
      tank.root.visible = false;
      this.ctx.events.onKill?.(tank, credited, weapon);
    } else if (amount > 1) {
      this.ctx.audio.hit({ gain: 0.35 });
    }
  }

  clear() {
    for (let i = this.shells.length - 1; i >= 0; i--) this.removeShell(i);
    this.firePools.length = 0;
    this.gravityWells.length = 0;
  }

  dispose() {
    this.clear();
    this.shellGeo.dispose();
    for (const m of this.shellMats.values()) m.dispose();
    this.shellMats.clear();
  }
}

/**
 * Ballistic firing solution: given muzzle speed v, gravity g, flat
 * distance d and height difference dy, return the two launch angles
 * (low, high) or null if out of range. Used by AI volleys and the
 * player trajectory hint.
 */
export function launchAngles(v, d, dy, g = GRAVITY) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  return {
    low: Math.atan2(v2 - root, g * d),
    high: Math.atan2(v2 + root, g * d),
  };
}
