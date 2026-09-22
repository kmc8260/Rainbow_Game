// ============================================================
// main.js
// Main.html 전용 로직.
// 1) 로그인 세션 확인
// 2) profiles 테이블에서 닉네임/칩 불러와서 화면에 표시
// 3) 로그아웃 처리
// ============================================================

const nicknameLabel = document.getElementById("nickname-label");
const chipAmount = document.getElementById("chip-amount");
const statusMsg = document.getElementById("status-msg");
const logoutBtn = document.getElementById("logout-btn");

async function loadMainScreen() {
  const session = await getCurrentSession();
  if (!session) return; // 세션 없으면 getCurrentSession 안에서 이미 로그인 페이지로 이동시킴

  const profile = await fetchProfile(session.user.id);
  if (!profile) {
    statusMsg.textContent = "프로필 정보를 불러오지 못했습니다.";
    return;
  }

  renderProfile(profile);
}

// ---------- 세션 확인 ----------

async function getCurrentSession() {
  const { data } = await supabaseClient.auth.getSession();
  const session = data.session;

  if (!session) {
    window.location.href = "Login.html";
    return null;
  }

  return session;
}

// ---------- 프로필 조회 ----------

async function fetchProfile(userId) {
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("nickname, chips")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("프로필 로드 에러:", error);
    return null;
  }

  return profile;
}

// ---------- 화면 표시 ----------

function renderProfile(profile) {
  nicknameLabel.textContent = profile.nickname;
  chipAmount.textContent = profile.chips.toLocaleString();
}

// ---------- 로그아웃 ----------

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

loadMainScreen();
