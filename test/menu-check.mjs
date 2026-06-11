// Verifies the menu fixes: (1) tall panels stay within the viewport and
// scroll to their action buttons instead of clipping off-screen, and (2) the
// gamepad selection ring actually renders on choices AND buttons.
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
// Deliberately short viewport to force the tall Options screen to overflow.
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const fail = (msg) => { console.error("FAIL:", msg); failed = true; };
let failed = false;

await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector("#menu .panel", { timeout: 15000 });

// Drive to the tallest screen.
await page.click('.choice[data-v="options"]');
await page.waitForSelector('[data-back]', { timeout: 5000 });

const m = await page.evaluate(() => {
  const panel = document.querySelector("#menu .panel");
  const vh = window.innerHeight;
  const pr = panel.getBoundingClientRect();
  // Scroll to the bottom action button and confirm it's reachable & visible.
  const done = panel.querySelector("[data-back]");
  done.scrollIntoView({ block: "nearest" });
  const dr = done.getBoundingClientRect();
  return {
    vh,
    panelBottom: pr.bottom,
    panelTop: pr.top,
    panelScrollable: panel.scrollHeight > panel.clientHeight + 1,
    doneInView: dr.top >= 0 && dr.bottom <= vh + 0.5,
  };
});
if (m.panelTop < -0.5 || m.panelBottom > m.vh + 0.5) fail(`panel exceeds viewport (top=${m.panelTop.toFixed(1)} bottom=${m.panelBottom.toFixed(1)} vh=${m.vh})`);
if (!m.panelScrollable) fail("tall Options panel is not internally scrollable");
if (!m.doneInView) fail("Back/Done button not reachable within viewport");

// Focus ring renders on a choice and on a button.
const ring = await page.evaluate(() => {
  const out = {};
  for (const sel of [".choice", ".btn"]) {
    const el = document.querySelector(`#menu ${sel}`);
    el.classList.add("focus");
    const cs = getComputedStyle(el);
    out[sel] = { width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle };
    el.classList.remove("focus");
  }
  return out;
});
if (!(ring[".choice"].width >= 2 && ring[".choice"].style !== "none")) fail(`choice focus ring missing: ${JSON.stringify(ring[".choice"])}`);
if (!(ring[".btn"].width >= 2 && ring[".btn"].style !== "none")) fail(`button focus ring missing: ${JSON.stringify(ring[".btn"])}`);

if (errors.length) fail(`console/page errors: ${errors.join(" | ")}`);

await browser.close();
server.kill();
console.log(failed ? "MENU CHECK: FAILED" : "MENU CHECK: PASSED", JSON.stringify(m), JSON.stringify(ring));
process.exit(failed ? 1 : 0);
