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
    maxDeal: 1000000, // 與 Windows 相同的局號範圍
    dealNote: '局號與 Windows 新接龍相同，前 100 萬局中有 8 局無解（例如第 11982 局）。',
  };

  get dealNumber() {
    return this.options.deal;
  }
  static fromDeal(deal, options) {
    return new FreeCell(deal, { ...options, deal });
  }

  init() {
    // 暫存格數量 4（標準）/ 3 / 2 / 1，越少越難
    const n = Math.min(4, Math.max(1, Number(this.options.cells) || 4));
    this.options.cells = n;
    this.cells = [];
    for (let i = 0; i < n; i++) this.cells.push(this.addPile('c' + i, 'cell'));
    this.foundations = [0, 1, 2, 3].map((i) => this.addPile('f' + i, 'foundation', { label: 'A' }));
    this.tableau = [];
    for (let i = 0; i < 8; i++) this.tableau.push(this.addPile('t' + i, 'tableau'));
    const deal = this.options.deal || (this.seed % FreeCell.meta.maxDeal) + 1;
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
    return n === 4 ? '' : `${n} 格`;
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

  // 單張牌 c 接不接得上疊牌欄 to（不管張數上限）
  fitsTableau(c, to) {
    const t = to.top;
    return t ? isRed(t.suit) !== isRed(c.suit) && t.rank === c.rank + 1 : true;
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
    if (to.kind === 'tableau') return n <= this.maxMovable(to) && this.fitsTableau(c, to);
    return false;
  }

  // 接得上、只差張數超過上限時，說明這一刻最多能搬幾張
  blockReason(from, idx, to) {
    if (to === from || to.kind !== 'tableau' || !this.canPick(from, idx)) return '';
    if (to.empty && from.kind === 'tableau' && idx === 0) return ''; // 整欄搬到空欄沒有意義
    const n = from.size - idx;
    const max = this.maxMovable(to);
    if (n <= max || !this.fitsTableau(from.cards[idx], to)) return '';
    const cells = this.cells.filter((p) => p.empty).length;
    const cols = this.tableau.filter((p) => p.empty && p !== to).length;
    return to.empty
      ? `這串 ${n} 張，搬到空欄一次最多 ${max} 張（空暫存格 ${cells}、其他空欄 ${cols}）`
      : `這串 ${n} 張，一次最多搬 ${max} 張（空暫存格 ${cells}、空欄 ${cols}）`;
  }

  // 串比可搬上限長時，只有最上面那幾張算「現在搬得動」。上限以搬到非空欄計算：所有空欄都能借用，是最寬的情況
  liftStart(pile) {
    const start = this.runStart(pile);
    if (pile.kind !== 'tableau') return start;
    return Math.max(start, pile.size - this.maxMovable(null));
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

  // 提示與卡死判定用：收牌、空出暫存格、清空一欄、把一串從接不上的牌上移開，算有幫助；
  // 放進暫存格、移到空欄只有在「挖牌」（移開壓在下一張要收的牌上面的牌）或能鋪路時才建議，
  // 這樣連續好幾步把牌移進暫存格、挖出底下的 A，也不會被當成卡死
  moveValue(from, idx, to) {
    if (to.kind === 'foundation') return 5;
    if (from.kind === 'foundation') return 0;
    if (from.kind === 'cell') return to.empty ? 0 : 2;
    const dig = this.digs(from, idx) ? 1 : 0;
    if (to.kind === 'cell') return dig;
    if (idx === 0) return to.empty ? -1 : 3;
    const c = from.cards[idx];
    const p = from.cards[idx - 1];
    const linked = isRed(p.suit) !== isRed(c.suit) && p.rank === c.rank + 1;
    return linked || to.empty ? dig : 2;
  }
  // from 欄第 idx 張底下有沒有某個花色下一張要收的牌，而且壓在它上面的張數不超過空暫存格加空欄，挖得完
  digs(from, idx) {
    if (from.kind !== 'tableau') return false;
    const room = this.cells.filter((p) => p.empty).length + this.tableau.filter((p) => p.empty).length;
    for (let i = 0; i < idx; i++) {
      const c = from.cards[i];
      const f = this.foundations.find((p) => p.top && p.top.suit === c.suit);
      if (c.rank === (f ? f.top.rank : 0) + 1 && from.size - 1 - i <= room) return true;
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
