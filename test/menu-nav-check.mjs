// Verifies spatial menu navigation: on a horizontal row of choices, Right
// moves to the next card in the row, and Down drops to the row below (the
// action button) — NOT the next card in DOM reading order.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8144;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__MENU, null, { timeout: 15000 });
// Title → SOLO → tank select (a horizontal row of tank cards + a Back button).
await page.click('.choice[data-v="solo"]');
await page.waitForSelector('[data-back]', { timeout: 5000 });

let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

const probe = await page.evaluate(() => {
  const M = window.__MENU;
  const F = M.focusables;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // Find two tank cards on the same row (same y, different x) and the Back button below them.
  const cards = F.map((el, i) => ({ i, el, ...rect(el), back: el.matches("[data-back]") }));
  const row0 = cards.filter((c) => !c.back);
  const start = row0[0];

  // Right from the first card → a card further right on (roughly) the same row.
  M.focusIdx = start.i;
  M.moveFocus("right");
  const afterRight = M.focusIdx;
  const rightCard = cards.find((c) => c.i === afterRight);

  // Down from the first card → should NOT be the adjacent card in the same row;
  // it should land on something below (greater y), e.g. the Back button.
  M.focusIdx = start.i;
  M.moveFocus("down");
  const afterDown = M.focusIdx;
  const downCard = cards.find((c) => c.i === afterDown);

  return {
    startY: start.y, startX: start.x,
    rightMovedRight: rightCard && rightCard.x > start.x + 5 && Math.abs(rightCard.y - start.y) < 30,
    downWentBelow: downCard && downCard.y > start.y + 20,
    downIsNotSameRowCard: !(downCard && Math.abs(downCard.y - start.y) < 30 && downCard.x > start.x),
    cardCount: row0.length,
  };
});

if (probe.cardCount < 2) fail(`expected a multi-card row to test (got ${probe.cardCount})`);
if (!probe.rightMovedRight) fail("Right did not move to a card further right on the same row");
if (!probe.downWentBelow) fail("Down did not drop to a lower row");
if (!probe.downIsNotSameRowCard) fail("Down moved sideways within the row (reading-order bug)");
if (errors.length) fail(`console/page errors: ${errors.join(" | ")}`);

await browser.close();
server.kill();
console.log(failed ? "MENU NAV: FAILED" : "MENU NAV: PASSED", JSON.stringify(probe));
process.exit(failed ? 1 : 0);
