// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

import * as THREE from "three";
import { Game } from "./game.js";
import { Menu } from "./menu.js";
import { TitleScene } from "./title.js";
import { audio } from "./audio.js";
import { GamepadManager } from "./gamepad.js";

// ── renderer ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById("app").appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  title?.resize(window.innerWidth, window.innerHeight);
});

audio.init?.();
// restore saved volumes
try {
  const vols = JSON.parse(localStorage.getItem("iv.audio") ?? "null");
  if (vols) {
    audio.setVolume?.(vols.master / 100);
    audio.setMusicVolume?.(vols.music / 100);
  }
} catch { /* defaults */ }

const gamepads = new GamepadManager();

// Menu gamepad-detection pip: tells you at a glance whether the controller is
// actually recognized (so "nothing happens" is diagnosable — detected means a
// button-mapping issue → rebind in Options; not detected means a connection /
// controller-mode issue, e.g. a generic pad in DInput vs XInput).
const padPip = document.createElement("div");
padPip.style.cssText =
  "position:fixed;left:14px;top:12px;z-index:60;font:12px/1 system-ui,sans-serif;" +
  "padding:6px 12px;border-radius:999px;background:rgba(8,16,12,.78);" +
  "border:1px solid #2f5a42;color:#86f0b0;letter-spacing:.06em;pointer-events:none;display:none;";
padPip.textContent = "🎮 Gamepad connected";
document.body.appendChild(padPip);

// ── state machine ────────────────────────────────────────────
let game = null;
let title = null;
const menuEl = document.getElementById("menu");
const endEl = document.getElementById("endscreen");
const fade = document.getElementById("fade");

const menu = new Menu(menuEl, launchMatch, gamepads);
// Test hook (mirrors window.__IV for the game) so the menu harness can drive
// focus navigation deterministically without faking frame-timed pad edges.
if (typeof window !== "undefined") window.__MENU = menu;

function launchMatch(config) {
  fadeOut(() => {
    endEl.style.display = "none";
    title?.dispose(); title = null; // free the diorama before the match builds
    game?.dispose();
    game = new Game(renderer, config, (result) => showEndScreen(result, config), gamepads);
    fadeIn();
  });
}

function showEndScreen(result, config) {
  game?.dispose();
  game = null;
  endEl.style.display = "flex";
  endEl.innerHTML = `
    <div class="panel">
      <div class="endtitle">${result.winnerIsPlayer ? "VICTORY" : "DEFEAT"}</div>
      <div class="endsub">${result.winner} takes the field</div>
      <table class="scores">
        <tr><th>Commander</th><th>Tank</th><th>Kills</th><th>Deaths</th></tr>
        ${result.standings.map((s) => `
          <tr class="${s.isPlayer ? "me" : ""}">
            <td>${s.name}</td><td>${s.chassis}</td><td>${s.kills}</td><td>${s.deaths}</td>
          </tr>`).join("")}
      </table>
      <div class="row-actions">
        <button class="btn" data-again>RE-DEPLOY</button>
        <button class="btn ghost" data-menu>MAIN MENU</button>
      </div>
    </div>
  `;
  endEl.querySelector("[data-again]").onclick = () => { audio.uiSelect?.({}); launchMatch(config); };
  endEl.querySelector("[data-menu]").onclick = () => {
    audio.uiSelect?.({});
    endEl.style.display = "none";
    menu.show();
  };
}

function fadeOut(then) {
  fade.style.opacity = 1;
  setTimeout(then, 420);
}
function fadeIn() {
  setTimeout(() => (fade.style.opacity = 0), 60);
}

// ── pause ────────────────────────────────────────────────────
let paused = false;
const pauseEl = document.createElement("div");
pauseEl.className = "layer interactive";
pauseEl.style.cssText = "display:none; z-index:25; align-items:center; justify-content:center; background:rgba(4,6,9,.7); backdrop-filter:blur(3px);";
pauseEl.innerHTML = `
  <div class="panel" style="width:auto; padding:34px 60px;">
    <div class="logo" style="font-size:40px;">Paused</div>
    <div class="row-actions">
      <button class="btn" data-resume>RESUME</button>
      <button class="btn ghost" data-quit>ABANDON MATCH</button>
    </div>
  </div>`;
document.body.appendChild(pauseEl);
pauseEl.querySelector("[data-resume]").onclick = () => setPaused(false);
pauseEl.querySelector("[data-quit]").onclick = () => {
  setPaused(false);
  game?.dispose();
  game = null;
  menu.show();
};
function setPaused(v) {
  paused = v && !!game;
  pauseEl.style.display = paused ? "flex" : "none";
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && game) setPaused(!paused);
});

// ── loop ─────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  gamepads.update();
  // pads drive the menus + end screen + pause overlay
  const nav = gamepads.menuInput();
  if (menuEl.style.display !== "none" && menuEl.style.display !== "") {
    menu.handlePad(nav);
  } else if (paused) {
    if (nav.confirm || nav.start) setPaused(false);
    else if (nav.back) pauseEl.querySelector("[data-quit]").click();
  } else if (endEl.style.display === "flex") {
    if (nav.confirm) endEl.querySelector("[data-again]")?.click();
    else if (nav.back) endEl.querySelector("[data-menu]")?.click();
  } else if (game && (gamepads.read(0).pauseEdge || gamepads.read(1).pauseEdge)) {
    setPaused(!paused);
  }

  const menuVisible = menuEl.style.display !== "none" && menuEl.style.display !== "";
  padPip.style.display = (menuVisible && gamepads.anyPadConnected()) ? "block" : "none";

  if (game && !paused) {
    // __TEST_MANUAL lets the headless playtest step the simulation
    // deterministically (decoupled from SwiftShader frame rate)
    if (!window.__TEST_MANUAL) game.update(dt);
    game.render(dt);
  } else if (!game && menuVisible) {
    // live battle diorama behind the menu
    try {
      if (!title) { title = new TitleScene(renderer); title.resize(window.innerWidth, window.innerHeight); }
      title.update(dt);
      title.render();
    } catch (e) { console.warn("title scene:", e); title?.dispose?.(); title = null; }
  } else if (title) {
    title.dispose();
    title = null;
  }
}
requestAnimationFrame(frame);

// ── boot: URL params let tests jump straight into a match ────
const qp = new URLSearchParams(location.search);
if (qp.has("test")) {
  // ?test&map=dunes&bots=3&players=1&chassis=viper&diff=1
  const players = qp.get("players") === "2"
    ? [{ chassisId: qp.get("chassis") ?? "viper", name: "P1" }, { chassisId: "bastion", name: "P2" }]
    : [{ chassisId: qp.get("chassis") ?? "viper", name: "YOU" }];
  audio.setEnabled?.(false);
  menuEl.style.display = "none"; // test boot skips the menu flow entirely
  launchMatch({
    mapId: qp.get("map") ?? "dunes",
    mode: players.length === 2 ? "versus" : "solo",
    players,
    botCount: parseInt(qp.get("bots") ?? "3", 10),
    difficulty: parseFloat(qp.get("diff") ?? "1"),
    killTarget: parseInt(qp.get("kills") ?? "10", 10),
    autoPilot: qp.has("auto"),
  });
} else {
  menu.show();
}

// ── gamepad diagnostic overlay (?paddebug) ───────────────────
// Reads navigator.getGamepads() RAW (bypassing our manager) so we can see
// exactly what a controller reports — which axes move with each stick and
// which index each button is — to support non-standard mappings.
if (qp.has("paddebug")) {
  const dbg = document.createElement("div");
  dbg.style.cssText =
    "position:fixed;left:10px;top:10px;z-index:99999;background:rgba(4,8,6,.86);" +
    "color:#8fe;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px 12px;" +
    "border:1px solid #2a4a3a;border-radius:8px;max-width:560px;white-space:pre-wrap;pointer-events:none;";
  document.body.appendChild(dbg);
  setInterval(() => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    let any = false;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      any = true;
      const ax = Array.from(p.axes).map((a, k) => `${k}:${a.toFixed(2)}`).join("  ");
      const pressed = p.buttons
        .map((b, k) => (b.pressed || b.value > 0.4 ? k : null))
        .filter((x) => x !== null).join(", ") || "none";
      out.push(
        `#${i} ${p.id}\n  mapping: ${p.mapping || "(NON-STANDARD)"}\n` +
        `  axes(${p.axes.length}): ${ax}\n  buttons(${p.buttons.length}) pressed: [${pressed}]`
      );
    }
    dbg.textContent =
      "GAMEPAD DEBUG — move a stick / press each button and note the numbers\n\n" +
      (any ? out.join("\n\n") : "No gamepad seen yet — press a button on the controller.");
  }, 100);
}
