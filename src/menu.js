// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Menu flow: title → mode → tank select (per player) → map select →
 * launch config. DOM-driven, keyboard + mouse both work.
 */

import { CHASSIS } from "./tanks.js";
import { MAPS } from "./maps.js";
import { audio } from "./audio.js";

export class Menu {
  constructor(rootEl, onLaunch) {
    this.el = rootEl;
    this.onLaunch = onLaunch;
    this.state = {};
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

  // ── screens ─────────────────────────────────────────────────
  title() {
    this.panel(`
      <div class="logo">Iron Volley</div>
      <div class="tagline">Arc the shell. Erase the hill. Win the war.</div>
      <div class="menu-section">
        <div class="choices">
          <div class="choice" data-v="solo">
            <div class="big">⚔ SOLO OPS</div>
            <div class="sub">You vs computer-controlled tanks</div>
          </div>
          <div class="choice" data-v="versus">
            <div class="big">⚔⚔ SPLIT-SCREEN VERSUS</div>
            <div class="sub">Two commanders, one keyboard — bots optional</div>
          </div>
        </div>
      </div>
      <div class="hint">
        P1 <kbd>W A S D</kbd> drive · <kbd>Q</kbd><kbd>E</kbd> turret · <kbd>R</kbd><kbd>F</kbd> elevation · <kbd>SPACE</kbd> fire · <kbd>L-SHIFT</kbd> MG
        &nbsp;&nbsp;|&nbsp;&nbsp;
        P2 <kbd>ARROWS</kbd> · <kbd>,</kbd><kbd>.</kbd> turret · <kbd>'</kbd><kbd>;</kbd> elevation · <kbd>ENTER</kbd> fire · <kbd>/</kbd> MG
      </div>
    `);
    this.bindChoices((v) => {
      this.state = { mode: v, players: [] };
      this.tankSelect(0);
    });
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
            <div class="choice" data-v="${c.id}" style="min-width:180px;">
              <div class="big">${c.name}</div>
              <div class="sub">${c.role}</div>
              <div class="sub" style="margin-top:8px;">${c.blurb}</div>
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
            <div class="choice" data-v="${m.id}" style="min-width:200px;">
              <div class="big">${m.name}</div>
              <div class="sub">${m.blurb}</div>
              <div style="margin-top:10px; height:8px; border-radius:4px; background: linear-gradient(90deg, ${cssColor(m.sky.top)}, ${cssColor(m.sky.horizon)}, ${cssColor(m.palette[2].c)});"></div>
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
      });
    };
  }
}

function bars(v, max) {
  const n = Math.round((v / max) * 5);
  return "▰".repeat(Math.max(1, Math.min(5, n))) + "▱".repeat(5 - Math.max(1, Math.min(5, n)));
}

function cssColor(c) {
  if (Array.isArray(c)) {
    return `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
  }
  return `#${c.toString(16).padStart(6, "0")}`;
}
