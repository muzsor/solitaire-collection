// 撲克牌基本定義

export const SUITS = ['S', 'H', 'D', 'C'];
// 結尾的 U+FE0E 是「文字呈現」選擇符，避免 Android 把 ♥ ♦ 畫成彩色 emoji
export const SUIT_SYMBOL = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };
export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function isRed(suit) {
  return suit === 'H' || suit === 'D';
}

// 建立 decks 副牌，可指定只用哪些花色（蜘蛛接龍 1 / 2 花色用）
export function makeDeck(decks = 1, suits = SUITS) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const s of suits) {
      for (let r = 1; r <= 13; r++) {
        cards.push({ id: `${s}${r}_${d}`, suit: s, rank: r, faceUp: false });
      }
    }
  }
  return cards;
}

export function cardName(c) {
  return RANK_LABEL[c.rank] + SUIT_SYMBOL[c.suit];
}
