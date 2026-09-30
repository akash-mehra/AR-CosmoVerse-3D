/*
 * The two ways to fly, reduced to one reading: thrust and turn rates in
 * −1..1, plus boost and brake. Signs follow the ship's axes (nose −Z, up +Y,
 * right +X): positive pitch raises the nose, positive yaw swings it left,
 * positive roll drops the left wing.
 */

export function emptyInput() {
  return { thrust: 0, pitch: 0, yaw: 0, roll: 0, boost: false, brake: false };
}

const FLIGHT_KEYS = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space'
]);

export const KEYBOARD_LEGEND = 'W/S thrust · A/D turn · ↑/↓ pitch · Q/E or ←/→ roll · Shift boost · Space brake · Esc pause';

/** Flight keys, held. Pausing is GameMode's, so Esc works whichever way you fly. */
export class KeyboardControls {
  constructor() {
    this.kind = 'keyboard';
    this.down = new Set();
    this.onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // The pause and game-over screens keep Space and the arrows for their buttons.
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (!FLIGHT_KEYS.has(e.code)) return;
      // Arrows and Space would otherwise scroll or press whatever has focus.
      e.preventDefault();
      this.down.add(e.code);
    };
    this.onKeyUp = (e) => this.down.delete(e.code);
    // A key released while the window is not focused never sends keyup.
    this.onBlur = () => this.down.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  read(out) {
    const k = (code) => (this.down.has(code) ? 1 : 0);
    out.thrust = k('KeyW') - k('KeyS');
    out.yaw = k('KeyA') - k('KeyD');
    out.pitch = k('ArrowUp') - k('ArrowDown');
    out.roll = Math.max(k('KeyQ'), k('ArrowLeft')) - Math.max(k('KeyE'), k('ArrowRight'));
    out.boost = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    out.brake = this.down.has('Space');
    return out;
  }

  setVisible() {
    // Nothing on screen.
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.down.clear();
  }
}

// How far the stick's knob travels, in CSS pixels, and the dead zone at its centre.
const STICK_TRAVEL = 50;
const DEAD_ZONE = 0.12;

const deadZone = (v) => {
  const a = Math.abs(v);
  return a < DEAD_ZONE ? 0 : (Math.sign(v) * (a - DEAD_ZONE)) / (1 - DEAD_ZONE);
};

/**
 * On-screen controls for touch: a stick on the left steers (up raises the
 * nose, sideways turns), buttons on the right hold thrust, reverse, boost,
 * brake and roll. Pointer events with capture, so several fingers work at
 * once and a finger sliding off a button still lets go of it. Pausing is the
 * flight HUD's button, shared with the keyboard.
 */
export class TouchControls {
  constructor(parent) {
    this.kind = 'touch';
    this.held = new Set();
    this.stick = { x: 0, y: 0, id: null, cx: 0, cy: 0 };

    this.el = document.createElement('div');
    this.el.className = 'game-touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="game-stick" role="application" aria-label="Steering stick: drag up to raise the nose, sideways to turn">
        <div class="game-knob"></div>
      </div>
      <div class="game-buttons">
        <button type="button" class="game-btn b-boost" data-hold="boost">Boost</button>
        <button type="button" class="game-btn b-thrust" data-hold="thrust">Thrust</button>
        <button type="button" class="game-btn b-roll-left" data-hold="rollLeft" aria-label="Roll left">⟲</button>
        <button type="button" class="game-btn b-roll-right" data-hold="rollRight" aria-label="Roll right">⟳</button>
        <button type="button" class="game-btn b-reverse" data-hold="reverse">Rev</button>
        <button type="button" class="game-btn b-brake" data-hold="brake">Brake</button>
      </div>
    `;
    parent.appendChild(this.el);

    const stickEl = this.el.querySelector('.game-stick');
    this.knob = this.el.querySelector('.game-knob');
    stickEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stickEl.setPointerCapture(e.pointerId);
      const rect = stickEl.getBoundingClientRect();
      this.stick.id = e.pointerId;
      this.stick.cx = rect.left + rect.width / 2;
      this.stick.cy = rect.top + rect.height / 2;
      this.moveStick(e);
    });
    stickEl.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) this.moveStick(e);
    });
    const releaseStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null;
      this.stick.x = 0;
      this.stick.y = 0;
      this.knob.style.transform = '';
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stickEl.addEventListener(type, releaseStick);

    for (const button of this.el.querySelectorAll('[data-hold]')) {
      const name = button.dataset.hold;
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        this.held.add(name);
        button.classList.add('held');
      });
      const release = () => {
        this.held.delete(name);
        button.classList.remove('held');
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
      // A long press would otherwise open the context menu on some phones.
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  moveStick(e) {
    let dx = e.clientX - this.stick.cx;
    let dy = e.clientY - this.stick.cy;
    const length = Math.hypot(dx, dy);
    if (length > STICK_TRAVEL) {
      dx *= STICK_TRAVEL / length;
      dy *= STICK_TRAVEL / length;
    }
    this.stick.x = dx / STICK_TRAVEL;
    this.stick.y = dy / STICK_TRAVEL;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  read(out) {
    const h = (name) => (this.held.has(name) ? 1 : 0);
    // Screen y grows downward: pushing the stick up raises the nose.
    out.pitch = -deadZone(this.stick.y);
    out.yaw = -deadZone(this.stick.x);
    out.thrust = h('thrust') - h('reverse');
    out.roll = h('rollLeft') - h('rollRight');
    out.boost = this.held.has('boost');
    out.brake = this.held.has('brake');
    return out;
  }

  setVisible(visible) {
    this.el.hidden = !visible;
    if (visible) return;
    // Hidden mid-press, nothing would ever release them.
    this.held.clear();
    for (const button of this.el.querySelectorAll('.held')) button.classList.remove('held');
    this.stick.id = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.knob.style.transform = '';
  }

  dispose() {
    this.el.remove();
    this.held.clear();
  }
}
