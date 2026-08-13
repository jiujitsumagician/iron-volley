// Two real peers over the PeerJS cloud broker + WebRTC. Reproduces the
// reported deadlock and proves it's fixed: guest connects & sends its
// loadout, the HOST's "CHOOSE BATTLEFIELD" button un-hides (host can
// start), host deploys, and the GUEST launches into the match.
// Run: node test/net-check.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8177;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failed = false;
const assert = (c, m) => { if (!c) { console.log("FAIL:", m); failed = true; } else console.log("ok:", m); };

async function newGame() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 140)));
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__MENU, null, { timeout: 30000 });
  return page;
}

try {
  const host = await newGame();
  const guest = await newGame();

  // HOST → tank select → pick viper → hostLobby (registers a room code).
  await host.evaluate(() => {
    window.__MENU.state = { mode: "online-host", players: [] };
    window.__MENU.tankSelect(0);
  });
  await host.click('.choice[data-v="viper"]');
  await host.waitForFunction(() => {
    const t = document.querySelector("#codebox")?.textContent?.trim();
    return t && t.length === 5;
  }, null, { timeout: 30000 });
  const code = (await host.$eval("#codebox", (e) => e.textContent.trim()));
  assert(/^[A-Z2-9]{5}$/.test(code), `host room code registered (${code})`);

  // GUEST → join that code → tank select → pick scout → guestWait (sends loadout).
  await guest.evaluate(() => {
    window.__MENU.state = { mode: "online-guest", players: [] };
    window.__MENU.joinCode();
  });
  await guest.fill("#roomcode", code);
  await guest.click("[data-go]");
  await guest.waitForSelector('.choice[data-v="scout"]', { timeout: 30000 });
  await guest.click('.choice[data-v="scout"]');

  // THE FIX: the host's "CHOOSE BATTLEFIELD" button must un-hide once the
  // guest's loadout arrives — previously it stayed hidden forever.
  await host.waitForFunction(() => {
    const b = document.querySelector("[data-go]");
    return b && getComputedStyle(b).display !== "none";
  }, null, { timeout: 30000 });
  assert(true, "host CHOOSE BATTLEFIELD button un-hid (guest loadout received)");
  const readyTxt = await host.$eval("#loberr", (e) => e.textContent);
  assert(/READY/i.test(readyTxt), `host shows challenger READY ("${readyTxt.trim()}")`);

  // Host deploys → guest should receive config and launch into the match.
  await host.evaluate(() => {
    const m = window.__MENU;
    m.state.mapId = "dunes"; m.state.botCount = 0; m.state.difficulty = 1;
    m.launchConfirm();
  });
  await host.click("[data-go]"); // DEPLOY
  await host.waitForFunction(() => !!window.__IV?.game, null, { timeout: 30000 });
  assert(true, "host launched into the match");
  await guest.waitForFunction(() => !!window.__IV?.game, null, { timeout: 30000 });
  assert(true, "GUEST launched into the match (config delivered)");
} catch (e) {
  console.log("EXCEPTION:", e.message);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? "\nNET CHECK: FAILED" : "\nNET CHECK: PASSED");
process.exit(failed ? 1 : 0);
