// Smoke-test the deployed GitHub Pages build.
import { chromium } from "playwright";

const URL = "https://jiujitsumagician.github.io/iron-volley/";
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${URL}?test&map=neon&bots=3`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__IV, null, { timeout: 30000 });
await page.waitForTimeout(5000);
const ok = await page.evaluate(() => ({
  tanks: window.__IV.tanks.length,
  rendering: !!document.querySelector("canvas"),
}));
await page.screenshot({ path: "test/shots/live-pages.png" });
console.log("live build:", JSON.stringify(ok), "errors:", errors.length);
await browser.close();
process.exit(ok.tanks > 0 && errors.length === 0 ? 0 : 1);
