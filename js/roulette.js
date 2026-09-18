const spinBtn = document.getElementById("spin-btn");
const chips = document.getElementById("chips");
const tries = document.getElementById("try");

function render() {
  chips.textContent = allChips;
  tries.textContent = `${spinsLeft()}/${MAX_SPINS}`; // 남은 횟수
  spinBtn.disabled = spinsLeft() <= 0;
}

spinBtn.addEventListener("click", () => {
  spinBtn.disabled = true; // 회전 중 중복 클릭 방지

  spinWheel(async (prize) => {
    await addPrize(prize); // 기다린 후에 값을 보냄
    render();
  });
});

// 로그인 확인 후, 불러오기.
async function start() {
  if (await loadChips()) {
    render();
  }
}

start();
