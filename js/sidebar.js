// ============================================================
// sidebar.js
// data-profile-name, data-profile-chips가 붙은 곳에 내 닉네임과 칩을 표시
// 칩이나 닉네임이 바뀌면 window.refreshProfileLabels()를 호출
// ============================================================

(function () {
  async function refreshProfileLabels() {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) return;

    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("nickname, chips")
      .eq("id", data.session.user.id)
      .single();

    if (error || !profile) {
      console.error("프로필 로드 에러:", error);
      return;
    }

    document.querySelectorAll("[data-profile-name]").forEach((el) => {
      el.textContent = profile.nickname;
    });
    document.querySelectorAll("[data-profile-chips]").forEach((el) => {
      el.textContent = profile.chips.toLocaleString();
    });
  }

  window.refreshProfileLabels = refreshProfileLabels;
  refreshProfileLabels();
})();
