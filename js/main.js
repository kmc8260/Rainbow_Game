const nicknameLabel = document.getElementById("nickname-label");
const chipAmount = document.getElementById("chip-amount");
const statusMsg = document.getElementById("status-msg");
const logoutBtn = document.getElementById("logout-btn");

async function loadMainScreen() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const userId = session.user.id;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("nickname, chips")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    statusMsg.textContent = "프로필 정보를 불러오지 못했습니다.";
    console.error("프로필 로드 에러:", error);
    return;
  }

  nicknameLabel.textContent = profile.nickname;
  chipAmount.textContent = profile.chips.toLocaleString();
}

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

loadMainScreen();
