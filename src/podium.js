// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Victory podium shown behind the end screen: the top three tanks on a
 * 1-2-3 podium, confetti raining, a slow hero camera. The champion (1st)
 * is popping champagne — and has a bikini-clad companion tank with a
 * pair of comically oversized cannons on its arm. Built from the same
 * procedural tank meshes the match uses, so the winners are the real
 * tanks that just fought.
 */

import * as THREE from "three";
import { PMREMGenerator } from "three";
import { makeSkyDome } from "./terrain.js";
import { mapById } from "./maps.js";
import { buildTankMesh } from "./tank.js";
import { disposeMaterial } from "./tankart.js";
import { TEAM_COLORS, chassisById, skinById } from "./tanks.js";

const CONFETTI_COLORS = [0xffd27a, 0xff6b6b, 0x6dff8a, 0x7ab8ff, 0xff8ad6, 0xfff27a];
// medal tints for the 1st / 2nd / 3rd blocks
const MEDAL = [0xffcf5a, 0xcfd6de, 0xd08a4a];
// podium slot layout: [x, blockHeight] indexed by placement (0=1st)
const SLOTS = [
  { x: 0, h: 3.2, z: 0 },     // 1st — center, tallest
  { x: -8.5, h: 2.1, z: 0.6 }, // 2nd — left
  { x: 8.5, h: 1.4, z: 1.0 },  // 3rd — right
];

export class PodiumScene {
  constructor(renderer, standings) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.t = 0;
    this.top = (standings ?? []).slice(0, 3);

    // ── environment / lighting ───────────────────────────────────
    const map = mapById("dunes");
    const pmrem = new PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const dome = makeSkyDome(map);
    skyScene.add(dome);
    this.scene.environment = pmrem.fromScene(skyScene, 0, 1, 5000).texture;
    this.scene.environmentIntensity = 1.05;
    pmrem.dispose();
    dome.geometry.dispose();
    dome.material.dispose();

    this.scene.background = new THREE.Color(0x0a0f16);
    this.scene.fog = new THREE.Fog(0x0a0f16, 60, 200);

    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x181008, 0.85));
    const key = new THREE.DirectionalLight(0xfff2d8, 3.4);
    key.position.set(14, 30, 26);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 5, far: 120 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    this.scene.add(key, key.target);
    // warm rim + a pink fill so the companion reads
    const rim = new THREE.SpotLight(0xffa8e0, 90, 90, 0.7, 0.5, 1.2);
    rim.position.set(-18, 22, -10);
    this.scene.add(rim, rim.target);
    // hero spotlight on the champion + companion so they pop
    const hero = new THREE.SpotLight(0xfff3d0, 260, 60, 0.6, 0.4, 1.0);
    hero.position.set(0, 26, 22);
    hero.target.position.set(SLOTS[0].x - 1.5, SLOTS[0].h + 2, SLOTS[0].z);
    this.scene.add(hero, hero.target);

    // ── stage floor ──────────────────────────────────────────────
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 46, 1, 64),
      new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.85, metalness: 0.1 })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // a subtle glossy inner disc so the tanks get a reflection pool
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(24, 48),
      new THREE.MeshStandardMaterial({ color: 0x1b2634, roughness: 0.25, metalness: 0.6 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    this.scene.add(glow);

    // ── podium blocks + winners ──────────────────────────────────
    this.winners = [];
    this.top.forEach((s, i) => {
      const slot = SLOTS[i];
      this._buildBlock(slot, MEDAL[i], i + 1);
      const tank = this._buildWinnerTank(s, slot);
      if (tank) this.winners.push({ ...tank, slot, place: i });
    });

    // champion extras: champagne + companion
    if (this.top[0]) {
      this._buildChampagne(SLOTS[0]);
      this.companion = this._buildCompanion(SLOTS[0], this.winners.find((w) => w.place === 0));
    }
    this._buildConfetti();

    // ── camera ───────────────────────────────────────────────────
    this.cam = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
    this.look = new THREE.Vector3(0, SLOTS[0].h + 2.2, 0);
  }

  _buildBlock(slot, tint, place) {
    const w = 6.4, d = 6.4;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(w, slot.h, d),
      new THREE.MeshStandardMaterial({ color: 0x232c38, roughness: 0.6, metalness: 0.3 })
    );
    block.position.set(slot.x, slot.h / 2, slot.z);
    block.castShadow = true; block.receiveShadow = true;
    this.scene.add(block);
    // medal-tinted face plate with the placement number
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.92, slot.h * 0.82),
      new THREE.MeshStandardMaterial({
        map: this._numberTexture(place, tint),
        emissive: tint, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.5,
        transparent: true,
      })
    );
    plate.position.set(slot.x, slot.h / 2, slot.z + d / 2 + 0.02);
    this.scene.add(plate);
    // glowing trim strip along the top edge
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2),
      new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.8 })
    );
    trim.position.set(slot.x, slot.h + 0.02, slot.z);
    this.scene.add(trim);
  }

  _numberTexture(n, tint) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#0c1119";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#" + tint.toString(16).padStart(6, "0");
    g.font = "900 180px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(n), 128, 140);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildWinnerTank(s, slot) {
    const chassis = chassisById(s.chassisId) ?? chassisById("bastion") ?? null;
    if (!chassis) return null;
    const team = TEAM_COLORS.find((c) => c.id === s.teamId) ?? TEAM_COLORS[0];
    const skin = s.skinId ? skinById(s.skinId) : null;
    const root = buildTankMesh(chassis.build, team, skin);
    root.position.set(slot.x, slot.h, slot.z);
    root.rotation.y = Math.PI + 0.35; // face the camera, slight 3/4
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(root);
    return {
      root,
      turret: root.getObjectByName("turret"),
      barrel: root.getObjectByName("barrel"),
      baseY: slot.h,
      phase: Math.random() * Math.PI * 2,
    };
  }

  // ── champagne: bottle by the champion's turret + a gold spray ──
  _buildChampagne(slot) {
    const grp = new THREE.Group();
    grp.position.set(slot.x + 3.1, slot.h + 3.0, slot.z + 2.4);
    grp.rotation.z = -0.9; // tipped, mid-pour
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d3b1e, roughness: 0.2, metalness: 0.3 });
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 16), glassMat);
    grp.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.6, 12), glassMat);
    neck.position.y = 1.0; grp.add(neck);
    const foil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.24, 12),
      new THREE.MeshStandardMaterial({ color: 0xffcf5a, roughness: 0.3, metalness: 0.9 })
    );
    foil.position.y = 1.34; grp.add(foil);
    grp.castShadow = true;
    this.scene.add(grp);
    this.bottleMouth = new THREE.Vector3();
    this.bottleGrp = grp;

    // spray: gold points launched from the bottle mouth
    const N = 140;
    this.spray = { pos: new Float32Array(N * 3), vel: [], life: new Float32Array(N) };
    for (let i = 0; i < N; i++) { this.spray.life[i] = -1; this.spray.vel.push(new THREE.Vector3()); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.spray.pos, 3));
    this.sprayPts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffe9a8, size: 0.28, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.sprayPts);
  }

  // ── companion: the champion's bombshell tank-girl — a curvy pink
  //    mascot with a comically oversized bust in a hot-pink bikini,
  //    lounging ON the winner's hull in a classic pin-up pose: leaning
  //    back on one arm, hand behind her head, tread-boot legs crossed ──
  _buildCompanion(slot, champ) {
    const grp = new THREE.Group();

    const pink = new THREE.MeshStandardMaterial({ color: 0xff5fa8, roughness: 0.35, metalness: 0.25 });
    const hotpink = new THREE.MeshStandardMaterial({ color: 0xff2f8f, roughness: 0.3, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.7 });
    const blonde = new THREE.MeshStandardMaterial({ color: 0xffd75e, roughness: 0.45, metalness: 0.15 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd41c3c, roughness: 0.3 });

    // seated hips + bikini bottom band
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 16), pink);
    hips.scale.set(1.25, 0.7, 1.0); hips.position.y = 0.3; grp.add(hips);
    const bottom = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.08, 8, 24), hotpink);
    bottom.rotation.x = Math.PI / 2; bottom.position.y = 0.5; grp.add(bottom);

    // torso leans back — chest out (pin-up arch)
    const torso = new THREE.Group();
    torso.position.y = 0.55;
    torso.rotation.x = -0.32;
    grp.add(torso);
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.62, 0.8, 16), pink);
    waist.position.y = 0.35; torso.add(waist);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 16), pink);
    chest.scale.set(1.1, 0.95, 0.85); chest.position.y = 1.0; torso.add(chest);
    // the bust — enormous, each in its own hot-pink bikini cup
    for (const sx of [-0.42, 0.42]) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 14), pink);
      orb.position.set(sx, 1.05, 0.5); torso.add(orb);
      const cup = new THREE.Mesh(
        new THREE.SphereGeometry(0.61, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hotpink);
      cup.position.copy(orb.position);
      cup.rotation.x = Math.PI / 2 + 0.25; // open side faces her chest
      torso.add(cup);
    }
    // back strap
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 24), hotpink);
    band.rotation.x = Math.PI / 2; band.position.y = 1.05; torso.add(band);

    // head: pouty lips, big blonde hair, ponytail, bow
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), pink);
    head.position.y = 1.95; torso.add(head);
    const lips = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), red);
    lips.scale.set(1.6, 0.7, 0.7); lips.position.set(0, 1.83, 0.4); torso.add(lips);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.53, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), blonde);
    crown.position.y = 2.0; torso.add(crown);
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 4, 10), blonde);
    tail.position.set(0.24, 1.6, -0.5); tail.rotation.x = 0.5; torso.add(tail);
    for (const sx of [-0.24, 0.24]) {
      const loop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hotpink);
      loop.scale.set(1, 0.65, 0.5); loop.position.set(sx, 2.42, 0.1); torso.add(loop);
    }

    // arms: right props her up behind, left hand behind her head
    const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1.25, 4, 10), pink);
    armR.position.set(0.78, 0.55, -0.6); armR.rotation.set(0.6, 0, -0.55); grp.add(armR);
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.8, 4, 10), pink);
    armL.position.set(-0.66, 1.55, 0.1); armL.rotation.set(-0.3, 0, 1.2); torso.add(armL);

    // legs: crossed at the knee, dangling off the fender, tread-block boots
    for (const [sx, cross] of [[-0.3, 0.12], [0.32, -0.38]]) {
      const leg = new THREE.Group();
      leg.position.set(sx, 0.3, 0.6);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 10), pink);
      thigh.rotation.x = Math.PI / 2 - 0.25; thigh.position.z = 0.35; leg.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.75, 4, 10), pink);
      shin.position.set(0, -0.5, 0.78); shin.rotation.x = 0.2; leg.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.56), black);
      boot.position.set(0, -0.98, 0.9); leg.add(boot);
      leg.rotation.z = cross; // knee-over-knee
      grp.add(leg);
    }

    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    if (champ?.root) {
      // seat her ON the champion's rear deck (the side the camera sees),
      // facing out. Fixed hull height — every chassis deck is ~2.5 up.
      grp.scale.setScalar(1.7);
      grp.position.set(1.1, 3.45, -2.6);
      grp.rotation.y = Math.PI - 0.2;
      champ.root.add(grp); // rides the victory bob with the tank
    } else {
      grp.position.set(slot.x - 4.3, slot.h, slot.z + 2.4);
      grp.rotation.y = Math.PI + 0.4;
      this.scene.add(grp);
    }
    return { root: grp, torso };
  }

  _buildConfetti() {
    const N = 400;
    this.confetti = { pos: new Float32Array(N * 3), vel: [], spin: new Float32Array(N) };
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this._resetConfetto(i, true);
      const c = new THREE.Color(CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.confetti.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.confettiPts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.34, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.scene.add(this.confettiPts);
  }

  _resetConfetto(i, initial) {
    const p = this.confetti.pos;
    p[i * 3] = (Math.random() - 0.5) * 44;
    p[i * 3 + 1] = initial ? Math.random() * 40 : 34 + Math.random() * 8;
    p[i * 3 + 2] = (Math.random() - 0.5) * 30;
    this.confetti.vel[i] = new THREE.Vector3((Math.random() - 0.5) * 1.4, -3 - Math.random() * 3, (Math.random() - 0.5) * 1.4);
    this.confetti.spin[i] = Math.random() * 2;
  }

  resize(w, h) {
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;

    // hero camera: slow arc across the front — podium front-and-center,
    // aimed just high enough that the tanks clear the end panel up top.
    const a = Math.sin(this.t * 0.12) * 0.3;
    const R = 54;
    this.cam.position.set(Math.sin(a) * R * 0.4, SLOTS[0].h + 9 + Math.sin(this.t * 0.5) * 0.5, R);
    this.cam.lookAt(0, 17.5, 0);

    // winners: gentle victory bob + turret sway; champion raises higher
    for (const w of this.winners) {
      const lift = w.place === 0 ? 0.25 : 0.12;
      w.root.position.y = w.baseY + Math.abs(Math.sin(this.t * 2 + w.phase)) * lift;
      if (w.turret) w.turret.rotation.y = Math.sin(this.t * 0.8 + w.phase) * 0.25;
      if (w.place === 0 && w.barrel) w.barrel.rotation.x = -0.5 + Math.sin(this.t * 3) * 0.08; // barrel pumps up in celebration
    }

    // companion idle: slow sultry sway + a gentle back-arch breathe
    if (this.companion) {
      this.companion.root.rotation.z = Math.sin(this.t * 0.9) * 0.03;
      this.companion.torso.rotation.x = -0.32 + Math.sin(this.t * 1.3) * 0.05;
    }

    this._updateSpray(dt);
    this._updateConfetti(dt);
  }

  _updateSpray(dt) {
    if (!this.spray) return;
    this.bottleGrp.updateWorldMatrix(true, false);
    // bottle mouth in world space (local +y up the neck)
    this.bottleMouth.set(0, 1.55, 0).applyMatrix4(this.bottleGrp.matrixWorld);
    const s = this.spray, p = s.pos;
    for (let i = 0; i < s.life.length; i++) {
      if (s.life[i] <= 0) {
        if (Math.random() < 0.5) { // emit
          s.life[i] = 0.9 + Math.random() * 0.5;
          p[i * 3] = this.bottleMouth.x; p[i * 3 + 1] = this.bottleMouth.y; p[i * 3 + 2] = this.bottleMouth.z;
          s.vel[i].set((Math.random() - 0.2) * 6, 5 + Math.random() * 4, (Math.random() + 0.3) * 5);
        } else { p[i * 3 + 1] = -999; continue; }
      }
      s.life[i] -= dt;
      s.vel[i].y -= 14 * dt;
      p[i * 3] += s.vel[i].x * dt; p[i * 3 + 1] += s.vel[i].y * dt; p[i * 3 + 2] += s.vel[i].z * dt;
      if (s.life[i] <= 0) p[i * 3 + 1] = -999;
    }
    this.sprayPts.geometry.attributes.position.needsUpdate = true;
  }

  _updateConfetti(dt) {
    const c = this.confetti, p = c.pos;
    for (let i = 0; i < c.spin.length; i++) {
      c.vel[i].x += Math.sin(this.t * 2 + i) * dt * 1.2; // flutter
      p[i * 3] += c.vel[i].x * dt;
      p[i * 3 + 1] += c.vel[i].y * dt;
      p[i * 3 + 2] += c.vel[i].z * dt;
      if (p[i * 3 + 1] < -2) this._resetConfetto(i, false);
    }
    this.confettiPts.geometry.attributes.position.needsUpdate = true;
  }

  render() {
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMaterial);
      if (o.isPoints && o.material?.map) o.material.map.dispose?.();
      // free light shadow-map render targets (key + spotlights)
      if (o.isLight) o.shadow?.dispose?.();
    });
    this.scene.environment?.dispose?.();
  }
}
