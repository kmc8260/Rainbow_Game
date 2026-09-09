const accountEmail = document.getElementById("account-email");
const accountChips = document.getElementById("account-chips");
const nicknameInput = document.getElementById("nickname-input");
const saveNicknameBtn = document.getElementById("save-nickname-btn");
const nicknameMsg = document.getElementById("nickname-msg");
const logoutBtn = document.getElementById("logout-btn");

let currentUserId = null;

// ---------- 초기화: 계정 정보 불러오기 ----------
async function loadMyPage() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    window.location.href = "login.html";
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
    nicknameMsg.textContent = "프로필 정보를 불러오지 못했습니다.";
    console.error("프로필 로드 에러:", error);
    return;
  }

  accountChips.value = profile.chips.toLocaleString() + " chips";
  nicknameInput.placeholder = profile.nickname; // 현재 닉네임을 placeholder로 보여줌
}

// ---------- 닉네임 변경 ----------
saveNicknameBtn.addEventListener("click", async () => {
  nicknameMsg.textContent = "";
  const newNickname = nicknameInput.value.trim();

  if (newNickname.length < 2) {
    nicknameMsg.textContent = "닉네임은 2자 이상 입력해주세요.";
    return;
  }

  saveNicknameBtn.disabled = true;
  saveNicknameBtn.textContent = "변경 중...";

  const { error } = await supabaseClient
    .from("profiles")
    .update({ nickname: newNickname })
    .eq("id", currentUserId);

  saveNicknameBtn.disabled = false;
  saveNicknameBtn.textContent = "변경하기";

  if (error) {
    nicknameMsg.textContent = "변경 실패: " + error.message;
    return;
  }

  nicknameMsg.style.color = "#2ecc55";
  nicknameMsg.textContent = "닉네임이 변경되었습니다.";
  nicknameInput.value = "";
  nicknameInput.placeholder = newNickname;
});

// ---------- 로그아웃 ----------
logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

loadMyPage();
