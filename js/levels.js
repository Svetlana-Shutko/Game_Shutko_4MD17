/* =========================================================
   НИТЬ — загрузка уровней
   Уровни описаны в levels/*.json.
   • Через Live Server (http://) читаем JSON-файл напрямую,
     поэтому правки уровня видны сразу после перезагрузки.
   • При открытии двойным кликом (file://) браузер запрещает fetch,
     и мы берём копию из levels/levels.bundle.js.
     Пересобрать бандл: node tools/build-levels.js
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;

  const fromBundle = (id) => {
    const bundle = window.NIT_LEVELS || {};
    if (!bundle[id]) {
      throw new Error(`Уровень «${id}» не найден в levels/levels.bundle.js. Запустите node tools/build-levels.js`);
    }
    return JSON.parse(JSON.stringify(bundle[id]));
  };

  NIT.Levels = {
    async load(id) {
      // Запуск двойным кликом и однофайловая веб-версия берут уровень из бандла
      if (location.protocol === 'file:' || window.NIT_INLINE) return fromBundle(id);
      try {
        const res = await fetch(`levels/${id}.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn(`[Нить] Не удалось прочитать levels/${id}.json (${err.message}), использую бандл.`);
        return fromBundle(id);
      }
    },
  };
})();
