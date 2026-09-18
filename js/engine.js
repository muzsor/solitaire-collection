// 共用遊戲引擎：牌堆、移動、復原、存檔

import { mulberry32 } from './rng.js';

export class Pile {
  constructor(id, kind, opts = {}) {
    this.id = id;
    this.kind = kind; // stock | waste | foundation | tableau | cell | slot | done
    this.cards = [];
    this.meta = opts.meta || {};
    this.placeholder = opts.placeholder !== false; // 空的時候是否顯示虛線框
    this.label = opts.label || '';
  }
  get top() {
    return this.cards.length ? this.cards[this.cards.length - 1] : null;
  }
  get size() {
    return this.cards.length;
  }
  get empty() {
    return this.cards.length === 0;
  }
}

export class Game {
  static meta = { id: 'base', name: '', en: '', desc: '', hasScore: false, hasAutoCollect: false };

  constructor(seed, options = {}) {
    this.seed = seed;
    this.options = { ...options };
    this.rng = mulberry32(seed);
    this.piles = [];
    this.pileById = new Map();
    this.cards = [];
    this.cardById = new Map();
    this.cardPile = new Map();
    this.undoStack = [];
    this.moves = 0;
    this.score = 0;
    this.won = false;
    this.selected = null; // 金字塔用：目前選取的牌
    this.lastMove = null; // 最近一次搬動 {card, from, to}，提示用來避免建議「搬回去」
    this.initialSnap = null; // 發牌完成時的快照，「回到這局開頭」用
    // 動作日誌：每一步都記成可重播的小物件（例如 {t:'move', f:'t0', i:3, to:'f1'}）
    // 存檔只存這份日誌，重開時從同一個 seed 發牌再重播，比存快照小數十倍
    this.actions = [];
    this.logComplete = true; // 若有未附動作的 commit（測試或作弊），日誌就不可信，改存快照
    this.replaying = false;
    this.listeners = {};
  }

  // 建立牌局：呼叫子類別的 init() 發牌，並記住初始狀態
  boot() {
    this.init();
    this.initialSnap = this.snapshot();
    return this;
  }

  get meta() {
    return this.constructor.meta;
  }

  // ---- 事件 ----
  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
  }
  emit(ev, data) {
    (this.listeners[ev] || []).forEach((fn) => fn(data));
  }

  // ---- 建構 ----
  addPile(id, kind, opts) {
    const p = new Pile(id, kind, opts);
    this.piles.push(p);
    this.pileById.set(id, p);
    return p;
  }
  registerCards(cards) {
    for (const c of cards) {
      this.cards.push(c);
      this.cardById.set(c.id, c);
    }
  }
  place(card, pile, faceUp) {
    if (faceUp !== undefined) card.faceUp = faceUp;
    pile.cards.push(card);
    this.cardPile.set(card.id, pile);
  }
  pileOf(card) {
    return this.cardPile.get(card.id);
  }

  // ---- 移動 ----
  moveCards(from, idx, to) {
    const moved = from.cards.splice(idx);
    for (const c of moved) {
      to.cards.push(c);
      this.cardPile.set(c.id, to);
    }
    if (moved.length) this.lastMove = { card: moved[0].id, from: from.id, to: to.id };
    return moved;
  }
  moveTop(from, to, faceUp) {
    const c = from.top;
    if (!c) return null;
    from.cards.pop();
    if (faceUp !== undefined) c.faceUp = faceUp;
    to.cards.push(c);
    this.cardPile.set(c.id, to);
    this.lastMove = { card: c.id, from: from.id, to: to.id };
    return c;
  }
  // 這一步是否只是把上一步搬回去
  isReverseOfLast(from, idx, to) {
    const m = this.lastMove;
    return !!m && m.card === from.cards[idx].id && m.from === to.id && m.to === from.id;
  }

  // ---- 快照 / 復原 ----
  snapshot() {
    return {
      p: this.piles.map((p) => p.cards.map((c) => (c.faceUp ? '' : '-') + c.id)),
      s: this.score,
      x: this.extraState(),
      m: this.lastMove,
    };
  }
  restore(snap) {
    this.piles.forEach((p, i) => {
      p.cards = snap.p[i].map((tok) => {
        const down = tok[0] === '-';
        const c = this.cardById.get(down ? tok.slice(1) : tok);
        c.faceUp = !down;
        this.cardPile.set(c.id, p);
        return c;
      });
    });
    this.score = snap.s;
    this.restoreExtra(snap.x);
    this.selected = null;
    this.lastMove = snap.m || null;
  }
  // action：這一步的可重播描述；沒給的話日誌就不完整，存檔會退回存快照
  commit(fn, action) {
    if (this.won) return;
    const snap = this.snapshot();
    fn();
    this.moves++;
    this.undoStack.push(snap);
    if (this.undoStack.length > 500) this.undoStack.shift();
    if (action) this.actions.push(action);
    else this.logComplete = false;
    if (!this.replaying) this.emit('change');
    if (this.isWon()) {
      this.won = true;
      if (!this.replaying) this.emit('win');
    }
  }
  canUndo() {
    return this.undoStack.length > 0 && !this.won;
  }
  // 回到這局開頭：同一副牌序，步數與分數歸零，不算放棄
  // 用發牌時存下的初始快照，不受復原堆疊長度限制
  restart() {
    if (!this.initialSnap || this.moves === 0) return false;
    this.restore(this.initialSnap);
    this.undoStack = [];
    this.actions = [];
    this.logComplete = true;
    this.moves = 0;
    this.won = false;
    this.emit('change');
    return true;
  }
  undo() {
    if (!this.canUndo()) return false;
    this.restore(this.undoStack.pop());
    this.actions.pop();
    this.emit('change');
    return true;
  }

  // ---- 動作重播 ----
  pile(id) {
    const p = this.pileById.get(id);
    if (!p) throw new Error('找不到牌堆 ' + id);
    return p;
  }
  // 各遊戲若有「牌堆發牌」動作，覆寫這個方法
  dealAction() {
    throw new Error('這個遊戲沒有發牌動作');
  }
  applyAction(a) {
    switch (a.t) {
      case 'move':
        return this.drop(this.pile(a.f), a.i, this.pile(a.to));
      case 'deal':
        return this.dealAction();
      default:
        throw new Error('未知動作 ' + a.t);
    }
  }

  // ---- 存檔 ----
  // 日誌完整：存 actions（每步約 20 個字元）＋最終快照當校驗
  // 日誌不完整：退回存快照與最近 50 步復原
  serialize() {
    return {
      id: this.meta.id,
      seed: this.seed,
      options: this.options,
      moves: this.moves,
      won: this.won,
      snap: this.snapshot(),
      actions: this.logComplete ? this.actions : null,
      undo: this.logComplete ? undefined : this.undoStack.slice(-50),
    };
  }
  static sameState(a, b) {
    return !!a && !!b && JSON.stringify([a.p, a.s, a.x]) === JSON.stringify([b.p, b.s, b.x]);
  }
  static deserialize(Cls, data) {
    let g = new Cls(data.seed, data.options).boot(); // 同樣的 seed 與選項會發出同一副牌
    let replayed = false;
    if (Array.isArray(data.actions)) {
      g.replaying = true;
      try {
        for (const a of data.actions) g.applyAction(a);
        replayed = !data.snap || Game.sameState(g.snapshot(), data.snap);
      } catch {
        replayed = false;
      }
      g.replaying = false;
    }
    if (!replayed) {
      // 重播失敗（規則改版或日誌損壞）：直接採用最終快照，復原歷史只剩存檔裡有的
      g = new Cls(data.seed, data.options).boot();
      g.restore(data.snap);
      g.undoStack = data.undo || [];
      g.actions = [];
      g.logComplete = false;
    }
    g.moves = Math.max(data.moves || 0, g.actions.length);
    g.won = !!data.won;
    return g;
  }

  // 局號：預設就是種子，同一局號加同一組選項會發出同一副牌；新接龍覆寫成微軟牌局編號
  get dealNumber() {
    return this.seed;
  }
  // 用局號開新局（選單「輸入局號」）；新接龍覆寫，把編號放進 options.deal
  static fromDeal(deal, options) {
    return new this(deal, options);
  }

  // ---- 各遊戲覆寫 ----
  init() {}
  extraState() {
    return null;
  }
  restoreExtra() {}
  subtitle() {
    return '';
  }
  layout() {
    return { w: 1, h: 1, piles: {} };
  }
  canPick() {
    return false;
  }
  canDrop() {
    return false;
  }
  drop(from, idx, to) {
    this.commit(
      () => {
        this.moveCards(from, idx, to);
        this.afterMove(from, to);
      },
      { t: 'move', f: from.id, i: idx, to: to.id }
    );
  }
  afterMove() {}
  tap(pile, idx) {
    if (!this.canPick(pile, idx)) return false;
    const to = this.autoTarget(pile, idx);
    if (!to) return false;
    this.drop(pile, idx, to);
    return true;
  }
  tapEmpty() {
    return false;
  }
  autoTarget() {
    return null;
  }
  isWon() {
    return false;
  }
  hasMoves() {
    return true;
  }
  autoCollectStep() {
    return false;
  }
  badge() {
    return '';
  }
  winBonus() {
    return 0;
  }
  // 牌桌上的附加面板（例如金字塔的湊 13 小表），由 layout().extras 指定位置
  extraHtml() {
    return '';
  }
  decorateExtra() {}

  // 通用提示：列舉所有合法移動，挑分數最高的
  hint() {
    let best = null;
    let bestScore = -Infinity;
    for (const from of this.piles) {
      for (let i = 0; i < from.size; i++) {
        if (!this.canPick(from, i)) continue;
        for (const to of this.piles) {
          if (to === from || !this.canDrop(from, i, to)) continue;
          if (this.isReverseOfLast(from, i, to)) continue; // 不建議把剛搬的牌搬回去
          const s = this.rateMove(from, i, to);
          if (s > bestScore) {
            bestScore = s;
            best = { from, idx: i, to };
          }
        }
      }
    }
    return bestScore < 0 ? null : best;
  }
  rateMove(from, idx, to) {
    if (from.kind === 'foundation') return -1;
    if (to.kind === 'foundation') return 5;
    if (to.kind === 'tableau') {
      if (to.empty) return idx === 0 ? -1 : 1;
      if (idx > 0 && !from.cards[idx - 1].faceUp) return 4;
      if (idx === 0) return 2;
      return 1.5;
    }
    if (to.kind === 'cell') return 0.5;
    return 1;
  }
}
