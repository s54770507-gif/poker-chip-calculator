// ── 純渲染函式，不含任何遊戲邏輯 ──
import { cardHTML, cardBackHTML, RANKS, SUITS } from './cards.js?v=7';


export function showPhase(phase) {
  document.getElementById('app').className = `phase-${phase}`;
}

export function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// 等待室：玩家列表
export function renderWaiting(room, myIndex) {
  document.getElementById('room-code-display').textContent = room.code || '';
  const list = document.getElementById('waiting-players');
  list.innerHTML = '';
  const players = Object.values(room.players || {});
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = p.name + (i === 0 ? ' 👑' : '');
    if (i === myIndex) li.classList.add('me');
    list.appendChild(li);
  });
  const expected = room.config?.playerCount || 0;
  const joined = players.length;
  document.getElementById('waiting-count').textContent = `${joined} / ${expected} 玩家已加入`;
  const startBtn = document.getElementById('btn-start-game');
  if (startBtn) {
    startBtn.disabled = joined < expected;
    startBtn.style.display = myIndex === 0 ? 'block' : 'none';
  }
}


// 牌桌（橢圓佈局 + 真實籌碼圖示）
export function renderPlayerList(room, hand, myIndex) {
  const seats = document.getElementById('player-seats');
  seats.innerHTML = '';

  const players = Object.values(room.players || {});
  const totalSlots = room.config?.playerCount || players.length;
  const handSeats = hand?.seats || [];
  const n = totalSlots;                       // 以總位數排列座位
  const dealerIdx = hand?.dealerIndex ?? 0;
  const titles = computeTitles(room);

  // 渲染所有座位（包含空位）
  for (let i = 0; i < totalSlots; i++) {
    const p = players[i];
    const isEmpty = !p;

    if (isEmpty) {
      const { x, y } = seatPos(i, n, myIndex);
      const el = document.createElement('div');
      el.className = 'player-seat empty';
      el.dataset.seatIndex = i;
      el.style.left = x + '%';
      el.style.top = y + '%';
      el.innerHTML = `
        <div class="seat-inner">
          <div class="seat-avatar">?</div>
          <div class="seat-name">等待加入</div>
          <div class="seat-amount">─</div>
        </div>`;
      seats.appendChild(el);
      continue;
    }

    // 已離開的玩家：顯示灰化座位
    if (p.isActive === false) {
      const { x, y } = seatPos(i, n, myIndex);
      const el = document.createElement('div');
      el.className = 'player-seat empty left';
      el.dataset.seatIndex = i;
      el.style.left = x + '%';
      el.style.top = y + '%';
      el.innerHTML = `
        <div class="seat-inner" style="opacity:0.3">
          <div class="seat-avatar" style="font-size:11px;background:#333">✕</div>
          <div class="seat-name">${p.name.slice(0, 7)}</div>
          <div class="seat-amount" style="color:var(--text-dim)">已離開</div>
        </div>`;
      seats.appendChild(el);
      continue;
    }

    const hs = handSeats[i] || {};

    // 暫離中的玩家（本局未參與時顯示暫離座位）
    if (p.sitOut === true && hs.status !== 'active' && hs.status !== 'allin') {
      const { x, y } = seatPos(i, n, myIndex);
      const el = document.createElement('div');
      el.className = 'player-seat sitout';
      el.dataset.seatIndex = i;
      el.style.left = x + '%';
      el.style.top = y + '%';
      el.innerHTML = `
        <div class="seat-inner" style="opacity:0.45">
          <div class="seat-avatar">⏸</div>
          <div class="seat-name">${p.name.slice(0, 7)}</div>
          <div class="seat-amount">${p.chips.toLocaleString()}</div>
          <div class="seat-amount" style="color:var(--text-dim);font-size:8px">暫離中</div>
        </div>`;
      seats.appendChild(el);
      continue;
    }

    const isMe = i === myIndex;
    const isDealer = i === dealerIdx;
    const isSB = n > 2 ? i === ((dealerIdx + 1) % n) : i !== dealerIdx;
    const isBB = n > 2 ? i === ((dealerIdx + 2) % n) : false;
    const isAction = i === hand?.actionIndex;
    const status = hs.status || 'active';

    const { x, y } = seatPos(i, n, myIndex);
    const el = document.createElement('div');
    el.className = ['player-seat', isMe ? 'me' : '', isAction ? 'acting' : '', status === 'folded' ? 'folded' : ''].filter(Boolean).join(' ');
    el.dataset.seatIndex = i;
    el.style.left = x + '%';
    el.style.top = y + '%';

    const badges = [
      isDealer ? '<span class="badge badge-d">D</span>' : '',
      isSB ? '<span class="badge badge-sb">SB</span>' : '',
      isBB ? '<span class="badge badge-bb">BB</span>' : '',
      hand?.straddleIndex === i ? '<span class="badge badge-st">ST</span>' : '',
      status === 'allin' ? '<span class="badge badge-allin">全下</span>' : '',
    ].join('') + (titles[i] || []).map(t =>
      `<span class="badge badge-title" title="${t.label}">${t.emoji}</span>`).join('');

    const betHtml = hs.bet > 0
      ? `<div class="seat-bet-chip">+${hs.bet.toLocaleString()}</div>`
      : '';

    // 座位牌：未棄牌且有手牌時顯示牌背（或自己的實際牌）
    const holeCards = hand?.holeCards || {};
    let seatCardsHtml = '';
    if (hand && status !== 'folded' && holeCards[i] !== undefined) {
      if (isMe || hand.revealAll) {   // 全下開牌時亮出所有人手牌
        const [c1, c2] = holeCards[i];
        seatCardsHtml = `<div class="seat-cards">${cardHTML(c1,'xs')}${cardHTML(c2,'xs')}</div>`;
      } else {
        seatCardsHtml = `<div class="seat-cards">${cardBackHTML('xs')}${cardBackHTML('xs')}</div>`;
      }
    }

    // 補碼按鈕：對局進行中（如全下 0 籌碼）不顯示，等結算或未參與時才出現
    const canRebuy = p.chips <= 0 && (!hand || hand.round === 'showdown' || status === 'folded');
    const rebuyHtml = canRebuy
      ? `<button class="seat-rebuy-btn" data-player-index="${i}">補充籌碼</button>` : '';

    // 行動計時條（輪到此玩家時顯示，寬度由計時迴圈更新）
    const timerHtml = (isAction && status === 'active' && hand && hand.round !== 'showdown')
      ? '<div class="seat-timer"><div class="seat-timer-fill" style="width:100%"></div></div>' : '';

    const hasAvatar = !!p.avatar;
    el.innerHTML = hasAvatar
      ? `<div class="seat-inner has-avatar" style="background-image:url('${p.avatar}')">
           <div class="seat-info-bar">
             <div class="seat-name">${p.name.slice(0, 7)}</div>
             <div class="seat-amount">${p.chips.toLocaleString()}</div>
             ${betHtml}
             ${seatCardsHtml}
             ${rebuyHtml}
           </div>
         </div>
         <div class="seat-badges">${badges}</div>
         ${timerHtml}`
      : `<div class="seat-inner">
           <div class="seat-avatar">${p.name[0].toUpperCase()}</div>
           <div class="seat-name">${p.name.slice(0, 7)}</div>
           <div class="seat-amount">${p.chips.toLocaleString()}</div>
           ${betHtml}
           ${seatCardsHtml}
           ${rebuyHtml}
         </div>
         <div class="seat-badges">${badges}</div>
         ${timerHtml}`;
    seats.appendChild(el);
  }
}

// 底池 + 輪次（更新牌桌中央 + header；總底池含桌上未收注，同 N8）
export function renderPot(hand) {
  const liveBets = Object.values(hand?.seats || {}).reduce((s, x) => s + (x?.bet || 0), 0);
  const amount = (hand?.pot || 0) + liveBets;
  const pot = amount.toLocaleString();
  const el = document.getElementById('table-pot-val');
  if (el) el.textContent = pot;
  const el2 = document.getElementById('pot-amount');
  if (el2) el2.textContent = pot;

  const potChipsEl = document.getElementById('pot-chips');
  if (potChipsEl) potChipsEl.innerHTML = buildPotChips(amount);

  const roundNames = { preflop: '翻牌前', flop: '翻牌', turn: '轉牌', river: '河牌' };
  const rName = roundNames[hand?.round] || '';
  const rl = document.getElementById('table-round-label');
  if (rl) rl.textContent = rName;
  const rn = document.getElementById('round-name');
  if (rn) rn.textContent = rName;
  const hn = document.getElementById('hand-number');
  if (hn) hn.textContent = `第 ${hand?.number || 1} 局`;
}

// 公共牌 + 我的手牌
export function renderCards(hand, myIndex) {
  // 公共牌（只讓新翻開的牌播進場動畫）
  const comEl = document.getElementById('community-cards');
  if (comEl) {
    const cards = hand?.communityCards || [];
    let prev = +comEl.dataset.count || 0;
    if (cards.length < prev) prev = 0; // 新的一局重置
    comEl.innerHTML = cards.map((c, i) =>
      `<div class="${i >= prev ? 'card-enter' : ''}">${cardHTML(c, 'sm')}</div>`).join('');
    comEl.dataset.count = cards.length;
  }

  // 我的手牌
  const holeEl = document.getElementById('my-hole-cards');
  const rowEl  = document.getElementById('my-cards-row');
  if (!holeEl || !rowEl) return;

  const myCards = hand?.holeCards?.[myIndex];
  if (myCards && hand?.round !== 'showdown') {
    const [c1, c2] = myCards;
    rowEl.innerHTML = `${cardHTML(c1, 'lg')}${cardHTML(c2, 'lg')}`;
    holeEl.style.display = 'flex';
  } else {
    holeEl.style.display = 'none';
    rowEl.innerHTML = '';
  }
}

// ── 工具：座位位置（直式橢圓，myIndex 永遠在最下方）──
function seatPos(i, n, myIndex = 0) {
  // -π/2 (270°) = 桌面最下方；以 myIndex 為基準旋轉
  const angle = (-Math.PI / 2) - (2 * Math.PI * (i - myIndex) / n);
  return {
    x: 50 + 39 * Math.cos(angle),
    y: 50 - 42 * Math.sin(angle),
  };
}

// ── 工具：籌碼堆疊 ──
const DENOMS = [
  { val: 5000, cls: 'chip-yellow' },
  { val: 1000, cls: 'chip-purple' },
  { val: 500,  cls: 'chip-black'  },
  { val: 100,  cls: 'chip-green'  },
  { val: 25,   cls: 'chip-blue'   },
  { val: 5,    cls: 'chip-red'    },
  { val: 1,    cls: 'chip-white'  },
];

function buildChipStacks(chips) {
  if (chips <= 0) return '<div class="no-chips">bust</div>';
  let rem = chips;
  const stacks = [];
  for (const d of DENOMS) {
    if (rem >= d.val && stacks.length < 4) {
      const cnt = Math.min(Math.floor(rem / d.val), 5);
      if (cnt > 0) { stacks.push({ cls: d.cls, cnt }); rem -= cnt * d.val; }
    }
    if (stacks.length >= 4) break;
  }
  return stacks.map(s =>
    `<div class="chip-col">${Array(s.cnt).fill(`<div class="chip-token ${s.cls}"></div>`).join('')}</div>`
  ).join('');
}

// ── 工具：底池籌碼視覺 ──
function buildPotChips(amount) {
  if (amount <= 0) return '';
  let rem = amount;
  const tokens = [];
  for (const d of DENOMS) {
    const cnt = Math.min(Math.floor(rem / d.val), 4);
    if (cnt > 0) {
      for (let k = 0; k < cnt; k++) {
        tokens.push(`<div class="chip-token ${d.cls} pot-chip-token"></div>`);
      }
      rem -= cnt * d.val;
    }
    if (tokens.length >= 12) break;
  }
  return tokens.join('');
}

// ── 稱號系統（依累積數據即時頒發）──
export function computeTitles(room) {
  const stats = room?.stats || {};
  const players = Object.values(room?.players || {});
  const titles = {};
  let fish = null, rich = null, rock = null, god = null;

  players.forEach((p, i) => {
    const st = stats[i];
    if (!st || p?.isActive === false) return;
    if (st.handsPlayed >= 3) {
      const net = (st.chipsOut || 0) - (st.chipsIn || 0);
      if (net < 0 && (!fish || net < fish.v)) fish = { i, v: net };
      if (net > 0 && (!rich || net > rich.v)) rich = { i, v: net };
      const fr = (st.folds || 0) / st.handsPlayed;
      if (fr >= 0.6 && (!rock || fr > rock.v)) rock = { i, v: fr };
    }
    if ((st.allinWins || 0) >= 2 && (!god || st.allinWins > god.v)) god = { i, v: st.allinWins };
  });

  const add = (t, emoji, label) => { if (t) (titles[t.i] ||= []).push({ emoji, label }); };
  add(fish, '🐟', '本日魚王');
  add(rich, '💰', '大贏家');
  add(rock, '🗿', '石頭人');
  add(god,  '🎰', '賭神');
  return titles;
}

// ── 系統補刀播報（依牌局結果與數據生成嘲諷字幕）──
function buildRoasts(room, hand) {
  const lines = [];
  const players = Object.values(room?.players || {});
  const stats = room?.stats || {};
  const seats = hand?.seats || {};
  const awards = hand?.awards || {};
  const bb = room?.config?.bigBlind || 50;

  const winners = new Set();
  Object.values(awards).forEach(w => (Array.isArray(w) ? w : [w]).forEach(x => winners.add(x)));
  const winnerNames = [...winners].map(i => players[i]?.name || `玩家${i + 1}`).join('、');

  const notFolded = Object.values(seats).filter(s => s.status !== 'folded');
  if (notFolded.length === 1 && Object.keys(seats).length > 1) {
    lines.push(`😤 全場被 ${winnerNames} 嚇到集體棄牌`);
  }

  if ((hand?.pot || 0) >= bb * 40) {
    lines.push(`💰 史詩級底池 ${hand.pot.toLocaleString()}，有人今晚要睡沙發了`);
  }

  players.forEach((p, i) => {
    if (p?.isActive === false) return;
    const st = stats[i] || {};
    if ((st.loseStreak || 0) >= 3) {
      lines.push(`💸 ${p.name} 已連輸 ${st.loseStreak} 局，正在為全桌發工資`);
    }
    if ((st.winStreak || 0) >= 3 && winners.has(i)) {
      lines.push(`🔥 ${p.name} 三連勝起跳，記得請雞排`);
    }
  });

  // 全下獲勝
  [...winners].forEach(i => {
    if (seats[i]?.status === 'allin') {
      lines.push(`🎰 ${players[i]?.name || ''} 梭哈成功，賭神附體`);
    }
  });

  return lines.slice(0, 3);
}

// ── 贏家 Overlay ──
export function showWinnerOverlay(room, hand) {
  const overlay = document.getElementById('winner-overlay');
  if (!overlay) return;

  const players  = Object.values(room.players || {});
  const seats    = hand.seats || {};
  const awards   = hand.awards || {};
  const evals    = hand.evaluations || {};
  const holeCards = hand.holeCards || {};
  const communityCards = hand.communityCards || [];

  // 收集所有贏家
  const allWinners = new Set();
  Object.values(awards).forEach(w => {
    if (Array.isArray(w)) w.forEach(i => allWinners.add(i));
    else if (w !== undefined) allWinners.add(w);
  });

  const winnerNames = [...allWinners].map(i => players[i]?.name || `玩家${i+1}`).join('、');
  const mainWinnerIdx = Array.isArray(awards[0]) ? awards[0][0] : awards[0];
  const mainHandName = evals[mainWinnerIdx]?.name || '';

  const header = document.getElementById('winner-overlay-header');
  if (header) {
    header.innerHTML = `🏆 ${winnerNames} 贏了！` +
      (mainHandName ? `<br><small style="font-size:13px;color:#ccc">${mainHandName}</small>` : '');
  }

  // 系統補刀播報
  const roastsEl = document.getElementById('wo-roasts');
  if (roastsEl) {
    roastsEl.innerHTML = buildRoasts(room, hand).map(l => `<div class="roast-line">${l}</div>`).join('');
  }

  // 玩家手牌揭示
  const handsEl = document.getElementById('winner-overlay-hands');
  if (handsEl) {
    const notFolded = Object.entries(seats).filter(([, s]) => s.status !== 'folded');
    const showCards = notFolded.length >= 2 && communityCards.length >= 5;
    handsEl.innerHTML = notFolded.map(([i]) => {
      const idx  = +i;
      const name = players[idx]?.name || `玩家${idx+1}`;
      const hole = holeCards[idx];
      const ev   = evals[idx];
      const isW  = allWinners.has(idx);
      const cardsHtml = (showCards && hole)
        ? `<div style="display:flex;gap:3px">${hole.map(c => cardHTML(c,'sm')).join('')}</div>` : '';
      return `<div class="wo-hand-row${isW ? ' winner' : ''}">
        <span class="wo-name">${name}</span>
        ${cardsHtml}
        ${ev ? `<span class="hand-type-badge">${ev.name}</span>` : ''}
        ${isW ? '<span style="font-size:15px">👑</span>' : ''}
      </div>`;
    }).join('');
  }

  // 籌碼彙總（僅顯示仍在房間的玩家，含稱號與戰績）
  const chipsEl = document.getElementById('winner-overlay-chips');
  if (chipsEl) {
    const activePlayers = players.map((p, i) => ({ p, i })).filter(({ p }) => p?.isActive !== false);
    const titles = computeTitles(room);
    const stats = room.stats || {};
    chipsEl.innerHTML = `<div class="wo-chips-section">
      <div class="wo-chips-title">目前籌碼</div>
      ${activePlayers.map(({ p, i }) => {
        const st = stats[i] || {};
        const titleHtml = (titles[i] || []).map(t => `<span class="title-chip">${t.emoji} ${t.label}</span>`).join('');
        const recHtml = st.handsPlayed ? `<span class="wo-stat">勝 ${st.handsWon || 0}/${st.handsPlayed}</span>` : '';
        return `
        <div class="wo-chip-row">
          <span>${p.name} ${titleHtml}${recHtml}</span>
          <span class="wo-chip-val">
            ${p.chips > 0 ? p.chips.toLocaleString() : '<span style="color:#888">爆牌</span>'}
            ${p.chips <= 0
              ? `<button class="btn-rebuy" data-player-index="${i}"
                   style="margin-left:8px;font-size:11px;padding:2px 8px;background:var(--gold);border:none;border-radius:5px;color:#000;cursor:pointer;font-weight:700">補充</button>`
              : ''}
          </span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // 兔子洞區塊（提前結束的牌局可偷看後續公共牌）
  updateRabbitSection(hand);

  overlay.classList.remove('hidden');
}

// ── 兔子洞：偷看沒發完的公共牌 ──
export function updateRabbitSection(hand) {
  const el = document.getElementById('wo-rabbit');
  if (!el) return;
  const revealed = hand?.communityCards || [];
  const all = hand?.allCommunity || [];
  if (revealed.length >= 5 || all.length < 5) { el.innerHTML = ''; return; }
  if (hand.rabbitRevealed) {
    const rest = all.slice(revealed.length);
    el.innerHTML = `<div class="wo-rabbit-cards">
      <span class="rabbit-label">🐰 沒發完的牌</span>
      ${rest.map(c => cardHTML(c, 'sm')).join('')}
    </div>`;
  } else {
    el.innerHTML = `<button id="btn-rabbit" class="btn-rabbit">🐰 兔子洞：偷看沒發完的牌</button>`;
  }
}

// ── 亮牌嘲諷（棄牌獲勝者可秀底牌）──
export function updateShowBluffSection(hand, myIndex, players) {
  const el = document.getElementById('wo-showbluff');
  if (!el) return;
  const seats = hand?.seats || {};
  const notFolded = Object.entries(seats).filter(([, s]) => s.status !== 'folded');
  if (notFolded.length !== 1) { el.innerHTML = ''; return; }  // 只有棄牌獲勝才能秀牌
  const winnerIdx = +notFolded[0][0];

  if (hand.showBluff) {
    const name = players[hand.showBluff.from]?.name || `玩家${hand.showBluff.from + 1}`;
    el.innerHTML = `<div class="wo-rabbit-cards">
      <span class="rabbit-label">😏 ${name} 秀牌</span>
      ${(hand.showBluff.cards || []).map(c => cardHTML(c, 'sm')).join('')}
    </div>`;
  } else if (winnerIdx === myIndex && hand.holeCards?.[myIndex]) {
    el.innerHTML = `<div class="wo-showbluff-btns">
      <button class="btn-rabbit btn-showbluff" data-which="0">😏 秀左牌</button>
      <button class="btn-rabbit btn-showbluff" data-which="1">秀右牌</button>
      <button class="btn-rabbit btn-showbluff" data-which="both">全秀</button>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}

// ── 座位定位工具（互動動畫用）──
function seatCenter(idx) {
  const el = document.querySelector(`.player-seat[data-seat-index="${idx}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── 聊天氣泡（浮在發話者座位旁）──
export function showChatBubble(msg) {
  const pos = seatCenter(msg.from);
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = msg.text;
  if (pos) {
    bubble.style.left = pos.x + 'px';
    bubble.style.top = (pos.y - 34) + 'px';
  } else {
    bubble.style.left = '50%';
    bubble.style.top = '18%';
  }
  document.body.appendChild(bubble);
  setTimeout(() => bubble.classList.add('out'), 3200);
  setTimeout(() => bubble.remove(), 3600);
}

// ── 播放互動動畫（丟擲 / 表情）──
export function playReaction(r) {
  if (r.type === 'throw') {
    const from = seatCenter(r.from);
    const to   = seatCenter(r.to);
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'throw-fly';
    el.textContent = r.item;
    el.style.cssText = [
      `left:${from.x}px`, `top:${from.y}px`,
      `--tx:${(to.x - from.x).toFixed(1)}px`,
      `--ty:${(to.y - from.y).toFixed(1)}px`,
    ].join(';');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => {
      el.remove();
      // 命中效果：爆裂 + 目標座位抖動
      const splat = document.createElement('div');
      splat.className = 'throw-splat';
      splat.textContent = r.item === '🥚' ? '🍳' : r.item + '💥';
      splat.style.left = to.x + 'px';
      splat.style.top = to.y + 'px';
      document.body.appendChild(splat);
      splat.addEventListener('animationend', () => splat.remove(), { once: true });
      const seatEl = document.querySelector(`.player-seat[data-seat-index="${r.to}"]`);
      if (seatEl) {
        seatEl.classList.add('hit-shake');
        setTimeout(() => seatEl.classList.remove('hit-shake'), 500);
      }
    }, { once: true });

  } else if (r.type === 'emoji') {
    const pos = seatCenter(r.from) || { x: innerWidth / 2, y: innerHeight / 2 };
    const el = document.createElement('div');
    el.className = 'emoji-float';
    el.textContent = r.item;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

// ── 聊天紀錄面板 ──
export function renderChatLog(room, myIndex) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const players = Object.values(room?.players || {});
  const msgs = Object.values(room?.chat || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-40);
  log.innerHTML = msgs.map(m => {
    const name = players[m.from]?.name || m.name || '?';
    const mine = m.from === myIndex;
    return `<div class="chat-line${mine ? ' mine' : ''}"><b>${escapeHtml(name)}</b>：${escapeHtml(m.text || '')}</div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 行動計時 UI（由 app.js 計時迴圈每 250ms 呼叫）──
export function updateTimerUI(t) {
  const label = document.getElementById('timer-countdown');
  const fill  = document.querySelector('.player-seat.acting .seat-timer-fill');
  if (!t) {
    if (label && label.textContent) { label.textContent = ''; label.className = 'timer-label'; }
    return;
  }
  const inBank = t.baseLeft <= 0;
  const left = Math.max(0, Math.ceil(inBank ? t.bankLeft : t.baseLeft));
  if (label) {
    label.textContent = inBank ? `🏦 時間銀行 ${left}s` : `⏱ ${left}s`;
    label.className = 'timer-label' + (inBank ? ' bank' : (left <= 5 ? ' urgent' : ''));
  }
  if (fill) {
    const pct = inBank ? t.bankLeft / Math.max(t.bank, 1) : t.baseLeft / t.baseTotal;
    fill.style.width = (Math.max(0, Math.min(1, pct)) * 100) + '%';
    fill.classList.toggle('bank', inBank);
    fill.classList.toggle('urgent', !inBank && t.baseLeft <= 5);
  }
}

// ── 發牌動畫（從桌面中央飛往各座位）──
export function animateDealCards(hand, myIndex, totalSlots) {
  const holeCards = hand?.holeCards || {};
  const activeIndices = Object.keys(holeCards).map(Number);
  if (!activeIndices.length) return;

  const wrapper = document.getElementById('table-wrapper');
  if (!wrapper) return;
  const wRect = wrapper.getBoundingClientRect();
  const cx = wRect.left + wRect.width  / 2;
  const cy = wRect.top  + wRect.height / 2;

  // 隱藏座位手牌，動畫結束後再顯示
  document.querySelectorAll('.seat-cards').forEach(el => { el.style.opacity = '0'; });

  // 發牌順序：從莊家右邊（逆時針）開始，每人先發第一張再發第二張
  const dealerIdx = hand.dealerIndex ?? 0;
  const n = totalSlots;
  const sorted = activeIndices.slice().sort((a, b) => {
    const da = (a - dealerIdx - 1 + n) % n;
    const db = (b - dealerIdx - 1 + n) % n;
    return da - db;
  });
  const dealOrder = [...sorted, ...sorted]; // 兩輪

  dealOrder.forEach((seatIdx, i) => {
    setTimeout(() => {
      const seatEl = document.querySelector(`.player-seat[data-seat-index="${seatIdx}"]`);
      if (!seatEl) return;
      const sRect = seatEl.getBoundingClientRect();
      const sx = sRect.left + sRect.width  / 2;
      const sy = sRect.top  + sRect.height / 2;

      const card = document.createElement('div');
      card.className = 'deal-card-anim card card-sm card-back';
      card.style.cssText = [
        'position:fixed',
        `left:${cx}px`, `top:${cy}px`,
        'transform:translate(-50%,-50%)',
        'z-index:9000',
        `--tx:${(sx - cx).toFixed(1)}px`,
        `--ty:${(sy - cy).toFixed(1)}px`,
        'animation:dealFly 0.38s ease-out forwards'
      ].join(';');
      document.body.appendChild(card);
      card.addEventListener('animationend', () => card.remove(), { once: true });
    }, i * 140);
  });

  // 動畫全部結束後顯示真實手牌
  const totalMs = dealOrder.length * 140 + 420;
  setTimeout(() => {
    document.querySelectorAll('.seat-cards').forEach(el => { el.style.opacity = ''; });
  }, totalMs);
}

// 行動面板（N8 風格下注尺寸）
export function renderActionPanel(room, hand, myIndex) {
  const players = Object.values(room.players || {});
  const seats = hand?.seats || [];
  const mySeat = seats[myIndex] || {};
  const isMyTurn = hand?.actionIndex === myIndex && mySeat.status === 'active';

  const panel = document.getElementById('action-buttons');
  const raisePanel = document.getElementById('raise-panel');

  // 全下開牌中：隱藏所有行動 UI
  if (hand?.runout) {
    document.getElementById('actor-name').textContent = '開牌中...';
    document.getElementById('actor-label').className = 'actor-label';
    panel.style.display = 'none';
    raisePanel.classList.add('hidden');
    document.getElementById('waiting-msg').style.display = 'none';
    return;
  }

  const actorName = players[hand?.actionIndex]?.name || '';
  document.getElementById('actor-name').textContent = isMyTurn ? '你的回合' : `等待 ${actorName}...`;
  document.getElementById('actor-label').className = isMyTurn ? 'actor-label my-turn' : 'actor-label';

  panel.style.display = isMyTurn ? 'grid' : 'none';
  const wm = document.getElementById('waiting-msg');
  wm.style.display = isMyTurn ? 'none' : 'block';
  wm.textContent = '等待中...';

  // 沒輪到我：收合加注面板，避免殘留上一輪的尺寸
  if (!isMyTurn) { raisePanel.classList.add('hidden'); return; }

  const currentBet = hand?.currentBet || 0;
  const callAmount = currentBet - (mySeat.bet || 0);
  const myChips = players[myIndex]?.chips || 0;
  const bb = hand?.bigBlind || room.config?.bigBlind || 0;
  const canCheck = callAmount === 0;
  const canCall = callAmount > 0 && myChips > 0;

  // 底池 = 已收進的底池 + 桌上本輪所有下注
  const totalPot = (hand?.pot || 0) +
    Object.values(seats).reduce((s, x) => s + (x?.bet || 0), 0);

  const btnCheck = document.getElementById('btn-check');
  const btnCall = document.getElementById('btn-call');
  btnCheck.style.display = canCheck ? 'block' : 'none';
  btnCall.style.display = canCall ? 'block' : 'none';
  if (canCall) {
    const actualCall = Math.min(callAmount, myChips);
    const isAllinCall = actualCall >= myChips;
    const oddsRatio = actualCall > 0 ? ((totalPot + actualCall) / actualCall).toFixed(1) : '–';
    const oddsLabel = `<span class="pot-odds">賠率 ${oddsRatio}:1</span>`;
    if (isAllinCall) {
      btnCall.className = 'action-btn allin-call';
      btnCall.innerHTML = `跟注全下<br><span style="font-size:13px">(${actualCall.toLocaleString()})</span>`;
    } else {
      btnCall.className = 'action-btn';
      btnCall.innerHTML = `跟注 ${actualCall.toLocaleString()}${oddsLabel}`;
    }
  }

  // 加注：跟注後還有籌碼才可加注
  const myTotal = myChips + (mySeat.bet || 0);
  const canRaise = myChips > callAmount && myTotal > currentBet;
  const btnRaise = document.getElementById('btn-raise-toggle');
  btnRaise.style.display = canRaise ? 'block' : 'none';
  if (!canRaise) { raisePanel.classList.add('hidden'); return; }

  // 加注尺寸（都是「加注到」的總額，N8 式階梯）
  const minRaiseTo = currentBet > 0 ? currentBet + (hand?.lastRaiseSize || bb) : bb;
  const potRaiseTo = currentBet + callAmount + totalPot; // 底池加注 = 跟注後再加一個底池

  let ladder;
  if (currentBet === 0) {
    // 翻牌後無人下注
    ladder = [
      { label: '1/3 底池', amt: Math.round(totalPot / 3) },
      { label: '1/2 底池', amt: Math.round(totalPot / 2) },
      { label: '2/3 底池', amt: Math.round(totalPot * 2 / 3) },
      { label: '底池',     amt: totalPot },
      { label: '全下',     amt: myTotal, allin: true },
    ];
  } else if (currentBet <= bb) {
    // 翻牌前無人加注
    ladder = [
      { label: '2 大盲',   amt: bb * 2 },
      { label: '3 大盲',   amt: bb * 3 },
      { label: '4 大盲',   amt: bb * 4 },
      { label: '底池',     amt: potRaiseTo },
      { label: '全下',     amt: myTotal, allin: true },
    ];
  } else {
    // 面對加注
    ladder = [
      { label: '最小加注', amt: minRaiseTo },
      { label: '2.5 倍',   amt: Math.round(currentBet * 2.5) },
      { label: '3 倍',     amt: currentBet * 3 },
      { label: '底池',     amt: potRaiseTo },
      { label: '全下',     amt: myTotal, allin: true },
    ];
  }

  // 夾限 + 去重（不同公式算出同額時只留一列）
  const seen = new Set();
  const rows = [];
  ladder.forEach(p => {
    const amt = Math.min(Math.max(p.amt, Math.min(minRaiseTo, myTotal)), myTotal);
    if (seen.has(amt)) return;
    seen.add(amt);
    const hitAllin = amt >= myTotal;
    rows.push(`<button class="raise-preset" data-amount="${amt}">
      <span class="rp-label">${hitAllin ? '全下' : p.label}</span>
      <span class="rp-amt">${amt.toLocaleString()}</span>
    </button>`);
  });
  document.getElementById('raise-presets').innerHTML = rows.join('');
}

// 攤牌畫面（自動結算結果）
export function renderShowdown(room, hand) {
  const players = Object.values(room.players || {});
  const seats   = hand?.seats || {};
  const awards  = hand?.awards || {};
  const evals   = hand?.evaluations || {};
  const holeCards = hand?.holeCards || {};
  const communityCards = hand?.communityCards || [];

  // ── 公共牌 ──
  const comContainer = document.getElementById('showdown-community');
  if (comContainer) {
    comContainer.innerHTML = communityCards.length
      ? `<div class="showdown-community-cards">${communityCards.map(c => cardHTML(c,'sm')).join('')}</div>`
      : '';
  }

  // ── 底池結果 ──
  const potsArr = calcSidePots(seats, players);
  const potsEl  = document.getElementById('showdown-pots');
  potsEl.innerHTML = '';

  potsArr.forEach((pot, pi) => {
    const winnerRaw = awards[pi];
    const winners   = winnerRaw === undefined ? [] :
                      Array.isArray(winnerRaw) ? winnerRaw : [winnerRaw];
    const label     = pi === 0 ? '主底池' : `邊池 ${pi}`;

    const winText = winners.map(idx => {
      const name     = players[idx]?.name || `玩家${idx+1}`;
      const handName = evals[idx]?.name || '';
      return `<span class="winner-tag">${name}${handName ? ` (${handName})` : ''}</span>`;
    }).join(' · ');

    const sec = document.createElement('div');
    sec.className = 'pot-section awarded';
    sec.innerHTML = `
      <div class="pot-title">${label}：<span class="pot-amt">${pot.amount.toLocaleString()}</span></div>
      <div class="pot-winner-row">🏆 ${winText || '─'}</div>`;
    potsEl.appendChild(sec);
  });

  // ── 玩家手牌揭示 ──
  const handsEl = document.getElementById('showdown-hands');
  if (handsEl) {
    const notFolded = Object.entries(seats).filter(([, s]) => s.status !== 'folded');
    const showCards = notFolded.length >= 2 && communityCards.length >= 5;

    handsEl.innerHTML = notFolded.map(([i]) => {
      const idx  = +i;
      const name = players[idx]?.name || `玩家${idx+1}`;
      const hole = holeCards[idx];
      const ev   = evals[idx];
      const isWinner = Object.values(awards).some(w =>
        Array.isArray(w) ? w.includes(idx) : w === idx
      );
      const cardsHtml = (showCards && hole)
        ? `<div class="reveal-cards">${hole.map(c=>cardHTML(c,'sm')).join('')}</div>`
        : '';
      return `<div class="showdown-player-row${isWinner ? ' winner' : ''}">
        <span class="sp-name">${name}</span>
        ${cardsHtml}
        ${ev ? `<span class="hand-type-badge">${ev.name}</span>` : ''}
        ${isWinner ? '<span class="winner-crown">👑</span>' : ''}
      </div>`;
    }).join('');
  }

  // ── 目前籌碼 ──
  const chipList = document.getElementById('showdown-chips');
  chipList.innerHTML = players.map((p, i) =>
    `<div class="chip-row">
      <span>${p.name}</span>
      <span>${p.chips > 0 ? p.chips.toLocaleString() : '<span style="color:#888">爆牌</span>'}</span>
      ${p.chips <= 0 ? `<button class="btn-rebuy" data-player-index="${i}">補充籌碼</button>` : ''}
    </div>`
  ).join('');
}

// ── 邊池計算（showdown 用，接受 seats object 或 array）──
function calcSidePots(seats, players) {
  const arr = Array.isArray(seats) ? seats : Object.values(seats);
  const contributions = arr.map((s, i) => ({
    idx: i, total: s.totalBetInHand || 0, status: s.status || 'folded'
  })).filter(s => s.total > 0);

  if (!contributions.some(s => s.status === 'allin')) {
    return [{ amount: contributions.reduce((sum,s)=>sum+s.total,0),
              eligible: contributions.filter(s=>s.status!=='folded').map(s=>s.idx) }];
  }

  const thresholds = [...new Set(
    contributions.filter(s=>s.status==='allin').map(s=>s.total)
  )].sort((a,b)=>a-b);

  const pots = []; let prev = 0;
  thresholds.forEach(t => {
    const amt = contributions.reduce((sum,s)=>sum+Math.min(s.total,t)-Math.min(s.total,prev),0);
    if (amt > 0) pots.push({ amount:amt, eligible: contributions.filter(s=>s.total>=t&&s.status!=='folded').map(s=>s.idx) });
    prev = t;
  });
  const maxA   = thresholds[thresholds.length-1]||0;
  const mainAmt = contributions.reduce((sum,s)=>sum+Math.max(0,s.total-maxA),0);
  if (mainAmt>0) {
    const el = contributions.filter(s=>s.status==='active').map(s=>s.idx);
    if (el.length) pots.push({ amount:mainAmt, eligible:el });
  }
  return pots.length ? pots : [{ amount:contributions.reduce((s,c)=>s+c.total,0),
                                  eligible:contributions.filter(s=>s.status!=='folded').map(s=>s.idx) }];
}

// 歷史紀錄 + 賽後戰報
export function renderHistory(room) {
  const history = Object.values(room.history || {});
  const players = Object.values(room.players || {});
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = history.slice().reverse().map(h => {
    const winner = players[h.winnerIndex]?.name || `玩家${h.winnerIndex+1}`;
    return `<tr><td>第${h.handNumber}局</td><td>${winner}</td><td>${h.potSize.toLocaleString()}</td></tr>`;
  }).join('');

  // 戰報：頒獎 + 各玩家淨勝負
  const panel = document.getElementById('report-panel');
  if (!panel) return;
  const stats = room.stats || {};
  if (!Object.keys(stats).length) { panel.innerHTML = ''; return; }

  const titles = computeTitles(room);
  const biggest = history.reduce((m, h) => Math.max(m, h.potSize || 0), 0);
  const biggestHand = history.find(h => h.potSize === biggest);

  const rows = players
    .map((p, i) => ({ p, i, st: stats[i] }))
    .filter(({ p, st }) => st && p?.isActive !== false)
    .map(({ p, i, st }) => {
      const net = (st.chipsOut || 0) - (st.chipsIn || 0);
      const netCls = net > 0 ? 'net-pos' : net < 0 ? 'net-neg' : '';
      const titleHtml = (titles[i] || []).map(t => `<span class="title-chip">${t.emoji} ${t.label}</span>`).join('');
      return `<div class="report-row">
        <span class="report-name">${p.name}${titleHtml}</span>
        <span class="report-detail">勝 ${st.handsWon || 0}/${st.handsPlayed || 0} · 全下 ${st.allins || 0}</span>
        <span class="report-net ${netCls}">${net > 0 ? '+' : ''}${net.toLocaleString()}</span>
      </div>`;
    }).join('');

  panel.innerHTML = `<div class="report-box">
    <div class="report-title">📊 本日戰報</div>
    ${biggest > 0 ? `<div class="report-highlight">💥 最大底池：第 ${biggestHand?.handNumber} 局 · ${biggest.toLocaleString()}</div>` : ''}
    ${rows}
  </div>`;
}

// ── 煙火慶祝動畫 ──
export function showFireworks() {
  const colors = ['#ff4444','#ff8800','#ffdd00','#44ff88','#44aaff','#ff44ff','#ffffff','#ff0066'];
  const bursts = 7;
  for (let b = 0; b < bursts; b++) {
    setTimeout(() => {
      const cx = 15 + Math.random() * 70;
      const cy = 10 + Math.random() * 45;
      for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'firework-particle';
        const angle = (i / 20) * 2 * Math.PI + Math.random() * 0.25;
        const speed = 55 + Math.random() * 110;
        p.style.cssText =
          `left:${cx}vw;top:${cy}vh;` +
          `background:${colors[Math.floor(Math.random() * colors.length)]};` +
          `--dx:${(Math.cos(angle) * speed).toFixed(1)}px;` +
          `--dy:${(Math.sin(angle) * speed).toFixed(1)}px;` +
          `--dur:${(0.7 + Math.random() * 0.6).toFixed(2)}s`;
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
      }
    }, b * 220 + Math.random() * 80);
  }
}

// ── 輸家頭像顯示「傻逼」──
export function showLoserText(loserIndices) {
  loserIndices.forEach(idx => {
    const seat = document.querySelector(`.player-seat[data-seat-index="${idx}"]`);
    if (!seat) return;
    const inner = seat.querySelector('.seat-inner');
    if (!inner) return;
    const overlay = document.createElement('div');
    overlay.className = 'loser-overlay';
    overlay.textContent = '分手💔';
    inner.appendChild(overlay);
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  });
}
