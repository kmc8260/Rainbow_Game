// ============================================================
// game.js
// game.html 전용 로직.
// 1) 방 만들기 (공개/비밀)
// 2) 코드로 비밀방 입장
// 3) 공개방 목록 표시 및 입장
// ============================================================

let currentVisibility = "public";
let currentUserId = null;

const btnPublic = document.getElementById("btn-public");
const btnPrivate = document.getElementById("btn-private");
const visibilityDesc = document.getElementById("visibility-desc");
const roomNameInput = document.getElementById("room-name");
const createRoomBtn = document.getElementById("create-room-btn");
const createError = document.getElementById("create-error");

const roomCodeInput = document.getElementById("room-code-input");
const joinCodeBtn = document.getElementById("join-code-btn");
const joinError = document.getElementById("join-error");

const roomListEl = document.getElementById("room-list");
const logoutBtn = document.getElementById("logout-btn");

const VISIBILITY_TEXT = {
  public: "Anyone can join this room directly from the room list.",
  private:
    "A 6-digit code will be generated. Only people with the code can join.",
};

// ============================================================
// 공개/비밀 토글
// ============================================================

function setVisibility(value) {
  currentVisibility = value;
  btnPublic.classList.toggle("active", value === "public");
  btnPrivate.classList.toggle("active", value === "private");
  visibilityDesc.textContent = VISIBILITY_TEXT[value];
}

btnPublic.addEventListener("click", () => setVisibility("public"));
btnPrivate.addEventListener("click", () => setVisibility("private"));

// ============================================================
// 방 만들기
// ============================================================

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // O/0, I/1 제외 (헷갈림 방지)
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

createRoomBtn.addEventListener("click", handleCreateRoom);

async function handleCreateRoom() {
  createError.textContent = "";
  setButtonLoading(createRoomBtn, true, "Creating...");

  const roomName = roomNameInput.value.trim() || "Rainbow Holdem Room";
  const isPrivate = currentVisibility === "private";
  const roomCode = generateRoomCode();

  const { data: room, error } = await supabaseClient
    .from("game_rooms")
    .insert({
      room_name: roomName,
      host_id: currentUserId,
      is_private: isPrivate,
      room_code: roomCode,
      status: "waiting",
    })
    .select()
    .single();

  setButtonLoading(createRoomBtn, false, "Create Room");

  if (error) {
    createError.textContent = "Failed to create room: " + error.message;
    return;
  }

  // 호스트도 참가자로 등록
  await supabaseClient.from("room_players").insert({
    room_id: room.id,
    user_id: currentUserId,
    seat_order: 0,
  });

  if (isPrivate) {
    showRoomCodeReveal(room);
  } else {
    goToRoom(room.id);
  }
}

function showRoomCodeReveal(room) {
  const existing = document.querySelector(".room-code-reveal");
  if (existing) existing.remove();

  const box = document.createElement("div");
  box.className = "room-code-reveal";
  box.innerHTML = `
    <div class="code-label">Share this code with your friend</div>
    <div class="code-value">${room.room_code}</div>
  `;

  const enterBtn = document.createElement("button");
  enterBtn.className = "submit-btn";
  enterBtn.style.marginTop = "14px";
  enterBtn.textContent = "Go to Room";
  enterBtn.addEventListener("click", () => goToRoom(room.id));
  box.appendChild(enterBtn);

  createRoomBtn.closest(".lobby-panel").appendChild(box);
}

// ============================================================
// 코드로 입장
// ============================================================

joinCodeBtn.addEventListener("click", handleJoinByCode);

async function handleJoinByCode() {
  joinError.textContent = "";
  const code = roomCodeInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    joinError.textContent = "Please enter a valid 6-digit code.";
    return;
  }

  setButtonLoading(joinCodeBtn, true, "Checking...");

  const { data: room, error } = await supabaseClient
    .from("game_rooms")
    .select("*")
    .eq("room_code", code)
    .eq("status", "waiting")
    .maybeSingle();

  setButtonLoading(joinCodeBtn, false, "Join");

  if (error || !room) {
    joinError.textContent = "Room not found or already started.";
    return;
  }

  const joined = await joinRoom(room.id);
  if (joined) goToRoom(room.id);
}

// ============================================================
// 공개방 목록
// ============================================================

async function loadPublicRooms() {
  const { data: rooms, error } = await supabaseClient
    .from("game_rooms")
    .select("id, room_name, max_players, created_at")
    .eq("is_private", false)
    .eq("status", "waiting")
    .order("created_at", { ascending: false });

  if (error) {
    roomListEl.innerHTML = `<p class="room-empty-text">Failed to load room list.</p>`;
    return;
  }

  if (!rooms || rooms.length === 0) {
    roomListEl.innerHTML = `<p class="room-empty-text">No public rooms right now. Create one!</p>`;
    return;
  }

  const rows = await Promise.all(rooms.map(renderRoomRow));
  roomListEl.innerHTML = rows.join("");

  roomListEl.querySelectorAll(".room-row-join-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const roomId = btn.dataset.roomId;
      setButtonLoading(btn, true, "Joining...");

      const joined = await joinRoom(roomId);
      if (joined) {
        goToRoom(roomId);
      } else {
        setButtonLoading(btn, false, "Join");
      }
    });
  });
}

async function renderRoomRow(room) {
  const { count } = await supabaseClient
    .from("room_players")
    .select("*", { count: "exact", head: true })
    .eq("room_id", room.id);

  return `
    <div class="room-row">
      <div>
        <div class="room-row-name">${escapeHtml(room.room_name)}</div>
        <div class="room-row-meta">${count ?? 0} / ${room.max_players} players</div>
      </div>
      <button class="room-row-join-btn" data-room-id="${room.id}">Join</button>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 공용 유틸
// ============================================================

async function joinRoom(roomId) {
  const { error } = await supabaseClient.from("room_players").insert({
    room_id: roomId,
    user_id: currentUserId,
  });

  // 이미 참가중인 경우(unique 제약 위반)는 에러로 취급하지 않고 그냥 이동시켜줌
  if (error && !error.message.includes("duplicate")) {
    alert("Failed to join room: " + error.message);
    return false;
  }
  return true;
}

function goToRoom(roomId) {
  window.location.href = `room.html?id=${roomId}`;
}

function setButtonLoading(button, isLoading, text) {
  button.disabled = isLoading;
  button.textContent = text;
}

// ============================================================
// 초기화
// ============================================================

async function initLobby() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    window.location.href = "Login.html";
    return;
  }

  currentUserId = session.user.id;
  await loadPublicRooms();
}

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

initLobby();
