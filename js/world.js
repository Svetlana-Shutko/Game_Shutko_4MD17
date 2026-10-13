/* =========================================================
   НИТЬ — мир
   Связывает уровень, героя, объекты и нить. Не рисует ничего:
   отрисовка целиком в render.js, поэтому логику легко тестировать.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;
  const VIEW_W = 960;

  /* ---------- Камера ---------- */
  class Camera {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.look = 0;
      this.shakeAmt = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    targetX(p, level) {
      return U.clamp(p.cx - VIEW_W * 0.42 + this.look, 0, level.width - VIEW_W);
    }

    targetY(p) {
      return U.clamp(p.bottom - 430, -170, 40);
    }

    snap(p, level) {
      this.look = 0;
      this.x = this.targetX(p, level);
      this.y = this.targetY(p);
    }

    update(dt, p, level, shakeOn, drift) {
      const following = !(p.state === 'dead' && p.deathType === 'fall');
      if (following) {
        this.look = U.damp(this.look, p.facing * 60 + p.vx * 0.2, 1.5, dt);
        this.x = U.damp(this.x, this.targetX(p, level) + drift, 4, dt);
        this.y = U.damp(this.y, this.targetY(p), 2.6, dt);
      }
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 18);
      const s = shakeOn ? this.shakeAmt : 0;
      this.shakeX = (Math.random() * 2 - 1) * s;
      this.shakeY = (Math.random() * 2 - 1) * s;
    }
  }

  /* ---------- Мир ---------- */
  class World {
    constructor(level, hooks) {
      this.level = level;
      this.hooks = hooks || {};
      this.settings = { shake: true };
      this.killY = level.killY || 800;
      this.solids = level.solids.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, style: s.style || 'ground' }));
      this.waters = (level.water || []).map((w) => Object.assign({}, w, { y0: w.y }));
      this.checkpoints = level.checkpoints.slice();
      this.entities = (level.entities || []).map(NIT.createEntity).filter(Boolean);
      this.entities.forEach((e) => e.bind && e.bind(this));
      this.hookList = this.entities.filter((e) => e.type === 'hook');
      this.creature = this.entities.find((e) => e.type === 'creature') || null;
      this.triggers = (level.triggers || []).map((t) => Object.assign({}, t, { done: false }));

      // Трясина, камыш и наблюдатели (глава II)
      const BOG = { sinkStill: 20, sinkMove: 10, speedMul: 0.55, jumpMul: 0.9, deep: false };
      this.bogs = (level.bogs || []).map((b) => Object.assign({}, BOG, b));
      // Невидимое «дно» под трясиной, чтобы ничто не провалилось сквозь мир
      for (const b of this.bogs) this.solids.push({ x: b.x, y: b.y + 60, w: b.w, h: 300, style: 'hidden' });
      // Нить ложится на поверхность трясины, а не тонет в ней
      this.ropeSolids = this.solids
        .filter((s) => s.style !== 'hidden')
        .concat(this.bogs.map((b) => ({ x: b.x, y: b.y + 1, w: b.w, h: 40 })));
      this.reeds = (level.reeds || []).map((r) =>
        Object.assign({ h: 46 }, r, { y: r.y !== undefined ? r.y : this.groundTopAt(r.x + r.w / 2) })
      );
      this.watchers = this.entities.filter((e) => e.type === 'watcher');
      this.alarm = 0;
      this.pulse = 0;

      this.player = new NIT.Player();
      this.camera = new Camera();
      this.thread = new NIT.Thread();
      this.particles = [];
      this.time = 0;
      this.mode = 'title'; // title | play
      this.cpIndex = 0;
      this.deaths = 0;
      this.respawnT = -1;
      this.fade = 0; // чёрная шторка 0..1
      this.fadeTarget = 0;
      this.fadeSpeed = 1.6;
      this.fog = 0; // дополнительный туман от событий
      this.fogTarget = 0;
      this.whiteout = 0;
      this.whiteTarget = 0;
      this.ending = null;
      this.glyph = null;
      this.leafT = 0;
    }

    /* ---------- старт / загрузка ---------- */

    startAt(index, opts) {
      const o = opts || {};
      index = U.clamp(index | 0, 0, this.checkpoints.length - 1);
      this.cpIndex = index;
      const cp = this.checkpoints[index];

      this.entities.forEach((e) => e.reset && e.reset());
      this.triggers.forEach((t) => (t.done = false));
      this.fog = this.fogTarget = 0;
      this.whiteout = this.whiteTarget = 0;
      this.ending = null;
      this.respawnT = -1;
      this.fadeTarget = 0; // затемнение после прошлой смерти не должно «залипать»
      this.particles.length = 0;
      NIT.audio.stopBeeps();

      // Всё, что осталось позади точки, «уже случилось»
      for (const w of this.waters) {
        w.y = w.y0;
        w.targetY = undefined;
      }
      for (const e of this.entities) if (e.home !== undefined && e.home < cp.x && e.resolve) e.resolve(this, cp.x);
      for (const t of this.triggers) {
        if (t.x <= cp.x) {
          t.done = true;
          if (t.replay) this.runEvent(t, true);
        }
      }

      this.player.reset(cp.x, cp.y);
      if (o.intro) {
        this.player.state = 'lying';
        this.player.wakeReady = false;
      }
      this.camera.snap(this.player, this.level);
      this.thread.unpin();
      this.thread.ready = false;
    }

    /* ---------- главный цикл ---------- */

    update(dt, input) {
      this.time += dt;
      const p = this.player;

      for (const e of this.entities) e.update(dt, this);
      // Вода уходит после того, как повернули кран
      for (const w of this.waters) if (w.targetY !== undefined) w.y = U.approach(w.y, w.targetY, (w.drainSpeed || 40) * dt);
      p.update(dt, this.mode === 'play' ? input : null, this);
      this.updateTie(dt);

      if (p.alive) {
        if (p.y > this.killY) this.killPlayer('fall');
        else {
          this.checkWater();
          this.autoHooks();
          this.checkCheckpoints();
          this.checkTriggers();
        }
      }
      if (p.state === 'lying' && this.mode === 'play' && !p.wakeReady && this.fade < 0.35) p.wakeReady = true;

      this.updateGlyph();
      this.updateRespawn(dt);
      this.updateEnding(dt);
      const drift = this.mode === 'title' ? Math.sin(this.time * 0.12) * 26 : 0;
      this.camera.update(dt, p, this.level, this.settings.shake, drift);
      this.updateThread(dt);
      this.updateParticles(dt);
      // Пульс нити учащается, когда рядом ищет свет
      let alarm = 0;
      for (const wt of this.watchers) alarm = Math.max(alarm, wt.alarm);
      this.alarm = U.damp(this.alarm, alarm, 4, dt);
      this.pulse += dt / U.lerp(1.15, 0.55, this.alarm);
      this.fog = U.damp(this.fog, this.fogTarget, 0.7, dt);
      this.whiteout = U.damp(this.whiteout, this.whiteTarget, 0.8, dt);
      this.fade = U.approach(this.fade, this.fadeTarget, this.fadeSpeed * dt);
    }

    /* ---------- коллизии ---------- */

    colliders(except) {
      const list = this.solids.slice();
      for (const e of this.entities) {
        if (e === except) continue;
        if (e.solid) list.push(e);
        else if (e.collider) {
          const c = e.collider();
          if (c) list.push(c);
        }
      }
      return list;
    }

    moveBodyX(b, dx) {
      if (!dx) return 0;
      const x0 = b.x;
      b.x += dx;
      for (const s of this.colliders(b)) {
        if (!U.overlap(b, s)) continue;
        if (dx > 0) b.x = Math.min(b.x, s.x - b.w);
        else b.x = Math.max(b.x, s.x + s.w);
      }
      return b.x - x0;
    }

    moveBodyY(b, dy) {
      if (!dy) return 0;
      const y0 = b.y;
      b.y += dy;
      b.onGround = false;
      for (const s of this.colliders(b)) {
        if (!U.overlap(b, s)) continue;
        if (dy > 0) {
          b.y = Math.min(b.y, s.y - b.h);
          b.onGround = true;
          b.vy = 0;
        } else {
          b.y = Math.max(b.y, s.y + s.h);
          b.vy = 0;
        }
      }
      return b.y - y0;
    }

    // Горизонталь героя: упираемся в стены, толкаем ящики
    movePlayerX(p, dx) {
      p.pushing = false;
      if (!dx) return;
      p.x += dx;
      for (const s of this.colliders(p)) {
        if (!U.overlap(p, s)) continue;
        if (s.pushable && p.onGround && !p.hook && p.state === 'normal') {
          const pen = dx > 0 ? p.x + p.w - s.x : p.x - (s.x + s.w);
          this.moveBodyX(s, pen);
          p.pushing = true;
          if (!U.overlap(p, s)) continue;
        }
        // Невысокая ступенька (до 6 px): шагаем на неё, а не упираемся
        const rise = p.bottom - s.y;
        if (rise > 0 && rise <= 6 && (p.onGround || p.bog) && !p.hook && p.state === 'normal' && this.freeAt(p, p.x, s.y - p.h)) {
          p.y = s.y - p.h;
          continue;
        }
        if (dx > 0) p.x = s.x - p.w;
        else p.x = s.x + s.w;
        p.vx = 0;
      }
    }

    movePlayerY(p, dy) {
      if (!dy) return;
      p.y += dy;
      p.onGround = false;
      if (dy > 0) p.ground = null;
      for (const s of this.colliders(p)) {
        if (!U.overlap(p, s)) continue;
        if (dy > 0) {
          p.y = s.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.ground = s.type ? s : null;
        } else {
          p.y = s.y + s.h;
          if (p.vy < 0) p.vy = 0;
        }
      }
    }

    /* ---------- взаимодействие (клавиша E) ---------- */

    isAdjacent(p, b) {
      if (!(p.bottom > b.y + 4 && p.y < b.y + b.h)) return false;
      const gapR = b.x - (p.x + p.w);
      const gapL = p.x - (b.x + b.w);
      return (gapR >= -2 && gapR <= 8) || (gapL >= -2 && gapL <= 8);
    }

    findInteractTarget(p) {
      if (p.state !== 'normal' || p.locked) return null;
      for (const e of this.entities) {
        if (e.type === 'box' && p.onGround && this.isAdjacent(p, e)) {
          return { kind: 'box', obj: e, gx: e.x + e.w / 2, gy: e.y - 16, hint: true };
        }
      }
      let best = null;
      let bestD = Infinity;
      for (const h of this.hookList) {
        if (h.cooldown > 0 || h.y > p.y) continue;
        const d = U.dist(p.cx, p.y + 6, h.x, h.y);
        if (d < h.range && d < bestD) {
          best = h;
          bestD = d;
        }
      }
      if (best) return { kind: 'hook', obj: best, gx: best.x, gy: best.y - 20, hint: !best.auto };
      for (const e of this.entities) {
        if (!e.tieable || !p.onGround) continue;
        const ox = e.x + e.w / 2;
        const d = U.dist(p.cx, p.y + 16, ox, e.y + e.h / 2);
        const ahead = (ox - p.cx) * p.facing > 0;
        if (d < (e.tieRange || 420) && ahead) return { kind: 'tie', obj: e, gx: ox, gy: e.y - 22, hint: true };
      }
      return null;
    }

    interact(p) {
      if (p.hook) {
        p.releaseHook(this, true, 0, -120);
        return;
      }
      if (p.tie) {
        this.untie(true);
        return;
      }
      const t = this.findInteractTarget(p);
      if (!t) return;
      if (t.kind === 'box') p.grab = t.obj;
      else if (t.kind === 'hook') p.attachHook(t.obj, this);
      else if (t.kind === 'tie') this.tieTo(t.obj);
    }

    updateGlyph() {
      const p = this.player;
      this.glyph = null;
      if (this.mode === 'play' && p.hook && !p.hook.auto && p.controllable) {
        this.glyph = { x: p.cx, y: p.y - 18, label: 'пробел' };
        return;
      }
      if (this.mode !== 'play' || !p.controllable || p.hook || p.tie || p.grab) return;
      const t = this.findInteractTarget(p);
      if (t && t.hint) this.glyph = { x: t.gx, y: t.gy };
    }

    // Тянем ящик, удерживая E
    dragGrabbed(p, dx) {
      const b = p.grab;
      if (!b || !dx) return;
      const away = (b.x > p.x && dx < 0) || (b.x < p.x && dx > 0);
      if (!away) return;
      const moved = this.moveBodyX(b, dx);
      if (Math.abs(moved - dx) > 0.01) p.x -= dx - moved;
    }

    /* ---------- нить: привязка к предметам ---------- */

    tieTo(obj) {
      const p = this.player;
      p.tie = obj;
      p.tieLen = U.dist(p.handX, p.handY, obj.x + obj.w / 2, obj.y + obj.h / 2) + 4;
      const pt = obj.pinPoint ? obj.pinPoint() : { x: obj.x + obj.w / 2, y: obj.y + 3 };
      this.thread.pinTo(pt.x, pt.y, p.handX, p.handY);
      NIT.audio.thread('tie');
    }

    untie(sound) {
      const p = this.player;
      if (!p.tie) return;
      p.tie = null;
      p.tieTaut = false;
      this.thread.unpin();
      if (sound) NIT.audio.thread('untie');
    }

    updateTie(dt) {
      const p = this.player;
      p.tieTaut = false;
      if (!p.tie) return;
      const o = p.tie;
      if (!p.alive) return this.untie(false);
      if (p.ground === o) return this.untie(true); // встал на предмет — нить отпускает
      const hx = p.handX;
      const hy = p.handY;
      const ox = o.x + o.w / 2;
      const oy = o.y + o.h / 2;
      const ddx = hx - ox;
      const ddy = hy - oy;
      const d = Math.hypot(ddx, ddy);
      if (d > p.tieLen + 260) return this.untie(true);
      // Слабину нить выбирает сама — тянуть можно только к себе
      p.tieLen = Math.max(40, Math.min(p.tieLen, d + 2));
      if (d > p.tieLen) {
        const hdTarget = Math.sqrt(Math.max(0, p.tieLen * p.tieLen - ddy * ddy));
        const need = Math.abs(ddx) - hdTarget;
        if (need > 0) {
          const dir = Math.sign(ddx);
          const moved = o.fixed ? 0 : this.moveBodyX(o, dir * need);
          const rest = need - Math.abs(moved);
          if (rest > 0.01) this.movePlayerX(p, -dir * rest);
          p.tieTaut = true;
          if (o.pull) o.pull(this, dt); // рычаг поддаётся натянутой нити
        }
      }
    }

    // «Умная» ветка ловит героя сама
    autoHooks() {
      const p = this.player;
      if (p.hook || p.onGround || p.state !== 'normal') return;
      for (const h of this.hookList) {
        if (!h.auto || h.cooldown > 0) continue;
        if (p.cx > h.x - 10 || p.vy < -60) continue;
        if (U.dist(p.cx, p.y + 6, h.x, h.y) < h.range) {
          p.attachHook(h, this);
          this.thread.pull(0.5);
          break;
        }
      }
    }

    updateThread(dt) {
      const p = this.player;
      const cam = this.camera;
      const th = this.thread;
      if (p.hook) th.setPinTarget(p.hook.x, p.hook.y);
      else if (p.tie) {
        const pt = p.tie.pinPoint ? p.tie.pinPoint() : { x: p.tie.x + p.tie.w / 2, y: p.tie.y + 3 };
        th.setPinTarget(pt.x, pt.y);
      }
      th.tensionTarget = this.ending ? 1 : p.tieTaut ? 1 : p.hook ? 0.6 : 0;
      const bx = Math.max(cam.x + VIEW_W + 90, p.cx + 420);
      const by = cam.y + (this.ending ? 300 : 120) + Math.sin(this.time * 0.35) * 16;
      th.update(dt, p.handX, p.handY, bx, by, this.time, this.ropeSolids);
    }

    /* ---------- вода, точки, события ---------- */

    waterSurfaceAt(x) {
      for (const w of this.waters) if (x > w.x && x < w.x + w.w) return w.y;
      const b = this.bogAt(x);
      return b ? b.y : null;
    }

    bogAt(x) {
      for (const b of this.bogs) if (x > b.x && x < b.x + b.w) return b;
      return null;
    }

    groundTopAt(x) {
      let best = null;
      for (const s of this.solids) {
        if (s.style === 'trunk' || s.style === 'hidden') continue;
        if (x >= s.x && x <= s.x + s.w && (best === null || s.y < best)) best = s.y;
      }
      return best === null ? 430 : best;
    }

    // Спрятан ли герой от света: в камыше или на кочке с камышом
    isHidden(p) {
      if (p.ground && p.ground.reeds) return true;
      for (const r of this.reeds) {
        if (p.cx > r.x + 4 && p.cx < r.x + r.w - 4 && p.bottom > r.y - 8) return true;
      }
      return false;
    }

    freeAt(p, x, y) {
      const r = { x, y, w: p.w, h: p.h };
      for (const s of this.colliders(p)) if (U.overlap(r, s)) return false;
      return true;
    }

    checkWater() {
      const p = this.player;
      for (const w of this.waters) {
        if (p.cx > w.x && p.cx < w.x + w.w && p.y + p.h * 0.55 > w.y) {
          this.splash(p.cx, w.y);
          this.killPlayer('drown');
          return;
        }
      }
    }

    checkCheckpoints() {
      const p = this.player;
      if (!p.onGround || this.mode !== 'play') return;
      for (let i = this.cpIndex + 1; i < this.checkpoints.length; i++) {
        const cp = this.checkpoints[i];
        if (p.cx >= cp.x && Math.abs(p.bottom - cp.y) < 60) {
          this.cpIndex = i;
          if (this.hooks.onCheckpoint) this.hooks.onCheckpoint(i, cp);
        }
      }
    }

    checkTriggers() {
      if (this.mode !== 'play') return;
      const p = this.player;
      for (const t of this.triggers) {
        if (!t.done && p.cx >= t.x) {
          t.done = true;
          this.runEvent(t, false);
        }
      }
    }

    // silent = true — событие восстанавливается при загрузке сохранения
    runEvent(t, silent) {
      switch (t.event) {
        case 'chapterTitle':
          if (!silent && this.hooks.onChapterTitle) this.hooks.onChapterTitle();
          break;
        case 'beeps':
          NIT.audio.startBeeps(t.level !== undefined ? t.level : 0.3, t.interval || 0.95);
          break;
        case 'fog':
          this.fogTarget = t.value !== undefined ? t.value : 1;
          if (silent) this.fog = this.fogTarget;
          break;
        case 'distantBeep':
          if (!silent) NIT.audio.distantBeep();
          break;
        case 'creature':
          if (!silent && this.creature) this.creature.activate(this);
          break;
        case 'tug':
          if (!silent) {
            this.thread.pull(t.power || 0.6);
            NIT.audio.thread('tug');
          }
          break;
        case 'ending':
          if (!silent) this.startEnding(t);
          break;
        default:
          console.warn('[Нить] Неизвестное событие:', t.event);
      }
    }

    onPlayerRise() {
      this.thread.pull(0.55);
      NIT.audio.thread('tug');
    }

    /* ---------- смерть и возрождение ---------- */

    killPlayer(type) {
      const p = this.player;
      if (!p.alive || this.ending) return;
      if (p.tie) this.untie(false);
      p.die(type);
      this.thread.unpin();
      this.deaths++;
      this.respawnT = 0;
      const A = NIT.audio;
      if (type === 'fall') A.fall();
      else if (type === 'drown') A.splash();
      else if (type === 'bog') {
        A.squelch(1.4);
        this.mud(p.cx, p.bottom);
      } else if (type === 'seen') {
        // Луч нашёл героя: вспышка и долгий ровный писк
        A.flatline();
        this.whiteout = 0.8;
        this.shake(4);
      } else {
        A.death();
        this.shake(type === 'crush' ? 12 : 6);
        this.dust(p.cx, p.bottom, 10);
      }
      if (this.hooks.onDeath) this.hooks.onDeath(type);
    }

    updateRespawn(dt) {
      if (this.respawnT < 0) return;
      this.respawnT += dt;
      const type = this.player.deathType;
      const wait = type === 'fall' ? 0.45 : type === 'drown' || type === 'bog' ? 1.1 : type === 'seen' ? 1.8 : 1.25;
      if (this.respawnT > wait) {
        this.fadeTarget = 1;
        this.fadeSpeed = 2.4;
        if (this.fade >= 1) this.respawn();
      }
    }

    respawn() {
      this.respawnT = -1;
      const cp = this.checkpoints[this.cpIndex];
      // Сбрасываем только то, что впереди точки
      for (const e of this.entities) if (e.home !== undefined && e.home >= cp.x) e.reset();
      for (const w of this.waters) {
        if (w.id && w.x >= cp.x) {
          w.y = w.y0;
          w.targetY = undefined;
        }
      }
      const p = this.player;
      p.reset(cp.x, cp.y);
      p.state = 'rising';
      p.riseDur = 0.55;
      this.camera.snap(p, this.level);
      this.thread.unpin();
      this.thread.ready = false;
      for (const wt of this.watchers) wt.calm();
      this.whiteout = 0;
      this.fadeTarget = 0;
      this.fadeSpeed = 1.8;
    }

    // Пункт меню «Вернуться к точке» — без счёта смерти
    restartFromCheckpoint() {
      if (this.ending) return;
      this.fade = 1;
      this.respawn();
    }

    /* ---------- финал главы ---------- */

    startEnding(opts) {
      if (this.ending) return;
      const p = this.player;
      if (p.hook) p.releaseHook(this, false);
      this.untie(false);
      // white: финал уходит в белый туман (глава I) или в темноту (глава II)
      this.ending = {
        t: 0,
        beeps: false,
        done: false,
        white: !opts || opts.white !== false,
        final: !!(opts && opts.final), // финал всей игры
        wordText: (opts && opts.word) || '',
      };
      p.locked = true;
      p.facing = 1;
      p.vx = 260; // нить рывком тянет вперёд
      p.scripted = { dir: 1, speed: 55 };
      this.thread.pull(1);
      NIT.audio.thread('tug');
      this.shake(3);
    }

    updateEnding(dt) {
      const e = this.ending;
      if (!e) return;
      e.t += dt;
      if (e.final) {
        // Нить тянет к свету, всё заливает белым, звучит одно слово
        if (e.t > 0.9) this.fogTarget = 1.6;
        if (e.t > 1.2 && !e.beeps) {
          e.beeps = true;
          NIT.audio.startBeeps(0.8, 0.75);
        }
        if (e.t > 1.4) this.whiteTarget = 1;
        if (e.t > 4.0 && !e.quiet) {
          e.quiet = true;
          NIT.audio.stopBeeps();
          NIT.audio.finale();
        }
        if (e.t > 4.6 && !e.word) {
          e.word = true;
          if (this.hooks.onWord) this.hooks.onWord(e.wordText);
        }
        if (e.t > 10 && !e.done) {
          e.done = true;
          if (this.hooks.onChapterComplete) this.hooks.onChapterComplete();
        }
        return;
      }
      if (e.t > 0.9) this.fogTarget = e.white ? 1.8 : 1.3;
      if (e.t > 1.2 && !e.beeps) {
        e.beeps = true;
        NIT.audio.startBeeps(1, 0.55);
      }
      if (e.t > 1.6 && e.white) this.whiteTarget = 0.85;
      if (e.t > (e.white ? 4.2 : 3.4)) {
        this.fadeTarget = 1;
        this.fadeSpeed = e.white ? 0.5 : 0.42;
      }
      if (e.t > 6.6 && !e.done) {
        e.done = true;
        NIT.audio.stopBeeps();
        if (this.hooks.onChapterComplete) this.hooks.onChapterComplete();
      }
    }

    /* ---------- частицы ---------- */

    shake(amount) {
      this.camera.shakeAmt = Math.max(this.camera.shakeAmt, amount);
    }

    dust(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.particles.push({
          x: x + U.rand(-10, 10),
          y: y - U.rand(0, 4),
          vx: U.rand(-45, 45),
          vy: U.rand(-60, -10),
          g: 70,
          life: U.rand(0.5, 1.1),
          t: 0,
          size: U.rand(1.5, 3.5),
          kind: 'dust',
        });
      }
    }

    splash(x, y) {
      for (let i = 0; i < 22; i++) {
        this.particles.push({
          x: x + U.rand(-12, 12),
          y: y - 2,
          vx: U.rand(-90, 90),
          vy: U.rand(-280, -90),
          g: 900,
          life: U.rand(0.5, 0.9),
          t: 0,
          size: U.rand(1.2, 2.6),
          kind: 'drop',
        });
      }
    }

    // Включает механизм по id: решётку, платформу или слив воды
    activate(id, instant) {
      for (const e of this.entities) if (e.id === id && e.activate) e.activate(this, instant);
      for (const w of this.waters) {
        if (w.id !== id || w.drainTo === undefined) continue;
        w.targetY = w.drainTo;
        if (instant) w.y = w.drainTo;
        else NIT.audio.gurgle();
      }
    }

    // Пар из-под пресса
    puff(x, y) {
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: x + U.rand(-26, 26),
          y: y + U.rand(0, 6),
          vx: U.rand(-30, 30),
          vy: U.rand(-10, 30),
          g: -40,
          life: U.rand(0.6, 1.1),
          t: 0,
          size: U.rand(3, 6),
          kind: 'steam',
        });
      }
    }

    mud(x, y) {
      for (let i = 0; i < 12; i++) {
        this.particles.push({
          x: x + U.rand(-10, 10),
          y: y - 2,
          vx: U.rand(-60, 60),
          vy: U.rand(-160, -50),
          g: 800,
          life: U.rand(0.4, 0.8),
          t: 0,
          size: U.rand(1.5, 3),
          kind: 'mud',
        });
      }
    }

    updateParticles(dt) {
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const q = ps[i];
        q.t += dt;
        q.vy += (q.g || 0) * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.kind === 'leaf') q.x += Math.sin(q.t * 2 + q.seed) * 14 * dt;
        const popped = q.kind === 'bubble' && q.floor !== null && q.floor !== undefined && q.y < q.floor;
        if (q.t >= q.life || popped) ps.splice(i, 1);
      }
      // Пепел, медленно падающий сверху
      this.leafT -= dt;
      if (this.leafT <= 0) {
        this.leafT = U.rand(0.35, 1.2);
        ps.push({
          x: this.camera.x + U.rand(-60, VIEW_W + 60),
          y: this.camera.y - 10,
          vx: U.rand(-14, 4),
          vy: U.rand(16, 34),
          g: 0,
          life: 18,
          t: 0,
          size: U.rand(1.1, 2.4),
          kind: 'leaf',
          seed: Math.random() * 6,
        });
      }
      if (ps.length > 400) ps.splice(0, ps.length - 400);
    }
  }

  NIT.World = World;
  NIT.Camera = Camera;
})();
