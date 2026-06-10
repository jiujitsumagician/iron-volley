import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8143;
const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`http://localhost:${PORT}/?test&auto&map=verdant&bots=3&kills=50`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });
await page.waitForTimeout(7000);

const out = await page.evaluate(() => {
  const g = window.__IV;
  return g.game.bots.map((b) => {
    const t = b.tank;
    const enemy = b.brain.target;
    let solInfo = null;
    if (enemy) {
      const dx = enemy.pos.x - t.pos.x, dz = enemy.pos.z - t.pos.z;
      const want = Math.atan2(dx, dz);
      const abs = t.yaw + t.turretYaw;
      solInfo = {
        dist: Math.hypot(dx, dz) | 0,
        turretErr: +(((want - abs + Math.PI * 3) % (Math.PI * 2)) - Math.PI).toFixed(3),
        barrelPitch: +t.barrelPitch.toFixed(3),
      };
    }
    return {
      name: t.name, alive: t.alive, hp: t.hp,
      hasTarget: !!enemy, targetAlive: enemy?.alive,
      reload: +t.reloadLeft.toFixed(2),
      inputs: { thr: +t.input.throttle.toFixed(2), fire: t.input.fire, pitch: +t.input.pitch.toFixed(2), tt: +t.input.turretTurn.toFixed(2) },
      special: t.special?.type ?? null,
      ...solInfo,
    };
  }).concat([{ shotsFired: g.weapons.shotsFired, shellsLive: g.weapons.shells.length }]);
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.kill();
