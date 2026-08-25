const errorMsg = document.getElementById("error-msg");

//에러 메시지 표시
function showError(message) {
  errorMsg.textContent = message;
}

//로그인 페이지
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError(""); //에러 메시지 초기화

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const btn = document.getElementById("login-btn");

    btn.disabled = true; //버튼 비활성화
    btn.textContent = "로그인 중...";

    //로그인 요청
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      showError("로그인 실패 : 이메일 또는 비밀번호를 확인해주세요.");
      btn.disabled = false;
      btn.textContent = "login";
      return;
    }

    //로그인 성공 시 메인 화면으로 이동
    window.location.href = "main.html";
  });
}

//회원가입 페이지
const signupForm = document.getElementById("signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError(""); //에러 메시지 초기화

    const nickname = document.getElementById("nickname").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const btn = document.getElementById("signup-btn");

    btn.disabled = true; //버튼 활성화
    btn.textContent = "가입 중...";

    //Supabase Auth에 계정 생성
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) {
      showError("회원가입 실패 : " + error.message);
      btn.disabled = false;
      btn.textContent = "login";
      return;
    }

    //profiles 테이블에 닉네임 + 기본 칩 저장
    const userId = data.user.id;
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .insert({ id: userId, nickname, chips: 1000 });

    if (profileError) {
      showError("프로필 생성 실패 : " + profileError.message);
      btn.disabled = false;
      btn.textContent = "login";
      return;
    }

    alert("회원가입이 완료되었습니다. 로그인 해주세요.");
    window.location.href = "login.html";
  });
}
