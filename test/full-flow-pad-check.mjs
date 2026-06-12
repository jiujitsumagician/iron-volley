// FULL real flow: boot normally (audio ON), drive the menus with a synthetic
// pad only (no clicks/keyboard), launch a real solo match, sit through the
// start freeze, then verify throttle + fire work in the arena.
// Usage: node test/full-flow-pad-check.mjs [url]
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8153;
let server = null;
let base = process.argv[2];
if (!base) {
  server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));
  base = `http://localhost:${PORT}/`;
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });

await page.addInitScript(() => {
  window.__PAD = { index: 0, id: "Synthetic (STANDARD GAMEPAD)", connected: true, mapping: "standard", timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [window.__PAD];
  window.__FRAMES = 0;
  const tick = () => { window.__FRAMES++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

await page.goto(base, { waitUntil: "load", timeout: 30000 });
await page.waitForSelector(".choice[data-v=solo]", { timeout: 20000 });

const waitFrames = async (n) => {
  const f0 = await page.evaluate(() => window.__FRAMES);
  await page.waitForFunction((f) => window.__FRAMES >= f, f0 + n, { timeout: 15000 });
};
const press = async (btn) => {
  await page.evaluate((b) => { window.__PAD.buttons[b].pressed = true; window.__PAD.buttons[b].value = 1; window.__PAD.timestamp++; }, btn);
  await waitFrames(3);
  await page.evaluate((b) => { window.__PAD.buttons[b].pressed = false; window.__PAD.buttons[b].value = 0; window.__PAD.timestamp++; }, btn);
  await waitFrames(3);
};

// Walk the menu with A presses (focus starts on the forward action of each
// screen once a pad is active). First press just reveals the cursor.
const path = [];
const focusedNow = () => page.evaluate(() => {
  const f = document.querySelector("#menu .focus");
  return f ? (f.dataset.v ?? f.dataset.d ?? f.textContent.trim().slice(0, 24)) : "(none)";
});
for (let i = 0; i < 18; i++) {
  const inGame = await page.evaluate(() => !!window.__IV?.game);
  if (inGame) break;
  let focused = await focusedNow();
  if (focused === "(none)") { await press(13); path.push("[reveal]"); continue; }
  if (/Back/i.test(focused)) {
    await press(15); // move right off the Back button
    if ((await focusedNow()) === focused) await press(13);
    focused = await focusedNow();
    if (/Back/i.test(focused)) { path.push("STUCK-ON-BACK"); break; }
    path.push(`[skip-back->${focused}]`);
    continue;
  }
  path.push(focused);
  await press(0); // A
  await page.waitForTimeout(250);
}

const launched = await page.evaluate(() => !!window.__IV?.game);
if (!launched) {
  console.log(JSON.stringify({ path, errors }, null, 2));
  console.log("FULL FLOW: FAILED — never reached the arena via pad");
  await browser.close(); server?.kill(); process.exit(1);
}

// Sit through the REAL start freeze (game-time; slow headless fps stretches it)
await page.waitForFunction(() => window.__IV.game.startFreeze <= 0, null, { timeout: 60000 });

// throttle + fire via pad
await page.evaluate(() => { window.__PAD.axes[1] = -1; window.__PAD.timestamp++; });
await waitFrames(10);
const throttle = await page.evaluate(() => window.__IV.game.players[0]?.tank?.input?.throttle ?? null);
await page.evaluate(() => { window.__PAD.buttons[7].pressed = true; window.__PAD.buttons[7].value = 1; window.__PAD.timestamp++; });
await waitFrames(10);
const fired = await page.evaluate(() => {
  const t = window.__IV.game.players[0]?.tank;
  return { fireInput: t?.input?.fire ?? null, shellsLive: window.__IV.game.weapons?.shells?.length ?? "n/a" };
});

console.log(JSON.stringify({ path, throttle, fired, errors: errors.slice(0, 6) }, null, 2));
const ok = throttle > 0.5 && fired.fireInput === true && errors.length === 0;
console.log(ok ? "FULL FLOW: PASSED" : "FULL FLOW: FAILED");
await browser.close(); server?.kill();
process.exit(ok ? 0 : 1);
