// Injects a synthetic STANDARD gamepad and verifies it drives gameplay
// (throttle, turret, fire) — not just the menu.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8142;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

// Install a controllable synthetic standard pad BEFORE the app boots.
await page.addInitScript(() => {
  window.__PAD = {
    index: 0,
    id: "Synthetic (STANDARD GAMEPAD)",
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [window.__PAD];
});

// Solo match, no bots, human-controlled (no &auto).
await page.goto(`${BASE}/?test&map=dunes&bots=0&players=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!(window.__IV && window.__IV.game?.players?.[0]?.tank), null, { timeout: 30000 });
// Clear the 2.4s match-start freeze (which intentionally zeros
// throttle/fire/mg) so we measure real control, not the countdown.
// (Headless swiftshader runs game-time too slowly to wait it out.)
await page.evaluate(() => { window.__IV.game.startFreeze = 0; });
await page.waitForTimeout(200);

const setPad = (mut) => page.evaluate((m) => {
  Object.assign(window.__PAD.axes, m.axes ?? {});
  if (m.btn != null) { window.__PAD.buttons[m.btn].pressed = true; window.__PAD.buttons[m.btn].value = 1; }
  window.__PAD.timestamp = (window.__PAD.timestamp || 0) + 1;
}, mut);
const readInput = () => page.evaluate(() => {
  const inp = window.__IV.game.players[0].tank.input || {};
  const mgr = window.__IV.game.gamepads.read(0);
  return {
    throttle: inp.throttle ?? 0, turretTurn: inp.turretTurn ?? 0, pitch: inp.pitch ?? 0, fire: !!inp.fire, mg: !!inp.mg,
    _mgr: { throttle: mgr.throttle, turretTurn: mgr.turretTurn, fire: mgr.fire, mg: mgr.mg },
  };
});

let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

// Keep the freeze cleared every poll (headless game-time is slow & erratic),
// hold the input, and poll up to ~3s for it to reach the tank. Timeout = real bug.
const hold = (setup) => page.evaluate(setup);
const poll = (pred) => page.waitForFunction((p) => {
  window.__IV.game.startFreeze = 0;            // keep us out of the countdown
  const inp = window.__IV.game.players[0].tank.input || {};
  return new Function("inp", `return ${p}`)(inp);
}, pred, { timeout: 3500, polling: 50 }).then(() => true).catch(() => false);

// Left stick forward → throttle ~ +1
await hold(() => { window.__PAD.axes = [0, -1, 0, 0]; window.__PAD.timestamp++; });
if (!(await poll("(inp.throttle ?? 0) > 0.6"))) fail(`left stick forward did not drive (${JSON.stringify(await readInput())})`);

// Right stick X → turret turn
await hold(() => { window.__PAD.axes = [0, 0, 1, 0]; window.__PAD.timestamp++; });
if (!(await poll("Math.abs(inp.turretTurn ?? 0) > 0.6"))) fail(`right stick did not turn turret (${JSON.stringify(await readInput())})`);

// Right stick Y → barrel pitch
await hold(() => { window.__PAD.axes = [0, 0, 0, -1]; window.__PAD.timestamp++; });
if (!(await poll("Math.abs(inp.pitch ?? 0) > 0.6"))) fail(`right stick Y did not pitch the barrel (${JSON.stringify(await readInput())})`);

// RT (button 7) → fire
await hold(() => { window.__PAD.axes = [0, 0, 0, 0]; window.__PAD.buttons[7].pressed = true; window.__PAD.buttons[7].value = 1; window.__PAD.timestamp++; });
if (!(await poll("inp.fire === true"))) fail(`RT did not register fire (${JSON.stringify(await readInput())})`);

// LT (button 6) → machine gun
await hold(() => { window.__PAD.buttons[7].pressed = false; window.__PAD.buttons[7].value = 0; window.__PAD.buttons[6].pressed = true; window.__PAD.buttons[6].value = 1; window.__PAD.timestamp++; });
if (!(await poll("inp.mg === true"))) fail(`LT did not register machine gun (${JSON.stringify(await readInput())})`);

// Generic/DInput pad: 6 axes, right-stick X parked on axis 4 (axis 2 flat).
// The additive fallback should still let the turret aim.
await page.evaluate(() => {
  window.__PAD.axes = [0, 0, 0, 0, 0, 0];
  window.__PAD.buttons.forEach((b) => { b.pressed = false; b.value = 0; });
  window.__PAD.timestamp++;
});
await page.waitForTimeout(120);
await hold(() => { window.__PAD.axes = [0, 0, 0, 0, 0.8, 0]; window.__PAD.timestamp++; });
if (!(await poll("Math.abs(inp.turretTurn ?? 0) > 0.4"))) fail(`generic pad (RX on axis 4) did not turn turret (${JSON.stringify(await readInput())})`);

if (errors.length) fail(`console/page errors: ${errors.join(" | ")}`);

await browser.close();
server.kill();
console.log(failed ? "PAD GAMEPLAY: FAILED" : "PAD GAMEPLAY: PASSED");
process.exit(failed ? 1 : 0);
