// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Pooled visual effects for weapons, impacts, destruction, and map ambience.
 * All high-frequency work is backed by fixed buffers and reusable scene nodes.
 */

import * as THREE from "three";

const PARTICLES = 900;
const SPRITES = 300; // a single nuke uses ~170 - budget for chained big effects
const SEGMENTS = 160;
const RINGS = 32;
const LIGHTS = 8;
const BEAMS = 16;
const FIRE_POOLS = 8;
const AMBIENT = 260;

const ADD = THREE.AdditiveBlending;
const NORMAL = THREE.NormalBlending;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "effects";
    scene.add(this.root);

    this.ambientCenter = new THREE.Vector3();
    this._seed = 0x8f4a7c15;
    this._time = 0;

    this._v0 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q0 = new THREE.Quaternion();
    this._axisY = new THREE.Vector3(0, 1, 0);

    this.textures = {
      glow: makeRadialTexture(96, [
        [0.00, 1.00, 1.00, 1.00, 1.00],
        [0.18, 1.00, 0.72, 0.25, 0.95],
        [0.62, 0.95, 0.18, 0.02, 0.32],
        [1.00, 0.00, 0.00, 0.00, 0.00],
      ]),
      smoke: makeRadialTexture(96, [
        [0.00, 0.58, 0.58, 0.58, 0.52],
        [0.45, 0.34, 0.34, 0.34, 0.34],
        [1.00, 0.03, 0.03, 0.03, 0.00],
      ]),
      soft: makeRadialTexture(96, [
        [0.00, 1.00, 1.00, 1.00, 0.72],
        [0.52, 1.00, 1.00, 1.00, 0.22],
        [1.00, 1.00, 1.00, 1.00, 0.00],
      ]),
      star: makeStarTexture(96),
    };

    this._buildParticles();
    this._buildSprites();
    this._buildSegments();
    this._buildRings();
    this._buildLights();
    this._buildBeams();
    this._buildFirePools();
    this._buildAmbient();
  }

  update(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this._time += dt;
    this._updateParticles(dt);
    this._updateSprites(dt);
    this._updateSegments(dt);
    this._updateRings(dt);
    this._updateLights(dt);
    this._updateBeams(dt);
    this._updateFirePools(dt);
    this._updateAmbient(dt);
  }

  clear() {
    for (let i = 0; i < PARTICLES; i++) this.pLife[i] = 0;
    for (let i = 0; i < PARTICLES; i++) this.pSize[i] = 0;
    this.pGeo.attributes.size.needsUpdate = true;

    for (let i = 0; i < SPRITES; i++) {
      this.sLife[i] = 0;
      this.sprites[i].visible = false;
    }
    for (let i = 0; i < SEGMENTS; i++) this.segLife[i] = 0;
    for (let i = 0; i < SEGMENTS * 2 * 3; i++) this.segPos[i] = 0;
    this.segGeo.attributes.position.needsUpdate = true;
    this.segGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < RINGS; i++) {
      this.rLife[i] = 0;
      this.rings[i].visible = false;
    }
    for (let i = 0; i < LIGHTS; i++) {
      this.lLife[i] = 0;
      this.lights[i].intensity = 0; // stay visible — keep light count constant
    }
    for (let i = 0; i < BEAMS; i++) {
      this.bLife[i] = 0;
      this.beams[i].core.visible = false;
      this.beams[i].halo.visible = false;
    }
    for (let i = 0; i < FIRE_POOLS; i++) this.firePools[i].life = 0;
    this.ambient("none");
  }

  /** Full teardown: pooled geometries/materials AND the shared textures
   * (which live in ShaderMaterial uniforms, so a scene-traverse dispose
   * never reaches them). Detaches root from the scene. */
  dispose() {
    this.clear();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      }
    });
    for (const t of Object.values(this.textures)) t.dispose?.();
    this.scene.remove(this.root);
  }

  muzzleFlash(pos, dir) {
    const d = this._v0.copy(dir).normalize();
    const p = this._v1.copy(pos).addScaledVector(d, 1.2);
    this._spawnSprite(p, 9, 28, 0.12, 0xfff4cc, this.textures.star, ADD, 0.95, 9);
    this._spawnSprite(p, 5, 16, 0.09, 0xff8c25, this.textures.glow, ADD, 0.72, -7);
    this._spawnRing(p, 2.5, 12, 0.18, 0xcfc5b0, 0.45, true);
    this._spawnLight(p, 0xffb14c, 2.4, 42, 0.08);
    for (let i = 0; i < 12; i++) {
      this._v2.copy(d).multiplyScalar(this._rand(5, 13));
      this._v2.x += this._rand(-3.2, 3.2);
      this._v2.y += this._rand(0.4, 4.2);
      this._v2.z += this._rand(-3.2, 3.2);
      this._spawnParticle(p, this._v2, 0.45, this._rand(1.1, 2.6), this._rand(3.5, 8), 0x6b6863, 0.18, 1.6, 0.18);
    }
  }

  mgFlash(pos) {
    this._spawnSprite(pos, 2.2, 7, 0.05, 0xfff2aa, this.textures.star, ADD, 0.9, 18);
  }

  tracer(from, to) {
    this._spawnSegment(from, to, 0.08, 0xfff0a8, 1.0);
  }

  smokeTrail(pos) {
    this._v0.set(this._rand(-0.7, 0.7), this._rand(1.0, 2.5), this._rand(-0.7, 0.7));
    this._spawnParticle(pos, this._v0, 1.2, this._rand(1.6, 2.8), this._rand(7, 12), 0x77736d, 0.06, 0.9, 0.32);
  }

  laserBeam(from, to, color) {
    this._spawnBeam(from, to, color ?? 0x66e8ff, 0.32);
    this.sparks(to, 18, color ?? 0x88f7ff);
    this._spawnSprite(to, 5, 17, 0.16, color ?? 0x66e8ff, this.textures.star, ADD, 0.85, 0);
  }

  explosion(pos, opts = {}) {
    const radius = opts.radius ?? 10;
    const color = opts.color ?? 0xff9a3c;
    const dirt = opts.dirt ?? true;
    const p = this._v0.copy(pos);

    this._spawnSprite(p, radius * 2.2, radius * 5.8, 0.16, 0xffffff, this.textures.soft, ADD, 1.0, 4);
    this._spawnSprite(p, radius * 1.4, radius * 4.2, 0.55, color, this.textures.glow, ADD, 0.85, -2);
    this._spawnLight(p, color, Math.min(6, radius * 0.35), radius * 5.5, 0.22);
    this.shockRing(p, radius * 3.8, color);

    const fire = Math.min(34, Math.floor(radius * 2.4));
    for (let i = 0; i < fire; i++) {
      this._v1.set(this._rand(-1, 1), this._rand(0.2, 1.4), this._rand(-1, 1)).normalize().multiplyScalar(this._rand(radius * 0.25, radius * 1.7));
      this._v1.y = this._rand(radius * 0.25, radius * 1.1);
      this._v2.copy(p).addScaledVector(this._v1, 0.22);
      this._spawnSprite(this._v2, radius * this._rand(0.28, 0.55), radius * this._rand(1.1, 2.1), this._rand(0.35, 0.75), this._mixColor(color, 0xffffff, 0.18), this.textures.glow, ADD, 0.72, this._rand(-4, 4));
    }

    const smoke = Math.min(48, Math.floor(radius * 3.2));
    for (let i = 0; i < smoke; i++) {
      this._v1.set(this._rand(-1, 1), this._rand(0.4, 1.8), this._rand(-1, 1)).normalize().multiplyScalar(this._rand(radius * 0.3, radius * 1.6));
      this._v1.y += this._rand(radius * 0.4, radius * 2.1);
      this._spawnParticle(p, this._v1, this._rand(1.4, 2.7), this._rand(radius * 0.12, radius * 0.25), this._rand(radius * 0.9, radius * 1.9), 0x2a2928, 0.02, 0.78, 0.24);
    }

    if (dirt) {
      const chunks = Math.min(42, Math.floor(radius * 2.6));
      for (let i = 0; i < chunks; i++) {
        this._v1.set(this._rand(-1, 1), this._rand(0.45, 1.7), this._rand(-1, 1)).normalize().multiplyScalar(this._rand(radius * 2.0, radius * 5.2));
        this._spawnParticle(p, this._v1, this._rand(0.65, 1.2), this._rand(0.35, 0.9), this._rand(0.05, 0.18), 0x5b4735, -18, 0.99, 1.0);
      }
    }
  }

  sparks(pos, n, color) {
    const count = Math.min(80, Math.max(0, n | 0));
    for (let i = 0; i < count; i++) {
      const len = this._rand(2, 7);
      this._v0.set(this._rand(-1, 1), this._rand(0.05, 1.0), this._rand(-1, 1)).normalize();
      this._v1.copy(pos).addScaledVector(this._v0, len);
      this._spawnSegment(pos, this._v1, this._rand(0.18, 0.5), color ?? 0xffd08a, 0.95);
      this._v2.copy(this._v0).multiplyScalar(this._rand(8, 22));
      this._spawnParticle(pos, this._v2, this._rand(0.22, 0.5), 0.22, 0.03, color ?? 0xffd08a, -12, 1, 1);
    }
  }

  shockRing(pos, radius, color) {
    this._spawnRing(pos, Math.max(0.1, radius * 0.08), radius, 0.55, color ?? 0xffc170, 0.62, true);
  }

  nuke(pos) {
    const p = this._v0.copy(pos);
    this._spawnSprite(p, 90, 520, 0.7, 0xffffff, this.textures.soft, ADD, 1.0, 0);
    this._spawnSprite(p.set(pos.x, pos.y + 34, pos.z), 42, 210, 2.2, 0xff7a24, this.textures.glow, ADD, 0.95, 0);
    this._spawnRing(pos, 16, 220, 1.65, 0xfff0c0, 0.9, true);
    this._spawnRing(pos, 24, 260, 2.15, 0xff6a2c, 0.65, true);
    this._spawnLight(pos, 0xffb45a, 7, 260, 2.8);

    for (let i = 0; i < 92; i++) {
      const h = this._rand(8, 115);
      const spread = 10 + h * 0.18;
      this._v1.set(this._rand(-spread, spread), h, this._rand(-spread, spread));
      this._v2.copy(pos).add(this._v1);
      this._spawnSprite(this._v2, this._rand(20, 42), this._rand(65, 115), this._rand(1.6, 3.6), i < 34 ? 0xff8a30 : 0x2d2a27, i < 42 ? this.textures.glow : this.textures.smoke, i < 42 ? ADD : NORMAL, this._rand(0.42, 0.82), this._rand(-1.5, 1.5));
    }
    for (let i = 0; i < 76; i++) {
      const a = this._rand(0, Math.PI * 2);
      const r = this._rand(18, 82);
      this._v2.set(pos.x + Math.cos(a) * r, pos.y + this._rand(95, 165), pos.z + Math.sin(a) * r);
      this._spawnSprite(this._v2, this._rand(26, 54), this._rand(80, 150), this._rand(2.3, 4.0), i < 18 ? 0xff9d42 : 0x242321, i < 18 ? this.textures.glow : this.textures.smoke, i < 18 ? ADD : NORMAL, this._rand(0.45, 0.76), this._rand(-1, 1));
    }
    for (let i = 0; i < 160; i++) {
      this._v1.set(this._rand(-38, 38), this._rand(20, 80), this._rand(-38, 38));
      this._v2.set(this._rand(-2.5, 2.5), this._rand(-18, -5), this._rand(-2.5, 2.5));
      this._spawnParticle(this._v0.copy(pos).add(this._v1), this._v2, this._rand(2.0, 4.0), this._rand(0.6, 1.5), this._rand(0.15, 0.5), 0x6f6558, 0, 1, 0.58);
    }
  }

  firePool(pos, radius, duration) {
    let slot = 0;
    let oldest = Infinity;
    for (let i = 0; i < FIRE_POOLS; i++) {
      if (this.firePools[i].life <= 0) { slot = i; break; }
      if (this.firePools[i].life < oldest) { oldest = this.firePools[i].life; slot = i; }
    }
    const f = this.firePools[slot];
    f.pos.copy(pos);
    f.radius = radius;
    f.life = Math.max(0.1, duration);
    f.maxLife = f.life;
    f.acc = 0;
  }

  wreck(pos) {
    this.explosion(pos, { radius: 14, color: 0xff8c2f, dirt: true });
    for (let i = 0; i < 42; i++) {
      this._v1.set(this._rand(-2.5, 2.5), this._rand(8, 18), this._rand(-1.5, 4.5));
      this._spawnParticle(pos, this._v1, this._rand(3.5, 6.0), this._rand(4, 8), this._rand(20, 32), 0x171615, 0.8, 0.86, 0.4);
    }
  }

  dust(pos, intensity) {
    const count = Math.max(1, Math.min(3, Math.ceil(intensity * 3)));
    for (let i = 0; i < count; i++) {
      this._v0.set(this._rand(-1.6, 1.6), this._rand(0.25, 1.1), this._rand(-1.6, 1.6));
      this._spawnParticle(pos, this._v0, this._rand(0.55, 0.85), this._rand(1.6, 2.8), this._rand(5, 9), 0xb79a6d, 0.12, 0.82, 0.28);
    }
  }

  ambient(kind) {
    this.ambientKind = kind === "snow" || kind === "embers" ? kind : "none";
    this.ambientPoints.visible = this.ambientKind !== "none";
    for (let i = 0; i < AMBIENT; i++) this._resetAmbient(i, true);
    this.ambientGeo.attributes.position.needsUpdate = true;
    this.ambientGeo.attributes.color.needsUpdate = true;
    this.ambientGeo.attributes.size.needsUpdate = true;
  }

  _buildParticles() {
    this.pPos = new Float32Array(PARTICLES * 3);
    this.pVel = new Float32Array(PARTICLES * 3);
    this.pCol = new Float32Array(PARTICLES * 3);
    this.pBase = new Float32Array(PARTICLES * 3);
    this.pLife = new Float32Array(PARTICLES);
    this.pMax = new Float32Array(PARTICLES);
    this.pSize = new Float32Array(PARTICLES);
    this.pStart = new Float32Array(PARTICLES);
    this.pEnd = new Float32Array(PARTICLES);
    this.pGravity = new Float32Array(PARTICLES);
    this.pDrag = new Float32Array(PARTICLES);
    this.pAlpha = new Float32Array(PARTICLES);
    this.pCursor = 0;

    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute("size", new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NORMAL,
      vertexColors: true,
      uniforms: { map: { value: this.textures.smoke } },
      vertexShader: pointVertexShader(),
      fragmentShader: pointFragmentShader(),
    });
    this.pPoints = new THREE.Points(this.pGeo, mat);
    this.pPoints.frustumCulled = false;
    this.root.add(this.pPoints);
  }

  _buildSprites() {
    this.sprites = [];
    this.sVel = new Float32Array(SPRITES * 3);
    this.sLife = new Float32Array(SPRITES);
    this.sMax = new Float32Array(SPRITES);
    this.sStart = new Float32Array(SPRITES);
    this.sEnd = new Float32Array(SPRITES);
    this.sAlpha = new Float32Array(SPRITES);
    this.sSpin = new Float32Array(SPRITES);
    this.sCursor = 0;
    for (let i = 0; i < SPRITES; i++) {
      const m = new THREE.SpriteMaterial({ map: this.textures.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: ADD });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.frustumCulled = false;
      this.sprites.push(s);
      this.root.add(s);
    }
  }

  _buildSegments() {
    this.segPos = new Float32Array(SEGMENTS * 2 * 3);
    this.segCol = new Float32Array(SEGMENTS * 2 * 3);
    this.segBase = new Float32Array(SEGMENTS * 3);
    this.segLife = new Float32Array(SEGMENTS);
    this.segMax = new Float32Array(SEGMENTS);
    this.segAlpha = new Float32Array(SEGMENTS);
    this.segCursor = 0;
    this.segGeo = new THREE.BufferGeometry();
    this.segGeo.setAttribute("position", new THREE.BufferAttribute(this.segPos, 3));
    this.segGeo.setAttribute("color", new THREE.BufferAttribute(this.segCol, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: ADD, depthWrite: false });
    this.segments = new THREE.LineSegments(this.segGeo, mat);
    this.segments.frustumCulled = false;
    this.root.add(this.segments);
  }

  _buildRings() {
    const geo = new THREE.RingGeometry(0.82, 1, 72);
    this.rings = [];
    this.rLife = new Float32Array(RINGS);
    this.rMax = new Float32Array(RINGS);
    this.rStart = new Float32Array(RINGS);
    this.rEnd = new Float32Array(RINGS);
    this.rAlpha = new Float32Array(RINGS);
    this.rCursor = 0;
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: ADD,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.rings.push(ring);
      this.root.add(ring);
    }
  }

  _buildLights() {
    this.lights = [];
    this.lLife = new Float32Array(LIGHTS);
    this.lMax = new Float32Array(LIGHTS);
    this.lStart = new Float32Array(LIGHTS);
    this.lCursor = 0;
    for (let i = 0; i < LIGHTS; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 40, 2);
      // Stay visible at zero intensity. Toggling light.visible changes the
      // scene's active-light COUNT, which forces Three.js to recompile every
      // material the moment an explosion light turns on/off — the random
      // mid-combat freezes. A constant light count compiles exactly once.
      l.visible = true;
      this.lights.push(l);
      this.root.add(l);
    }
  }

  _buildBeams() {
    const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    const haloGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    this.beams = [];
    this.bLife = new Float32Array(BEAMS);
    this.bMax = new Float32Array(BEAMS);
    this.bCursor = 0;
    for (let i = 0; i < BEAMS; i++) {
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: ADD }));
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: ADD, side: THREE.DoubleSide }));
      core.visible = false;
      halo.visible = false;
      core.frustumCulled = false;
      halo.frustumCulled = false;
      this.beams.push({ core, halo });
      this.root.add(halo);
      this.root.add(core);
    }
  }

  _buildFirePools() {
    this.firePools = [];
    for (let i = 0; i < FIRE_POOLS; i++) {
      this.firePools.push({ pos: new THREE.Vector3(), radius: 0, life: 0, maxLife: 0, acc: 0 });
    }
  }

  _buildAmbient() {
    this.ambientKind = "none";
    this.aPos = new Float32Array(AMBIENT * 3);
    this.aVel = new Float32Array(AMBIENT * 3);
    this.aCol = new Float32Array(AMBIENT * 3);
    this.aSize = new Float32Array(AMBIENT);
    this.ambientGeo = new THREE.BufferGeometry();
    this.ambientGeo.setAttribute("position", new THREE.BufferAttribute(this.aPos, 3));
    this.ambientGeo.setAttribute("color", new THREE.BufferAttribute(this.aCol, 3));
    this.ambientGeo.setAttribute("size", new THREE.BufferAttribute(this.aSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: ADD,
      vertexColors: true,
      uniforms: { map: { value: this.textures.soft } },
      vertexShader: pointVertexShader(),
      fragmentShader: pointFragmentShader(),
    });
    this.ambientPoints = new THREE.Points(this.ambientGeo, mat);
    this.ambientPoints.frustumCulled = false;
    this.ambientPoints.visible = false;
    this.root.add(this.ambientPoints);
  }

  _spawnParticle(pos, vel, life, startSize, endSize, color, gravity, drag, alpha) {
    const i = this.pCursor++ % PARTICLES;
    const j = i * 3;
    this.pPos[j] = pos.x; this.pPos[j + 1] = pos.y; this.pPos[j + 2] = pos.z;
    this.pVel[j] = vel.x; this.pVel[j + 1] = vel.y; this.pVel[j + 2] = vel.z;
    setColor(this.pBase, j, color);
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pStart[i] = startSize;
    this.pEnd[i] = endSize;
    this.pGravity[i] = gravity;
    this.pDrag[i] = drag;
    this.pAlpha[i] = alpha;
    this.pSize[i] = startSize;
  }

  _spawnSprite(pos, start, end, life, color, texture, blending, alpha, spin) {
    const i = this.sCursor++ % SPRITES;
    const s = this.sprites[i];
    s.position.copy(pos);
    s.scale.setScalar(start);
    s.material.map = texture;
    s.material.color.setHex(color);
    s.material.blending = blending;
    s.material.opacity = alpha;
    s.material.rotation = this._rand(0, Math.PI * 2);
    s.visible = true;
    this.sVel[i * 3] = this._rand(-1.5, 1.5);
    this.sVel[i * 3 + 1] = this._rand(0.4, 3.8);
    this.sVel[i * 3 + 2] = this._rand(-1.5, 1.5);
    this.sLife[i] = life;
    this.sMax[i] = life;
    this.sStart[i] = start;
    this.sEnd[i] = end;
    this.sAlpha[i] = alpha;
    this.sSpin[i] = spin;
  }

  _spawnSegment(from, to, life, color, alpha) {
    const i = this.segCursor++ % SEGMENTS;
    const j = i * 6;
    this.segPos[j] = from.x; this.segPos[j + 1] = from.y; this.segPos[j + 2] = from.z;
    this.segPos[j + 3] = to.x; this.segPos[j + 4] = to.y; this.segPos[j + 5] = to.z;
    setColor(this.segBase, i * 3, color);
    this.segLife[i] = life;
    this.segMax[i] = life;
    this.segAlpha[i] = alpha;
  }

  _spawnRing(pos, start, end, life, color, alpha, ground) {
    const i = this.rCursor++ % RINGS;
    const r = this.rings[i];
    r.position.set(pos.x, pos.y + (ground ? 0.08 : 0), pos.z);
    r.scale.setScalar(start);
    r.material.color.setHex(color);
    r.material.opacity = alpha;
    r.visible = true;
    this.rLife[i] = life;
    this.rMax[i] = life;
    this.rStart[i] = start;
    this.rEnd[i] = end;
    this.rAlpha[i] = alpha;
  }

  _spawnLight(pos, color, intensity, distance, life) {
    const i = this.lCursor++ % LIGHTS;
    const l = this.lights[i];
    l.position.copy(pos);
    l.color.setHex(color);
    l.intensity = intensity;
    l.distance = distance;
    // never toggle l.visible — keep the light count constant (see _buildLights)
    this.lLife[i] = life;
    this.lMax[i] = life;
    this.lStart[i] = intensity;
  }

  _spawnBeam(from, to, color, life) {
    const i = this.bCursor++ % BEAMS;
    const beam = this.beams[i];
    const dir = this._v0.copy(to).sub(from);
    const len = Math.max(0.001, dir.length());
    dir.multiplyScalar(1 / len);
    const mid = this._v1.copy(from).add(to).multiplyScalar(0.5);
    this._q0.setFromUnitVectors(this._axisY, dir);
    beam.core.position.copy(mid);
    beam.halo.position.copy(mid);
    beam.core.quaternion.copy(this._q0);
    beam.halo.quaternion.copy(this._q0);
    beam.core.scale.set(0.55, len, 0.55);
    beam.halo.scale.set(2.5, len, 2.5);
    beam.core.material.color.setHex(0xffffff);
    beam.halo.material.color.setHex(color);
    beam.core.material.opacity = 1;
    beam.halo.material.opacity = 0.34;
    beam.core.visible = true;
    beam.halo.visible = true;
    this.bLife[i] = life;
    this.bMax[i] = life;
  }

  _updateParticles(dt) {
    let dirty = false;
    for (let i = 0; i < PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const j = i * 3;
      if (this.pLife[i] <= 0) {
        this.pSize[i] = 0;
        dirty = true;
        continue;
      }
      const drag = Math.pow(this.pDrag[i], dt * 60);
      this.pVel[j] *= drag;
      this.pVel[j + 1] = this.pVel[j + 1] * drag + this.pGravity[i] * dt;
      this.pVel[j + 2] *= drag;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] += this.pVel[j + 1] * dt;
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
      const t = 1 - this.pLife[i] / this.pMax[i];
      const fade = (1 - t) * this.pAlpha[i];
      this.pSize[i] = this.pStart[i] + (this.pEnd[i] - this.pStart[i]) * smooth(t);
      this.pCol[j] = this.pBase[j] * fade;
      this.pCol[j + 1] = this.pBase[j + 1] * fade;
      this.pCol[j + 2] = this.pBase[j + 2] * fade;
      dirty = true;
    }
    if (dirty) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.color.needsUpdate = true;
      this.pGeo.attributes.size.needsUpdate = true;
    }
  }

  _updateSprites(dt) {
    for (let i = 0; i < SPRITES; i++) {
      if (this.sLife[i] <= 0) continue;
      this.sLife[i] -= dt;
      const s = this.sprites[i];
      if (this.sLife[i] <= 0) {
        s.visible = false;
        continue;
      }
      const j = i * 3;
      s.position.x += this.sVel[j] * dt;
      s.position.y += this.sVel[j + 1] * dt;
      s.position.z += this.sVel[j + 2] * dt;
      const t = 1 - this.sLife[i] / this.sMax[i];
      const size = this.sStart[i] + (this.sEnd[i] - this.sStart[i]) * smooth(t);
      s.scale.setScalar(size);
      s.material.opacity = this.sAlpha[i] * (1 - t);
      s.material.rotation += this.sSpin[i] * dt;
    }
  }

  _updateSegments(dt) {
    let dirty = false;
    for (let i = 0; i < SEGMENTS; i++) {
      if (this.segLife[i] <= 0) continue;
      this.segLife[i] -= dt;
      const j = i * 6;
      if (this.segLife[i] <= 0) {
        for (let k = 0; k < 6; k++) this.segPos[j + k] = 0;
        dirty = true;
        continue;
      }
      const t = this.segLife[i] / this.segMax[i] * this.segAlpha[i];
      const c = i * 3;
      this.segCol[j] = this.segBase[c] * t;
      this.segCol[j + 1] = this.segBase[c + 1] * t;
      this.segCol[j + 2] = this.segBase[c + 2] * t;
      this.segCol[j + 3] = this.segBase[c] * t;
      this.segCol[j + 4] = this.segBase[c + 1] * t;
      this.segCol[j + 5] = this.segBase[c + 2] * t;
      dirty = true;
    }
    if (dirty) {
      this.segGeo.attributes.position.needsUpdate = true;
      this.segGeo.attributes.color.needsUpdate = true;
    }
  }

  _updateRings(dt) {
    for (let i = 0; i < RINGS; i++) {
      if (this.rLife[i] <= 0) continue;
      this.rLife[i] -= dt;
      const r = this.rings[i];
      if (this.rLife[i] <= 0) {
        r.visible = false;
        continue;
      }
      const t = 1 - this.rLife[i] / this.rMax[i];
      r.scale.setScalar(this.rStart[i] + (this.rEnd[i] - this.rStart[i]) * smooth(t));
      r.material.opacity = this.rAlpha[i] * (1 - t);
    }
  }

  _updateLights(dt) {
    for (let i = 0; i < LIGHTS; i++) {
      if (this.lLife[i] <= 0) continue;
      this.lLife[i] -= dt;
      const l = this.lights[i];
      if (this.lLife[i] <= 0) {
        l.intensity = 0; // stay visible — keep light count constant
        continue;
      }
      const t = this.lLife[i] / this.lMax[i];
      l.intensity = this.lStart[i] * t * t;
    }
  }


  _updateBeams(dt) {
    for (let i = 0; i < BEAMS; i++) {
      if (this.bLife[i] <= 0) continue;
      this.bLife[i] -= dt;
      const b = this.beams[i];
      if (this.bLife[i] <= 0) {
        b.core.visible = false;
        b.halo.visible = false;
        continue;
      }
      const t = this.bLife[i] / this.bMax[i];
      b.core.material.opacity = t;
      b.halo.material.opacity = 0.34 * t;
    }
  }

  _updateFirePools(dt) {
    for (let i = 0; i < FIRE_POOLS; i++) {
      const f = this.firePools[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      const strength = Math.max(0, Math.min(1, f.life / Math.max(0.001, f.maxLife)));
      f.acc += dt * (18 + f.radius * 1.2);
      while (f.acc >= 1 && f.life > 0) {
        f.acc -= 1;
        const a = this._rand(0, Math.PI * 2);
        const r = Math.sqrt(this._rand(0, 1)) * f.radius;
        this._v0.set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.25, f.pos.z + Math.sin(a) * r);
        this._spawnSprite(this._v0, this._rand(3, 6) * strength, this._rand(8, 16) * strength, this._rand(0.25, 0.55), this._rand(0, 1) > 0.35 ? 0xff5a19 : 0xffc23a, this.textures.glow, ADD, 0.65 * strength, this._rand(-6, 6));
        if (this._rand(0, 1) > 0.45) {
          this._v1.set(this._rand(-1, 1), this._rand(2, 7), this._rand(-1, 1));
          this._spawnParticle(this._v0, this._v1, this._rand(0.9, 1.8), 1.5, this._rand(6, 12), 0x191716, 0.4, 0.94, 0.28 * strength);
        }
      }
    }
  }

  _updateAmbient(dt) {
    if (this.ambientKind === "none") return;
    const snow = this.ambientKind === "snow";
    const c = this.ambientCenter;
    for (let i = 0; i < AMBIENT; i++) {
      const j = i * 3;
      this.aPos[j] += this.aVel[j] * dt;
      this.aPos[j + 1] += this.aVel[j + 1] * dt;
      this.aPos[j + 2] += this.aVel[j + 2] * dt;
      if (snow) {
        if (this.aPos[j + 1] < c.y - 15 || Math.abs(this.aPos[j] - c.x) > 260 || Math.abs(this.aPos[j + 2] - c.z) > 260) this._resetAmbient(i, false);
      } else if (this.aPos[j + 1] > c.y + 95 || Math.abs(this.aPos[j] - c.x) > 260 || Math.abs(this.aPos[j + 2] - c.z) > 260) {
        this._resetAmbient(i, false);
      }
    }
    this.ambientGeo.attributes.position.needsUpdate = true;
  }

  _resetAmbient(i, initial) {
    const j = i * 3;
    const c = this.ambientCenter;
    if (this.ambientKind === "snow") {
      this.aPos[j] = c.x + this._rand(-250, 250);
      this.aPos[j + 1] = c.y + (initial ? this._rand(-5, 120) : this._rand(70, 120));
      this.aPos[j + 2] = c.z + this._rand(-250, 250);
      this.aVel[j] = this._rand(-1.2, 1.2);
      this.aVel[j + 1] = this._rand(-9, -4);
      this.aVel[j + 2] = this._rand(-1.2, 1.2);
      this.aCol[j] = 0.72; this.aCol[j + 1] = 0.86; this.aCol[j + 2] = 1.0;
      this.aSize[i] = this._rand(1.2, 3.3);
    } else if (this.ambientKind === "embers") {
      this.aPos[j] = c.x + this._rand(-250, 250);
      this.aPos[j + 1] = c.y + (initial ? this._rand(0, 95) : this._rand(-5, 20));
      this.aPos[j + 2] = c.z + this._rand(-250, 250);
      this.aVel[j] = this._rand(-1.8, 1.8);
      this.aVel[j + 1] = this._rand(3, 12);
      this.aVel[j + 2] = this._rand(-1.8, 1.8);
      const ash = this._rand(0, 1) > 0.72;
      this.aCol[j] = ash ? 0.38 : 1.0; this.aCol[j + 1] = ash ? 0.34 : 0.34; this.aCol[j + 2] = ash ? 0.3 : 0.06;
      this.aSize[i] = ash ? this._rand(1.5, 3.4) : this._rand(1.0, 2.6);
    } else {
      this.aSize[i] = 0;
    }
  }

  _rand(a, b) {
    this._seed ^= this._seed << 13;
    this._seed ^= this._seed >>> 17;
    this._seed ^= this._seed << 5;
    return a + ((this._seed >>> 0) / 4294967295) * (b - a);
  }

  _mixColor(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
  }
}

function setColor(arr, i, color) {
  arr[i] = ((color >> 16) & 255) / 255;
  arr[i + 1] = ((color >> 8) & 255) / 255;
  arr[i + 2] = (color & 255) / 255;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function makeRadialTexture(size, stops) {
  const data = new Uint8Array(size * size * 4);
  const mid = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - mid) / mid;
      const dy = (y - mid) / mid;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      let a = stops[0], b = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (d >= stops[i][0] && d <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
      }
      const span = Math.max(0.0001, b[0] - a[0]);
      const t = smooth((d - a[0]) / span);
      const o = (y * size + x) * 4;
      data[o] = Math.round((a[1] + (b[1] - a[1]) * t) * 255);
      data[o + 1] = Math.round((a[2] + (b[2] - a[2]) * t) * 255);
      data[o + 2] = Math.round((a[3] + (b[3] - a[3]) * t) * 255);
      data[o + 3] = Math.round((a[4] + (b[4] - a[4]) * t) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeStarTexture(size) {
  const data = new Uint8Array(size * size * 4);
  const mid = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - mid) / mid;
      const dy = (y - mid) / mid;
      const r = Math.sqrt(dx * dx + dy * dy);
      const cross = Math.max(Math.exp(-Math.abs(dx) * 18) * (1 - Math.abs(dy)), Math.exp(-Math.abs(dy) * 18) * (1 - Math.abs(dx)));
      const core = Math.max(0, 1 - r * 1.55);
      const a = Math.max(0, Math.min(1, core * core + cross * 0.75));
      const o = (y * size + x) * 4;
      data[o] = 255; data[o + 1] = 238; data[o + 2] = 178; data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function pointVertexShader() {
  return /* glsl */ `
    attribute float size;
    varying vec3 vColor;
    void main() {
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (300.0 / max(1.0, -mvPosition.z));
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
}

function pointFragmentShader() {
  return /* glsl */ `
    uniform sampler2D map;
    varying vec3 vColor;
    void main() {
      vec4 tex = texture2D(map, gl_PointCoord);
      gl_FragColor = vec4(vColor, tex.a);
    }
  `;
}
