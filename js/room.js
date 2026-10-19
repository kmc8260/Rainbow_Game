// ============================================================
// room.js
// room.html?id=<room_id> 전용 로직.
// 1) 방 정보 + 참가자 목록 (실시간 반영)
// 2) 호스트만 "Start Game" 가능 (deal-cards 함수 호출)
// 3) 하트비트: 내가 아직 접속해있다는 신호를 주기적으로 보냄
// 4) 탭을 닫거나 "Leave Room"을 누르면 즉시 퇴장 처리 + 방이 비면 자동 삭제
// ============================================================

const roomId = new URLSearchParams(window.location.search).get("id");

const roomNameEl = document.getElementById("room-name");
const roomMetaEl = document.getElementById("room-meta");
const roomCodeBadge = document.getElementById("room-code-badge");
const roomCodeValue = document.getElementById("room-code-value");
const playerGrid = document.getElementById("player-grid");
const startGameBtn = document.getElementById("start-game-btn");
const waitingText = document.getElementById("waiting-text");
const leaveRoomBtn = document.getElementById("leave-room-btn");
const roomError = document.getElementById("room-error");
const logoutBtn = document.getElementById("logout-btn");

let currentUserId = null;
let currentRoom = null;
let accessToken = null;
let heartbeatTimer = null;

// ============================================================
// 초기화
// ============================================================

async function initRoom() {
  if (!roomId) {
    roomError.textContent = "Invalid room link.";
    return;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    window.location.href = "Login.html";
    return;
  }

  currentUserId = session.user.id;
  accessToken = session.access_token;

  await loadRoom();
  await loadPlayers();
  subscribeToRoomChanges();
  startHeartbeat();
  registerLeaveOnClose();
}

// ============================================================
// 하트비트: 15초마다 "나 아직 여기 있어요" 신호
// ============================================================

function startHeartbeat() {
  const beat = () => {
    supabaseClient
      .from("room_players")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", currentUserId);
  };
  beat();
  heartbeatTimer = setInterval(beat, 15000);
}

// 탭을 닫거나 새로고침해도 최대한 즉시 반영되도록 (완벽히 보장되진 않음 -> 하트비트가 보완)
function registerLeaveOnClose() {
  window.addEventListener("pagehide", () => {
    fetch(
      `${SUPABASE_URL}/rest/v1/room_players?room_id=eq.${roomId}&user_id=eq.${currentUserId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        keepalive: true,
      },
    );
  });
}

// ============================================================
// 방 정보
// ============================================================

async function loadRoom() {
  const { data: room, error } = await supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (error || !room) {
    roomNameEl.textContent = "Room not found";
    return;
  }

  currentRoom = room;
  renderRoomHeader(room);

  if (room.status === "playing") {
    goToGameTable();
  }
}

function renderRoomHeader(room) {
  roomNameEl.textContent = room.room_name;
  roomMetaEl.textContent = room.is_private ? "Private room" : "Public room";

  if (room.is_private) {
    roomCodeBadge.hidden = false;
    roomCodeValue.textContent = room.room_code;
  }
}

// ============================================================
// 참가자 목록
// ============================================================

async function loadPlayers() {
  const { data: players, error } = await supabaseClient
    .from("room_players")
    .select("user_id, seat_order, profiles(nickname)")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (error) {
    playerGrid.innerHTML = `<p class="room-empty-text">Failed to load players.</p>`;
    return;
  }

  renderPlayers(players);
  updateControls(players);
}

function renderPlayers(players) {
  const maxSlots = currentRoom ? currentRoom.max_players : 4;
  const cards = players.map((p) => {
    const nickname = p.profiles?.nickname ?? "Unknown";
    const isHost = currentRoom && p.user_id === currentRoom.host_id;
    return `
      <div class="player-card ${isHost ? "is-host" : ""}">
        <div class="player-avatar">${nickname.charAt(0).toUpperCase()}</div>
        <div class="player-name">${escapeHtml(nickname)}</div>
        <div class="player-role">${isHost ? "Host" : "Player"}</div>
      </div>
    `;
  });

  const emptySlots = Math.max(0, maxSlots - players.length);
  for (let i = 0; i < emptySlots; i++) {
    cards.push(`
      <div class="player-card player-slot empty">
        <div class="player-name">Empty</div>
      </div>
    `);
  }

  playerGrid.innerHTML = cards.join("");
}

function updateControls(players) {
  const isHost = currentRoom && currentRoom.host_id === currentUserId;
  const enoughPlayers = players.length >= 2;

  if (isHost) {
    startGameBtn.hidden = false;
    startGameBtn.disabled = !enoughPlayers;
    startGameBtn.textContent = enoughPlayers
      ? "Start Game"
      : "Waiting for more players...";
    waitingText.hidden = true;
  } else {
    startGameBtn.hidden = true;
    waitingText.hidden = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 실시간 반영
// ============================================================

function subscribeToRoomChanges() {
  supabaseClient
    .channel(`room-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_players",
        filter: `room_id=eq.${roomId}`,
      },
      () => loadPlayers(),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "game_rooms",
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        currentRoom = payload.new;
        if (currentRoom.status === "playing") goToGameTable();
      },
    )
    .subscribe();
}

// ============================================================
// 게임 시작 (호스트 전용) - 카드 배분은 서버(Edge Function)에서만 처리
// ============================================================

startGameBtn.addEventListener("click", async () => {
  startGameBtn.disabled = true;
  startGameBtn.textContent = "Starting...";

  const { error } = await supabaseClient.functions.invoke("deal-cards", {
    body: { room_id: roomId },
  });

  if (error) {
    roomError.textContent = "Failed to start game: " + error.message;
    startGameBtn.disabled = false;
    startGameBtn.textContent = "Start Game";
    return;
  }

  goToGameTable();
});

function goToGameTable() {
  window.location.href = `table.html?id=${roomId}`;
}

// ============================================================
// 나가기 / 로그아웃
// ============================================================

leaveRoomBtn.addEventListener("click", async () => {
  clearInterval(heartbeatTimer);

  await supabaseClient
    .from("room_players")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", currentUserId);

  // 방이 비었으면(또는 내가 호스트면) 자동으로 삭제됨 - RLS가 조건을 안 만족하면 그냥 0건 삭제되고 끝남
  await supabaseClient.from("game_rooms").delete().eq("id", roomId);

  window.location.href = "Main.html";
});

logoutBtn.addEventListener("click", async () => {
  clearInterval(heartbeatTimer);
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

initRoom();
