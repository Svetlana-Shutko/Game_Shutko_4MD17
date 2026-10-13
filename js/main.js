/* =========================================================
   НИТЬ — запуск
   ========================================================= */
(function () {
  'use strict';

  function start() {
    try {
      window.NIT.game = new window.NIT.Game();
      window.NIT.game.boot();
    } catch (err) {
      console.error(err);
      const boot = document.getElementById('boot');
      if (boot) {
        boot.classList.remove('is-hidden');
        boot.innerHTML = '<p class="boot__title">Игра не запустилась</p><p class="boot__text"></p>';
        boot.querySelector('.boot__text').textContent = err && err.message ? err.message : String(err);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
