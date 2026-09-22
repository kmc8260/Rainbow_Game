// supabase/functions/deal-cards/index.ts
//
// 역할: 방(room_id)에 모인 플레이어들에게 카드를 배분하고 DB에 저장.
// 이 코드는 서버(Deno 런타임)에서만 실행되므로, 클라이언트는 카드 값을
// 미리 알거나 조작할 수 없음. service_role 키로 DB에 접근하기 때문에
// RLS(Row Level Security)를 우회해서 game_rounds/player_cards에 쓸 수 있음.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase가 모든 Edge Function에 자동으로 넣어주는 환경변수.
// 별도로 secrets 설정 안 해도 됨.
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------- 55장 덱 생성 ----------
// 숫자 1은 1장, 숫자 2는 2장 ... 숫자 10은 10장 (기획서 규칙 그대로)
function buildDeck(): number[] {
  const deck: number[] = [];
  for (let value = 1; value <= 10; value++) {
    for (let i = 0; i < value; i++) {
      deck.push(value);
    }
  }
  return deck;
}

// ---------- 셔플 (Fisher-Yates) ----------
function shuffle(deck: number[]): number[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

Deno.serve(async (req) => {
  try {
    const { room_id } = await req.json();

    if (!room_id) {
      return new Response(JSON.stringify({ error: "room_id is required" }), {
        status: 400,
      });
    }

    // 1) 이 방에 참가중인 플레이어 목록 조회 (좌석 순서대로)
    const { data: players, error: playersError } = await supabaseAdmin
      .from("room_players")
      .select("user_id")
      .eq("room_id", room_id)
      .order("seat_order", { ascending: true });

    if (playersError || !players || players.length < 2) {
      return new Response(
        JSON.stringify({ error: "At least 2 players are required." }),
        { status: 400 },
      );
    }

    // 2) 덱 생성 + 셔플
    const deck = shuffle(buildDeck());
    let cursor = 0;

    // 3) 딜러 카드 4장
    const dealerCards = deck.slice(cursor, cursor + 4);
    cursor += 4;

    // 4) 라운드 생성
    const { data: round, error: roundError } = await supabaseAdmin
      .from("game_rounds")
      .insert({
        room_id,
        dealer_cards: dealerCards,
        status: "dealing",
      })
      .select()
      .single();

    if (roundError) {
      return new Response(JSON.stringify({ error: roundError.message }), {
        status: 500,
      });
    }

    // 5) 플레이어별 카드 3장씩 배분
    const playerCardRows = players.map((p) => {
      const cards = deck.slice(cursor, cursor + 3);
      cursor += 3;
      return {
        round_id: round.id,
        user_id: p.user_id,
        cards,
      };
    });

    const { error: cardsError } = await supabaseAdmin
      .from("player_cards")
      .insert(playerCardRows);

    if (cardsError) {
      return new Response(JSON.stringify({ error: cardsError.message }), {
        status: 500,
      });
    }

    // 클라이언트에는 "성공했다"와 round_id만 알려줌.
    // 실제 카드 값은 각자 my_cards 뷰를 통해 본인 것만 조회하게 됨.
    return new Response(JSON.stringify({ round_id: round.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});