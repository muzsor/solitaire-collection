import { Game } from '../engine.js';
import { makeDeck } from '../cards.js';
import { shuffle } from '../rng.js';
import { solveSpider } from './spider-solver.js';

export class Spider extends Game {
  static meta = {
    id: 'spider',
    name: '蜘蛛接龍',
    en: 'Spider',
    desc: '兩副牌、十欄。同花色從 K 到 A 排成一整串才能收走。',
    hasScore: true,
    hasAutoCollect: true,
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
  // 桌上的牌少於欄數、牌堆又還有牌：怎麼搬都填不滿每一欄，永遠發不了牌，這局已經無法完成
  cannotDeal() {
    return !this.stock.empty && this.tableCount() < this.tableau.length;
  }
  tableCount() {
    return this.tableau.reduce((n, t) => n + t.size, 0);
  }
  dealRow() {
    if (this.stock.empty) return;
    if (this.tableau.some((t) => t.empty)) {
      this.emit('message', this.cannotDeal() ? this.deadEndReason().replace('\n', '，') : '每一欄都要有牌才能發牌');
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

  // 點一下時：在所有能接的欄裡挑最有幫助的（和提示同一套評分），湊得成 K→A 的最優先、
  // 再來是接成更長的同花色串；都沒有能接的牌才放到空欄
  autoTarget(pile, idx) {
    let best = null;
    let bestValue = -Infinity;
    for (const t of this.tableau) {
      if (t.empty || !this.canDrop(pile, idx, t)) continue;
      const v = this.moveValue(pile, idx, t);
      if (v > bestValue) {
        bestValue = v;
        best = t;
      }
    }
    if (best) return best;
    if (idx > 0) for (const t of this.tableau) if (t.empty) return t;
    return null;
  }

  // 第 i 張往欄底方向，同花色連續的那串從第幾張開始
  runBase(pile, i) {
    const cards = pile.cards;
    while (i > 0 && cards[i - 1].faceUp && cards[i - 1].suit === cards[i].suit && cards[i - 1].rank === cards[i].rank + 1) i--;
    return i;
  }

  // 提示與卡死判定用：一步有多少幫助
  moveValue(from, idx, to) {
    const c = from.cards[idx];
    const parent = idx > 0 ? from.cards[idx - 1] : null;
    if (to.empty) {
      if (!parent) return -1; // 整欄搬到空欄沒有意義
      if (!parent.faceUp) return 4; // 翻開背面牌
      return parent.suit === c.suit && parent.rank === c.rank + 1 ? -1 : 0; // 不為了填空欄拆開同花色的串
    }
    const sameSuit = to.top.suit === c.suit;
    const toBase = this.runBase(to, to.size - 1);
    const linkedSuit = !!parent && parent.faceUp && parent.suit === c.suit && parent.rank === c.rank + 1;
    const linkedRank = !!parent && parent.faceUp && parent.rank === c.rank + 1;
    const completes = sameSuit && to.cards[toBase].rank === 13 && from.top.rank === 1; // 湊成 K→A，整串收走
    // 把整欄接走、清空一欄：牌堆還有牌時，發牌前還得再補滿（通常要拆一串），一來一回等於沒推進，
    // 所以只有湊得成整串，或接下來用得上這個空欄時才建議
    if (!parent && !this.stock.empty) return completes ? 10 : 0;
    let v = completes ? 10 : 0;
    if (!parent) v += 3; // 清空一欄
    else if (!parent.faceUp) v += 4; // 翻開背面牌
    if (sameSuit && !linkedSuit) {
      v += 2 + (to.size - toBase + from.size - idx) * 0.05; // 接成更長的同花色串，越長越好
    } else if (sameSuit) {
      // 原本就接在同花色上：只有改接到從 K 開始的那串才有幫助
      if (to.cards[toBase].rank === 13 && from.cards[this.runBase(from, idx - 1)].rank !== 13) v += 1;
    } else if (linkedSuit) {
      v -= 1; // 把同花色的串拆開、接到別的花色上
    } else if (parent && parent.faceUp && !linkedRank) {
      v += 1; // 從接不上的牌上移開
    }
    return v;
  }

  // 這局已經無法完成時不給提示；還能發牌時，發牌排在所有移動之後。
  // 有空欄、又沒有其他有幫助的步時，建議補滿空欄好發牌（不拆同花色串的優先）
  hints() {
    if (this.cannotDeal()) return [];
    const list = super.hints();
    if (this.stock.empty) return list;
    if (!this.tableau.some((t) => t.empty)) return [...list, { pile: this.stock }];
    if (list.length) return list;
    return this.legalMoves()
      .filter((m) => m.to.empty && m.idx > 0)
      .map((m) => ({ ...m, value: this.moveValue(m.from, m.idx, m.to) }))
      .sort((a, b) => b.value - a.value);
  }

  isWon() {
    return this.foundation.size === 104;
  }

  // 卡死判定：桌上的牌填不滿每一欄；或牌堆發完、也沒有能推進的步。
  // 牌堆還有牌、桌上又夠 10 張時，補滿空欄就能發牌，不算卡死
  hasMoves() {
    if (this.cannotDeal()) return false;
    if (!this.stock.empty) return true;
    return super.hasMoves();
  }

  deadEndReason() {
    if (this.cannotDeal()) return `桌上只剩 ${this.tableCount()} 張牌\n填不滿 ${this.tableau.length} 欄，無法再發牌`;
    return super.deadEndReason();
  }

  // 自動收牌只處理簡單殘局：牌堆發完、全部翻開，而且每一欄都只剩一串同花色連續的牌，
  // 這時只需要把各段接起來，求解器很快就能算出最少步數
  collectBlockReason() {
    if (!this.stock.empty) return '牌堆發完後才能自動收牌';
    if (this.tableau.some((t) => t.cards.some((c) => !c.faceUp))) return '所有牌都翻開後才能自動收牌';
    if (!this.tableau.every((t) => t.empty || this.isRun(t, 0))) return '每一欄都排成一串同花色連續的牌後，才能自動收牌';
    return this.collectFail || '';
  }
  tableauKey() {
    return this.tableau.map((t) => t.cards.map((c) => c.id).join()).join('|');
  }
  // 第一次呼叫時算出整套走法，之後每呼叫一次走一步。收牌途中局面被改動（例如按了復原）就重新算
  autoCollectStep() {
    this.collectFail = '';
    if (this.collectBlockReason()) return false;
    const key = this.tableauKey();
    const plan = this.collectPlan;
    if (!plan || plan.key !== key || plan.i >= plan.moves.length) {
      const r = solveSpider(this.tableau.map((t) => t.cards));
      if (!r.moves) {
        this.collectPlan = null;
        this.collectFail = '這個殘局沒辦法自動收完';
        return false;
      }
      this.collectPlan = { moves: r.moves, i: 0 };
    }
    const m = this.collectPlan.moves[this.collectPlan.i++];
    this.drop(this.tableau[m.a], m.s, this.tableau[m.b]);
    this.collectPlan.key = this.tableauKey();
    return true;
  }

  badge(pile) {
    if (pile === this.stock) return pile.size ? String(Math.ceil(pile.size / 10)) : '';
    if (pile === this.foundation) return `${this.completed}/8`;
    return '';
  }
}
