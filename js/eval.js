// ── Texas Hold'em 手牌評估（純函式）──

export const HAND_NAMES = ['高牌','一對','兩對','三條','順子','同花','葫蘆','四條','同花順'];

function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...combos(t, k-1).map(c => [h, ...c]), ...combos(t, k)];
}

function eval5(cards) {
  const ranks = cards.map(c => c % 13).sort((a, b) => b - a);
  const suits = cards.map(c => Math.floor(c / 13));
  const isFlush = suits.every(s => s === suits[0]);

  let straight = false, strHigh = -1;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) { straight = true; strHigh = ranks[0]; }
    // Wheel: A-2-3-4-5
    if (ranks[0]===12 && ranks[1]===3 && ranks[2]===2 && ranks[3]===1 && ranks[4]===0) {
      straight = true; strHigh = 3;
    }
  }

  const freq = {};
  ranks.forEach(r => { freq[r] = (freq[r]||0)+1; });
  const g = Object.entries(freq)
    .map(([r,c]) => [+r, c])
    .sort((a, b) => b[1]-a[1] || b[0]-a[0]);

  if (isFlush && straight) return [8, strHigh];
  if (g[0][1]===4)                   return [7, g[0][0], g[1][0]];
  if (g[0][1]===3 && g[1][1]===2)   return [6, g[0][0], g[1][0]];
  if (isFlush)                        return [5, ...ranks];
  if (straight)                       return [4, strHigh];
  if (g[0][1]===3)                   return [3, g[0][0], g[1][0], g[2][0]];
  if (g[0][1]===2 && g[1][1]===2) {
    const pairs = [g[0][0], g[1][0]].sort((a,b)=>b-a);
    return [2, ...pairs, g[2][0]];
  }
  if (g[0][1]===2) return [1, g[0][0], g[1][0], g[2][0], g[3][0]];
  return [0, ...ranks];
}

function cmpArr(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i]??-1) - (b[i]??-1);
    if (d !== 0) return d;
  }
  return 0;
}

// 從 2 張手牌 + 最多 5 張公共牌選出最佳 5 張
export function bestHand(holeCards, communityCards) {
  const all = [...holeCards, ...communityCards];
  let bestVal = null, bestCards = null;
  for (const five of combos(all, 5)) {
    const v = eval5(five);
    if (!bestVal || cmpArr(v, bestVal) > 0) { bestVal = v; bestCards = five; }
  }
  return { cards: bestCards, value: bestVal, name: HAND_NAMES[bestVal[0]] };
}

// >0: h1 勝；<0: h2 勝；0: 平手
export function compareHands(h1, h2) { return cmpArr(h1.value, h2.value); }
