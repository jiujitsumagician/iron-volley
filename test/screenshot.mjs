// Visual verification harness: boots the game headless into each map
// (and the menu), waits for the scene to settle, and saves PNGs to
// test/shots/. Console errors fail the run.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const PORT = 8139;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));

await mkdir("test/shots", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const targets = [
  { name: "menu", url: `${BASE}/`, wait: 1500 },
  { name: "dunes", url: `${BASE}/?test&map=dunes&bots=4`, wait: 4500 },
  { name: "frost", url: `${BASE}/?test&map=frost&bots=4`, wait: 4500 },
  { name: "verdant", url: `${BASE}/?test&map=verdant&bots=4`, wait: 4500 },
  { name: "cinder", url: `${BASE}/?test&map=cinder&bots=4`, wait: 4500 },
  { name: "neon", url: `${BASE}/?test&map=neon&bots=4`, wait: 4500 },
  { name: "splitscreen", url: `${BASE}/?test&map=verdant&players=2&bots=2`, wait: 4500 },
  // action frames: bots at war for a while, then capture
  { name: "action-dunes", url: `${BASE}/?test&auto&map=dunes&bots=5&diff=1.35`, wait: 16000 },
  { name: "action-cinder", url: `${BASE}/?test&auto&map=cinder&bots=5&diff=1.35`, wait: 18000 },
  { name: "action-neon", url: `${BASE}/?test&auto&map=neon&bots=5&diff=1.35`, wait: 20000 },
];

for (const t of targets) {
  await page.goto(t.url, { waitUntil: "load" });
  await page.waitForTimeout(t.wait);
  await page.screenshot({ path: `test/shots/${t.name}.png` });
  console.log(`shot: ${t.name}.png`);
}

// menu flow: tank select (thumbnails), map select, options
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.click('[data-v="solo"]');
await page.waitForTimeout(1400);
await page.screenshot({ path: "test/shots/menu-tanks.png" });
console.log("shot: menu-tanks.png");
await page.click('[data-v="viper"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: "test/shots/menu-skins.png" });
console.log("shot: menu-skins.png");
await page.click('[data-v="woodland"]');
await page.waitForTimeout(400);
await page.click('[data-v="3"]');
await page.waitForTimeout(3500);
await page.screenshot({ path: "test/shots/menu-maps.png" });
console.log("shot: menu-maps.png");
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.click('[data-v="options"]');
await page.waitForTimeout(500);
await page.screenshot({ path: "test/shots/menu-options.png" });
console.log("shot: menu-options.png");

await browser.close();
server.kill();

if (errors.length) {
  console.error("\nERRORS CAPTURED:");
  for (const e of [...new Set(errors)].slice(0, 20)) console.error(" -", e);
  process.exit(1);
}
console.log("\nAll screenshots captured with zero console errors.");
