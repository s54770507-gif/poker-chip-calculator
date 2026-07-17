import {
  initFirebase, roomRef, playersRef, playerRef, handRef, historyRef,
  dbSet, dbGet, dbUpdate, dbListen, dbTransaction, dbPush, serverTimestamp
} from './firebase.js?v=2';

import {
  showPhase, showToast, renderWaiting,
  renderPlayerList, renderPot, renderActionPanel, renderShowdown, renderHistory
} from './ui.js?v=2';

// ── 本地狀態 ──────────────────────────────────────────────
let myRoomCode = null;
let myPlayerIndex = null;
let currentRoom = null;
let unsubscribe = null;

// ── 初始化 ────────────────────────────────────────────────
export function init() {
  initFirebase();

  const saved = loadLocal();
  if (saved) {
    myRoomCode = saved.roomCode;
    myPlayerIndex = saved.playerIndex;
    rejoinRoom();
  } else {
    showPhase('home');
  }

  bindEvents();
}

function bindEvents() {
  // 首頁
  document.getElementById('btn-create').addEventListener('click', onClickCreate);
  document.getElementById('btn-join').addEventListener('click', onClickJoin);
  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onClickJoin();
  });

  // 設定
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('btn-create-room').addEventListener('click', onCreateRoom);
  document.getElementById('btn-back-setup').addEventListener('click', () => showPhase('home'));

  // 等待室
  document.getElementById('btn-start-game').addEventListener('click', onStartGame);
  document.getElementById('btn-start-now').addEventListener('click', onStartGame);
  document.getElementById('btn-leave-room').addEventListener('click', onLeaveRoom);
  document.getElementById('btn-leave-hand').addEventListener('click', onLeaveRoom);
  document.getElementById('room-code-badge').addEventListener('click', () => {
    const code = myRoomCode || '';
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => showToast(`代碼 ${code} 已複製`, 'info'))
      .catch(() => showToast(`房間代碼：${code}`, 'info'));
  });
  document.getElementById('btn-switch-player').addEventListener('click', () => {
    if (!myRoomCode || !currentRoom) return;
    const players = Object.values(currentRoom.players || {});
    const list = document.getElementById('player-select-list');
    list.innerHTML = '';
    players.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'player-select-btn';
      btn.textContent = p.name + (i === myPlayerIndex ? ' ✓' : '');
      btn.addEventListener('click', () => {
        document.getElementById('player-select-overlay').classList.add('hidden');
        document.getElementById('join-mode').style.display = '';
        document.getElementById('switch-mode').style.display = 'none';
        myPlayerIndex = i;
        saveLocal(myRoomCode, i);
        renderRoom(currentRoom);
        showToast(`切換為 ${p.name}`);
      });
      list.appendChild(btn);
    });
    document.getElementById('join-mode').style.display = 'none';
    document.getElementById('switch-mode').style.display = '';
    document.getElementById('player-select-overlay').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-switch').addEventListener('click', () => {
    document.getElementById('player-select-overlay').classList.add('hidden');
    document.getElementById('join-mode').style.display = '';
    document.getElementById('switch-mode').style.display = 'none';
  });
  document.getElementById('btn-confirm-join').addEventListener('click', doJoinRoom);
  document.getElementById('join-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoinRoom();
  });
  document.getElementById('btn-cancel-join').addEventListener('click', () => {
    document.getElementById('player-select-overlay').classList.add('hidden');
  });

  // 遊戲行動
  document.getElementById('btn-fold').addEventListener('click', () => handleAction('fold'));
  document.getElementById('btn-check').addEventListener('click', () => handleAction('check'));
  document.getElementById('btn-call').addEventListener('click', () => handleAction('call'));
  document.getElementById('btn-raise-toggle').addEventListener('click', toggleRaisePanel);
  document.getElementById('btn-raise-cancel').addEventListener('click', toggleRaisePanel);

  document.querySelectorAll('.raise-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = +btn.dataset.amount;
      if (amount > 0) handleAction('raise', amount);
    });
  });

  document.getElementById('btn-raise-confirm').addEventListener('click', () => {
    const val = +document.getElementById('raise-custom-input').value;
    if (val > 0) handleAction('raise', val);
  });

  // 攤牌
  document.getElementById('showdown-pots').addEventListener('click', e => {
    const btn = e.target.closest('.btn-winner');
    if (!btn) return;
    awardPot(+btn.dataset.potIndex, +btn.dataset.winnerIndex);
  });
  document.getElementById('btn-new-hand').addEventListener('click', startHand);

  // 歷史
  document.querySelectorAll('.btn-history').forEach(btn =>
    btn.addEventListener('click', () => showPhase('history'))
  );
  document.getElementById('btn-back-game').addEventListener('click', () => {
    if (currentRoom?.hand?.round === 'showdown') showPhase('showdown');
    else showPhase('hand');
  });
}

// ── 首頁操作 ──────────────────────────────────────────────
function onClickCreate() {
  showPhase('setup');
  document.querySelector('.count-btn[data-count="4"]').click();
}

function onClickJoin() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showToast('請輸入 6 碼房間代碼', 'error'); return; }
  // 先確認房間存在再顯示 overlay
  dbGet(roomRef(code)).then(room => {
    if (!room) { showToast('找不到此房間', 'error'); return; }
    if (room.status === 'finished') { showToast('此房間已結束', 'error'); return; }
    const joined = Object.keys(room.players || {}).length;
    const max = room.config?.playerCount || 0;
    if (joined >= max) { showToast('房間已滿', 'error'); return; }
    document.getElementById('join-room-info').textContent =
      `房間代碼：${code}　(${joined}/${max} 人)`;
    document.getElementById('join-name-input').value = '';
    document.getElementById('player-select-overlay').classList.remove('hidden');
    document.getElementById('join-name-input').focus();
    // 儲存 code 備用
    document.getElementById('btn-confirm-join').dataset.code = code;
  }).catch(() => showToast('加入失敗，請重試', 'error'));
}

async function doJoinRoom() {
  const code = document.getElementById('btn-confirm-join').dataset.code;
  const name = document.getElementById('join-name-input').value.trim().slice(0, 10);
  if (!name) { showToast('請輸入名字', 'error'); return; }
  if (!code) return;
  document.getElementById('player-select-overlay').classList.add('hidden');
  try {
    const room = await dbGet(roomRef(code));
    if (!room) { showToast('找不到此房間', 'error'); return; }
    const startingChips = room.config.startingChips;
    const playerCount = room.config.playerCount;

    // 用 transaction 安全搶位
    let assignedIdx = null;
    await dbTransaction(playersRef(code), (players) => {
      if (!players) players = {};
      const count = Object.keys(players).length;
      if (count >= playerCount) return; // 已滿，放棄
      assignedIdx = count;
      players[count] = { name, chips: startingChips, isActive: true };
      return players;
    });

    if (assignedIdx === null) { showToast('房間已滿', 'error'); return; }

    myRoomCode = code;
    myPlayerIndex = assignedIdx;
    saveLocal(code, assignedIdx);
    subscribeRoom(code);
    showPhase('waiting');
    showToast(`歡迎 ${name}！`);
  } catch (e) {
    const isPermission = e?.code?.includes('permission') || String(e?.message).includes('PERMISSION_DENIED');
    showToast(isPermission ? 'Firebase 規則過期，請至 Console 更新讀寫規則' : '加入失敗：' + (e?.code || e?.message || '請重試'), 'error');
    console.error('doJoinRoom error:', e);
  }
}

// ── 建立房間 ──────────────────────────────────────────────
async function onCreateRoom() {
  const hostName = document.getElementById('host-name').value.trim().slice(0, 10) || '房主';
  const countBtn = document.querySelector('.count-btn.active');
  const playerCount = +countBtn.dataset.count;
  const startingChips = +document.getElementById('starting-chips').value || 5000;
  const smallBlind = +document.getElementById('small-blind').value || 25;
  const bigBlind = +document.getElementById('big-blind').value || 50;

  const code = generateCode();
  const roomData = {
    code,
    status: 'waiting',
    createdAt: Date.now(),
    config: { playerCount, startingChips, smallBlind, bigBlind },
    players: {
      0: { name: hostName, chips: startingChips, isActive: true }
    }
  };

  try {
    await dbSet(roomRef(code), roomData);
    myRoomCode = code;
    myPlayerIndex = 0;
    saveLocal(code, 0);
    subscribeRoom(code);
    showPhase('waiting');
    showToast(`房間已建立：${code}`);
  } catch (e) {
    const isPermission = e?.code?.includes('permission') || String(e?.message).includes('PERMISSION_DENIED');
    showToast(isPermission ? 'Firebase 規則過期，請至 Console 更新讀寫規則' : '建立失敗：' + (e?.code || e?.message || '請重試'), 'error');
    console.error('onCreateRoom error:', e);
  }
}


async function rejoinRoom() {
  try {
    const room = await dbGet(roomRef(myRoomCode));
    if (!room) { clearLocal(); showPhase('home'); return; }
    subscribeRoom(myRoomCode);
  } catch {
    clearLocal(); showPhase('home');
  }
}

// ── 訂閱房間 ──────────────────────────────────────────────
function subscribeRoom(code) {
  if (unsubscribe) unsubscribe();
  unsubscribe = dbListen(roomRef(code), room => {
    if (!room) { clearLocal(); showPhase('home'); return; }
    room.code = code;
    currentRoom = room;
    renderRoom(room);
  });
}

function renderRoom(room) {
  // 更新「你是誰」bar
  const players = Object.values(room.players || {});
  const myNameEl = document.getElementById('my-player-name');
  if (myNameEl) myNameEl.textContent = players[myPlayerIndex]?.name || '─';
  const codeBadge = document.getElementById('room-code-badge');
  if (codeBadge) codeBadge.textContent = room.code || myRoomCode || '';

  const hand = room.hand;
  switch (room.status) {
    case 'waiting':
      renderPlayerList(room, null, myPlayerIndex);
      renderPot(null);
      renderPreGame(room, myPlayerIndex);
      showPhase('hand');
      break;
    case 'playing':
      if (hand?.round === 'showdown') {
        renderPlayerList(room, hand, myPlayerIndex);
        renderPot(hand);
        renderShowdown(room, hand);
        renderHistory(room);
        showPhase('showdown');
      } else {
        showGameControls();
        renderPlayerList(room, hand, myPlayerIndex);
        renderPot(hand);
        renderActionPanel(room, hand, myPlayerIndex);
        document.getElementById('btn-show-history-hand').style.display = 'block';
        showPhase('hand');
      }
      break;
  }
}

function renderPreGame(room, myIndex) {
  const players = Object.values(room.players || {});
  const total = room.config?.playerCount || 0;
  const joined = players.length;
  const isHost = myIndex === 0;

  // 隱藏遊戲行動，顯示等待面板
  document.getElementById('action-buttons').style.display = 'none';
  document.getElementById('waiting-msg').style.display = 'none';
  document.getElementById('actor-label').style.display = 'none';
  document.getElementById('raise-panel').classList.add('hidden');
  document.getElementById('pre-game-panel').style.display = 'flex';

  document.getElementById('pregame-status').textContent = `${joined} / ${total} 玩家已就座`;

  const startBtn = document.getElementById('btn-start-now');
  const waitingMsg = document.getElementById('pregame-waiting');
  if (isHost && joined >= 2) {
    startBtn.style.display = 'block';
    waitingMsg.style.display = 'none';
  } else if (isHost) {
    startBtn.style.display = 'none';
    waitingMsg.style.display = 'block';
    waitingMsg.textContent = '等待更多玩家加入...';
  } else {
    startBtn.style.display = 'none';
    waitingMsg.style.display = 'block';
    waitingMsg.textContent = '等待房主開始遊戲...';
  }
}

function showGameControls() {
  document.getElementById('pre-game-panel').style.display = 'none';
  document.getElementById('actor-label').style.display = '';
}

// ── 開始遊戲 ──────────────────────────────────────────────
async function onStartGame() {
  const room = await dbGet(roomRef(myRoomCode));
  const joined = Object.keys(room.players || {}).length;
  if (joined < 2) { showToast('至少需要 2 位玩家', 'error'); return; }

  await dbUpdate(roomRef(myRoomCode), { status: 'playing' });
  await startHand();
}

async function startHand() {
  const room = await dbGet(roomRef(myRoomCode));
  const players = Object.values(room.players);
  const config = room.config;
  const prevHand = room.hand;
  const handNumber = (prevHand?.number || 0) + 1;

  const activePlayers = players.filter(p => p.isActive && p.chips > 0);
  if (activePlayers.length < 2) { showToast('玩家籌碼不足，遊戲結束', 'info'); return; }

  // 莊家輪換
  let dealerIdx = prevHand?.dealerIndex ?? 0;
  dealerIdx = nextActiveIdx(dealerIdx, players);

  const n = players.length;
  const sbIdx = nextActiveIdx(dealerIdx, players);
  const bbIdx = nextActiveIdx(sbIdx, players);
  const firstActIdx = nextActiveIdx(bbIdx, players);

  const sb = config.smallBlind;
  const bb = config.bigBlind;

  // 建立座位
  const seats = {};
  players.forEach((p, i) => {
    seats[i] = { bet: 0, totalBetInHand: 0, status: p.chips > 0 ? 'active' : 'folded', hasActed: false };
  });

  // 扣盲注
  const updatedPlayers = {};
  players.forEach((p, i) => { updatedPlayers[i] = { ...p }; });

  const sbActual = Math.min(sb, updatedPlayers[sbIdx].chips);
  updatedPlayers[sbIdx].chips -= sbActual;
  seats[sbIdx].bet = sbActual;
  seats[sbIdx].totalBetInHand = sbActual;
  if (updatedPlayers[sbIdx].chips === 0) seats[sbIdx].status = 'allin';

  const bbActual = Math.min(bb, updatedPlayers[bbIdx].chips);
  updatedPlayers[bbIdx].chips -= bbActual;
  seats[bbIdx].bet = bbActual;
  seats[bbIdx].totalBetInHand = bbActual;
  if (updatedPlayers[bbIdx].chips === 0) seats[bbIdx].status = 'allin';
  seats[bbIdx].hasActed = false; // BB 保留加注選項

  const currentBet = bbActual;

  const hand = {
    number: handNumber,
    dealerIndex: dealerIdx,
    pot: 0,
    round: 'preflop',
    currentBet,
    lastRaiseSize: bb,
    actionIndex: firstActIdx,
    bigBlind: bb,
    seats
  };

  await dbUpdate(roomRef(myRoomCode), { players: updatedPlayers, hand });
}

// ── 行動處理 ──────────────────────────────────────────────
async function handleAction(type, raiseAmount) {
  if (!currentRoom?.hand) return;
  const hand = currentRoom.hand;
  const players = Object.values(currentRoom.players);

  if (hand.actionIndex !== myPlayerIndex) { showToast('還沒輪到你', 'error'); return; }

  const seat = hand.seats[myPlayerIndex];
  if (seat.status !== 'active') return;

  const myChips = players[myPlayerIndex].chips;
  const callAmount = hand.currentBet - seat.bet;

  let updates = {};

  if (type === 'fold') {
    updates[`hand/seats/${myPlayerIndex}/status`] = 'folded';
    updates[`hand/seats/${myPlayerIndex}/hasActed`] = true;

  } else if (type === 'check') {
    if (callAmount > 0) { showToast('無法過牌，請跟注或棄牌', 'error'); return; }
    updates[`hand/seats/${myPlayerIndex}/hasActed`] = true;

  } else if (type === 'call') {
    const actual = Math.min(callAmount, myChips);
    const newChips = myChips - actual;
    const newBet = seat.bet + actual;
    const newTotal = seat.totalBetInHand + actual;
    updates[`players/${myPlayerIndex}/chips`] = newChips;
    updates[`hand/seats/${myPlayerIndex}/bet`] = newBet;
    updates[`hand/seats/${myPlayerIndex}/totalBetInHand`] = newTotal;
    updates[`hand/seats/${myPlayerIndex}/hasActed`] = true;
    if (newChips === 0) updates[`hand/seats/${myPlayerIndex}/status`] = 'allin';

  } else if (type === 'raise') {
    // raiseAmount = 想要下注的總額（本輪）
    const minRaise = hand.currentBet + hand.lastRaiseSize;
    const maxRaise = seat.bet + myChips;
    const target = Math.max(Math.min(raiseAmount, maxRaise), minRaise);
    const additional = target - seat.bet;
    const newChips = myChips - additional;
    const newTotal = seat.totalBetInHand + additional;
    const raiseSize = target - hand.currentBet;

    updates[`players/${myPlayerIndex}/chips`] = newChips;
    updates[`hand/seats/${myPlayerIndex}/bet`] = target;
    updates[`hand/seats/${myPlayerIndex}/totalBetInHand`] = newTotal;
    updates[`hand/seats/${myPlayerIndex}/hasActed`] = true;
    updates[`hand/currentBet`] = target;
    if (raiseSize >= hand.lastRaiseSize) updates[`hand/lastRaiseSize`] = raiseSize;
    if (newChips === 0) updates[`hand/seats/${myPlayerIndex}/status`] = 'allin';

    // 重置其他玩家行動權
    Object.entries(hand.seats).forEach(([i, s]) => {
      if (+i !== myPlayerIndex && s.status === 'active') {
        updates[`hand/seats/${i}/hasActed`] = false;
      }
    });

    // 隱藏加注面板
    document.getElementById('raise-panel').classList.add('hidden');
  }

  await dbUpdate(roomRef(myRoomCode), updates);

  // 重新讀取 hand 判斷輪次
  await advanceTurn();
}

async function advanceTurn() {
  const room = await dbGet(roomRef(myRoomCode));
  const hand = room.hand;
  const players = Object.values(room.players);
  const seats = Object.values(hand.seats);

  // 若只剩一人未棄牌，直接結算
  const notFolded = seats.filter(s => s.status !== 'folded');
  if (notFolded.length === 1) {
    await collectBetsToPot(room);
    await goToShowdown();
    return;
  }

  // 檢查輪次是否結束
  if (isRoundComplete(hand)) {
    await collectBetsToPot(room);
    await advanceRound(room);
    return;
  }

  // 找下一位行動玩家
  const next = nextActionIdx(hand.actionIndex, hand.seats, players.length);
  if (next === null) {
    await collectBetsToPot(room);
    await advanceRound(room);
    return;
  }

  await dbUpdate(handRef(myRoomCode), { actionIndex: next });
}

function isRoundComplete(hand) {
  const seats = Object.values(hand.seats);
  const active = seats.filter(s => s.status === 'active');
  if (active.length === 0) return true;
  return active.every(s => s.hasActed && s.bet === hand.currentBet);
}

function nextActionIdx(from, seats, total) {
  let i = (from + 1) % total;
  for (let loop = 0; loop < total; loop++) {
    if (seats[i]?.status === 'active') return i;
    i = (i + 1) % total;
  }
  return null;
}

async function collectBetsToPot(room) {
  const hand = room.hand;
  const seats = hand.seats;
  let addToPot = 0;
  const updates = {};
  Object.entries(seats).forEach(([i, s]) => {
    addToPot += s.bet || 0;
    updates[`hand/seats/${i}/bet`] = 0;
  });
  updates[`hand/pot`] = (hand.pot || 0) + addToPot;
  updates[`hand/currentBet`] = 0;
  await dbUpdate(roomRef(myRoomCode), updates);
}

async function advanceRound(room) {
  const hand = room.hand;
  const roundOrder = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const idx = roundOrder.indexOf(hand.round);
  const nextRound = roundOrder[idx + 1] || 'showdown';

  if (nextRound === 'showdown') {
    await goToShowdown();
    return;
  }

  // 重置行動權，設定行動起始位（dealer 後第一位 active）
  const seats = hand.seats;
  const updates = { 'hand/round': nextRound, 'hand/lastRaiseSize': hand.bigBlind };
  const players = Object.values(room.players);
  Object.keys(seats).forEach(i => {
    if (seats[i].status === 'active') updates[`hand/seats/${i}/hasActed`] = false;
  });
  const firstAct = nextActiveIdx(hand.dealerIndex, players);
  updates['hand/actionIndex'] = firstAct;

  // 若所有玩家都全下，跳到 showdown
  const active = Object.values(seats).filter(s => s.status === 'active');
  if (active.length === 0) {
    await goToShowdown();
    return;
  }

  await dbUpdate(roomRef(myRoomCode), updates);
}

async function goToShowdown() {
  await dbUpdate(handRef(myRoomCode), { round: 'showdown' });
}

// ── 分配底池 ──────────────────────────────────────────────
async function awardPot(potIndex, winnerIndex) {
  const room = await dbGet(roomRef(myRoomCode));
  const hand = room.hand;

  // 防止重複分配（多裝置同時點擊時）
  if (hand.awards && hand.awards[potIndex] !== undefined) {
    showToast('此底池已分配', 'info'); return;
  }

  const players = Object.values(room.players);
  const seats = Object.values(hand.seats);
  const pots = calcAllSidePots(seats);
  if (potIndex >= pots.length) return;

  const pot = pots[potIndex];
  const winner = players[winnerIndex];
  if (!winner) return;

  const updates = {
    [`players/${winnerIndex}/chips`]: winner.chips + pot.amount,
    [`hand/awards/${potIndex}`]: winnerIndex
  };
  await dbUpdate(roomRef(myRoomCode), updates);
  showToast(`${winner.name} 贏得 ${pot.amount.toLocaleString()} 籌碼`);

  // 所有底池都分配完畢則結束本局
  const awardedCount = Object.keys(hand.awards || {}).length + 1;
  if (awardedCount >= pots.length) setTimeout(() => endHand(winnerIndex, pots), 500);
}

async function endHand(winnerIndex, pots) {
  const room = await dbGet(roomRef(myRoomCode));
  const players = Object.values(room.players);
  const hand = room.hand;

  const totalPot = pots.reduce((s, p) => s + p.amount, 0);
  const historyEntry = {
    handNumber: hand.number,
    potSize: totalPot,
    winnerIndex,
    chipsAfter: players.map(p => p.chips)
  };

  await dbPush(historyRef(myRoomCode), historyEntry);

  // 更新無籌碼玩家的 isActive
  const updates = {};
  players.forEach((p, i) => {
    if (p.chips <= 0) updates[`players/${i}/isActive`] = false;
  });
  if (Object.keys(updates).length > 0) await dbUpdate(roomRef(myRoomCode), updates);

  showToast('本局結束，準備下一局...');
}

// ── 離開房間 ──────────────────────────────────────────────
function onLeaveRoom() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  clearLocal();
  myRoomCode = null;
  myPlayerIndex = null;
  currentRoom = null;
  showPhase('home');
}

function toggleRaisePanel() {
  document.getElementById('raise-panel').classList.toggle('hidden');
}

// ── 工具函式 ──────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function nextActiveIdx(from, players) {
  const n = players.length;
  let i = (from + 1) % n;
  for (let loop = 0; loop < n; loop++) {
    if (players[i]?.isActive && players[i]?.chips > 0) return i;
    i = (i + 1) % n;
  }
  return from;
}

function saveLocal(code, idx) {
  localStorage.setItem('poker_room', JSON.stringify({ roomCode: code, playerIndex: idx }));
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem('poker_room')); } catch { return null; }
}

function clearLocal() {
  localStorage.removeItem('poker_room');
}

function calcAllSidePots(seats) {
  const contributions = seats.map((s, i) => ({
    idx: i, total: s.totalBetInHand || 0, status: s.status || 'folded'
  })).filter(s => s.total > 0);

  if (contributions.every(s => s.status !== 'allin')) {
    return [{
      amount: contributions.reduce((sum, s) => sum + s.total, 0),
      eligible: contributions.filter(s => s.status !== 'folded').map(s => s.idx)
    }];
  }

  const thresholds = [...new Set(
    contributions.filter(s => s.status === 'allin').map(s => s.total)
  )].sort((a, b) => a - b);

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

// 啟動
init();
