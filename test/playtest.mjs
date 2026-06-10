// Headless functional playtest: an all-bot match runs at speed while
// we assert the core loop actually happens — shells fly, tanks die,
// crates get taken, specials fire, the match ends — with zero errors.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8141;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

// ── soak: every map briefly boots + simulates ─────────────────
for (const map of ["dunes", "frost", "verdant", "cinder", "neon"]) {
  await page.goto(`${BASE}/?test&auto&map=${map}&bots=5&kills=50`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });
  await page.waitForTimeout(12000);
  const stats = await page.evaluate(() => {
    const g = window.__IV;
    return g ? {
      tanks: g.tanks.length,
      shotsFired: g.weapons.shotsFired,
      anyDamage: g.tanks.some((t) => t.hp < t.maxHp || t.deaths > 0),
      crates: g.pickups.crates.length,
    } : null;
  });
  check(`[${map}] boots with 6 tanks`, stats?.tanks === 6, JSON.stringify(stats));
  check(`[${map}] shells are flying`, (stats?.shotsFired ?? 0) > 0, JSON.stringify(stats));
  check(`[${map}] crates exist`, (stats?.crates ?? 0) > 0);
}

// ── long soak on one map: kills + pickups + specials + match end ──
await page.goto(`${BASE}/?test&auto&map=verdant&bots=7&kills=3&diff=1.35`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });
page.setDefaultTimeout(200_000);
const soak = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = window.__IV;
  let pickupsTaken = 0, specialsFired = 0, sawSpecialShell = false;
  const start = performance.now();
  let ended = false;
  const origEnd = g.game.onMatchEnd;
  g.game.onMatchEnd = (res) => { ended = true; origEnd(res); };

  while (performance.now() - start < 150_000 && !ended) {
    await sleep(500);
    for (const t of g.tanks) if (t.special) pickupsTaken++;
    for (const s of g.weapons.shells) if (s.type !== "standard") sawSpecialShell = true;
    if (g.weapons.firePools.length || g.weapons.gravityWells.length) specialsFired++;
    // after 45s of organic war, collapse the finish line so the
    // end-of-match flow itself is what we verify (not bot lethality)
    if (performance.now() - start > 45_000 && g.game.killTarget !== 1) {
      g.game.killTarget = 1;
      g.game.updateScorePill();
    }
  }
  return {
    ended,
    elapsed: ((performance.now() - start) / 1000) | 0,
    totalKills: g.tanks.reduce((a, t) => a + t.kills, 0),
    totalDeaths: g.tanks.reduce((a, t) => a + t.deaths, 0),
    pickupsSeen: pickupsTaken > 0,
    sawSpecialShell,
    specialsFired: specialsFired > 0,
  };
});
check("long soak: kills happened", soak.totalKills >= 1, JSON.stringify(soak));
check("long soak: respawns happened (deaths tracked)", soak.totalDeaths >= 1, JSON.stringify(soak));
check("long soak: bots collected special rounds", soak.pickupsSeen, JSON.stringify(soak));
check("long soak: special shells were fired", soak.sawSpecialShell || soak.specialsFired, JSON.stringify(soak));
check("long soak: match reached its end screen", soak.ended, JSON.stringify(soak));

// end screen visible?
const endVisible = await page.evaluate(
  () => document.getElementById("endscreen").style.display === "flex"
);
check("end screen shown", endVisible);

await browser.close();
server.kill();

if (errors.length) {
  console.error("\nERRORS CAPTURED:");
  for (const e of [...new Set(errors)].slice(0, 20)) console.error(" -", e);
}
console.log(failures === 0 && errors.length === 0 ? "\nALL PLAYTEST CHECKS PASSED" : `\n${failures} failed, ${errors.length} page errors`);
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
