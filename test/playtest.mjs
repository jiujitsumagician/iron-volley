// Headless functional playtest: all-bot matches stepped DETERMINISTICALLY
// (window.__TEST_MANUAL decouples simulation from SwiftShader's frame
// rate). Asserts the core loop end-to-end: shells fly, tanks die,
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
page.setDefaultTimeout(240_000);

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

/** Step `seconds` of game time at 30Hz, yielding to the event loop. */
const stepSim = (seconds) => page.evaluate(async (secs) => {
  window.__TEST_MANUAL = true;
  const g = window.__IV;
  const steps = Math.round(secs * 30);
  for (let i = 0; i < steps; i++) {
    g.game.update(1 / 30);
    if (i % 240 === 239) await new Promise((r) => setTimeout(r, 0));
  }
}, seconds);

// ── every map: 25 simulated seconds of war ────────────────────
for (const map of ["dunes", "frost", "verdant", "cinder", "neon"]) {
  await page.goto(`${BASE}/?test&auto&map=${map}&bots=5&kills=50`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });
  await stepSim(25);
  const stats = await page.evaluate(() => {
    const g = window.__IV;
    return {
      tanks: g.tanks.length,
      shotsFired: g.weapons.shotsFired,
      anyDamage: g.tanks.some((t) => t.hp < t.maxHp || t.deaths > 0),
      crates: g.pickups.crates.length,
    };
  });
  check(`[${map}] boots with 6 tanks`, stats.tanks === 6, JSON.stringify(stats));
  check(`[${map}] shells are flying`, stats.shotsFired > 0, JSON.stringify(stats));
  check(`[${map}] combat connects`, stats.anyDamage, JSON.stringify(stats));
  check(`[${map}] crates exist`, stats.crates > 0);
}

// ── long soak: 4 minutes of simulated war on one map ──────────
await page.goto(`${BASE}/?test&auto&map=verdant&bots=7&kills=3&diff=1.35`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__IV, null, { timeout: 15000 });

const soak = await page.evaluate(async () => {
  window.__TEST_MANUAL = true;
  const g = window.__IV;
  let ended = false;
  const origEnd = g.game.onMatchEnd;
  g.game.onMatchEnd = (res) => { ended = true; origEnd(res); };

  let pickupsSeen = false, sawSpecialShell = false, specialsFired = false;
  let simSeconds = 0;
  while (simSeconds < 240 && !ended) {
    for (let i = 0; i < 30 && !ended; i++) g.game.update(1 / 30);
    simSeconds += 1;
    for (const t of g.tanks) if (t.special) pickupsSeen = true;
    for (const s of g.weapons.shells) if (s.type !== "standard") sawSpecialShell = true;
    if (g.weapons.firePools.length || g.weapons.gravityWells.length) specialsFired = true;
    if (simSeconds % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  // the victory → end-screen handoff runs on a 1.7s wall-clock timer
  await new Promise((r) => setTimeout(r, 2600));
  return {
    ended,
    simSeconds,
    totalKills: g.tanks.reduce((a, t) => a + t.kills, 0),
    totalDeaths: g.tanks.reduce((a, t) => a + t.deaths, 0),
    pickupsSeen, sawSpecialShell, specialsFired,
  };
});
check("long soak: kills happened", soak.totalKills >= 3, JSON.stringify(soak));
check("long soak: respawns happened (deaths tracked)", soak.totalDeaths >= 3, JSON.stringify(soak));
check("long soak: bots collected special rounds", soak.pickupsSeen, JSON.stringify(soak));
check("long soak: special shells were fired", soak.sawSpecialShell || soak.specialsFired, JSON.stringify(soak));
check("long soak: a tank won (first to 3)", soak.ended, JSON.stringify(soak));

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
