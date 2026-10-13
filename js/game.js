/* =========================================================
   НИТЬ — игра: состояния, главный цикл, сохранения
   Состояния: boot → title → playing ⇄ paused → ended → title
   Физика идёт шагами не длиннее 1/120 с, поэтому прыжки
   одинаковые на мониторах 60, 120 и 144 Гц.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;
  const STEP = 1 / 120;

  // Порядок глав. Каждая глава — файл levels/<id>.json
  const CHAPTERS = [
    { id: 'chapter1', title: 'Глава I', subtitle: 'Лес' },
    { id: 'chapter2', title: 'Глава II', subtitle: 'Болото' },
    { id: 'chapter3', title: 'Глава III', subtitle: 'Город' },
  ];

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.renderer = new NIT.Renderer(this.canvas);
      this.input = new NIT.Input();
      this.audio = NIT.audio;
      this.saves = new NIT.SaveSystem();
      this.ui = new NIT.UI(this);
      this.state = 'boot';
      this.world = null;
      this.level = null;
      this.playTime = 0;
      this.last = 0;
      this.unlocked = false;
      this.chapters = CHAPTERS;
      this.levelCache = {};
      this.frameFn = (t) => this.frame(t);

      // Браузер разрешает звук только после первого нажатия
      const unlock = () => {
        this.audio.unlock();
        if (this.unlocked) return;
        this.unlocked = true;
        this.audio.startAmbient();
        this.applySettings();
        this.audio.setMuffled(this.state !== 'playing');
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyF' && !e.repeat) this.toggleFullscreen();
      });
      // Свернул окно — игра встаёт на паузу
      window.addEventListener('blur', () => this.pause());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.pause();
      });
      this.applySettings();
    }

    async boot() {
      try {
        await this.useChapter('chapter1');
      } catch (err) {
        console.error(err);
        this.ui.fatal('Не удалось загрузить уровень', err.message);
        return;
      }
      this.toTitle();
      this.ui.ready();
      requestAnimationFrame(this.frameFn);
    }

    // Загружает главу (из кэша, JSON или бандла) и строит для неё мир
    async useChapter(id) {
      if (this.level && this.level.id === id && this.world) return;
      if (!this.levelCache[id]) this.levelCache[id] = await NIT.Levels.load(id);
      this.level = this.levelCache[id];
      this.renderer.setLevel(this.level);
      this.world = new NIT.World(this.level, {
        onCheckpoint: () => this.autosave(),
        onChapterTitle: () => this.ui.chapterCard(this.level.title, this.level.subtitle),
        onChapterComplete: () => this.completeChapter(),
        onWord: (word) => this.ui.showWord(word, 4200),
      });
      this.world.settings = this.saves.settings;
    }

    nextChapter() {
      const i = CHAPTERS.findIndex((c) => this.level && c.id === this.level.id);
      return i >= 0 && i < CHAPTERS.length - 1 ? CHAPTERS[i + 1] : null;
    }

    frame(ts) {
      requestAnimationFrame(this.frameFn);
      const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : STEP;
      this.last = ts;
      this.input.pollPad();
      const steps = Math.max(1, Math.ceil(dt / STEP - 1e-6));
      const sdt = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.update(sdt);
        if (i === 0) this.input.consume();
      }
      this.renderer.render(this.world);
    }

    update(dt) {
      const w = this.world;
      switch (this.state) {
        case 'title':
          w.update(dt, null);
          this.ui.update(this.input);
          break;
        case 'playing':
          if (this.input.pressed('pause')) {
            this.pause();
            break;
          }
          this.playTime += dt;
          w.update(dt, this.input);
          break;
        case 'paused':
          this.ui.update(this.input);
          break;
        case 'ended':
          w.update(dt, null);
          this.ui.update(this.input);
          break;
      }
    }

    applySettings() {
      const s = this.saves.settings;
      const curve = (v) => Math.pow(v / 10, 1.6);
      this.audio.setVolumes(curve(s.master), curve(s.sfx), curve(s.ambient));
      this.renderer.settings.grain = !!s.grain;
      this.renderer.settings.hints = !!s.hints;
      if (this.world) this.world.settings = s;
    }

    /* ---------- переходы между состояниями ---------- */

    toTitle() {
      const w = this.world;
      w.mode = 'title';
      w.startAt(0, { intro: true });
      w.fade = 1;
      w.fadeTarget = 0;
      w.fadeSpeed = 0.8;
      this.state = 'title';
      this.ui.hideHint();
      this.ui.open('title');
      this.audio.stopBeeps();
      this.audio.setMuffled(true);
    }

    newGame() {
      return this.startChapter('chapter1');
    }

    async startChapter(id) {
      try {
        await this.useChapter(id);
      } catch (err) {
        console.error(err);
        this.ui.toast('Не удалось загрузить главу');
        return;
      }
      const w = this.world;
      this.audio.stopBeeps();
      this.playTime = 0;
      w.deaths = 0;
      w.mode = 'play';
      w.startAt(0, { intro: true });
      w.fade = 1;
      w.fadeTarget = 0;
      w.fadeSpeed = 0.45;
      this.state = 'playing';
      this.ui.close();
      this.audio.setMuffled(false);
      [0.8, 1.9, 3.0].forEach((d) => this.audio.heartbeat(d));
      if (this.saves.settings.hints && id === 'chapter1') this.ui.showHint(5);
    }

    async loadFrom(key) {
      const rec = this.saves.get(key);
      if (!rec) return;
      try {
        await this.useChapter(rec.chapter || 'chapter1');
      } catch (err) {
        console.error(err);
        this.ui.toast('Не удалось загрузить главу');
        return;
      }
      const w = this.world;
      let idx = w.checkpoints.findIndex((c) => c.id === rec.checkpoint);
      if (idx < 0) idx = U.clamp(rec.checkpointIndex | 0, 0, w.checkpoints.length - 1);
      this.playTime = rec.playTime || 0;
      w.deaths = rec.deaths || 0;
      w.mode = 'play';
      w.startAt(idx, {});
      w.player.state = 'rising';
      w.player.riseDur = 0.8;
      w.player.stateT = 0;
      w.fade = 1;
      w.fadeTarget = 0;
      w.fadeSpeed = 1.2;
      this.state = 'playing';
      this.ui.close();
      this.ui.hideHint();
      this.audio.setMuffled(false);
      this.ui.toast(key === 'auto' ? 'Загружено автосохранение' : `Загружен слот ${key + 1}`);
    }

    continueLatest() {
      const latest = this.saves.latest();
      if (latest) this.loadFrom(latest.key);
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.ui.open('pause');
      this.ui.hideHint();
      this.audio.setMuffled(true);
    }

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.ui.close();
      this.audio.setMuffled(false);
    }

    restartCheckpoint() {
      this.resume();
      this.world.restartFromCheckpoint();
    }

    /* ---------- сохранения ---------- */

    snapshot(extra) {
      const w = this.world;
      const cp = w.checkpoints[w.cpIndex];
      return Object.assign(
        {
          chapter: this.level.id,
          chapterTitle: `${this.level.title}. ${this.level.subtitle}`,
          checkpoint: cp.id,
          checkpointIndex: w.cpIndex,
          checkpointCount: w.checkpoints.length,
          deaths: w.deaths,
          playTime: Math.round(this.playTime),
          completed: false,
        },
        extra || {}
      );
    }

    saveTo(slot) {
      const ok = this.saves.write(slot, this.snapshot());
      this.ui.toast(ok ? `Сохранено в слот ${slot + 1}` : 'Не удалось сохранить: браузер закрыл доступ к хранилищу');
      this.ui.refresh();
    }

    autosave() {
      if (this.saves.write('auto', this.snapshot())) this.ui.savingFlash();
    }

    completeChapter() {
      this.saves.write('auto', this.snapshot({ completed: true }));
      this.saves.markDone(this.level.id, { time: Math.round(this.playTime), deaths: this.world.deaths });
      this.state = 'ended';
      this.ui.open(this.level.final ? 'finale' : 'end');
      this.audio.setMuffled(true);
    }

    toggleFullscreen() {
      const el = document.documentElement;
      // Во встроенном окне браузер может запретить полный экран, тогда просто ничего не делаем
      try {
        const r = !document.fullscreenElement
          ? el.requestFullscreen && el.requestFullscreen()
          : document.exitFullscreen && document.exitFullscreen();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {
        /* полноэкранный режим недоступен */
      }
    }
  }

  NIT.Game = Game;
})();
