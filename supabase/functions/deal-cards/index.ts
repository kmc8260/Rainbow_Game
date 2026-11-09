// supabase/functions/deal-cards/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildDeck(): number[] {
  const deck: number[] = [];
  for (let value = 1; value <= 10; value++) {
    for (let i = 0; i < value; i++) deck.push(value);
  }
  return deck;
}

function shuffle(deck: number[]): number[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { room_id } = await req.json();
    if (!room_id) {
      return jsonResponse({ error: "room_id is required" }, 400);
    }

    // 요청한 사람이 이 방의 호스트인지 서버에서 확인
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const { data: room, error: roomLoadError } = await supabaseAdmin
      .from("game_rooms")
      .select("host_id, status, round_status")
      .eq("id", room_id)
      .single();

    if (roomLoadError || !room) {
      return jsonResponse({ error: "Room not found." }, 404);
    }
    if (room.host_id !== userData.user.id) {
      return jsonResponse({ error: "Only the host can deal cards." }, 403);
    }
    if (room.status === "playing" && ["opening", "betting"].includes(room.round_status)) {
      return jsonResponse({ error: "A round is already in progress." }, 409);
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from("room_players")
      .select("user_id")
      .eq("room_id", room_id)
      .order("joined_at", { ascending: true });

    if (playersError || !players || players.length < 2) {
      return jsonResponse({ error: "At least 2 players are required." }, 400);
    }

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, nickname, chips")
      .in("id", players.map((p) => p.user_id));

    const broke = (profiles ?? []).filter((p) => p.chips <= 0).map((p) => p.nickname);
    if (broke.length > 0) {
      return jsonResponse({ error: `No chips left: ${broke.join(", ")}. Spin the roulette first.` }, 400);
    }

    // 입장 순서대로 좌석 번호 부여 (턴 순서의 기준)
    await Promise.all(
      players.map((p, seat) =>
        supabaseAdmin
          .from("room_players")
          .update({ seat_order: seat })
          .eq("room_id", room_id)
          .eq("user_id", p.user_id)
      ),
    );

    const deck = shuffle(buildDeck());
    let cursor = 0;
    const dealerCards = deck.slice(cursor, cursor + 4);
    cursor += 4;

    const { data: round, error: roundError } = await supabaseAdmin
      .from("game_rounds")
      .insert({ room_id, dealer_cards: dealerCards })
      .select()
      .single();

    if (roundError) {
      return jsonResponse({ error: roundError.message }, 500);
    }

    const playerCardRows = players.map((p) => {
      const cards = deck.slice(cursor, cursor + 3);
      cursor += 3;
      return { round_id: round.id, user_id: p.user_id, cards };
    });

    const { error: cardsError } = await supabaseAdmin.from("player_cards").insert(playerCardRows);
    if (cardsError) {
      return jsonResponse({ error: cardsError.message }, 500);
    }

    await supabaseAdmin
      .from("room_players")
      .update({ is_folded: false, is_all_in: false, street_bet: 0, acted_this_street: false, opened_card: null })
      .eq("room_id", room_id);

    const { error: roomError } = await supabaseAdmin
      .from("game_rooms")
      .update({
        current_round_id: round.id,
        status: "playing",
        round_status: "opening",
        dealer_revealed_cards: [dealerCards[0]],
        pot: 0,
        current_turn_user_id: null,
        first_player_id: null,
        street_base_bet: 0,
        winner_ids: [],
      })
      .eq("id", room_id);

    if (roomError) {
      return jsonResponse({ error: roomError.message }, 500);
    }

    return jsonResponse({ round_id: round.id });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});