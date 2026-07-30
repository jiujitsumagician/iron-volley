// Drives test/gallery.html on a REAL GPU (ANGLE/D3D11, not SwiftShader) and
// saves tank inspection sheets to test/shots/. Wave 3 established that the
// SwiftShader harness misrepresents material/AA quality, so tank visuals get
// judged here instead.
//
//   node test/gallery.mjs            -> gallery-<map>.png contact sheets
//   node test/gallery.mjs bastion    -> plus a large single-chassis shot
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const PORT = 8141;
const BASE = `http://localhost:${PORT}`;
const tag = process.argv[2] || "";

const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 900));
await mkdir("test/shots", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.setDefaultTimeout(120_000);

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const shots = tag
  ? [
      { name: `gallery-one-${tag}`, q: `one=${tag}&map=dunes` },
      { name: `gallery-one-${tag}-front`, q: `one=${tag}&map=dunes&spin=3.14159` },
      { name: `gallery-one-${tag}-side`, q: `one=${tag}&map=dunes&spin=1.5708` },
    ]
  : [
      { name: "gallery-dunes", q: "map=dunes" },
      { name: "gallery-neon", q: "map=neon" },
      { name: "gallery-camo", q: "map=verdant&skin=woodland" },
    ];

for (const s of shots) {
  await page.goto(`${BASE}/test/gallery.html?${s.q}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__GALLERY_READY === true, null, { timeout: 90_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test/shots/${s.name}.png` });
  console.log(`shot: ${s.name}.png`);
  const stats = await page.evaluate(() => window.__GALLERY_STATS || []);
  if (stats.length) {
    const m = stats.reduce((a, s2) => a + s2.meshes, 0) / stats.length;
    const t = stats.reduce((a, s2) => a + s2.tris, 0) / stats.length;
    console.log(`      per tank: ${m.toFixed(1)} meshes, ${Math.round(t)} tris avg` +
      `  (max ${Math.max(...stats.map((s2) => s2.meshes))} meshes / ${Math.max(...stats.map((s2) => s2.tris))} tris)`);
  }
}

await browser.close();
server.kill();

if (errors.length) {
  console.error("\nERRORS:");
  for (const e of [...new Set(errors)].slice(0, 20)) console.error(" -", e);
  process.exit(1);
}
console.log("gallery clean — zero console errors.");
