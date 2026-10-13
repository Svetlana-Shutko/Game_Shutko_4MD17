/* =========================================================
   НИТЬ — общие утилиты
   Все модули игры живут в одном глобальном объекте window.NIT,
   поэтому игра запускается даже двойным кликом по index.html
   (без сервера и без ES-модулей).
   ========================================================= */
(function () {
  'use strict';
  const NIT = (window.NIT = window.NIT || {});

  const pad2 = (n) => String(n).padStart(2, '0');

  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,

    // Плавное приближение к цели, не зависящее от частоты кадров
    damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),

    // Линейное приближение значения к цели с ограниченным шагом
    approach: (v, target, delta) =>
      v < target ? Math.min(v + delta, target) : Math.max(v - delta, target),

    smoothstep(a, b, x) {
      const t = U.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    },
    easeInQuad: (t) => t * t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

    rand: (a, b) => a + Math.random() * (b - a),

    // Детерминированный генератор: лес выглядит одинаково при каждом запуске
    rng(seed) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    // Пересечение двух прямоугольников {x, y, w, h}
    overlap: (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,

    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),

    // Пересечение круга и прямоугольника
    circleRect(cx, cy, r, rect) {
      const nx = U.clamp(cx, rect.x, rect.x + rect.w);
      const ny = U.clamp(cy, rect.y, rect.y + rect.h);
      const dx = cx - nx;
      const dy = cy - ny;
      return dx * dx + dy * dy < r * r;
    },

    formatTime(sec) {
      const s = Math.max(0, Math.floor(sec));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${m}:${pad2(ss)}`;
    },

    formatDate(ts) {
      const d = new Date(ts);
      return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    },

    // Склонение: plural(3, ['смерть', 'смерти', 'смертей'])
    plural(n, forms) {
      const a = Math.abs(n) % 100;
      const b = a % 10;
      if (a > 10 && a < 20) return forms[2];
      if (b > 1 && b < 5) return forms[1];
      if (b === 1) return forms[0];
      return forms[2];
    },
  };

  NIT.U = U;
})();
