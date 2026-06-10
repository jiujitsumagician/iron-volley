// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Per-viewport DOM HUD: health, reload, MG heat, special-round slot,
 * plus shared kill feed / score pill / center toasts. Pure DOM — the
 * 3D layer never knows it exists.
 */

import { ROUND_TYPES } from "./weapons.js";

export class Hud {
  /** @param {HTMLElement} rootEl  @param {"left"|"right"|"full"} region */
  constructor(rootEl, region, label) {
    this.el = rootEl;
    this.el.innerHTML = "";
    this.el.style.display = "block";
    if (region === "left") { this.el.style.right = "50%"; this.el.style.left = "0"; }
    else if (region === "right") { this.el.style.left = "50%"; this.el.style.right = "0"; }
    else { this.el.style.left = "0"; this.el.style.right = "0"; }

    this.el.insertAdjacentHTML("beforeend", `
      <div class="vignette"></div>
      <div class="dmgflash"></div>
      <svg class="reticle" viewBox="0 0 26 26">
        <circle cx="13" cy="13" r="11" fill="none" stroke="#ffd27a" stroke-width="1.4" opacity=".75"/>
        <line x1="13" y1="1" x2="13" y2="7" stroke="#ffd27a" stroke-width="1.6"/>
        <line x1="13" y1="19" x2="13" y2="25" stroke="#ffd27a" stroke-width="1.6"/>
        <line x1="1" y1="13" x2="7" y2="13" stroke="#ffd27a" stroke-width="1.6"/>
        <line x1="19" y1="13" x2="25" y2="13" stroke="#ffd27a" stroke-width="1.6"/>
        <circle cx="13" cy="13" r="1.4" fill="#ffd27a"/>
      </svg>
      <div class="corner" style="left:18px;bottom:16px;">
        <div class="hpwrap">
          <div class="label">${label}</div>
          <div class="bar hp"><i></i></div>
        </div>
        <div class="ammo">
          <div class="slot">
            <div class="k">Cannon</div>
            <div class="v cannon-state">READY</div>
            <div class="cd reload"><i></i></div>
          </div>
          <div class="slot">
            <div class="k">MG</div>
            <div class="v mg-state">OK</div>
            <div class="cd heat"><i></i></div>
          </div>
          <div class="slot special" style="display:none;">
            <div class="k special-name">—</div>
            <div class="v special-ammo">0</div>
          </div>
        </div>
      </div>
      <div class="toast"></div>
    `);

    this.hpBar = this.el.querySelector(".bar.hp");
    this.hpFill = this.el.querySelector(".bar.hp > i");
    this.cannonState = this.el.querySelector(".cannon-state");
    this.reloadFill = this.el.querySelector(".reload > i");
    this.mgState = this.el.querySelector(".mg-state");
    this.heatFill = this.el.querySelector(".heat > i");
    this.specialSlot = this.el.querySelector(".slot.special");
    this.specialName = this.el.querySelector(".special-name");
    this.specialAmmo = this.el.querySelector(".special-ammo");
    this.flash = this.el.querySelector(".dmgflash");
    this.toastEl = this.el.querySelector(".toast");
    this.toastUntil = 0;
    this.flashLevel = 0;
  }

  update(tank, dt) {
    const hpFrac = tank.hp / tank.maxHp;
    this.hpFill.style.width = `${Math.max(0, hpFrac) * 100}%`;
    this.hpBar.classList.toggle("low", hpFrac < 0.35);

    const s = tank.chassis.stats;
    if (!tank.alive) {
      this.cannonState.textContent = "DESTROYED";
      this.reloadFill.style.width = "0%";
    } else if (tank.reloadLeft > 0) {
      this.cannonState.textContent = "LOADING";
      this.reloadFill.style.width = `${(1 - tank.reloadLeft / s.reload) * 100}%`;
    } else {
      this.cannonState.textContent = "READY";
      this.reloadFill.style.width = "100%";
    }

    this.mgState.textContent = tank.mgHeat >= 1 ? "HOT!" : "OK";
    this.heatFill.style.width = `${tank.mgHeat * 100}%`;
    this.heatFill.style.background = tank.mgHeat > 0.75 ? "#ff5e5e" : "var(--amber)";

    if (tank.special) {
      const def = ROUND_TYPES[tank.special.type];
      this.specialSlot.style.display = "";
      this.specialName.textContent = def.name;
      this.specialAmmo.textContent = tank.special.ammo;
      this.specialSlot.style.borderColor = `#${def.color.toString(16).padStart(6, "0")}`;
    } else {
      this.specialSlot.style.display = "none";
    }

    // damage flash decay
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.4);
    this.flash.style.opacity = this.flashLevel;

    if (performance.now() > this.toastUntil) this.toastEl.style.opacity = 0;
  }

  damaged(frac) {
    this.flashLevel = Math.min(1, this.flashLevel + 0.45 + frac);
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = 1;
    this.toastUntil = performance.now() + ms;
  }

  hide() {
    this.el.style.display = "none";
  }
}

/** Shared overlay bits that sit above both viewports. */
export class SharedHud {
  constructor() {
    let el = document.getElementById("sharedhud");
    if (!el) {
      el = document.createElement("div");
      el.id = "sharedhud";
      el.className = "layer";
      el.style.zIndex = 6;
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="scorepill"></div>
      <div class="killfeed"></div>
    `;
    this.el = el;
    this.pill = el.querySelector(".scorepill");
    this.feed = el.querySelector(".killfeed");
  }

  setScore(text) {
    this.pill.textContent = text;
  }

  addKill(killerName, weapon, victimName) {
    const div = document.createElement("div");
    div.innerHTML = `<b>${killerName}</b> ⟶ ${weapon} ⟶ ${victimName}`;
    this.feed.prepend(div);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  hide() { this.el.style.display = "none"; }
  show() { this.el.style.display = "block"; }
}
