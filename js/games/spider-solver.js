// 蜘蛛接龍殘局求解：牌堆發完、所有牌都翻開之後，找出把剩下的牌全部收走的最少步數。
// 一步 = 一次搬動，整串搬也算一步（和遊戲的步數算法相同）；排成 K→A 同花色一整串就自動收走。
//
// 只用在「每一欄都只剩一串同花色連續的牌」的簡單殘局（條件由 spider.js 把關），這時只需要把各段接起來。
//
// 用 IDA*，下限估計 h = 「一定還得搬一次」的段數：每一段同花色連續的牌，最底下那張若不是 K，
// 就不可能在原地湊成 K→A，遲早要整段搬走。一步只會搬動一段，所以 h 每步最多減 1、不會高估，
// 搜到的就是最少步數。搜尋量設上限，萬一超過就當作算不出來，不讓畫面卡住。

const SUIT_CODE = { S: 0, H: 1, D: 2, C: 3 };
const KING = 13;
const FOUND = -1;
class Abort extends Error {}

// 牌編碼成 花色×16 + 點數，同花色小 1 的牌剛好是「減 1」
const encode = (c) => SUIT_CODE[c.suit] * 16 + c.rank;
const rank = (v) => v & 15;

function lowerBound(cols) {
  let h = 0;
  for (const col of cols) {
    if (!col.length) continue;
    if (rank(col[0]) !== KING) h++;
    for (let k = 1; k < col.length; k++) if (col[k] !== col[k - 1] - 1 && rank(col[k]) !== KING) h++;
  }
  return h;
}

// 欄的順序不影響還要幾步，排序後當作同一個局面
const keyOf = (cols) => cols.map((c) => String.fromCharCode(...c)).sort().join('|');

function listMoves(cols) {
  const out = [];
  for (let a = 0; a < cols.length; a++) {
    const col = cols[a];
    const n = col.length;
    if (!n) continue;
    let r = n - 1;
    while (r > 0 && col[r] === col[r - 1] - 1) r--; // 最上面那串可以拿起來的起點
    for (let s = r; s < n; s++) {
      const c = col[s];
      let triedEmpty = false;
      for (let b = 0; b < cols.length; b++) {
        if (b === a) continue;
        const t = cols[b];
        if (!t.length) {
          // 整欄搬到空欄沒有意義；空欄彼此一樣，試一個就好
          if (s === 0 || triedEmpty) continue;
          triedEmpty = true;
          out.push({ a, s, b, p: 0 });
        } else if (rank(t[t.length - 1]) === rank(c) + 1) {
          // 先試接在同花色上、和把原本接不起來的地方拆開的走法，最少步數通常在這裡
          let p = t[t.length - 1] === c + 1 ? 2 : 1;
          if (s > 0 && col[s - 1] !== c + 1) p++;
          out.push({ a, s, b, p });
        }
      }
    }
  }
  return out.sort((x, y) => y.p - x.p);
}

// 搬動並在湊成 K→A 時收走，回傳收走的那串（復原用）
function apply(cols, m) {
  const from = cols[m.a];
  const to = cols[m.b];
  const seg = from.splice(m.s);
  m.n = seg.length;
  for (const v of seg) to.push(v);
  const L = to.length;
  if (L < 13 || rank(to[L - 13]) !== KING) return null;
  for (let k = L - 12; k < L; k++) if (to[k] !== to[k - 1] - 1) return null;
  return to.splice(L - 13);
}
function undo(cols, m, done) {
  const from = cols[m.a];
  const to = cols[m.b];
  if (done) for (const v of done) to.push(v);
  for (const v of to.splice(to.length - m.n)) from.push(v);
}

// columns：每一欄由下到上的牌 {suit, rank}，必須全部面朝上
// 回傳 { moves: [{a, s, b}] }：依序把第 a 欄從第 s 張起的牌搬到第 b 欄；
// 收不完回傳 { moves: null, reason: 'unsolvable' | 'budget' }
export function solveSpider(columns, { budget = 50000 } = {}) {
  const cols = columns.map((col) => col.map(encode));
  const path = [];
  let nodes = 0;
  let bound = lowerBound(cols);
  for (;;) {
    const seen = new Map(); // 這一輪裡每個局面最早在第幾步到過
    const dfs = (g) => {
      const f = g + lowerBound(cols);
      if (f > bound) return f;
      if (cols.every((c) => !c.length)) return FOUND;
      if (++nodes > budget) throw new Abort();
      const key = keyOf(cols);
      const at = seen.get(key);
      if (at !== undefined && at <= g) return Infinity;
      seen.set(key, g);
      let min = Infinity;
      for (const m of listMoves(cols)) {
        const done = apply(cols, m);
        path.push(m);
        const t = dfs(g + 1);
        if (t === FOUND) return FOUND;
        path.pop();
        undo(cols, m, done);
        if (t < min) min = t;
      }
      return min;
    };
    let t;
    try {
      t = dfs(0);
    } catch (e) {
      if (e instanceof Abort) return { moves: null, reason: 'budget' };
      throw e;
    }
    if (t === FOUND) return { moves: path.map(({ a, s, b }) => ({ a, s, b })) };
    if (t === Infinity) return { moves: null, reason: 'unsolvable' };
    bound = t;
  }
}

