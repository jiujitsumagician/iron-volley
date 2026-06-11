// Verifies shot terrain damage is amplified: a deform(depth=3) should carve a
// crater whose centre drops ~4x the requested depth (the +300% scale), bounded
// by the existing offset clamp.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8145;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/?test&map=dunes&bots=0&players=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!(window.__IV?.game?.world?.deform), null, { timeout: 30000 });

const res = await page.evaluate(() => {
  const w = window.__IV.game.world;
  // A flat-ish probe point near a spawn; measure before/after a single deform.
  const x = 40, z = -40, reqDepth = 3;
  const before = w.heightAt(x, z);
  w.deform(x, z, 12, reqDepth);
  const after = w.heightAt(x, z);
  return { drop: before - after, reqDepth };
});

let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };
// Un-scaled, a depth-3 deform drops the centre ~3 units. With the +300% scale
// it should drop ~12 (4x). Assert clearly past the old behaviour.
if (res.drop < 9) fail(`crater not amplified — centre dropped only ${res.drop.toFixed(2)} (expected ~${res.reqDepth * 4})`);
if (errors.length) fail(`console/page errors: ${errors.join(" | ")}`);

await browser.close();
server.kill();
console.log(failed ? "TERRAIN DAMAGE: FAILED" : "TERRAIN DAMAGE: PASSED", JSON.stringify(res));
process.exit(failed ? 1 : 0);
