const wheel = document.getElementById("wheel");

const prizes = [100, 200, 300, 400, 500, 600, 700, 800];
const partSize = 360 / prizes.length; // 한 칸 = 45도

let turns = 0; // 돈 바퀴 수

// 회전이 멈추면 onStop(당첨금)을 불러준다.
function spinWheel(prize) {
  const index = Math.floor(Math.random() * prizes.length);
  turns += 5;

  wheel.style.transform = `rotate(${360 * turns - index * partSize}deg)`; // 칸 맞추기

  // 이벤트 끝 났는지 확인 후 값 전달
  wheel.addEventListener(
    "transitionend",
    () => {
      return prize(prizes[index]);
    },
    {
      once: true, // once: true 1번민 실행
    },
  );
}
