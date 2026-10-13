/* =========================================================
   НИТЬ — звук
   Ни одного аудиофайла: всё синтезируется прямо в браузере
   через Web Audio API (шум, осцилляторы, фильтры, реверберация).
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.vol = { master: 0.8, sfx: 0.8, amb: 0.7 };
      this.wantAmbient = false;
      this.ambient = null;
      this.ksCache = new Map();
      this.beeps = null;
    }

    // Браузеры разрешают звук только после действия пользователя
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          this.ctx = new AC();
        } catch (e) {
          return;
        }
        this.build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    build() {
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master.connect(comp);
      comp.connect(c.destination);

      this.sfxBus = c.createGain();
      this.sfxBus.connect(this.master);

      // Атмосфера идёт через фильтр — в меню она «глохнет»
      this.ambBus = c.createGain();
      this.ambFilter = c.createBiquadFilter();
      this.ambFilter.type = 'lowpass';
      this.ambFilter.frequency.value = 18000;
      this.ambBus.connect(this.ambFilter);
      this.ambFilter.connect(this.master);

      this.reverb = c.createConvolver();
      this.reverb.buffer = this.impulse(3.2, 2.4);
      const rv = c.createGain();
      rv.gain.value = 0.55;
      this.reverb.connect(rv);
      rv.connect(this.master);

      this.noise = this.makeNoise(2);
      this.brown = this.makeBrown(6);
      this.applyVolumes();
      if (this.wantAmbient) this.startAmbient();
    }

    get on() {
      return !!this.ctx;
    }

    setVolumes(master, sfx, amb) {
      this.vol = { master, sfx, amb };
      this.applyVolumes();
    }

    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
      this.ambBus.gain.setTargetAtTime(this.vol.amb, t, 0.05);
    }

    setMuffled(on) {
      if (!this.ctx) return;
      this.ambFilter.frequency.setTargetAtTime(on ? 520 : 18000, this.ctx.currentTime, 0.2);
    }

    // ---------- генераторы буферов ----------

    makeNoise(sec) {
      const c = this.ctx;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    makeBrown(sec) {
      const c = this.ctx;
      const n = Math.floor(c.sampleRate * sec);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      // Убираем щелчок на стыке петли
      const drift = d[n - 1] - d[0];
      for (let i = 0; i < n; i++) d[i] -= (drift * i) / (n - 1);
      return buf;
    }

    impulse(sec, decay) {
      const c = this.ctx;
      const len = Math.floor(c.sampleRate * sec);
      const buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    // Алгоритм Карплуса — Стронга: звук щипка струны (наша нить)
    ksBuffer(freq) {
      const key = Math.round(freq);
      if (this.ksCache.has(key)) return this.ksCache.get(key);
      const c = this.ctx;
      const n = Math.floor(c.sampleRate * 2.2);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(c.sampleRate / freq));
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const next = (idx + 1) % period;
        const v = ring[idx];
        ring[idx] = 0.4985 * (ring[idx] + ring[next]);
        d[i] = v;
        idx = next;
      }
      this.ksCache.set(key, buf);
      return buf;
    }

    // ---------- примитивы ----------

    env(param, t, attack, peak, decay) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    out(node, rev = 0, bus = this.sfxBus) {
      node.connect(bus);
      if (rev > 0) {
        const s = this.ctx.createGain();
        s.gain.value = rev;
        node.connect(s);
        s.connect(this.reverb);
      }
    }

    noiseHit({ dur = 0.2, type = 'lowpass', freq = 1000, freqEnd = 0, q = 0.8, gain = 0.2, attack = 0.004, rev = 0.15, delay = 0, rate = 1, bus } = {}) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const f = c.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + dur);
      const g = c.createGain();
      this.env(g.gain, t, attack, gain, dur);
      src.connect(f);
      f.connect(g);
      this.out(g, rev, bus);
      src.start(t, Math.random() * 1.5);
      src.stop(t + attack + dur + 0.05);
    }

    tone({ type = 'sine', freq = 440, freqEnd = 0, dur = 0.2, gain = 0.15, attack = 0.005, rev = 0.1, delay = 0, filter = 0, bus } = {}) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + dur);
      const g = c.createGain();
      this.env(g.gain, t, attack, gain, dur);
      let last = o;
      if (filter) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filter;
        o.connect(f);
        last = f;
      }
      last.connect(g);
      this.out(g, rev, bus);
      o.start(t);
      o.stop(t + attack + dur + 0.05);
    }

    pluck(freq = 220, gain = 0.25, rev = 0.35, delay = 0) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = this.ksBuffer(freq);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      src.connect(f);
      f.connect(g);
      this.out(g, rev);
      src.start(t);
    }

    // ---------- атмосфера ----------

    startAmbient() {
      if (!this.ctx) {
        this.wantAmbient = true;
        return;
      }
      if (this.ambient) return;
      const c = this.ctx;
      const t = c.currentTime;

      // Ветер: коричневый шум через «дышащий» полосовой фильтр
      const wind = c.createBufferSource();
      wind.buffer = this.brown;
      wind.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 380;
      bp.Q.value = 0.7;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.055;
      const lfoAmt = c.createGain();
      lfoAmt.gain.value = 210;
      lfo.connect(lfoAmt);
      lfoAmt.connect(bp.frequency);
      const wg = c.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.exponentialRampToValueAtTime(0.42, t + 4);
      const gust = c.createOscillator();
      gust.frequency.value = 0.09;
      const gustAmt = c.createGain();
      gustAmt.gain.value = 0.16;
      gust.connect(gustAmt);
      gustAmt.connect(wg.gain);
      wind.connect(bp);
      bp.connect(wg);
      wg.connect(this.ambBus);

      // Тихий низкий гул
      const drone = c.createGain();
      drone.gain.setValueAtTime(0.0001, t);
      drone.gain.exponentialRampToValueAtTime(0.05, t + 7);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      const oscs = [
        ['triangle', 55],
        ['sine', 55.35],
        ['sine', 82.6],
      ].map(([type, f]) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.connect(lp);
        return o;
      });
      lp.connect(drone);
      drone.connect(this.ambBus);

      [wind, lfo, gust, ...oscs].forEach((n) => n.start(t));
      this.ambient = { wind, lfo, gust, oscs, wg, drone };
    }

    // ---------- писк (то, что звучит в тумане) ----------

    startBeeps(level = 0.3, interval = 0.95) {
      if (!this.ctx) return;
      if (!this.beeps) {
        this.beeps = { level, interval, next: this.ctx.currentTime + 0.3 };
        this.beeps.timer = setInterval(() => this.scheduleBeeps(), 60);
      } else {
        this.beeps.level = level;
        this.beeps.interval = interval;
      }
    }

    scheduleBeeps() {
      const b = this.beeps;
      if (!b || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (b.next < now) b.next = now + 0.05;
      while (b.next < now + 0.25) {
        const delay = b.next - now;
        this.tone({ type: 'sine', freq: 1046, dur: 0.12, gain: 0.07 * b.level, attack: 0.004, rev: 0.6, delay, filter: 2600, bus: this.ambBus });
        b.next += b.interval;
      }
    }

    stopBeeps() {
      if (this.beeps) {
        clearInterval(this.beeps.timer);
        this.beeps = null;
      }
    }

    distantBeep() {
      this.tone({ freq: 1046, dur: 0.14, gain: 0.025, rev: 0.9, filter: 900, bus: this.ambBus });
      this.tone({ freq: 1046, dur: 0.14, gain: 0.018, rev: 0.9, filter: 900, delay: 0.95, bus: this.ambBus });
    }

    // ---------- эффекты ----------

    step(k = 1) {
      this.noiseHit({ dur: 0.05, type: 'lowpass', freq: 620 + Math.random() * 300, gain: 0.07 * k, rev: 0.04 });
      this.noiseHit({ dur: 0.04, type: 'highpass', freq: 3200, gain: 0.012 * k, rev: 0 });
    }

    jump() {
      this.noiseHit({ dur: 0.12, type: 'bandpass', freq: 800, freqEnd: 1700, q: 1.2, gain: 0.05, rev: 0.05 });
    }

    land(v) {
      const k = Math.min(1, Math.max(0.2, v / 900));
      this.noiseHit({ dur: 0.12, type: 'lowpass', freq: 420, gain: 0.2 * k, rev: 0.08 });
      this.tone({ freq: 75, freqEnd: 40, dur: 0.12, gain: 0.12 * k, rev: 0 });
    }

    snap() {
      this.tone({ type: 'square', freq: 1500, freqEnd: 220, dur: 0.06, gain: 0.08, rev: 0.2, filter: 4000 });
      this.noiseHit({ dur: 0.08, type: 'highpass', freq: 2600, gain: 0.22, rev: 0.3 });
      this.tone({ freq: 95, freqEnd: 40, dur: 0.25, gain: 0.3, rev: 0.1 });
      this.tone({ type: 'triangle', freq: 2240, dur: 0.35, gain: 0.03, rev: 0.6 });
    }

    death() {
      this.tone({ freq: 150, freqEnd: 34, dur: 1.1, gain: 0.22, attack: 0.01, rev: 0.6 });
      this.noiseHit({ dur: 0.9, type: 'lowpass', freq: 380, freqEnd: 90, gain: 0.14, rev: 0.5 });
    }

    fall() {
      this.noiseHit({ dur: 1.4, type: 'bandpass', freq: 500, freqEnd: 140, q: 0.6, gain: 0.08, attack: 0.3, rev: 0.6 });
    }

    splash() {
      this.noiseHit({ dur: 0.55, type: 'bandpass', freq: 1300, freqEnd: 500, q: 0.7, gain: 0.28, rev: 0.35 });
      this.noiseHit({ dur: 0.25, type: 'lowpass', freq: 300, gain: 0.25, rev: 0.1 });
      for (let i = 0; i < 6; i++) {
        this.tone({ freq: 380 + Math.random() * 300, freqEnd: 900 + Math.random() * 600, dur: 0.05, gain: 0.03, delay: 0.25 + Math.random() * 1.1, rev: 0.3 });
      }
    }

    creak(dur = 0.8) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime;
      [70, 103].forEach((base, i) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = base;
        const wob = c.createOscillator();
        wob.frequency.value = 6 + i * 3.3;
        const wobAmt = c.createGain();
        wobAmt.gain.value = base * 0.32;
        wob.connect(wobAmt);
        wobAmt.connect(o.frequency);
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 650 + i * 260;
        f.Q.value = 4;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.1 - i * 0.03, t + 0.08);
        g.gain.setValueAtTime(0.1 - i * 0.03, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f);
        f.connect(g);
        this.out(g, 0.35);
        o.start(t);
        wob.start(t);
        o.stop(t + dur + 0.05);
        wob.stop(t + dur + 0.05);
      });
    }

    crash() {
      this.noiseHit({ dur: 1.3, type: 'lowpass', freq: 900, freqEnd: 120, gain: 0.45, attack: 0.005, rev: 0.4 });
      this.tone({ freq: 62, freqEnd: 28, dur: 0.6, gain: 0.4, rev: 0.2 });
      for (let i = 0; i < 4; i++) {
        this.noiseHit({ dur: 0.05, type: 'highpass', freq: 2000, gain: 0.12, delay: Math.random() * 0.35, rev: 0.2 });
      }
    }

    scrape() {
      this.noiseHit({ dur: 0.09, type: 'bandpass', freq: 260, q: 2, gain: 0.08, rev: 0.03 });
    }

    whoosh() {
      this.noiseHit({ dur: 0.35, type: 'bandpass', freq: 500, freqEnd: 1100, q: 1.4, gain: 0.05, attack: 0.08, rev: 0.1 });
    }

    thread(kind) {
      if (kind === 'tie') this.pluck(247, 0.3);
      else if (kind === 'hook') {
        this.pluck(196, 0.3);
        this.whoosh();
      } else if (kind === 'untie') this.pluck(165, 0.16);
      else if (kind === 'tug') {
        this.pluck(98, 0.42, 0.5);
        this.pluck(147, 0.25, 0.5, 0.03);
      }
    }

    ghost() {
      this.pluck(220, 0.16, 0.8);
      this.pluck(233, 0.13, 0.8, 0.05);
      this.noiseHit({ dur: 1.4, type: 'bandpass', freq: 900, freqEnd: 2600, q: 3, gain: 0.03, attack: 0.5, rev: 0.8 });
    }

    thud(k = 1) {
      this.tone({ freq: 46, freqEnd: 28, dur: 0.7, gain: 0.22 * k, attack: 0.02, rev: 0.5, filter: 220, bus: this.ambBus });
    }

    heartbeat(delay = 0) {
      this.tone({ freq: 58, freqEnd: 40, dur: 0.16, gain: 0.25, delay, rev: 0.25 });
      this.tone({ freq: 52, freqEnd: 38, dur: 0.14, gain: 0.18, delay: delay + 0.26, rev: 0.25 });
    }

    uiMove() {
      this.tone({ type: 'sine', freq: 520, dur: 0.05, gain: 0.03, rev: 0.1 });
    }

    uiSelect() {
      this.pluck(330, 0.12, 0.25);
    }

    uiBack() {
      this.tone({ type: 'sine', freq: 400, freqEnd: 300, dur: 0.08, gain: 0.03, rev: 0.1 });
    }

    // ---------- глава II ----------

    squelch(k = 1) {
      this.noiseHit({ dur: 0.18, type: 'lowpass', freq: 520, freqEnd: 180, gain: 0.16 * k, rev: 0.08 });
      this.tone({ freq: 140, freqEnd: 60, dur: 0.16, gain: 0.08 * k, rev: 0.05 });
    }

    // Три писка всё выше: сейчас загорится свет
    watchWarn() {
      [0, 0.22, 0.44].forEach((d, i) =>
        this.tone({ freq: 1046 + i * 120, dur: 0.1, gain: 0.07, delay: d, rev: 0.5, filter: 3000, bus: this.ambBus })
      );
    }

    // Дрожащий тон, пока луч ищет
    scanHum(dur) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = 523;
      const trem = c.createOscillator();
      trem.frequency.value = 9;
      const tremAmt = c.createGain();
      tremAmt.gain.value = 0.012;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.3);
      g.gain.setValueAtTime(0.03, t + Math.max(0.35, dur - 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      trem.connect(tremAmt);
      tremAmt.connect(g.gain);
      o.connect(g);
      this.out(g, 0.4, this.ambBus);
      o.start(t);
      trem.start(t);
      o.stop(t + dur + 0.05);
      trem.stop(t + dur + 0.05);
    }

    // ---------- глава III ----------

    hiss() {
      this.noiseHit({ dur: 0.35, type: 'highpass', freq: 3200, gain: 0.05, attack: 0.05, rev: 0.2 });
    }

    slam() {
      this.tone({ freq: 70, freqEnd: 35, dur: 0.3, gain: 0.3, rev: 0.25 });
      this.noiseHit({ dur: 0.2, type: 'lowpass', freq: 700, gain: 0.22, rev: 0.25 });
      this.tone({ type: 'triangle', freq: 1800, dur: 0.25, gain: 0.022, rev: 0.6 });
    }

    clank(k = 1) {
      this.tone({ type: 'square', freq: 320, freqEnd: 180, dur: 0.12, gain: 0.045 * k, filter: 1800, rev: 0.4 });
      this.tone({ type: 'triangle', freq: 1350, dur: 0.4, gain: 0.028 * k, rev: 0.6 });
    }

    grind(dur = 1.4) {
      this.noiseHit({ dur, type: 'bandpass', freq: 220, freqEnd: 440, q: 3, gain: 0.09, attack: 0.1, rev: 0.3 });
    }

    gurgle() {
      for (let i = 0; i < 10; i++) {
        this.tone({ freq: 120 + Math.random() * 80, freqEnd: 260 + Math.random() * 200, dur: 0.12, gain: 0.04, delay: i * 0.28 + Math.random() * 0.1, rev: 0.4, filter: 900 });
      }
      this.noiseHit({ dur: 2.8, type: 'lowpass', freq: 600, freqEnd: 200, gain: 0.08, attack: 0.3, rev: 0.4 });
    }

    // Тёплый аккорд и вдох: он просыпается
    finale() {
      [262, 330, 392, 523].forEach((f, i) => this.pluck(f, 0.12, 0.8, i * 0.14));
      this.noiseHit({ dur: 1.6, type: 'bandpass', freq: 900, freqEnd: 400, q: 0.8, gain: 0.04, attack: 0.6, rev: 0.6 });
    }

    // Ровный долгий писк, как у больничного монитора
    flatline() {
      this.tone({ freq: 1046, dur: 1.8, gain: 0.08, attack: 0.01, rev: 0.4, filter: 3200 });
      this.noiseHit({ dur: 0.4, type: 'highpass', freq: 3000, gain: 0.06, rev: 0.4 });
    }
  }

  NIT.audio = new AudioEngine();
})();
