import { Game } from '../engine.js';
import { makeDeck } from '../cards.js';
import { shuffle } from '../rng.js';

export class Spider extends Game {
  static meta = {
    id: 'spider',
    name: '蜘蛛接龍',
    en: 'Spider',
    desc: '兩副牌、十欄。同花色從 K 到 A 排成一整串才能收走。',
    hasScore: true,
    hasAutoCollect: false,
  };

  init() {
    const suits = Number(this.options.suits) || 1;
    this.stock = this.addPile('stock', 'stock');
    this.foundation = this.addPile('f', 'foundation', { label: '✓' });
    this.tableau = [];
    for (let i = 0; i < 10; i++) this.tableau.push(this.addPile('t' + i, 'tableau'));
    let deck;
    if (suits === 1) deck = makeDeck(8, ['S']);
    else if (suits === 2) deck = makeDeck(4, ['S', 'H']);
    else deck = makeDeck(2);
    shuffle(deck, this.rng);
    this.registerCards(deck);
    for (let i = 0; i < 10; i++) {
      const n = i < 4 ? 6 : 5;
      for (let j = 0; j < n; j++) this.place(deck.pop(), this.tableau[i], j === n - 1);
    }
    while (deck.length) this.place(deck.pop(), this.stock, false);
    this.score = 500;
    this.completed = 0;
  }

  extraState() {
    return { completed: this.completed };
  }
  restoreExtra(x) {
    this.completed = x ? x.completed : 0;
  }
  subtitle() {
    return `${Number(this.options.suits) || 1} 花色`;
  }

  layout(orient) {
    const piles = {};
    if (orient === 'portrait') {
      piles.stock = { x: 0, y: 0 };
      piles.f = { x: 9, y: 0 };
      this.tableau.forEach((t, i) => (piles[t.id] = { x: i, y: 1.3, fan: 'down' }));
      return { w: 10, h: 5, piles };
    }
    piles.stock = { x: 0, y: 0 };
    piles.f = { x: 0, y: 1.3 };
    this.tableau.forEach((t, i) => (piles[t.id] = { x: 1.4 + i, y: 0, fan: 'down' }));
    return { w: 11.4, h: 3.4, piles };
  }

  // 從 idx 到底是否為同花色遞減的一串
  isRun(pile, idx) {
    const cards = pile.cards;
    if (!cards[idx] || !cards[idx].faceUp) return false;
    for (let i = idx + 1; i < cards.length; i++) {
      if (cards[i].suit !== cards[i - 1].suit || cards[i].rank !== cards[i - 1].rank - 1) return false;
    }
    return true;
  }

  canPick(pile, idx) {
    return pile.kind === 'tableau' && this.isRun(pile, idx);
  }

  canDrop(from, idx, to) {
    if (to === from || to.kind !== 'tableau') return false;
    const c = from.cards[idx];
    const t = to.top;
    return t ? t.rank === c.rank + 1 : true;
  }

  drop(from, idx, to) {
    this.commit(
      () => {
        this.score -= 1;
        this.moveCards(from, idx, to);
        if (from.top && !from.top.faceUp) from.top.faceUp = true;
        this.checkComplete(to);
      },
      { t: 'move', f: from.id, i: idx, to: to.id }
    );
  }

  checkComplete(pile) {
    if (pile.size < 13) return;
    const start = pile.size - 13;
    if (pile.cards[start].rank !== 13 || !this.isRun(pile, start)) return;
    this.moveCards(pile, start, this.foundation);
    this.completed++;
    this.score += 100;
    if (pile.top && !pile.top.faceUp) pile.top.faceUp = true;
  }

  tap(pile, idx) {
    if (pile.kind === 'stock') {
      this.dealRow();
      return true;
    }
    return super.tap(pile, idx);
  }

  dealAction() {
    this.dealRow();
  }
  dealRow() {
    if (this.stock.empty) return;
    if (this.tableau.some((t) => t.empty)) {
      this.emit('message', '每一欄都要有牌才能發牌');
      return;
    }
    this.commit(() => {
      for (const t of this.tableau) {
        if (this.stock.empty) break;
        this.moveTop(this.stock, t, true);
        this.checkComplete(t);
      }
    }, { t: 'deal' });
  }

  autoTarget(pile, idx) {
    const c = pile.cards[idx];
    // 優先接同花色，其次任何大 1 的牌，最後才是空欄
    for (const t of this.tableau) if (t.top && t.top.suit === c.suit && this.canDrop(pile, idx, t)) return t;
    for (const t of this.tableau) if (t.top && this.canDrop(pile, idx, t)) return t;
    if (idx > 0) for (const t of this.tableau) if (t.empty) return t;
    return null;
  }

  rateMove(from, idx, to) {
    const c = from.cards[idx];
    if (to.empty) return idx === 0 ? -1 : 0.5;
    let s = to.top.suit === c.suit ? 3 : 1;
    if (idx > 0 && !from.cards[idx - 1].faceUp) s += 2;
    if (idx === 0) s += 1;
    return s;
  }

  hint() {
    const h = super.hint();
    if (h) return h;
    if (!this.stock.empty) return { pile: this.stock };
    return null;
  }

  isWon() {
    return this.foundation.size === 104;
  }

  // 卡死判定：疊牌欄之間沒有任何移動，且牌堆也發不出來
  hasMoves() {
    for (const t of this.tableau) {
      for (let i = 0; i < t.size; i++) {
        if (!this.canPick(t, i)) continue;
        for (const o of this.tableau) {
          if (o === t || !this.canDrop(t, i, o)) continue;
          if (o.empty && i === 0) continue; // 整欄搬到空欄沒有意義
          return true;
        }
      }
    }
    return !this.stock.empty && !this.tableau.some((t) => t.empty);
  }

  badge(pile) {
    if (pile === this.stock) return pile.size ? String(Math.ceil(pile.size / 10)) : '';
    if (pile === this.foundation) return `${this.completed}/8`;
    return '';
  }
}
