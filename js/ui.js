// ── 純渲染函式，不含任何遊戲邏輯 ──

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

  // 渲染所有座位（包含空位）
  for (let i = 0; i < totalSlots; i++) {
    const p = players[i];
    const isEmpty = !p;

    if (isEmpty) {
      const { x, y } = seatPos(i, n);
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

    const hs = handSeats[i] || {};
    const isMe = i === myIndex;
    const isDealer = i === dealerIdx;
    const isSB = n > 2 ? i === ((dealerIdx + 1) % n) : i !== dealerIdx;
    const isBB = n > 2 ? i === ((dealerIdx + 2) % n) : false;
    const isAction = i === hand?.actionIndex;
    const status = hs.status || 'active';

    const { x, y } = seatPos(i, n);
    const el = document.createElement('div');
    el.className = ['player-seat', isMe ? 'me' : '', isAction ? 'acting' : '', status === 'folded' ? 'folded' : ''].filter(Boolean).join(' ');
    el.dataset.seatIndex = i;
    el.style.left = x + '%';
    el.style.top = y + '%';

    const badges = [
      isDealer ? '<span class="badge badge-d">D</span>' : '',
      isSB ? '<span class="badge badge-sb">SB</span>' : '',
      isBB ? '<span class="badge badge-bb">BB</span>' : '',
      status === 'allin' ? '<span class="badge badge-allin">全下</span>' : '',
    ].join('');

    const betHtml = hs.bet > 0
      ? `<div class="seat-bet-chip">+${hs.bet.toLocaleString()}</div>`
      : '';

    const hasAvatar = !!p.avatar;
    el.innerHTML = hasAvatar
      ? `<div class="seat-inner has-avatar" style="background-image:url('${p.avatar}')">
           <div class="seat-info-bar">
             <div class="seat-name">${p.name.slice(0, 7)}</div>
             <div class="seat-amount">${p.chips.toLocaleString()}</div>
             ${betHtml}
           </div>
         </div>
         <div class="seat-badges">${badges}</div>`
      : `<div class="seat-inner">
           <div class="seat-avatar">${p.name[0].toUpperCase()}</div>
           <div class="seat-name">${p.name.slice(0, 7)}</div>
           <div class="chip-stacks">${buildChipStacks(p.chips)}</div>
           <div class="seat-amount">${p.chips.toLocaleString()}</div>
           ${betHtml}
         </div>
         <div class="seat-badges">${badges}</div>`;
    seats.appendChild(el);
  }
}

// 底池 + 輪次（更新牌桌中央 + header）
export function renderPot(hand) {
  const pot = (hand?.pot || 0).toLocaleString();
  const el = document.getElementById('table-pot-val');
  if (el) el.textContent = pot;
  const el2 = document.getElementById('pot-amount');
  if (el2) el2.textContent = pot;

  const roundNames = { preflop: '翻牌前', flop: '翻牌', turn: '轉牌', river: '河牌' };
  const rName = roundNames[hand?.round] || '';
  const rl = document.getElementById('table-round-label');
  if (rl) rl.textContent = rName;
  const rn = document.getElementById('round-name');
  if (rn) rn.textContent = rName;
  const hn = document.getElementById('hand-number');
  if (hn) hn.textContent = `第 ${hand?.number || 1} 局`;
}

// ── 工具：座位位置（直式橢圓）──
function seatPos(i, n) {
  const angle = (Math.PI / 2) + (2 * Math.PI * i / n);
  return {
    x: 50 + 39 * Math.cos(angle),  // 水平半徑
    y: 50 - 42 * Math.sin(angle),  // 垂直半徑較大（直式）
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

// 行動面板
export function renderActionPanel(room, hand, myIndex) {
  const players = Object.values(room.players || {});
  const seats = hand?.seats || [];
  const mySeat = seats[myIndex] || {};
  const isMyTurn = hand?.actionIndex === myIndex && mySeat.status === 'active';

  const actorName = players[hand?.actionIndex]?.name || '';
  document.getElementById('actor-name').textContent = isMyTurn ? '你的回合' : `等待 ${actorName}...`;
  document.getElementById('actor-label').className = isMyTurn ? 'actor-label my-turn' : 'actor-label';

  const panel = document.getElementById('action-buttons');
  panel.style.display = isMyTurn ? 'grid' : 'none';
  document.getElementById('waiting-msg').style.display = isMyTurn ? 'none' : 'block';

  if (!isMyTurn) return;

  const callAmount = (hand?.currentBet || 0) - (mySeat.bet || 0);
  const myChips = players[myIndex]?.chips || 0;
  const canCheck = callAmount === 0;
  const canCall = callAmount > 0 && myChips > 0;

  const btnCheck = document.getElementById('btn-check');
  const btnCall = document.getElementById('btn-call');
  btnCheck.style.display = canCheck ? 'block' : 'none';
  btnCall.style.display = canCall ? 'block' : 'none';
  if (canCall) {
    const actualCall = Math.min(callAmount, myChips);
    btnCall.textContent = actualCall >= myChips ? `跟注全下 (${actualCall.toLocaleString()})` : `跟注 (${actualCall.toLocaleString()})`;
  }

  // 加注尺寸預設按鈕
  const pot = hand?.pot || 0;
  const effectivePot = pot + callAmount;
  const p33 = Math.max(Math.round(effectivePot * 0.33), hand?.bigBlind || 0);
  const p50 = Math.max(Math.round(effectivePot * 0.50), hand?.bigBlind || 0);
  const p100 = effectivePot;
  const allin = myChips;

  const minRaise = (hand?.currentBet || 0) + (hand?.lastRaiseSize || hand?.bigBlind || 0);

  document.getElementById('raise-p33').dataset.amount  = Math.min(Math.max(p33 + (hand?.currentBet||0), minRaise), allin);
  document.getElementById('raise-p50').dataset.amount  = Math.min(Math.max(p50 + (hand?.currentBet||0), minRaise), allin);
  document.getElementById('raise-p100').dataset.amount = Math.min(Math.max(p100 + (hand?.currentBet||0), minRaise), allin);
  document.getElementById('raise-allin').dataset.amount = myChips + (mySeat.bet||0);

  // 顯示計算後的金額
  const toChipStr = amt => {
    const net = amt - (mySeat.bet||0);
    return net >= myChips ? `全下` : amt.toLocaleString();
  };
  document.getElementById('raise-p33').innerHTML  = `<span>1/3 底池</span><small>${toChipStr(+document.getElementById('raise-p33').dataset.amount)}</small>`;
  document.getElementById('raise-p50').innerHTML  = `<span>1/2 底池</span><small>${toChipStr(+document.getElementById('raise-p50').dataset.amount)}</small>`;
  document.getElementById('raise-p100').innerHTML = `<span>底池</span><small>${toChipStr(+document.getElementById('raise-p100').dataset.amount)}</small>`;
  document.getElementById('raise-allin').innerHTML= `<span>全下</span><small>${allin.toLocaleString()}</small>`;
}

// 攤牌畫面
export function renderShowdown(room, hand) {
  const players = Object.values(room.players || {});
  const seats = hand?.seats || [];

  const pots = calcSidePots(seats, players);
  const container = document.getElementById('showdown-pots');
  container.innerHTML = '';

  const awards = hand?.awards || {};
  pots.forEach((pot, pi) => {
    const section = document.createElement('div');
    const isAwarded = awards[pi] !== undefined;
    section.className = 'pot-section' + (isAwarded ? ' awarded' : '');
    const potLabel = pi === 0 ? '主底池' : `邊池 ${pi}`;
    const winnerLabel = isAwarded ? ` → ${players[awards[pi]]?.name || ''}` : '';
    section.innerHTML = `<div class="pot-title">${potLabel}: ${pot.amount.toLocaleString()}${winnerLabel}</div>`;
    const btnRow = document.createElement('div');
    btnRow.className = 'winner-btns';
    pot.eligible.forEach(idx => {
      const btn = document.createElement('button');
      btn.className = 'btn-winner';
      btn.textContent = players[idx]?.name || `玩家${idx+1}`;
      btn.dataset.potIndex = pi;
      btn.dataset.winnerIndex = idx;
      btnRow.appendChild(btn);
    });
    section.appendChild(btnRow);
    container.appendChild(section);
  });

  // 目前籌碼
  const chipList = document.getElementById('showdown-chips');
  chipList.innerHTML = players.map((p, i) =>
    `<div class="chip-row">
      <span>${p.name}</span>
      <span>${p.chips > 0 ? p.chips.toLocaleString() : '<span style="color:#888">爆牌</span>'}</span>
      ${p.chips <= 0 ? `<button class="btn-rebuy" data-player-index="${i}">補充籌碼</button>` : ''}
    </div>`
  ).join('');
}

// 歷史紀錄
export function renderHistory(room) {
  const history = Object.values(room.history || {});
  const players = Object.values(room.players || {});
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = history.slice().reverse().map(h => {
    const winner = players[h.winnerIndex]?.name || `玩家${h.winnerIndex+1}`;
    return `<tr><td>第${h.handNumber}局</td><td>${winner}</td><td>${h.potSize.toLocaleString()}</td></tr>`;
  }).join('');
}

// 邊池計算
function calcSidePots(seats, players) {
  const contributions = seats.map((s, i) => ({
    idx: i,
    total: s.totalBetInHand || 0,
    status: s.status || 'folded'
  })).filter(s => s.total > 0);

  if (contributions.every(s => s.status !== 'allin')) {
    const total = contributions.reduce((sum, s) => sum + s.total, 0);
    const eligible = contributions.filter(s => s.status !== 'folded').map(s => s.idx);
    return [{ amount: total, eligible }];
  }

  const allInAmounts = contributions
    .filter(s => s.status === 'allin')
    .map(s => s.total)
    .sort((a, b) => a - b);

  const thresholds = [...new Set(allInAmounts)];
  const pots = [];
  let prev = 0;

  thresholds.forEach(threshold => {
    const amount = contributions.reduce((sum, s) => sum + Math.min(s.total, threshold) - Math.min(s.total, prev), 0);
    if (amount > 0) {
      const eligible = contributions.filter(s => s.total >= threshold && s.status !== 'folded').map(s => s.idx);
      pots.push({ amount, eligible });
    }
    prev = threshold;
  });

  // 主底池（超過最大全下額度的部分）
  const maxAllin = thresholds[thresholds.length - 1] || 0;
  const mainAmount = contributions.reduce((sum, s) => sum + Math.max(0, s.total - maxAllin), 0);
  if (mainAmount > 0) {
    const eligible = contributions.filter(s => s.status === 'active').map(s => s.idx);
    if (eligible.length > 0) pots.push({ amount: mainAmount, eligible });
  }

  return pots.length > 0 ? pots : [{
    amount: contributions.reduce((s, c) => s + c.total, 0),
    eligible: contributions.filter(s => s.status !== 'folded').map(s => s.idx)
  }];
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
