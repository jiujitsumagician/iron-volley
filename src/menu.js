// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Menu flow: title → mode → tank select (per player) → map select →
 * launch config. DOM-driven, keyboard + mouse both work.
 */

import { CHASSIS } from "./tanks.js";
import { MAPS } from "./maps.js";
import { audio } from "./audio.js";
import { tankThumb, mapThumb } from "./thumbs.js";

export class Menu {
  constructor(rootEl, onLaunch, gamepads = null) {
    this.el = rootEl;
    this.onLaunch = onLaunch;
    this.gamepads = gamepads;
    this.state = {};
    this.focusables = [];
    this.focusIdx = -1;
  }

  show() {
    this.el.style.display = "flex";
    audio.musicStart?.("menu");
    this.title();
  }

  hide() {
    this.el.style.display = "none";
    audio.musicStop?.();
  }

  panel(html) {
    this.el.innerHTML = `<div class="panel">${html}</div>`;
    this.refreshFocusables();
  }

  bindChoices(onPick) {
    this.el.querySelectorAll(".choice").forEach((c) => {
      c.addEventListener("mouseenter", () => audio.uiMove?.({ gain: 0.3 }));
      c.addEventListener("click", () => {
        audio.uiSelect?.({});
        onPick(c.dataset.v, c);
      });
    });
  }

  // ── gamepad focus navigation ────────────────────────────────
  refreshFocusables() {
    this.focusables = [...this.el.querySelectorAll(".choice:not(.disabled):not([style*='pointer-events:none']), .btn, input[type=range]")];
    this.focusIdx = -1;
  }

  applyFocus() {
    this.focusables.forEach((f, i) => f.classList.toggle("focus", i === this.focusIdx));
    this.focusables[this.focusIdx]?.scrollIntoView?.({ block: "nearest" });
  }

  /** Called by the main loop with edge-triggered pad input. */
  handlePad(nav) {
    if (this.el.style.display === "none" || !this.focusables.length) return;
    if (nav.down || nav.right) {
      this.focusIdx = (this.focusIdx + 1) % this.focusables.length;
      audio.uiMove?.({ gain: 0.3 });
      this.applyFocus();
    } else if (nav.up || nav.left) {
      this.focusIdx = (this.focusIdx - 1 + this.focusables.length) % this.focusables.length;
      audio.uiMove?.({ gain: 0.3 });
      this.applyFocus();
    } else if (nav.confirm) {
      const f = this.focusables[Math.max(0, this.focusIdx)];
      if (f?.type === "range") {
        f.value = Number(f.value) + 10 > 100 ? 0 : Number(f.value) + 10;
        f.dispatchEvent(new Event("input"));
      } else f?.click();
    } else if (nav.back) {
      this.el.querySelector("[data-back]")?.click();
    }
  }

  // ── screens ─────────────────────────────────────────────────
  title() {
    this.panel(`
      <div class="logo">Iron Volley</div>
      <div class="tagline">Arc the shell. Erase the hill. Win the war.</div>
      <div class="menu-section">
        <div class="choices vstack">
          <div class="choice" data-v="solo">
            <div class="big">⚔ SOLO OPS</div>
            <div class="sub">You vs computer-controlled tanks</div>
          </div>
          <div class="choice" data-v="versus">
            <div class="big">⚔⚔ SPLIT-SCREEN VERSUS</div>
            <div class="sub">Two commanders — keyboard halves or gamepads</div>
          </div>
          <div class="choice" data-v="options">
            <div class="big">⚙ OPTIONS</div>
            <div class="sub">Controls · gamepad · audio</div>
          </div>
        </div>
      </div>
    `);
    this.bindChoices((v) => {
      if (v === "options") return this.options();
      this.state = { mode: v, players: [] };
      this.tankSelect(0);
    });
  }

  controls() {
    this.panel(`
      <div class="logo" style="font-size:42px;">Controls</div>
      <div class="tagline">keyboard &amp; gamepad</div>
      <div class="menu-section">
        <table class="ctrl">
          <tr><th></th><th>Player 1</th><th>Player 2</th></tr>
          <tr><td>Drive</td><td>W A S D</td><td>Arrow keys</td></tr>
          <tr><td>Turret</td><td>Q / E</td><td>, / .</td></tr>
          <tr><td>Barrel elevation</td><td>R / F</td><td>' / ;</td></tr>
          <tr><td>Fire cannon</td><td>Space</td><td>Enter</td></tr>
          <tr><td>Machine gun (hold)</td><td>Left Shift</td><td>/</td></tr>
          <tr><td>Camera (1st / 3rd)</td><td>C</td><td>P</td></tr>
          <tr><td>Pause</td><td>Esc</td><td>Esc</td></tr>
        </table>
      </div>
      <div class="menu-section">
        <div class="menu-title">Gamepad</div>
        <div class="sub" style="max-width:560px; margin:0 auto; line-height:1.7;">
          Left stick drives · right stick aims turret &amp; elevation · <b>RT</b> fires ·
          <b>LT</b> machine gun · <b>Y</b> toggles camera · <b>Start</b> pauses.
          Remap the buttons back in Options.
        </div>
      </div>
      <div class="row-actions"><button class="btn" data-back>← Back</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () => this.options();
  }

  // ── options: gamepad layout + audio ─────────────────────────
  options() {
    const gm = this.gamepads;
    const vols = JSON.parse(localStorage.getItem("iv.audio") ?? '{"master":80,"music":35}');
    const bindRow = (action, label) => `
      <div class="choice" data-rebind="${action}" style="min-width:170px;">
        <div class="big">${label}</div>
        <div class="sub rebind-val">${gm ? gm.buttonName(gm.bindings[action]) : "—"}</div>
        <div class="sub" style="color:#76879a;">press to rebind</div>
      </div>`;
    this.panel(`
      <div class="logo" style="font-size:42px;">Options</div>
      <div class="tagline">${gm?.anyPadConnected() ? "🎮 gamepad connected" : "no gamepad detected — settings still apply"}</div>
      <div class="menu-section">
        <div class="menu-title">Gamepad — sticks are fixed (left: drive · right: turret &amp; elevation)</div>
        <div class="choices">
          ${bindRow("fire", "FIRE CANNON")}
          ${bindRow("mg", "MACHINE GUN")}
          ${bindRow("pause", "PAUSE")}
          <div class="choice" data-invert style="min-width:170px;">
            <div class="big">INVERT AIM Y</div>
            <div class="sub rebind-val">${gm?.bindings.invertY ? "ON" : "OFF"}</div>
          </div>
        </div>
      </div>
      <div class="menu-section">
        <div class="menu-title">Gameplay</div>
        <div class="choices">
          <div class="choice" data-ff style="min-width:240px;">
            <div class="big">FRIENDLY FIRE</div>
            <div class="sub rebind-val">${loadFF() ? "ON" : "OFF"}</div>
            <div class="sub" style="color:#76879a;">off = same-side tanks can't damage each other</div>
          </div>
          <div class="choice" data-show-controls style="min-width:240px;">
            <div class="big">CONTROLS</div>
            <div class="sub">keyboard &amp; gamepad reference</div>
          </div>
        </div>
      </div>
      <div class="menu-section">
        <div class="menu-title">Audio</div>
        <div class="choices" style="align-items:center;">
          <div class="choice" style="pointer-events:auto; cursor:default; min-width:240px;">
            <div class="sub">MASTER — <span id="vMaster">${vols.master}</span>%</div>
            <input type="range" id="rMaster" min="0" max="100" value="${vols.master}" style="width:100%;"/>
          </div>
          <div class="choice" style="pointer-events:auto; cursor:default; min-width:240px;">
            <div class="sub">MUSIC — <span id="vMusic">${vols.music}</span>%</div>
            <input type="range" id="rMusic" min="0" max="100" value="${vols.music}" style="width:100%;"/>
          </div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-reset>RESET PAD LAYOUT</button>
        <button class="btn" data-back>DONE</button>
      </div>
    `);

    const saveVols = () => localStorage.setItem("iv.audio", JSON.stringify(vols));
    this.el.querySelector("#rMaster").addEventListener("input", (e) => {
      vols.master = Number(e.target.value);
      this.el.querySelector("#vMaster").textContent = vols.master;
      audio.setVolume?.(vols.master / 100);
      saveVols();
    });
    this.el.querySelector("#rMusic").addEventListener("input", (e) => {
      vols.music = Number(e.target.value);
      this.el.querySelector("#vMusic").textContent = vols.music;
      audio.setMusicVolume?.(vols.music / 100);
      saveVols();
    });

    this.el.querySelectorAll("[data-rebind]").forEach((row) => {
      row.addEventListener("click", () => {
        if (!gm) return;
        const action = row.dataset.rebind;
        const valEl = row.querySelector(".rebind-val");
        valEl.textContent = "PRESS A BUTTON…";
        gm.captureNext((btn) => {
          gm.setBinding(action, btn);
          valEl.textContent = gm.buttonName(btn);
          audio.uiSelect?.({});
        });
      });
    });
    this.el.querySelector("[data-invert]").addEventListener("click", (e) => {
      if (!gm) return;
      gm.setBinding("invertY", !gm.bindings.invertY);
      e.currentTarget.querySelector(".rebind-val").textContent = gm.bindings.invertY ? "ON" : "OFF";
      audio.uiSelect?.({});
    });
    this.el.querySelector("[data-ff]").addEventListener("click", (e) => {
      const next = !loadFF();
      saveFF(next);
      e.currentTarget.querySelector(".rebind-val").textContent = next ? "ON" : "OFF";
      audio.uiSelect?.({});
    });
    this.el.querySelector("[data-show-controls]").addEventListener("click", () => {
      audio.uiSelect?.({});
      this.controls();
    });
    this.el.querySelector("[data-reset]").addEventListener("click", () => {
      gm?.resetBindings();
      this.options();
    });
    this.el.querySelector("[data-back]").addEventListener("click", () => this.title());
  }

  tankSelect(playerIdx) {
    const playerCount = this.state.mode === "versus" ? 2 : 1;
    const label = playerCount === 2 ? `PLAYER ${playerIdx + 1}` : "COMMANDER";
    this.panel(`
      <div class="logo" style="font-size:42px;">Choose Your Tank</div>
      <div class="tagline">${label}</div>
      <div class="menu-section">
        <div class="choices">
          ${CHASSIS.map((c) => `
            <div class="choice" data-v="${c.id}" style="min-width:220px; max-width:240px;">
              <img class="thumb" src="${tankThumb(c.id)}" alt="${c.name}"/>
              <div class="big">${c.name}</div>
              <div class="sub">${c.role}</div>
              <div class="sub" style="margin-top:6px;">${c.blurb}</div>
              <div class="sub" style="margin-top:8px; color:#aebdca;">
                SPD ${bars(c.stats.speed, 34)} · ARM ${bars(c.stats.hp, 175)}<br/>
                DMG ${bars(c.stats.shellDamage, 60)} · RLD ${bars(5 - c.stats.reload, 2.4)}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>← Back</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () =>
      playerIdx === 0 ? this.title() : this.tankSelect(playerIdx - 1);
    this.bindChoices((v) => {
      this.state.players[playerIdx] = { chassisId: v, name: playerCount === 2 ? `P${playerIdx + 1}` : "YOU" };
      if (playerIdx + 1 < playerCount) this.tankSelect(playerIdx + 1);
      else this.botSelect();
    });
  }

  botSelect() {
    const versus = this.state.mode === "versus";
    const opts = versus ? [0, 2, 4, 6] : [1, 3, 5, 7];
    this.panel(`
      <div class="logo" style="font-size:42px;">Enemy Armor</div>
      <div class="tagline">computer-controlled tanks in the field</div>
      <div class="menu-section">
        <div class="choices">
          ${opts.map((n) => `
            <div class="choice" data-v="${n}">
              <div class="big">${n === 0 ? "NONE" : n + " BOTS"}</div>
              <div class="sub">${n === 0 ? "pure duel" : n <= 3 ? "skirmish" : n <= 5 ? "battle" : "total war"}</div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="menu-section">
        <div class="menu-title">Bot difficulty</div>
        <div class="choices" id="diffRow">
          <div class="choice" data-d="0.7"><div class="big">RECRUIT</div></div>
          <div class="choice selected" data-d="1.0"><div class="big">VETERAN</div></div>
          <div class="choice" data-d="1.35"><div class="big">WARLORD</div></div>
        </div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>← Back</button></div>
    `);
    this.state.difficulty = 1.0;
    this.el.querySelectorAll("#diffRow .choice").forEach((c) => {
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        this.el.querySelectorAll("#diffRow .choice").forEach((x) => x.classList.remove("selected"));
        c.classList.add("selected");
        this.state.difficulty = parseFloat(c.dataset.d);
        audio.uiSelect?.({});
      });
    });
    this.el.querySelector("[data-back]").onclick = () => this.tankSelect(this.state.players.length - 1);
    this.el.querySelectorAll(".choice[data-v]").forEach((c) => {
      c.addEventListener("click", () => {
        this.state.botCount = parseInt(c.dataset.v, 10);
        audio.uiSelect?.({});
        this.mapSelect();
      });
    });
  }

  mapSelect() {
    this.panel(`
      <div class="logo" style="font-size:42px;">Theater of War</div>
      <div class="tagline">five worlds. one winner.</div>
      <div class="menu-section">
        <div class="choices">
          ${MAPS.map((m) => `
            <div class="choice" data-v="${m.id}" style="min-width:230px; max-width:250px;">
              <img class="thumb" src="${mapThumb(m.id)}" alt="${m.name}"/>
              <div class="big">${m.name}</div>
              <div class="sub">${m.blurb}</div>
              <div style="margin-top:10px; height:6px; border-radius:3px; background: linear-gradient(90deg, ${cssColor(m.sky.top)}, ${cssColor(m.sky.horizon)}, ${cssColor(m.palette[2].c)});"></div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>← Back</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () => this.botSelect();
    this.bindChoices((v) => {
      this.state.mapId = v;
      this.launchConfirm();
    });
  }

  launchConfirm() {
    const s = this.state;
    const map = MAPS.find((m) => m.id === s.mapId);
    this.panel(`
      <div class="logo" style="font-size:42px;">Ready</div>
      <div class="tagline">${map.name} — first to 10 kills</div>
      <div class="menu-section">
        <div class="choices">
          ${s.players.map((p, i) => `
            <div class="choice selected" style="pointer-events:none;">
              <div class="big">${p.name}</div>
              <div class="sub">${CHASSIS.find((c) => c.id === p.chassisId).name}</div>
            </div>
          `).join("")}
          ${s.botCount > 0 ? `
            <div class="choice selected" style="pointer-events:none;">
              <div class="big">${s.botCount} BOTS</div>
              <div class="sub">${s.difficulty < 0.9 ? "Recruit" : s.difficulty > 1.2 ? "Warlord" : "Veteran"}</div>
            </div>` : ""}
        </div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-back>← Back</button>
        <button class="btn" data-go>DEPLOY ⟶</button>
      </div>
    `);
    this.el.querySelector("[data-back]").onclick = () => this.mapSelect();
    this.el.querySelector("[data-go]").onclick = () => {
      audio.uiSelect?.({});
      this.hide();
      this.onLaunch({
        mapId: s.mapId,
        mode: s.mode,
        players: s.players,
        botCount: s.botCount,
        difficulty: s.difficulty,
        killTarget: 10,
        friendlyFire: loadFF(),
      });
    };
  }
}

function bars(v, max) {
  const n = Math.round((v / max) * 5);
  return "▰".repeat(Math.max(1, Math.min(5, n))) + "▱".repeat(5 - Math.max(1, Math.min(5, n)));
}

function loadFF() {
  try { return JSON.parse(localStorage.getItem("iv.friendlyFire") ?? "true"); }
  catch { return true; }
}
function saveFF(v) {
  localStorage.setItem("iv.friendlyFire", JSON.stringify(!!v));
}

function cssColor(c) {
  if (Array.isArray(c)) {
    return `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
  }
  return `#${c.toString(16).padStart(6, "0")}`;
}
