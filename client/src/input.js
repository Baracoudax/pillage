// Entrées unifiées : clavier/souris (pointer lock) et tactile (joystick virtuel + boutons).
// event.code = position physique : ZQSD (AZERTY) et WASD (QWERTY) fonctionnent tous les deux.
import { isTouch } from './gfx.js';

export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mx = 0; this.my = 0;           // déplacement (-1..1)
    this.lookX = 0; this.lookY = 0;     // delta de visée (px)
    this.pressed = new Set();           // actions déclenchées cette frame
    this.held = new Set();              // actions maintenues
    this.crouch = false;
    this.sprintToggle = false;
    this.touch = isTouch();
    this.enabled = false;
    this.locked = false;
    this.sens = 1;

    const bindKey = { KeyE: 'interact', KeyF: 'interact', KeyH: 'heal', Digit1: 'heal', Tab: 'inv', KeyI: 'inv', KeyV: 'alt', Escape: 'pause', KeyP: 'pause' };
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = bindKey[e.code];
      if (a) { this.pressed.add(a); this.held.add(a); }
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = bindKey[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) { this.pressed.add('attack'); this.held.add('attack'); }
      if (e.button === 2) this.pressed.add('alt');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.held.delete('attack'); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.enabled && !this.touch) this.pressed.add('unlocked');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * this.sens;
      this.lookY += e.movementY * this.sens;
    });

    if (this.touch) this.setupTouch(touchRoot);
  }

  setupTouch(root) {
    root.classList.add('on');
    const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
    let moveId = null, lookId = null, ox = 0, oy = 0, lx = 0, ly = 0;
    const R = 55;
    root.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const btn = t.target.closest?.('[data-act]');
        if (btn) {
          const a = btn.dataset.act;
          if (a === 'crouch') this.crouch = !this.crouch;
          else if (a === 'sprint') this.sprintToggle = !this.sprintToggle;
          else { this.pressed.add(a); this.held.add(a); }
          btn.classList.add('down');
          btn.dataset.tid = t.identifier;
          continue;
        }
        if (t.clientX < window.innerWidth * 0.42 && moveId === null) {
          moveId = t.identifier; ox = t.clientX; oy = t.clientY;
          stick.style.left = ox - 60 + 'px'; stick.style.top = oy - 60 + 'px';
          stick.classList.add('show');
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) {
          let dx = t.clientX - ox, dy = t.clientY - oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          this.mx = dx / R; this.my = -dy / R;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === lookId) {
          this.lookX += (t.clientX - lx) * 2.2 * this.sens;
          this.lookY += (t.clientY - ly) * 2.2 * this.sens;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) {
          moveId = null; this.mx = this.my = 0;
          knob.style.transform = ''; stick.classList.remove('show');
        }
        if (t.identifier === lookId) lookId = null;
        for (const b of root.querySelectorAll('[data-act].down')) {
          if (b.dataset.tid == t.identifier) { b.classList.remove('down'); this.held.delete(b.dataset.act); }
        }
      }
    };
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
  }

  // à appeler une fois par frame
  read() {
    if (!this.touch) {
      const k = this.keys;
      this.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      this.my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    }
    const out = {
      mx: this.mx, my: this.my, lookX: this.lookX, lookY: this.lookY,
      sprint: this.touch ? this.sprintToggle : this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.crouch, pressed: new Set(this.pressed), held: this.held,
    };
    this.lookX = this.lookY = 0;
    this.pressed.clear();
    return out;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.keys.clear(); this.held.clear(); this.pressed.clear(); this.crouch = false; this.sprintToggle = false; if (document.pointerLockElement) document.exitPointerLock(); }
  }
}
