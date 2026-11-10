# 레인보우 홀덤 (Rainbow Holdem)

예능 〈대탈출 시즌3〉 빵공장 편에 나온 카드 게임을 웹으로 구현한 온라인 멀티플레이 카드 게임입니다.

- 팀: 2403 김민찬, 2404 김민채
- 서비스 주소: https://kmc8260.github.io/Rainbow_Game/
- 저장소: https://github.com/kmc8260/Rainbow_Game

## 주요 기능

- 회원가입, 로그인 (가입 시 칩 1,000개 지급)
- 공개방, 6자리 코드 비밀방 (최대 4명)
- 실시간 게임 진행: 카드 공개, 선 결정, 베팅(Bet / All in / Die), 딜러 카드 오픈, 승패 판정
- 게임 중 퇴장 시 다이 처리
- 승리 수 누적, 룰렛(하루 5회 칩 보충), 카드 스킨 상점

## 게임 규칙

1. 카드는 1~10, 숫자만큼 장수가 있어 총 55장입니다.
2. 플레이어는 3장, 딜러는 4장을 받습니다.
3. 딜러 카드 1장과 각자 1장을 공개하고, 가장 작은 카드를 낸 사람이 선이 됩니다.
4. 선부터 시계방향으로 베팅하고, 한 바퀴마다 딜러 카드를 1장씩 엽니다.
5. 4장이 모두 열리면 내 카드와 딜러 카드에서 겹치는 숫자를 지우고, 남은 합이 낮은 사람이 이깁니다.
   예) 내 카드 8, 8, 7 + 딜러 7, 10, 2, 3 → 2 + 3 + 10 = 15점
6. 딜러 카드와 하나도 겹치지 않으면 **레인보우 홀덤**으로 합과 상관없이 우승합니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프론트엔드 | HTML, CSS, JavaScript |
| 백엔드 | Supabase (Auth, PostgreSQL, Realtime, Edge Functions) |
| 배포 | GitHub Pages |

카드 셔플, 베팅, 승패 판정은 조작을 막기 위해 서버(Edge Function)에서만 처리합니다.

## 폴더 구조

```
├─ index.html, Login.html, SignUp.html   로그인, 회원가입
├─ Main.html, Mine.html                   메인, 내 정보
├─ Game.html, Room.html, Table.html       로비, 대기실, 게임 화면
├─ roulette.html, skin.html               룰렛, 스킨 상점
├─ css/                                   화면 스타일
├─ js/                                    화면별 스크립트 (supabase-config.js: 접속 정보)
├─ assets/                                이미지, 카드 스킨
└─ supabase/
   ├─ functions/deal-cards/               카드 셔플, 배분
   ├─ functions/place-bet/                베팅, 턴 진행, 승패 판정, 퇴장 처리
   └─ *.sql                               DB 수정 SQL
```

## 실행 방법

### 1. 배포된 서비스로 실행 (권장)

https://kmc8260.github.io/Rainbow_Game/ 에 접속해 아래 테스트 계정으로 로그인합니다.

### 2. 로컬에서 실행

1. 저장소를 내려받습니다.
   ```
   git clone https://github.com/kmc8260/Rainbow_Game.git
   ```
2. VS Code에서 폴더를 열고 **Live Server** 확장으로 `index.html`을 실행합니다.
   (파일을 더블클릭해서 `file://`로 열면 Supabase 요청이 막힙니다.)
3. 기본으로 팀의 Supabase 프로젝트에 연결되어 있어 별도 설정 없이 동작합니다.

### 3. 직접 Supabase 프로젝트로 실행할 경우

1. `.env.example`을 참고해 Supabase URL과 anon(publishable) 키를 `js/supabase-config.js`에 입력합니다.
2. Supabase SQL Editor에서 `supabase/` 폴더의 SQL 파일을 실행합니다.
3. Edge Function을 배포합니다.
   ```
   npm install
   npx supabase login
   npx supabase link --project-ref <프로젝트 ref>
   npx supabase functions deploy deal-cards --no-verify-jwt --use-api
   npx supabase functions deploy place-bet --no-verify-jwt --use-api
   ```


## 테스트 계정

멀티플레이 게임이므로 2개 계정으로 테스트합니다.
같은 브라우저의 두 탭은 로그인이 공유되므로, **일반 창과 시크릿 창**(또는 크롬과 엣지)을 사용하세요.

| 구분 | 이메일 | 비밀번호 |
|---|---|---|
| 테스트 계정 1 |mirim2025@gmail.com|mirim2025|
| 테스트 계정 2 |mirim2026@gmail.com|mirim2026|

새 계정으로 회원가입해서 테스트해도 됩니다.

## 테스트 순서

1. 계정 1로 로그인 → Game → 방 만들기
2. 계정 2로 로그인 → Game → 같은 방 입장 (비밀방은 6자리 코드 입력)
3. 계정 1(호스트)이 Start Game
4. 두 계정 모두 카드 1장 공개 → 선부터 베팅
5. 4장이 모두 열리면 결과창에서 승자와 획득 칩 확인
6. 메인 화면에서 승리 수(Wins)와 칩 확인
