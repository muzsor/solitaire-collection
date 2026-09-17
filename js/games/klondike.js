import { Game } from '../engine.js';
import { makeDeck, isRed } from '../cards.js';
import { shuffle } from '../rng.js';

export class Klondike extends Game {
  static meta = {
    id: 'klondike',
    name: '經典接龍',
    en: 'Klondike',
    desc: '七欄疊牌，紅黑交錯往下排，把四種花色從 A 到 K 收齊。',
    hasScore: true,
    hasAutoCollect: true,
  };

  init() {
    this.stock = this.addPile('stock', 'stock', { label: '↻' });
    this.waste = this.addPile('waste', 'waste', { placeholder: false });
    this.foundations = [0, 1, 2, 3].map((i) => this.addPile('f' + i, 'foundation', { label: 'A' }));
    this.tableau = [0, 1, 2, 3, 4, 5, 6].map((i) => this.addPile('t' + i, 'tableau'));
    const deck = shuffle(makeDeck(1), this.rng);
    this.registerCards(deck);
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j <= i; j++) this.place(deck.pop(), this.tableau[i], j === i);
    }
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
    return this.options.draw3 ? '翻 3 張' : '翻 1 張';
  }

  layout(orient) {
    const piles = {};
    const d3 = !!this.options.draw3;
    if (orient === 'portrait') {
      piles.stock = { x: 0, y: 0 };
      piles.waste = { x: 1, y: 0, fan: d3 ? 'right3' : 'none' };
      this.foundations.forEach((f, i) => (piles[f.id] = { x: 3 + i, y: 0 }));
      this.tableau.forEach((t, i) => (piles[t.id] = { x: i, y: 1.3, fan: 'down' }));
      return { w: 7, h: 5, piles };
    }
    piles.stock = { x: 0, y: 0 };
    piles.waste = { x: 0, y: 1.15, fan: d3 ? 'down3' : 'none' };
    piles.f0 = { x: 1.15, y: 0 };
    piles.f1 = { x: 2.3, y: 0 };
    piles.f2 = { x: 1.15, y: 1.15 };
    piles.f3 = { x: 2.3, y: 1.15 };
    this.tableau.forEach((t, i) => (piles[t.id] = { x: 3.6 + i, y: 0, fan: 'down' }));
    return { w: 10.6, h: 3.4, piles };
  }

  canPick(pile, idx) {
    if (pile.kind === 'tableau') return pile.cards[idx].faceUp;
    if (pile.kind === 'waste' || pile.kind === 'foundation') return idx === pile.size - 1;
    return false;
  }

  // 單張牌 c 能不能放到 to 的最上面
  fits(c, to) {
    if (to.kind === 'foundation') {
      const t = to.top;
      return t ? t.suit === c.suit && t.rank === c.rank - 1 : c.rank === 1;
    }
    if (to.kind === 'tableau') {
      const t = to.top;
      return t ? t.faceUp && isRed(t.suit) !== isRed(c.suit) && t.rank === c.rank + 1 : c.rank === 13;
    }
    return false;
  }

  canDrop(from, idx, to) {
    if (to === from) return false;
    const c = from.cards[idx];
    if (to.kind === 'foundation' && from.size - idx !== 1) return false;
    return this.fits(c, to);
  }

  // 卡死判定（保守）：疊牌欄之間還有任何移動、或牌堆／棄牌堆裡任何一張牌打得出去，都算還有路
  hasMoves() {
    for (const t of this.tableau) {
      for (let i = 0; i < t.size; i++) {
        if (!t.cards[i].faceUp) continue;
        for (const f of this.foundations) if (this.canDrop(t, i, f)) return true;
        for (const o of this.tableau) {
          if (o === t || !this.canDrop(t, i, o)) continue;
          if (o.empty && i === 0) continue; // 整欄 K 搬到空欄沒有意義
          return true;
        }
      }
    }
    for (const c of [...this.stock.cards, ...this.waste.cards]) {
      for (const f of this.foundations) if (this.fits(c, f)) return true;
      for (const t of this.tableau) if (this.fits(c, t)) return true;
    }
    for (const f of this.foundations) {
      if (f.top) for (const t of this.tableau) if (this.fits(f.top, t) && !t.empty) return true;
    }
    return false;
  }

  drop(from, idx, to) {
    this.commit(
      () => {
        if (to.kind === 'foundation') this.score += 10;
        else if (from.kind === 'waste') this.score += 5;
        else if (from.kind === 'foundation') this.score = Math.max(0, this.score - 15);
        this.moveCards(from, idx, to);
        if (from.kind === 'tableau' && from.top && !from.top.faceUp) {
          from.top.faceUp = true;
          this.score += 5;
        }
      },
      { t: 'move', f: from.id, i: idx, to: to.id }
    );
  }

  tap(pile, idx) {
    if (pile.kind === 'stock') {
      this.dealStock();
      return true;
    }
    return super.tap(pile, idx);
  }
  tapEmpty(pile) {
    if (pile.kind === 'stock') {
      this.dealStock();
      return true;
    }
    return false;
  }

  dealAction() {
    this.dealStock();
  }
  dealStock() {
    const action = { t: 'deal' };
    if (this.stock.empty) {
      if (this.waste.empty) return;
      this.commit(() => {
        while (this.waste.size) this.moveTop(this.waste, this.stock, false);
        this.passes++;
        this.score = Math.max(0, this.score - 20);
      }, action);
      return;
    }
    const n = this.options.draw3 ? 3 : 1;
    this.commit(() => {
      for (let k = 0; k < n && this.stock.size; k++) this.moveTop(this.stock, this.waste, true);
    }, action);
  }

  autoTarget(pile, idx) {
    const c = pile.cards[idx];
    const single = idx === pile.size - 1;
    if (single && pile.kind !== 'foundation') {
      for (const f of this.foundations) if (this.canDrop(pile, idx, f)) return f;
    }
    for (const t of this.tableau) if (!t.empty && this.canDrop(pile, idx, t)) return t;
    if (!(pile.kind === 'tableau' && idx === 0)) {
      for (const t of this.tableau) if (t.empty && this.canDrop(pile, idx, t)) return t;
    }
    return null;
  }

  isWon() {
    return this.foundations.every((f) => f.size === 13);
  }

  autoCollectStep() {
    for (const p of [...this.tableau, this.waste]) {
      if (p.empty) continue;
      for (const f of this.foundations) {
        if (this.canDrop(p, p.size - 1, f)) {
          this.drop(p, p.size - 1, f);
          return true;
        }
      }
    }
    return false;
  }

  hint() {
    const h = super.hint();
    if (h) return h;
    if (!this.stock.empty || !this.waste.empty) return { pile: this.stock };
    return null;
  }

  badge(pile) {
    if (pile === this.stock && this.options.draw3) return pile.size ? String(pile.size) : '';
    return '';
  }

  winBonus(seconds) {
    return seconds > 30 ? Math.round(700000 / seconds) : 0;
  }
}
