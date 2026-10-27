// 화면 요소
const chipAmount = document.getElementById("chips");
const equippedCards = document.getElementById("equipped-cards");
const equippedName = document.getElementById("equipped-name");
const skinListEl = document.getElementById("skin-list");
const skinMsg = document.getElementById("skin-msg");
const logoutBtn = document.getElementById("logout-btn");

// 상점 스킨 목록 (스킨을 추가하려면 여기에 한 줄 넣으면 된다)
// type   : DB에 저장되는 번호
// folder : assets/card 안의 폴더 이름
const SKINS = [
  { type: 1, folder: "숫자", name: "Number", price: 0 },
  { type: 2, folder: "빵", name: "Bread", price: 3000 },
  { type: 3, folder: "winter", name: "Winter", price: 9000 },
];

let userId = null;
let chips = 0;
let cardType = 1; // 장착 중인 스킨 번호 (기본은 숫자 = 1)
let ownedTypes = [1]; // 가진 스킨 번호들

// ---------- 처음 불러오기 ----------

async function loadSkinShop() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = "Login.html";
    return;
  }
  userId = data.session.user.id;

  // 내 칩과 스킨 정보 가져오기
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("chips, Card_Type, Owned_Types")
    .eq("id", userId)
    .single();

  if (!profile) return;

  chips = profile.chips;
  cardType = profile.Card_Type || 1; // 비어 있으면 숫자(1)
  ownedTypes = profile.Owned_Types || [1];

  render();
}

// ---------- 화면 그리기 ----------

function render() {
  // 보유 칩
  chipAmount.textContent = chips.toLocaleString();

  // 장착 중인 스킨
  const equipped = findSkin(cardType);
  equippedCards.innerHTML = `<img src="${cardImage(equipped.folder)}" alt="${equipped.name}" />`;
  equippedName.textContent = equipped.name;

  // 스킨 목록
  skinListEl.innerHTML = SKINS.map(renderSkinItem).join("");

  // 각 버튼을 누르면 그 스킨을 고른다
  skinListEl.querySelectorAll(".skin-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectSkin(findSkin(Number(btn.dataset.type)));
    });
  });
}

// 번호로 스킨 찾기. 예) findSkin(2) -> 빵
function findSkin(type) {
  return SKINS.find((skin) => skin.type === type);
}

// 미리보기 이미지 경로. 예) cardImage("빵") -> assets/card/빵/first.png
function cardImage(folder) {
  return encodeURI(`assets/card/${folder}/first.png`);
}

// 스킨 한 칸의 HTML
function renderSkinItem(skin) {
  const isEquipped = skin.type === cardType;
  const isOwned = ownedTypes.includes(skin.type);

  // 안 가진 스킨: 가격 + 구매
  let price = `
    <div class="skin-price">
      <img src="assets/메인_코인_갯수.png" alt="칩" />
      ${skin.price.toLocaleString()}
    </div>
  `;
  let button = `<button class="skin-btn" data-type="${skin.type}">구매</button>`;

  // 가진 스킨: 보유 중 + 장착
  if (isOwned) {
    price = `<div class="skin-price owned">보유 중</div>`;
    button = `<button class="skin-btn" data-type="${skin.type}">장착</button>`;
  }

  // 장착 중인 스킨: 버튼 잠금
  if (isEquipped) {
    button = `<button class="skin-btn" disabled>장착 중</button>`;
  }

  return `
    <div class="skin-item ${isEquipped ? "equipped" : ""}">
      <div class="skin-preview">
        <img src="${cardImage(skin.folder)}" alt="${skin.name}" />
      </div>
      <div class="skin-name">${skin.name}</div>
      ${price}
      ${button}
    </div>
  `;
}

// ---------- 스킨 고르기 (구매 또는 장착) ----------

async function selectSkin(skin) {
  skinMsg.textContent = "";

  if (ownedTypes.includes(skin.type)) {
    // 가진 스킨 -> 장착만 바꾼다 (칩 안 듦)
    cardType = skin.type;
  } else if (chips < skin.price) {
    // 칩 부족 -> 아무것도 안 한다
    skinMsg.textContent = "칩이 부족합니다.";
    return;
  } else {
    // 안 가진 스킨 -> 칩을 내고 사서 바로 장착
    chips = chips - skin.price;
    ownedTypes = ownedTypes.concat(skin.type);
    cardType = skin.type;
  }

  // 바뀐 값을 DB에 한 번에 저장
  await supabaseClient
    .from("profiles")
    .update({ chips: chips, Owned_Types: ownedTypes, Card_Type: cardType })
    .eq("id", userId);

  render();
}

// ---------- 로그아웃 ----------

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "Login.html";
});

loadSkinShop();
