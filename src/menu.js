// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Menu flow: title → mode → tank select (per player) → map select →
 * launch config. DOM-driven, keyboard + mouse both work.
 */

import { CHASSIS, SKINS } from "./tanks.js";
import { NetSession } from "./net.js";
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
    // When a controller is driving the menu, land the cursor on the first item
    // straight away so there's always a visible selection — previously focus
    // started at -1 (nothing highlighted) until the first d-pad press, so you
    // couldn't tell where you were. Mouse/keyboard users start unhighlighted
    // so the hover state isn't fought.
    const padActive = !!this.gamepads?.anyPadConnected?.();
    this.focusIdx = padActive && this.focusables.length ? 0 : -1;
    if (this.focusIdx === 0) this.applyFocus();
  }

  applyFocus() {
    this.focusables.forEach((f, i) => f.classList.toggle("focus", i === this.focusIdx));
    this.focusables[this.focusIdx]?.scrollIntoView?.({ block: "nearest" });
  }

  /** Called by the main loop with edge-triggered pad input. */
  handlePad(nav) {
    if (this.el.style.display === "none" || !this.focusables.length) return;
    // First directional press just reveals the cursor (e.g. a pad connected
    // after this screen was built, so nothing is highlighted yet).
    if ((nav.up || nav.down || nav.left || nav.right) && this.focusIdx < 0) {
      this.focusIdx = 0;
      audio.uiMove?.({ gain: 0.3 });
      this.applyFocus();
      return;
    }
    const cur = this.focusables[this.focusIdx];
    // Left/right on a focused slider nudges its value instead of moving away.
    if (cur?.type === "range" && (nav.left || nav.right)) {
      cur.value = Math.max(0, Math.min(100, Number(cur.value) + (nav.right ? 5 : -5)));
      cur.dispatchEvent(new Event("input"));
      audio.uiMove?.({ gain: 0.2 });
      return;
    }
    if (nav.up) this.moveFocus("up");
    else if (nav.down) this.moveFocus("down");
    else if (nav.left) this.moveFocus("left");
    else if (nav.right) this.moveFocus("right");
    else if (nav.confirm) {
      const f = this.focusables[Math.max(0, this.focusIdx)];
      if (f?.type === "range") {
        f.value = Number(f.value) + 10 > 100 ? 0 : Number(f.value) + 10;
        f.dispatchEvent(new Event("input"));
      } else f?.click();
    } else if (nav.back) {
      this.el.querySelector("[data-back]")?.click();
    }
  }

  /**
   * Spatial focus move: pick the focusable whose centre lies furthest in the
   * requested direction with the least cross-axis drift — so Up/Down walk rows
   * and Left/Right walk columns like a real game menu, instead of stepping
   * through DOM reading order (which made Up/Down feel like Left/Right).
   */
  moveFocus(dir) {
    const cur = this.focusables[this.focusIdx] || this.focusables[0];
    if (!cur) return;
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best = -1, bestScore = Infinity;
    this.focusables.forEach((f, i) => {
      if (i === this.focusIdx) return;
      const r = f.getBoundingClientRect();
      const dx = (r.left + r.width / 2) - cx;
      const dy = (r.top + r.height / 2) - cy;
      let primary, cross;
      if (dir === "left") { if (dx > -2) return; primary = -dx; cross = Math.abs(dy); }
      else if (dir === "right") { if (dx < 2) return; primary = dx; cross = Math.abs(dy); }
      else if (dir === "up") { if (dy > -2) return; primary = -dy; cross = Math.abs(dx); }
      else { if (dy < 2) return; primary = dy; cross = Math.abs(dx); }
      // Weight cross-axis drift heavily so the cursor stays in the same row/column.
      const score = primary + cross * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best === -1) return; // edge of the menu in that direction — stay put
    this.focusIdx = best;
    audio.uiMove?.({ gain: 0.3 });
    this.applyFocus();
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
          <div class="choice" data-v="online">
            <div class="big">🌐 ONLINE VERSUS</div>
            <div class="sub">Host a room or join with a code</div>
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
      if (v === "online") return this.onlineMenu();
      this.state = { mode: v, players: [] };
      this.tankSelect(0);
    });
  }

  // ── ONLINE: lobby flow ───────────────────────────────────────
  onlineMenu() {
    this.netSession?.destroy();
    this.netSession = null;
    this.panel(`
      <div class="logo" style="font-size:42px;">Online Versus</div>
      <div class="tagline">peer-to-peer · share a 5-letter room code</div>
      <div class="menu-section">
        <div class="choices">
          <div class="choice" data-v="host">
            <div class="big">⚑ HOST A ROOM</div>
            <div class="sub">You pick the map. They bring the pain.</div>
          </div>
          <div class="choice" data-v="join">
            <div class="big">⌁ JOIN A ROOM</div>
            <div class="sub">Enter a friend's room code</div>
          </div>
        </div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>← Back</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () => this.title();
    this.bindChoices((v) => {
      this.state = { mode: v === "host" ? "online-host" : "online-guest", players: [] };
      if (v === "host") this.tankSelect(0);
      else this.joinCode();
    });
  }

  joinCode() {
    this.panel(`
      <div class="logo" style="font-size:42px;">Join Room</div>
      <div class="tagline">enter the host's code</div>
      <div class="menu-section">
        <input id="roomcode" maxlength="5" placeholder="•••••" autocomplete="off"
          style="width:240px; text-align:center; font-size:34px; letter-spacing:.4em; text-transform:uppercase;
                 background:#0d1219; color:#ffd27a; border:1px solid #2a3645; border-radius:12px; padding:12px 0 12px 12px; outline:none;"/>
        <div class="sub" id="joinerr" style="color:#ff7a84; margin-top:12px; min-height:16px;"></div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-back>← Back</button>
        <button class="btn" data-go>CONNECT ⟶</button>
      </div>
    `);
    const input = this.el.querySelector("#roomcode");
    input.focus();
    this.el.querySelector("[data-back]").onclick = () => this.onlineMenu();
    const go = async () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 5) { this.el.querySelector("#joinerr").textContent = "Codes are 5 characters."; return; }
      this.el.querySelector("#joinerr").textContent = "Connecting…";
      try {
        this.netSession = new NetSession();
        await this.netSession.join(code);
        audio.uiSelect?.({});
        this.tankSelect(0);
      } catch (e) {
        this.el.querySelector("#joinerr").textContent = e.message;
        this.netSession?.destroy();
        this.netSession = null;
      }
    };
    this.el.querySelector("[data-go]").onclick = go;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  hostLobby() {
    const p = this.state.players[0];
    this.panel(`
      <div class="logo" style="font-size:42px;">War Room</div>
      <div class="tagline">give your challenger this code</div>
      <div class="menu-section">
        <div id="codebox" style="font-size:52px; font-weight:900; letter-spacing:.35em; color:#ffd27a; text-shadow:0 0 24px rgba(255,150,50,.4);">
          •••••
        </div>
        <div class="sub" id="loberr" style="margin-top:14px; min-height:18px;">Opening the room…</div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-back>CANCEL</button>
        <button class="btn" data-go style="display:none;">CHOOSE BATTLEFIELD ⟶</button>
      </div>
    `);
    this.el.querySelector("[data-back]").onclick = () => {
      this.netSession?.destroy();
      this.netSession = null;
      this.onlineMenu();
    };

    this.netSession = new NetSession();
    this.netSession.on("hello", (d) => {
      this.netGuestHello = d;
      this.el.querySelector("#loberr").innerHTML =
        `<b style="color:#6dff8a;">${d.name ?? "CHALLENGER"} READY</b> — ${d.chassisId.toUpperCase()}`;
      this.el.querySelector("[data-go]").style.display = "";
      this.refreshFocusables();
      audio.pickup?.({});
    });
    this.netSession
      .host(() => {
        this.el.querySelector("#loberr").textContent = "Challenger connected — waiting for their loadout…";
      })
      .then((code) => {
        this.el.querySelector("#codebox").textContent = code;
        this.el.querySelector("#loberr").textContent = "Waiting for a challenger…";
      })
      .catch((e) => {
        this.el.querySelector("#loberr").textContent = e.message;
      });

    this.el.querySelector("[data-go]").onclick = () => {
      audio.uiSelect?.({});
      this.botSelect();
    };
  }

  guestWait() {
    const p = this.state.players[0];
    this.netSession.send("hello", { name: "CHALLENGER", chassisId: p.chassisId, skinId: p.skinId ?? null });
    this.panel(`
      <div class="logo" style="font-size:42px;">Locked In</div>
      <div class="tagline">waiting for the host to deploy</div>
      <div class="menu-section">
        <div class="sub" style="font-size:14px;">Your ${CHASSIS.find((c) => c.id === p.chassisId).name} is fueled and loaded.</div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>LEAVE</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () => {
      this.netSession?.destroy();
      this.netSession = null;
      this.onlineMenu();
    };
    this.netSession.on("config", (cfg) => {
      const session = this.netSession;
      this.netSession = null; // game owns it now
      this.hide();
      this.onLaunch({
        mapId: cfg.mapId,
        mode: "online",
        players: [{ chassisId: p.chassisId, skinId: p.skinId, name: "CHALLENGER" }],
        botCount: 0,
        killTarget: cfg.killTarget,
        net: { role: "guest", session },
      });
    });
    this.netSession.onClose = () => {
      this.netSession = null;
      this.onlineMenu();
    };
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
        </div>
        <div class="sub" style="max-width:560px; margin:12px auto 0; line-height:1.7; color:#86c8a0;">
          Generic / non-Xbox controller? A <b>🎮 connected</b> badge on the title
          screen means it's detected. If the sticks work but buttons don't, set
          <b>FIRE / MG / PAUSE</b> in Options — the rebinder captures any button.
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
      playerIdx === 0 ? this.title() : this.skinSelect(playerIdx - 1);
    this.bindChoices((v) => {
      this.state.players[playerIdx] = { chassisId: v, name: playerCount === 2 ? `P${playerIdx + 1}` : "YOU" };
      this.skinSelect(playerIdx);
    });
  }

  // ── paint shop: pick a finish for the chosen chassis ─────────
  skinSelect(playerIdx) {
    const playerCount = this.state.mode === "versus" ? 2 : 1;
    const p = this.state.players[playerIdx];
    const label = playerCount === 2 ? `PLAYER ${playerIdx + 1}` : "COMMANDER";
    const chassis = CHASSIS.find((c) => c.id === p.chassisId);
    this.panel(`
      <div class="logo" style="font-size:42px;">Paint Shop</div>
      <div class="tagline">${label} — ${chassis.name}</div>
      <div class="menu-section">
        <div class="choices">
          ${SKINS.map((s) => `
            <div class="choice" data-v="${s.id}" style="min-width:150px; max-width:165px;">
              <img class="thumb" style="height:84px;" src="${tankThumb(p.chassisId, s.id)}" alt="${s.name}"/>
              <div class="big" style="font-size:14px;">${s.name}</div>
              ${s.desc ? `<div class="sub">${s.desc}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="row-actions"><button class="btn ghost" data-back>← Back</button></div>
    `);
    this.el.querySelector("[data-back]").onclick = () => this.tankSelect(playerIdx);
    this.bindChoices((v) => {
      p.skinId = v;
      if (this.state.mode === "online-host") return this.hostLobby();
      if (this.state.mode === "online-guest") return this.guestWait();
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
      const config = {
        mapId: s.mapId,
        mode: s.mode,
        players: s.players,
        botCount: s.botCount,
        difficulty: s.difficulty,
        killTarget: 10,
        friendlyFire: loadFF(),
      };
      if (s.mode === "online-host") {
        const session = this.netSession;
        this.netSession = null; // game owns it now
        session.send("config", { mapId: s.mapId, killTarget: 10 });
        config.net = { role: "host", session, guest: this.netGuestHello };
        config.friendlyFire = true; // online duel — shots always count
      }
      this.hide();
      this.onLaunch(config);
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
