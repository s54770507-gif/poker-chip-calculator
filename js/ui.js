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

// 動態產生玩家名稱輸入欄位
export function renderNameInputs(count) {
  const container = document.getElementById('player-names');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'name-input-row';
    div.innerHTML = `<span class="name-label">玩家 ${i + 1}</span>
      <input type="text" id="pname-${i}" maxlength="10" placeholder="名稱" autocomplete="off">`;
    container.appendChild(div);
  }
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

// 籌碼視覺點點（8顆）
function chipDots(chips, startingChips) {
  const ratio = startingChips > 0 ? chips / startingChips : 0;
  const filled = Math.round(Math.min(ratio, 1) * 8);
  let html = '';
  for (let i = 0; i < 8; i++) {
    html += `<span class="chip-dot ${i < filled ? 'on' : 'off'}"></span>`;
  }
  return html;
}

// 玩家列表（遊戲中）
export function renderPlayerList(room, hand, myIndex) {
  const container = document.getElementById('player-list');
  container.innerHTML = '';
  const players = Object.values(room.players || {});
  const seats = hand?.seats || [];
  const startingChips = room.config?.startingChips || 1;
  const dealerIdx = hand?.dealerIndex ?? 0;

  players.forEach((p, i) => {
    const seat = seats[i] || {};
    const isMe = i === myIndex;
    const isDealer = i === dealerIdx;
    const isSB = i === ((dealerIdx + 1) % players.length);
    const isBB = i === ((dealerIdx + 2) % players.length);
    const isAction = i === hand?.actionIndex;
    const status = seat.status || 'active';

    const row = document.createElement('div');
    row.className = [
      'player-row',
      isMe ? 'me' : '',
      isAction ? 'acting' : '',
      status === 'folded' ? 'folded' : '',
      status === 'allin' ? 'allin' : '',
    ].filter(Boolean).join(' ');

    const badges = [
      isDealer ? '<span class="badge badge-d">D</span>' : '',
      isSB ? '<span class="badge badge-sb">SB</span>' : '',
      isBB ? '<span class="badge badge-bb">BB</span>' : '',
      status === 'allin' ? '<span class="badge badge-allin">全下</span>' : '',
    ].join('');

    const betDisplay = seat.bet > 0 ? `<span class="seat-bet">+${seat.bet.toLocaleString()}</span>` : '';

    row.innerHTML = `
      <div class="player-info">
        <span class="player-name">${p.name}${badges}</span>
        <div class="chip-dots">${chipDots(p.chips, startingChips)}</div>
      </div>
      <div class="player-chips">
        <span class="chip-count">${p.chips.toLocaleString()}</span>
        ${betDisplay}
      </div>`;
    container.appendChild(row);
  });
}

// 底池 + 輪次
export function renderPot(hand) {
  document.getElementById('pot-amount').textContent = (hand?.pot || 0).toLocaleString();
  const roundNames = { preflop: '翻牌前', flop: '翻牌', turn: '轉牌', river: '河牌' };
  document.getElementById('round-name').textContent = roundNames[hand?.round] || '';
  document.getElementById('hand-number').textContent = `第 ${hand?.number || 1} 局`;
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
    `<div class="chip-row"><span>${p.name}</span><span>${p.chips.toLocaleString()}</span></div>`
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
