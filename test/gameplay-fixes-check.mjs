// Verifies the 2026-08-14 gameplay fixes:
//  1. soft props (trees/cacti) get CRUSHED by a driving tank; hard props
//     (rocks) still block
//  2. the MG aims at the cannon's ballistic landing point, not skyward
//     along the raw barrel elevation
// Run: node test/gameplay-fixes-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8144;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

await page.goto(`${BASE}/?test&auto&map=dunes&bots=1`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });

// ── 1. tanks crush cacti, rocks still block ───────────────────
const crush = await page.evaluate(() => {
  window.__TEST_MANUAL = true;
  const g = window.__IV.game;
  const w = g.world;
  const t = w.tanks[0];
  const drive = (target) => {
    // park just short (approaching from -z), aim, floor it
    // (tank.update reads t.input directly)
    t.pos.set(target.x, 0, target.z - 6);
    t.pos.y = w.heightAt(t.pos.x, t.pos.z);
    t.yaw = Math.atan2(target.x - t.pos.x, target.z - t.pos.z); // faces +z
    t.speed = 0;
    for (let i = 0; i < 300; i++) {
      t.input.throttle = 1; t.input.steer = 0;
      t.update(1 / 30, w);
    }
  };
  const cactus = w.obstacles.find((o) => o.kind === "cactus");
  const rock = w.obstacles.find((o) => o.kind === "rock");
  let cactusCrushed = false, cactusPassed = false;
  if (cactus) {
    drive(cactus);
    cactusCrushed = !w.obstacles.includes(cactus);
    cactusPassed = Math.hypot(t.pos.x - cactus.x, t.pos.z - cactus.z) > cactus.r + 5;
  }
  let rockBlocks = false;
  if (rock) {
    drive(rock);
    rockBlocks = w.obstacles.includes(rock) &&
      Math.hypot(t.pos.x - rock.x, t.pos.z - rock.z) >= rock.r + 4.0;
  }
  return { hadCactus: !!cactus, hadRock: !!rock, cactusCrushed, cactusPassed, rockBlocks };
});
check("map has a cactus + a rock to test with", crush.hadCactus && crush.hadRock, JSON.stringify(crush));
check("driving through a cactus crushes it", crush.cactusCrushed);
check("tank keeps rolling past the crushed cactus", crush.cactusPassed);
check("rocks still block the tank", crush.rockBlocks, JSON.stringify(crush));

// ── 2. MG aims at the cannon's landing point ──────────────────
const mg = await page.evaluate(async () => {
  const { cannonImpactPoint } = await import("./src/weapons.js");
  const THREE = await import("three");
  const g = window.__IV.game;
  const t = g.world.tanks[0];
  t.barrelPitch = 1.05; // full lob — the old MG would fire into the sky
  t.poseMesh(g.world, 0);
  const out = new THREE.Vector3();
  cannonImpactPoint(t, g.world, out);
  const from = t.mgMuzzleWorld(new THREE.Vector3());
  const dir = out.clone().sub(from).normalize();
  return {
    impactOnGround: Math.abs(out.y - g.world.heightAt(out.x, out.z)) < 2.5,
    downrange: Math.hypot(out.x - t.pos.x, out.z - t.pos.z),
    dirY: dir.y,
  };
});
check("cannon impact point lands on terrain", mg.impactOnGround, JSON.stringify(mg));
check("impact point is a real downrange target", mg.downrange > 20, JSON.stringify(mg));
check("MG fires level/down at it, not skyward", mg.dirY < 0.25, JSON.stringify(mg));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.kill();
console.log(failures ? "\nGAMEPLAY FIXES CHECK: FAILED" : "\nGAMEPLAY FIXES CHECK: PASSED");
process.exit(failures ? 1 : 0);
