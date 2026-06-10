// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

import * as THREE from "three";
import { Game } from "./game.js";
import { Menu } from "./menu.js";
import { audio } from "./audio.js";

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
});

audio.init?.();

// ── state machine ────────────────────────────────────────────
let game = null;
const menuEl = document.getElementById("menu");
const endEl = document.getElementById("endscreen");
const fade = document.getElementById("fade");

const menu = new Menu(menuEl, launchMatch);

function launchMatch(config) {
  fadeOut(() => {
    endEl.style.display = "none";
    game?.dispose();
    game = new Game(renderer, config, (result) => showEndScreen(result, config));
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

// ── loop ─────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    game.update(dt);
    game.render(dt);
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
