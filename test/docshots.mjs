// Refresh the README images in docs/ on a REAL GPU.
//
// test/screenshot.mjs is a correctness harness and runs under SwiftShader,
// which is fine for "did it render without errors" but undersells the game
// badly — no usable MSAA, and it rasterizes the sky IBL and fitted shadows on
// the CPU. The shop-window images get captured through ANGLE/D3D11 instead.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const PORT = 8143;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));
await mkdir("docs", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120_000);

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const targets = [
  { name: "hero", q: "test&auto&map=dunes&bots=5&diff=1.35", wait: 14000 },
  { name: "neon", q: "test&auto&map=neon&bots=5&diff=1.35", wait: 15000 },
  { name: "cinder", q: "test&auto&map=cinder&bots=5&diff=1.35", wait: 15000 },
  { name: "splitscreen", q: "test&map=verdant&players=2&bots=2", wait: 5000 },
];

for (const t of targets) {
  await page.goto(`${BASE}/?${t.q}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__IV, null, { timeout: 60_000 });
  await page.waitForTimeout(t.wait);
  await page.screenshot({ path: `docs/${t.name}.png` });
  console.log(`docs/${t.name}.png`);
}

await browser.close();
server.kill();

if (errors.length) {
  console.error("\nERRORS:");
  for (const e of [...new Set(errors)].slice(0, 20)) console.error(" -", e);
  process.exit(1);
}
console.log("docs images refreshed on real GPU — zero console errors.");
