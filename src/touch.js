// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * On-screen touch controls for phones — enabled only on coarse-pointer
 * (touch-primary) devices, the way mobile tank games work:
 *   • left thumb  — DRIVE joystick (throttle + steer)
 *   • right thumb — AIM joystick (turret turn + barrel pitch)
 *   • FIRE / MG / VIEW / PAUSE buttons on the right edge
 *
 * Both sticks are "dynamic": the base snaps to wherever the thumb lands
 * inside its half, so you never have to look down to find it. read()
 * returns the exact same control shape as keyboard/gamepad, and Game
 * overlays it with the same whichever-is-stronger merge used for pads,
 * so axis signs match the controller (throttle:-y, steer:x,
 * turretTurn:-x, pitch:-y).
 */

const RADIUS = 64;      // px from origin = full deflection
const DEADZONE = 6;     // px slack before a stick registers

/** True on phones / touch-primary tablets. Force with ?touch, off with ?notouch. */
export function isTouchDevice() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("notouch")) return false;
    if (q.has("touch")) return true;
  } catch { /* no location */ }
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(pointer: coarse)").matches;
}

const CSS = `
.tc-root { position:fixed; inset:0; z-index:20; touch-action:none; user-select:none;
  -webkit-user-select:none; overflow:hidden; }
.tc-stick { position:absolute; width:${RADIUS * 2}px; height:${RADIUS * 2}px; margin:-${RADIUS}px 0 0 -${RADIUS}px;
  border-radius:50%; border:2px solid rgba(255,210,122,.35); background:rgba(10,16,24,.28);
  pointer-events:none; opacity:0; transition:opacity .12s; }
.tc-stick.on { opacity:1; }
.tc-knob { position:absolute; width:58px; height:58px; margin:-29px 0 0 -29px; border-radius:50%;
  background:radial-gradient(circle at 40% 35%, rgba(255,225,160,.95), rgba(255,150,50,.75));
  box-shadow:0 0 22px rgba(255,150,50,.5); pointer-events:none; opacity:0; transition:opacity .12s; }
.tc-knob.on { opacity:1; }
.tc-hint { position:absolute; bottom:calc(13% + env(safe-area-inset-bottom,0px)); font:700 11px/1 system-ui,sans-serif;
  letter-spacing:.18em; color:rgba(255,210,122,.5); text-transform:uppercase; pointer-events:none; }
.tc-btn { position:absolute; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font:800 13px/1 system-ui,sans-serif; letter-spacing:.04em; color:#fff; text-transform:uppercase;
  background:rgba(14,20,28,.5); border:2px solid rgba(255,255,255,.18); backdrop-filter:blur(2px);
  pointer-events:auto; touch-action:none; -webkit-tap-highlight-color:transparent; }
.tc-btn.active { transform:scale(.92); filter:brightness(1.4); }
.tc-fire { width:104px; height:104px; right:calc(5% + env(safe-area-inset-right,0px));
  bottom:calc(11% + env(safe-area-inset-bottom,0px)); font-size:18px;
  background:rgba(200,60,44,.55); border-color:rgba(255,120,90,.6); box-shadow:0 0 26px rgba(255,80,50,.35); }
.tc-mg { width:66px; height:66px; right:calc(5% + 118px + env(safe-area-inset-right,0px));
  bottom:calc(13% + env(safe-area-inset-bottom,0px)); }
.tc-view { width:52px; height:52px; right:calc(5% + env(safe-area-inset-right,0px));
  bottom:calc(11% + 118px + env(safe-area-inset-bottom,0px)); font-size:11px; }
.tc-pause { width:46px; height:46px; top:calc(12px + env(safe-area-inset-top,0px));
  right:calc(12px + env(safe-area-inset-right,0px)); font-size:16px; }
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  const s = document.createElement("style");
  s.id = "tc-style";
  s.textContent = CSS;
  document.head.appendChild(s);
  styleInjected = true;
}

export class TouchControls {
  constructor() {
    injectStyle();
    this.onPause = null;
    this.drive = { ax: 0, ay: 0 };
    this.aim = { ax: 0, ay: 0 };
    this.fire = false;
    this.mg = false;
    this._viewEdge = false;
    // pointerId -> { kind, ox, oy }
    this.pointers = new Map();

    const root = document.createElement("div");
    root.className = "tc-root";
    root.innerHTML = `
      <div class="tc-stick" data-l-base><div class="tc-knob" data-l-knob></div></div>
      <div class="tc-stick" data-r-base><div class="tc-knob" data-r-knob></div></div>
      <div class="tc-hint" style="left:16%;">Drive</div>
      <div class="tc-hint" style="left:auto; right:38%;">Aim</div>
      <div class="tc-btn tc-fire" data-fire>FIRE</div>
      <div class="tc-btn tc-mg" data-mg>MG</div>
      <div class="tc-btn tc-view" data-view>VIEW</div>
      <div class="tc-btn tc-pause" data-pause>❚❚</div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.lBase = root.querySelector("[data-l-base]");
    this.lKnob = root.querySelector("[data-l-knob]");
    this.rBase = root.querySelector("[data-r-base]");
    this.rKnob = root.querySelector("[data-r-knob]");
    this.fireBtn = root.querySelector("[data-fire]");
    this.mgBtn = root.querySelector("[data-mg]");
    this.viewBtn = root.querySelector("[data-view]");
    this.pauseBtn = root.querySelector("[data-pause]");

    // Buttons: own listeners so they never get mistaken for stick drags.
    this._bindButton(this.fireBtn, (on) => { this.fire = on; });
    this._bindButton(this.mgBtn, (on) => { this.mg = on; });
    this._bindButton(this.viewBtn, (on) => { if (on) this._viewEdge = true; });
    this._bindButton(this.pauseBtn, (on) => { if (on) this.onPause?.(); });

    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    root.addEventListener("pointerdown", this._onDown);
    root.addEventListener("pointermove", this._onMove);
    root.addEventListener("pointerup", this._onUp);
    root.addEventListener("pointercancel", this._onUp);
  }

  _bindButton(el, set) {
    const on = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("active"); set(true); };
    const off = (e) => { e.stopPropagation(); el.classList.remove("active"); set(false); };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
  }

  _down(e) {
    // Buttons handle themselves and stop propagation, so anything here is
    // a stick touch. Left half drives, right half aims.
    const leftHalf = e.clientX < window.innerWidth * 0.5;
    const kind = leftHalf ? "drive" : "aim";
    // One finger per stick: ignore a second touch on a side already in use,
    // so lifting the extra finger can't zero a stick the first is still holding.
    for (const p of this.pointers.values()) if (p.kind === kind) return;
    this.pointers.set(e.pointerId, { kind, ox: e.clientX, oy: e.clientY });
    try { this.root.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const base = leftHalf ? this.lBase : this.rBase;
    const knob = leftHalf ? this.lKnob : this.rKnob;
    base.style.left = knob.style.left = e.clientX + "px";
    base.style.top = knob.style.top = e.clientY + "px";
    base.classList.add("on"); knob.classList.add("on");
    this._apply(kind, 0, 0);
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    let dx = e.clientX - p.ox;
    let dy = e.clientY - p.oy;
    const mag = Math.hypot(dx, dy);
    if (mag > RADIUS) { dx = dx / mag * RADIUS; dy = dy / mag * RADIUS; }
    const knob = p.kind === "drive" ? this.lKnob : this.rKnob;
    knob.style.left = (p.ox + dx) + "px";
    knob.style.top = (p.oy + dy) + "px";
    const ax = Math.abs(dx) < DEADZONE ? 0 : dx / RADIUS;
    const ay = Math.abs(dy) < DEADZONE ? 0 : dy / RADIUS;
    this._apply(p.kind, ax, ay);
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this._apply(p.kind, 0, 0);
    const base = p.kind === "drive" ? this.lBase : this.rBase;
    const knob = p.kind === "drive" ? this.lKnob : this.rKnob;
    base.classList.remove("on"); knob.classList.remove("on");
  }

  _apply(kind, ax, ay) {
    if (kind === "drive") { this.drive.ax = ax; this.drive.ay = ay; }
    else { this.aim.ax = ax; this.aim.ay = ay; }
  }

  /** Same shape as Input.read(). Signs mirror the gamepad mapping. */
  read() {
    const v = this._viewEdge;
    this._viewEdge = false;
    return {
      throttle: -this.drive.ay,     // up = forward
      steer: this.drive.ax,         // right = steer right
      turretTurn: -this.aim.ax,     // matches pad turretTurn:-rsx
      pitch: -this.aim.ay,          // matches pad pitch:-rsy
      fire: this.fire,
      mg: this.mg,
      view: v,
    };
  }

  /** Any stick or fire input active this frame? Used for the merge. */
  get active() {
    return this.drive.ax || this.drive.ay || this.aim.ax || this.aim.ay || this.fire || this.mg;
  }

  setActive(on) {
    this.root.style.display = on ? "" : "none";
    if (!on) {
      this.pointers.clear();
      this.drive = { ax: 0, ay: 0 };
      this.aim = { ax: 0, ay: 0 };
      this.fire = this.mg = false;
      this.lBase.classList.remove("on"); this.lKnob.classList.remove("on");
      this.rBase.classList.remove("on"); this.rKnob.classList.remove("on");
    }
  }

  dispose() {
    this.root.removeEventListener("pointerdown", this._onDown);
    this.root.removeEventListener("pointermove", this._onMove);
    this.root.removeEventListener("pointerup", this._onUp);
    this.root.removeEventListener("pointercancel", this._onUp);
    this.root.remove();
    this.pointers.clear();
  }
}
