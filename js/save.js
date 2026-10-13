/* =========================================================
   НИТЬ — сохранения и настройки
   Всё хранится в localStorage браузера:
     nit.saves.v1    — три ручных слота + автосохранение
     nit.settings.v1 — громкость, эффекты, подсказки
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;

  const SAVE_KEY = 'nit.saves.v1';
  const SETTINGS_KEY = 'nit.settings.v1';
  const SLOT_COUNT = 3;

  const DEFAULT_SETTINGS = {
    master: 8, // 0..10
    sfx: 8,
    ambient: 7,
    grain: true,
    shake: true,
    hints: true,
  };

  // localStorage может быть недоступен (приватный режим) — не падаем
  const store = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  class SaveSystem {
    constructor() {
      this.data = this.read();
      this.settings = this.readSettings();
    }

    read() {
      let d = null;
      try {
        const raw = store.get(SAVE_KEY);
        d = raw ? JSON.parse(raw) : null;
      } catch (e) {
        d = null;
      }
      if (!d || !Array.isArray(d.slots)) d = { version: 1, slots: [], auto: null };
      while (d.slots.length < SLOT_COUNT) d.slots.push(null);
      return d;
    }

    persist() {
      return store.set(SAVE_KEY, JSON.stringify(this.data));
    }

    get slotCount() {
      return SLOT_COUNT;
    }

    // key: 0, 1, 2 или 'auto'
    get(key) {
      return key === 'auto' ? this.data.auto : this.data.slots[key] || null;
    }

    write(key, state) {
      const record = Object.assign({}, state, { savedAt: Date.now() });
      if (key === 'auto') this.data.auto = record;
      else this.data.slots[key] = record;
      return this.persist();
    }

    remove(key) {
      if (key === 'auto') this.data.auto = null;
      else this.data.slots[key] = null;
      return this.persist();
    }

    hasAny() {
      return !!this.data.auto || this.data.slots.some(Boolean);
    }

    // Пройденные главы
    markDone(id, stats) {
      this.data.done = Object.assign({}, this.data.done, { [id]: stats || true });
      return this.persist();
    }

    // Итоги по всем пройденным главам — для финального экрана
    totals() {
      const t = { count: 0, time: 0, deaths: 0 };
      for (const v of Object.values(this.data.done || {})) {
        t.count++;
        if (v && typeof v === 'object') {
          t.time += v.time || 0;
          t.deaths += v.deaths || 0;
        }
      }
      return t;
    }

    isDone(id) {
      return !!(this.data.done && this.data.done[id]);
    }

    // Самое свежее сохранение — для кнопки «Продолжить»
    latest() {
      let best = null;
      const consider = (key) => {
        const rec = this.get(key);
        if (rec && (!best || rec.savedAt > best.rec.savedAt)) best = { key, rec };
      };
      consider('auto');
      for (let i = 0; i < SLOT_COUNT; i++) consider(i);
      return best;
    }

    readSettings() {
      let s = null;
      try {
        const raw = store.get(SETTINGS_KEY);
        s = raw ? JSON.parse(raw) : null;
      } catch (e) {
        s = null;
      }
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    }

    saveSettings() {
      return store.set(SETTINGS_KEY, JSON.stringify(this.settings));
    }
  }

  NIT.SaveSystem = SaveSystem;
})();
