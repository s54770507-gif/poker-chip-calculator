// ── 撲克牌工具（純函式，無 DOM/Firebase 依賴）──

export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const SUITS = ['♠','♥','♦','♣'];
// 0=黑桃 1=紅心 2=方塊 3=梅花
export function cardRank(c) { return c % 13; }
export function cardSuit(c) { return Math.floor(c / 13); }
export function isRed(c) { const s = cardSuit(c); return s === 1 || s === 2; }

// Fisher-Yates 洗牌
export function shuffleDeck() {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// size: 'xs' | 'sm' | 'md' | 'lg'
export function cardHTML(c, size = 'md') {
  const r = RANKS[c % 13];
  const s = SUITS[Math.floor(c / 13)];
  const color = isRed(c) ? 'red' : 'black';
  return `<div class="card card-${size} ${color}"><span class="cr">${r}</span><span class="cs">${s}</span></div>`;
}

export function cardBackHTML(size = 'md') {
  return `<div class="card card-${size} card-back"></div>`;
}
