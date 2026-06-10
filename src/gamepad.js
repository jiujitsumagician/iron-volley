// ?? 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

export const BUTTON_NAMES = ["A","B","X","Y","LB","RB","LT","RT","Back","Start","LS","RS","D-Up","D-Down","D-Left","D-Right","Guide"];

export const DEFAULT_BINDINGS = {
  fire: 7,      // RT
  mg: 6,        // LT
  pause: 9,     // Start
  invertY: false, // barrel pitch on right stick Y
};

const STORAGE_KEY = "iv.pad.bindings";
const DEADZONE = 0.16;
const TRIGGER_HELD = 0.4;
const FLICK_ON = 0.55;
const FLICK_OFF = 0.3;

const ZERO_STATE = {
  throttle: 0,
  steer: 0,
  turretTurn: 0,
  pitch: 0,
  fire: false,
  mg: false,
  pauseEdge: false,
  viewEdge: false,
};

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function loadBindings() {
  const storage = safeLocalStorage();
  if (!storage) return { ...DEFAULT_BINDINGS };

  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_BINDINGS, ...stored };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

function saveBindings(bindings) {
  const storage = safeLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage may be unavailable or full; controls should still work.
  }
}

function getPads() {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return [];
  }

  try {
    return Array.from(navigator.getGamepads() || []);
  } catch {
    return [];
  }
}

function buttonHeld(button) {
  if (!button) return false;
  if (typeof button === "number") return button > TRIGGER_HELD;
  return !!button.pressed || Number(button.value || 0) > TRIGGER_HELD;
}

function axis(pad, index) {
  return Number(pad && pad.axes && pad.axes[index] ? pad.axes[index] : 0);
}

// Right-stick read that tolerates non-standard / DInput controllers. Standard
// XInput pads (exactly 4 axes) always use axes 2 (X) + 3 (Y) and are never
// touched. Generic pads that expose more axes sometimes carry the right-stick
// Y on axis 5 (or 4); only adopt those when the standard pair is idle and the
// alternate is a real stick deflection — not a trigger resting at ±1.
function readRightStick(pad) {
  const x = axis(pad, 2);
  let y = axis(pad, 3);
  if (pad && pad.axes && pad.axes.length > 4) {
    // generic/DInput pads commonly carry right-stick Y on axis 5 (or 4) while
    // axis 3 stays flat. Use whichever reads like a real stick deflection,
    // ignoring a trigger pinned near ±1. Standard 4-axis pads never reach here.
    for (const yi of [5, 4]) {
      const ay = axis(pad, yi);
      if (Math.abs(ay) > Math.abs(y) && Math.abs(ay) < 0.985) y = ay;
    }
  }
  return applyRadialDeadzone(x, y);
}

function applyRadialDeadzone(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= DEADZONE) return [0, 0];
  if (magnitude >= 1) return [x / magnitude, y / magnitude];

  const scaled = (magnitude - DEADZONE) / (1 - DEADZONE);
  return [(x / magnitude) * scaled, (y / magnitude) * scaled];
}

function emptyButtons() {
  return [];
}

export class GamepadManager {
  constructor() {
    this._bindings = loadBindings();
    this._pads = [];
    this._prevButtons = [];
    this._buttons = [];
    this._edges = [];
    this._flickEdges = [];
    this._flickHeld = [];
    this._capture = null;

    this._onConnect = () => this.update();
    this._onDisconnect = () => this.update();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("gamepadconnected", this._onConnect);
      window.addEventListener("gamepaddisconnected", this._onDisconnect);
    }
  }

  update() {
    this._pads = getPads();

    for (let i = 0; i < this._pads.length; i += 1) {
      const pad = this._pads[i];
      const previous = this._buttons[i] || emptyButtons();
      const current = pad ? pad.buttons.map(buttonHeld) : emptyButtons();
      const edges = current.map((pressed, buttonIndex) => pressed && !previous[buttonIndex]);
      const flickEdges = { up: false, down: false, left: false, right: false };

      this._prevButtons[i] = previous;
      this._buttons[i] = current;
      this._edges[i] = edges;

      if (pad) {
        const [lsx, lsy] = applyRadialDeadzone(axis(pad, 0), axis(pad, 1));
        const held = this._flickHeld[i] || { up: false, down: false, left: false, right: false };

        flickEdges.up = lsy < -FLICK_ON && !held.up;
        flickEdges.down = lsy > FLICK_ON && !held.down;
        flickEdges.left = lsx < -FLICK_ON && !held.left;
        flickEdges.right = lsx > FLICK_ON && !held.right;

        held.up = lsy < -FLICK_OFF;
        held.down = lsy > FLICK_OFF;
        held.left = lsx < -FLICK_OFF;
        held.right = lsx > FLICK_OFF;
        this._flickHeld[i] = held;
      }
      this._flickEdges[i] = flickEdges;

      if (this._capture) {
        const capturedIndex = edges.findIndex(Boolean);
        if (capturedIndex !== -1) {
          const cb = this._capture;
          this._capture = null;
          cb(capturedIndex);
        }
      }
    }

    for (let i = this._pads.length; i < this._buttons.length; i += 1) {
      this._prevButtons[i] = this._buttons[i] || emptyButtons();
      this._buttons[i] = emptyButtons();
      this._edges[i] = emptyButtons();
      this._flickEdges[i] = { up: false, down: false, left: false, right: false };
      this._flickHeld[i] = { up: false, down: false, left: false, right: false };
    }
  }

  padConnected(index) {
    const pad = this._pads[index];
    return !!(pad && pad.connected !== false);
  }

  anyPadConnected() {
    return this._pads.some((pad) => pad && pad.connected !== false);
  }

  read(index) {
    const pad = this._pads[index];
    if (!pad || pad.connected === false) return { ...ZERO_STATE };

    const [lsx, lsy] = applyRadialDeadzone(axis(pad, 0), axis(pad, 1));
    const [rsx, rsy] = readRightStick(pad);
    const buttons = pad.buttons || [];

    return {
      throttle: -lsy,
      steer: lsx,
      turretTurn: -rsx,
      pitch: rsy * (this._bindings.invertY ? -1 : 1),
      fire: buttonHeld(buttons[this._bindings.fire]),
      mg: buttonHeld(buttons[this._bindings.mg]),
      pauseEdge: !!(this._edges[index] && this._edges[index][this._bindings.pause]),
      viewEdge: !!(this._edges[index] && this._edges[index][3]), // Y: toggle 1st/3rd person
    };
  }

  menuInput() {
    const out = {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: false,
      back: false,
      start: false,
    };

    for (let i = 0; i < this._pads.length; i += 1) {
      const pad = this._pads[i];
      if (!pad || pad.connected === false) continue;

      const edges = this._edges[i] || emptyButtons();
      out.confirm = out.confirm || !!edges[0];
      out.back = out.back || !!edges[1];
      out.start = out.start || !!edges[9];
      out.up = out.up || !!edges[12];
      out.down = out.down || !!edges[13];
      out.left = out.left || !!edges[14];
      out.right = out.right || !!edges[15];

      const flickEdges = this._flickEdges[i] || {};
      out.up = out.up || !!flickEdges.up;
      out.down = out.down || !!flickEdges.down;
      out.left = out.left || !!flickEdges.left;
      out.right = out.right || !!flickEdges.right;
    }

    return out;
  }

  get bindings() {
    return this._bindings;
  }

  setBinding(action, value) {
    if (action === "invertY") {
      this._bindings.invertY = !!value;
      saveBindings(this._bindings);
      return;
    }

    if (action === "fire" || action === "mg" || action === "pause") {
      this._bindings[action] = Number(value);
      saveBindings(this._bindings);
    }
  }

  resetBindings() {
    this._bindings = { ...DEFAULT_BINDINGS };
    saveBindings(this._bindings);
  }

  captureNext(cb) {
    this._capture = typeof cb === "function" ? cb : null;
    return () => {
      if (this._capture === cb) this._capture = null;
    };
  }

  buttonName(i) {
    return BUTTON_NAMES[i] || `BTN ${i}`;
  }
}
