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

  // 一直翻牌堆（含重翻）會不會翻到打得出去的牌，有的話翻牌堆才有意義。
  // 模擬翻完一整輪：翻 3 張時只有每次翻出的最上面那張拿得到，不是牌堆裡每張都輪得到
  stockUseful() {
    const playable = (c) => this.foundations.some((f) => this.fits(c, f)) || this.tableau.some((t) => this.fits(c, t));
    const n = this.options.draw3 ? 3 : 1;
    let stock = [...this.stock.cards];
    let waste = [...this.waste.cards];
    const total = stock.length + waste.length;
    for (let k = 0; k < total * 2 + 2 && total; k++) {
      if (!stock.length) {
        stock = waste.reverse(); // 重翻：棄牌堆整疊翻回牌堆
        waste = [];
        continue;
      }
      for (let j = 0; j < n && stock.length; j++) waste.push(stock.pop());
      if (playable(waste[waste.length - 1])) return true;
    }
    return false;
  }
  hasMoves() {
    return this.stockUseful() || super.hasMoves();
  }
  deadEndReason() {
    if (!this.stock.empty || !this.waste.empty) return '牌堆裡沒有能用的牌\n疊牌欄也沒有能推進的步';
    return super.deadEndReason();
  }
  // 棄牌堆的牌接到疊牌欄，就是把一張牌拿進來用
  moveValue(from, idx, to) {
    if (from.kind === 'waste') return to.kind === 'foundation' ? 5 : 3;
    return super.moveValue(from, idx, to);
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

  hints() {
    const list = super.hints();
    if (this.stockUseful()) list.push({ pile: this.stock });
    return list;
  }

  badge(pile) {
    if (pile === this.stock && this.options.draw3) return pile.size ? String(pile.size) : '';
    return '';
  }

  winBonus(seconds) {
    return seconds > 30 ? Math.round(700000 / seconds) : 0;
  }
}
