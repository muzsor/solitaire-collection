// 隨機數與洗牌工具

// mulberry32：可重現的 32 位元偽隨機數，seed 相同則牌序相同（用於「重玩這局」）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  const s = (Math.random() * 0x7fffffff) >>> 0;
  return s || 1;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Microsoft FreeCell 牌局編號演算法（1 ~ 32000），與 Windows 新接龍的牌局一致
// 回傳 8 欄，每欄為 {suit, rank} 陣列（由上到下）
export function msFreeCellDeal(gameNumber) {
  let seed = gameNumber >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    return (seed >>> 16) & 0x7fff;
  };
  const deck = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  const cols = [[], [], [], [], [], [], [], []];
  for (let i = 0; i < 51; i++) {
    const j = rand() % (52 - i);
    [deck[j], deck[51 - i]] = [deck[51 - i], deck[j]];
    cols[i % 8].push(deck[51 - i]);
  }
  cols[51 % 8].push(deck[0]);
  return cols.map((col) => col.map((i) => ({ suit: 'CDHS'[i % 4], rank: Math.floor(i / 4) + 1 })));
}
