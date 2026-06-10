// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Live title-screen diorama: a real slice of the engine running behind
 * the menu — two tanks duelling on a battlefield, shells arcing between
 * them, muzzle flashes and impacts, under a slow cinematic camera. Built
 * from the same procedural world + tank meshes the match uses, so the
 * menu literally shows the game it's about to start.
 */

import * as THREE from "three";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildWorld } from "./terrain.js";
import { mapById } from "./maps.js";
import { buildTankMesh } from "./tank.js";
import { TEAM_COLORS, chassisById } from "./tanks.js";
import { Effects } from "./effects.js";
import { GRAVITY } from "./weapons.js";

const UP = new THREE.Vector3(0, 1, 0);

export class TitleScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.t = 0;
    this.fireIn = 0.8;
    this.shells = [];

    const map = mapById("dunes");
    this.map = map;

    // image-based lighting for believable armor
    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.scene.fog = new THREE.Fog(map.fog.color, map.fog.near, map.fog.far);
    const hemi = new THREE.HemisphereLight(map.hemi.sky, map.hemi.ground, map.hemi.intensity);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(map.sunlight.color, map.sunlight.intensity);
    sun.position.set(...map.sky.sunPos).multiplyScalar(700);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const S = 120;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 50, far: 1600 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);

    const built = buildWorld(map);
    this.world = built;
    this.scene.add(built.group);

    this.effects = new Effects(this.scene);

    renderer.toneMappingExposure = map.exposure ?? 1.08;

    // two duelling tanks, low in a sandy bowl, turrets trained on each other
    this.duo = [];
    const A = this._placeTank("bastion", "crimson", -26, 8, built);
    const B = this._placeTank("viper", "cobalt", 24, -6, built);
    A.foe = B; B.foe = A;
    this.duo.push(A, B);
    this.mid = new THREE.Vector3(
      (A.root.position.x + B.root.position.x) / 2,
      (A.root.position.y + B.root.position.y) / 2 + 3,
      (A.root.position.z + B.root.position.z) / 2
    );

    this.cam = new THREE.PerspectiveCamera(46, 1, 0.5, 4000);

    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.geoShell = new THREE.SphereGeometry(0.6, 8, 8);
    this.matShell = new THREE.MeshBasicMaterial({ color: 0xffc163 });
  }

  _placeTank(chassisId, teamId, x, z, world) {
    const chassis = chassisById(chassisId);
    const team = TEAM_COLORS.find((c) => c.id === teamId) ?? TEAM_COLORS[0];
    const root = buildTankMesh(chassis.build, team);
    const y = world.heightAt(x, z);
    root.position.set(x, y, z);
    // sit flush on the slope, hull facing the foe (same basis as the sim)
    const faceAngle = Math.atan2(-x, -z);
    const n = world.normalAt(x, z, new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(faceAngle), 0, Math.cos(faceAngle));
    const right = new THREE.Vector3().crossVectors(UP, fwd).normalize();
    const f2 = new THREE.Vector3().crossVectors(right, n).normalize().negate();
    root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, n, f2.negate()));
    this.scene.add(root);
    return {
      root, chassis,
      turret: root.getObjectByName("turret"),
      barrel: root.getObjectByName("barrel"),
      muzzle: root.getObjectByName("muzzle"),
      recoil: 0,
    };
  }

  resize(w, h) {
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;

    // ── cinematic camera: slow orbit, looking just above the duel so
    // the two tanks frame into the lower third (below the title panel) ──
    const a = this.t * 0.08 + 0.5;
    const R = 54;
    this.cam.position.set(
      this.mid.x + Math.cos(a) * R,
      this.mid.y + 17 + Math.sin(this.t * 0.22) * 2.5,
      this.mid.z + Math.sin(a) * R
    );
    this.cam.lookAt(this.mid.x, this.mid.y + 10, this.mid.z);

    // ── aim + recoil settle ──
    for (const t of this.duo) {
      t.barrel.rotation.x = -0.26 - t.recoil * 0.5;
      t.recoil = Math.max(0, t.recoil - dt * 3);
      // subtle turret breathing
      t.turret.rotation.y = Math.sin(this.t * 0.4 + t.root.position.x) * 0.05;
    }

    // ── trade fire ──
    this.fireIn -= dt;
    if (this.fireIn <= 0) {
      this.fireIn = 1.1 + Math.random() * 1.4;
      this._fire(this.duo[(Math.random() * 2) | 0]);
    }

    // ── advance diorama shells ──
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      s.vel.y -= GRAVITY * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.trail += dt;
      if (s.trail > 0.03) { s.trail = 0; this.effects.smokeTrail(s.pos); }
      const gh = this.world.heightAt(s.pos.x, s.pos.z);
      const hitFoe = s.pos.distanceToSquared(s.target) < 60;
      if (s.pos.y <= gh || hitFoe || s.age > 6) {
        this.effects.explosion(s.pos.setY(Math.max(gh, s.pos.y)), { radius: 11 });
        this.world.deform?.(s.pos.x, s.pos.z, 10, 3.2);
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }

    this.effects.ambientCenter.copy(this.mid);
    this.effects.update(dt);
  }

  _fire(t) {
    const muzzle = t.muzzle.getWorldPosition(this._tmp).clone();
    const target = t.foe.root.position.clone().setY(t.foe.root.position.y + 2);
    // a lobbed shell that lands on the foe
    const flat = Math.hypot(target.x - muzzle.x, target.z - muzzle.z);
    const speed = 78;
    const dir = this._dir.set(target.x - muzzle.x, 0, target.z - muzzle.z).normalize();
    const vy = (GRAVITY * flat) / (2 * speed) + 6; // rough arc to the foe
    const vel = new THREE.Vector3(dir.x * speed, vy, dir.z * speed);
    this.effects.muzzleFlash(muzzle, dir);
    t.recoil = 1;
    const mesh = new THREE.Mesh(this.geoShell, this.matShell);
    mesh.position.copy(muzzle);
    this.scene.add(mesh);
    this.shells.push({ pos: muzzle.clone(), vel, mesh, age: 0, trail: 0, target });
  }

  render() {
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    for (const s of this.shells) this.scene.remove(s.mesh);
    this.shells.length = 0;
    this.effects.dispose(); // detaches effects.root + frees its textures first
    this.geoShell.dispose();
    this.matShell.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          m.map?.dispose?.();
          m.dispose?.();
        });
      }
    });
    this.scene.environment?.dispose?.();
  }
}
