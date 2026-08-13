// Verifies the phone touch controls: overlay renders, the drive stick
// produces throttle, the FIRE button fires, and none of it appears on a
// desktop (non-touch) boot. Driven with real pointer events on a mobile
// viewport. Run: node test/touch-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8155;
const BASE = `http://localhost:${PORT}`;
const MATCH = "test&map=dunes&bots=1&chassis=viper&kills=50";
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

let failed = false;
const assert = (c, m) => { if (!c) { console.log("FAIL:", m); failed = true; } else console.log("ok:", m); };
const errors = [];

try {
  // ── mobile: touch overlay should exist and drive input ──────────
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?touch&${MATCH}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__IV?.game, null, { timeout: 30000 });
  await page.waitForSelector(".tc-root", { timeout: 20000 });
  assert(!!(await page.$(".tc-fire")), "FIRE button rendered on phone");

  // Drive stick: press lower-left, drag straight up → throttle > 0.5.
  await page.evaluate(() => {
    const root = document.querySelector(".tc-root");
    root.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 800, bubbles: true }));
    root.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 700, bubbles: true }));
  });
  const tUp = await page.evaluate(() => window.__IV.game.touch.read().throttle);
  assert(tUp > 0.5, `drive up → throttle>0.5 (got ${tUp.toFixed(2)})`);

  // Steer: drag right → steer > 0.5.
  await page.evaluate(() => {
    document.querySelector(".tc-root").dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 180, clientY: 800, bubbles: true }));
  });
  const steer = await page.evaluate(() => window.__IV.game.touch.read().steer);
  assert(steer > 0.5, `drag right → steer>0.5 (got ${steer.toFixed(2)})`);

  // Release → axes zero.
  await page.evaluate(() => {
    document.querySelector(".tc-root").dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, clientX: 180, clientY: 800, bubbles: true }));
  });
  const rel = await page.evaluate(() => window.__IV.game.touch.read());
  assert(rel.throttle === 0 && rel.steer === 0, `release → axes 0 (got ${rel.throttle},${rel.steer})`);

  // Aim stick: right half, drag → turret + pitch respond.
  await page.evaluate(() => {
    const root = document.querySelector(".tc-root");
    root.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, clientX: 300, clientY: 500, bubbles: true }));
    root.dispatchEvent(new PointerEvent("pointermove", { pointerId: 3, clientX: 360, clientY: 440, bubbles: true }));
  });
  const aim = await page.evaluate(() => window.__IV.game.touch.read());
  assert(Math.abs(aim.turretTurn) > 0.3 && Math.abs(aim.pitch) > 0.3, `aim stick → turret+pitch (${aim.turretTurn.toFixed(2)},${aim.pitch.toFixed(2)})`);

  // FIRE button held → fire flag true, and the tank's cannon actually fires.
  const shotsBefore = await page.evaluate(() => window.__IV.weapons.shotsFired);
  await page.evaluate(() => {
    document.querySelector(".tc-fire").dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 2, clientX: 0, clientY: 0, bubbles: true }));
  });
  assert(await page.evaluate(() => window.__IV.game.touch.read().fire) === true, "FIRE held → fire=true");
  // Drive the sim deterministically past the 2.4s start-freeze (headless
  // render is far below realtime), fire held the whole time.
  const shotsAfter = await page.evaluate(() => {
    window.__TEST_MANUAL = true;
    const g = window.__IV.game;
    for (let i = 0; i < 150; i++) g.update(1 / 30); // 5 sim-seconds
    return window.__IV.weapons.shotsFired;
  });
  assert(shotsAfter > shotsBefore, `FIRE button actually fires the cannon (${shotsBefore}→${shotsAfter})`);

  assert(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  await ctx.close();

  // ── desktop: no touch overlay ───────────────────────────────────
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dpage = await dctx.newPage();
  await dpage.goto(`${BASE}/?${MATCH}`, { waitUntil: "load" });
  await dpage.waitForFunction(() => !!window.__IV?.game, null, { timeout: 30000 });
  await dpage.waitForTimeout(500);
  assert(await dpage.$(".tc-root") === null, "no touch overlay on desktop boot");
  await dctx.close();
} catch (e) {
  console.log("EXCEPTION:", e.message);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? "\nTOUCH CHECK: FAILED" : "\nTOUCH CHECK: PASSED");
process.exit(failed ? 1 : 0);
