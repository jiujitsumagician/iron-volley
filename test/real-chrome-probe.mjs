// What does REAL Chrome enumerate as gamepads on this machine?
// Spawns clones of the ASRock LED controller + 8BitDo 2C, presses a button on
// the 8BitDo clone (the "wake" gesture), and dumps navigator.getGamepads().
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const HEADFUL = process.env.DISPLAY_MODE === "x11";
const pads = {};
const mk = (kind) => {
  const p = spawn("python3", ["/tmp/vpad2.py", kind], { stdio: ["pipe", "pipe", "inherit"] });
  pads[kind] = p;
  return new Promise((res) => p.stdout.once("data", (d) => { console.log(String(d).trim()); res(p); }));
};
await mk("asrock");
await mk("u2c");
await new Promise((r) => setTimeout(r, 1500)); // let udev settle

const cmd = (kind, line) => new Promise((res) => {
  pads[kind].stdout.once("data", () => res());
  pads[kind].stdin.write(line + "\n");
});

const browser = await chromium.launch({
  channel: "chrome",
  headless: !HEADFUL,
  env: HEADFUL ? { ...process.env, DISPLAY: ":0" } : process.env,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.goto("https://jiujitsumagician.github.io/iron-volley/", { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(1000);

const dump = () => page.evaluate(() =>
  Array.from(navigator.getGamepads() || []).map((p, i) => p && ({
    i, id: p.id, mapping: p.mapping, connected: p.connected,
    axes: p.axes.map((a) => Math.round(a * 100) / 100), buttons: p.buttons.length,
  }))
);

console.log("before wake:", JSON.stringify(await dump()));
await cmd("u2c", "press a");
await page.waitForTimeout(800);
console.log("after 8bitdo press:", JSON.stringify(await dump(), null, 1));
// also wiggle the ASRock to see if Chrome shows it then
await cmd("asrock", "press start");
await page.waitForTimeout(800);
console.log("after asrock press:", JSON.stringify(await dump(), null, 1));

await browser.close();
for (const k of Object.keys(pads)) { try { pads[k].stdin.write("quit\n"); } catch {} }
