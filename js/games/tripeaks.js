import { Game } from '../engine.js';
import { makeDeck } from '../cards.js';
import { shuffle } from '../rng.js';

const ROWS = [
  [1.5, 4.5, 7.5],
  [1, 2, 4, 5, 7, 8],
  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
];

export class TriPeaks extends Game {
  static meta = {
    id: 'tripeaks',
    name: '三峰',
    en: 'TriPeaks',
    desc: '點比棄牌堆頂大 1 或小 1 的牌，連消得分，把三座山峰清空。',
    hasScore: true,
    hasAutoCollect: false,
  };

  init() {
    this.slots = [];
    ROWS.forEach((xs, r) =>
      xs.forEach((x, i) => {
        this.slots.push(this.addPile(`p${r}_${i}`, 'slot', { placeholder: false, meta: { row: r, x, z: r } }));
      })
    );
    this.stock = this.addPile('stock', 'stock');
    this.waste = this.addPile('waste', 'waste');
    const deck = shuffle(makeDeck(1), this.rng);
    this.registerCards(deck);
    for (const s of this.slots) this.place(deck.pop(), s, s.meta.row === 3);
    this.place(deck.pop(), this.waste, true);
    while (deck.length) this.place(deck.pop(), this.stock, false);
    this.score = 0;
    this.streak = 0;
    this.peaksCleared = 0;
  }

  extraState() {
    return { streak: this.streak, peaksCleared: this.peaksCleared };
  }
  restoreExtra(x) {
    this.streak = x ? x.streak : 0;
    this.peaksCleared = x ? x.peaksCleared : 0;
  }

  layout(orient) {
    const piles = {};
    const dx = orient === 'portrait' ? 0 : 1.3;
    for (const s of this.slots) piles[s.id] = { x: s.meta.x + dx, y: s.meta.row * 0.5 };
    if (orient === 'portrait') {
      piles.stock = { x: 3.5, y: 2.9 };
      piles.waste = { x: 5.5, y: 2.9 };
      return { w: 10, h: 3.9, piles, centerY: true };
    }
    piles.stock = { x: 0, y: 0.6 };
    piles.waste = { x: 0, y: 1.7 };
    return { w: 11.3, h: 2.5, piles, centerY: true };
  }

  slotAt(row, x) {
    return this.slots.find((s) => s.meta.row === row && Math.abs(s.meta.x - x) < 0.01);
  }
  isFree(pile) {
    if (pile.kind !== 'slot' || pile.empty) return false;
    const { row, x } = pile.meta;
    const a = this.slotAt(row + 1, x - 0.5);
    const b = this.slotAt(row + 1, x + 0.5);
    return (!a || a.empty) && (!b || b.empty);
  }
  adjacent(a, b) {
    const d = Math.abs(a.rank - b.rank);
    return d === 1 || d === 12;
  }

  canPick(pile, idx) {
    return idx === pile.size - 1 && this.isFree(pile) && pile.top.faceUp;
  }
  canDrop(from, idx, to) {
    return to === this.waste && !to.empty && this.adjacent(from.cards[idx], to.top);
  }

  drop(from, idx, to) {
    this.commit(
      () => {
        this.streak++;
        this.score += this.streak;
        this.moveTop(from, this.waste, true);
        if (from.meta.row === 0) {
          this.peaksCleared++;
          this.score += this.peaksCleared === 3 ? 30 : 15;
        }
        this.flipFree();
      },
      { t: 'move', f: from.id, i: idx, to: to.id }
    );
  }
  dealAction() {
    this.dealStock();
  }
  flipFree() {
    for (const s of this.slots) if (this.isFree(s) && !s.top.faceUp) s.top.faceUp = true;
  }

  autoTarget(pile, idx) {
    return this.canDrop(pile, idx, this.waste) ? this.waste : null;
  }

  tap(pile, idx) {
    if (pile.kind === 'stock') {
      this.dealStock();
      return true;
    }
    return super.tap(pile, idx);
  }
  dealStock() {
    if (this.stock.empty) return;
    this.commit(() => {
      this.streak = 0;
      this.score = Math.max(0, this.score - 5);
      this.moveTop(this.stock, this.waste, true);
    }, { t: 'deal' });
  }

  isWon() {
    return this.slots.every((s) => s.empty);
  }
  hasMoves() {
    if (!this.stock.empty) return true;
    return this.slots.some((s) => this.canPick(s, s.size - 1) && this.canDrop(s, s.size - 1, this.waste));
  }
  hint() {
    // 優先挑會解開上層牌的
    const cands = this.slots.filter((s) => this.canPick(s, s.size - 1) && this.canDrop(s, s.size - 1, this.waste));
    if (cands.length) {
      cands.sort((a, b) => a.meta.row - b.meta.row);
      return { from: cands[0], idx: 0, to: this.waste };
    }
    if (!this.stock.empty) return { pile: this.stock };
    return null;
  }
  badge(pile) {
    if (pile === this.stock) return pile.size ? String(pile.size) : '';
    return '';
  }
}
