/* =========================================================
   НИТЬ — объекты мира
   Здесь только логика. Как всё это рисуется — в render.js.
   Поле home — исходная координата X: по ней мир решает,
   что сбрасывать при возрождении на контрольной точке.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;
  const audio = () => NIT.audio;

  /* ---------- Ящик: толкать, тянуть, вставать на него ---------- */
  class Box {
    constructor(d) {
      this.type = 'box';
      this.id = d.id;
      this.w = d.w || 44;
      this.h = d.h || 44;
      this.home = d.x;
      this.y0 = d.y - this.h; // в JSON y — уровень земли под ящиком
      this.solid = true;
      this.pushable = true;
      this.reset();
    }

    reset() {
      this.x = this.home;
      this.y = this.y0;
      this.vy = 0;
      this.onGround = true;
      this.lastX = this.x;
      this.scrapeAcc = 0;
    }

    update(dt, world) {
      this.vy = Math.min(this.vy + 1900 * dt, 900);
      const was = this.onGround;
      const vy = this.vy;
      world.moveBodyY(this, this.vy * dt);
      if (!was && this.onGround && vy > 250) {
        audio().land(vy * 0.8);
        world.dust(this.x + this.w / 2, this.y + this.h, 8);
      }
      const moved = Math.abs(this.x - this.lastX);
      this.lastX = this.x;
      if (this.onGround && moved > 0.05) {
        this.scrapeAcc += moved;
        if (this.scrapeAcc > 15) {
          this.scrapeAcc = 0;
          audio().scrape();
        }
      }
    }
  }

  /* ---------- Бревно: плывёт по течению, к нему можно привязать нить ---------- */
  class Log {
    constructor(d) {
      this.type = 'log';
      this.id = d.id;
      this.w = d.w || 130;
      this.h = d.h || 20;
      this.home = d.x;
      this.solid = true;
      this.tieable = true;
      this.tieRange = d.tieRange || 420;
      this.reeds = !!d.reeds; // на плавучем островке с камышом можно спрятаться
      this.water = null;
      this.y = 0;
      this.reset();
    }

    bind(world) {
      const mid = this.home + this.w / 2;
      this.water = world.waters.find((w) => mid > w.x && mid < w.x + w.w) || null;
      this.reset();
    }

    reset() {
      this.x = this.home;
      this.vx = 0;
      if (this.water) this.y = this.water.y - this.h / 2;
      this.bob = 0;
    }

    update(dt, world) {
      if (this.water) this.y = this.water.y - this.h / 2; // уровень воды может меняться
      // Пока бревно привязано, нить удерживает его на месте
      const held = world.player.tie === this;
      const current = this.water && !held ? this.water.current || 0 : 0;
      this.vx = U.damp(this.vx, current, held ? 6 : 1.3, dt);
      const want = this.vx * dt;
      const moved = world.moveBodyX(this, want);
      if (Math.abs(moved) < Math.abs(want) * 0.5) this.vx *= 0.5;
      // Везём героя, если он стоит на бревне
      const p = world.player;
      if (moved && p.ground === this) world.movePlayerX(p, moved);
      this.bob = Math.sin(world.time * 1.7 + this.home) * 1.4;
    }
  }

  /* ---------- Капкан ---------- */
  class Trap {
    constructor(d) {
      this.type = 'trap';
      this.id = d.id;
      this.x = d.x;
      this.y = d.y;
      this.home = d.x;
      this.w = 30;
      this.h = 10;
      this.reset();
    }

    reset() {
      this.state = 'open';
      this.t = 0;
    }

    zone() {
      return { x: this.x + 4, y: this.y - 12, w: this.w - 8, h: 14 };
    }

    update(dt, world) {
      this.t += dt;
      if (this.state !== 'open') return;
      const z = this.zone();
      const p = world.player;
      if (p.alive && U.overlap(p, z)) {
        this.spring(world);
        world.killPlayer('trap');
        return;
      }
      // Ящик тоже захлопывает капкан — так его можно обезвредить
      for (const e of world.entities) {
        if (e.type === 'box' && U.overlap(e, z)) {
          this.spring(world);
          return;
        }
      }
    }

    spring(world) {
      this.state = 'sprung';
      this.t = 0;
      audio().snap();
      world.shake(5);
      world.dust(this.x + this.w / 2, this.y, 6);
    }
  }

  /* ---------- Падающее дерево ---------- */
  class FallingTree {
    constructor(d) {
      this.type = 'tree';
      this.id = d.id;
      this.x = d.x; // основание ствола
      this.y = d.y; // уровень земли
      this.home = d.x;
      this.height = d.height || 230;
      this.dir = d.dir < 0 ? -1 : 1;
      this.triggerX = d.trigger;
      this.creakT = d.creak !== undefined ? d.creak : 0.45;
      this.fallT = d.fall !== undefined ? d.fall : 0.65;
      this.thick = d.thick || 22;
      this.lean = 0.05 * this.dir;
      // Лежачий ствол становится препятствием-платформой
      this.col =
        this.dir < 0
          ? { x: this.x - this.height, y: this.y - this.thick, w: this.height - 4, h: this.thick }
          : { x: this.x + 4, y: this.y - this.thick, w: this.height - 4, h: this.thick };
      this.reset();
    }

    reset() {
      this.state = 'standing';
      this.t = 0;
      this.angle = this.lean;
      this.startAngle = this.lean;
    }

    resolve() {
      this.state = 'fallen';
      this.angle = (this.dir * Math.PI) / 2;
    }

    collider() {
      return this.state === 'fallen' ? this.col : null;
    }

    tip() {
      return {
        x: this.x + Math.sin(this.angle) * this.height,
        y: this.y - Math.cos(this.angle) * this.height,
      };
    }

    hits(p) {
      const tip = this.tip();
      const N = 18;
      for (let i = 2; i <= N; i++) {
        const t = i / N;
        const x = U.lerp(this.x, tip.x, t);
        const y = U.lerp(this.y - 6, tip.y, t);
        const r = U.lerp(this.thick * 0.5, 4, t);
        if (U.circleRect(x, y, r, p)) return true;
      }
      return false;
    }

    update(dt, world) {
      const p = world.player;
      if (this.state === 'standing') {
        this.angle = this.lean + Math.sin(world.time * 0.8 + this.x * 0.01) * 0.004;
        if (p.alive && p.cx >= this.triggerX && p.cx < this.triggerX + 500) {
          this.state = 'creaking';
          this.t = 0;
          audio().creak(this.creakT + this.fallT * 0.7);
        }
        return;
      }
      if (this.state === 'creaking') {
        this.t += dt;
        const k = Math.min(1, this.t / this.creakT);
        this.angle = this.lean + Math.sin(this.t * 38) * 0.014 * k + this.dir * 0.03 * k;
        if (this.t >= this.creakT) {
          this.state = 'falling';
          this.t = 0;
          this.startAngle = this.angle;
        }
        return;
      }
      if (this.state === 'falling') {
        this.t += dt;
        const k = Math.min(1, this.t / this.fallT);
        this.angle = U.lerp(this.startAngle, (this.dir * Math.PI) / 2, k * k);
        if (p.alive && Math.abs(this.angle) > 0.3 && this.hits(p)) world.killPlayer('crush');
        if (k >= 1) {
          this.state = 'fallen';
          audio().crash();
          world.shake(11);
          for (let i = 0; i < 6; i++) {
            world.dust(this.x + this.dir * this.height * (0.15 + i * 0.15), this.y, 5);
          }
          if (p.alive && U.overlap(p, this.col)) world.killPlayer('crush');
        }
      }
    }
  }

  /* ---------- Ветка, за которую цепляется нить ---------- */
  class Hook {
    constructor(d) {
      this.type = 'hook';
      this.id = d.id;
      this.x = d.x;
      this.y = d.y;
      this.home = d.x;
      this.auto = !!d.auto; // «умная» ветка: нить цепляется и отпускает сама
      this.range = d.range || 230;
      this.releaseAngle = ((d.releaseAngle !== undefined ? d.releaseAngle : 26) * Math.PI) / 180;
      this.trunkX = d.trunkX;
      this.branchY = d.branchY;
      // Удобная длина нити: если зацепился издалека, нить подтянет героя
      this.ropeLength = d.ropeLength || 0;
      this.cooldown = 0;
    }

    reset() {
      this.cooldown = 0;
    }

    update(dt) {
      if (this.cooldown > 0) this.cooldown -= dt;
    }
  }

  /* ---------- Ребёнок без нити ---------- */
  class Ghost {
    constructor(d) {
      this.type = 'ghost';
      this.id = d.id;
      this.x = d.x;
      this.y = d.y;
      this.home = d.x;
      this.radius = d.radius || 150;
      this.reset();
    }

    reset() {
      this.state = 'idle';
      this.t = 0;
      this.alpha = 1;
    }

    resolve() {
      this.state = 'gone';
      this.alpha = 0;
    }

    update(dt, world) {
      this.t += dt;
      const p = world.player;
      if (this.state === 'idle' && p.alive && Math.abs(p.cx - this.x) < this.radius) {
        this.state = 'fading';
        this.t = 0;
        audio().ghost();
        world.thread.pull(0.8);
      }
      if (this.state === 'fading') {
        this.alpha = Math.max(0, 1 - this.t / 1.8);
        if (Math.random() < dt * 45) {
          world.particles.push({
            x: this.x + U.rand(-7, 7),
            y: this.y - U.rand(4, 34),
            vx: U.rand(4, 22),
            vy: U.rand(-34, -10),
            g: -6,
            life: U.rand(1.2, 2.2),
            t: 0,
            size: U.rand(1, 2.4),
            kind: 'ash',
          });
        }
        if (this.t >= 1.8) this.state = 'gone';
      }
    }
  }

  /* ---------- Существо на тонких ногах (фоновый слой) ---------- */
  class Creature {
    constructor(d) {
      this.type = 'creature';
      this.id = d.id;
      this.factor = d.layer || 0.6; // коэффициент параллакса
      this.speed = d.speed || 70;
      this.groundY = d.groundY || 520;
      this.reset();
    }

    reset() {
      this.active = false;
      this.t = 0;
      this.legs = [];
    }

    activate(world) {
      this.active = true;
      this.t = 0;
      this.lx = world.camera.x * this.factor + 960 + 150; // сразу за правым краем кадра
      this.ly = 30;
      const homes = [-175, -100, -25, 55, 130, 200];
      this.legs = homes.map((h, i) => ({
        home: h,
        fx: this.lx + h + (i % 2 ? 45 : -35),
        fy: this.groundY,
        lift: 0,
        lifting: false,
        sx: 0,
        tx: 0,
        side: i % 2 ? 1 : -1,
        knee: 70 + ((i * 37) % 60),
      }));
      audio().thud(0.6);
    }

    update(dt, world) {
      if (!this.active) return;
      this.t += dt;
      this.lx -= this.speed * dt;
      this.ly = 30 + Math.sin(this.t * 1.3) * 7;
      let lifting = this.legs.filter((l) => l.lifting).length;
      for (const l of this.legs) {
        if (l.lifting) {
          l.lift = Math.min(1, l.lift + dt / 0.7);
          l.fx = U.lerp(l.sx, l.tx, U.easeInOutSine(l.lift));
          l.fy = this.groundY - Math.sin(l.lift * Math.PI) * 70;
          if (l.lift >= 1) {
            l.lifting = false;
            l.fy = this.groundY;
            audio().thud(0.35);
          }
        } else if (lifting < 2 && l.fx - (this.lx + l.home) > 70) {
          l.lifting = true;
          l.lift = 0;
          l.sx = l.fx;
          l.tx = this.lx + l.home - 80;
          lifting++;
        }
      }
      if (this.lx - world.camera.x * this.factor < -700) this.active = false;
    }
  }

  /* ---------- Кочка: тонет под весом героя и всплывает, когда он уходит ---------- */
  class Hummock {
    constructor(d) {
      this.type = 'hummock';
      this.id = d.id;
      this.home = d.x;
      this.x = d.x;
      this.y0 = d.y; // верхняя кромка
      this.w = d.w || 56;
      this.h = d.h || 16;
      this.solid = true;
      this.reeds = !!d.reeds; // в камыше на кочке можно спрятаться
      this.sinkRate = d.sink !== undefined ? d.sink : 24;
      this.riseRate = d.rise || 14;
      this.max = d.max || 46;
      this.reset();
    }

    reset() {
      this.off = 0;
      this.y = this.y0;
      this.load = 0;
    }

    update(dt, world) {
      const p = world.player;
      const on = p.alive && p.ground === this;
      this.load = on ? this.load + dt : 0;
      if (on && this.load > 0.12 && this.sinkRate > 0) {
        if (this.off === 0) audio().squelch(0.5);
        this.off = Math.min(this.max, this.off + this.sinkRate * dt);
      } else if (!on) {
        this.off = Math.max(0, this.off - this.riseRate * dt);
      }
      const bob = this.sinkRate > 0 ? Math.sin(world.time * 1.4 + this.home) * 0.8 : 0;
      const ny = this.y0 + this.off + bob;
      const dy = ny - this.y;
      this.y = ny;
      if (on) p.y += dy; // герой опускается вместе с кочкой
    }
  }

  /* ---------- Наблюдатель: существо из тумана, которое ищет героя светом ---------- */
  class Watcher {
    constructor(d) {
      this.type = 'watcher';
      this.id = d.id;
      this.trigger = d.trigger;
      this.home = d.trigger;
      this.until = d.until;
      this.x1 = d.zone[0];
      this.x2 = d.zone[1];
      this.startX = d.start !== undefined ? d.start : (this.x1 + this.x2) / 2;
      this.speed = d.speed || 50;
      this.walkT = d.walk || 3;
      this.warnT = d.warn || 1.3;
      this.scanT = d.scan || 2.6;
      this.coolT = d.cool || 0.6;
      this.halfW = d.halfWidth || 70;
      this.sweep = d.sweep || 150;
      this.reset();
    }

    reset() {
      this.state = 'off'; // off → walk → warn → scan → cool → walk … → leave → gone
      this.t = 0;
      this.alpha = 0;
      this.light = 0;
      this.lightX = this.startX;
      this.bodyX = this.startX;
      this.scanBase = this.startX;
      this.target = this.x1;
      this.legPhase = 0;
      this.stepT = 0;
    }

    get active() {
      return this.state !== 'off' && this.state !== 'gone';
    }

    // Насколько тревожно: от этого ускоряется пульс нити
    get alarm() {
      return this.state === 'warn' ? 0.6 : this.state === 'scan' ? 1 : 0;
    }

    // Загрузка сохранения дальше точки появления
    resolve(world, cpX) {
      if (cpX !== undefined && cpX >= this.until) {
        this.state = 'gone';
        return;
      }
      this.state = 'walk';
      this.t = 0;
      this.alpha = 1;
    }

    // После возрождения героя — передышка
    calm() {
      if (this.active && this.state !== 'leave') {
        this.state = 'walk';
        this.t = 0;
        this.light = 0;
        this.lightX = this.bodyX;
      }
    }

    update(dt, world) {
      const p = world.player;
      if (this.state === 'off') {
        if (p.alive && p.cx >= this.trigger && p.cx < this.until) {
          this.state = 'walk';
          this.t = 0;
          audio().thud(0.8);
        }
        return;
      }
      if (this.state === 'gone') return;
      if (this.state !== 'leave' && p.alive && p.cx >= this.until) {
        this.state = 'leave';
        this.t = 0;
      }
      this.t += dt;
      this.alpha = U.approach(this.alpha, this.state === 'leave' ? 0 : 1, dt * 0.7);
      switch (this.state) {
        case 'walk': {
          const dir = Math.sign(this.target - this.lightX);
          this.lightX += dir * this.speed * dt;
          if (Math.abs(this.target - this.lightX) < 3) this.target = this.target === this.x1 ? this.x2 : this.x1;
          this.legPhase += dt * this.speed * 0.012;
          this.stepT -= dt;
          if (this.stepT <= 0) {
            this.stepT = 1.1;
            audio().thud(0.3);
          }
          this.light = U.approach(this.light, 0, dt * 2);
          this.bodyX = this.lightX;
          if (this.t >= this.walkT) {
            this.state = 'warn';
            this.t = 0;
            audio().watchWarn();
          }
          break;
        }
        case 'warn':
          this.light = Math.min(0.35, this.light + dt * 0.4);
          if (this.t >= this.warnT) {
            this.state = 'scan';
            this.t = 0;
            this.scanBase = this.lightX;
            audio().scanHum(this.scanT);
          }
          break;
        case 'scan':
          this.light = U.approach(this.light, 1, dt * 5);
          this.lightX = this.scanBase + Math.sin((this.t / this.scanT) * Math.PI * 2) * this.sweep;
          if (p.alive && this.light > 0.6 && Math.abs(p.cx - this.lightX) < this.halfW && !world.isHidden(p)) {
            world.killPlayer('seen');
          }
          if (this.t >= this.scanT) {
            this.state = 'cool';
            this.t = 0;
            this.lightX = this.scanBase;
          }
          break;
        case 'cool':
          this.light = U.approach(this.light, 0, dt * 2.5);
          if (this.t >= this.coolT) {
            this.state = 'walk';
            this.t = 0;
          }
          break;
        case 'leave':
          this.light = U.approach(this.light, 0, dt * 2);
          this.lightX += Math.sign(this.target - this.lightX || 1) * this.speed * dt;
          this.bodyX = this.lightX;
          this.legPhase += dt * this.speed * 0.012;
          if (this.alpha <= 0) this.state = 'gone';
          break;
      }
    }
  }

  /* ---------- Пресс: бьёт сверху в своём ритме ---------- */
  class Piston {
    constructor(d) {
      this.type = 'piston';
      this.id = d.id;
      this.home = d.x;
      this.x = d.x;
      this.w = d.w || 64;
      this.top = d.top; // нижняя кромка потолка
      this.up = d.up; // низ головы в верхнем положении
      this.down = d.down; // низ головы в нижнем положении
      this.headH = d.headH || 26;
      this.period = d.period || 2.6;
      this.offset = d.offset || 0;
      this.warnT = 0.35;
      this.slamT = 0.12;
      this.holdT = 0.45;
      this.riseT = 0.7;
      this.col = { x: this.x, y: this.top, w: this.w, h: 0 };
      this.reset();
    }

    get waitT() {
      return Math.max(0.2, this.period - this.warnT - this.slamT - this.holdT - this.riseT);
    }

    reset() {
      this.t = this.offset;
      this.bottom = this.up;
      this.phase = 'wait';
    }

    head() {
      return { x: this.x, y: this.bottom - this.headH, w: this.w, h: this.headH };
    }

    collider() {
      this.col.h = this.bottom - this.top;
      return this.col;
    }

    // Сколько секунд до следующего удара
    timeToSlam() {
      const cyc = this.t % this.period;
      const s = this.waitT + this.warnT;
      return cyc < s ? s - cyc : this.period - cyc + s;
    }

    update(dt, world) {
      this.t += dt;
      const cyc = this.t % this.period;
      const a = this.waitT;
      const b = a + this.warnT;
      const c = b + this.slamT;
      const d = c + this.holdT;
      let phase;
      if (cyc < a) {
        phase = 'wait';
        this.bottom = this.up;
      } else if (cyc < b) {
        phase = 'warn'; // шипит и дрожит перед ударом
        this.bottom = this.up + 2 + Math.sin(cyc * 70) * 1.2;
      } else if (cyc < c) {
        phase = 'slam';
        const k = (cyc - b) / this.slamT;
        this.bottom = U.lerp(this.up + 2, this.down, k * k);
      } else if (cyc < d) {
        phase = 'hold';
        this.bottom = this.down;
      } else {
        phase = 'rise';
        this.bottom = U.lerp(this.down, this.up, U.easeInOutSine((cyc - d) / this.riseT));
      }
      if (phase !== this.phase) {
        const near = Math.abs(this.x - world.player.cx) < 700;
        if (phase === 'warn' && near) {
          audio().hiss();
          world.puff(this.x + this.w / 2, this.top + 4);
        }
        if (phase === 'hold' && near) {
          audio().slam();
          world.shake(4);
          world.dust(this.x + this.w / 2, this.down, 8);
        }
        this.phase = phase;
      }
      const p = world.player;
      if (p.alive && (phase === 'slam' || phase === 'hold') && U.overlap(p, this.head())) world.killPlayer('crush');
    }
  }

  /* ---------- Рычаг: до него не дотянуться, но нить может его потянуть ---------- */
  class Lever {
    constructor(d) {
      this.type = 'lever';
      this.id = d.id;
      this.home = d.x;
      this.baseY = d.y;
      this.x = d.x - 12;
      this.y = d.y - 40;
      this.w = 24;
      this.h = 40;
      this.tieable = true;
      this.fixed = true; // сам не едет: нить упирается, а рычаг поддаётся
      this.tieRange = d.tieRange || 320;
      this.targets = d.targets || [];
      this.reset();
    }

    reset() {
      this.on = false;
      this.angle = 0.5;
      this.strain = 0;
    }

    resolve(world) {
      this.on = true;
      this.angle = -0.6;
      for (const id of this.targets) world.activate(id, true);
    }

    pinPoint() {
      return { x: this.home + Math.sin(this.angle) * 30, y: this.baseY - 8 - Math.cos(this.angle) * 30 };
    }

    pull(world, dt) {
      if (this.on) return;
      this.strain += dt * 2;
      if (this.strain > 0.6) {
        this.on = true;
        audio().clank(1);
        world.shake(2);
        world.untie(true);
        for (const id of this.targets) world.activate(id, false);
      }
    }

    update(dt) {
      this.strain = Math.max(0, this.strain - dt);
      const target = this.on ? -0.6 : 0.5 - Math.min(1, this.strain / 0.6) * 0.6;
      this.angle = U.approach(this.angle, target, dt * 4);
    }
  }

  /* ---------- Решётка: поднимается, когда дёрнули её рычаг ---------- */
  class Door {
    constructor(d) {
      this.type = 'door';
      this.id = d.id;
      this.home = d.x;
      this.x = d.x;
      this.y0 = d.y;
      this.w = d.w || 24;
      this.h = d.h;
      this.col = { x: this.x, y: this.y0, w: this.w, h: this.h };
      this.reset();
    }

    reset() {
      this.open = 0;
      this.opening = false;
      this.y = this.y0;
    }

    resolve() {
      this.open = 1;
      this.opening = false;
      this.y = this.y0 - this.h;
    }

    activate(world, instant) {
      if (instant) return this.resolve();
      if (this.open > 0 || this.opening) return;
      this.opening = true;
      audio().grind(1.5);
      world.shake(2);
    }

    collider() {
      if (this.open >= 1) return null;
      this.col.y = this.y;
      return this.col;
    }

    update(dt) {
      if (!this.opening) return;
      this.open = Math.min(1, this.open + dt / 1.5);
      this.y = this.y0 - this.h * U.easeInOutSine(this.open);
      if (this.open >= 1) this.opening = false;
    }
  }

  /* ---------- Платформа на цепях: везёт, пока на ней стоят, потом возвращается ---------- */
  class Mover {
    constructor(d) {
      this.type = 'mover';
      this.id = d.id;
      this.path = d.path; // [[x, y], [x, y]]: левый верхний угол в начале и в конце пути
      this.home = d.path[0][0];
      this.w = d.w || 90;
      this.h = d.h || 14;
      this.speed = d.speed || 70;
      this.returnDelay = d.returnDelay !== undefined ? d.returnDelay : 0.9;
      this.solid = true;
      this.reset();
    }

    reset() {
      this.x = this.path[0][0];
      this.y = this.path[0][1];
      this.idle = 0;
      this.moving = false;
    }

    update(dt, world) {
      const p = world.player;
      const riding = p.alive && p.ground === this;
      this.idle = riding ? 0 : this.idle + dt;
      const goal = riding ? this.path[1] : this.idle > this.returnDelay ? this.path[0] : null;
      const dx = goal ? goal[0] - this.x : 0;
      const dy = goal ? goal[1] - this.y : 0;
      const d = Math.hypot(dx, dy);
      if (!goal || d < 0.01) {
        this.moving = false;
        return;
      }
      if (!this.moving) audio().clank(0.4);
      this.moving = true;
      const step = Math.min(d, this.speed * dt);
      const mx = (dx / d) * step;
      const my = (dy / d) * step;
      this.x += mx;
      this.y += my;
      if (riding) {
        if (mx) world.movePlayerX(p, mx);
        p.y += my;
      } else if (p.alive && U.overlap(p, this)) {
        if (my < 0 && p.bottom - this.y < 18) {
          p.y = this.y - p.h;
          p.vy = Math.min(p.vy, 0);
        } else if (mx) world.movePlayerX(p, mx);
      }
    }
  }

  const TYPES = {
    box: Box,
    log: Log,
    trap: Trap,
    tree: FallingTree,
    hook: Hook,
    ghost: Ghost,
    creature: Creature,
    hummock: Hummock,
    watcher: Watcher,
    piston: Piston,
    lever: Lever,
    door: Door,
    mover: Mover,
  };

  NIT.createEntity = function (d) {
    const C = TYPES[d.type];
    if (!C) {
      console.warn('[Нить] Неизвестный тип объекта в уровне:', d.type);
      return null;
    }
    return new C(d);
  };
})();
