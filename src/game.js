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
import { chassisById, skinById, CHASSIS, SKINS, TEAM_COLORS } from "./tanks.js";
import { Weapons, ROUND_TYPES } from "./weapons.js";
import { Pickups } from "./pickups.js";
import { Effects } from "./effects.js";
import { AimPreview } from "./aim.js";
import { encodeSnapshot, rosterFor } from "./net.js";
import { crateVisual } from "./pickups.js";
import { BotBrain } from "./ai.js";
import { Hud, SharedHud } from "./hud.js";
import { Input, P1_KEYS, P2_KEYS } from "./input.js";
import { audio } from "./audio.js";
import { clamp, lerp, rand, pick, angleDelta } from "./util.js";

/** Shortest-path angular step toward a target (returns the delta). */
function angleLerp(current, target, k) {
  return angleDelta(current, target) * k;
}

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
      // environment destruction — craters carve real terrain, props die
      deform: built.deform,
      destroyObstacle: built.destroyObstacle,
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

    this.net = config.net ?? null;

    this.weapons = new Weapons({
      scene: this.scene, world: this.world,
      effects: this.effects, audio, events: this.events,
      friendlyFire: this.friendlyFire,
    });
    if (this.net?.role === "guest") {
      // the guest renders crates from host snapshots — no local logic
      this.pickups = { crates: [], update() {}, clear() {} };
    } else {
      this.pickups = new Pickups({
        scene: this.scene, world: this.world,
        effects: this.effects, audio, events: this.events,
      });
    }

    // ── combatants ───────────────────────────────────────────
    this.input = new Input();
    this.players = []; // { tank, hud, keys, cam, shake, engineHandle }
    this.bots = []; // { tank, brain }

    const spawns = this.makeSpawnRing(
      config.players.length + config.botCount + (this.net?.role === "host" ? 1 : 0)
    );
    let teamIdx = 0;

    if (this.net?.role === "guest") {
      // one camera seat; the tanks arrive with the host's roster
      const cam = new THREE.PerspectiveCamera(62, 1, 0.5, 4000);
      this.players.push({
        tank: null, hud: null, cam,
        keys: P1_KEYS, shake: 0,
        engine: audio.engineStart?.() ?? null,
        aim: null, view: "third",
      });
      this.initNetGuest();
    }

    if (this.net?.role !== "guest") config.players.forEach((p, i) => {
      const tank = new Tank({
        chassis: chassisById(p.chassisId),
        team: TEAM_COLORS[teamIdx++ % TEAM_COLORS.length],
        name: p.name,
        faction: `p${i}`, // each commander is their own side
        skin: p.skinId ? skinById(p.skinId) : null,
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

    if (this.net?.role !== "guest") for (let b = 0; b < config.botCount; b++) {
      const chassis = chassisById(pick(CHASSIS.map((c) => c.id)));
      const tank = new Tank({
        chassis,
        team: TEAM_COLORS[teamIdx++ % TEAM_COLORS.length],
        name: BOT_NAMES[b % BOT_NAMES.length],
        isBot: true,
        faction: "bots", // bots share a side — friendly-fire OFF spares them
        skin: Math.random() < 0.6 ? skinById(pick(SKINS.slice(1).map((s) => s.id))) : null,
      });
      this.scene.add(tank.root);
      tank.respawn(spawns[config.players.length + b], this.world);
      this.world.tanks.push(tank);
      this.bots.push({ tank, brain: new BotBrain(tank, config.difficulty ?? 1) });
    }

    // the online opponent rides in the host's simulation
    if (this.net?.role === "host") {
      const g = this.net.guest;
      const tank = new Tank({
        chassis: chassisById(g.chassisId),
        team: TEAM_COLORS[teamIdx++ % TEAM_COLORS.length],
        name: g.name ?? "CHALLENGER",
        faction: "p-remote",
        skin: g.skinId ? skinById(g.skinId) : null,
      });
      this.scene.add(tank.root);
      tank.respawn(spawns[spawns.length - 1], this.world);
      this.world.tanks.push(tank);
      this.remoteTank = tank;
      this.remoteInput = { throttle: 0, steer: 0, turretTurn: 0, pitch: 0, fire: false, mg: false };
      this.initNetHost();
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
    this.players.forEach((p) => p.hud?.toast("VOLLEY IN 3…2…1…", 2300));
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

    // online host mirrors the kill feed + scoreline to the guest
    if (this.net?.role === "host") {
      const sorted = [...this.world.tanks].sort((a, b) => b.kills - a.kills);
      this.net.session.send("feed", {
        killer: attacker?.name ?? "OWN GOAL",
        weapon: weapon ?? "?",
        victim: victim.name,
        score: `FIRST TO ${this.killTarget} — ${sorted[0].name} ${sorted[0].kills}`,
      });
    }

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
    if (!leader) return; // online guest before the roster lands
    this.sharedHud.setScore(
      `FIRST TO ${this.killTarget} — ${leader.name} ${leader.kills}`
    );
  }

  // ── ONLINE: host side ─────────────────────────────────────────
  initNetHost() {
    const s = this.net.session;
    this._snapAcc = 0;
    s.on("input", (d) => { this.remoteInput = d; });
    s.onClose = () => {
      if (this.over || this.disposed) return;
      this.players[0]?.hud?.toast("OPPONENT DISCONNECTED", 2500);
      this.over = true;
      this._finishTimer = setTimeout(() => this.finish(this.players[0].tank), 1800);
    };
    const guestIdx = this.world.tanks.indexOf(this.remoteTank);
    s.send("roster", rosterFor(this, guestIdx));
  }

  hostNetTick(dt) {
    this._snapAcc += dt;
    if (this._snapAcc >= 1 / 15) {
      this._snapAcc = 0;
      this.net.session.send("snap", encodeSnapshot(this));
    }
  }

  // ── ONLINE: guest side ────────────────────────────────────────
  initNetGuest() {
    const s = this.net.session;
    this._lastSnap = null;
    this._prevShells = [];
    this._crateKey = "";
    this._crateGroup = new THREE.Group();
    this.scene.add(this._crateGroup);
    this._inputAcc = 0;

    s.on("roster", (r) => {
      this.killTarget = r.killTarget;
      r.tanks.forEach((info, i) => {
        const tank = new Tank({
          chassis: chassisById(info.chassisId),
          team: TEAM_COLORS.find((t) => t.id === info.teamId) ?? TEAM_COLORS[i % TEAM_COLORS.length],
          name: info.name,
          skin: info.skinId ? skinById(info.skinId) : null,
        });
        tank.netTarget = { x: 0, z: 0, yaw: 0, turretYaw: 0, barrelPitch: 0.18 };
        this.scene.add(tank.root);
        this.world.tanks.push(tank);
        if (i === r.you) {
          this.players[0].tank = tank;
          this.players[0].hud = new Hud(document.getElementById("hud1"), "full", `${tank.name} — ${tank.chassis.name}`);
          this.players[0].hud.toast("CONNECTED — FIGHT", 1500);
        }
      });
      this.updateScorePill();
    });
    s.on("snap", (snap) => this.applySnapshot(snap));
    s.on("feed", (f) => {
      this.sharedHud.addKill(f.killer, f.weapon, f.victim);
      if (f.score) this.sharedHud.setScore(f.score);
      audio.explosion(0.4, {});
    });
    s.on("end", (result) => {
      if (this.over) return;
      this.over = true;
      this._finishTimer = setTimeout(() => {
        if (!this.disposed) this.onMatchEnd(result);
      }, 800);
    });
    s.onClose = () => {
      if (this.over || this.disposed) return;
      this.over = true;
      this.onMatchEnd({
        winner: "CONNECTION LOST", winnerIsPlayer: false,
        standings: this.world.tanks.map((t) => ({
          name: t.name, chassis: t.chassis.name, kills: t.kills, deaths: t.deaths, isPlayer: t === this.players[0].tank,
        })),
      });
    };
  }

  applySnapshot(snap) {
    this._lastSnap = snap;
    const tanks = this.world.tanks;
    snap.t.forEach((row, i) => {
      const t = tanks[i];
      if (!t) return;
      const [x, z, yaw, tYaw, pitch, hp, alive, speed, reload, specType, specAmmo, mg] = row;
      t.netTarget = { x, z, yaw, turretYaw: tYaw, barrelPitch: pitch };
      // death / respawn transitions drive the FX the guest can't simulate
      const wasAlive = t.alive;
      t.hp = hp;
      t.alive = !!alive;
      t.speed = speed;
      t.reloadLeft = reload;
      t.kills = row[12] ?? t.kills;
      t.special = specType ? { type: specType, ammo: specAmmo } : null;
      t.netMg = !!mg;
      if (wasAlive && !t.alive) {
        this.effects.wreck(t.pos.clone());
        audio.death({});
        t.root.visible = false;
      } else if (!wasAlive && t.alive) {
        t.root.visible = true;
        t.pos.set(x, this.world.heightAt(x, z), z);
      }
    });

    // shells: spawn/update meshes by index pool; infer detonations
    this.syncGuestShells(snap.s);

    // crates: rebuild on change, ping where one vanished
    const key = JSON.stringify(snap.c);
    if (key !== this._crateKey) {
      this._crateKey = key;
      this._crateGroup.clear();
      this._guestCrates = (snap.c ?? []).map(([x, z, type]) => {
        const { group } = crateVisual(type);
        group.position.set(x, this.world.heightAt(x, z), z);
        this._crateGroup.add(group);
        return { x, z, type, group };
      });
    }
  }

  syncGuestShells(rows) {
    if (!this._shellPool) this._shellPool = [];
    const pool = this._shellPool;
    // detonation inference: previous shells that have no close successor
    for (const prev of this._prevShells) {
      const survived = rows.some(([x, y, z]) =>
        (x - prev.x) ** 2 + (y - prev.y) ** 2 + (z - prev.z) ** 2 < 900);
      if (!survived) {
        const p = new THREE.Vector3(prev.x, Math.max(prev.y, this.world.heightAt(prev.x, prev.z)), prev.z);
        if (prev.type === "nuke") { this.effects.nuke(p); audio.nuke({}); this.addTrauma(1); }
        else if (prev.type === "incendiary") { this.effects.explosion(p, { radius: 12, color: 0xff6a2a }); this.effects.firePool(p, 22, 8); audio.explosion(0.55, {}); }
        else { this.effects.explosion(p, { radius: prev.small ? 7 : 11 }); audio.explosion(prev.small ? 0.3 : 0.5, {}); }
      }
    }
    this._prevShells = rows.map(([x, y, z, type, small]) => ({ x, y, z, type, small }));

    while (pool.length < rows.length) {
      const mesh = new THREE.Mesh(this.weapons.shellGeo, this.weapons.shellMat(0xffc163));
      this.scene.add(mesh);
      pool.push(mesh);
    }
    pool.forEach((mesh, i) => {
      const row = rows[i];
      if (!row) { mesh.visible = false; return; }
      mesh.visible = true;
      mesh.position.set(row[0], row[1], row[2]);
      mesh.material = this.weapons.shellMat((ROUND_TYPES[row[3]] ?? ROUND_TYPES.standard).color);
      mesh.scale.setScalar(row[4] ? 0.55 : row[3] === "nuke" ? 1.8 : 1);
      if (Math.random() < 0.5 && !row[4]) this.effects.smokeTrail(mesh.position);
    });
  }

  guestUpdate(dt) {
    // interpolate everyone toward the latest snapshot
    const k = 1 - Math.exp(-12 * dt);
    for (const t of this.world.tanks) {
      const nt = t.netTarget;
      if (!nt || !t.alive) continue;
      t.pos.x = lerp(t.pos.x, nt.x, k);
      t.pos.z = lerp(t.pos.z, nt.z, k);
      t.pos.y = this.world.heightAt(t.pos.x, t.pos.z);
      t.yaw += angleLerp(t.yaw, nt.yaw, k);
      t.turretYaw += angleLerp(t.turretYaw, nt.turretYaw, k);
      t.barrelPitch = lerp(t.barrelPitch, nt.barrelPitch, k);
      t.poseMesh(this.world, dt);
      // MG tracer mirror (visual only — damage is host-side)
      if (t.netMg && Math.random() < dt * 20) {
        const from = t.mgMuzzleWorld(new THREE.Vector3());
        const dir = new THREE.Vector3(Math.sin(t.absoluteTurretYaw()), 0, Math.cos(t.absoluteTurretYaw()));
        this.effects.tracer(from, from.clone().addScaledVector(dir, 60 + Math.random() * 40));
        this.effects.mgFlash(from);
      }
    }
    // crate spin
    if (this._guestCrates) {
      for (const c of this._guestCrates) c.group.rotation.y += dt * 0.7;
    }

    this.effects.update(dt);
    const me = this.players[0];
    if (me.tank) {
      me.engine?.setIntensity?.(Math.abs(me.tank.speed) / me.tank.chassis.stats.speed);
      me.hud?.update(me.tank, dt);
    }

    // ship inputs at ~30Hz
    this._inputAcc += dt;
    if (this._inputAcc >= 1 / 30) {
      this._inputAcc = 0;
      const read = this.input.read(me.keys);
      if (this.gamepads?.playerConnected(0)) {
        const pad = this.gamepads.readPlayer(0);
        if (Math.abs(pad.throttle) > Math.abs(read.throttle)) read.throttle = pad.throttle;
        if (Math.abs(pad.steer) > Math.abs(read.steer)) read.steer = pad.steer;
        if (Math.abs(pad.turretTurn) > Math.abs(read.turretTurn)) read.turretTurn = pad.turretTurn;
        if (Math.abs(pad.pitch) > Math.abs(read.pitch)) read.pitch = pad.pitch;
        read.fire = read.fire || pad.fire;
        read.mg = read.mg || pad.mg;
      }
      this.net.session.send("input", {
        throttle: read.throttle, steer: read.steer,
        turretTurn: read.turretTurn, pitch: read.pitch,
        fire: !!read.fire, mg: !!read.mg,
      });
    }
    this.input.endFrame();

    // focus ambience + minimap center on our tank
    if (me.tank && this.effects.ambientCenter) this.effects.ambientCenter.copy(me.tank.pos);
  }

  finish(winner) {
    if (this.disposed) return; // stale timer from an abandoned match
    const standings = [...this.world.tanks]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((t) => ({ name: t.name, chassis: t.chassis.name, kills: t.kills, deaths: t.deaths, isPlayer: !t.isBot }));
    if (this.net?.role === "host") {
      // the guest's "you won" perspective is theirs, not ours
      this.net.session.send("end", {
        winner: winner.name,
        winnerIsPlayer: winner === this.remoteTank,
        standings: standings.map((s) => ({ ...s, isPlayer: s.name === this.remoteTank?.name })),
      });
    }
    this.onMatchEnd({ winner: winner.name, winnerIsPlayer: !winner.isBot, standings });
  }

  addTrauma(amount) {
    for (const p of this.players) p.shake = Math.min(1.2, p.shake + amount);
  }

  update(dt) {
    this.elapsed += dt;

    // online guest: render-only client — interpolate, emote, send input
    if (this.net?.role === "guest") {
      this.guestUpdate(dt);
      return;
    }

    if (this.startFreeze > 0) {
      this.startFreeze -= dt;
      if (this.startFreeze <= 0) {
        audio.go?.({});
        this.players.forEach((p) => p.hud?.toast("FIRE AT WILL", 1100));
      }
    }
    const frozen = this.startFreeze > 0 || this.over;

    // online host: drive the challenger's tank with their latest input
    if (this.net?.role === "host" && this.remoteTank?.alive && !frozen) {
      const ri = this.remoteInput;
      const inp = this.remoteTank.input;
      inp.throttle = clamp(ri.throttle ?? 0, -1, 1);
      inp.steer = clamp(ri.steer ?? 0, -1, 1);
      inp.turretTurn = clamp(ri.turretTurn ?? 0, -1, 1);
      inp.pitch = clamp(ri.pitch ?? 0, -1, 1);
      inp.mg = !!ri.mg;
      if (ri.fire) this.weapons.fireCannon(this.remoteTank);
      if (ri.mg) this.weapons.fireMg(this.remoteTank, dt);
    }

    // ── control ──────────────────────────────────────────────
    this.players.forEach((p, i) => {
      if (this.config.autoPilot) return; // brains drive everyone
      const read = this.input.read(p.keys);
      // gamepad overlays the keyboard: whichever input is active wins
      if (this.gamepads?.playerConnected(i)) {
        const pad = this.gamepads.readPlayer(i);
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

    // online host: stream the world to the challenger
    if (this.net?.role === "host") this.hostNetTick(dt);
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
    if (!t) { // online guest waiting on the roster — hold a sky shot
      p.cam.position.set(0, 160, 240);
      p.cam.lookAt(0, 0, 0);
      return;
    }

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
    this.net?.session?.destroy(); // online matches end with the game
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
