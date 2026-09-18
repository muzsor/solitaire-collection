import { Game } from '../engine.js';
import { makeDeck, RANK_LABEL } from '../cards.js';
import { shuffle } from '../rng.js';

// 可重翻牌堆的次數：-1 為無限，2 為標準，0 為不可重翻
const PASS_LABEL = { '-1': '重翻無限', 2: '重翻 2 次', 0: '不可重翻' };
const PAIRS = [
  [1, 12],
  [2, 11],
  [3, 10],
  [4, 9],
  [5, 8],
  [6, 7],
];

export class Pyramid extends Game {
  static meta = {
    id: 'pyramid',
    name: '金字塔',
    en: 'Pyramid',
    desc: '點兩張加起來 13 的牌消掉，K 單張消。清空金字塔就贏。',
    hasScore: true,
    hasAutoCollect: false,
  };

  init() {
    const p = Number(this.options.passes);
    this.maxPasses = Number.isFinite(p) ? p : 2;
    this.options.passes = this.maxPasses;
    this.slots = [];
    for (let r = 0; r < 7; r++) {
      for (let i = 0; i <= r; i++) {
        this.slots.push(
          this.addPile(`p${r}_${i}`, 'slot', { placeholder: false, meta: { row: r, x: (6 - r) / 2 + i, z: r } })
        );
      }
    }
    this.stock = this.addPile('stock', 'stock', { label: '↻' });
    this.waste = this.addPile('waste', 'waste');
    this.done = this.addPile('done', 'done', { placeholder: false });
    const deck = shuffle(makeDeck(1), this.rng);
    this.registerCards(deck);
    for (const s of this.slots) this.place(deck.pop(), s, true);
    while (deck.length) this.place(deck.pop(), this.stock, false);
    this.score = 0;
    this.passes = 0;
  }

  extraState() {
    return { passes: this.passes };
  }
  restoreExtra(x) {
    this.passes = x ? x.passes : 0;
  }
  subtitle() {
    return PASS_LABEL[String(this.maxPasses)] || '';
  }
  canRedeal() {
    return this.maxPasses < 0 || this.passes < this.maxPasses;
  }

  layout(orient) {
    const piles = {};
    const dx = orient === 'portrait' ? 0 : 1.5;
    for (const s of this.slots) piles[s.id] = { x: s.meta.x + dx, y: s.meta.row * 0.5 };
    if (orient === 'portrait') {
      // 底排由左到右：湊 13 小表（兩欄）、完成堆、空一格、棄牌堆、牌堆。
      // 這是右手用的排版：牌堆在最右邊靠右手拇指，抽牌往左翻到棄牌堆，小表在最左邊不會被拇指遮住。
      // hand: 'right'：慣用左手時渲染器整體鏡射，變成牌堆在最左、往右翻、小表在右
      piles.done = { x: 2.5, y: 4.3 };
      piles.waste = { x: 4.5, y: 4.3 };
      piles.stock = { x: 5.5, y: 4.3 };
      const extras = [{ id: 'cheat', x: 0, y: 4.3, w: 2.2, cols2: true }];
      return { w: 7, h: 6.2, piles, extras, centerY: true, hand: 'right' };
    }
    piles.stock = { x: 0, y: 0.5 };
    piles.waste = { x: 0, y: 1.6 };
    piles.done = { x: 0, y: 2.7 };
    // 橫向：牌堆在左、小表在金字塔右側直排。標成 left，慣用右手時鏡射成牌堆在右、小表在左
    const extras = [{ id: 'cheat', x: 8.8, y: 0.2, w: 1.6 }];
    return { w: 10.4, h: 4, piles, extras, centerY: true, hand: 'left' };
  }

  extraHtml(id) {
    if (id !== 'cheat') return '';
    const rows = PAIRS.map(
      ([a, b]) => `<div class="cheat-row" data-ranks="${a},${b}"><b>${RANK_LABEL[a]}</b><i>|</i><b>${RANK_LABEL[b]}</b></div>`
    ).join('');
    return `<div class="cheat"><div class="cheat-title">湊 13</div>${rows}<div class="cheat-row" data-ranks="13"><b>K</b><i>單張</i></div></div>`;
  }

  decorateExtra(id, el) {
    if (id !== 'cheat') return;
    const r = this.selected ? String(this.selected.rank) : '';
    el.querySelectorAll('.cheat-row').forEach((row) => {
      row.classList.toggle('active', !!r && row.dataset.ranks.split(',').includes(r));
    });
  }

  slotAt(row, x) {
    return this.slots.find((s) => s.meta.row === row && Math.abs(s.meta.x - x) < 0.01);
  }
  isFree(pile) {
    if (pile.empty) return false;
    if (pile.kind === 'slot') {
      const { row, x } = pile.meta;
      const a = this.slotAt(row + 1, x - 0.5);
      const b = this.slotAt(row + 1, x + 0.5);
      return (!a || a.empty) && (!b || b.empty);
    }
    return pile.kind === 'waste';
  }

  canPick(pile, idx) {
    return idx === pile.size - 1 && this.isFree(pile);
  }

  canDrop(from, idx, to) {
    if (to === from || !this.isFree(to)) return false;
    return from.cards[idx].rank + to.top.rank === 13;
  }

  removePair(a, b) {
    this.commit(
      () => {
        this.moveTop(a, this.done, true);
        if (b) this.moveTop(b, this.done, true);
        this.score += b ? 10 : 5;
        this.selected = null;
      },
      { t: 'pair', a: a.id, b: b ? b.id : null }
    );
  }
  applyAction(a) {
    if (a.t === 'pair') return this.removePair(this.pile(a.a), a.b ? this.pile(a.b) : null);
    return super.applyAction(a);
  }
  dealAction() {
    this.dealStock();
  }

  drop(from, idx, to) {
    this.removePair(from, to);
  }

  tap(pile, idx) {
    if (pile.kind === 'stock') {
      this.selected = null;
      this.dealStock();
      return true;
    }
    if (!this.canPick(pile, idx)) return false;
    const card = pile.cards[idx];
    if (card.rank === 13) {
      this.removePair(pile, null);
      return true;
    }
    if (this.selected === card) {
      this.selected = null;
      this.emit('change');
      return true;
    }
    if (this.selected) {
      const sp = this.pileOf(this.selected);
      if (this.canDrop(sp, sp.size - 1, pile)) {
        this.removePair(sp, pile);
        return true;
      }
    }
    this.selected = card;
    this.emit('change');
    return true;
  }

  tapEmpty(pile) {
    if (pile.kind === 'stock') {
      this.dealStock();
      return true;
    }
    return false;
  }

  dealStock() {
    if (this.stock.empty) {
      if (this.waste.empty) return;
      if (!this.canRedeal()) {
        this.emit('message', this.maxPasses === 0 ? '這個難度不能重翻牌堆' : '牌堆已無法再重翻');
        return;
      }
      this.commit(() => {
        while (this.waste.size) this.moveTop(this.waste, this.stock, false);
        this.passes++;
      }, { t: 'deal' });
      return;
    }
    this.commit(() => {
      this.moveTop(this.stock, this.waste, true);
    }, { t: 'deal' });
  }

  isWon() {
    return this.slots.every((s) => s.empty);
  }

  freePiles() {
    return [...this.slots, this.waste].filter((p) => this.isFree(p));
  }

  hasMoves() {
    const free = this.freePiles();
    for (const a of free) {
      if (a.top.rank === 13) return true;
      for (const b of free) if (a !== b && a.top.rank + b.top.rank === 13) return true;
    }
    if (!this.stock.empty) return true;
    if (!this.waste.empty && this.canRedeal()) return true;
    return false;
  }

  hint() {
    const free = this.freePiles();
    for (const a of free) if (a.top.rank === 13) return { from: a, idx: a.size - 1 };
    // 優先消金字塔上的牌
    const slots = free.filter((p) => p.kind === 'slot');
    for (const a of slots) for (const b of free) if (a !== b && a.top.rank + b.top.rank === 13) return { from: a, idx: a.size - 1, to: b };
    for (const a of free) for (const b of free) if (a !== b && a.top.rank + b.top.rank === 13) return { from: a, idx: a.size - 1, to: b };
    if (!this.stock.empty || (!this.waste.empty && this.canRedeal())) return { pile: this.stock };
    return null;
  }

  badge(pile) {
    if (pile === this.stock) {
      if (!pile.empty) return String(pile.size);
      if (this.maxPasses < 0) return '↻∞';
      const left = this.maxPasses - this.passes;
      return left > 0 ? `↻${left}` : '✕';
    }
    if (pile === this.done) return pile.size ? String(pile.size) : '';
    return '';
  }
}
