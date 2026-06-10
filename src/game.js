// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Match orchestrator: scene + lights from the map def, split-screen
 * scissor rendering, chase cameras with recoil/trauma shake, player
 * input + bot brains, scoring, respawns, and the win condition.
 */

import * as THREE from "three";
import { buildWorld } from "./terrain.js";
import { mapById, WORLD_SIZE } from "./maps.js";
import { Tank } from "./tank.js";
import { chassisById, TEAM_COLORS } from "./tanks.js";
import { Weapons } from "./weapons.js";
import { Pickups } from "./pickups.js";
import { Effects } from "./effects.js";
import { BotBrain } from "./ai.js";
import { Hud, SharedHud } from "./hud.js";
import { Input, P1_KEYS, P2_KEYS } from "./input.js";
import { audio } from "./audio.js";
import { clamp, lerp, rand, pick } from "./util.js";

const BOT_NAMES = ["RUSTY", "MAMBA", "DOZER", "WIDOW", "TUSK", "HAVOC", "GRIT", "ECHO"];

export class Game {
  constructor(renderer, config, onMatchEnd) {
    this.renderer = renderer;
    this.config = config;
    this.onMatchEnd = onMatchEnd;
    this.map = mapById(config.mapId);
    this.killTarget = config.killTarget ?? 10;
    this.over = false;
    this.elapsed = 0;

    // ── scene ────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    const built = buildWorld(this.map);
    this.scene.add(built.group);
    this.scene.fog = new THREE.Fog(this.map.fog.color, this.map.fog.near, this.map.fog.far);

    const hemi = new THREE.HemisphereLight(this.map.hemi.sky, this.map.hemi.ground, this.map.hemi.intensity);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(this.map.sunlight.color, this.map.sunlight.intensity);
    sun.position.set(...this.map.sky.sunPos).multiplyScalar(700);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 420;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 50, far: 2400 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(sun.target);

    // ── systems ──────────────────────────────────────────────
    this.effects = new Effects(this.scene);
    if (this.map.snow) this.effects.ambient("snow");
    else if (this.map.embers) this.effects.ambient("embers");

    this.world = {
      map: this.map,
      heightAt: built.heightAt,
      normalAt: built.normalAt,
      obstacles: built.obstacles,
      tanks: [],
    };

    this.events = {
      onDamage: (tank, amount, attacker) => {
        const hud = this.hudFor(tank);
        hud?.damaged(amount / tank.maxHp);
      },
      onKill: (victim, attacker, weapon) => this.handleKill(victim, attacker, weapon),
      onNuke: () => this.addTrauma(1.0),
      onGravityWell: () => this.addTrauma(0.3),
      onPickup: (tank, type) => {
        const hud = this.hudFor(tank);
        hud?.toast(`${type.toUpperCase()} LOADED`);
      },
    };

    this.weapons = new Weapons({
      scene: this.scene, world: this.world,
      effects: this.effects, audio, events: this.events,
    });
    this.pickups = new Pickups({
      scene: this.scene, world: this.world,
      effects: this.effects, audio, events: this.events,
    });

    // ── combatants ───────────────────────────────────────────
    this.input = new Input();
    this.players = []; // { tank, hud, keys, cam, shake, engineHandle }
    this.bots = []; // { tank, brain }

    const spawns = this.makeSpawnRing(config.players.length + config.botCount);
    let teamIdx = 0;

    config.players.forEach((p, i) => {
      const tank = new Tank({
        chassis: chassisById(p.chassisId),
        team: TEAM_COLORS[teamIdx++ % TEAM_COLORS.length],
        name: p.name,
      });
      this.scene.add(tank.root);
      tank.respawn(spawns[i], this.world);
      this.world.tanks.push(tank);

      const region = config.players.length === 2 ? (i === 0 ? "left" : "right") : "full";
      const hud = new Hud(document.getElementById(`hud${i + 1}`), region, `${p.name} — ${tank.chassis.name}`);
      const cam = new THREE.PerspectiveCamera(
        62,
        1, // aspect set per-frame from viewport
        0.5,
        4000
      );
      this.players.push({
        tank, hud, cam,
        keys: i === 0 ? P1_KEYS : P2_KEYS,
        shake: 0,
        engine: audio.engineStart?.() ?? null,
      });
      // soak-test autopilot: the "player" plays itself
      if (config.autoPilot) this.bots.push({ tank, brain: new BotBrain(tank, 1) });
    });

    for (let b = 0; b < config.botCount; b++) {
      const chassis = chassisById(pick(["scout", "viper", "bastion", "howitzer"]));
      const tank = new Tank({
        chassis,
        team: TEAM_COLORS[teamIdx++ % TEAM_COLORS.length],
        name: BOT_NAMES[b % BOT_NAMES.length],
        isBot: true,
      });
      this.scene.add(tank.root);
      tank.respawn(spawns[config.players.length + b], this.world);
      this.world.tanks.push(tank);
      this.bots.push({ tank, brain: new BotBrain(tank, config.difficulty ?? 1) });
    }

    this.sharedHud = new SharedHud();
    this.sharedHud.show();
    this.updateScorePill();

    document.getElementById("divider").style.display =
      config.players.length === 2 ? "block" : "none";

    audio.musicStart?.("battle");

    // countdown
    this.startFreeze = 2.4;
    this.players.forEach((p) => p.hud.toast("VOLLEY IN 3…2…1…", 2300));
    audio.countdown?.({});

    // playtest hook
    window.__IV = {
      game: this,
      tanks: this.world.tanks,
      weapons: this.weapons,
      pickups: this.pickups,
    };
  }

  makeSpawnRing(n) {
    const spawns = [];
    // close enough that the opening volleys start within seconds,
    // far enough that you still arc shells over a hill to connect
    const R = clamp(120 + n * 30, 170, 320);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      spawns.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, yaw: a + Math.PI });
    }
    return spawns;
  }

  hudFor(tank) {
    return this.players.find((p) => p.tank === tank)?.hud ?? null;
  }

  handleKill(victim, attacker, weapon) {
    this.sharedHud.addKill(attacker?.name ?? "THE WORLD", weapon ?? "?", victim.name);
    this.hudFor(victim)?.toast("DESTROYED — RESPAWNING");
    if (attacker && this.hudFor(attacker)) this.hudFor(attacker).toast("TARGET DESTROYED", 1200);
    this.addTrauma(0.45);
    this.updateScorePill();

    const winner = this.world.tanks.find((t) => t.kills >= this.killTarget);
    if (winner && !this.over) {
      this.over = true;
      audio.victory?.({});
      setTimeout(() => this.finish(winner), 1700);
    }
  }

  updateScorePill() {
    const sorted = [...this.world.tanks].sort((a, b) => b.kills - a.kills);
    const leader = sorted[0];
    this.sharedHud.setScore(
      `FIRST TO ${this.killTarget} — ${leader.name} ${leader.kills}`
    );
  }

  finish(winner) {
    const standings = [...this.world.tanks]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((t) => ({ name: t.name, chassis: t.chassis.name, kills: t.kills, deaths: t.deaths, isPlayer: !t.isBot }));
    this.onMatchEnd({ winner: winner.name, winnerIsPlayer: !winner.isBot, standings });
  }

  addTrauma(amount) {
    for (const p of this.players) p.shake = Math.min(1.2, p.shake + amount);
  }

  update(dt) {
    this.elapsed += dt;
    if (this.startFreeze > 0) {
      this.startFreeze -= dt;
      if (this.startFreeze <= 0) {
        audio.go?.({});
        this.players.forEach((p) => p.hud.toast("FIRE AT WILL", 1100));
      }
    }
    const frozen = this.startFreeze > 0 || this.over;

    // ── control ──────────────────────────────────────────────
    for (const p of this.players) {
      if (this.config.autoPilot) break; // brains drive everyone
      const read = this.input.read(p.keys);
      if (frozen) { read.throttle = 0; read.fire = false; read.mg = false; }
      p.tank.input = read;
      if (read.fire) {
        if (this.weapons.fireCannon(p.tank)) {
          p.shake = Math.min(1.2, p.shake + 0.32);
        }
      }
      if (read.mg) this.weapons.fireMg(p.tank, dt);
      p.engine?.setIntensity?.(Math.abs(p.tank.speed) / p.tank.chassis.stats.speed);
    }
    if (!frozen) {
      for (const b of this.bots) {
        b.brain.update(dt, this.world, this.weapons, this.pickups);
        if (b.tank.input.fire) this.weapons.fireCannon(b.tank);
        if (b.tank.input.mg) this.weapons.fireMg(b.tank, dt);
      }
    }

    // ── simulate ─────────────────────────────────────────────
    for (const t of this.world.tanks) {
      if (t.alive) {
        t.update(dt, this.world);
        // drive dust
        if (Math.abs(t.speed) > 6 && Math.random() < dt * 14) {
          this.effects.dust(t.pos, Math.abs(t.speed) / 30);
        }
      } else {
        t.respawnTimer -= dt;
        if (t.respawnTimer <= 0 && !this.over) {
          t.respawn(this.findRespawn(t), this.world);
        }
      }
    }
    this.weapons.update(dt);
    this.pickups.update(dt);
    this.effects.update(dt);
    this.input.endFrame();

    // shadow camera follows the action centroid
    const focus = this.players[0]?.tank.pos ?? new THREE.Vector3();
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(
      new THREE.Vector3(...this.map.sky.sunPos).multiplyScalar(700)
    );
    if (this.effects.ambientCenter) this.effects.ambientCenter.copy(focus);

    // ── HUD ──────────────────────────────────────────────────
    for (const p of this.players) p.hud.update(p.tank, dt);
  }

  findRespawn(tank) {
    let best = null, bestScore = -1;
    for (let i = 0; i < 14; i++) {
      const x = rand(-1, 1) * WORLD_SIZE * 0.36;
      const z = rand(-1, 1) * WORLD_SIZE * 0.36;
      let nearest = Infinity;
      for (const t of this.world.tanks) {
        if (t === tank || !t.alive) continue;
        nearest = Math.min(nearest, Math.hypot(t.pos.x - x, t.pos.z - z));
      }
      if (nearest > bestScore) { bestScore = nearest; best = { x, z }; }
    }
    return best ?? { x: 0, z: 0 };
  }

  render(dt) {
    const r = this.renderer;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    const n = this.players.length;
    r.setScissorTest(n > 1);

    this.players.forEach((p, i) => {
      const vx = n === 2 ? (i === 0 ? 0 : Math.floor(w / 2)) : 0;
      const vw = n === 2 ? Math.floor(w / 2) : w;
      this.updateCamera(p, dt, vw / h);
      r.setViewport(vx, 0, vw, h);
      r.setScissor(vx, 0, vw, h);
      r.render(this.scene, p.cam);
    });
  }

  updateCamera(p, dt, aspect) {
    const t = p.tank;
    p.cam.aspect = aspect;
    p.cam.updateProjectionMatrix();

    p.shake = Math.max(0, p.shake - dt * 1.6);
    const sh = p.shake * p.shake;

    if (t.alive) {
      // chase: behind hull, slightly toward turret facing
      const lookYaw = t.yaw + (t.turretYaw * 0.35);
      const back = 26 + t.chassis.build.hullL * 0.6;
      const cx = t.pos.x - Math.sin(lookYaw) * back;
      const cz = t.pos.z - Math.cos(lookYaw) * back;
      const groundY = this.world.heightAt(cx, cz);
      const cy = Math.max(t.pos.y + 12, groundY + 6);

      const target = new THREE.Vector3(cx, cy, cz);
      p.cam.position.lerp(target, 1 - Math.pow(0.0008, dt));
      const look = new THREE.Vector3(
        t.pos.x + Math.sin(lookYaw) * 18,
        t.pos.y + 4 + t.barrelPitch * 16,
        t.pos.z + Math.cos(lookYaw) * 18
      );
      look.x += (Math.random() - 0.5) * sh * 5;
      look.y += (Math.random() - 0.5) * sh * 5;
      look.z += (Math.random() - 0.5) * sh * 5;
      p.cam.lookAt(look);
    } else {
      // death cam: slow orbital drift above the wreck
      const a = performance.now() / 2600;
      const target = new THREE.Vector3(
        t.pos.x + Math.cos(a) * 40,
        t.pos.y + 34,
        t.pos.z + Math.sin(a) * 40
      );
      p.cam.position.lerp(target, 1 - Math.pow(0.001, dt));
      p.cam.lookAt(t.pos.x, t.pos.y + 4, t.pos.z);
    }
  }

  dispose() {
    audio.musicStop?.();
    for (const p of this.players) { p.engine?.stop?.(); p.hud.hide(); }
    this.sharedHud.hide();
    document.getElementById("divider").style.display = "none";
    this.effects.clear();
    this.weapons.clear();
    this.pickups.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      }
    });
  }
}
