// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Per-player aiming aid. In cannon mode it integrates the live ballistic
 * arc from the muzzle and drops a landing ring on the ground where the
 * round will fall (sized + colored by the loaded round). The instant the
 * machine gun is triggered it swaps to a crosshair pinned to the exact
 * hitscan point — red when it's on an enemy. World-space, so it reads
 * correctly in both split-screen viewports.
 */

import * as THREE from "three";
import { ROUND_TYPES, GRAVITY } from "./weapons.js";

// ground footprint of each round (matches the deform/splash radii)
const LAND_RADIUS = { standard: 11, scatter: 11, nuke: 74, incendiary: 14, gravity: 22, laser: 2.5 };
const MAX_PTS = 80;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class AimPreview {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    // ── trajectory: faint guide line + bold glowing beads ────
    this.linePos = new Float32Array(MAX_PTS * 3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute("position", new THREE.BufferAttribute(this.linePos, 3));
    this.lineGeo.setDrawRange(0, 0);
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    this.line = new THREE.Line(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;
    scene.add(this.line);

    // beads share the line's position buffer so they trace the arc
    this.beadMat = new THREE.PointsMaterial({
      size: 4.2, map: dotTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.beads = new THREE.Points(this.lineGeo, this.beadMat);
    this.beads.frustumCulled = false;
    this.beads.renderOrder = 3;
    scene.add(this.beads);

    // ── landing ring + center dot ────────────────────────────
    this.ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 56), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    scene.add(this.ring);
    this.dotMat = new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dot = new THREE.Sprite(this.dotMat);
    this.dot.renderOrder = 4;
    scene.add(this.dot);

    // ── MG crosshair: constant screen-size reticle ───────────
    this.crossMat = new THREE.SpriteMaterial({ map: crosshairTexture(), transparent: true, depthWrite: false, sizeAttenuation: false });
    this.cross = new THREE.Sprite(this.crossMat);
    this.cross.scale.set(0.13, 0.13, 1);
    this.cross.renderOrder = 5;
    scene.add(this.cross);

    this.hide();

    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._t = 0;
  }

  hide() {
    this.line.visible = false;
    this.beads.visible = false;
    this.ring.visible = false;
    this.dot.visible = false;
    this.cross.visible = false;
  }

  _arcOff() {
    this.line.visible = false;
    this.beads.visible = false;
    this.ring.visible = false;
    this.dot.visible = false;
  }

  update(tank, mgMode, dt) {
    if (!tank || !tank.alive) { this.hide(); return; }
    this._t += dt;
    if (mgMode) {
      this._arcOff();
      this._mgCrosshair(tank);
    } else {
      this.cross.visible = false;
      this._arc(tank);
    }
  }

  _arc(tank) {
    const type = tank.special?.type ?? "standard";
    const def = ROUND_TYPES[type] ?? ROUND_TYPES.standard;
    const muzzle = tank.muzzleWorld(this._muzzle);
    const dir = tank.muzzleDir(this._dir);

    if (type === "laser") { this._straightLine(muzzle, dir, 600, def.color, 26); return; }

    const speed = tank.chassis.stats.shellSpeed * (type === "nuke" ? 0.72 : 1);
    const p = this._p.copy(muzzle);
    const v = this._v.copy(dir).multiplyScalar(speed);
    const step = 0.045;
    const lp = this.linePos;
    lp[0] = p.x; lp[1] = p.y; lp[2] = p.z;
    let n = 1;
    let landX = p.x, landZ = p.z;
    for (let i = 1; i < MAX_PTS; i++) {
      v.y -= GRAVITY * step;
      p.addScaledVector(v, step);
      const gh = this.world.heightAt(p.x, p.z);
      if (p.y <= gh) {
        lp[n * 3] = p.x; lp[n * 3 + 1] = gh; lp[n * 3 + 2] = p.z; n++;
        landX = p.x; landZ = p.z;
        break;
      }
      lp[n * 3] = p.x; lp[n * 3 + 1] = p.y; lp[n * 3 + 2] = p.z; n++;
      landX = p.x; landZ = p.z;
    }
    this.lineGeo.setDrawRange(0, n);
    this.lineGeo.attributes.position.needsUpdate = true;
    this.lineMat.color.setHex(def.color);
    this.beadMat.color.setHex(def.color);
    this.line.visible = true;
    this.beads.visible = true;
    this._placeRing(landX, landZ, LAND_RADIUS[type] ?? 11, def.color);
  }

  _straightLine(from, dir, range, color, ringR) {
    const p = this._p.copy(from);
    const lp = this.linePos;
    lp[0] = p.x; lp[1] = p.y; lp[2] = p.z;
    let hx = from.x + dir.x * range, hz = from.z + dir.z * range, hy = from.y + dir.y * range;
    for (let d = 4; d < range; d += 4) {
      p.copy(from).addScaledVector(dir, d);
      if (p.y <= this.world.heightAt(p.x, p.z)) { hx = p.x; hy = p.y; hz = p.z; break; }
    }
    lp[3] = hx; lp[4] = hy; lp[5] = hz;
    this.lineGeo.setDrawRange(0, 2);
    this.lineGeo.attributes.position.needsUpdate = true;
    this.lineMat.color.setHex(color);
    this.beadMat.color.setHex(color);
    this.line.visible = true;
    this.beads.visible = true;
    this._placeRing(hx, hz, ringR, color);
  }

  _placeRing(x, z, radius, color) {
    const y = this.world.heightAt(x, z) + 0.4;
    const pulse = 1 + Math.sin(this._t * 4) * 0.05;
    this.ring.position.set(x, y, z);
    this.ring.scale.setScalar(radius * pulse);
    this.ringMat.color.setHex(color);
    this.ring.visible = true;
    this.dot.position.set(x, y + 0.2, z);
    this.dot.scale.setScalar(Math.max(3, radius * 0.35));
    this.dotMat.color.setHex(color);
    this.dot.visible = true;
  }

  _mgCrosshair(tank) {
    const from = tank.mgMuzzleWorld(this._muzzle);
    const dir = this._dir.set(0, 0, 1)
      .applyAxisAngle(AXIS_X, -tank.barrelPitch * 0.25)
      .applyAxisAngle(AXIS_Y, tank.absoluteTurretYaw())
      .normalize();
    const range = 160;
    const p = this._p;
    const hit = this._hit.copy(from).addScaledVector(dir, range);
    let onEnemy = false;
    for (let d = 3; d < range; d += 2.2) {
      p.copy(from).addScaledVector(dir, d);
      if (p.y <= this.world.heightAt(p.x, p.z)) { hit.copy(p); break; }
      let done = false;
      for (const t of this.world.tanks) {
        if (t === tank || !t.alive) continue;
        if (p.distanceToSquared(t.pos) < 26) { hit.copy(p); onEnemy = true; done = true; break; }
      }
      if (done) break;
    }
    this.cross.position.copy(hit);
    this.crossMat.color.setHex(onEnemy ? 0xff4d4d : 0xffe1a0);
    this.cross.visible = true;
  }

  dispose() {
    this.scene.remove(this.line, this.beads, this.ring, this.dot, this.cross);
    this.lineGeo.dispose();
    this.lineMat.dispose();
    this.beadMat.dispose();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.dotMat.dispose();
    this.crossMat.dispose();
  }
}

// soft round additive dot for the arc beads + landing pip
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const s = 64, c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

// crisp crosshair: open center, four ticks, thin ring
let _crossTex = null;
function crosshairTexture() {
  if (_crossTex) return _crossTex;
  const s = 128, c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const m = s / 2;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  // ticks (gap in the middle)
  const inner = 16, outer = 46;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    ctx.beginPath();
    ctx.moveTo(m + dx * inner, m + dy * inner);
    ctx.lineTo(m + dx * outer, m + dy * outer);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(m, m, 34, 0, Math.PI * 2);
  ctx.stroke();
  // center pip
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(m, m, 3, 0, Math.PI * 2);
  ctx.fill();
  _crossTex = new THREE.CanvasTexture(c);
  return _crossTex;
}
