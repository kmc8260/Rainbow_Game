// ============================================================
// auth.js
// Login.html, SignUp.html 두 페이지에서 공용으로 사용.
// 어떤 페이지에서 실행되는지는 로그인/회원가입 폼이 있는지로 구분함.
// ============================================================

const errorMsg = document.getElementById("error-msg");

function showError(message) {
  errorMsg.textContent = message;
}

// ---------- 로그인 ----------

const loginForm = document.getElementById("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

async function handleLogin(e) {
  e.preventDefault();
  showError("");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const btn = document.getElementById("login-btn");

  setLoading(btn, true, "로그인 중...");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    showError("이메일 또는 비밀번호를 확인해주세요.");
    setLoading(btn, false, "login");
    return;
  }

  window.location.href = "Main.html";
}

// ---------- 회원가입 ----------

const signupForm = document.getElementById("signup-form");

if (signupForm) {
  signupForm.addEventListener("submit", handleSignup);
}

async function handleSignup(e) {
  e.preventDefault();
  showError("");

  const nickname = document.getElementById("nickname").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const btn = document.getElementById("signup-btn");

  if (nickname.length < 2) {
    showError("닉네임은 2자 이상 입력해주세요.");
    return;
  }

  setLoading(btn, true, "가입 중...");

  // 1) 계정 생성
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
  });

  if (error) {
    showError(error.message);
    setLoading(btn, false, "Sign Up");
    return;
  }

  // 2) 프로필(닉네임, 기본 칩) 생성
  const { error: profileError } = await supabaseClient.from("profiles").insert({
    id: data.user.id,
    nickname,
    chips: 1000,
  });

  if (profileError) {
    showError("프로필 생성 실패: " + profileError.message);
    setLoading(btn, false, "Sign Up");
    return;
  }

  alert("회원가입이 완료되었습니다. 로그인 해주세요.");
  window.location.href = "Login.html";
}

// ---------- 공용 유틸 ----------

function setLoading(button, isLoading, loadingText) {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = loadingText; // 실패 시 원래 텍스트로 복구
    button.disabled = false;
  }
}
