// FINAL CONFIRMATION: real Chrome + real OS-level virtual 8BitDo Ultimate 2C
// (uinput clone, DInput shape) + the machine's real ghost devices, against the
// LIVE deployed site. Menus must navigate, arena must drive + fire.
// Usage: node test/real-chrome-confirm.mjs <url>
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const url = process.argv[2];
const pad = spawn("python3", ["new URL("./vpad2.py", import.meta.url).pathname", "u2c"], { stdio: ["pipe", "pipe", "inherit"] });
await new Promise((res) => pad.stdout.once("data", (d) => { console.log(String(d).trim()); res(); }));
await new Promise((r) => setTimeout(r, 1500));
const cmd = (line) => new Promise((res) => { pad.stdout.once("data", () => res()); pad.stdin.write(line + "\n"); });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "load", timeout: 30000 });
await page.waitForSelector(".choice[data-v=solo]", { timeout: 20000 });

// wake gesture so Chrome exposes the pad
await cmd("press a");
await page.waitForTimeout(600);
const padsSeen = await page.evaluate(() => Array.from(navigator.getGamepads() || []).filter(Boolean).map((p) => `${p.index}:${p.id.slice(0, 28)}|${p.mapping}`));
console.log("chrome sees:", JSON.stringify(padsSeen));

const focusedNow = () => page.evaluate(() => {
  const f = document.querySelector("#menu .focus");
  return f ? (f.dataset.v ?? f.dataset.d ?? f.textContent.trim().slice(0, 24)) : "(none)";
});
const dpad = async (dir) => { // left-stick flicks (raw-mapped pad: hat is axes 6/7)
  const [axis, v] = { down: ["ly", 1], up: ["ly", -1], left: ["lx", -1], right: ["lx", 1] }[dir];
  await cmd(`axis ${axis} ${v}`); await page.waitForTimeout(420);
  await cmd(`axis ${axis} 0`); await page.waitForTimeout(420);
};
const A = async () => { await cmd("hold a"); await page.waitForTimeout(420); await cmd("release a"); await page.waitForTimeout(500); };

const path = [];
for (let i = 0; i < 18; i++) {
  if (await page.evaluate(() => !!window.__IV?.game)) break;
  let focused = await focusedNow();
  if (focused === "(none)") { await dpad("down"); path.push("[reveal]"); continue; }
  if (/Back/i.test(focused)) {
    await dpad("right");
    if ((await focusedNow()) === focused) await dpad("down");
    focused = await focusedNow();
    if (/Back/i.test(focused)) { path.push("STUCK-ON-BACK"); break; }
    path.push(`[skip-back->${focused}]`); continue;
  }
  path.push(focused);
  await A();
}
const launched = await page.evaluate(() => !!window.__IV?.game);
if (!launched) {
  console.log(JSON.stringify({ path, errors }, null, 1));
  console.log("REAL CHROME CONFIRM: FAILED — pad never reached the arena");
  await browser.close(); pad.stdin.write("quit\n"); process.exit(1);
}
console.log("arena reached via pad:", JSON.stringify(path));
await page.waitForFunction(() => window.__IV.game.startFreeze <= 0, null, { timeout: 90000 });

await cmd("axis ly -1"); // full throttle
await page.waitForTimeout(1500);
const throttle = await page.evaluate(() => window.__IV.game.players[0]?.tank?.input?.throttle ?? null);
await cmd("hold start"); // raw button index 7 = bindings.fire
await page.waitForTimeout(1500);
const fire = await page.evaluate(() => window.__IV.game.players[0]?.tank?.input?.fire ?? null);
const speed = await page.evaluate(() => Math.round((window.__IV.game.players[0]?.tank?.speed ?? 0) * 10) / 10);
await cmd("axis ly 0"); await cmd("release start");

console.log(JSON.stringify({ throttle, fire, speed, errors: errors.slice(0, 5) }));
const ok = throttle > 0.5 && fire === true && errors.length === 0;
console.log(ok ? "REAL CHROME CONFIRM: PASSED" : "REAL CHROME CONFIRM: FAILED");
await browser.close();
try { pad.stdin.write("quit\n"); } catch {}
process.exit(ok ? 0 : 1);
