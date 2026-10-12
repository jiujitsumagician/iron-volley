// Security regression checks: HTML escaping of peer-supplied strings, room
// code format, malformed-message tolerance in NetSession, and the dev
// server's path/dotfile handling. The browser part needs Playwright.
// Run: node test/security-check.mjs
import assert from "node:assert";
import { spawn } from "node:child_process";
import { esc, cleanName } from "../src/util.js";
import { makeRoomCode, NetSession } from "../src/net.js";

// ── esc ──
assert.strictEqual(esc('<img src=x onerror="a()">&\''), "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
assert.strictEqual(esc(null), "");
assert.strictEqual(esc("CHALLENGER"), "CHALLENGER");
console.log("ok: esc escapes markup and leaves plain names alone");

// ── hello name sanitiser ──
assert.strictEqual(cleanName("Bob_1"), "Bob_1");
assert.strictEqual(cleanName("Alice-B. 2"), "Alice-B. 2");
assert.strictEqual(cleanName("<img src=x>"), "img srcx");
assert.strictEqual(cleanName("<>"), "CHALLENGER");
assert.strictEqual(cleanName(undefined), "CHALLENGER");
assert.strictEqual(cleanName("x".repeat(40)).length, 16);
console.log("ok: peer names keep letters, digits, underscore, space, dot, hyphen");

// ── room codes ──
for (let i = 0; i < 1000; i++) assert.match(makeRoomCode(), /^[A-HJ-KM-NP-Z2-9]{5}$/);
console.log("ok: room codes keep the 5-char alphabet format");

// ── malformed peer messages never throw out of the data handler ──
{
  let onData;
  const conn = { on: (e, cb) => { if (e === "data") onData = cb; } };
  const s = new NetSession();
  let got = null;
  s.on("input", (d) => { got = d; });
  s.on("boom", () => { throw new Error("handler bug"); });
  s._wire(conn);
  for (const bad of [null, undefined, 5, "x", [], { y: 3 }, { y: "nope" }, { y: "boom" }]) onData(bad);
  onData({ y: "input", d: { throttle: 1 } });
  assert.deepStrictEqual(got, { throttle: 1 });
  console.log("ok: NetSession ignores malformed envelopes and survives throwing handlers");
}

// ── dev server: no dotfiles / traversal, loopback only ──
{
  const PORT = 8197;
  const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).status;
    assert.strictEqual(await get("/"), 200);
    assert.strictEqual(await get("/.git/config"), 404);
    assert.strictEqual(await get("/..%2fpackage.json"), 404);
    console.log("ok: serve.mjs serves the app but not dotfiles or traversal paths");
  } finally { server.kill(); }
}

// ── browser: peer-supplied names must not execute as HTML ──
let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.log("skip: playwright not installed"); }
if (chromium) {
  const PORT = 8198;
  const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__END === "function", null, { timeout: 30000 });
    const r = await page.evaluate(async () => {
      const { SharedHud } = await import("/src/hud.js");
      const hud = new SharedHud();
      const evil = "<img src=x onerror=window.__x=1>";
      hud.addKill(evil, "mg", "VICTIM");
      hud.addKill("YOU", "cannon", "DOZER");
      window.__END({
        winner: evil, winnerIsPlayer: false,
        standings: [{ name: evil, chassis: evil, kills: "<b>9</b>", deaths: 1, isPlayer: false, chassisId: "viper", teamId: "red", skinId: null }],
      });
      await new Promise((r) => setTimeout(r, 300));
      const feed = document.querySelector(".killfeed");
      return {
        x: window.__x,
        injected: document.querySelectorAll("img[src='x']").length,
        feedText: feed.textContent,
        normal: feed.children[0].textContent,
      };
    });
    assert.strictEqual(r.x, undefined, "onerror payload executed");
    assert.strictEqual(r.injected, 0, "peer markup produced DOM elements");
    assert(r.feedText.includes("<img src=x onerror=window.__x=1>"), "markup should appear as literal text");
    assert(r.normal.includes("YOU") && r.normal.includes("DOZER"), "normal names render unchanged");
    console.log("ok: peer-supplied names render as text in kill feed and end screen");
  } finally { await browser.close(); server.kill(); }
}
console.log("SECURITY CHECK: PASSED");
