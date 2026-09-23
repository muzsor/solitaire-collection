// 牌桌繪製與拖曳操作

import { SUIT_SYMBOL, RANK_LABEL, isRed } from './cards.js';

const GAP = 0.12; // 牌與牌之間的間距（牌寬比例）
const RATIO = 1.4; // 牌高 / 牌寬
const MAX_CW = 130;

function createCardEl(c) {
  const d = document.createElement('div');
  d.className = 'card ' + (isRed(c.suit) ? 'red' : 'black');
  d.dataset.id = c.id;
  const r = RANK_LABEL[c.rank];
  const s = SUIT_SYMBOL[c.suit];
  d.innerHTML =
    `<div class="face"><div class="corner tl"><b>${r}</b><i>${s}</i></div>` +
    `<div class="mid">${s}</div><div class="corner br"><b>${r}</b><i>${s}</i></div></div><div class="back"></div>`;
  return d;
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export class Renderer {
  constructor(tableEl, getSettings, hooks = {}) {
    this.el = tableEl;
    this.getSettings = getSettings;
    this.hooks = hooks; // onMoveAttempt(ok)
    this.game = null;
    this.cardEls = new Map();
    this.pileEls = new Map();
    this.pos = new Map();
    this.pilePos = new Map();
    this.pileRects = new Map();
    this.drag = null;
    this.dim = null;

    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(this.el);
  }

  setGame(game, opts = {}) {
    this.game = game;
    this.drag = null;
    this.el.innerHTML = '';
    this.cardEls.clear();
    this.pileEls.clear();
    this.pos.clear();
    this.extraEls = new Map();
    this.badgeEls = new Map();
    for (const p of game.piles) {
      const d = document.createElement('div');
      d.className = `pile kind-${p.kind}` + (p.placeholder ? '' : ' ghost');
      d.dataset.pile = p.id;
      d.innerHTML = `<span class="plabel">${p.label}</span>`;
      this.el.appendChild(d);
      this.pileEls.set(p.id, d);
      // 牌堆下方的數字獨立一層、疊在所有牌之上；放在牌堆元素裡會被牌堆上幾十張牌的陰影蓋住
      const bd = document.createElement('div');
      bd.className = 'pbadge';
      this.el.appendChild(bd);
      this.badgeEls.set(p.id, bd);
    }
    for (const c of game.cards) {
      const d = createCardEl(c);
      this.el.appendChild(d);
      this.cardEls.set(c.id, d);
    }
    game.on('change', () => this.sync(true));
    this.relayout();
    if (opts.deal) this.dealAnimation();
  }

  // 新局發牌動畫：所有牌先疊在牌堆位置（沒有牌堆就從牌桌中央），再依序飛到定位
  dealAnimation() {
    const g = this.game;
    if (!this.dim) return;
    const stock = g.piles.find((p) => p.kind === 'stock');
    const origin = stock ? this.pilePos.get(stock.id) : { x: (this.dim.W - this.dim.cw) / 2, y: (this.dim.H - this.dim.ch) / 2 };
    const flying = [];
    for (const p of g.piles) {
      if (p === stock) continue;
      p.cards.forEach((c) => flying.push(c));
    }
    if (!flying.length) return;
    this.el.classList.add('no-anim');
    flying.forEach((c) => {
      const el = this.cardEls.get(c.id);
      el.style.transform = `translate3d(${origin.x}px,${origin.y}px,0)`;
      el.classList.add('down');
    });
    void this.el.offsetWidth; // 讓瀏覽器先畫出集中的狀態
    this.el.classList.remove('no-anim');
    const step = Math.min(14, 700 / flying.length);
    flying.forEach((c, i) => {
      this.cardEls.get(c.id).style.transitionDelay = `${Math.round(i * step)}ms`;
    });
    this.sync(true);
    const total = flying.length * step + 400;
    setTimeout(() => flying.forEach((c) => (this.cardEls.get(c.id).style.transitionDelay = '')), total);
  }

  relayout() {
    if (!this.game) return;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    if (!W || !H) return;
    const orient = W > H ? 'landscape' : 'portrait';
    const L = this.game.layout(orient);
    const s = this.getSettings();
    // 各遊戲寫 layout 時預設是「牌堆在左」，適合左手拇指；金字塔標成 right，因為湊 13 小表在左、牌堆偏右，適合右手。
    // 玩家的慣用手和排版設計的手不同時，整個牌桌左右鏡射
    this.mirror = s.hand !== (L.hand || 'left');
    let cw = Math.min(W / (L.w * (1 + GAP) - GAP), H / ((L.h * (1 + GAP) - GAP) * RATIO), MAX_CW);
    cw = Math.floor(cw);
    const ch = Math.round(cw * RATIO);
    const ux = cw * (1 + GAP);
    const uy = ch * (1 + GAP);
    const tw = L.w * ux - cw * GAP;
    const th = L.h * uy - ch * GAP;
    const ox = Math.floor((W - tw) / 2);
    const oy = L.centerY ? Math.floor(Math.max(4, (H - th) / 2)) : Math.floor(Math.max(4, Math.min(10, (H - th) / 2)));
    this.dim = { W, H, cw, ch, ux, uy, ox, oy, orient };
    this.el.style.setProperty('--cw', cw + 'px');
    this.el.style.setProperty('--ch', ch + 'px');
    // 牌太窄時（直向的蜘蛛、三峰）自動放大角標
    this.narrow = cw < 46;
    this.el.classList.toggle('narrow', this.narrow);
    for (const p of this.game.piles) {
      const lp = L.piles[p.id] || { x: 0, y: 0 };
      const x = this.mirror ? L.w - 1 - lp.x : lp.x;
      const px = Math.round(ox + x * ux);
      const py = Math.round(oy + lp.y * uy);
      this.pilePos.set(p.id, { x: px, y: py, fan: lp.fan || 'none' });
      const d = this.pileEls.get(p.id);
      d.style.transform = `translate3d(${px}px,${py}px,0)`;
      d.style.zIndex = 1 + (p.meta.z || 0);
      this.badgeEls.get(p.id).style.transform = `translate3d(${px}px,${py + ch}px,0)`;
    }
    // 附加面板
    const wanted = new Set();
    for (const ex of L.extras || []) {
      wanted.add(ex.id);
      let el = this.extraEls.get(ex.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'extra';
        el.innerHTML = this.game.extraHtml(ex.id);
        this.el.appendChild(el);
        this.extraEls.set(ex.id, el);
      }
      const x = this.mirror ? L.w - ex.w - ex.x : ex.x;
      el.style.transform = `translate3d(${Math.round(ox + x * ux)}px,${Math.round(oy + ex.y * uy)}px,0)`;
      el.style.width = Math.round(ex.w * ux - cw * GAP) + 'px';
      el.classList.toggle('cols2', !!ex.cols2);
    }
    for (const [id, el] of this.extraEls) {
      if (!wanted.has(id)) {
        el.remove();
        this.extraEls.delete(id);
      }
    }
    this.sync(false);
  }

  sync(animate) {
    const g = this.game;
    if (!g || !this.dim) return;
    const { cw, ch, H } = this.dim;
    const s = this.getSettings();
    const dir = this.mirror ? -1 : 1;
    this.el.classList.toggle('no-anim', !animate);
    for (const p of g.piles) {
      const pp = this.pilePos.get(p.id);
      const n = p.size;
      const offsets = new Array(n);
      if (pp.fan === 'down') {
        const avail = Math.max(0, H - pp.y - ch - 4);
        // 面朝上的牌至少露出角標的高度（角標為一行，約 0.2 張牌高，再留邊框與間隙）
        const faceStep = s.bigFont || this.narrow ? 0.36 : 0.3;
        let total = 0;
        const steps = [];
        for (let i = 0; i < n - 1; i++) {
          const st = p.cards[i].faceUp ? ch * faceStep : ch * 0.12;
          steps.push(st);
          total += st;
        }
        const k = total > avail && total > 0 ? avail / total : 1;
        let y = 0;
        for (let i = 0; i < n; i++) {
          offsets[i] = { x: 0, y: Math.round(y) };
          if (i < n - 1) y += steps[i] * k;
        }
      } else if (pp.fan === 'right3' || pp.fan === 'down3') {
        for (let i = 0; i < n; i++) {
          const k = Math.max(0, i - Math.max(0, n - 3));
          offsets[i] = pp.fan === 'right3' ? { x: Math.round(dir * k * cw * 0.28), y: 0 } : { x: 0, y: Math.round(k * ch * 0.24) };
        }
      } else {
        for (let i = 0; i < n; i++) offsets[i] = { x: 0, y: 0 };
      }
      let minX = 0;
      let maxX = 0;
      let maxY = 0;
      const runStart = g.runStart(p); // 這張以下不成串，調暗
      p.cards.forEach((c, i) => {
        const el = this.cardEls.get(c.id);
        const x = pp.x + offsets[i].x;
        const y = pp.y + offsets[i].y;
        this.pos.set(c.id, { x, y });
        if (!(this.drag && this.drag.dragging && this.drag.cards.includes(c))) {
          el.style.transform = `translate3d(${x}px,${y}px,0)`;
          el.style.zIndex = 10 + (p.meta.z || 0) * 40 + i;
        }
        el.classList.toggle('down', !c.faceUp);
        el.classList.toggle('dim', i < runStart);
        // 疊在同一個位置的牌（牌堆、基礎堆）只留最上面那張的陰影，幾十層陰影疊起來會變成一大塊黑
        el.classList.toggle('buried', pp.fan === 'none' && i < n - 1);
        el.classList.toggle('selected', g.selected === c);
        minX = Math.min(minX, offsets[i].x);
        maxX = Math.max(maxX, offsets[i].x);
        maxY = Math.max(maxY, offsets[i].y);
      });
      this.pileRects.set(p.id, { x: pp.x + minX, y: pp.y, w: cw + (maxX - minX), h: ch + maxY });
      const pe = this.pileEls.get(p.id);
      this.badgeEls.get(p.id).textContent = g.badge(p);
      pe.classList.toggle('has-cards', n > 0);
    }
    for (const [id, el] of this.extraEls) g.decorateExtra(id, el);
  }

  // ---- 提示與回饋 ----
  showHint(h) {
    if (!h) return false;
    const els = [];
    if (h.from) h.from.cards.slice(h.idx).forEach((c) => els.push(this.cardEls.get(c.id)));
    if (h.to) els.push(h.to.top ? this.cardEls.get(h.to.top.id) : this.pileEls.get(h.to.id));
    if (h.pile) els.push(h.pile.top ? this.cardEls.get(h.pile.top.id) : this.pileEls.get(h.pile.id));
    els.forEach((el) => {
      el.classList.remove('hint');
      void el.offsetWidth;
      el.classList.add('hint');
      setTimeout(() => el.classList.remove('hint'), 1500);
    });
    return true;
  }
  nudge(card) {
    const el = this.cardEls.get(card.id);
    if (!el) return;
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
    setTimeout(() => el.classList.remove('nudge'), 350);
  }

  // ---- 指標事件 ----
  onDown(e) {
    if (!this.game || this.game.won || this.drag) return;
    if (e.button && e.button !== 0) return;
    const cardEl = e.target.closest('.card');
    const pileEl = e.target.closest('.pile');
    if (cardEl) {
      const card = this.game.cardById.get(cardEl.dataset.id);
      const pile = this.game.pileOf(card);
      const idx = pile.cards.indexOf(card);
      this.drag = { id: e.pointerId, card, pile, idx, sx: e.clientX, sy: e.clientY, dragging: false, dead: false };
    } else if (pileEl) {
      const pile = this.game.pileById.get(pileEl.dataset.pile);
      this.drag = { id: e.pointerId, pile, emptyTap: true, sx: e.clientX, sy: e.clientY };
    } else {
      return;
    }
    // 捕捉指標：滑鼠拖出視窗再放開也收得到 pointerup
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || d.emptyTap) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.dragging) {
      if (d.dead || Math.hypot(dx, dy) < 8) return;
      if (!this.game.canPick(d.pile, d.idx)) {
        d.dead = true;
        return;
      }
      d.dragging = true;
      d.cards = d.pile.cards.slice(d.idx);
      d.origin = d.cards.map((c) => this.pos.get(c.id));
      d.cards.forEach((c, i) => {
        const el = this.cardEls.get(c.id);
        el.classList.add('dragging');
        el.style.zIndex = 1000 + i;
      });
      this.el.classList.add('is-dragging');
    }
    d.cards.forEach((c, i) => {
      const el = this.cardEls.get(c.id);
      const o = d.origin[i];
      el.style.transform = `translate3d(${o.x + dx}px,${o.y + dy}px,0)`;
    });
    d.cx = d.origin[0].x + dx;
    d.cy = d.origin[0].y + dy;
    e.preventDefault();
  }

  onUp(e, cancelled) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    const g = this.game;
    if (d.emptyTap) {
      if (!cancelled && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12) g.tapEmpty(d.pile);
      return;
    }
    if (d.dragging) {
      d.cards.forEach((c) => this.cardEls.get(c.id).classList.remove('dragging'));
      this.el.classList.remove('is-dragging');
      let best = null;
      let bestA = 0;
      if (!cancelled) {
        const rect = { x: d.cx, y: d.cy, w: this.dim.cw, h: this.dim.ch };
        for (const p of g.piles) {
          if (p === d.pile) continue;
          const a = overlapArea(rect, this.pileRects.get(p.id));
          if (a > bestA && g.canDrop(d.pile, d.idx, p)) {
            bestA = a;
            best = p;
          }
        }
      }
      if (best && bestA > 0.12 * this.dim.cw * this.dim.ch) {
        g.drop(d.pile, d.idx, best);
        this.hooks.onMove && this.hooks.onMove(true);
      } else {
        this.sync(true);
      }
      return;
    }
    if (cancelled || d.dead) return;
    if (g.tap(d.pile, d.idx)) this.hooks.onMove && this.hooks.onMove(true);
    else this.nudge(d.card);
  }
}
