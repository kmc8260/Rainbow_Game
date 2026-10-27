// ============================================================
// table.js
// table.html?id=<room_id> 전용 로직.
// game_rooms / room_players를 realtime으로 구독해서 화면을 갱신함.
// ============================================================

const roomId = new URLSearchParams(window.location.search).get("id");

const roundNumber = document.getElementById("round-number");
const myChipTotal = document.getElementById("my-chip-total");
const dealerSlots = document.getElementById("dealer-slots");
const myCardSlots = document.getElementById("my-card-slots");
const opponentCardSlots = document.getElementById("opponent-card-slots");
const potAmount = document.getElementById("pot-amount");
const extraOpponents = document.getElementById("extra-opponents");
const resultOverlay = document.getElementById("result-overlay");
const resultTitle = document.getElementById("result-title");
const resultRound = document.getElementById("result-round");
const resultAmount = document.getElementById("result-amount");
const actionPanel = document.getElementById("action-panel");
const betAmountInput = document.getElementById("bet-amount");
const betMinLabel = document.getElementById("bet-min-label");
const dieBtn = document.getElementById("die-btn");
const betBtn = document.getElementById("bet-btn");
const allinBtn = document.getElementById("allin-btn");
const tableStatusText = document.getElementById("table-status-text");
const tableError = document.getElementById("table-error");
const nextRoundBtn = document.getElementById("next-round-btn");
const leaveTableBtn = document.getElementById("leave-table-btn");
const logoutBtn = document.getElementById("logout-btn");

const OPENING_BET = 50; // 서버(place-bet)의 OPENING_BET과 같은 값

let currentUserId = null;
let isHost = false;
let lastRoundId = null;
let myHand = [];
let nicknameMap = {};
let roundCount = 1;
let panelShown = false; // 내 턴이 새로 시작될 때만 입력칸을 최소 금액으로 채우기 위한 플래그

// ============================================================
// 초기화
// ============================================================

async function initTable() {
  if (!roomId) {
    tableError.textContent = "Invalid table link.";
    return;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    window.location.href = "Login.html";
    return;
  }
  currentUserId = session.user.id;

  await loadNicknames();
  await refreshRoom();
  subscribeToUpdates();
}

async function loadNicknames() {
  const { data } = await supabaseClient
    .from("room_players")
    .select("user_id, profiles(nickname)")
    .eq("room_id", roomId);

  (data ?? []).forEach((row) => {
    nicknameMap[row.user_id] = row.profiles?.nickname ?? "Player";
  });
}

// ============================================================
// 방 상태 갱신 (실시간 이벤트가 오면 다시 호출됨)
// ============================================================

async function refreshRoom() {
  const { data: room, error } = await supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (error || !room) {
    tableError.textContent = "Failed to load table.";
    return;
  }

  isHost = room.host_id === currentUserId;

  if (room.current_round_id && room.current_round_id !== lastRoundId) {
    lastRoundId = room.current_round_id;
    await loadMyHand(room.current_round_id);
  }

  renderDealerSlots(room);
  await renderPlayers(room);
  renderPotAndChips(room);

  if (room.round_status === "finished") {
    renderResult(room);
  } else {
    resultOverlay.hidden = true;
  }
}

// ============================================================
// 딜러 카드 슬롯
// ============================================================

function renderDealerSlots(room) {
  const revealed = room.dealer_revealed_cards ?? [];
  const html = [];
  for (let i = 0; i < 4; i++) {
    html.push(`<div class="dealer-slot">${revealed[i] ?? ""}</div>`);
  }
  dealerSlots.innerHTML = html.join("");
  dealerSlots.hidden = room.round_status === "finished";
}

// ============================================================
// 내 카드 / 상대 카드
// ============================================================

async function loadMyHand(roundId) {
  const { data, error } = await supabaseClient
    .from("my_cards")
    .select("cards")
    .eq("round_id", roundId)
    .maybeSingle();

  myHand = error || !data ? [] : data.cards;
}

async function renderPlayers(room) {
  const { data: players } = await supabaseClient
    .from("room_players")
    .select(
      "user_id, seat_order, is_folded, street_bet, acted_this_street, opened_card",
    )
    .eq("room_id", roomId)
    .order("seat_order", { ascending: true });

  const list = players ?? [];
  const myRow = list.find((p) => p.user_id === currentUserId);
  const opponents = list.filter((p) => p.user_id !== currentUserId);

  renderMySlots(room, myRow);
  renderOpponentSlots(room, opponents[0]);

  const extras = opponents.slice(1);
  extraOpponents.innerHTML = extras
    .map((p) => {
      const name = nicknameMap[p.user_id] ?? "Player";
      const status = p.is_folded ? "Folded" : `Bet: ${p.street_bet}`;
      return `<div class="extra-opponent-card">${escapeHtml(name)}<br />${status}</div>`;
    })
    .join("");

  updateActionPanel(room, myRow);
}

function renderMySlots(room, myRow) {
  const opened = myRow ? myRow.opened_card : null;
  const canSelect = room.round_status === "opening" && opened === null;

  myCardSlots.innerHTML = myHand
    .map((c, i) => {
      const isOpened = c === opened;
      const cls = canSelect ? "card-selectable" : isOpened ? "card-opened" : "";
      return `<div class="seat-card-slot ${cls}" data-index="${i}">${c}</div>`;
    })
    .join("");

  if (canSelect) {
    myCardSlots.querySelectorAll(".card-selectable").forEach((el) => {
      el.addEventListener("click", () => openCard(Number(el.textContent)));
    });
  }
}

function renderOpponentSlots(room, opponent) {
  if (!opponent) {
    opponentCardSlots.innerHTML = "";
    return;
  }

  const html = [];
  for (let i = 0; i < 3; i++) {
    // 선 정하기 단계에서 상대가 공개한 카드 1장은 첫 슬롯에 표시
    if (
      room.round_status !== "finished" &&
      i === 0 &&
      opponent.opened_card !== null
    ) {
      html.push(
        `<div class="seat-card-slot card-opened">${opponent.opened_card}</div>`,
      );
    } else {
      html.push(`<div class="seat-card-slot" data-slot="${i}"></div>`);
    }
  }
  opponentCardSlots.innerHTML = html.join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 팟 / 내 칩
// ============================================================

async function renderPotAndChips(room) {
  potAmount.textContent = room.pot.toLocaleString();

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("chips")
    .eq("id", currentUserId)
    .single();

  myChipTotal.textContent = (profile?.chips ?? 0).toLocaleString();
}

// ============================================================
// 액션 패널 (Die / Betting / All in)
// ============================================================

function updateActionPanel(room, myRow) {
  if (room.round_status === "opening") {
    actionPanel.hidden = true;
    panelShown = false;
    tableStatusText.textContent =
      myRow && myRow.opened_card === null
        ? "Choose one card to open."
        : "Waiting for everyone to open a card...";
    return;
  }

  const myTurn =
    room.round_status === "betting" &&
    room.current_turn_user_id === currentUserId;

  if (room.round_status === "betting" && myRow && !myRow.is_folded && myTurn) {
    actionPanel.hidden = false;
    tableStatusText.textContent = "";

    // 이번 스트리트 첫 베팅 금액 이상이어야 함 (아직 아무도 안 걸었으면 최소 50)
    const minBet =
      room.street_base_bet > 0 ? room.street_base_bet : OPENING_BET;
    betAmountInput.min = String(minBet);
    betMinLabel.textContent = `Min ${minBet}`;

    // 내 턴이 새로 시작됐을 때만 최소 금액으로 채움 (입력 중인 값이 실시간 갱신으로 덮어써지지 않게)
    if (!panelShown || Number(betAmountInput.value) < minBet) {
      betAmountInput.value = String(minBet);
    }
    panelShown = true;
  } else {
    actionPanel.hidden = true;
    panelShown = false;
    tableStatusText.textContent =
      room.round_status === "betting" ? "Waiting for other players..." : "";
  }
}

async function sendAction(action, extra) {
  tableError.textContent = "";
  dieBtn.disabled = true;
  betBtn.disabled = true;
  allinBtn.disabled = true;

  const { data, error } = await supabaseClient.functions.invoke("place-bet", {
    body: { room_id: roomId, action, ...extra },
  });

  dieBtn.disabled = false;
  betBtn.disabled = false;
  allinBtn.disabled = false;

  if (error) {
    // 서버가 보낸 에러 메시지(예: "Minimum bet is 100.")를 읽어서 보여줌
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_) {}
    tableError.textContent = message;
  }
  // 성공하면 realtime 이벤트로 화면이 자동 갱신됨
}

dieBtn.addEventListener("click", () => sendAction("fold"));
betBtn.addEventListener("click", () =>
  sendAction("bet", { amount: Number(betAmountInput.value) }),
);
allinBtn.addEventListener("click", () => sendAction("bet", { all_in: true }));

async function openCard(cardValue) {
  tableError.textContent = "";
  const { error } = await supabaseClient.functions.invoke("place-bet", {
    body: { room_id: roomId, action: "open_card", card: cardValue },
  });
  if (error) {
    tableError.textContent = "Failed to open card: " + error.message;
  }
}

// ============================================================
// 결과 (쇼다운)
// ============================================================

async function renderResult(room) {
  resultOverlay.hidden = false;

  const iWon = (room.winner_ids ?? []).includes(currentUserId);
  const winnerNames = (room.winner_ids ?? []).map(
    (id) => nicknameMap[id] ?? "Player",
  );

  resultTitle.textContent = iWon
    ? "You Win!"
    : winnerNames.length > 0
      ? `${winnerNames.join(", ")} Wins`
      : "Round Over";

  resultRound.textContent = String(roundCount);
  resultAmount.textContent = room.pot.toLocaleString();

  // 쇼다운: 상대 카드 공개
  const { data: hands } = await supabaseClient
    .from("round_showdown")
    .select("user_id, cards")
    .eq("round_id", room.current_round_id);

  const opponentHand = (hands ?? []).find((h) => h.user_id !== currentUserId);
  if (opponentHand) {
    const slots = opponentCardSlots.querySelectorAll(".seat-card-slot");
    opponentHand.cards.forEach((c, i) => {
      if (slots[i]) {
        slots[i].textContent = c;
        slots[i].classList.add("card-opened");
      }
    });
  }

  nextRoundBtn.hidden = !isHost;
}

nextRoundBtn.addEventListener("click", async () => {
  nextRoundBtn.disabled = true;
  nextRoundBtn.textContent = "Starting...";
  roundCount += 1;

  const { error } = await supabaseClient.functions.invoke("deal-cards", {
    body: { room_id: roomId },
  });

  if (error) {
    tableError.textContent = "Failed to start next round: " + error.message;
    roundCount -= 1;
  }

  roundNumber.textContent = String(roundCount);
  nextRoundBtn.disabled = false;
  nextRoundBtn.textContent = "Next Round";
});

// ============================================================
// 실시간 구독
// ============================================================

function subscribeToUpdates() {
  supabaseClient
    .channel(`table-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "game_rooms",
        filter: `id=eq.${roomId}`,
      },
      () => refreshRoom(),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_players",
        filter: `room_id=eq.${roomId}`,
      },
      () => refreshRoom(),
    )
    .subscribe();
}

// ============================================================
// 나가기 / 로그아웃
// ============================================================

leaveTableBtn.addEventListener("click", () => {
  window.location.href = "Main.html";
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

initTable();
