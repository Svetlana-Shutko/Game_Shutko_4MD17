/* =========================================================
   НИТЬ — физика красной нити
   Верлет-интегрирование цепочки точек. Начало нити — запястье
   героя, конец уходит за правый край экрана. Нить может
   зацепиться за ветку или предмет: тогда одна из точек
   «прибивается» к нему (pin).
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;

  class Thread {
    constructor(count = 46) {
      this.n = count;
      this.pts = [];
      for (let i = 0; i < count; i++) this.pts.push({ x: 0, y: 0, px: 0, py: 0 });
      this.ready = false;
      this.tension = 0; // 0 — свободно провисает, 1 — натянута
      this.tensionTarget = 0;
      this.tug = 0; // кратковременный рывок
      this.pin = null; // { i, x, y, fx, fy, t }
      this.lastA = null;
    }

    place(ax, ay, bx, by) {
      const n = this.n;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = U.lerp(ax, bx, t);
        const y = U.lerp(ay, by, t) + Math.sin(t * Math.PI) * 40;
        const p = this.pts[i];
        p.x = p.px = x;
        p.y = p.py = y;
      }
      this.ready = true;
    }

    // Нить «бросается» к цели: точка летит от руки к ней за 0.14 с
    pinTo(tx, ty, fromX, fromY) {
      const n = this.n;
      const last = this.pts[n - 1];
      const d1 = U.dist(fromX, fromY, tx, ty);
      const d2 = U.dist(tx, ty, last.x, last.y);
      const i = U.clamp(Math.round(((n - 1) * d1) / (d1 + d2 * 1.07 + 0.001)), 3, n - 4);
      this.pin = { i, x: tx, y: ty, fx: fromX, fy: fromY, t: 0 };
    }

    setPinTarget(x, y) {
      if (this.pin) {
        this.pin.x = x;
        this.pin.y = y;
      }
    }

    unpin() {
      this.pin = null;
    }

    pull(power) {
      this.tug = Math.max(this.tug, power);
    }

    update(dt, ax, ay, bx, by, time, solids) {
      if (!this.ready) this.place(ax, ay, bx, by);
      // Телепорт (возрождение) — раскладываем нить заново
      if (this.lastA && U.dist(this.lastA.x, this.lastA.y, ax, ay) > 140) this.place(ax, ay, bx, by);
      this.lastA = { x: ax, y: ay };

      this.tension = U.damp(this.tension, Math.max(this.tensionTarget, this.tug), 6, dt);
      this.tug = Math.max(0, this.tug - dt * 0.9);

      const n = this.n;
      const pts = this.pts;
      const pin = this.pin;
      let pinX = 0;
      let pinY = 0;
      if (pin) {
        pin.t = Math.min(1, pin.t + dt / 0.14);
        const e = U.easeOutCubic(pin.t);
        pinX = U.lerp(pin.fx, pin.x, e);
        pinY = U.lerp(pin.fy, pin.y, e);
      }

      // Общая длина: чем сильнее натяжение, тем меньше слабина
      const slack = 1.085 - 0.08 * this.tension;
      let total;
      if (pin) total = U.dist(ax, ay, pinX, pinY) * 1.01 + U.dist(pinX, pinY, bx, by) * slack;
      else total = U.dist(ax, ay, bx, by) * slack;
      const seg = Math.max(2, total / (n - 1));

      // Интегрирование
      const g = 1300 * dt * dt;
      for (let i = 1; i < n - 1; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.975;
        const vy = (p.y - p.py) * 0.975;
        p.px = p.x;
        p.py = p.y;
        p.x += vx + Math.sin(time * 1.6 + i * 0.37) * 0.025;
        p.y += vy + g;
      }

      const pinI = pin ? pin.i : -1;
      const fix = () => {
        pts[0].x = ax;
        pts[0].y = ay;
        pts[n - 1].x = bx;
        pts[n - 1].y = by;
        if (pin) {
          pts[pinI].x = pinX;
          pts[pinI].y = pinY;
        }
      };
      fix();

      // Ограничения длины сегментов
      for (let it = 0; it < 14; it++) {
        for (let i = 0; i < n - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          const diff = (d - seg) / d;
          const f1 = i === 0 || i === pinI;
          const f2 = i + 1 === n - 1 || i + 1 === pinI;
          if (f1 && f2) continue;
          if (f1) {
            p2.x -= dx * diff;
            p2.y -= dy * diff;
          } else if (f2) {
            p1.x += dx * diff;
            p1.y += dy * diff;
          } else {
            p1.x += dx * diff * 0.5;
            p1.y += dy * diff * 0.5;
            p2.x -= dx * diff * 0.5;
            p2.y -= dy * diff * 0.5;
          }
        }
        // Нить ложится на землю, а не проходит сквозь неё
        if (solids && it % 4 === 3) {
          for (let i = 1; i < n - 1; i++) {
            if (i === pinI) continue;
            const p = pts[i];
            for (const s of solids) {
              if (p.x > s.x && p.x < s.x + s.w && p.y > s.y && p.y < s.y + 50) {
                p.y = s.y - 0.5;
                break;
              }
            }
          }
        }
        fix();
      }
    }
  }

  NIT.Thread = Thread;
})();
