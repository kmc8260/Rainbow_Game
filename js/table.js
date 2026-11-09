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
const potAmount = document.getElementById("pot-amount");
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
const streetLabel = document.getElementById("street-label");
const mySeat = document.getElementById("my-seat");
const myName = document.getElementById("my-name");
const mySeatChips = document.getElementById("my-seat-chips");
const myTag = document.getElementById("my-tag");
const opponentSeats = Array.from(document.querySelectorAll("[data-opponent-seat]"));
const seatTop = document.querySelector(".seat-top");
const seatRight = document.querySelector(".seat-right");
const seatBottom = document.querySelector(".seat-bottom");
const resultNote = document.getElementById("result-note");
const resultBadge = document.getElementById("result-badge");
const resultTrophy = document.getElementById("result-trophy");
const resultLeaveBtn = document.getElementById("result-leave-btn");
const betMinusBtn = document.getElementById("bet-minus");
const betPlusBtn = document.getElementById("bet-plus");

// skin.js의 스킨 번호와 assets/card 폴더 이름
const DECK_FOLDERS = { 1: "숫자", 2: "빵", 3: "winter" };

const OPENING_BET = 50; // 서버(place-bet)의 OPENING_BET과 같은 값
const HEARTBEAT_MS = 10000; // 접속 신호 주기
const SWEEP_MS = 20000; // 끊긴 플레이어 확인 주기

let currentUserId = null;
let isHost = false;
let currentRoundStatus = "waiting";
let seatedOpponents = []; // 화면에 앉아 있는 상대 [{ player, seat }]
let leaving = false;
let lastRoundId = null;
let myHand = [];
let nicknameMap = {};
let roundCount = 1;
let deckFolder = DECK_FOLDERS[1];
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
  await loadDeck();
  await refreshRoom();
  subscribeToUpdates();
  startPresence();
}

// 접속 신호를 보내고, 창을 그냥 닫은 사람이 있는지 서버에 확인 요청
function startPresence() {
  const beat = () => {
    supabaseClient
      .from("room_players")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", currentUserId)
      .then(({ error }) => {
        if (error) console.warn("Heartbeat failed:", error.message);
      });
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
  setInterval(() => {
    supabaseClient.functions.invoke("place-bet", {
      body: { room_id: roomId, action: "sweep" },
    });
  }, SWEEP_MS);
}

// 장착 중인 스킨의 카드 이미지를 사용
async function loadDeck() {
  const { data } = await supabaseClient
    .from("profiles")
    .select("Card_Type")
    .eq("id", currentUserId)
    .single();

  deckFolder = DECK_FOLDERS[data?.Card_Type] ?? DECK_FOLDERS[1];
}

// value가 없으면 카드 뒷면
function cardImg(value) {
  const name = value === null || value === undefined ? "Back" : value;
  const src = encodeURI(`assets/card/${deckFolder}/Card ${name}.png`);
  const alt = name === "Back" ? "Card back" : `Card ${name}`;
  return `<img class="card-img" src="${src}" alt="${alt}" draggable="false" />`;
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
  currentRoundStatus = room.round_status;

  if (room.current_round_id && room.current_round_id !== lastRoundId) {
    lastRoundId = room.current_round_id;
    await loadMyHand(room.current_round_id);
  }

  const revealedCount = (room.dealer_revealed_cards ?? []).length;
  streetLabel.textContent =
    room.round_status === "finished"
      ? "Showdown"
      : room.round_status === "opening"
        ? "Open a card"
        : `Card ${revealedCount} of 4`;

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
    html.push(`<div class="dealer-slot">${cardImg(revealed[i])}</div>`);
  }
  dealerSlots.innerHTML = html.join("");
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
  // 내가 테이블에서 빠졌으면 메인으로 (오래 끊겨서 퇴장 처리된 경우)
  if (!myRow && !leaving) {
    window.location.href = "Main.html";
    return;
  }

  assignOpponentSeats(list);
  renderMySlots(room, myRow);
  renderOpponentSlots(room);
  await renderSeatInfo(room, list, myRow);

  updateActionPanel(room, myRow);
}

// 내 다음 좌석부터 시계방향으로 상대를 배치 (나는 항상 왼쪽)
function assignOpponentSeats(players) {
  const myIndex = players.findIndex((p) => p.user_id === currentUserId);
  const ordered = players.slice(myIndex + 1).concat(players.slice(0, myIndex));
  const layout = {
    1: [seatRight],
    2: [seatTop, seatRight],
    3: [seatTop, seatRight, seatBottom],
  }[ordered.length] ?? [];

  seatedOpponents = ordered.slice(0, layout.length).map((player, i) => ({
    player,
    seat: layout[i],
  }));

  opponentSeats.forEach((seat) => {
    seat.hidden = !layout.includes(seat);
  });
}

function seatTagText(player) {
  if (!player) return "";
  if (player.is_folded) return "Folded";
  return player.street_bet > 0 ? `Bet ${player.street_bet.toLocaleString()}` : "";
}

async function renderSeatInfo(room, players, myRow) {
  const { data: rows } = await supabaseClient
    .from("profiles")
    .select("id, chips")
    .in("id", players.map((p) => p.user_id));

  const chipsOf = (id) => {
    const row = (rows ?? []).find((r) => r.id === id);
    return `${(row?.chips ?? 0).toLocaleString()} chips`;
  };
  const isBetting = room.round_status === "betting";

  myName.textContent = `${nicknameMap[currentUserId] ?? "You"} (You)`;
  mySeatChips.textContent = chipsOf(currentUserId);
  myTag.textContent = seatTagText(myRow);
  mySeat.classList.toggle("is-folded", Boolean(myRow?.is_folded));
  mySeat.classList.toggle(
    "is-turn",
    isBetting && room.current_turn_user_id === currentUserId,
  );

  seatedOpponents.forEach(({ player, seat }) => {
    seat.querySelector(".seat-name").textContent =
      nicknameMap[player.user_id] ?? "Player";
    seat.querySelector(".seat-chips").textContent = chipsOf(player.user_id);
    seat.querySelector(".seat-tag").textContent = seatTagText(player);
    seat.classList.toggle("is-folded", player.is_folded);
    seat.classList.toggle(
      "is-turn",
      isBetting && room.current_turn_user_id === player.user_id,
    );
  });
}

function renderMySlots(room, myRow) {
  const opened = myRow ? myRow.opened_card : null;
  const canSelect = room.round_status === "opening" && opened === null;

  myCardSlots.innerHTML = myHand
    .map((c, i) => {
      const isOpened = c === opened;
      const cls = canSelect ? "card-selectable" : isOpened ? "card-opened" : "";
      return `<div class="seat-card-slot ${cls}" data-index="${i}" data-value="${c}">${cardImg(c)}</div>`;
    })
    .join("");

  if (canSelect) {
    myCardSlots.querySelectorAll(".card-selectable").forEach((el) => {
      el.addEventListener("click", () => openCard(Number(el.dataset.value)));
    });
  }
}

function renderOpponentSlots(room) {
  seatedOpponents.forEach(({ player, seat }) => {
    const html = [];
    for (let i = 0; i < 3; i++) {
      // 선 정하기 단계에서 상대가 공개한 카드 1장은 첫 슬롯에 표시
      if (
        room.round_status !== "finished" &&
        i === 0 &&
        player.opened_card !== null
      ) {
        html.push(
          `<div class="seat-card-slot card-opened">${cardImg(player.opened_card)}</div>`,
        );
      } else {
        html.push(`<div class="seat-card-slot" data-slot="${i}">${cardImg(null)}</div>`);
      }
    }
    seat.querySelector(".seat-cards").innerHTML = html.join("");
  });
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
    betMinLabel.textContent = `Minimum bet ${minBet.toLocaleString()}`;

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
betMinusBtn.addEventListener("click", () => betAmountInput.stepDown());
betPlusBtn.addEventListener("click", () => betAmountInput.stepUp());

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
  const share = Math.floor(room.pot / Math.max(1, room.winner_ids?.length ?? 1));
  resultAmount.textContent = iWon
    ? `+${share.toLocaleString()}`
    : room.pot.toLocaleString();
  resultTrophy.hidden = !iWon;

  // 쇼다운: 상대 카드 공개
  const { data: hands } = await supabaseClient
    .from("round_showdown")
    .select("user_id, cards")
    .eq("round_id", room.current_round_id);

  // 승자의 카드가 딜러 4장과 하나도 안 겹치면 레인보우 홀덤
  const dealer = room.dealer_revealed_cards ?? [];
  const winnerHand = (hands ?? []).find((h) => (room.winner_ids ?? []).includes(h.user_id));
  resultBadge.hidden = !(
    dealer.length === 4 &&
    winnerHand &&
    winnerHand.cards.every((c) => !dealer.includes(c))
  );

  seatedOpponents.forEach(({ player, seat }) => {
    const hand = (hands ?? []).find((h) => h.user_id === player.user_id);
    if (!hand) return;
    const slots = seat.querySelectorAll(".seat-card-slot");
    hand.cards.forEach((c, i) => {
      if (slots[i]) {
        slots[i].innerHTML = cardImg(c);
        slots[i].classList.add("card-opened");
      }
    });
  });

  const canContinue = seatedOpponents.length > 0;
  nextRoundBtn.hidden = !isHost || !canContinue;
  resultNote.hidden = canContinue;
}

nextRoundBtn.addEventListener("click", async () => {
  nextRoundBtn.disabled = true;
  nextRoundBtn.textContent = "Starting...";
  roundCount += 1;

  const { error } = await supabaseClient.functions.invoke("deal-cards", {
    body: { room_id: roomId },
  });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_) {}
    tableError.textContent = "Failed to start next round: " + message;
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

// 테이블 나가기: 서버가 좌석을 비우고, 진행 중이면 다이로 처리
async function leaveTable() {
  const inRound = ["opening", "betting"].includes(currentRoundStatus);
  if (inRound && !window.confirm("Leaving now counts as Die, and your bet is lost. Leave?")) {
    return false;
  }

  leaving = true;
  await supabaseClient.functions.invoke("place-bet", {
    body: { room_id: roomId, action: "leave" },
  });
  return true;
}

leaveTableBtn.addEventListener("click", async () => {
  if (await leaveTable()) window.location.href = "Main.html";
});

resultLeaveBtn.addEventListener("click", async () => {
  if (await leaveTable()) window.location.href = "Main.html";
});

logoutBtn.addEventListener("click", async () => {
  if (!(await leaveTable())) return;
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

initTable();
