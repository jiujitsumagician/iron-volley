// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Online play over WebRTC (PeerJS, loaded globally from CDN — uses the
 * free PeerJS cloud broker for signaling, then traffic is peer-to-peer).
 *
 * Model: HOST-AUTHORITATIVE. The host runs the entire simulation and
 * streams compact snapshots at 15Hz; the guest renders interpolated
 * state and sends inputs at 30Hz. Works from any static hosting
 * (GitHub Pages included) — there is no game server.
 *
 * Room codes are 5 characters, mapped to a peer id namespace.
 */

const PREFIX = "iron-volley-v1-";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

export function makeRoomCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  return s;
}

export class NetSession {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // "host" | "guest"
    this.handlers = new Map();
    this.onClose = null;
    this.connected = false;
  }

  on(type, cb) {
    this.handlers.set(type, cb);
  }

  send(type, data) {
    if (this.conn?.open) {
      try { this.conn.send({ y: type, d: data }); } catch { /* drop */ }
    }
  }

  _wire(conn) {
    this.conn = conn;
    conn.on("data", (msg) => {
      const cb = this.handlers.get(msg?.y);
      if (cb) cb(msg.d);
    });
    conn.on("close", () => {
      this.connected = false;
      this.onClose?.();
    });
    conn.on("error", () => {
      this.connected = false;
      this.onClose?.();
    });
  }

  /** Host a room. Resolves with the room code once registered. */
  host(onGuestConnected) {
    this.role = "host";
    return new Promise((resolve, reject) => {
      const code = makeRoomCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      this.peer = peer;
      const fail = setTimeout(() => reject(new Error("Could not reach the matchmaking service")), 15000);
      peer.on("open", () => {
        clearTimeout(fail);
        resolve(code);
      });
      peer.on("error", (e) => {
        clearTimeout(fail);
        if (String(e?.type) === "unavailable-id") {
          // collision (rare) — caller can retry
          reject(new Error("Room code collision — try again"));
        }
      });
      peer.on("connection", (conn) => {
        if (this.conn?.open) { conn.close(); return; } // one guest only
        conn.on("open", () => {
          this.connected = true;
          this._wire(conn);
          onGuestConnected?.();
        });
      });
    });
  }

  /** Join a room by code. Resolves when the data channel is open. */
  join(code) {
    this.role = "guest";
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      const fail = setTimeout(() => reject(new Error("Could not find that room")), 15000);
      peer.on("open", () => {
        const conn = peer.connect(PREFIX + code.toUpperCase().trim(), { reliable: false });
        conn.on("open", () => {
          clearTimeout(fail);
          this.connected = true;
          this._wire(conn);
          resolve();
        });
        conn.on("error", () => {
          clearTimeout(fail);
          reject(new Error("Could not connect to that room"));
        });
      });
      peer.on("error", (e) => {
        clearTimeout(fail);
        reject(new Error(String(e?.type) === "peer-unavailable" ? "Room not found — check the code" : "Connection failed"));
      });
    });
  }

  destroy() {
    try { this.conn?.close(); } catch { /* fine */ }
    try { this.peer?.destroy(); } catch { /* fine */ }
    this.conn = null;
    this.peer = null;
    this.connected = false;
    this.handlers.clear();
  }
}

// ── snapshot codec ─────────────────────────────────────────────
// Arrays, not objects — a 10-tank snapshot is ~600 bytes of JSON.

export function encodeSnapshot(game) {
  const tanks = game.world.tanks.map((t) => [
    +t.pos.x.toFixed(1), +t.pos.z.toFixed(1),
    +t.yaw.toFixed(3), +t.turretYaw.toFixed(3), +t.barrelPitch.toFixed(3),
    Math.round(t.hp), t.alive ? 1 : 0,
    +t.speed.toFixed(1),
    +t.reloadLeft.toFixed(2),
    t.special ? t.special.type : "",
    t.special ? t.special.ammo : 0,
    t.input.mg ? 1 : 0,
    t.kills,
  ]);
  const shells = game.weapons.shells.map((s) => [
    +s.pos.x.toFixed(1), +s.pos.y.toFixed(1), +s.pos.z.toFixed(1), s.type, s.small ? 1 : 0,
  ]);
  const crates = game.pickups.crates.map((c) => [+c.x.toFixed(1), +c.z.toFixed(1), c.type]);
  return { t: tanks, s: shells, c: crates };
}

export function rosterFor(game, guestTankIndex) {
  return {
    mapId: game.map.id,
    killTarget: game.killTarget,
    you: guestTankIndex,
    tanks: game.world.tanks.map((t) => ({
      name: t.name,
      chassisId: t.chassis.id,
      teamId: t.team.id,
      skinId: t.skin?.id ?? null,
    })),
  };
}
