import {
  initFirebase, roomRef, playersRef, playerRef, handRef, historyRef,
  chatRef, reactionsRef,
  dbSet, dbGet, dbUpdate, dbListen, dbTransaction, dbPush, serverTimestamp
} from './firebase.js?v=12';

import {
  showPhase, showToast, renderWaiting,
  renderPlayerList, renderPot, renderActionPanel, renderHistory,
  showFireworks, showLoserText, renderCards,
  showWinnerOverlay, animateDealCards,
  updateRabbitSection, updateTimerUI,
  updateShowBluffSection, showChatBubble, playReaction, renderChatLog
} from './ui.js?v=12';

import { shuffleDeck } from './cards.js?v=7';
import { bestHand, compareHands } from './eval.js?v=7';

// ── 常數（Natural8 風格計時規則）─────────────────────────
const ACTION_SECONDS = 15;      // 每次行動基本秒數
const TIME_BANK_SECONDS = 30;   // 每人時間銀行儲備秒數

// ── 本地狀態 ──────────────────────────────────────────────
let myRoomCode = null;
let myPlayerIndex = null;
let currentRoom = null;
let unsubscribe = null;
let pendingJoinAvatar = null;
let pendingHostAvatar = null;
let showdownAnimated = false;
let autoStartTimer = null;
let lastHandNumber = null;
let autoAdvancing = false;
let timerInterval = null;
let timeoutHandling = false;
let rabbitSeen = false;
let seenChatKeys = new Set();
let seenReactionKeys = new Set();
let eventsPrimed = false;
let lastInteractAt = 0;      // 互動冷卻（防洗版）
let throwTargetIdx = null;   // 丟擲目標座位

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

  // 行動計時迴圈（tick 內部自行判斷是否需要倒數）
  timerInterval = setInterval(timerTick, 250);
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
      btn.addEventListener('click', async () => {
        document.getElementById('player-select-overlay').classList.add('hidden');
        document.getElementById('join-mode').style.display = '';
        document.getElementById('switch-mode').style.display = 'none';
        myPlayerIndex = i;
        saveLocal(myRoomCode, i);
        // 重新讀取確保渲染資料最新
        const fresh = await dbGet(roomRef(myRoomCode));
        if (fresh) { fresh.code = myRoomCode; currentRoom = fresh; renderRoom(fresh); }
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
  setupAvatarPicker('join-avatar-input', 'join-avatar-preview', b64 => { pendingJoinAvatar = b64; });
  setupAvatarPicker('host-avatar-input', 'host-avatar-preview', b64 => { pendingHostAvatar = b64; });

  document.getElementById('btn-confirm-join').addEventListener('click', doJoinRoom);
  document.getElementById('join-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoinRoom();
  });
  document.getElementById('btn-cancel-join').addEventListener('click', () => {
    document.getElementById('player-select-overlay').classList.add('hidden');
    pendingJoinAvatar = null;
    resetAvatarPreview('join-avatar-preview');
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

  // 座位點擊：補充籌碼 / 丟擲物品選單
  document.getElementById('player-seats').addEventListener('click', e => {
    const btn = e.target.closest('.seat-rebuy-btn');
    if (btn) { handleRebuy(+btn.dataset.playerIndex); return; }
    // 點對手座位 → 開啟丟擲選單
    const seat = e.target.closest('.player-seat');
    if (!seat || seat.classList.contains('empty')) return;
    const idx = +seat.dataset.seatIndex;
    if (idx === myPlayerIndex || Number.isNaN(idx)) return;
    if (currentRoom?.players?.[idx]?.isActive === false) return;
    e.stopPropagation();
    openThrowMenu(seat, idx);
  });

  // 丟擲選單
  document.getElementById('throw-menu').addEventListener('click', e => {
    const item = e.target.closest('.throw-item');
    if (!item || throwTargetIdx === null) return;
    sendReaction({ type: 'throw', item: item.dataset.item, to: throwTargetIdx });
    hideThrowMenu();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#throw-menu') && !e.target.closest('.player-seat')) hideThrowMenu();
  });

  // 聊天面板
  document.getElementById('btn-chat').addEventListener('click', () => {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden') && currentRoom) {
      renderChatLog(currentRoom, myPlayerIndex);
      document.getElementById('chat-input').focus();
    }
  });
  document.getElementById('btn-chat-close').addEventListener('click', () =>
    document.getElementById('chat-panel').classList.add('hidden'));
  document.getElementById('btn-chat-send').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    sendChat(input.value);
    input.value = '';
  });
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      sendChat(e.target.value);
      e.target.value = '';
    }
  });
  document.querySelectorAll('.chat-quick').forEach(btn =>
    btn.addEventListener('click', () => sendChat(btn.textContent)));
  document.querySelectorAll('.chat-emoji').forEach(btn =>
    btn.addEventListener('click', () => sendReaction({ type: 'emoji', item: btn.dataset.emoji })));

  // 結算 overlay：補充籌碼 & 兔子洞 & 亮牌嘲諷
  document.getElementById('winner-overlay')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-rebuy');
    if (btn) handleRebuy(+btn.dataset.playerIndex);
    if (e.target.closest('#btn-rabbit')) revealRabbit();
    const sb = e.target.closest('.btn-showbluff');
    if (sb) revealShowBluff(sb.dataset.which);
  });

  // 暫離 / 回座
  document.getElementById('btn-sitout').addEventListener('click', async () => {
    if (!myRoomCode || myPlayerIndex === null) return;
    const me = currentRoom?.players?.[myPlayerIndex];
    const newVal = !(me?.sitOut === true);
    try {
      await dbUpdate(roomRef(myRoomCode), { [`players/${myPlayerIndex}/sitOut`]: newVal });
      showToast(newVal ? '已暫離，下一局起自動跳過' : '已回座，下一局加入', 'info');
    } catch (e) { console.warn('sitout error:', e); }
  });
  document.getElementById('showdown-chips').addEventListener('click', e => {
    const btn = e.target.closest('.btn-rebuy');
    if (!btn) return;
    handleRebuy(+btn.dataset.playerIndex);
  });
  document.getElementById('btn-new-hand').addEventListener('click', startHand);

  // 歷史
  document.querySelectorAll('.btn-history').forEach(btn =>
    btn.addEventListener('click', () => showPhase('history'))
  );
  document.getElementById('btn-back-game').addEventListener('click', () => showPhase('hand'));
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
    const joined = Object.values(room.players || {}).filter(p => p?.isActive !== false).length;
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

    // 用 transaction 安全搶位（優先重用已離開玩家的空位）
    let assignedIdx = null;
    await dbTransaction(playersRef(code), (players) => {
      if (!players) players = {};
      const activeCount = Object.values(players).filter(p => p?.isActive !== false).length;
      if (activeCount >= playerCount) return; // 已滿，放棄
      // 找第一個已離開的空位，否則追加在末尾
      let slot = Object.keys(players).length;
      for (const [key, p] of Object.entries(players)) {
        if (p?.isActive === false) { slot = +key; break; }
      }
      assignedIdx = slot;
      players[slot] = { name, chips: startingChips, isActive: true, timeBank: TIME_BANK_SECONDS, ...(pendingJoinAvatar ? { avatar: pendingJoinAvatar } : {}) };
      return players;
    });

    if (assignedIdx === null) { showToast('房間已滿', 'error'); return; }

    pendingJoinAvatar = null;
    resetAvatarPreview('join-avatar-preview');
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
  const bbAnte = document.getElementById('bb-ante-toggle')?.checked || false;
  const straddle = document.getElementById('straddle-toggle')?.checked || false;

  const code = generateCode();
  const roomData = {
    code,
    status: 'waiting',
    createdAt: Date.now(),
    config: { playerCount, startingChips, smallBlind, bigBlind, bbAnte, straddle },
    players: {
      0: { name: hostName, chips: startingChips, isActive: true, timeBank: TIME_BANK_SECONDS, ...(pendingHostAvatar ? { avatar: pendingHostAvatar } : {}) }
    }
  };

  try {
    await dbSet(roomRef(code), roomData);
    pendingHostAvatar = null;
    resetAvatarPreview('host-avatar-preview');
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
  seenChatKeys = new Set();
  seenReactionKeys = new Set();
  eventsPrimed = false;
  unsubscribe = dbListen(roomRef(code), room => {
    if (!room) { clearLocal(); showPhase('home'); return; }
    room.code = code;
    currentRoom = room;
    renderRoom(room);
    processEvents(room);
  });
}

// ── 互動事件處理（聊天氣泡 / 丟擲 / 表情）──────────────────
function processEvents(room) {
  const chat = room.chat || {};
  const reactions = room.reactions || {};

  // 首次載入：把既有事件標記為已看過，不重播動畫
  if (!eventsPrimed) {
    Object.keys(chat).forEach(k => seenChatKeys.add(k));
    Object.keys(reactions).forEach(k => seenReactionKeys.add(k));
    eventsPrimed = true;
    return;
  }

  const now = Date.now();
  let chatChanged = false;
  Object.entries(chat).forEach(([k, m]) => {
    if (seenChatKeys.has(k)) return;
    seenChatKeys.add(k);
    chatChanged = true;
    if (now - (m.ts || 0) < 15000) showChatBubble(m);
  });
  Object.entries(reactions).forEach(([k, r]) => {
    if (seenReactionKeys.has(k)) return;
    seenReactionKeys.add(k);
    if (now - (r.ts || 0) < 15000) playReaction(r);
  });

  // 面板開著時同步聊天紀錄
  if (chatChanged && !document.getElementById('chat-panel').classList.contains('hidden')) {
    renderChatLog(room, myPlayerIndex);
  }
}

// ── 送出互動（含冷卻）────────────────────────────────────
function interactCooldownOk() {
  const now = Date.now();
  if (now - lastInteractAt < 1500) { showToast('慢點，別洗版 😅', 'error'); return false; }
  lastInteractAt = now;
  return true;
}

function sendChat(text) {
  const t = String(text || '').trim().slice(0, 60);
  if (!t || !myRoomCode || myPlayerIndex === null) return;
  if (!interactCooldownOk()) return;
  const name = currentRoom?.players?.[myPlayerIndex]?.name || '';
  dbPush(chatRef(myRoomCode), { from: myPlayerIndex, name, text: t, ts: Date.now() })
    .catch?.(e => console.warn('chat error:', e));
}

function sendReaction(r) {
  if (!myRoomCode || myPlayerIndex === null) return;
  if (!interactCooldownOk()) return;
  dbPush(reactionsRef(myRoomCode), { ...r, from: myPlayerIndex, ts: Date.now() })
    .catch?.(e => console.warn('reaction error:', e));
}

function renderRoom(room) {
  // 更新「你是誰」bar
  const players = Object.values(room.players || {});
  const myNameEl = document.getElementById('my-player-name');
  if (myNameEl) myNameEl.textContent = players[myPlayerIndex]?.name || '─';
  const codeBadge = document.getElementById('room-code-badge');
  if (codeBadge) codeBadge.textContent = room.code || myRoomCode || '';

  // 暫離按鈕狀態
  const sitBtn = document.getElementById('btn-sitout');
  if (sitBtn) {
    const sitting = players[myPlayerIndex]?.sitOut === true;
    sitBtn.textContent = sitting ? '▶' : '⏸';
    sitBtn.title = sitting ? '回座（下一局加入）' : '暫離（下一局起自動跳過）';
    sitBtn.classList.toggle('sitting', sitting);
  }

  const hand = room.hand;
  switch (room.status) {
    case 'waiting':
      document.getElementById('btn-show-history-hand').style.display = 'none';
      renderPlayerList(room, null, myPlayerIndex);
      renderPot(null);
      renderCards(null, myPlayerIndex);
      renderPreGame(room, myPlayerIndex);
      showPhase('hand');
      break;
    case 'playing':
      if (hand?.round === 'showdown') {
        renderPlayerList(room, hand, myPlayerIndex);
        renderPot(hand);
        renderCards(hand, myPlayerIndex);
        renderHistory(room);
        showPhase('hand');
        updateRabbitSection(hand);
        updateShowBluffSection(hand, myPlayerIndex, players);
        if (!showdownAnimated) {
          showdownAnimated = true;
          triggerShowdownAnimations(room, hand);
          showWinnerOverlay(room, hand);
          // 自動發牌開始下一局（棄牌提前結束時多留時間給兔子洞）
          const delay = (hand.communityCards?.length || 0) < 5 ? 6500 : 4500;
          clearTimeout(autoStartTimer);
          autoStartTimer = setTimeout(async () => {
            document.getElementById('winner-overlay')?.classList.add('hidden');
            await autoStartNextHand(hand.number);
          }, delay);
        }
        // 有人開了兔子洞 → 延後自動開局，讓大家看牌
        if (hand.rabbitRevealed && !rabbitSeen) {
          rabbitSeen = true;
          clearTimeout(autoStartTimer);
          autoStartTimer = setTimeout(async () => {
            document.getElementById('winner-overlay')?.classList.add('hidden');
            await autoStartNextHand(hand.number);
          }, 5000);
        }
      } else {
        // 隱藏結算 overlay，清除自動開局計時
        document.getElementById('winner-overlay')?.classList.add('hidden');
        clearTimeout(autoStartTimer);
        autoStartTimer = null;
        showGameControls();
        renderPlayerList(room, hand, myPlayerIndex);
        renderPot(hand);
        renderCards(hand, myPlayerIndex);
        renderActionPanel(room, hand, myPlayerIndex);
        document.getElementById('btn-show-history-hand').style.display = 'block';
        showPhase('hand');
        // 偵測到新局時觸發發牌動畫
        if (lastHandNumber !== hand.number) {
          lastHandNumber = hand.number;
          const totalSlots = room.config?.playerCount || Object.keys(room.players || {}).length;
          setTimeout(() => animateDealCards(hand, myPlayerIndex, totalSlots), 80);
        }
        // 偵測行動者已離開或棄牌導致遊戲卡住
        if (!autoAdvancing && !hand.autoAwarded) {
          const actorSeat   = hand.seats?.[hand.actionIndex];
          const actorPlayer = players[hand.actionIndex];
          if (actorSeat?.status !== 'active' || actorPlayer?.isActive === false) {
            autoAdvancing = true;
            setTimeout(async () => {
              try { await advanceTurn(); }
              catch (e) { console.warn('auto-advance error:', e); }
              finally { autoAdvancing = false; }
            }, 300 + (myPlayerIndex || 0) * 80);
          }
        }
      }
      break;
  }
}

function renderPreGame(room, myIndex) {
  const players = Object.values(room.players || {});
  const total = room.config?.playerCount || 0;
  const joined = players.filter(p => p?.isActive !== false).length;
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
  const joined = Object.values(room.players || {}).filter(p => p?.isActive !== false && !p?.sitOut).length;
  if (joined < 2) { showToast('至少需要 2 位玩家', 'error'); return; }

  await dbUpdate(roomRef(myRoomCode), { status: 'playing' });
  await startHand();
}

async function startHand() {
  showdownAnimated = false;
  autoAdvancing = false;
  timeoutHandling = false;
  rabbitSeen = false;
  clearTimeout(autoStartTimer);
  autoStartTimer = null;
  const room = await dbGet(roomRef(myRoomCode));
  const players = Object.values(room.players);
  const config = room.config;
  const prevHand = room.hand;
  const handNumber = (prevHand?.number || 0) + 1;

  const activePlayers = players.filter(p => p.chips > 0 && p.isActive !== false && !p.sitOut);
  if (activePlayers.length < 2) { showToast('籌碼不足或玩家不足，請先補充籌碼或回座', 'info'); return; }

  // 莊家輪換
  let dealerIdx = prevHand?.dealerIndex ?? 0;
  dealerIdx = nextActiveIdx(dealerIdx, players);

  const n = players.length;
  const sbIdx = nextActiveIdx(dealerIdx, players);
  const bbIdx = nextActiveIdx(sbIdx, players);
  const firstActIdx = nextActiveIdx(bbIdx, players);

  const sb = config.smallBlind;
  const bb = config.bigBlind;

  // 建立座位（已離開、暫離或無籌碼的玩家直接標為棄牌）
  const seats = {};
  players.forEach((p, i) => {
    const canPlay = p.chips > 0 && p.isActive !== false && !p.sitOut;
    seats[i] = { bet: 0, totalBetInHand: 0, status: canPlay ? 'active' : 'folded', hasActed: false };
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

  // BB Ante（Natural8 Cash Game 規則：BB 額外付前注入底池）
  let antePot = 0;
  if (config.bbAnte && updatedPlayers[bbIdx].chips > 0) {
    const anteAmt = Math.min(bb, updatedPlayers[bbIdx].chips);
    updatedPlayers[bbIdx].chips -= anteAmt;
    seats[bbIdx].totalBetInHand += anteAmt;
    antePot = anteAmt;
    if (updatedPlayers[bbIdx].chips === 0) seats[bbIdx].status = 'allin';
  }

  let currentBet = bbActual;
  let lastRaiseSize = bb;
  let actionIdx = firstActIdx;

  // Straddle：UTG 自動抓頭 2×BB（需 3 人以上、UTG 不是盲注位）
  let straddleIdx = null;
  if (config.straddle) {
    const utg = nextActiveIdx(bbIdx, players);
    if (utg !== sbIdx && utg !== bbIdx && utg !== dealerIdx && updatedPlayers[utg].chips > 0) {
      const stAmt = Math.min(2 * bb, updatedPlayers[utg].chips);
      updatedPlayers[utg].chips -= stAmt;
      seats[utg].bet = stAmt;
      seats[utg].totalBetInHand = stAmt;
      seats[utg].hasActed = false; // 抓頭者保留行動選擇權
      if (updatedPlayers[utg].chips === 0) seats[utg].status = 'allin';
      straddleIdx = utg;
      currentBet = Math.max(currentBet, stAmt);
      if (stAmt === 2 * bb) lastRaiseSize = 2 * bb; // 最小加注跟著抓頭額
      actionIdx = nextActiveIdx(utg, players);
    }
  }

  // 發牌
  const deck = shuffleDeck();
  let deckIdx = 0;
  const activeIndices = players.map((_, i) => i).filter(i => players[i].chips > 0 && players[i].isActive !== false && !players[i].sitOut);
  const holeCards = {};
  activeIndices.forEach(i => {
    holeCards[i] = [deck[deckIdx++], deck[deckIdx++]];
  });
  // 預先切出 5 張公共牌（翻牌時才逐步揭露）
  const allCommunity = [deck[deckIdx++], deck[deckIdx++], deck[deckIdx++], deck[deckIdx++], deck[deckIdx++]];

  const hand = {
    number: handNumber,
    dealerIndex: dealerIdx,
    pot: antePot,
    round: 'preflop',
    currentBet,
    lastRaiseSize,
    actionIndex: actionIdx,
    actionStart: Date.now(),
    bigBlind: bb,
    ...(straddleIdx !== null ? { straddleIndex: straddleIdx } : {}),
    seats,
    holeCards,
    allCommunity,
    communityCards: []
  };

  // 開新局時清空上一局的丟擲/表情事件，並裁剪過長的聊天紀錄
  const finalUpdate = { players: updatedPlayers, hand, reactions: null };
  const chatKeys = Object.keys(room.chat || {}).sort();
  if (chatKeys.length > 60) {
    chatKeys.slice(0, chatKeys.length - 40).forEach(k => { finalUpdate[`chat/${k}`] = null; });
  }
  await dbUpdate(roomRef(myRoomCode), finalUpdate);
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

  // 超過基本秒數的部分從時間銀行扣除
  if (hand.actionStart) {
    const elapsed = (Date.now() - hand.actionStart) / 1000;
    if (elapsed > ACTION_SECONDS) {
      const used = Math.ceil(elapsed - ACTION_SECONDS);
      const bank = players[myPlayerIndex].timeBank ?? TIME_BANK_SECONDS;
      updates[`players/${myPlayerIndex}/timeBank`] = Math.max(0, bank - used);
    }
  }

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

  await dbUpdate(handRef(myRoomCode), { actionIndex: next, actionStart: Date.now() });
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
  // 翻牌後首位行動者：dealer 後第一位「尚未棄牌」的玩家
  const firstAct = nextActionIdx(hand.dealerIndex, hand.seats, players.length);
  if (firstAct === null) { await goToShowdown(); return; }
  updates['hand/actionIndex'] = firstAct;
  updates['hand/actionStart'] = Date.now();

  // 揭露公共牌
  const allCom = hand.allCommunity || [];
  if (nextRound === 'flop')  updates['hand/communityCards'] = allCom.slice(0, 3);
  if (nextRound === 'turn')  updates['hand/communityCards'] = allCom.slice(0, 4);
  if (nextRound === 'river') updates['hand/communityCards'] = allCom.slice(0, 5);

  // 若所有玩家都全下，跳到 showdown（先揭露所有公共牌）
  const active = Object.values(seats).filter(s => s.status === 'active');
  if (active.length === 0) {
    await dbUpdate(roomRef(myRoomCode), { 'hand/communityCards': allCom.slice(0, 5) });
    await goToShowdown();
    return;
  }

  await dbUpdate(roomRef(myRoomCode), updates);
}

async function goToShowdown() {
  const room = await dbGet(roomRef(myRoomCode));
  const hand = room.hand;
  if (hand?.autoAwarded) return; // 防止重複結算

  const players = Object.values(room.players);
  const seats = hand.seats;
  const seatsArr = Object.values(seats);
  const communityCards = hand.allCommunity || [];

  const notFolded = seatsArr.filter(s => s.status !== 'folded');

  // 只有 2+ 人未棄牌且公共牌齊全時才做牌力評估
  const evaluations = {};
  if (notFolded.length >= 2 && communityCards.length >= 5) {
    Object.entries(seats).forEach(([i, s]) => {
      if (s.status !== 'folded' && hand.holeCards?.[i]) {
        try { evaluations[i] = bestHand(hand.holeCards[i], communityCards); }
        catch(e) { console.warn('eval error player', i, e); }
      }
    });
  }

  // 邊池計算
  const pots = calcAllSidePots(seatsArr);

  // 每個底池找贏家
  const chipUpdates = {};
  players.forEach((p, i) => { chipUpdates[i] = p.chips; });
  const awards = {};

  pots.forEach((pot, pi) => {
    const { amount, eligible } = pot;
    if (!eligible.length) return;

    let winners;
    if (eligible.length === 1 || !Object.keys(evaluations).length) {
      winners = [eligible[0]];
    } else {
      let bestEval = null;
      winners = [];
      eligible.forEach(idx => {
        const ev = evaluations[idx];
        if (!ev) return;
        const cmp = bestEval ? compareHands(ev, bestEval) : 1;
        if (cmp > 0) { bestEval = ev; winners = [idx]; }
        else if (cmp === 0) { winners.push(idx); }
      });
      if (!winners.length) winners = [eligible[0]];
    }

    const share = Math.floor(amount / winners.length);
    const rem   = amount % winners.length;
    winners.forEach((idx, wi) => {
      chipUpdates[idx] = (chipUpdates[idx] || 0) + share + (wi === 0 ? rem : 0);
    });
    awards[pi] = winners.length === 1 ? winners[0] : winners;
  });

  const updates = {};
  Object.entries(chipUpdates).forEach(([i, chips]) => {
    updates[`players/${i}/chips`] = chips;
  });
  updates['hand/awards']       = awards;
  updates['hand/round']        = 'showdown';
  // 只有 2 人以上攤牌才翻開整副公共牌；棄牌獲勝保留現狀（可用兔子洞偷看）
  updates['hand/communityCards'] = notFolded.length >= 2 ? communityCards : (hand.communityCards || []);
  updates['hand/autoAwarded']  = true;

  if (Object.keys(evaluations).length) {
    const evalStore = {};
    Object.entries(evaluations).forEach(([i, e]) => {
      evalStore[i] = { name: e.name, value: e.value };
    });
    updates['hand/evaluations'] = evalStore;
  }

  await dbUpdate(roomRef(myRoomCode), updates);

  // 寫入歷史
  const totalPot = pots.reduce((s, p) => s + p.amount, 0);
  const mainWinnerRaw = awards[0];
  const mainWinner = Array.isArray(mainWinnerRaw) ? mainWinnerRaw[0] : mainWinnerRaw;
  const historyEntry = {
    handNumber: hand.number,
    potSize: totalPot,
    winnerIndex: mainWinner,
    chipsAfter: Object.values(chipUpdates)
  };
  await dbPush(historyRef(myRoomCode), historyEntry);
}

// ── 攤牌動畫（在本地 Firebase 監聽觸發時執行）──
function triggerShowdownAnimations(room, hand) {
  const seats = hand.seats || {};
  const awards = hand.awards || {};
  const players = Object.values(room.players);

  Object.entries(awards).forEach(([pi, winnerRaw]) => {
    const winners = Array.isArray(winnerRaw) ? winnerRaw : [winnerRaw];
    winners.forEach(idx => {
      const name = players[idx]?.name || `玩家${idx+1}`;
      const handName = hand.evaluations?.[idx]?.name || '';
      const split = winners.length > 1 ? '（平分）' : '';
      showToast(`🏆 ${name}${handName ? ` — ${handName}` : ''}${split} 贏了！`, 'info');

      const wasAllin = seats[idx]?.status === 'allin';
      if (wasAllin) showFireworks();
    });

    // 輸家動畫（本底池有資格但沒贏的人）
    const pots = calcAllSidePots(Object.values(seats));
    const eligible = pots[+pi]?.eligible || [];
    const losers = eligible.filter(i => !winners.includes(i));
    if (losers.length) showLoserText(losers);
  });
}

// ── 自動開始下一局（transaction 防止多客戶端同時觸發）──
async function autoStartNextHand(expectedHandNum) {
  try {
    let canStart = false;
    await dbTransaction(handRef(myRoomCode), (hand) => {
      if (!hand) return;          // null → abort transaction
      if (hand.number !== expectedHandNum) return; // 已有新局
      if (hand.nextHandClaimed) return;             // 已被其他客戶端搶先
      hand.nextHandClaimed = true;
      canStart = true;
      return hand;
    });
    if (canStart) await startHand();
  } catch (e) {
    console.warn('autoStartNextHand transaction error:', e);
  }
}

// ── 行動計時器（Natural8 風格：15 秒 + 時間銀行）──────────
function timerTick() {
  const room = currentRoom;
  const hand = room?.hand;
  if (!room || room.status !== 'playing' || !hand || hand.round === 'showdown'
      || hand.autoAwarded || !hand.actionStart) { updateTimerUI(null); return; }
  const idx = hand.actionIndex;
  const seat = hand.seats?.[idx];
  if (!seat || seat.status !== 'active') { updateTimerUI(null); return; }

  const players = Object.values(room.players || {});
  const bank = players[idx]?.timeBank ?? TIME_BANK_SECONDS;
  const elapsed = (Date.now() - hand.actionStart) / 1000;

  updateTimerUI({
    baseLeft:  ACTION_SECONDS - elapsed,
    bankLeft:  ACTION_SECONDS + bank - elapsed,
    bank,
    baseTotal: ACTION_SECONDS,
  });

  // 基本時間 + 時間銀行皆用完 → 強制行動
  if (ACTION_SECONDS + bank - elapsed <= 0 && !timeoutHandling) {
    timeoutHandling = true;
    // 行動者自己的裝置立即執行；其他裝置延遲後代打（避免競態）
    const grace = idx === myPlayerIndex ? 0 : 1500 + (myPlayerIndex || 0) * 400;
    const hn = hand.number, as = hand.actionStart;
    setTimeout(async () => {
      try { await forceTimeoutAction(idx, hn, as); }
      catch (e) { console.warn('超時處理錯誤:', e); }
      finally { timeoutHandling = false; }
    }, grace);
  }
}

async function forceTimeoutAction(idx, expectedHandNumber, expectedActionStart) {
  if (!myRoomCode) return;
  const room = await dbGet(roomRef(myRoomCode));
  const hand = room?.hand;
  // 驗證狀態未變（沒有新局、沒人已代打、玩家沒有及時行動）
  if (!hand || hand.round === 'showdown' || hand.autoAwarded) return;
  if (hand.number !== expectedHandNumber) return;
  if (hand.actionIndex !== idx) return;
  if (hand.actionStart !== expectedActionStart) return;
  const seat = hand.seats?.[idx];
  if (!seat || seat.status !== 'active' || seat.hasActed) return;

  const players = Object.values(room.players || {});
  const bank = players[idx]?.timeBank ?? TIME_BANK_SECONDS;
  const elapsed = (Date.now() - hand.actionStart) / 1000;
  if (elapsed < ACTION_SECONDS + bank) return;

  // 可過牌就過牌，否則棄牌；並自動標記暫離（N8 規則）
  const callAmount = (hand.currentBet || 0) - (seat.bet || 0);
  const updates = {
    [`players/${idx}/timeBank`]: 0,
    [`players/${idx}/sitOut`]: true,
    [`hand/seats/${idx}/hasActed`]: true,
  };
  if (callAmount > 0) updates[`hand/seats/${idx}/status`] = 'folded';
  await dbUpdate(roomRef(myRoomCode), updates);

  const name = players[idx]?.name || `玩家${idx + 1}`;
  showToast(`⏰ ${name} 超時，自動${callAmount > 0 ? '棄牌' : '過牌'}並暫離`, 'info');
  await advanceTurn();
}

// ── 兔子洞：同步給全桌看沒發完的牌 ────────────────────────
async function revealRabbit() {
  if (!myRoomCode) return;
  try { await dbUpdate(handRef(myRoomCode), { rabbitRevealed: true }); }
  catch (e) { console.warn('rabbit error:', e); }
}

// ── 亮牌嘲諷：棄牌獲勝者秀底牌給全桌 ──────────────────────
async function revealShowBluff(which) {
  const hand = currentRoom?.hand;
  const my = hand?.holeCards?.[myPlayerIndex];
  if (!my || !myRoomCode) return;
  const cards = which === 'both' ? my : [my[+which]];
  try { await dbUpdate(handRef(myRoomCode), { showBluff: { from: myPlayerIndex, cards } }); }
  catch (e) { console.warn('showBluff error:', e); }
}

// ── 丟擲選單 ──────────────────────────────────────────────
function openThrowMenu(seatEl, idx) {
  throwTargetIdx = idx;
  const menu = document.getElementById('throw-menu');
  menu.classList.remove('hidden');
  const r = seatEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 160;
  let x = r.left + r.width / 2 - mw / 2;
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  let y = r.bottom + 6;
  if (y > innerHeight - 64) y = r.top - 50;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideThrowMenu() {
  throwTargetIdx = null;
  document.getElementById('throw-menu').classList.add('hidden');
}

// ── 補充籌碼 ──────────────────────────────────────────────
async function handleRebuy(playerIndex) {
  const room = await dbGet(roomRef(myRoomCode));
  const startingChips = room.config.startingChips;
  const name = room.players[playerIndex]?.name || `玩家${playerIndex + 1}`;
  await dbUpdate(roomRef(myRoomCode), {
    [`players/${playerIndex}/chips`]: startingChips,
    [`players/${playerIndex}/isActive`]: true
  });
  showToast(`${name} 補充 ${startingChips.toLocaleString()} 籌碼`, 'info');
}

// ── 離開房間 ──────────────────────────────────────────────
function onLeaveRoom() {
  // 捕捉離開前的狀態
  const code = myRoomCode;
  const idx  = myPlayerIndex;
  const hand = currentRoom?.hand;

  // 立即停止監聽並跳回首頁
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  clearTimeout(autoStartTimer);
  autoStartTimer = null;
  autoAdvancing = false;
  timeoutHandling = false;
  rabbitSeen = false;
  clearLocal();
  myRoomCode    = null;
  myPlayerIndex = null;
  currentRoom   = null;
  lastHandNumber = null;
  showPhase('home');

  // 在背景更新 Firebase（不阻塞 UI）
  if (!code || idx === null) return;
  (async () => {
    try {
      const updates = { [`players/${idx}/isActive`]: false };

      // 若仍在對局中且該玩家尚未棄牌，標記為棄牌
      if (hand && hand.round !== 'showdown' && hand.seats?.[idx]?.status === 'active') {
        updates[`hand/seats/${idx}/status`]   = 'folded';
        updates[`hand/seats/${idx}/hasActed`] = true;
      }

      await dbUpdate(roomRef(code), updates);
    } catch (e) {
      console.warn('離開房間寫入錯誤:', e);
    }
  })();
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
    if (players[i]?.chips > 0 && players[i]?.isActive !== false && !players[i]?.sitOut) return i;
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

// ── 頭像工具 ──────────────────────────────────────────────
function setupAvatarPicker(inputId, previewId, onReady) {
  const input = document.getElementById(inputId);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const b64 = await resizeImageToBase64(file);
    if (b64) {
      onReady(b64);
      const preview = document.getElementById(previewId);
      preview.innerHTML = `<img src="${b64}" alt="">`;
    }
    input.value = '';
  });
}

function resetAvatarPreview(previewId) {
  const preview = document.getElementById(previewId);
  if (preview) preview.innerHTML = '📷';
}

function resizeImageToBase64(file) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.65));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// 啟動
init();
