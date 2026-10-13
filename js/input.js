/* =========================================================
   НИТЬ — ввод
   Используем KeyboardEvent.code, поэтому управление работает
   и на русской раскладке (клавиша E = «У»).
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;

  // Действие → физические клавиши
  const KEYS = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'ArrowUp', 'KeyW'],
    interact: ['KeyE'],
    release: ['Space'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter', 'NumpadEnter', 'Space'],
    back: ['Escape', 'Backspace'],
    erase: ['Delete'],
  };

  // Действие → кнопки стандартного геймпада
  const PAD = {
    jump: [0],
    release: [0],
    interact: [2],
    pause: [9],
    confirm: [0],
    back: [1],
    erase: [3],
  };

  // Клавиши, которые не должны прокручивать страницу
  const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);

  class Input {
    constructor() {
      this.held = new Set();
      this.hit = new Set(); // нажаты с момента последнего consume()
      this.lift = new Set(); // отпущены с момента последнего consume()
      this.pad = {};
      this.padHit = {};
      this.lastDevice = 'keyboard';

      window.addEventListener('keydown', (e) => {
        if (BLOCK.has(e.code)) e.preventDefault();
        if (!e.repeat) this.hit.add(e.code);
        this.held.add(e.code);
        this.lastDevice = 'keyboard';
      });
      window.addEventListener('keyup', (e) => {
        this.held.delete(e.code);
        this.lift.add(e.code);
      });
      // Если окно потеряло фокус — «отпускаем» все клавиши
      window.addEventListener('blur', () => this.held.clear());
    }

    pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) {
        if (p && p.connected) {
          gp = p;
          break;
        }
      }
      const now = {};
      if (gp) {
        const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        const ax = gp.axes[0] || 0;
        const ay = gp.axes[1] || 0;
        now.left = ax < -0.4 || b(14);
        now.right = ax > 0.4 || b(15);
        now.up = ay < -0.5 || b(12);
        now.down = ay > 0.5 || b(13);
        for (const action in PAD) now[action] = PAD[action].some(b);
        now.jump = now.jump || now.up;
        if (Object.values(now).some(Boolean)) this.lastDevice = 'gamepad';
      }
      for (const k in now) {
        if (now[k] && !this.pad[k]) this.padHit[k] = true;
      }
      this.pad = now;
    }

    down(action) {
      const keys = KEYS[action];
      if (keys) for (const c of keys) if (this.held.has(c)) return true;
      return !!this.pad[action];
    }

    pressed(action) {
      const keys = KEYS[action];
      if (keys) for (const c of keys) if (this.hit.has(c)) return true;
      return !!this.padHit[action];
    }

    anyPressed() {
      return this.hit.size > 0 || Object.keys(this.padHit).length > 0;
    }

    // Вызывается после первого шага симуляции в кадре
    consume() {
      this.hit.clear();
      this.lift.clear();
      this.padHit = {};
    }
  }

  NIT.Input = Input;
})();
