/* =========================================================
   НИТЬ — герой
   Хитбокс 18×42. Координаты x, y — левый верхний угол.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;

  // Все «ощущения» управления настраиваются здесь
  const P = {
    w: 18,
    h: 42,
    run: 175, // скорость бега, px/с
    accel: 1500,
    decel: 2100,
    airAccel: 1050,
    gravity: 1900,
    jumpVel: 560, // высота прыжка ≈ jumpVel² / (2·gravity) ≈ 82 px
    maxFall: 950,
    coyote: 0.1, // можно прыгнуть чуть позже, чем сошёл с края
    buffer: 0.13, // нажатие прыжка чуть раньше приземления тоже засчитывается
    pushSpeed: 88,
    pullSpeed: 72,
    swingPump: 520, // раскачка на нити
    climbSpeed: 95,
    ropeMin: 55,
    ropeMax: 290,
    bogDeath: 34, // на такой глубине трясина затягивает с головой
  };
  NIT.PLAYER = P;

  const NO_INPUT = Object.freeze({
    dir: 0,
    up: false,
    down: false,
    jumpPressed: false,
    jumpHeld: false,
    interactPressed: false,
    interactHeld: false,
    releasePressed: false,
  });

  class Player {
    constructor() {
      this.w = P.w;
      this.h = P.h;
      this.reset(0, 0);
    }

    reset(cx, bottom) {
      this.x = cx - this.w / 2;
      this.y = bottom - this.h;
      this.vx = 0;
      this.vy = 0;
      this.onGround = true;
      this.ground = null;
      this.facing = 1;
      this.state = 'normal'; // lying | rising | normal | dead | drowning
      this.stateT = 0;
      this.riseDur = 1.5;
      this.wakeReady = true;
      this.coyoteT = 0;
      this.bufferT = 0;
      this.jumpCut = true;
      this.hook = null;
      this.ropeLen = 0;
      this.hookAir = false;
      this.tie = null;
      this.tieLen = 0;
      this.tieTaut = false;
      this.grab = null;
      this.pushing = false;
      this.bog = null; // трясина, в которой стоит герой
      this.sink = 0; // насколько глубоко его затянуло
      this.deathType = null;
      this.locked = false;
      this.scripted = null; // { dir, speed } — движение в катсцене
      this.anim = { phase: 0, run: 0, air: 0, land: 0, rot: 0, squash: 0, blink: 0, blinkT: 2.5, t: 0 };
    }

    get cx() {
      return this.x + this.w / 2;
    }
    get cy() {
      return this.y + this.h / 2;
    }
    get bottom() {
      return this.y + this.h;
    }
    get alive() {
      return this.state !== 'dead' && this.state !== 'drowning';
    }
    get controllable() {
      return this.state === 'normal' && !this.locked && !this.scripted;
    }

    // Наклон тела: лежит, встаёт, падает замертво
    bodyRot() {
      if (this.state === 'lying') return (-Math.PI / 2) * this.facing;
      if (this.state === 'rising' && this.riseDur >= 1) {
        const k = U.easeInOutSine(U.clamp(this.stateT / this.riseDur, 0, 1));
        return U.lerp(-Math.PI / 2, 0, k) * this.facing;
      }
      return this.anim.rot;
    }

    // Запястье в локальных координатах фигуры (+x — вперёд, 0 — под ногами)
    localHand() {
      const A = this.anim;
      if (this.state === 'lying') return { x: 16, y: -14 };
      if (this.grab || this.pushing) return { x: 12, y: -21 };
      if (this.tieTaut) return { x: 11, y: -24 };
      if (!this.onGround && this.alive) return { x: 9, y: -27 - A.air * -3 };
      const swing = Math.sin(A.phase + Math.PI) * 5 * A.run;
      return { x: 5 + swing, y: -17 - Math.abs(Math.sin(A.phase)) * 1.5 * A.run };
    }

    // Точка на запястье, откуда начинается нить (мировые координаты)
    get handX() {
      if (this.hook) return this.cx + (this.hook.x > this.cx ? 3 : -3);
      const h = this.localHand();
      const r = this.bodyRot();
      return this.cx + h.x * this.facing * Math.cos(r) - h.y * Math.sin(r);
    }
    get handY() {
      if (this.hook) return this.y + 1;
      const h = this.localHand();
      const r = this.bodyRot();
      return this.bottom + h.x * this.facing * Math.sin(r) + h.y * Math.cos(r);
    }

    readIntent(input) {
      if (!input || this.locked) return NO_INPUT;
      return {
        dir: (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0),
        up: input.down('up'),
        down: input.down('down'),
        jumpPressed: input.pressed('jump'),
        jumpHeld: input.down('jump'),
        interactPressed: input.pressed('interact'),
        interactHeld: input.down('interact'),
        releasePressed: input.pressed('release'),
      };
    }

    update(dt, input, world) {
      this.stateT += dt;
      switch (this.state) {
        case 'lying':
          this.updateLying(input, world);
          this.animate(dt);
          return;
        case 'rising':
          if (this.stateT >= this.riseDur) {
            this.state = 'normal';
            this.stateT = 0;
          }
          this.animate(dt);
          return;
        case 'dead':
          this.updateDead(dt, world);
          return;
        case 'drowning':
          this.updateDrowning(dt, world);
          return;
      }

      const it = this.scripted ? Object.assign({}, NO_INPUT, { dir: this.scripted.dir }) : this.readIntent(input);

      if (it.interactPressed) world.interact(this);
      if (this.grab && (!it.interactHeld || !this.onGround || !world.isAdjacent(this, this.grab))) this.grab = null;

      if (this.hook) {
        this.updateSwing(dt, it, world);
        this.animate(dt);
        return;
      }

      // --- горизонталь ---
      let max = P.run;
      if (this.grab) max = P.pullSpeed;
      else if (this.pushing) max = P.pushSpeed;
      if (this.tieTaut) max *= 0.5;
      if (this.bog) max *= this.bog.speedMul;
      if (this.scripted) max = this.scripted.speed;
      const target = it.dir * max;
      const accel = this.onGround ? (it.dir !== 0 ? P.accel : P.decel) : P.airAccel;
      this.vx = U.approach(this.vx, target, accel * dt);
      if (it.dir !== 0 && !this.grab) this.facing = it.dir;

      // --- прыжок: буфер нажатия + «койот-тайм» ---
      if (it.jumpPressed) this.bufferT = P.buffer;
      else this.bufferT = Math.max(0, this.bufferT - dt);
      if (this.onGround) this.coyoteT = P.coyote;
      else this.coyoteT = Math.max(0, this.coyoteT - dt);

      // Из глубокой трясины не выпрыгнуть: ноги вязнут
      const stuck = this.bog && (this.bog.deep || this.bog.jumpMul <= 0);
      if (this.bufferT > 0 && this.coyoteT > 0 && !this.grab && !stuck) {
        let jv = P.jumpVel;
        if (this.bog) jv *= this.bog.jumpMul * Math.max(0, 1 - this.sink / 45);
        this.vy = -jv;
        this.onGround = false;
        this.ground = null;
        this.coyoteT = 0;
        this.bufferT = 0;
        this.jumpCut = false;
        NIT.audio.jump();
      }
      // Отпустил прыжок раньше — прыжок ниже
      if (!this.jumpCut && !it.jumpHeld && this.vy < 0) {
        this.vy *= 0.5;
        this.jumpCut = true;
      }
      if (this.vy >= 0) this.jumpCut = true;

      this.vy = Math.min(this.vy + P.gravity * dt, P.maxFall);

      // --- перемещение с коллизиями ---
      const wasGround = this.onGround;
      const vyBefore = this.vy;
      const oldX = this.x;
      world.movePlayerX(this, this.vx * dt);
      if (this.grab) world.dragGrabbed(this, this.x - oldX);
      world.movePlayerY(this, this.vy * dt);
      if (!wasGround && this.onGround) this.onLand(vyBefore, world);
      this.updateBog(dt, world);

      this.animate(dt);
    }

    // --- трясина: медленно затягивает, сильнее, если стоять на месте ---
    updateBog(dt, world) {
      const bog = world.bogAt(this.cx);
      const inside = bog && world.bogAt(this.x + 1) && world.bogAt(this.x + this.w - 1);
      if (inside && this.vy >= 0 && this.bottom >= bog.y - 0.5) {
        if (this.bog !== bog) {
          const fresh = !this.bog;
          this.bog = bog;
          this.sink = U.clamp(this.bottom - bog.y, 0, P.bogDeath);
          if (fresh) {
            NIT.audio.squelch(1);
            world.mud(this.cx, bog.y);
          }
        }
        const moving = Math.abs(this.vx) > 12;
        this.sink += (moving ? bog.sinkMove : bog.sinkStill) * dt;
        this.y = bog.y + this.sink - this.h;
        this.vy = 0;
        this.onGround = true;
        this.ground = null;
        if (this.sink >= P.bogDeath) world.killPlayer('bog');
      } else if (this.bog && (!inside || this.bottom < this.bog.y - 1)) {
        this.bog = null;
        this.sink = 0;
      }
    }

    // --- раскачка на нити ---
    updateSwing(dt, it, world) {
      const h = this.hook;
      if (!this.onGround) this.hookAir = true;
      if (it.up) this.ropeLen = Math.max(P.ropeMin, this.ropeLen - P.climbSpeed * dt);
      if (it.down) this.ropeLen = Math.min(P.ropeMax, this.ropeLen + P.climbSpeed * dt);
      // Нить сама выбирает лишнюю длину (пока игрок не спускается вручную)
      if (h.ropeLength && !it.down && this.ropeLen > h.ropeLength) {
        this.ropeLen = Math.max(h.ropeLength, this.ropeLen - 240 * dt);
      }

      let dx = this.cx - h.x;
      let dy = this.y + 6 - h.y;
      let d = Math.hypot(dx, dy) || 1;
      const rx = dx / d;
      const ry = dy / d;
      // Касательная к окружности (вправо, когда висим под веткой)
      const tx = ry;
      const ty = -rx;
      if (it.dir !== 0 && dy > 0) {
        this.vx += tx * it.dir * P.swingPump * dt;
        this.vy += ty * it.dir * P.swingPump * dt;
        this.facing = it.dir;
      }
      this.vy += P.gravity * dt;
      this.vx *= 1 - 0.08 * dt;
      this.vy *= 1 - 0.08 * dt;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 900) {
        this.vx *= 900 / sp;
        this.vy *= 900 / sp;
      }

      const wasGround = this.onGround;
      const vyBefore = this.vy;
      world.movePlayerX(this, this.vx * dt);
      world.movePlayerY(this, this.vy * dt);

      // Нить не даёт улететь дальше своей длины
      dx = this.cx - h.x;
      dy = this.y + 6 - h.y;
      d = Math.hypot(dx, dy) || 1;
      if (d > this.ropeLen) {
        const nx = dx / d;
        const ny = dy / d;
        const landed = this.onGround;
        world.movePlayerX(this, h.x + nx * this.ropeLen - this.cx);
        const cy = h.y + ny * this.ropeLen - (this.y + 6);
        if (Math.abs(cy) > 0.01) world.movePlayerY(this, cy);
        this.onGround = this.onGround || landed;
        const vr = this.vx * nx + this.vy * ny;
        if (vr > 0) {
          this.vx -= vr * nx;
          this.vy -= vr * ny;
        }
      }

      // Коснулся земли — нить отпускает
      if (this.onGround && this.hookAir) {
        this.releaseHook(world, false);
        if (!wasGround) this.onLand(vyBefore, world);
        return;
      }
      // «Умная» ветка сама отпускает героя в нужный момент
      if (h.auto) {
        const ang = Math.atan2(this.cx - h.x, this.y + 6 - h.y);
        if (ang > h.releaseAngle && this.vx > 40) {
          this.releaseHook(world, true, 70, -110);
          return;
        }
      }
      if (it.releasePressed) this.releaseHook(world, true, 0, -150);
    }

    attachHook(hook, world) {
      this.hook = hook;
      this.hookAir = !this.onGround;
      this.ropeLen = U.clamp(U.dist(this.cx, this.y + 6, hook.x, hook.y), P.ropeMin, P.ropeMax);
      this.bog = null; // нить вытягивает из трясины
      this.sink = 0;
      this.grab = null;
      this.jumpCut = true;
      world.thread.pinTo(hook.x, hook.y, this.handX, this.handY);
      NIT.audio.thread('hook');
    }

    releaseHook(world, launched, boostX = 0, boostY = 0) {
      if (!this.hook) return;
      this.hook.cooldown = 0.45;
      this.hook = null;
      world.thread.unpin();
      if (launched) {
        this.vx += boostX * Math.sign(this.vx || this.facing);
        this.vy = Math.min(this.vy, 0) + boostY;
        NIT.audio.whoosh();
      }
      this.jumpCut = true;
      this.bufferT = 0;
    }

    onLand(v, world) {
      if (v > 120) NIT.audio.land(v);
      if (v > 380) world.dust(this.cx, this.bottom, Math.round(v / 90));
      this.anim.land = Math.min(1, v / 900);
    }

    die(type) {
      this.state = type === 'drown' || type === 'bog' ? 'drowning' : 'dead';
      this.deathType = type;
      this.stateT = 0;
      this.hook = null;
      this.grab = null;
      this.tie = null;
      this.tieTaut = false;
      this.scripted = null;
      if (type === 'crush') this.vy = 0;
    }

    updateLying(input, world) {
      if (!this.wakeReady) return;
      const it = this.readIntent(input);
      const any = it.dir !== 0 || it.jumpPressed || it.interactPressed;
      if ((any && this.stateT > 0.5) || this.stateT > 7) {
        this.state = 'rising';
        this.stateT = 0;
        this.riseDur = 1.5;
        world.onPlayerRise();
      }
    }

    updateDead(dt, world) {
      const A = this.anim;
      if (this.deathType === 'fall') {
        this.vy = Math.min(this.vy + P.gravity * dt, P.maxFall);
        this.y += this.vy * dt;
        this.x += this.vx * dt;
        return;
      }
      A.rot = -this.facing * (Math.PI / 2) * U.easeOutCubic(Math.min(1, this.stateT / 0.45));
      if (this.deathType === 'crush') {
        A.squash = Math.min(1, this.stateT * 6);
        return; // раздавленный остаётся на месте
      }
      this.vx = U.approach(this.vx, 0, 900 * dt);
      this.vy = Math.min(this.vy + P.gravity * dt, P.maxFall);
      world.movePlayerX(this, this.vx * dt);
      world.movePlayerY(this, this.vy * dt);
    }

    updateDrowning(dt, world) {
      this.vx *= Math.pow(0.02, dt);
      this.vy = U.damp(this.vy, this.deathType === 'bog' ? 16 : 45, 3, dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.anim.rot = U.damp(this.anim.rot, -this.facing * 0.5, 2, dt);
      if (Math.random() < dt * 9) {
        world.particles.push({
          x: this.cx + U.rand(-6, 6),
          y: this.y + U.rand(0, 10),
          vx: U.rand(-8, 8),
          vy: U.rand(-60, -30),
          g: 0,
          life: U.rand(0.6, 1.1),
          t: 0,
          size: U.rand(1.5, 3.2),
          kind: 'bubble',
          floor: world.waterSurfaceAt(this.cx),
        });
      }
    }

    // Процедурная анимация: фаза бега, моргание, приземление
    animate(dt) {
      const A = this.anim;
      A.t += dt;
      const speed = Math.abs(this.vx);
      const runAmt = this.onGround && this.state === 'normal' ? U.clamp(speed / P.run, 0, 1) : 0;
      A.run = U.damp(A.run, runAmt, 12, dt);
      if (this.onGround && speed > 8 && this.state === 'normal') {
        const prev = A.phase;
        A.phase += dt * (5.5 + speed * 0.05);
        if (Math.floor(prev / Math.PI) !== Math.floor(A.phase / Math.PI)) NIT.audio.step(U.clamp(speed / P.run, 0.35, 1));
      } else if (this.onGround) {
        A.phase = U.damp(A.phase, Math.round(A.phase / Math.PI) * Math.PI, 10, dt);
      }
      A.air = this.onGround ? U.damp(A.air, 0, 14, dt) : U.clamp(this.vy / 600, -1, 1);
      A.land = Math.max(0, A.land - dt * 4);
      A.blinkT -= dt;
      if (A.blinkT <= 0) {
        A.blink = 0.12;
        A.blinkT = 2 + Math.random() * 4;
      }
      A.blink = Math.max(0, A.blink - dt);
      if (this.state === 'normal') A.rot = U.damp(A.rot, 0, 10, dt);
    }
  }

  NIT.Player = Player;
})();
