/* =========================================================
   НИТЬ — интерфейс
   Меню собираются из простых описаний (screen_*) и рисуются
   обычным DOM поверх канваса. Клавиатура: ↑↓ / W S, Enter,
   Esc, ← → для ползунков, Delete для удаления слота. Мышь тоже работает.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

  // Красная нить, которая «пришивается» к выбранному пункту
  const TIE = '<svg class="tie" viewBox="0 0 64 14" aria-hidden="true"><path d="M1 7 C 11 1, 19 13, 31 7 S 51 2, 63 7"/></svg>';

  // Логотип: нить проходит то за буквами, то поверх них
  const LOGO = `<svg class="logo" viewBox="0 0 440 160" role="img" aria-label="Нить">
      <text class="logo__ink" x="6" y="126">Нить</text>
      <path class="logo__thread" d="M -30 98 C 50 62, 120 132, 200 92 S 340 58, 470 90"/>
      <text class="logo__ink" x="6" y="126"><tspan>Н</tspan><tspan class="logo__hole">и</tspan><tspan>т</tspan><tspan class="logo__hole">ь</tspan></text>
    </svg>`;

  class UI {
    constructor(game) {
      this.game = game;
      this.menu = document.getElementById('menu');
      this.card = document.getElementById('chapter-card');
      this.toastEl = document.getElementById('toast');
      this.hintEl = document.getElementById('hint');
      this.savingEl = document.getElementById('saving');
      this.bootEl = document.getElementById('boot');
      this.stack = [];
      this.sel = 0;
      this.items = [];
      this.timers = {};
      this.logoShown = false;
    }

    get isOpen() {
      return this.stack.length > 0;
    }

    get top() {
      return this.stack[this.stack.length - 1];
    }

    /* ---------- навигация по экранам ---------- */

    open(id, params) {
      this.stack = [{ id, params: params || {} }];
      this.sel = 0;
      this.render();
    }

    push(id, params) {
      this.top.sel = this.sel;
      this.stack.push({ id, params: params || {} });
      this.sel = 0;
      this.render();
    }

    pop() {
      if (this.stack.length > 1) {
        this.stack.pop();
        this.sel = this.top.sel || 0;
        this.render();
        NIT.audio.uiBack();
        return;
      }
      const d = this.def();
      if (d.onBack) {
        NIT.audio.uiBack();
        d.onBack();
      }
    }

    close() {
      this.stack = [];
      this.menu.hidden = true;
      this.menu.innerHTML = '';
    }

    refresh() {
      if (this.isOpen) this.render();
    }

    def() {
      const t = this.top;
      return this['screen_' + t.id](t.params);
    }

    /* ---------- отрисовка ---------- */

    render() {
      const d = this.def();
      this.items = d.items || [];
      if (this.sel >= this.items.length) this.sel = 0;
      if (this.items[this.sel] && this.items[this.sel].disabled) this.sel = this.nextEnabled(this.sel, 1);
      const firstLogo = d.logo && !this.logoShown;
      if (d.logo) this.logoShown = true;

      const m = this.menu;
      m.hidden = false;
      m.className = `menu menu--${d.kind}`;
      m.innerHTML = `
        <div class="menu__panel">
          ${d.logo ? `<div class="logo-wrap${firstLogo ? ' is-drawing' : ''}">${LOGO}</div>` : ''}
          ${d.title ? `<h2 class="menu__title">${esc(d.title)}</h2>` : ''}
          ${d.text ? `<p class="menu__text">${esc(d.text)}</p>` : ''}
          ${d.html || ''}
          <ul class="menu__list" role="menu">${this.items.map((it, i) => this.itemHTML(it, i)).join('')}</ul>
          <p class="menu__keys">${this.keysHTML(d)}</p>
        </div>`;

      m.querySelectorAll('.item').forEach((el) => {
        const i = Number(el.dataset.i);
        el.addEventListener('mouseenter', () => this.select(i));
        el.addEventListener('click', (e) => {
          const step = e.target.closest('[data-step]');
          if (step) {
            this.sel = i;
            this.adjust(this.items[i], Number(step.dataset.step));
          } else this.activate(i);
        });
      });
      this.mark();
    }

    itemHTML(it, i) {
      const type = it.type || 'button';
      let ctl = '';
      if (type === 'slider') {
        const bars = Array.from({ length: 10 }, (_, k) => `<i class="${k < it.value ? 'on' : ''}"></i>`).join('');
        ctl = `<span class="item__ctl"><button type="button" class="step" data-step="-1" tabindex="-1" aria-label="Меньше">‹</button><span class="bar">${bars}</span><button type="button" class="step" data-step="1" tabindex="-1" aria-label="Больше">›</button></span>`;
      } else if (type === 'toggle') {
        ctl = `<span class="item__ctl"><span class="toggle">${it.value ? 'включено' : 'выключено'}</span></span>`;
      }
      const sub = it.sub ? `<span class="item__sub">${esc(it.sub)}</span>` : '';
      const cls = `item item--${type}${it.disabled ? ' is-disabled' : ''}`;
      return `<li class="${cls}" data-i="${i}" role="menuitem" aria-disabled="${it.disabled ? 'true' : 'false'}">${TIE}<span class="item__body"><span class="item__label">${esc(it.label)}</span>${sub}</span>${ctl}</li>`;
    }

    keysHTML(d) {
      const parts = [`${kbd('↑')}${kbd('↓')} выбрать`, `${kbd('Enter')} подтвердить`];
      if (d.adjust) parts.push(`${kbd('←')}${kbd('→')} изменить`);
      if (d.erase) parts.push(`${kbd('Del')} удалить`);
      if (d.kind === 'pause') parts.push(`${kbd('Esc')} вернуться в игру`);
      else if (d.kind !== 'title' && d.kind !== 'end' && d.kind !== 'finale') parts.push(`${kbd('Esc')} назад`);
      return parts.map((p) => `<span>${p}</span>`).join('');
    }

    mark() {
      this.menu.querySelectorAll('.item').forEach((el) => {
        const on = Number(el.dataset.i) === this.sel;
        el.classList.toggle('is-selected', on);
        if (on) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      });
    }

    nextEnabled(from, dir) {
      const n = this.items.length;
      if (!n) return 0;
      let i = from;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!this.items[i].disabled) return i;
      }
      return from;
    }

    select(i) {
      const it = this.items[i];
      if (!it || it.disabled || i === this.sel) return;
      this.sel = i;
      this.mark();
      NIT.audio.uiMove();
    }

    move(dir) {
      const n = this.nextEnabled(this.sel, dir);
      if (n !== this.sel) {
        this.sel = n;
        this.mark();
        NIT.audio.uiMove();
      }
    }

    activate(i) {
      const it = this.items[i];
      if (!it || it.disabled) return;
      this.sel = i;
      if (it.type === 'slider') return this.adjust(it, it.value >= 10 ? -10 : 1);
      if (it.type === 'toggle') return this.adjust(it, 1);
      NIT.audio.uiSelect();
      if (it.action) it.action();
    }

    adjust(it, delta) {
      if (!it || it.disabled) return;
      if (it.type === 'slider') {
        const v = U.clamp(it.value + delta, 0, 10);
        if (v === it.value) return;
        it.onChange(v);
      } else if (it.type === 'toggle') {
        it.onChange(!it.value);
      } else return;
      NIT.audio.uiMove();
      this.refresh();
    }

    // Вызывается каждый шаг, пока открыто меню
    update(input) {
      if (!this.isOpen) return;
      if (input.pressed('up')) this.move(-1);
      else if (input.pressed('down')) this.move(1);
      const it = this.items[this.sel];
      if (it && (it.type === 'slider' || it.type === 'toggle')) {
        if (input.pressed('left')) this.adjust(it, -1);
        else if (input.pressed('right')) this.adjust(it, 1);
      }
      if (input.pressed('confirm')) this.activate(this.sel);
      else if (input.pressed('back')) this.pop();
      else if (input.pressed('erase') && it && it.onErase) it.onErase();
    }

    // Человеческое описание сохранения
    describe(rec) {
      const n = (rec.checkpointIndex || 0) + 1;
      const total = rec.checkpointCount || n;
      const deaths = rec.deaths || 0;
      const line1 = `${rec.chapterTitle || 'Глава I. Лес'}, точка ${n} из ${total}${rec.completed ? ', глава пройдена' : ''}`;
      const line2 = `${U.formatTime(rec.playTime || 0)} в пути, ${deaths} ${U.plural(deaths, ['смерть', 'смерти', 'смертей'])}. ${U.formatDate(rec.savedAt)}`;
      return `${line1}\n${line2}`;
    }

    confirm(params) {
      this.push('confirm', params);
    }

    /* ---------- экраны ---------- */

    screen_title() {
      const g = this.game;
      const s = g.saves;
      const latest = s.latest();
      return {
        kind: 'title',
        logo: true,
        items: [
          {
            label: 'Продолжить',
            sub: latest ? this.describe(latest.rec) : 'Сохранений пока нет',
            disabled: !latest,
            action: () => g.continueLatest(),
          },
          {
            label: 'Новая игра',
            action: () =>
              s.data.auto
                ? this.confirm({
                    title: 'Начать заново?',
                    text: 'Автосохранение перезапишется на первой же контрольной точке. Ручные слоты останутся.',
                    yes: 'Начать заново',
                    onYes: () => g.newGame(),
                  })
                : g.newGame(),
          },
          { label: 'Главы', action: () => this.push('chapters') },
          { label: 'Загрузить', disabled: !s.hasAny(), action: () => this.push('load') },
          { label: 'Настройки', action: () => this.push('settings') },
          { label: 'Управление', action: () => this.push('controls') },
        ],
      };
    }

    screen_chapters() {
      const g = this.game;
      const items = g.chapters.map((c) => ({
        label: `${c.title}. ${c.subtitle}`,
        sub: g.saves.isDone(c.id) ? 'Пройдена' : 'Ещё не пройдена',
        action: () => g.startChapter(c.id),
      }));
      items.push({ label: 'Назад', action: () => this.pop() });
      return { kind: 'list', title: 'Главы', text: 'Любую главу можно начать с самого начала.', items };
    }

    screen_pause() {
      const g = this.game;
      return {
        kind: 'pause',
        title: 'Пауза',
        onBack: () => g.resume(),
        items: [
          { label: 'Продолжить', action: () => g.resume() },
          { label: 'Сохранить игру', action: () => this.push('save') },
          { label: 'Загрузить', disabled: !g.saves.hasAny(), action: () => this.push('load') },
          { label: 'Вернуться к контрольной точке', action: () => g.restartCheckpoint() },
          { label: 'Настройки', action: () => this.push('settings') },
          { label: 'Управление', action: () => this.push('controls') },
          {
            label: 'Выйти в главное меню',
            action: () =>
              this.confirm({
                title: 'Выйти в главное меню?',
                text: 'Прогресс до последней контрольной точки уже сохранён автоматически.',
                yes: 'Выйти',
                onYes: () => g.toTitle(),
              }),
          },
        ],
      };
    }

    screen_save() {
      const g = this.game;
      const s = g.saves;
      const items = [];
      for (let i = 0; i < s.slotCount; i++) {
        const rec = s.get(i);
        items.push({
          type: 'slot',
          label: `Слот ${i + 1}`,
          sub: rec ? this.describe(rec) : 'Пусто',
          action: () => {
            if (!rec) return g.saveTo(i);
            this.confirm({
              title: `Перезаписать слот ${i + 1}?`,
              text: 'Прежнее сохранение в этом слоте пропадёт.',
              yes: 'Перезаписать',
              onYes: () => g.saveTo(i),
            });
          },
          onErase: rec ? () => this.eraseSlot(i) : null,
        });
      }
      items.push({ label: 'Назад', action: () => this.pop() });
      return {
        kind: 'list',
        title: 'Сохранить игру',
        text: 'В слот записывается последняя пройденная контрольная точка.',
        erase: true,
        items,
      };
    }

    screen_load() {
      const g = this.game;
      const s = g.saves;
      const auto = s.get('auto');
      const items = [
        {
          type: 'slot',
          label: 'Автосохранение',
          sub: auto ? this.describe(auto) : 'Пусто',
          disabled: !auto,
          action: () => this.loadSlot('auto'),
        },
      ];
      for (let i = 0; i < s.slotCount; i++) {
        const rec = s.get(i);
        items.push({
          type: 'slot',
          label: `Слот ${i + 1}`,
          sub: rec ? this.describe(rec) : 'Пусто',
          disabled: !rec,
          action: () => this.loadSlot(i),
          onErase: rec ? () => this.eraseSlot(i) : null,
        });
      }
      items.push({ label: 'Назад', action: () => this.pop() });
      return { kind: 'list', title: 'Загрузить', erase: true, items };
    }

    loadSlot(key) {
      const g = this.game;
      if (g.state !== 'paused') return g.loadFrom(key);
      this.confirm({
        title: 'Загрузить сохранение?',
        text: 'Игра продолжится с сохранённой точки, текущий забег прервётся.',
        yes: 'Загрузить',
        onYes: () => g.loadFrom(key),
      });
    }

    eraseSlot(i) {
      const g = this.game;
      this.confirm({
        title: `Удалить слот ${i + 1}?`,
        text: 'Сохранение исчезнет навсегда.',
        yes: 'Удалить',
        onYes: () => {
          g.saves.remove(i);
          this.toast(`Слот ${i + 1} удалён`);
          this.refresh();
        },
      });
    }

    screen_settings() {
      const g = this.game;
      const st = g.saves.settings;
      const set = (key, value) => {
        st[key] = value;
        g.saves.saveSettings();
        g.applySettings();
      };
      return {
        kind: 'list',
        title: 'Настройки',
        adjust: true,
        items: [
          { type: 'slider', label: 'Общая громкость', value: st.master, onChange: (v) => set('master', v) },
          { type: 'slider', label: 'Звуки', value: st.sfx, onChange: (v) => set('sfx', v) },
          { type: 'slider', label: 'Ветер и гул', value: st.ambient, onChange: (v) => set('ambient', v) },
          { type: 'toggle', label: 'Зерно старой плёнки', value: st.grain, onChange: (v) => set('grain', v) },
          { type: 'toggle', label: 'Тряска камеры', value: st.shake, onChange: (v) => set('shake', v) },
          { type: 'toggle', label: 'Подсказки клавиш', value: st.hints, onChange: (v) => set('hints', v) },
          {
            label: document.fullscreenElement ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим',
            action: () => {
              g.toggleFullscreen();
              setTimeout(() => this.refresh(), 250);
            },
          },
          { label: 'Назад', action: () => this.pop() },
        ],
      };
    }

    screen_controls() {
      const rows = [
        [`${kbd('←')}${kbd('→')} или ${kbd('A')}${kbd('D')}`, 'идти'],
        [`${kbd('Пробел')}, ${kbd('W')} или ${kbd('↑')}`, 'прыгнуть'],
        [kbd('E'), 'нить: зацепиться за ветку, привязать предмет, отпустить'],
        [`удерживать ${kbd('E')}`, 'тянуть ящик за собой'],
        [`${kbd('W')} и ${kbd('S')}`, 'на нити: подняться или спуститься'],
        [kbd('Пробел'), 'на нити: отпустить и прыгнуть'],
        [`${kbd('Esc')} или ${kbd('P')}`, 'пауза и меню'],
        [kbd('F'), 'полный экран'],
      ];
      const html =
        `<dl class="controls">${rows.map(([k, v]) => `<div class="controls__row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` +
        `<p class="menu__note">Клавиши работают в любой раскладке: ${kbd('E')} и ${kbd('У')} одна и та же кнопка. ` +
        'Геймпад тоже подходит: стик ведёт героя, A прыгает, X управляет нитью, Start ставит паузу.</p>';
      return { kind: 'list', title: 'Управление', html, items: [{ label: 'Назад', action: () => this.pop() }] };
    }

    screen_confirm(p) {
      return {
        kind: 'confirm',
        title: p.title,
        text: p.text,
        items: [
          {
            label: p.yes || 'Да',
            action: () => {
              this.pop();
              p.onYes();
            },
          },
          { label: 'Отмена', action: () => this.pop() },
        ],
      };
    }

    screen_end() {
      const g = this.game;
      const deaths = g.world.deaths;
      const next = g.nextChapter();
      const endText = (g.level.endText || 'Нить уходит дальше.') + (next ? '' : ' Продолжение следует.');
      const html = `<div class="end">
          <p class="end__kicker">${esc(g.level.title)}</p>
          <p class="end__title">${esc(g.level.subtitle)}</p>
          <p class="end__text">${esc(endText)}</p>
          <dl class="end__stats">
            <div><dt>Время в пути</dt><dd>${U.formatTime(g.playTime)}</dd></div>
            <div><dt>${esc(U.plural(deaths, ['Смерть', 'Смерти', 'Смертей']))}</dt><dd>${deaths}</dd></div>
          </dl>
        </div>`;
      return {
        kind: 'end',
        html,
        items: [
          ...(next ? [{ label: `Дальше: ${next.title}. ${next.subtitle}`, action: () => g.startChapter(next.id) }] : []),
          { label: 'В главное меню', action: () => g.toTitle() },
          { label: 'Пройти главу заново', action: () => g.startChapter(g.level.id) },
        ],
      };
    }

    // Финал всей игры — на белом
    screen_finale() {
      const g = this.game;
      const s = g.saves.totals();
      const stats = s.count
        ? `<dl class="end__stats">
            <div><dt>Глав пройдено</dt><dd>${s.count} из ${g.chapters.length}</dd></div>
            <div><dt>Время в пути</dt><dd>${U.formatTime(s.time)}</dd></div>
            <div><dt>${esc(U.plural(s.deaths, ['Смерть', 'Смерти', 'Смертей']))}</dt><dd>${s.deaths}</dd></div>
          </dl>`
        : '';
      const html = `<div class="end">
          <p class="end__kicker">Нить</p>
          <p class="end__title">Конец</p>
          <p class="end__text">${esc(g.level.endText || '')}</p>
          ${stats}
          <p class="end__credits">В игре нет ни одной картинки и ни одного звукового файла: лес, болото, город и нить нарисованы кодом, а звуки собраны прямо в браузере.</p>
        </div>`;
      return {
        kind: 'finale',
        html,
        items: [
          { label: 'В главное меню', action: () => g.toTitle() },
          { label: 'Пройти главу заново', action: () => g.startChapter(g.level.id) },
        ],
      };
    }

    /* ---------- мелкие элементы поверх игры ---------- */

    // Единственное слово за всю игру
    showWord(text, ms) {
      const el = document.getElementById('word');
      if (!el) return;
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(this.timers.word);
      this.timers.word = setTimeout(() => el.classList.remove('show'), ms || 4000);
    }

    chapterCard(kicker, title) {
      this.card.querySelector('.cc-kicker').textContent = kicker;
      this.card.querySelector('.cc-title').textContent = title;
      this.card.classList.add('show');
      clearTimeout(this.timers.card);
      this.timers.card = setTimeout(() => this.card.classList.remove('show'), 5200);
    }

    toast(text) {
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      clearTimeout(this.timers.toast);
      this.timers.toast = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
    }

    savingFlash() {
      this.savingEl.classList.add('show');
      clearTimeout(this.timers.saving);
      this.timers.saving = setTimeout(() => this.savingEl.classList.remove('show'), 1900);
    }

    showHint(delay) {
      this.hideHint();
      this.hintEl.innerHTML = [
        `${kbd('←')}${kbd('→')} идти`,
        `${kbd('Пробел')} прыжок`,
        `${kbd('E')} нить`,
        `${kbd('Esc')} меню`,
      ]
        .map((p) => `<span>${p}</span>`)
        .join('');
      this.timers.hint = setTimeout(() => {
        this.hintEl.classList.add('show');
        this.timers.hintOff = setTimeout(() => this.hideHint(), 9000);
      }, (delay || 0) * 1000);
    }

    hideHint() {
      clearTimeout(this.timers.hint);
      clearTimeout(this.timers.hintOff);
      this.hintEl.classList.remove('show');
    }

    ready() {
      this.bootEl.classList.add('is-hidden');
    }

    fatal(title, message) {
      this.bootEl.classList.remove('is-hidden');
      this.bootEl.innerHTML = `<p class="boot__title">${esc(title)}</p><p class="boot__text">${esc(message)}</p>`;
    }
  }

  NIT.UI = UI;
})();
