// Regression: a pad in browser slot 1 (slot 0 = null, as happens after a
// DInput/XInput flip or reconnect) must still drive the arena, not just menus.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const PORT = 8151;
const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__PAD = { index: 1, id: "Synthetic DInput (Vendor: 0810)", connected: true, mapping: "", timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  // Chrome-style 4-slot array with the pad NOT in slot 0
  navigator.getGamepads = () => [null, window.__PAD, null, null];
  window.__FRAMES = 0;
  const tick = () => { window.__FRAMES++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.goto(`http://localhost:${PORT}/?test&map=dunes&bots=0&players=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!(window.__IV && window.__IV.game?.players?.[0]?.tank), null, { timeout: 30000 });
await page.evaluate(() => { window.__IV.game.startFreeze = 0; });
await page.waitForTimeout(200);

// full throttle on the left stick — the tank must respond
await page.evaluate(() => { window.__PAD.axes[1] = -1; window.__PAD.timestamp++; });
const f0 = await page.evaluate(() => window.__FRAMES);
await page.waitForFunction((f) => window.__FRAMES >= f + 10, f0, { timeout: 10000 });
const arena = await page.evaluate(() => {
  const p = window.__IV.game.players[0];
  return { throttleInput: p.tank?.input?.throttle ?? p.input?.throttle ?? null };
});
console.log(JSON.stringify({ arena, errors }));
const ok = typeof arena.throttleInput === "number" && arena.throttleInput > 0.5 && errors.length === 0;
console.log(ok ? "PAD SLOT: PASSED" : "PAD SLOT: FAILED");
await browser.close(); server.kill();
process.exit(ok ? 0 : 1);
