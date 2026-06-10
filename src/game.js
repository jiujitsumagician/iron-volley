// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Match orchestrator: scene + lights from the map def, split-screen
 * scissor rendering, chase cameras with recoil/trauma shake, player
 * input + bot brains, scoring, respawns, and the win condition.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildWorld } from "./terrain.js";
import { mapById, WORLD_SIZE } from "./maps.js";
import { Tank } from "./tank.js";
import { chassisById, TEAM_COLORS } from "./tanks.js";
import { Weapons } from "./weapons.js";
import { Pickups } from "./pickups.js";
import { Effects } from "./effects.js";
import { AimPreview } from "./aim.js";
import { BotBrain } from "./ai.js";
import { Hud, SharedHud } from "./hud.js";
import { Input, P1_KEYS, P2_KEYS } from "./input.js";
import { audio } from "./audio.js";
import { clamp, lerp, rand, pick } from "./util.js";

const BOT_NAMES = ["RUSTY", "MAMBA", "DOZER", "WIDOW", "TUSK", "HAVOC", "GRIT", "ECHO"];

// one shared PMREM environment per renderer lifetime
let _envMap = null;
function getEnvMap(renderer) {
  if (!_envMap) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    _envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return _envMap;
}

export class Game {
  constructor(renderer, config, onMatchEnd, gamepads = null) {
    this.renderer = renderer;
    this.config = config;
    this.onMatchEnd = onMatchEnd;
    this.gamepads = gamepads;
    this.map = mapById(config.mapId);
    this.killTarget = config.killTarget ?? 10;
    this.friendlyFire = config.friendlyFire ?? true;
    this.over = false;
    this.elapsed = 0;

    // ── scene ────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    // image-based environment lighting — metals and armor pick up
    // believable reflections everywhere
    this.scene.environment = getEnvMap(renderer);
    this.scene.environmentIntensity = 0.5;
    const built = buildWorld(this.map);
    this.scene.add(built.group);
    this.built = built;
    this.waveT = 0;
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
      friendlyFire: this.friendlyFire,
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
        faction: `p${i}`, // each commander is their own side
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
        aim: new AimPreview(this.scene, this.world),
        view: "third", // "third" chase | "first" gun-sight
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
        faction: "bots", // bots share a side — friendly-fire OFF spares them
      });
      this.scene.add(tank.root);
      tank.respawn(spawns[config.players.length + b], this.world);
      this.world.tanks.push(tank);
      this.bots.push({ tank, brain: new BotBrain(tank, config.difficulty ?? 1) });
    }

    // per-map cinematic exposure + bloom (solo only — split-screen
    // keeps the raw scissor path for honest 60fps on one GPU)
    renderer.toneMappingExposure = this.map.exposure ?? 1.05;
    this.composer = null;
    if (this.players.length === 1) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(this.scene, this.players[0].cam));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(renderer.domElement.width, renderer.domElement.height),
        0.55, 0.4, 0.82
      );
      composer.addPass(bloom);
      this.composer = composer;
      this._onResize = () => composer.setSize(window.innerWidth, window.innerHeight);
      window.addEventListener("resize", this._onResize);
    }

    // Pre-compile every material now (terrain, tanks, effect pools, aim
    // overlays) so the first explosion / laser / muzzle flash doesn't
    // stall the frame the moment it first becomes visible.
    try { renderer.compile(this.scene, this.players[0].cam); } catch { /* non-fatal */ }

    // top-down shaded-relief minimap of the battlefield (built once)
    this.minimapTex = buildMinimapTexture(this.world, this.map);

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
    this.sharedHud.addKill(attacker?.name ?? "OWN GOAL", weapon ?? "?", victim.name);
    this.hudFor(victim)?.toast("DESTROYED — RESPAWNING");
    if (attacker && attacker !== victim && this.hudFor(attacker)) {
      this.hudFor(attacker).toast("TARGET DESTROYED", 1200);
    }
    this.addTrauma(0.45);
    this.updateScorePill();

    this.checkWin();
  }

  checkWin() {
    if (this.over) return;
    const winner = this.world.tanks.find((t) => t.kills >= this.killTarget);
    if (winner) {
      this.over = true;
      audio.victory?.({});
      this._finishTimer = setTimeout(() => this.finish(winner), 1700);
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
    if (this.disposed) return; // stale timer from an abandoned match
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
    this.players.forEach((p, i) => {
      if (this.config.autoPilot) return; // brains drive everyone
      const read = this.input.read(p.keys);
      // gamepad overlays the keyboard: whichever input is active wins
      if (this.gamepads?.padConnected(i)) {
        const pad = this.gamepads.read(i);
        if (Math.abs(pad.throttle) > Math.abs(read.throttle)) read.throttle = pad.throttle;
        if (Math.abs(pad.steer) > Math.abs(read.steer)) read.steer = pad.steer;
        if (Math.abs(pad.turretTurn) > Math.abs(read.turretTurn)) read.turretTurn = pad.turretTurn;
        if (Math.abs(pad.pitch) > Math.abs(read.pitch)) read.pitch = pad.pitch;
        read.fire = read.fire || pad.fire;
        read.mg = read.mg || pad.mg;
        read.view = read.view || pad.viewEdge;
      }
      if (read.view) p.view = p.view === "first" ? "third" : "first";
      if (frozen) { read.throttle = 0; read.fire = false; read.mg = false; }
      p.tank.input = read;
      if (read.fire) {
        if (this.weapons.fireCannon(p.tank)) {
          p.shake = Math.min(1.2, p.shake + 0.32);
        }
      }
      if (read.mg) this.weapons.fireMg(p.tank, dt);
      p.engine?.setIntensity?.(Math.abs(p.tank.speed) / p.tank.chassis.stats.speed);
    });
    if (!frozen) {
      for (const b of this.bots) {
        b.brain.update(dt, this.world, this.weapons, this.pickups);
        if (b.tank.input.fire) {
          this.weapons.fireCannon(b.tank, { allowSpecial: b.brain.specialSafe !== false });
        }
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

    // living water: gentle swell on liquids, heat-pulse on lava/energy
    const wm = this.built.waterMesh;
    if (wm && !this.map.water?.frozen) {
      this.waveT += dt;
      const pos = wm.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(this.waveT * 1.4 + x * 0.025 + y * 0.02) * 0.55);
      }
      pos.needsUpdate = true;
      if (this.map.water?.emissive) {
        wm.material.emissiveIntensity =
          this.map.water.emissive * (0.85 + 0.15 * Math.sin(this.waveT * 2.4));
      }
    }

    // shadow camera follows the action centroid
    const focus = this.players[0]?.tank.pos ?? new THREE.Vector3();
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(
      new THREE.Vector3(...this.map.sky.sunPos).multiplyScalar(700)
    );
    if (this.effects.ambientCenter) this.effects.ambientCenter.copy(focus);

    // ── HUD + aim overlays + minimap ─────────────────────────
    for (const p of this.players) {
      p.hud.update(p.tank, dt);
      p.aim.update(this.over ? null : p.tank, !!p.tank.input.mg, dt);
      p.hud.drawMinimap(p.tank, this.world.tanks, WORLD_SIZE, p.aim.landing, this.minimapTex);
    }

    // win condition is re-checked continuously, not only on kill
    // events, so a mid-match killTarget change can't strand a match
    this._winCheckAcc = (this._winCheckAcc ?? 0) + dt;
    if (this._winCheckAcc > 1) {
      this._winCheckAcc = 0;
      this.checkWin();
    }
  }

  findRespawn(tank) {
    let best = null, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const x = rand(-1, 1) * WORLD_SIZE * 0.36;
      const z = rand(-1, 1) * WORLD_SIZE * 0.36;

      // never respawn on cliffs, in water/lava, inside a prop, or
      // standing in someone's fire pool
      const n = this.world.normalAt(x, z);
      if (n.y < 0.8) continue;
      const y = this.world.heightAt(x, z);
      if (this.map.water && y < this.map.water.level + 2) continue;
      if (this.world.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 7)) continue;
      if (this.weapons.firePools.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 10)) continue;

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

    if (this.composer && n === 1) {
      const p = this.players[0];
      this.updateCamera(p, dt, w / h);
      this.composer.render();
      return;
    }

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

    if (t.alive && p.view === "first") {
      // first-person gun-sight: eye just past the muzzle looking straight
      // down the barrel — zero self-occlusion, shows exactly where the
      // shell/MG will go (the aim line + crosshair sit right in frame)
      const muzzle = t.muzzleWorld(new THREE.Vector3());
      const dir = t.muzzleDir(new THREE.Vector3());
      p.cam.position.copy(muzzle).addScaledVector(dir, 0.6).add(
        new THREE.Vector3(0, 0.6, 0) // ride just over the bore line
      );
      const look = muzzle.addScaledVector(dir, 30);
      look.x += (Math.random() - 0.5) * sh * 5;
      look.y += (Math.random() - 0.5) * sh * 5;
      look.z += (Math.random() - 0.5) * sh * 5;
      p.cam.lookAt(look);
    } else if (t.alive) {
      // chase: locked behind the gun — the camera always sits on the
      // cardinal the turret points, so spinning the turret 360° orbits
      // the view like a real tank commander's seat
      const lookYaw = t.absoluteTurretYaw();
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
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this._finishTimer);
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setScissorTest(false);
    if (this._onResize) window.removeEventListener("resize", this._onResize);
    this.composer?.dispose?.();
    audio.musicStop?.();
    for (const p of this.players) { p.engine?.stop?.(); p.hud.hide(); p.aim?.dispose(); }
    this.sharedHud.hide();
    document.getElementById("divider").style.display = "none";
    // Dispose GPU resources while everything is still attached to the
    // scene, THEN let the systems detach their objects — the other
    // order leaks every shell/crate geometry each match.
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          m.map?.dispose?.();
          m.dispose?.();
        });
      }
    });
    this.effects.dispose();
    this.weapons.dispose();
    this.pickups.clear();
    this.input.dispose();
    if (window.__IV?.game === this) delete window.__IV;
  }
}

// Render a top-down shaded-relief image of the map for the radar: palette
// color by height, hillshade by surface normal, water tinted. Sampled once
// at match start from the SAME height field the world uses.
function buildMinimapTexture(world, map) {
  const N = 110;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(N, N);
  const half = WORLD_SIZE / 2;
  const pal = map.palette;
  const waterLevel = map.water ? map.water.level : -Infinity;
  const wc = map.water ? map.water.color : 0x000000;
  const norm = new THREE.Vector3();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i / (N - 1)) * 2 - 1) * half * 0.98;
      const z = ((j / (N - 1)) * 2 - 1) * half * 0.98;
      const h = world.heightAt(x, z);
      let c0 = pal[0], c1 = pal[pal.length - 1];
      for (let p = 0; p < pal.length - 1; p++) {
        if (h >= pal[p].h && h <= pal[p + 1].h) { c0 = pal[p]; c1 = pal[p + 1]; break; }
        if (h > pal[pal.length - 1].h) { c0 = c1 = pal[pal.length - 1]; }
      }
      const t = c1.h === c0.h ? 0 : clamp((h - c0.h) / (c1.h - c0.h), 0, 1);
      let r = lerp(c0.c[0], c1.c[0], t);
      let g = lerp(c0.c[1], c1.c[1], t);
      let b = lerp(c0.c[2], c1.c[2], t);
      world.normalAt(x, z, norm);
      const shade = 0.5 + 0.6 * clamp(norm.x * 0.5 + norm.y * 0.62 + norm.z * 0.45, 0, 1);
      r *= shade; g *= shade; b *= shade;
      if (h < waterLevel) {
        r = (((wc >> 16) & 255) / 255) * 0.7;
        g = (((wc >> 8) & 255) / 255) * 0.85;
        b = ((wc & 255) / 255) * 0.95;
      }
      const o = (j * N + i) * 4;
      img.data[o] = Math.min(255, r * 255);
      img.data[o + 1] = Math.min(255, g * 255);
      img.data[o + 2] = Math.min(255, b * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
