import { Game } from '../engine.js';
import { isRed } from '../cards.js';
import { msFreeCellDeal } from '../rng.js';

export class FreeCell extends Game {
  static meta = {
    id: 'freecell',
    name: '新接龍',
    en: 'FreeCell',
    desc: '全部牌面朝上，四個暫存格。幾乎每局都有解，靠推理取勝。',
    hasScore: false,
    hasAutoCollect: true,
  };

  init() {
    // 暫存格數量 4（標準）/ 3 / 2 / 1，越少越難
    const n = Math.min(4, Math.max(1, Number(this.options.cells) || 4));
    this.options.cells = n;
    this.cells = [];
    for (let i = 0; i < n; i++) this.cells.push(this.addPile('c' + i, 'cell'));
    this.foundations = [0, 1, 2, 3].map((i) => this.addPile('f' + i, 'foundation', { label: 'A' }));
    this.tableau = [];
    for (let i = 0; i < 8; i++) this.tableau.push(this.addPile('t' + i, 'tableau'));
    const deal = this.options.deal || (this.seed % 32000) + 1;
    this.options.deal = deal;
    const cols = msFreeCellDeal(deal);
    const cards = [];
    cols.forEach((col, i) =>
      col.forEach((c) => {
        const card = { id: `${c.suit}${c.rank}_0`, suit: c.suit, rank: c.rank, faceUp: true };
        cards.push(card);
        this.place(card, this.tableau[i]);
      })
    );
    this.registerCards(cards);
  }

  subtitle() {
    const n = this.options.cells;
    return `第 ${this.options.deal} 局` + (n === 4 ? '' : ` · ${n} 格`);
  }

  layout(orient) {
    const piles = {};
    if (orient === 'portrait') {
      this.cells.forEach((c, i) => (piles[c.id] = { x: i, y: 0 }));
      this.foundations.forEach((f, i) => (piles[f.id] = { x: 4 + i, y: 0 }));
      this.tableau.forEach((t, i) => (piles[t.id] = { x: i, y: 1.3, fan: 'down' }));
      return { w: 8, h: 5, piles };
    }
    // 橫向：暫存格與基礎堆放左側兩欄，疊牌欄用滿高度
    this.cells.forEach((c, i) => (piles[c.id] = { x: 0, y: i * 1.02 }));
    this.foundations.forEach((f, i) => (piles[f.id] = { x: 1.1, y: i * 1.02 }));
    this.tableau.forEach((t, i) => (piles[t.id] = { x: 2.5 + i, y: 0, fan: 'down' }));
    return { w: 10.5, h: 4.06, piles };
  }

  isRun(pile, idx) {
    const cards = pile.cards;
    for (let i = idx + 1; i < cards.length; i++) {
      if (isRed(cards[i].suit) === isRed(cards[i - 1].suit) || cards[i].rank !== cards[i - 1].rank - 1) return false;
    }
    return true;
  }

  canPick(pile, idx) {
    if (pile.kind === 'cell' || pile.kind === 'foundation') return idx === pile.size - 1;
    if (pile.kind === 'tableau') return this.isRun(pile, idx);
    return false;
  }

  maxMovable(to) {
    const freeCells = this.cells.filter((c) => c.empty).length;
    let emptyCols = this.tableau.filter((t) => t.empty).length;
    if (to && to.empty && to.kind === 'tableau') emptyCols--;
    return (freeCells + 1) * Math.pow(2, emptyCols);
  }

  canDrop(from, idx, to) {
    if (to === from) return false;
    const c = from.cards[idx];
    const n = from.size - idx;
    if (to.kind === 'cell') return n === 1 && to.empty;
    if (to.kind === 'foundation') {
      if (n !== 1) return false;
      const t = to.top;
      return t ? t.suit === c.suit && t.rank === c.rank - 1 : c.rank === 1;
    }
    if (to.kind === 'tableau') {
      if (n > this.maxMovable(to)) return false;
      const t = to.top;
      return t ? isRed(t.suit) !== isRed(c.suit) && t.rank === c.rank + 1 : true;
    }
    return false;
  }

  autoTarget(pile, idx) {
    const single = idx === pile.size - 1;
    if (single && pile.kind !== 'foundation') {
      for (const f of this.foundations) if (this.canDrop(pile, idx, f)) return f;
    }
    for (const t of this.tableau) if (!t.empty && this.canDrop(pile, idx, t)) return t;
    if (single && pile.kind !== 'cell') {
      for (const c of this.cells) if (c.empty) return c;
    }
    if (!(pile.kind === 'tableau' && idx === 0)) {
      for (const t of this.tableau) if (t.empty && this.canDrop(pile, idx, t)) return t;
    }
    return null;
  }

  isWon() {
    return this.foundations.every((f) => f.size === 13);
  }

  // 卡死判定：所有牌都沒有任何合法去處（暫存格滿了也算進去）
  hasMoves() {
    for (const from of this.piles) {
      if (from.kind === 'foundation') continue;
      for (let i = 0; i < from.size; i++) {
        if (!this.canPick(from, i)) continue;
        for (const to of this.piles) {
          if (to === from || !this.canDrop(from, i, to)) continue;
          if (to.kind === 'tableau' && to.empty && i === 0 && from.kind === 'tableau') continue;
          return true;
        }
      }
    }
    return false;
  }

  // 只自動收「安全」的牌：不會妨礙之後移動
  isSafeToFoundation(c) {
    if (c.rank <= 2) return true;
    const rankOf = (suit) => {
      const f = this.foundations.find((p) => p.top && p.top.suit === suit);
      return f ? f.top.rank : 0;
    };
    const opp = isRed(c.suit) ? ['S', 'C'] : ['H', 'D'];
    return opp.every((s) => rankOf(s) >= c.rank - 1);
  }

  autoCollectStep() {
    for (const p of [...this.tableau, ...this.cells]) {
      if (p.empty) continue;
      const c = p.top;
      if (!this.isSafeToFoundation(c)) continue;
      for (const f of this.foundations) {
        if (this.canDrop(p, p.size - 1, f)) {
          this.drop(p, p.size - 1, f);
          return true;
        }
      }
    }
    return false;
  }
}
