/* =========================================================
   НИТЬ — отрисовка
   Логическое разрешение 960×540, масштабируется под окно.
   Порядок слоёв: небо → дальний лес → туман → средний лес →
   существо → ближний лес → игровой слой (чёрные силуэты) →
   передний план → плёнка (виньетка, зерно, царапины).
   Вся графика процедурная: ни одной картинки.
   ========================================================= */
(function () {
  'use strict';
  const NIT = window.NIT;
  const U = NIT.U;
  const W = 960;
  const H = 540;
  const INK = '#050505';

  // Многоугольник с единым направлением обхода: перекрывающиеся
  // части одного Path2D не «вырезают» друг друга
  function addPoly(path, pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const list = area > 0 ? pts.slice().reverse() : pts;
    path.moveTo(list[0][0], list[0][1]);
    for (let i = 1; i < list.length; i++) path.lineTo(list[i][0], list[i][1]);
    path.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.k = 1;
      this.dpr = 1;
      this.frame = 0;
      this.settings = { grain: true, hints: true };
      this.level = null;
      this.resize();
      this.makeTextures();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const body = document.body;
      const vw = (body && body.clientWidth) || window.innerWidth;
      const vh = (body && body.clientHeight) || window.innerHeight;
      const s = Math.min(vw / W, vh / H);
      const cw = Math.max(1, Math.floor(W * s));
      const ch = Math.max(1, Math.floor(H * s));
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.style.width = cw + 'px';
      this.canvas.style.height = ch + 'px';
      this.canvas.width = Math.round(cw * this.dpr);
      this.canvas.height = Math.round(ch * this.dpr);
      this.k = this.canvas.width / W;
      const st = document.documentElement.style;
      st.setProperty('--gw', cw + 'px');
      st.setProperty('--gh', ch + 'px');
      st.setProperty('--u', (cw / W).toFixed(4) + 'px');
    }

    /* ---------- текстуры и градиенты ---------- */

    makeTextures() {
      const ctx = this.ctx;

      // Туман: мягкие пятна, бесшовные по горизонтали
      const fog = document.createElement('canvas');
      fog.width = 1024;
      fog.height = 256;
      const f = fog.getContext('2d');
      const rnd = U.rng(11);
      for (let i = 0; i < 80; i++) {
        const x = rnd() * 1024;
        const y = 40 + rnd() * 176;
        const r = 40 + rnd() * 120;
        for (const ox of [-1024, 0, 1024]) {
          const g = f.createRadialGradient(x + ox, y, 0, x + ox, y, r);
          g.addColorStop(0, 'rgba(232,232,225,0.18)');
          g.addColorStop(1, 'rgba(232,232,225,0)');
          f.fillStyle = g;
          f.fillRect(x + ox - r, y - r, r * 2, r * 2);
        }
      }
      this.fogTex = fog;

      // Зерно старой плёнки — несколько кадров шума
      this.grain = [];
      for (let n = 0; n < 4; n++) {
        const c = document.createElement('canvas');
        c.width = c.height = 160;
        const g = c.getContext('2d');
        const img = g.createImageData(160, 160);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        this.grain.push(ctx.createPattern(c, 'repeat'));
      }

      this.sky = ctx.createLinearGradient(0, 0, 0, H);
      this.sky.addColorStop(0, '#5d5d59');
      this.sky.addColorStop(0.42, '#c3c2bb');
      this.sky.addColorStop(0.72, '#aeada6');
      this.sky.addColorStop(1, '#73726d');

      this.glow = ctx.createRadialGradient(W * 0.62, H * 0.3, 10, W * 0.62, H * 0.3, W * 0.6);
      this.glow.addColorStop(0, 'rgba(244,244,236,0.55)');
      this.glow.addColorStop(1, 'rgba(244,244,236,0)');

      this.mist = ctx.createLinearGradient(0, H * 0.55, 0, H);
      this.mist.addColorStop(0, 'rgba(206,205,198,0)');
      this.mist.addColorStop(1, 'rgba(206,205,198,0.55)');

      this.vignette = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.52, W * 0.68);
      this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
      this.vignette.addColorStop(0.65, 'rgba(0,0,0,0.22)');
      this.vignette.addColorStop(1, 'rgba(0,0,0,0.82)');

      // Темнота в пропастях (в мировых координатах)
      this.pit = ctx.createLinearGradient(0, 470, 0, 760);
      this.pit.addColorStop(0, 'rgba(0,0,0,0)');
      this.pit.addColorStop(1, 'rgba(0,0,0,1)');
    }

    /* ---------- подготовка уровня ---------- */

    setLevel(level) {
      this.level = level;
      const rnd = U.rng(level.seed || 1);
      const span = (f) => level.width * f + W + 600;
      // Болото: редкие сухие деревья, лианы и камыш вдоль воды
      const swamp = level.biome === 'swamp';
      const layerCfg = swamp
        ? [
            { f: 0.16, color: '#9c9d97', w: [3, 8], gap: [34, 110], h: [480, 760], base: 462, branches: 1, ground: 470, reeds: 0.35 },
            { f: 0.36, color: '#72736d', w: [6, 14], gap: [70, 200], h: [560, 820], base: 474, branches: 2, ground: 482, vines: 0.55, reeds: 0.6 },
            { f: 0.62, color: '#383936', w: [12, 26], gap: [170, 360], h: [620, 900], base: 486, branches: 3, ground: 494, vines: 0.6, reeds: 0.9 },
          ]
        : [
            { f: 0.16, color: '#a2a29b', w: [4, 11], gap: [22, 78], h: [650, 900], base: 450, branches: 2, ground: 468 },
            { f: 0.36, color: '#7b7b75', w: [8, 18], gap: [48, 150], h: [700, 950], base: 462, branches: 3, ground: 480 },
            { f: 0.62, color: '#3e3e3b', w: [15, 34], gap: [120, 300], h: [760, 1000], base: 474, branches: 4, vines: 0.35, ground: 492 },
          ];
      // Город: крыши, трубы и шестерни вместо деревьев
      const city = level.biome === 'city';
      const cityCfg = [
        { f: 0.16, color: '#a3a39d', w: [40, 110], gap: [24, 80], h: [140, 320], base: 470, ground: 470 },
        { f: 0.36, color: '#7a7a74', w: [50, 120], gap: [40, 130], h: [90, 230], base: 482, ground: 482 },
        { f: 0.62, color: '#3b3b38', w: [60, 140], gap: [150, 340], h: [70, 190], base: 494, ground: 494 },
      ];
      this.layers = city
        ? cityCfg.map((c) => this.cityLayer(rnd, c, span(c.f), level))
        : layerCfg.map((c) => this.treeLayer(rnd, c, span(c.f)));
      this.hazes = [0.26, 0.2, 0.1];

      this.solidPaths = level.solids.map((s) => ({ s, path: this.solidPath(s, rnd, level) }));
      this.hookTrees = (level.entities || []).filter((e) => e.type === 'hook').map((h) => this.hookTree(h, level, rnd));
      this.treePaths = {};
      for (const e of level.entities || []) if (e.type === 'tree') this.treePaths[e.id] = this.fallingTreePath(e, rnd);
      this.stumpBase = new Path2D();
      addPoly(this.stumpBase, [[-24, 3], [-11, -6], [-9, -13], [-3, -10], [2, -15], [8, -11], [11, -6], [24, 3]]);

      const decor = level.decor || {};
      this.grass = (decor.grass || []).map((g) => this.grassPatch(g, level, rnd));
      this.decorItems = this.staticDecor(level, decor, rnd);
      this.puddles = decor.puddles || [];
      // Дети без нити стоят в ближнем фоновом слое (параллакс 0.62)
      this.children = (decor.children || []).map((c) => ({ x: (c.x - W / 2) * 0.62 + W / 2, y: c.y || 490 }));
      this.fg = this.foreground(level, rnd);
      this.rays = [];
      for (let x = 150; x < level.width * 0.3 + W; x += 650 + rnd() * 700) {
        this.rays.push({ x, w: 40 + rnd() * 70, a: 0.03 + rnd() * 0.035, slant: 110 + rnd() * 130, ph: rnd() * 6 });
      }
      this.atmo = level.atmosphere && level.atmosphere.length ? level.atmosphere : [{ x: 0, light: 1, fog: 0.6 }];
      this.reedPatches = (level.reeds || []).map((r) => this.reedPatch(r, level, rnd));
      this.entityReeds = {};
      this.gate = decor.gate ? this.gatePath(decor.gate) : null;
      this.city = decor.city ? this.cityPath(decor.city, rnd) : null;
      this.seams = level.solids.filter((s) => s.style === 'stone').map((s) => ({ s, path: this.seamPath(s) }));
      this.lamps = (decor.lamps || []).map((l) => ({ x: l.x, y: l.y !== undefined ? l.y : this.groundAt(level, l.x), path: this.lampPath() }));
      this.room = decor.room ? { x: (decor.room.x - W / 2) * 0.62 + W / 2 } : null;
    }

    groundAt(level, x) {
      let best = null;
      for (const s of level.solids) {
        if (s.style === 'trunk' || s.style === 'hidden') continue;
        if (x >= s.x && x <= s.x + s.w && (best === null || s.y < best)) best = s.y;
      }
      return best === null ? 430 : best;
    }

    treeLayer(rnd, c, span) {
      const items = [];
      for (let x = -300; x < span; x += U.lerp(c.gap[0], c.gap[1], rnd())) {
        const w = U.lerp(c.w[0], c.w[1], rnd());
        const h = U.lerp(c.h[0], c.h[1], rnd());
        items.push({ x, y: c.base + rnd() * 14, path: this.treePath(rnd, h, w, c.branches, c.vines && rnd() < c.vines) });
      }
      const ground = new Path2D();
      const pts = [[-300, H + 300]];
      for (let x = -300; x <= span; x += 40) {
        pts.push([x, c.ground + Math.sin(x * 0.004 + c.f * 10) * 10 + Math.sin(x * 0.013) * 4]);
      }
      pts.push([span, H + 300]);
      addPoly(ground, pts);
      if (c.reeds) {
        // Камыш вдоль кромки болота
        const gy = (x) => c.ground + Math.sin(x * 0.004 + c.f * 10) * 10 + Math.sin(x * 0.013) * 4;
        for (let x = -300; x < span; x += 5 + rnd() * 11) {
          if (rnd() > c.reeds * 0.6) continue;
          const h = (10 + rnd() * 26) * (0.6 + c.f);
          const lean = (rnd() - 0.5) * 6;
          addPoly(ground, [[x - 1.1, gy(x) + 3], [x + lean, gy(x) - h], [x + 1.1, gy(x) + 3]]);
        }
      }
      return { f: c.f, color: c.color, items, ground };
    }

    treePath(rnd, h, w, branches, vine) {
      const p = new Path2D();
      const bend = (rnd() - 0.5) * w * 2.2;
      const left = [];
      const right = [];
      const centerAt = (t) => Math.sin(t * Math.PI * 0.8) * bend;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const half = (w * (1 - t * 0.45)) / 2 + (i === 0 ? w * 0.45 : 0);
        left.push([centerAt(t) - half, -h * t]);
        right.push([centerAt(t) + half, -h * t]);
      }
      addPoly(p, [[left[0][0] - w * 0.4, 8]].concat(left, right.slice().reverse(), [[right[0][0] + w * 0.4, 8]]));
      for (let i = 0; i < branches; i++) {
        const t = 0.22 + rnd() * 0.6;
        const side = rnd() < 0.5 ? -1 : 1;
        const ang = -Math.PI / 2 + side * (0.6 + rnd() * 0.75);
        const len = (30 + rnd() * 70) * Math.max(0.6, w / 20);
        this.branch(p, centerAt(t) + side * w * 0.25, -h * t, ang, len, Math.max(1.2, w * 0.17), 2, rnd);
      }
      if (vine) {
        // Ветка с висящей лианой
        const t = 0.3 + rnd() * 0.22;
        const side = rnd() < 0.5 ? -1 : 1;
        const ang = side > 0 ? -0.25 : Math.PI + 0.25;
        const len = 40 + rnd() * 50;
        const x0 = centerAt(t);
        const y0 = -h * t;
        this.branch(p, x0, y0, ang, len, 2.4, 0, rnd);
        const ex = x0 + Math.cos(ang) * len * 0.85;
        const ey = y0 + Math.sin(ang) * len * 0.85;
        const vl = 60 + rnd() * 110;
        addPoly(p, [[ex - 0.9, ey], [ex + 0.9, ey], [ex + 4, ey + vl], [ex + 2, ey + vl]]);
      }
      return p;
    }

    branch(p, x, y, ang, len, w, depth, rnd) {
      const ex = x + Math.cos(ang) * len;
      const ey = y + Math.sin(ang) * len;
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      addPoly(p, [
        [x + nx * w, y + ny * w],
        [ex + nx * w * 0.15, ey + ny * w * 0.15],
        [ex - nx * w * 0.15, ey - ny * w * 0.15],
        [x - nx * w, y - ny * w],
      ]);
      if (depth > 0) {
        const n = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) {
          const t = 0.35 + rnd() * 0.55;
          this.branch(p, U.lerp(x, ex, t), U.lerp(y, ey, t), ang + (rnd() - 0.5) * 1.3, len * (0.3 + rnd() * 0.35), w * 0.5, depth - 1, rnd);
        }
      }
    }

    solidPath(s, rnd, level) {
      if (s.style === 'hidden') return null;
      if (s.style === 'floor') {
        const fp = new Path2D();
        addPoly(fp, [[s.x, s.y + s.h], [s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h]]);
        return fp;
      }
      if (s.style === 'stone' || s.style === 'wall') return this.stonePath(s, rnd);
      if (s.style === 'log') return this.logObstaclePath(s, rnd);
      if (s.style === 'trunk') return this.wallTrunkPath(s, rnd, level);
      const p = new Path2D();
      const top = s.y;
      const L = s.x;
      const R = s.x + s.w;
      const B = s.y + s.h;
      const pts = [[L, B]];
      for (let y = B; y > top + 8; y -= 14) pts.push([L + (rnd() - 0.5) * 3.5, y]);
      pts.push([L - 0.5, top + 2]);
      // Неровная кромка с травинками
      let x = L;
      while (x < R - 3) {
        const nx = Math.min(R, x + 4 + rnd() * 9);
        if (rnd() < 0.42 && nx < R - 6) {
          const bh = 4 + rnd() * 10;
          const lean = (rnd() - 0.5) * 5;
          pts.push([x + 1, top - rnd() * 1.2], [x + 1.7 + lean, top - bh], [x + 2.6, top - rnd() * 1.2]);
        } else {
          pts.push([nx, top - rnd() * 2.4]);
        }
        x = nx;
      }
      pts.push([R + 0.5, top + 2]);
      for (let y = top + 8; y < B; y += 14) pts.push([R + (rnd() - 0.5) * 3.5, y]);
      pts.push([R, B]);
      addPoly(p, pts);
      return p;
    }

    logObstaclePath(s, rnd) {
      const p = new Path2D();
      const r = s.h / 2;
      const cy = s.y + r;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI;
        pts.push([s.x + r + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      for (let x = s.x + r; x < s.x + s.w - r; x += 6) pts.push([x, s.y - rnd() * 1.5]);
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI;
        pts.push([s.x + s.w - r + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      addPoly(p, pts);
      this.branch(p, s.x + s.w * 0.3, s.y + 2, -Math.PI / 2 - 0.5, 16, 2.5, 0, rnd);
      this.branch(p, s.x + s.w * 0.72, s.y + 3, -Math.PI / 2 + 0.7, 11, 2, 0, rnd);
      return p;
    }

    // Огромный ствол на краю мира
    wallTrunkPath(s, rnd, level) {
      const p = new Path2D();
      const leftWall = s.x + s.w / 2 < level.width / 2;
      const inner = leftWall ? s.x + s.w : s.x;
      const outer = leftWall ? s.x - 40 : s.x + s.w + 40;
      const dir = leftWall ? 1 : -1;
      const ground = 430;
      const pts = [[outer, s.y + s.h], [outer, s.y]];
      for (let y = s.y; y < ground - 40; y += 30) pts.push([inner + dir * (Math.sin(y * 0.01) * 6 + rnd() * 3), y]);
      pts.push([inner + dir * 14, ground - 30], [inner + dir * 44, ground - 6], [inner + dir * 80, ground + 2], [inner, ground + 40], [inner, s.y + s.h]);
      addPoly(p, pts);
      for (let i = 0; i < 4; i++) {
        const y = -40 + i * 75 + rnd() * 30;
        const ang = leftWall ? -0.4 - rnd() * 0.5 : Math.PI + 0.4 + rnd() * 0.5;
        this.branch(p, inner, y, ang, 60 + rnd() * 80, 5, 2, rnd);
      }
      return p;
    }

    // Дерево с веткой, за которую цепляется нить
    hookTree(h, level, rnd) {
      const p = new Path2D();
      const tx = h.trunkX;
      const gy = this.groundAt(level, tx);
      const pts = [[tx - 20, gy + 6], [tx - 15, gy - 60]];
      for (let y = gy - 100; y > -700; y -= 60) pts.push([tx - 13 + Math.sin(y * 0.01) * 3, y]);
      pts.push([tx - 9, -760], [tx + 9, -760]);
      for (let y = -700; y < gy - 100; y += 60) pts.push([tx + 13 + Math.sin(y * 0.01) * 3, y]);
      pts.push([tx + 15, gy - 60], [tx + 22, gy + 6]);
      addPoly(p, pts);

      // Ветка изгибается от ствола к точке зацепа
      const dirx = Math.sign(h.x - tx) || -1;
      const bx0 = tx + dirx * 8;
      const by0 = h.branchY;
      const cxp = (bx0 + h.x) / 2;
      const cyp = Math.min(by0, h.y) - 18;
      const upper = [];
      const lower = [];
      const curve = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const x = (1 - t) * (1 - t) * bx0 + 2 * (1 - t) * t * cxp + t * t * h.x;
        const y = (1 - t) * (1 - t) * by0 + 2 * (1 - t) * t * cyp + t * t * h.y;
        const w = U.lerp(7, 2.2, t);
        upper.push([x, y - w]);
        lower.push([x, y + w]);
        curve.push([x, y]);
      }
      addPoly(p, upper.concat(lower.reverse()));
      // Развилка на конце
      this.branch(p, h.x, h.y, -Math.PI / 2 - dirx * 0.5, 16, 1.6, 0, rnd);
      this.branch(p, h.x, h.y, dirx > 0 ? -0.15 : Math.PI + 0.15, 14, 1.5, 0, rnd);
      // Сухие веточки вдоль ветки и выше по стволу
      for (let i = 0; i < 4; i++) {
        const q = curve[3 + Math.floor(rnd() * 9)];
        this.branch(p, q[0], q[1], (rnd() < 0.5 ? -1 : 1) * (Math.PI / 2) + (rnd() - 0.5) * 0.8, 10 + rnd() * 18, 1.6, 1, rnd);
      }
      for (let i = 0; i < 3; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        this.branch(p, tx, by0 - 60 - i * 70 - rnd() * 30, -Math.PI / 2 + side * (0.7 + rnd() * 0.5), 40 + rnd() * 60, 4, 2, rnd);
      }
      return { x: tx, path: p };
    }

    fallingTreePath(e, rnd) {
      const p = new Path2D();
      const h = e.height || 230;
      const w = e.thick || 22;
      const left = [];
      const right = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const half = U.lerp(w / 2, 3, t);
        const off = Math.sin(t * 3) * 2;
        left.push([off - half, -h * t]);
        right.push([off + half, -h * t]);
      }
      addPoly(p, left.concat(right.reverse()));
      for (let i = 0; i < 5; i++) {
        const t = 0.35 + rnd() * 0.55;
        const side = i % 2 ? 1 : -1;
        this.branch(p, side * 2, -h * t, -Math.PI / 2 + side * (0.5 + rnd() * 0.6), 18 + rnd() * 30, 2.2, 1, rnd);
      }
      return p;
    }

    grassPatch(g, level, rnd) {
      const p = new Path2D();
      const base = this.groundAt(level, g.x + g.w / 2);
      const n = Math.max(3, Math.round(g.w * (g.density || 1) * 0.45));
      for (let i = 0; i < n; i++) {
        const x = rnd() * g.w;
        const h = g.h * (0.45 + rnd() * 0.85);
        const lean = (rnd() - 0.5) * g.h * 0.6;
        const bw = 0.9 + rnd() * 1.3;
        addPoly(p, [[x - bw, 3], [x + lean, -h], [x + bw, 3]]);
      }
      return { x: g.x, w: g.w, y: base, path: p, ph: rnd() * 6 };
    }

    staticDecor(level, decor, rnd) {
      const items = [];
      const avoid = (level.entities || []).filter((e) => e.type === 'trap' || e.type === 'box').map((e) => e.x);
      for (const s of decor.stumps || []) {
        const p = new Path2D();
        const h = s.h || 20;
        const w = 18 + rnd() * 10;
        addPoly(p, [[-w / 2 - 8, 3], [-w / 2, -h * 0.4], [-w / 2 + 1, -h], [-w / 4, -h + 3 + rnd() * 3], [0, -h - 2], [w / 4, -h + 2], [w / 2, -h - 1], [w / 2, -h * 0.4], [w / 2 + 9, 3]]);
        items.push({ x: s.x, y: s.y, path: p });
      }
      for (const s of level.solids) {
        if (s.style || s.w < 200) continue;
        for (let x = s.x + 60 + rnd() * 120; x < s.x + s.w - 40; x += 140 + rnd() * 260) {
          if (x < 40 || avoid.some((a) => Math.abs(a - x) < 70)) continue;
          const p = new Path2D();
          if (rnd() < 0.5) {
            // камень
            const w = 10 + rnd() * 16;
            const h = 5 + rnd() * 7;
            const pts = [];
            for (let i = 0; i <= 8; i++) {
              const a = Math.PI + (i / 8) * Math.PI;
              pts.push([(Math.cos(a) * w) / 2, Math.sin(a) * h + 2]);
            }
            addPoly(p, pts);
          } else {
            // сорняк
            const n = 2 + Math.floor(rnd() * 3);
            for (let i = 0; i < n; i++) {
              const hh = 12 + rnd() * 16;
              const lean = (rnd() - 0.5) * 10;
              const bx = (rnd() - 0.5) * 6;
              addPoly(p, [[bx - 1, 2], [bx + lean, -hh], [bx + 1, 2]]);
            }
          }
          items.push({ x, y: s.y, path: p });
        }
      }
      return items;
    }

    foreground(level, rnd) {
      const items = [];
      for (let x = 500; x < level.width * 1.3 + W; x += 520 + rnd() * 700) {
        const p = new Path2D();
        const kind = rnd();
        if (kind < 0.22) {
          // толстый ствол совсем рядом с камерой
          const w = 60 + rnd() * 50;
          addPoly(p, [[-w / 2 - 10, H + 40], [-w / 2, 300], [-w / 2 + 6, -40], [w / 2 - 4, -40], [w / 2, 320], [w / 2 + 14, H + 40]]);
          this.branch(p, w * 0.4, 120 + rnd() * 80, -0.5, 80 + rnd() * 60, 6, 2, rnd);
        } else if (kind < 0.6) {
          // ветви, свисающие сверху: растут из-за края кадра
          const n = 3 + Math.floor(rnd() * 3);
          for (let i = 0; i < n; i++) this.branch(p, -90 + rnd() * 200, -40, Math.PI / 2 + (rnd() - 0.5) * 0.9, 70 + rnd() * 120, 4, 2, rnd);
        } else {
          // кусты у нижнего края кадра
          const pts = [[-160, H + 40]];
          for (let i = 0; i <= 14; i++) pts.push([-160 + i * 23, H - 18 - rnd() * 30 - Math.sin((i / 14) * Math.PI) * 26]);
          pts.push([162, H + 40]);
          addPoly(p, pts);
        }
        items.push({ x, path: p });
      }
      return items;
    }

    atmosphere(x, world) {
      const a = this.atmo;
      let lo = a[0];
      let hi = a[a.length - 1];
      for (let i = 0; i < a.length - 1; i++) {
        if (x >= a[i].x && x <= a[i + 1].x) {
          lo = a[i];
          hi = a[i + 1];
          break;
        }
      }
      const t = hi.x === lo.x ? 0 : U.clamp((x - lo.x) / (hi.x - lo.x), 0, 1);
      const v = (o, key, d) => (o[key] !== undefined ? o[key] : d);
      return {
        light: U.lerp(lo.light, hi.light, t),
        fog: U.lerp(lo.fog, hi.fog, t) + world.fog,
        thread: U.lerp(v(lo, 'thread', 1), v(hi, 'thread', 1), t), // сила нити
        soft: U.lerp(v(lo, 'soft', 0), v(hi, 'soft', 0), t), // мягкость силуэтов в белой комнате
      };
    }

    /* ---------- кадр ---------- */

    render(world) {
      if (!world || !this.level) return;
      const ctx = this.ctx;
      this.frame++;
      const cam = world.camera;
      const cx = cam.x + cam.shakeX;
      const cy = cam.y + cam.shakeY;
      const atm = this.atmosphere(cam.x + W / 2, world);
      const t = world.time;

      ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.fillStyle = this.sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = this.glow;
      ctx.fillRect(0, 0, W, H);
      this.drawRays(ctx, cx, t, atm);

      const haze = (i) => {
        ctx.fillStyle = `rgba(201,200,193,${(this.hazes[i] * (0.6 + atm.fog * 0.6)).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      };
      this.drawLayer(ctx, this.layers[0], cx, cy, t);
      haze(0);
      if (this.city) this.drawCity(ctx, cx, cy);
      this.drawFog(ctx, cx, cy, t, 0.2, 250, 0.5 * atm.fog);
      this.drawLayer(ctx, this.layers[1], cx, cy, t);
      haze(1);
      this.drawFog(ctx, cx, cy, t, 0.45, 300, 0.45 * atm.fog);
      this.drawCreature(ctx, world, cx, cy);
      this.drawWatchers(ctx, world, cx, cy);
      this.drawLayer(ctx, this.layers[2], cx, cy, t);
      this.drawChildren(ctx, cx, cy, t);
      if (this.room) this.drawRoom(ctx, world, cx, cy);
      haze(2);
      this.drawFog(ctx, cx, cy, t, 0.8, 350, 0.35 * atm.fog);
      this.drawGrade(ctx, atm);

      ctx.save();
      ctx.translate(-cx, -cy);
      this.drawWorld(ctx, world, cx, atm);
      ctx.restore();
      this.drawWatcherLights(ctx, world, cx, cy);

      this.drawForeground(ctx, cx);
      this.drawPost(ctx, world, atm);
    }

    drawLayer(ctx, layer, cx, cy, t) {
      const ox = cx * layer.f;
      const oy = cy * layer.f * 0.6;
      ctx.save();
      ctx.fillStyle = layer.color;
      ctx.translate(-ox, -oy);
      ctx.fill(layer.ground);
      for (const it of layer.items) {
        const sx = it.x - ox;
        if (sx < -300 || sx > W + 300) continue;
        ctx.translate(it.x, it.y);
        ctx.fill(it.path);
        ctx.translate(-it.x, -it.y);
      }
      // Шестерни города медленно вращаются
      for (const g of layer.gears || []) {
        const sx = g.x - ox;
        if (sx < -200 || sx > W + 200) continue;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate((t || 0) * g.spin);
        ctx.fill(g.path);
        ctx.restore();
      }
      ctx.restore();
    }

    drawFog(ctx, cx, cy, t, f, y, alpha) {
      if (alpha <= 0.01) return;
      const tw = 1024 * 1.25;
      const th = 256 * 1.25;
      let off = (cx * f + t * (6 + f * 10)) % tw;
      if (off < 0) off += tw;
      ctx.globalAlpha = U.clamp(alpha, 0, 1);
      const yy = y - th / 2 - cy * f * 0.5;
      for (let x = -off; x < W; x += tw) ctx.drawImage(this.fogTex, x, yy, tw, th);
      ctx.globalAlpha = 1;
    }

    drawRays(ctx, cx, t, atm) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rays) {
        const sx = r.x - cx * 0.3;
        if (sx < -420 || sx > W + 200) continue;
        const a = r.a * (0.75 + Math.sin(t * 0.3 + r.ph) * 0.25) * Math.min(1.2, atm.light);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, `rgba(255,255,248,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,248,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx, -10);
        ctx.lineTo(sx + r.w, -10);
        ctx.lineTo(sx + r.w + r.slant + 60, H);
        ctx.lineTo(sx + r.slant, H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawGrade(ctx, atm) {
      const l = atm.light;
      if (l < 0.999) {
        ctx.fillStyle = `rgba(0,0,0,${((1 - l) * 0.9).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      } else if (l > 1.001) {
        ctx.fillStyle = `rgba(240,240,233,${((l - 1) * 0.9).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    drawCreature(ctx, world, cx, cy) {
      const c = world.creature;
      if (!c || !c.active) return;
      const ox = cx * c.factor;
      const oy = cy * c.factor * 0.6;
      ctx.save();
      ctx.translate(-ox, -oy);
      ctx.strokeStyle = '#393936';
      ctx.fillStyle = '#393936';
      // Длинные тонкие ноги с коленями выше тела
      for (const l of c.legs) {
        const hx = c.lx + l.home * 0.35;
        const hy = c.ly + 26;
        const kx = (hx + l.fx) / 2 + l.side * 24;
        const ky = c.ly - l.knee;
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(hx + (kx - hx) * 0.3, ky - 10, kx, ky);
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(l.fx, l.fy);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(c.lx, c.ly, 125, 44, Math.sin(c.t * 0.7) * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.lx - 70, c.ly - 22, 38, 26, -0.3, 0, Math.PI * 2);
      ctx.ellipse(c.lx + 60, c.ly + 14, 30, 22, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Что-то вроде провода, свисающего вниз
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(c.lx + 30, c.ly + 40);
      ctx.quadraticCurveTo(c.lx + 40 + Math.sin(c.t * 1.1) * 18, c.ly + 160, c.lx + 26 + Math.sin(c.t * 0.8) * 26, c.ly + 290);
      ctx.stroke();
      ctx.restore();
    }

    drawChildren(ctx, cx, cy, t) {
      const ox = cx * 0.62;
      const oy = cy * 0.62 * 0.6;
      for (const ch of this.children) {
        const sx = ch.x - ox;
        if (sx < -40 || sx > W + 40) continue;
        this.drawFigure(ctx, { x: sx, y: ch.y - oy, facing: -1, scale: 0.62, color: '#3e3e3b', t, eyes: false });
      }
    }

    /* ---------- игровой слой ---------- */

    drawWorld(ctx, world, cx, atm) {
      const x0 = cx - 60;
      const x1 = cx + W + 60;
      ctx.fillStyle = this.pit;
      ctx.fillRect(x0, 440, x1 - x0, 420);

      ctx.fillStyle = INK;
      for (const h of this.hookTrees) if (h.x > x0 - 400 && h.x < x1 + 400) ctx.fill(h.path);
      for (const e of world.entities) {
        if (e.type === 'tree' && e.x > x0 - 320 && e.x < x1 + 320) this.drawTree(ctx, e);
      }
      // Прессы и решётки уходят в потолок — рисуем их до камня
      for (const e of world.entities) {
        if (e.x === undefined || e.x < x0 - 120 || e.x > x1 + 120) continue;
        if (e.type === 'piston') this.drawPiston(ctx, e);
        else if (e.type === 'door') this.drawDoor(ctx, e);
      }
      ctx.fillStyle = INK;
      for (const sp of this.solidPaths) {
        const s = sp.s;
        if (!sp.path || s.x > x1 + 120 || s.x + s.w < x0 - 120) continue;
        ctx.fill(sp.path);
      }
      for (const d of this.decorItems) {
        if (d.x < x0 - 40 || d.x > x1 + 40) continue;
        ctx.translate(d.x, d.y);
        ctx.fill(d.path);
        ctx.translate(-d.x, -d.y);
      }
      if (this.gate) {
        ctx.fillStyle = INK;
        ctx.fill(this.gate);
      }
      if (this.seams.length) {
        ctx.strokeStyle = 'rgba(58,58,54,0.5)';
        ctx.lineWidth = 1;
        for (const sm of this.seams) if (!(sm.s.x > x1 || sm.s.x + sm.s.w < x0)) ctx.stroke(sm.path);
      }
      if (this.lamps.length) this.drawLamps(ctx, world, x0, x1);
      this.drawPuddles(ctx, world.time);
      for (const e of world.entities) {
        if (e.type === 'box') this.drawBox(ctx, e);
        else if (e.type === 'log') this.drawLog(ctx, e);
        else if (e.type === 'trap') this.drawTrap(ctx, e);
        else if (e.type === 'ghost') this.drawGhost(ctx, e, world);
        else if (e.type === 'hummock') this.drawHummock(ctx, e);
        else if (e.type === 'lever') this.drawLever(ctx, e);
        else if (e.type === 'mover') this.drawMover(ctx, e);
      }
      this.drawPlayer(ctx, world.player, world);
      this.drawWater(ctx, world, x0, x1);
      this.drawBogs(ctx, world, x0, x1);
      // В белой комнате силуэты мягчеют, а нить остаётся яркой
      if (atm && atm.soft > 0.01) {
        ctx.fillStyle = `rgba(238,237,231,${(atm.soft * 0.55).toFixed(3)})`;
        ctx.fillRect(x0 - 100, -1000, x1 - x0 + 200, 3000);
      }
      this.drawThread(ctx, world, atm);
      this.drawParticles(ctx, world);
      this.drawGrass(ctx, world.time, x0, x1);
      this.drawFrontReeds(ctx, world, x0, x1);
      this.drawGlyph(ctx, world);
    }

    drawTree(ctx, e) {
      const path = this.treePaths[e.id];
      if (!path) return;
      // Поваленный ствол лежит на земле, а не наполовину в ней
      const lift = (e.thick / 2) * Math.abs(Math.sin(e.angle));
      ctx.save();
      ctx.fillStyle = INK;
      ctx.translate(e.x, e.y - lift);
      ctx.rotate(e.angle);
      ctx.fill(path);
      ctx.restore();
      ctx.fillStyle = INK;
      ctx.translate(e.x, e.y);
      ctx.fill(this.stumpBase);
      ctx.translate(-e.x, -e.y);
    }

    drawBox(ctx, b) {
      ctx.fillStyle = INK;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(92,92,86,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 3.5, b.y + 3.5, b.w - 7, b.h - 7);
      ctx.beginPath();
      ctx.moveTo(b.x + 4, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w - 4, b.y + b.h / 2);
      ctx.moveTo(b.x + 5, b.y + 5);
      ctx.lineTo(b.x + b.w - 5, b.y + b.h - 5);
      ctx.stroke();
    }

    drawLog(ctx, l) {
      const r = l.h / 2;
      const x = l.x;
      const y = l.y + l.bob;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(x + l.w - r, y);
      ctx.arc(x + l.w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + l.w * 0.6, y + 2);
      ctx.lineTo(x + l.w * 0.65, y - 13);
      ctx.lineTo(x + l.w * 0.68, y + 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(92,92,86,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + l.w - r, y + r, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawTrap(ctx, t) {
      const x = t.x;
      const y = t.y;
      const w = t.w;
      const cx = x + w / 2;
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      ctx.fillRect(x + 3, y - 2.5, w - 6, 2.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + w - 2, y - 1);
      ctx.lineTo(x + w + 9, y - 0.5);
      ctx.stroke();
      ctx.fillRect(x + w + 8, y - 6, 2, 7);
      if (t.state === 'open') {
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y - 1);
        ctx.quadraticCurveTo(x + 3, y - 7, cx - 2, y - 2.5);
        ctx.moveTo(x + w, y - 1);
        ctx.quadraticCurveTo(x + w - 3, y - 7, cx + 2, y - 2.5);
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = x + 3 + i * 2.6;
          const b = x + w - 5 - i * 2.6;
          ctx.moveTo(a, y - 3.5 - i * 0.6);
          ctx.lineTo(a + 1, y - 7.5 - i * 0.4);
          ctx.lineTo(a + 2, y - 3.5 - i * 0.6);
          ctx.moveTo(b, y - 3.5 - i * 0.6);
          ctx.lineTo(b + 1, y - 7.5 - i * 0.4);
          ctx.lineTo(b + 2, y - 3.5 - i * 0.6);
        }
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, y - 2.5, 3, Math.PI, 0);
        ctx.fill();
      } else {
        const k = Math.min(1, t.t / 0.05);
        const hh = 15 * k;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 10, y - 2);
        ctx.quadraticCurveTo(cx - 11, y - hh, cx - 1, y - hh - 1);
        ctx.moveTo(cx + 10, y - 2);
        ctx.quadraticCurveTo(cx + 11, y - hh, cx + 1, y - hh - 1);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const yy = y - hh + 2 + i * 2.4;
          ctx.moveTo(cx - 3, yy);
          ctx.lineTo(cx + 3, yy + 1.2);
        }
        ctx.stroke();
      }
    }

    drawGhost(ctx, g, world) {
      if (g.state === 'gone' || g.alpha <= 0.01) return;
      this.drawFigure(ctx, {
        x: g.x,
        y: g.y,
        facing: world.player.cx < g.x ? -1 : 1,
        scale: 0.86,
        color: '#1d1d1c',
        alpha: g.alpha * 0.95,
        t: world.time,
        lean: Math.sin(world.time * 0.7) * 0.4,
        eyes: true,
        eyeColor: 'rgba(200,200,192,0.45)',
      });
    }

    drawPlayer(ctx, p, world) {
      const A = p.anim;
      let crouch = A.land * 0.55;
      if (p.state === 'rising' && p.riseDur < 1) crouch = Math.max(crouch, 1 - U.easeOutCubic(U.clamp(p.stateT / p.riseDur, 0, 1)));
      if (p.pushing || p.grab) crouch = Math.max(crouch, 0.25);
      // Пригибается в камыше, пока рядом шарит луч
      if (world && world.alarm > 0.3 && p.onGround && world.isHidden(p)) crouch = Math.max(crouch, 0.45);
      const lying = p.state === 'lying' || (p.state === 'rising' && p.riseDur >= 1);
      this.drawFigure(ctx, {
        x: p.cx,
        y: p.bottom,
        facing: p.facing,
        rot: p.bodyRot(),
        run: A.run,
        phase: A.phase,
        air: p.onGround || lying ? 0 : A.air,
        crouch,
        squash: A.squash,
        lean: p.pushing ? 2.5 : p.grab || p.tieTaut ? -2.5 : 0,
        hand: p.hook ? null : p.localHand(),
        swing: p.hook ? { x: (p.hook.x - p.cx) * p.facing, y: p.hook.y - p.bottom } : null,
        eyes: p.state !== 'dead',
        blink: A.blink > 0 || p.state === 'lying',
        t: A.t,
        color: INK,
        alpha: p.state === 'drowning' ? U.clamp(1 - p.stateT * 0.5, 0.25, 1) : 1,
        lying,
      });
    }

    legPose(o) {
      const c = o.crouch || 0;
      if (o.lying) return [{ a: 0.1, b: 0.25 }, { a: -0.05, b: 0.15 }];
      if (o.air) {
        const k = Math.min(1, Math.abs(o.air) * 1.5);
        const pose = o.air < 0 ? [{ a: 0.6, b: 1.25 }, { a: -0.2, b: 0.55 }] : [{ a: 0.3, b: 0.4 }, { a: -0.35, b: 0.2 }];
        return pose.map((q) => ({ a: q.a * k, b: q.b * k }));
      }
      const r = o.run || 0;
      const ph = o.phase || 0;
      const leg = (off) => ({
        a: Math.sin(ph + off) * 0.75 * r + c * 0.55,
        b: (0.1 + Math.max(0, -Math.cos(ph + off)) * 1.1) * r + c * 1.25,
      });
      return [leg(0), leg(Math.PI)];
    }

    // Силуэт ребёнка: голова, вихры, тонкие конечности. Общий для героя и «детей без нити»
    drawFigure(ctx, o) {
      const s = o.scale || 1;
      ctx.save();
      ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
      ctx.translate(o.x, o.y);
      if (o.rot) ctx.rotate(o.rot);
      ctx.scale(s * o.facing, s * (1 - (o.squash || 0) * 0.5));
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const c = o.crouch || 0;
      const run = o.run || 0;
      const breathe = Math.sin((o.t || 0) * 2.2) * 0.45 * (1 - run);
      const hipY = -15 + c * 6;
      const shX = 0.8 + (o.lean || 0);
      const shY = -28 + c * 7.5 + breathe;

      for (const L of this.legPose(o)) {
        const kx = Math.sin(L.a) * 8;
        const ky = Math.cos(L.a) * 8;
        const fx = kx + Math.sin(L.a - L.b) * 8.6;
        const fy = ky + Math.cos(L.a - L.b) * 8.6;
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(0, hipY);
        ctx.lineTo(kx, hipY + ky);
        ctx.lineTo(fx, hipY + fy);
        ctx.stroke();
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(fx - 0.5, hipY + fy);
        ctx.lineTo(fx + 2.6, hipY + fy + 0.2);
        ctx.stroke();
      }

      ctx.lineWidth = 7.4;
      ctx.beginPath();
      ctx.moveTo(0, hipY - 1);
      ctx.lineTo(shX, shY);
      ctx.stroke();

      // Рука в два звена (обратная кинематика): кисть тянется к цели
      const arm = (tx, ty) => {
        const ax = shX;
        const ay = shY + 1.5;
        let dx = tx - ax;
        let dy = ty - ay;
        let d = Math.hypot(dx, dy);
        const L1 = 7.6;
        const L2 = 7.6;
        if (d > L1 + L2 - 0.01) {
          dx *= (L1 + L2 - 0.01) / d;
          dy *= (L1 + L2 - 0.01) / d;
          d = L1 + L2 - 0.01;
        }
        d = Math.max(d, 0.5);
        const base = Math.atan2(dy, dx);
        const cosA = U.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
        const ang = base + Math.acos(cosA);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(ang) * L1, ay + Math.sin(ang) * L1);
        ctx.lineTo(ax + dx, ay + dy);
        ctx.stroke();
      };
      if (o.swing) {
        const d = Math.hypot(o.swing.x - shX, o.swing.y - shY) || 1;
        const ux = (o.swing.x - shX) / d;
        const uy = (o.swing.y - shY) / d;
        arm(shX + ux * 15, shY + uy * 15);
        arm(shX + ux * 13 - 2, shY + uy * 13 + 1);
      } else {
        const sw = Math.sin(o.phase || 0) * 0.8 * run;
        const ba = 0.15 + sw + (o.air ? 1.3 : 0);
        arm(shX + Math.sin(ba) * 13, shY + 1.5 + Math.cos(ba) * 13);
        const h = o.hand || { x: 4, y: -15 };
        arm(h.x, h.y);
      }

      const hx = shX + 1.3;
      const hy = shY - 7.4;
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy - 3);
      ctx.lineTo(hx - 4.5, hy - 10);
      ctx.lineTo(hx - 1.5, hy - 6.5);
      ctx.lineTo(hx + 1, hy - 11.5);
      ctx.lineTo(hx + 3, hy - 6.5);
      ctx.lineTo(hx + 6.5, hy - 8);
      ctx.lineTo(hx + 6.5, hy - 2);
      ctx.closePath();
      ctx.fill();
      if (o.eyes && !o.blink) {
        ctx.fillStyle = o.eyeColor || 'rgba(214,213,205,0.9)';
        ctx.beginPath();
        ctx.arc(hx + 3, hy - 0.6, 1.15, 0, Math.PI * 2);
        ctx.moveTo(hx + 6.6, hy - 0.6);
        ctx.arc(hx + 5.6, hy - 0.6, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawWater(ctx, world, x0, x1) {
      const t = world.time;
      for (const w of world.waters) {
        if (w.x > x1 || w.x + w.w < x0) continue;
        const wave = (x) => w.y + Math.sin(x * 0.05 + t * 2.2) * 1.4 + Math.sin(x * 0.11 - t * 1.3) * 0.8;
        const g = ctx.createLinearGradient(0, w.y, 0, w.y + 170);
        g.addColorStop(0, 'rgba(28,28,27,0.86)');
        g.addColorStop(1, 'rgba(3,3,3,0.97)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(w.x, wave(w.x));
        for (let x = w.x; x <= w.x + w.w; x += 8) ctx.lineTo(x, wave(x));
        ctx.lineTo(w.x + w.w, w.y + w.h);
        ctx.lineTo(w.x, w.y + w.h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(190,190,182,0.32)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w.x, wave(w.x));
        for (let x = w.x; x <= w.x + w.w; x += 8) ctx.lineTo(x, wave(x));
        ctx.stroke();
        // Течение: светлые штрихи плывут вправо
        ctx.strokeStyle = 'rgba(150,150,143,0.18)';
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const xx = w.x + ((i * 53 + t * (w.current || 0)) % w.w);
          const yy = w.y + 8 + ((i * 17) % 40);
          ctx.moveTo(xx, yy);
          ctx.lineTo(Math.min(w.x + w.w, xx + 14), yy);
        }
        ctx.stroke();
      }
    }

    drawPuddles(ctx, t) {
      for (const p of this.puddles) {
        ctx.fillStyle = 'rgba(28,28,27,0.9)';
        ctx.fillRect(p.x, p.y - 5, p.w, 5);
        ctx.strokeStyle = 'rgba(190,190,182,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        for (let x = 0; x <= p.w; x += 6) ctx.lineTo(p.x + x, p.y - 5 + Math.sin(x * 0.2 + t * 2) * 0.6);
        ctx.stroke();
      }
    }

    // Красная нить — единственный цвет в игре. Пульсирует, как сердце
    drawThread(ctx, world, atm) {
      const th = world.thread;
      if (!th.ready) return;
      const pts = th.pts;
      const ph = world.pulse !== undefined ? world.pulse % 1 : (world.time % 1.15) / 1.15;
      const beat = Math.max(Math.exp(-Math.pow((ph - 0.04) / 0.035, 2)), 0.65 * Math.exp(-Math.pow((ph - 0.2) / 0.045, 2)));
      const k = 0.35 * beat + 0.3 * th.tension;
      // Нить слабеет к концу игры и вспыхивает в финале
      const str = world.ending && world.ending.final ? 1.25 : atm && atm.thread !== undefined ? atm.thread : 1;
      const fade = U.clamp(1 - str, 0, 1) * 0.75;
      const mix = (v, g) => Math.round(v + (g - v) * fade);
      const color = `rgb(${mix(150 + 70 * k, 120)},${mix(16 + 14 * k, 104)},${mix(22 + 12 * k, 104)})`;
      ctx.save();
      ctx.globalAlpha = U.clamp(0.45 + 0.55 * str, 0.45, 1);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.7 * U.clamp(0.55 + 0.45 * str, 0.55, 1.25);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(190,20,26,0.55)';
      ctx.shadowBlur = (3 + 4 * k) * this.k * Math.min(1.3, str);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (th.pin && th.pin.t >= 1) {
        const q = pts[th.pin.i];
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawParticles(ctx, world) {
      for (const q of world.particles) {
        const a = Math.max(0, 1 - q.t / q.life);
        if (q.kind === 'bubble') {
          ctx.strokeStyle = `rgba(190,190,182,${(a * 0.6).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        if (q.kind === 'dust') ctx.fillStyle = `rgba(70,70,66,${(a * 0.7).toFixed(3)})`;
        else if (q.kind === 'drop') ctx.fillStyle = `rgba(185,185,177,${(a * 0.8).toFixed(3)})`;
        else if (q.kind === 'steam') ctx.fillStyle = `rgba(200,200,194,${(a * 0.45).toFixed(3)})`;
        else if (q.kind === 'mud') ctx.fillStyle = `rgba(16,16,15,${(a * 0.9).toFixed(3)})`;
        else if (q.kind === 'ash') ctx.fillStyle = `rgba(28,28,27,${(a * 0.85).toFixed(3)})`;
        else if (q.kind === 'leaf') ctx.fillStyle = `rgba(12,12,12,${Math.min(1, a * 4, q.t * 2).toFixed(3)})`;
        else ctx.fillStyle = INK;
        ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      }
    }

    drawGrass(ctx, t, x0, x1) {
      ctx.fillStyle = INK;
      for (const g of this.grass) {
        if (g.x > x1 || g.x + g.w < x0) continue;
        const sway = Math.sin(t * 1.3 + g.ph) * 0.06;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.transform(1, 0, sway, 1, 0, 0);
        ctx.fill(g.path);
        ctx.restore();
      }
    }

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Подсказка клавиши над объектом
    drawGlyph(ctx, world) {
      const g = world.glyph;
      if (!g || !this.settings.hints) return;
      const label = g.label || 'E';
      ctx.save();
      ctx.globalAlpha = 0.62 + Math.sin(world.time * 3) * 0.16;
      ctx.font = '11px "Old Standard TT", Georgia, serif';
      const bw = Math.max(17, ctx.measureText(label).width + 11);
      ctx.fillStyle = 'rgba(236,235,228,0.9)';
      this.roundRect(ctx, g.x - bw / 2, g.y - 9, bw, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, g.x, g.y + 0.5);
      ctx.restore();
    }

    // Передний план движется быстрее камеры, но по вертикали привязан к кадру
    drawForeground(ctx, cx) {
      ctx.fillStyle = '#000';
      for (const it of this.fg) {
        const sx = it.x - cx * 1.3;
        if (sx < -300 || sx > W + 300) continue;
        ctx.translate(sx, 0);
        ctx.fill(it.path);
        ctx.translate(-sx, 0);
      }
    }

    drawPost(ctx, world, atm) {
      ctx.globalAlpha = U.clamp(0.22 + atm.fog * 0.22, 0, 0.75);
      ctx.fillStyle = this.mist;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      if (world.whiteout > 0.002) {
        ctx.fillStyle = `rgba(236,235,228,${world.whiteout.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, W, H);
      // Лёгкое мерцание проектора
      ctx.fillStyle = `rgba(0,0,0,${(0.012 + Math.random() * 0.03).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      if (this.settings.grain) {
        if (Math.random() < 0.03) {
          ctx.fillStyle = 'rgba(235,235,228,0.10)';
          ctx.fillRect(Math.random() * W, 0, 1, H);
        }
        if (Math.random() < 0.2) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          for (let i = 0; i < 3; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        const sc = 1.3 * this.dpr;
        const ox = Math.random() * 160;
        const oy = Math.random() * 160;
        ctx.setTransform(sc, 0, 0, sc, -ox * sc, -oy * sc);
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = this.grain[this.frame % this.grain.length];
        ctx.fillRect(0, 0, this.canvas.width / sc + 170, this.canvas.height / sc + 170);
        ctx.globalAlpha = 1;
        ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
      }
      if (world.fade > 0.001) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, world.fade).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    /* ---------- глава II: камыш, кочки, трясина, наблюдатели, ворота, город ---------- */

    reedBlades(p, w, h, rnd) {
      const n = Math.max(6, Math.round(w * 0.55));
      for (let i = 0; i < n; i++) {
        const x = rnd() * w;
        const hh = h * (0.65 + rnd() * 0.5);
        const lean = (rnd() - 0.5) * 10;
        addPoly(p, [[x - 1.3, 3], [x + lean, -hh], [x + 1.3, 3]]);
        if (rnd() < 0.3) {
          // початок рогоза
          const cx = x + lean * 0.85;
          const cy = -hh * 0.86;
          addPoly(p, [[cx - 2.2, cy - 6], [cx + 2.2, cy - 6], [cx + 2.2, cy + 6], [cx - 2.2, cy + 6]]);
        }
      }
    }

    reedPatch(r, level, rnd) {
      const p = new Path2D();
      this.reedBlades(p, r.w, r.h || 46, rnd);
      const y = r.y !== undefined ? r.y : this.groundAt(level, r.x + r.w / 2);
      return { x: r.x, w: r.w, y, path: p, ph: rnd() * 6 };
    }

    reedsFor(e) {
      if (!this.entityReeds[e.id]) {
        const p = new Path2D();
        this.reedBlades(p, e.w - 10, 44, U.rng((e.home | 0) + 17));
        this.entityReeds[e.id] = p;
      }
      return this.entityReeds[e.id];
    }

    // Камыш рисуется перед героем: в нём можно спрятаться
    drawFrontReeds(ctx, world, x0, x1) {
      const t = world.time;
      ctx.fillStyle = INK;
      for (const r of this.reedPatches) {
        if (r.x > x1 || r.x + r.w < x0) continue;
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.transform(1, 0, Math.sin(t * 1.1 + r.ph) * 0.07, 1, 0, 0);
        ctx.fill(r.path);
        ctx.restore();
      }
      for (const e of world.entities) {
        if (!e.reeds || e.x > x1 || e.x + e.w < x0) continue;
        const y = (e.type === 'log' ? e.y + e.bob : e.y) + 1;
        ctx.save();
        ctx.translate(e.x + 5, y);
        ctx.transform(1, 0, Math.sin(t * 1.1 + e.home) * 0.07, 1, 0, 0);
        ctx.fill(this.reedsFor(e));
        ctx.restore();
      }
    }

    drawHummock(ctx, h) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(h.x - 6, h.y + h.h + 34);
      ctx.quadraticCurveTo(h.x - 3, h.y + 2, h.x + 9, h.y);
      ctx.lineTo(h.x + h.w - 9, h.y);
      ctx.quadraticCurveTo(h.x + h.w + 3, h.y + 2, h.x + h.w + 6, h.y + h.h + 34);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const bx = h.x + 7 + (i * (h.w - 14)) / 5;
        const bh = 4 + ((i * 7) % 6);
        ctx.moveTo(bx - 1, h.y + 1);
        ctx.lineTo(bx + (i % 2 ? 1.5 : -1.5), h.y - bh);
        ctx.lineTo(bx + 1, h.y + 1);
      }
      ctx.fill();
    }

    // Трясина рисуется поверх героя: видно, как его затягивает
    drawBogs(ctx, world, x0, x1) {
      const t = world.time;
      for (const b of world.bogs) {
        if (b.x > x1 || b.x + b.w < x0) continue;
        const surf = (x) => b.y + 1 + Math.sin(x * 0.07 + t * 0.9) * 0.7;
        ctx.fillStyle = b.deep ? '#0d0d0c' : '#141413';
        ctx.beginPath();
        ctx.moveTo(b.x, surf(b.x));
        for (let x = b.x; x <= b.x + b.w; x += 6) ctx.lineTo(x, surf(x));
        ctx.lineTo(b.x + b.w, b.y + 90);
        ctx.lineTo(b.x, b.y + 90);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = b.deep ? 'rgba(110,110,103,0.3)' : 'rgba(130,130,122,0.38)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x, surf(b.x));
        for (let x = b.x; x <= b.x + b.w; x += 6) ctx.lineTo(x, surf(x));
        ctx.stroke();
        const n = Math.max(1, Math.round(b.w / 60));
        for (let i = 0; i < n; i++) {
          const period = 2.3 + (i % 3) * 0.7;
          const ph = ((t + i * 1.37) % period) / period;
          if (ph > 0.35) continue;
          const bx = b.x + 8 + ((i * 97.3) % Math.max(1, b.w - 16));
          ctx.strokeStyle = `rgba(150,150,141,${(0.45 * (1 - ph / 0.35)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(bx, b.y + 1, 1 + ph * 9, Math.PI, 0);
          ctx.stroke();
        }
      }
    }

    // Тело и ноги наблюдателя — в глубине кадра, за ближним лесом
    drawWatchers(ctx, world, cx, cy) {
      for (const w of world.watchers || []) {
        if (!w.active || w.alpha < 0.02) continue;
        const sx = w.bodyX - cx;
        if (sx < -420 || sx > W + 420) continue;
        const by = 34 - cy * 0.4 + Math.sin(world.time * 1.2) * 5;
        const groundY = 505 - cy * 0.6;
        ctx.save();
        ctx.globalAlpha = w.alpha;
        ctx.strokeStyle = '#2e2e2c';
        ctx.fillStyle = '#2e2e2c';
        [-150, -90, -30, 30, 90, 150].forEach((hm, i) => {
          const ph = w.legPhase * Math.PI * 2 + i * 1.05;
          const fx = sx + hm * 1.1 + Math.sin(ph) * 26;
          const fy = groundY - Math.max(0, Math.cos(ph)) * 22;
          const hx = sx + hm * 0.3;
          const hy = by + 24;
          const kx = (hx + fx) / 2 + (hm < 0 ? -26 : 26);
          const ky = by - 70 - ((i * 23) % 40);
          ctx.lineWidth = 3.8;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.quadraticCurveTo(hx + (kx - hx) * 0.3, ky - 10, kx, ky);
          ctx.stroke();
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.ellipse(sx, by, 115, 40, Math.sin(world.time * 0.6) * 0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx - 60, by - 20, 34, 24, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx + 55, by + 12, 28, 20, 0.2, 0, Math.PI * 2);
        ctx.fill();
        const lamp = 0.25 + w.light * 0.75;
        const lg = ctx.createRadialGradient(sx, by + 34, 1, sx, by + 34, 26);
        lg.addColorStop(0, `rgba(245,245,238,${lamp.toFixed(3)})`);
        lg.addColorStop(1, 'rgba(245,245,238,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(sx - 30, by + 4, 60, 60);
        ctx.restore();
      }
    }

    // Луч падает на игровой план и подсвечивает всё, что в него попало
    drawWatcherLights(ctx, world, cx, cy) {
      for (const w of world.watchers || []) {
        if (!w.active || w.light < 0.02 || w.alpha < 0.02) continue;
        const a = w.light * w.alpha;
        const bx = w.bodyX - cx;
        const by = 34 - cy * 0.4 + Math.sin(world.time * 1.2) * 5 + 34;
        const gx = w.lightX - cx;
        const gy = 430 - cy;
        const hw = w.halfW;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, by, 0, gy);
        g.addColorStop(0, `rgba(255,255,248,${(0.3 * a).toFixed(3)})`);
        g.addColorStop(1, `rgba(255,255,248,${(0.13 * a).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx - 7, by);
        ctx.lineTo(bx + 7, by);
        ctx.lineTo(gx + hw * 1.1, gy + 6);
        ctx.lineTo(gx - hw * 1.1, gy + 6);
        ctx.closePath();
        ctx.fill();
        const r = ctx.createRadialGradient(gx, gy, 4, gx, gy, hw * 1.3);
        r.addColorStop(0, `rgba(255,255,248,${(0.38 * a).toFixed(3)})`);
        r.addColorStop(1, 'rgba(255,255,248,0)');
        ctx.fillStyle = r;
        ctx.beginPath();
        ctx.ellipse(gx, gy, hw * 1.3, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Ржавые ворота в конце главы II
    gatePath(g) {
      const p = new Path2D();
      const top = g.bottom - 330;
      const L = g.x;
      const R = g.x + g.w;
      addPoly(p, [[L - 34, 434], [L - 34, top - 10], [L - 6, top - 10], [L - 6, 434]]);
      addPoly(p, [[R + 6, 434], [R + 6, top - 10], [R + 34, top - 10], [R + 34, 434]]);
      addPoly(p, [[L - 40, top - 10], [L - 20, top - 32], [L, top - 10]]);
      addPoly(p, [[R, top - 10], [R + 20, top - 32], [R + 40, top - 10]]);
      for (let x = L - 6; x <= R + 3; x += 10) {
        addPoly(p, [[x, g.bottom], [x, top], [x + 1.6, top - 10], [x + 3.2, top], [x + 3.2, g.bottom]]);
      }
      for (const y of [top + 30, top + 150, g.bottom - 5]) {
        addPoly(p, [[L - 6, y], [R + 6, y], [R + 6, y + 5], [L - 6, y + 5]]);
      }
      return p;
    }

    // Силуэт спящего города вдали: крыши, трубы, башня с шестернёй
    cityPath(c, rnd) {
      const p = new Path2D();
      const f = 0.3;
      const lx = (c.x - W / 2) * f + W / 2;
      const base = 472;
      let x = lx - 440;
      while (x < lx + 440) {
        const w = 40 + rnd() * 60;
        const h = 60 + rnd() * 120;
        addPoly(p, [[x, base], [x, base - h], [x + w / 2, base - h - 18 - rnd() * 22], [x + w, base - h], [x + w, base]]);
        if (rnd() < 0.45) {
          const tx = x + w * 0.7;
          addPoly(p, [[tx, base - h + 2], [tx, base - h - 42], [tx + 8, base - h - 42], [tx + 8, base - h + 2]]);
        }
        x += w + 4 + rnd() * 18;
      }
      const tx = lx + 60;
      addPoly(p, [[tx - 28, base], [tx - 22, 190], [tx + 22, 190], [tx + 28, base]]);
      const gear = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const r = i % 2 ? 44 : 53;
        gear.push([tx + Math.cos(a) * r, 176 + Math.sin(a) * r]);
      }
      addPoly(p, gear);
      return { f, path: p };
    }

    /* ---------- глава III: город, механизмы, белая комната ---------- */

    cityLayer(rnd, c, span, level) {
      const items = [];
      // Дома не заходят в белую комнату в конце главы
      const limit = level.cityEnd ? Math.min(span, (level.cityEnd - W / 2) * c.f + W / 2 + 200) : span;
      for (let x = -300; x < limit; x += U.lerp(c.gap[0], c.gap[1], rnd())) {
        const p = new Path2D();
        const w = U.lerp(c.w[0], c.w[1], rnd());
        const h = U.lerp(c.h[0], c.h[1], rnd());
        const roof = rnd();
        if (roof < 0.4) addPoly(p, [[0, 6], [0, -h], [w / 2, -h - w * 0.35], [w, -h], [w, 6]]);
        else if (roof < 0.7) addPoly(p, [[0, 6], [0, -h], [w, -h], [w, 6]]);
        else addPoly(p, [[0, 6], [0, -h], [w * 0.2, -h - 14], [w * 0.8, -h - 14], [w, -h], [w, 6]]);
        if (rnd() < 0.6) {
          const tx = w * (0.15 + rnd() * 0.6);
          const th = 18 + rnd() * 40;
          addPoly(p, [[tx, -h + 6], [tx, -h - th], [tx + 8, -h - th], [tx + 8, -h + 6]]);
        }
        if (rnd() < 0.15) addPoly(p, [[w / 2 - 1.2, -h], [w / 2 - 1.2, -h - 70], [w / 2 + 1.2, -h - 70], [w / 2 + 1.2, -h]]);
        items.push({ x, y: c.base + rnd() * 10, path: p });
      }
      const gears = [];
      for (let x = 250 + rnd() * 300; x < limit; x += 650 + rnd() * 800) {
        const r = (26 + rnd() * 34) * (0.7 + c.f);
        gears.push({ x, y: c.base - 140 - rnd() * 160, spin: (rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.3), path: this.gearPath(r) });
      }
      const ground = new Path2D();
      addPoly(ground, [[-300, H + 300], [-300, c.ground], [span, c.ground], [span, H + 300]]);
      return { f: c.f, color: c.color, items, ground, gears };
    }

    gearPath(r) {
      const p = new Path2D();
      const teeth = Math.max(8, Math.round(r / 4));
      const pts = [];
      for (let i = 0; i < teeth * 4; i++) {
        const a = (i / (teeth * 4)) * Math.PI * 2;
        const rr = i % 4 < 2 ? r : r * 0.82;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      addPoly(p, pts);
      return p;
    }

    // Каменная кладка: ровные края с редкими выщерблинами
    stonePath(s, rnd) {
      const p = new Path2D();
      const pts = [[s.x, s.y + s.h]];
      for (let y = s.y + s.h; y > s.y + 6; y -= 22) pts.push([s.x - (rnd() < 0.25 ? 1.5 : 0), y]);
      pts.push([s.x, s.y]);
      for (let x = s.x + 14; x < s.x + s.w - 10; x += 14 + rnd() * 20) {
        pts.push([x, s.y - (rnd() < 0.3 ? 1.2 : 0)]);
        if (rnd() < 0.15) pts.push([x + 3, s.y + 2.5], [x + 6, s.y]);
      }
      pts.push([s.x + s.w, s.y]);
      for (let y = s.y + 6; y < s.y + s.h; y += 22) pts.push([s.x + s.w + (rnd() < 0.25 ? 1.5 : 0), y]);
      pts.push([s.x + s.w, s.y + s.h]);
      addPoly(p, pts);
      return p;
    }

    seamPath(s) {
      const p = new Path2D();
      const y0 = Math.max(s.y, -80);
      const y1 = Math.min(s.y + s.h, 600);
      let row = 0;
      for (let y = y0 + 14; y < y1; y += 14, row++) {
        p.moveTo(s.x + 2, y);
        p.lineTo(s.x + s.w - 2, y);
        for (let x = s.x + (row % 2 ? 12 : 28); x < s.x + s.w - 4; x += 32) {
          p.moveTo(x, y - 14);
          p.lineTo(x, y);
        }
      }
      return p;
    }

    lampPath() {
      const p = new Path2D();
      addPoly(p, [[-6, 2], [-3, -8], [-2, -118], [2, -118], [3, -8], [6, 2]]);
      addPoly(p, [[-2, -114], [16, -114], [16, -111], [-2, -111]]);
      addPoly(p, [[10, -111], [22, -111], [20, -94], [12, -94]]);
      addPoly(p, [[9, -114], [16, -122], [23, -114]]);
      return p;
    }

    drawLamps(ctx, world, x0, x1) {
      ctx.fillStyle = INK;
      for (const l of this.lamps) {
        if (l.x < x0 - 60 || l.x > x1 + 60) continue;
        ctx.translate(l.x, l.y);
        ctx.fill(l.path);
        ctx.translate(-l.x, -l.y);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const l of this.lamps) {
        if (l.x < x0 - 60 || l.x > x1 + 60) continue;
        const gx = l.x + 16;
        const gy = l.y - 102;
        const fl = 0.16 + Math.sin(world.time * 7 + l.x) * 0.015 - (Math.random() < 0.02 ? 0.08 : 0);
        const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, 80);
        g.addColorStop(0, `rgba(255,253,240,${(fl * 2.2).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,253,240,0)');
        ctx.fillStyle = g;
        ctx.fillRect(gx - 80, gy - 80, 160, 160);
      }
      ctx.restore();
    }

    drawPiston(ctx, pi) {
      ctx.fillStyle = INK;
      ctx.fillRect(pi.x + pi.w / 2 - 7, pi.top - 20, 14, pi.bottom - pi.headH - pi.top + 20);
      ctx.fillRect(pi.x, pi.bottom - pi.headH, pi.w, pi.headH);
      ctx.fillRect(pi.x - 4, pi.bottom - 7, pi.w + 8, 7);
      ctx.strokeStyle = 'rgba(80,80,75,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pi.x + 4.5, pi.bottom - pi.headH + 4.5, pi.w - 9, pi.headH - 13);
    }

    drawDoor(ctx, d) {
      ctx.fillStyle = INK;
      for (let x = d.x; x < d.x + d.w - 1; x += 7) ctx.fillRect(x, d.y, 3, d.h);
      ctx.fillRect(d.x - 2, d.y + d.h * 0.25, d.w + 3, 4);
      ctx.fillRect(d.x - 2, d.y + d.h * 0.7, d.w + 3, 4);
      ctx.beginPath();
      for (let x = d.x; x < d.x + d.w - 1; x += 7) {
        ctx.moveTo(x - 1, d.y + d.h);
        ctx.lineTo(x + 1.5, d.y + d.h + 7);
        ctx.lineTo(x + 4, d.y + d.h);
      }
      ctx.fill();
    }

    drawLever(ctx, l) {
      const tip = l.pinPoint();
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      ctx.fillRect(l.home - 13, l.baseY - 10, 26, 10);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(l.home, l.baseY - 8);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    drawMover(ctx, m) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x + 8, m.y);
      ctx.lineTo(m.x + 8, m.y - 500);
      ctx.moveTo(m.x + m.w - 8, m.y);
      ctx.lineTo(m.x + m.w - 8, m.y - 500);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeStyle = 'rgba(80,80,75,0.6)';
      ctx.lineWidth = 1;
      for (let x = m.x + 8; x < m.x + m.w - 4; x += 16) {
        ctx.beginPath();
        ctx.arc(x, m.y + m.h / 2, 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Белая комната: палата, которую он видел во сне чудовищем
    drawRoom(ctx, world, cx, cy) {
      const f = 0.62;
      const sx = this.room.x - cx * f;
      const oy = cy * f * 0.6;
      if (sx < -700 || sx > W + 700) return;
      const a = U.clamp(1 - Math.abs(sx - W / 2) / 900, 0, 1);
      const G = 494;
      const ink = '#8f8f89';
      ctx.save();
      ctx.translate(sx - W / 2, -oy);
      ctx.globalAlpha = 0.25 + a * 0.6;
      ctx.lineCap = 'round';
      // окно со светом и занавеска
      ctx.fillStyle = 'rgba(255,255,250,0.5)';
      ctx.fillRect(50, 120, 170, 230);
      ctx.fillStyle = ink;
      for (const r of [[50, 120, 170, 5], [50, 345, 170, 5], [50, 120, 5, 230], [215, 120, 5, 230], [132, 120, 4, 230], [50, 232, 170, 4]]) ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.beginPath();
      ctx.moveTo(10, 100);
      for (let y = 100; y <= 470; y += 10) ctx.lineTo(46 + Math.sin(y * 0.05 + world.time * 0.5) * 6, y);
      ctx.lineTo(10, 470);
      ctx.closePath();
      ctx.fill();
      // кровать
      ctx.fillRect(320, 392, 400, 22);
      ctx.fillRect(330, 414, 8, G - 414);
      ctx.fillRect(702, 414, 8, G - 414);
      ctx.fillRect(710, 330, 14, G - 330);
      ctx.beginPath();
      ctx.ellipse(676, 386, 36, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(320, 394);
      ctx.quadraticCurveTo(440, 362, 600, 380);
      ctx.quadraticCurveTo(650, 384, 655, 394);
      ctx.closePath();
      ctx.fill();
      // капельница — та самая «тонконогая» стойка с проводом
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(780, G);
      ctx.lineTo(780, 140);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(756, G);
      ctx.lineTo(780, G - 14);
      ctx.lineTo(804, G);
      ctx.moveTo(764, 150);
      ctx.lineTo(796, 150);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(784, 178, 12, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(784, 198);
      ctx.quadraticCurveTo(780 + Math.sin(world.time) * 8, 320, 700, 388);
      ctx.stroke();
      // монитор и кардиограмма в такт писку
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(852, G);
      ctx.lineTo(852, 262);
      ctx.stroke();
      ctx.fillRect(814, 206, 78, 58);
      ctx.fillStyle = 'rgba(235,235,228,0.85)';
      ctx.fillRect(820, 212, 66, 46);
      ctx.strokeStyle = '#6d6d68';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const ph = (world.pulse || 0) % 1;
      for (let i = 0; i <= 33; i++) {
        const u = i / 33;
        const dist = Math.abs(u - ph);
        const spike = dist < 0.05 ? Math.sin((1 - dist / 0.05) * Math.PI) * 16 * (u < ph ? -1 : 1) : 0;
        if (i === 0) ctx.moveTo(823 + u * 60, 238 + spike);
        else ctx.lineTo(823 + u * 60, 238 + spike);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawCity(ctx, cx, cy) {
      const c = this.city;
      ctx.save();
      ctx.fillStyle = '#8c8d87';
      ctx.translate(-cx * c.f, -cy * c.f * 0.6);
      ctx.fill(c.path);
      ctx.restore();
    }
  }

  NIT.Renderer = Renderer;
})();
