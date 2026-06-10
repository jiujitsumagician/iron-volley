// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Bot brain. Writes tank.input each frame like a phantom player:
 * keeps a chassis-appropriate engagement range, solves the ballistic
 * arc (including lobbing the HIGH solution over hills when the low
 * arc is blocked), strafes between volleys, machine-guns at knife
 * range, and detours for ammo crates.
 */

import * as THREE from "three";
import { clamp, angleDelta, rand, pick } from "./util.js";
import { launchAngles, GRAVITY } from "./weapons.js";

const PREFERRED_RANGE = {
  scout: [60, 130],
  viper: [90, 180],
  bastion: [70, 160],
  howitzer: [200, 330],
};

export class BotBrain {
  constructor(tank, difficulty = 1) {
    this.tank = tank;
    this.difficulty = difficulty; // 0.6 easy .. 1.4 brutal
    this.target = null;
    this.retargetIn = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeIn = rand(2, 5);
    this.wander = new THREE.Vector2(rand(-300, 300), rand(-300, 300));
    this.aimJitter = new THREE.Vector2();
    this.jitterIn = 0;
    this.crateGoal = null;
  }

  update(dt, world, weapons, pickups) {
    const t = this.tank;
    if (!t.alive) return;
    const inp = t.input;
    inp.throttle = 0; inp.steer = 0; inp.turretTurn = 0; inp.pitch = 0; inp.fire = false; inp.mg = false;

    // ── pick a target ────────────────────────────────────────
    this.retargetIn -= dt;
    if (!this.target || !this.target.alive || this.retargetIn <= 0) {
      this.retargetIn = rand(2.5, 4.5);
      let best = null, bestD = Infinity;
      for (const other of world.tanks) {
        if (other === t || !other.alive || other.team.id === t.team.id) continue;
        const d = t.pos.distanceTo(other.pos);
        const bias = other.hp / other.maxHp; // prefer wounded
        const score = d * (0.6 + bias * 0.6);
        if (score < bestD) { bestD = score; best = other; }
      }
      this.target = best;
    }

    // ── crate detour when empty-handed ───────────────────────
    if (!t.special && pickups.crates.length && (!this.crateGoal || this.crateGoal.taken)) {
      let best = null, bestD = 200 * 200;
      for (const c of pickups.crates) {
        const d2 = (t.pos.x - c.x) ** 2 + (t.pos.z - c.z) ** 2;
        if (d2 < bestD) { bestD = d2; best = c; }
      }
      this.crateGoal = best; // may be null if none near
    }
    if (t.special) this.crateGoal = null;

    const enemy = this.target;
    const range = PREFERRED_RANGE[t.chassis.id] ?? [90, 180];

    // ── movement goal ────────────────────────────────────────
    let goalX, goalZ, arrive = 10;
    if (this.crateGoal && pickups.crates.includes(this.crateGoal)) {
      goalX = this.crateGoal.x; goalZ = this.crateGoal.z; arrive = 4;
    } else if (enemy) {
      const d = t.pos.distanceTo(enemy.pos);
      const toMe = new THREE.Vector2(t.pos.x - enemy.pos.x, t.pos.z - enemy.pos.z);
      if (toMe.lengthSq() < 1) toMe.set(1, 0);
      toMe.normalize();
      this.strafeIn -= dt;
      if (this.strafeIn <= 0) { this.strafeIn = rand(2.5, 5); this.strafeDir *= -1; }
      if (d > range[1] * 1.5) {
        // way out of the fight — charge straight at them, no dancing
        goalX = enemy.pos.x;
        goalZ = enemy.pos.z;
      } else {
        // hold the band: too close → back off, too far → close in,
        // in-band → orbit strafe
        let standoff;
        if (d < range[0]) standoff = range[0] + 20;
        else if (d > range[1]) standoff = range[1] - 20;
        else standoff = d;
        const tangent = new THREE.Vector2(-toMe.y, toMe.x).multiplyScalar(this.strafeDir * 38);
        goalX = enemy.pos.x + toMe.x * standoff + tangent.x;
        goalZ = enemy.pos.z + toMe.y * standoff + tangent.y;
      }
    } else {
      goalX = this.wander.x; goalZ = this.wander.y; arrive = 30;
      if (Math.hypot(t.pos.x - goalX, t.pos.z - goalZ) < 40) {
        this.wander.set(rand(-400, 400), rand(-400, 400));
      }
    }

    // ── steer toward goal with terrain/obstacle feelers ──────
    let desiredYaw = Math.atan2(goalX - t.pos.x, goalZ - t.pos.z);
    // feeler: if the ground 18u ahead climbs like a wall, veer
    const fx = t.pos.x + Math.sin(t.yaw) * 18;
    const fz = t.pos.z + Math.cos(t.yaw) * 18;
    const climb = world.heightAt(fx, fz) - world.heightAt(t.pos.x, t.pos.z);
    if (climb > 7) desiredYaw += 0.9 * this.strafeDir;
    for (const o of world.obstacles) {
      const dx = fx - o.x, dz = fz - o.z;
      if (dx * dx + dz * dz < (o.r + 7) ** 2) { desiredYaw += 0.8 * this.strafeDir; break; }
    }

    const dYaw = angleDelta(t.yaw, desiredYaw);
    inp.steer = clamp(-dYaw * 2.2, -1, 1);
    const dist = Math.hypot(goalX - t.pos.x, goalZ - t.pos.z);
    inp.throttle = dist > arrive ? clamp(1 - Math.abs(dYaw) * 0.5, 0.15, 1) : 0;

    // ── gunnery ──────────────────────────────────────────────
    if (!enemy) return;
    const d = t.pos.distanceTo(enemy.pos);

    // aim jitter scales inverse to difficulty, refreshed periodically
    this.jitterIn -= dt;
    if (this.jitterIn <= 0) {
      this.jitterIn = rand(0.8, 1.6);
      const err = 9 / this.difficulty;
      this.aimJitter.set(rand(-err, err), rand(-err, err));
    }

    // lead the target a touch
    const flightT = d / t.chassis.stats.shellSpeed * 1.4;
    const aimX = enemy.pos.x + Math.sin(enemy.yaw) * enemy.speed * flightT + this.aimJitter.x;
    const aimZ = enemy.pos.z + Math.cos(enemy.yaw) * enemy.speed * flightT + this.aimJitter.y;
    const aimY = world.heightAt(aimX, aimZ) + 2;

    // turret yaw
    const wantTurretAbs = Math.atan2(aimX - t.pos.x, aimZ - t.pos.z);
    const turretErr = angleDelta(t.absoluteTurretYaw(), wantTurretAbs);
    inp.turretTurn = clamp(turretErr * 3, -1, 1);

    // ballistic pitch
    const muzzleY = t.pos.y + 5;
    const flat = Math.hypot(aimX - t.pos.x, aimZ - t.pos.z);
    const sol = launchAngles(t.chassis.stats.shellSpeed, flat, aimY - muzzleY);
    if (sol) {
      // try LOW arc; if a hill cuts the midpoint sightline, lob HIGH
      let angle = sol.low;
      const midX = (t.pos.x + aimX) / 2, midZ = (t.pos.z + aimZ) / 2;
      // approximate low-arc apex height at midpoint
      const apexY = muzzleY + Math.tan(angle) * flat * 0.5 - (GRAVITY * (flat * 0.5) ** 2) / (2 * (t.chassis.stats.shellSpeed * Math.cos(angle)) ** 2);
      if (world.heightAt(midX, midZ) > apexY - 3) angle = sol.high;
      angle = clamp(angle, 0.02, 1.05);
      const pitchErr = angle - t.barrelPitch;
      inp.pitch = clamp(pitchErr * 4, -1, 1);

      // artillery doctrine: once loaded and roughly on-line, STOP to
      // steady the platform, then volley. The aim jitter supplies the
      // human-feeling miss — don't demand a perfect lock.
      const roughlyOn = Math.abs(turretErr) < 0.3;
      if (t.canFire() && roughlyOn && d > 30) {
        inp.throttle *= 0.2; // settle to fire
      }
      const aligned = Math.abs(turretErr) < 0.12 && Math.abs(pitchErr) < 0.12;
      if (aligned && t.canFire() && Math.random() < dt * 10 * this.difficulty) {
        inp.fire = true;
      }
    }

    // machine gun at knife range with rough alignment
    if (d < 75 && Math.abs(turretErr) < 0.22) inp.mg = true;
  }
}
