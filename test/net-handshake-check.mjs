// Deterministic test of the online lobby handshake protocol (no broker,
// no WebRTC — those need a networked machine; see net-check.mjs for the
// live two-peer test). Uses the REAL NetSession with linked in-memory
// channels, DROPS the guest's first "hello" (the exact failure that
// deadlocked the lobby), and asserts the resend + ack recovers so the
// host learns the loadout and can start.
import { NetSession } from "../src/net.js";
import assert from "node:assert";

function makePair({ dropFirstAtoB = false } = {}) {
  const a = { open: true, _h: {} }, b = { open: true, _h: {} };
  let dropped = false;
  const on = (o) => (e, cb) => { (o._h[e] = o._h[e] || []).push(cb); };
  a.on = on(a); b.on = on(b);
  const deliver = (o, obj) => queueMicrotask(() => (o._h.data || []).forEach((f) => f(obj)));
  a.send = (obj) => { if (dropFirstAtoB && !dropped) { dropped = true; return; } deliver(b, obj); };
  b.send = (obj) => deliver(a, obj);
  a.close = () => { a.open = false; (a._h.close || []).forEach((f) => f()); };
  b.close = () => { b.open = false; (b._h.close || []).forEach((f) => f()); };
  return { a, b };
}

async function run() {
  const { a, b } = makePair({ dropFirstAtoB: true }); // a = guest conn, b = host conn
  const guest = new NetSession(); guest.role = "guest"; guest._wire(a);
  const host = new NetSession(); host.role = "host"; host._wire(b);

  // ── host lobby logic (mirrors menu.hostLobby) ──
  let hostReady = false, helloCount = 0;
  host.on("hello", (d) => {
    helloCount++;
    host.send("helloack", {});          // ack every hello so the guest stops
    if (!hostReady) { hostReady = true; host._loadout = d; } // reveal "start" once
  });

  // ── guest wait logic (mirrors menu.guestWait) ──
  let acked = false, sends = 0;
  const sendHello = () => { sends++; guest.send("hello", { chassisId: "scout" }); };
  guest.on("helloack", () => { acked = true; clearInterval(timer); });
  sendHello();                           // first hello — will be DROPPED
  const timer = setInterval(sendHello, 30);

  // Give the resend loop time to recover.
  await new Promise((r) => setTimeout(r, 400));
  clearInterval(timer);

  assert.ok(sends >= 2, `guest resent hello after the drop (sent ${sends})`);
  console.log(`ok: guest resent hello past the dropped first one (${sends} sends)`);
  assert.ok(hostReady, "host received the loadout and can start");
  console.log("ok: host received loadout despite first hello being dropped");
  assert.strictEqual(host._loadout.chassisId, "scout", "host has the guest's chassis");
  console.log("ok: host has the correct guest loadout (scout)");
  assert.ok(acked, "guest got helloack and stopped resending");
  console.log("ok: guest acknowledged, stopped resending");

  // Config over the (host->guest) channel reaches the guest.
  let gotConfig = null;
  guest.on("config", (c) => { gotConfig = c; });
  host.send("config", { mapId: "dunes", killTarget: 10 });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(gotConfig && gotConfig.mapId === "dunes", "config reached the guest");
  console.log("ok: host config reached the guest → match starts");
}

run().then(
  () => { console.log("\nHANDSHAKE CHECK: PASSED"); process.exit(0); },
  (e) => { console.log("FAIL:", e.message); console.log("\nHANDSHAKE CHECK: FAILED"); process.exit(1); }
);
