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
    return moved;
  }
  moveTop(from, to, faceUp) {
    const c = from.top;
    if (!c) return null;
    from.cards.pop();
    if (faceUp !== undefined) c.faceUp = faceUp;
    to.cards.push(c);
    this.cardPile.set(c.id, to);
    return c;
  }

  // ---- 快照 / 復原 ----
  snapshot() {
    return {
      p: this.piles.map((p) => p.cards.map((c) => (c.faceUp ? '' : '-') + c.id)),
      s: this.score,
      x: this.extraState(),
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
  // 還有沒有能推進局面的步（見下方提示與卡死判定）；各遊戲再加上牌堆能不能翻、能不能發牌
  hasMoves() {
    return this.usefulMoves(true).length > 0;
  }
  autoCollectStep() {
    return false;
  }
  // 按「收牌」卻收不了時給玩家看的原因；空字串時 App 顯示通用訊息
  collectBlockReason() {
    return '';
  }
  // hasMoves() 為 false 時，卡死橫幅上的說明，可用 \n 指定換行位置；空字串時顯示「沒有可走的步了」
  deadEndReason() {
    return this.legalMoves().length ? '只剩來回搬動的步\n沒有能推進局面的移動' : '';
  }
  badge() {
    return '';
  }
  winBonus() {
    return 0;
  }
  // 疊牌欄最上面那段「照順序、可以整串拿起」的牌從第幾張開始。
  // 渲染器把這張以下的面朝上牌稍微調暗，玩家一眼看出上面那串接得多長（蜘蛛、新接龍最有用）。
  // 預設沿用 canPick：從最上面往下，能拿起就算在串裡。經典接龍面朝上的牌本來就都成串，所以看不出差別。
  // 預設只看疊牌欄；金字塔覆寫成每個牌堆都看，被壓住的牌整張調暗
  runStart(pile) {
    if (pile.kind !== 'tableau' || pile.empty) return 0;
    let i = pile.size - 1;
    while (i > 0 && this.canPick(pile, i - 1)) i--;
    return i;
  }
  // 這一刻能一次整串搬走的牌從第幾張開始，不會小於 runStart。新接龍受暫存格與空欄數限制，串可能比這長；
  // 渲染器把 runStart 到這張之間的牌淡淡調暗，表示「成串，但現在搬不動整串」
  liftStart(pile) {
    return this.runStart(pile);
  }
  // 拖到 to 卻放不下時，若只差在規則的數量限制（例如新接龍張數超過上限），回傳給玩家看的原因；其他情況回傳空字串
  blockReason() {
    return '';
  }
  // 點一下卻沒地方去時的原因：逐一問每個牌堆，接在牌上的優先於空欄
  tapBlockReason(pile, idx) {
    const targets = this.piles.filter((p) => p !== pile).sort((a, b) => a.empty - b.empty);
    for (const to of targets) {
      const why = this.blockReason(pile, idx, to);
      if (why) return why;
    }
    return '';
  }
  // 牌桌上的附加面板（例如金字塔的湊 13 小表），由 layout().extras 指定位置
  extraHtml() {
    return '';
  }
  decorateExtra() {}

  // ---- 提示與卡死判定 ----
  // 提示只建議「有幫助」的移動，而且不建議走回這局出現過的局面，避免來回搬動繞圈：
  // - moveValue > 0：這一步本身就推進局面（收牌、翻開背面牌、清空一欄、接成更長的串…），越大越優先
  // - moveValue = 0：本身沒推進，只有走完後馬上有推進的步可走時才建議（例如先移開一張牌，好收下面那張）
  // - moveValue < 0：不建議
  // 卡死判定也用同一套：一步有幫助的都沒有就算卡死，不管還有沒有合法但沒意義的移動
  moveValue(from, idx, to) {
    if (to.kind === 'foundation') return 5;
    if (from.kind === 'foundation') return 0;
    if (idx > 0 && !from.cards[idx - 1].faceUp) return 4; // 翻開背面牌
    if (from.kind === 'tableau' && idx === 0) return to.empty ? -1 : 3; // 清空一欄；整欄搬到空欄沒有意義
    return 0;
  }
  legalMoves() {
    const out = [];
    for (const from of this.piles) {
      for (let i = 0; i < from.size; i++) {
        if (!this.canPick(from, i)) continue;
        for (const to of this.piles) {
          if (to === from || !this.canDrop(from, i, to)) continue;
          if (from.kind === 'foundation' && to.kind === 'foundation') continue; // A 在兩個空基礎堆之間搬沒有意義
          out.push({ from, idx: i, to });
        }
      }
    }
    return out;
  }
  // 局面的代號：同種類、可以互換的牌堆（疊牌欄、暫存格、基礎堆）不分先後，
  // 把一串牌在兩個一樣的位置之間搬來搬去，算同一個局面
  positionKey(snap = this.snapshot()) {
    let key = KEY_CACHE.get(snap);
    if (key) return key;
    const groups = {};
    snap.p.forEach((cards, i) => (groups[this.piles[i].kind] ||= []).push(cards.join()));
    key = Object.entries(groups)
      .map(([kind, list]) => kind + ':' + (SWAPPABLE.has(kind) ? list.sort() : list).join('|'))
      .join('/');
    KEY_CACHE.set(snap, key);
    return key;
  }
  // 這局走過的所有局面（復原堆疊裡每一步之前的局面，加上現在）
  visitedKeys() {
    const keys = new Set([this.positionKey()]);
    for (const s of this.undoStack) keys.add(this.positionKey(s));
    return keys;
  }
  // 試走一步，回傳走完後 fn() 的結果，然後完全還原：不留復原紀錄與動作日誌，也不觸發事件
  peek(m, fn) {
    const snap = this.snapshot();
    const saved = [this.undoStack, this.actions, this.moves, this.logComplete, this.won, this.replaying, this.selected];
    this.undoStack = [];
    this.actions = [];
    this.replaying = true;
    try {
      this.drop(m.from, m.idx, m.to);
      return fn();
    } finally {
      this.restore(snap);
      [this.undoStack, this.actions, this.moves, this.logComplete, this.won, this.replaying, this.selected] = saved;
    }
  }
  // 有幫助的移動，依幫助大小排序。first 為 true 時找到一個就回傳（卡死判定用，省時間）
  usefulMoves(first = false) {
    const visited = this.visitedKeys();
    const legal = this.legalMoves().map((m) => ({ ...m, value: this.moveValue(m.from, m.idx, m.to) }));
    const out = [];
    for (const m of legal.filter((m) => m.value > 0).sort((a, b) => b.value - a.value)) {
      if (this.peek(m, () => visited.has(this.positionKey()))) continue;
      out.push(m);
      if (first) return out;
    }
    if (out.length) return out;
    // 沒有直接推進的步：找「走完這步，下一步就能明顯推進」的鋪路移動，以下一步的幫助大小排序。
    // 下一步至少要有 SETUP_MIN 的幫助，小幫助（例如挖牌）不值得先多走一步
    for (const m of legal) {
      if (m.value !== 0) continue;
      const next = this.peek(m, () => {
        const here = this.positionKey();
        if (visited.has(here)) return 0;
        const follow = this.legalMoves()
          .map((n) => ({ ...n, value: this.moveValue(n.from, n.idx, n.to) }))
          .filter((n) => n.value >= SETUP_MIN)
          .sort((a, b) => b.value - a.value);
        for (const n of follow) {
          // 從基礎堆拿牌下來，唯一的用途是讓別的牌接在它上面；否則只是換個樣子繞回原本的局面
          if (m.from.kind === 'foundation' && n.to !== m.to) continue;
          const k = this.peek(n, () => this.positionKey());
          if (!visited.has(k) && k !== here) return n.value;
        }
        return 0;
      });
      if (next > 0) {
        out.push({ ...m, value: next / 10 });
        if (first) return out;
      }
    }
    return out.sort((a, b) => b.value - a.value);
  }
  // 提示清單：第一個最好，連按提示時依序換下一個。各遊戲可以在後面加上「點牌堆」之類的建議
  hints() {
    return this.usefulMoves();
  }
  hint() {
    return this.hints()[0] || null;
  }
}

const SETUP_MIN = 2;
const SWAPPABLE = new Set(['tableau', 'cell', 'foundation']);
const KEY_CACHE = new WeakMap(); // 快照 → 局面代號，復原堆疊裡的快照不會變，算過就記住
