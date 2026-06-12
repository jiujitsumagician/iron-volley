// Regression for the ASRock-LED-controller scenario: slot 0 holds a CONNECTED
// gamepad-shaped ghost that never emits input; the real pad sits in slot 1.
// The arena must bind to the real pad. Also: menu nav must still work.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const PORT = 8154;
const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  // ghost: connected, axes parked, buttons never pressed (ASRock LED controller)
  window.__GHOST = { index: 0, id: "ASRock LED Controller (Vendor: 26ce Product: 01a2)", connected: true,
    mapping: "", timestamp: 0, axes: [-1, -1, -1, -1, -1, -1, -1, -1, 0], 
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__PAD = { index: 1, id: "8BitDo Ultimate 2C (STANDARD GAMEPAD)", connected: true, mapping: "standard",
    timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [window.__GHOST, window.__PAD, null, null];
  window.__FRAMES = 0;
  const tick = () => { window.__FRAMES++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.goto(`http://localhost:${PORT}/?test&map=dunes&bots=0&players=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!(window.__IV && window.__IV.game?.players?.[0]?.tank), null, { timeout: 30000 });
await page.evaluate(() => { window.__IV.game.startFreeze = 0; });
await page.waitForTimeout(200);

const waitFrames = async (n) => {
  const f0 = await page.evaluate(() => window.__FRAMES);
  await page.waitForFunction((f) => window.__FRAMES >= f, f0 + n, { timeout: 15000 });
};

// real pad pushes throttle — arena must respond despite the ghost in slot 0
await page.evaluate(() => { window.__PAD.axes[1] = -1; window.__PAD.timestamp++; });
await waitFrames(10);
const throttle = await page.evaluate(() => window.__IV.game.players[0]?.tank?.input?.throttle ?? null);
// fire via RT (button 7)
await page.evaluate(() => { window.__PAD.buttons[7].pressed = true; window.__PAD.buttons[7].value = 1; window.__PAD.timestamp++; });
await waitFrames(10);
const fire = await page.evaluate(() => window.__IV.game.players[0]?.tank?.input?.fire ?? null);

console.log(JSON.stringify({ throttle, fire, errors }));
const ok = throttle > 0.5 && fire === true && errors.length === 0;
console.log(ok ? "PAD GHOST: PASSED" : "PAD GHOST: FAILED");
await browser.close(); server.kill();
process.exit(ok ? 0 : 1);
