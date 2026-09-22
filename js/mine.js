// ============================================================
// mine.js
// Mine.html 전용 로직.
// 계정 정보 표시 + 닉네임 변경 + 로그아웃
// ============================================================

const accountEmail = document.getElementById("account-email");
const accountChips = document.getElementById("account-chips");
const nicknameInput = document.getElementById("nickname-input");
const saveNicknameBtn = document.getElementById("save-nickname-btn");
const nicknameMsg = document.getElementById("nickname-msg");
const logoutBtn = document.getElementById("logout-btn");

let currentUserId = null;

// ---------- 초기화 ----------

async function loadMyPage() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    window.location.href = "Login.html";
    return;
  }

  currentUserId = session.user.id;
  accountEmail.value = session.user.email;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("nickname, chips")
    .eq("id", currentUserId)
    .single();

  if (error || !profile) {
    nicknameMsg.textContent = "Failed to load profile.";
    console.error("Profile load error:", error);
    return;
  }

  accountChips.value = profile.chips.toLocaleString() + " chips";
  nicknameInput.placeholder = profile.nickname;
}

// ---------- 닉네임 변경 ----------

saveNicknameBtn.addEventListener("click", async () => {
  nicknameMsg.textContent = "";
  const newNickname = nicknameInput.value.trim();

  if (newNickname.length < 2) {
    nicknameMsg.textContent = "Nickname must be at least 2 characters.";
    return;
  }

  saveNicknameBtn.disabled = true;
  saveNicknameBtn.textContent = "Saving...";

  const { error } = await supabaseClient
    .from("profiles")
    .update({ nickname: newNickname })
    .eq("id", currentUserId);

  saveNicknameBtn.disabled = false;
  saveNicknameBtn.textContent = "Save";

  if (error) {
    nicknameMsg.style.color = "";
    nicknameMsg.textContent = "Update failed: " + error.message;
    return;
  }

  nicknameMsg.style.color = "#2ecc55";
  nicknameMsg.textContent = "Nickname updated.";
  nicknameInput.value = "";
  nicknameInput.placeholder = newNickname;
});

// ---------- 로그아웃 ----------

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

loadMyPage();
