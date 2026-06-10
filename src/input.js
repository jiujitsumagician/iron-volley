// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * Keyboard input → per-player control state. Two fixed binding sets
 * (left half / right half of the keyboard) so split-screen works on
 * one board. Uses event.code (layout-independent physical keys).
 */

export const P1_KEYS = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD",
  turretLeft: "KeyQ", turretRight: "KeyE",
  pitchUp: "KeyR", pitchDown: "KeyF",
  fire: "Space", mg: "ShiftLeft",
};

export const P2_KEYS = {
  forward: "ArrowUp", back: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  turretLeft: "Comma", turretRight: "Period",
  pitchUp: "Quote", pitchDown: "Semicolon",
  fire: "Enter", mg: "Slash",
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // cleared each frame — edge triggers
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      // stop the page scrolling / button focus stealing
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash", "Quote"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
  }

  /** Read one player's controls. keys = P1_KEYS | P2_KEYS. */
  read(keys) {
    const d = this.down, p = this.pressed;
    return {
      throttle: (d.has(keys.forward) ? 1 : 0) - (d.has(keys.back) ? 1 : 0),
      steer: (d.has(keys.right) ? 1 : 0) - (d.has(keys.left) ? 1 : 0),
      turretTurn: (d.has(keys.turretLeft) ? 1 : 0) - (d.has(keys.turretRight) ? 1 : 0),
      pitch: (d.has(keys.pitchUp) ? 1 : 0) - (d.has(keys.pitchDown) ? 1 : 0),
      fire: p.has(keys.fire) || d.has(keys.fire),
      mg: d.has(keys.mg),
    };
  }

  endFrame() {
    this.pressed.clear();
  }
}
