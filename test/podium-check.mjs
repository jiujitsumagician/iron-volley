// Verifies the victory podium: builds behind the end screen with the top
// three winning tanks, the champion has champagne + a companion, confetti
// rains, and it renders without errors. Saves a screenshot to
// test/_podium.png. Run: node test/podium-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8188;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let failed = false;
const assert = (c, m) => { if (!c) { console.log("FAIL:", m); failed = true; } else console.log("ok:", m); };

try {
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__END === "function", null, { timeout: 30000 });

  // Render the victory screen directly with a synthetic top-3, hiding the
  // menu DOM (in a real finished match it's already gone) so the podium
  // canvas isn't covered.
  await page.evaluate(() => {
    const m = document.getElementById("menu"); if (m) m.style.display = "none";
    window.__END({
      winner: "YOU", winnerIsPlayer: true,
      standings: [
        { name: "YOU", chassis: "Viper", kills: 12, deaths: 2, isPlayer: true, chassisId: "viper", teamId: "crimson", skinId: null },
        { name: "DOZER", chassis: "Bastion", kills: 9, deaths: 4, isPlayer: false, chassisId: "bastion", teamId: "cobalt", skinId: null },
        { name: "ECHO", chassis: "Scout", kills: 7, deaths: 5, isPlayer: false, chassisId: "scout", teamId: "jade", skinId: null },
      ],
    });
  });

  await page.waitForFunction(() => window.__PODIUM && window.__PODIUM.winners?.length === 3, null, { timeout: 20000 });
  const info = await page.evaluate(() => {
    const p = window.__PODIUM;
    return {
      winners: p.winners.length,
      hasCompanion: !!p.companion,
      companionCannons: p._compBarrels?.length ?? 0,
      hasChampagne: !!p.bottleGrp,
      hasConfetti: !!p.confettiPts,
      sceneChildren: p.scene.children.length,
    };
  });
  assert(info.winners === 3, `three winners on the podium (${info.winners})`);
  assert(info.hasCompanion, "champion has a companion tank");
  assert(info.companionCannons === 2, `companion has two oversized cannons (${info.companionCannons})`);
  assert(info.hasChampagne, "champion has a champagne bottle");
  assert(info.hasConfetti, "confetti is present");
  assert(info.sceneChildren > 10, `scene is populated (${info.sceneChildren} objects)`);

  // Let the loop render + animate a few frames, then screenshot.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test/_podium.png" });
  console.log("ok: screenshot saved to test/_podium.png");

  assert(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  console.log("EXCEPTION:", e.message);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? "\nPODIUM CHECK: FAILED" : "\nPODIUM CHECK: PASSED");
process.exit(failed ? 1 : 0);
