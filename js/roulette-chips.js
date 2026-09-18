const MAX_SPINS = 5;

let userId = null;
let allChips = 0;
let spinCount = 0; // 오늘 돌린 횟수
let logId = null; // roulette_logs 행의 id

function today() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");

  return `${d.getFullYear()}-${month}-${date}`;
}

function spinsLeft() {
  return MAX_SPINS - spinCount;
}

// 계정 정보 , 칩 , 횟수 불러오기
async function loadChips() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const session = sessionData.session;

  userId = session.user.id;

  // 칩 잔액
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("chips")
    .eq("id", userId)
    .single();

  allChips = profile.chips;

  // 오늘 횟수
  const { data: logs } = await supabaseClient
    .from("roulette_logs")
    .select("id, spin_count, spin_date")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(1);

  const log = logs[0];

  // 날짜 확인 후 0
  if (log) {
    logId = log.id;
    spinCount = log.spin_date === today() ? log.spin_count : 0;
  }

  return true;
}

// 칩,횟수 증가
async function addPrize(prize) {
  const nextCount = spinCount + 1;
  const nextallChips = allChips + prize;

  const row = {
    user_id: userId,
    spin_count: nextCount,
    spin_date: today(),
  };

  //오늘 횟수 생성 업데이트
  const { data } = logId
    ? await supabaseClient
        .from("roulette_logs")
        .update(row)
        .eq("id", logId)
        .select("id")
        .single()
    : await supabaseClient
        .from("roulette_logs")
        .insert(row)
        .select("id")
        .single();

  logId = data.id;
  spinCount = nextCount;

  await supabaseClient
    .from("profiles")
    .update({ chips: nextallChips })
    .eq("id", userId);

  allChips = nextallChips;
}
