// supabase/functions/place-bet/index.ts

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

const OPENING_BET = 50; // 스트리트 첫 베팅의 최소 금액

// ---------- 점수 계산 (기획서 규칙) ----------
// 내 카드와 딜러 카드에서 겹치는 숫자를 서로 하나씩 지우고,
// 양쪽에 남은 숫자를 전부 합산. 하나도 안 겹치면 레인보우 홀덤.
function scoreHand(playerCards: number[], dealerCards: number[]) {
  const dealerRemaining = [...dealerCards];
  const playerRemaining: number[] = [];
  let removed = 0;

  for (const c of playerCards) {
    const idx = dealerRemaining.indexOf(c);
    if (idx !== -1) {
      dealerRemaining.splice(idx, 1);
      removed++;
    } else {
      playerRemaining.push(c);
    }
  }

  const sum = [...playerRemaining, ...dealerRemaining].reduce((a, b) => a + b, 0);
  return { sum, isRainbow: removed === 0 };
}

// 선부터 시계방향(좌석 순서)으로 돌면서 폴드 안 한 첫 사람
function pickFirstActive(players: { user_id: string; is_folded: boolean }[], firstPlayerId: string | null) {
  const n = players.length;
  const startIdx = Math.max(0, players.findIndex((p) => p.user_id === firstPlayerId));
  for (let i = 0; i < n; i++) {
    const p = players[(startIdx + i) % n];
    if (!p.is_folded) return p.user_id;
  }
  return players[0].user_id;
}

// ---------- "선" 정하기: 각자 카드 1장 공개 ----------
async function handleOpenCard(room: any, userId: string, card: number) {
  if (room.round_status !== "opening") {
    return jsonResponse({ error: "Card opening phase is over." }, 400);
  }

  const { data: myRow } = await supabaseAdmin
    .from("room_players")
    .select("*")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .single();

  if (!myRow || myRow.opened_card !== null) {
    return jsonResponse({ error: "You already opened a card." }, 400);
  }

  const { data: myHand } = await supabaseAdmin
    .from("player_cards")
    .select("cards")
    .eq("round_id", room.current_round_id)
    .eq("user_id", userId)
    .single();

  if (!myHand || !myHand.cards.includes(card)) {
    return jsonResponse({ error: "That card is not in your hand." }, 400);
  }

  await supabaseAdmin.from("room_players").update({ opened_card: card }).eq("id", myRow.id);

  const { data: allPlayers } = await supabaseAdmin
    .from("room_players")
    .select("user_id, seat_order, opened_card")
    .eq("room_id", room.id)
    .order("seat_order", { ascending: true });

  const everyoneOpened = (allPlayers ?? []).every((p) => p.opened_card !== null);
  if (!everyoneOpened) {
    return jsonResponse({ ok: true, result: "waiting_for_others" });
  }

  // 가장 작은 카드를 낸 사람이 선 (동점이면 좌석 순서가 빠른 사람)
  const sorted = [...(allPlayers ?? [])].sort((a, b) => a.opened_card - b.opened_card);
  const firstPlayer = sorted[0];

  await supabaseAdmin
    .from("game_rooms")
    .update({
      round_status: "betting",
      current_turn_user_id: firstPlayer.user_id,
      first_player_id: firstPlayer.user_id,
      street_base_bet: 0,
    })
    .eq("id", room.id);

  return jsonResponse({ ok: true, result: "betting_started" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { room_id, action, card, all_in, amount } = await req.json();
    if (!room_id || !["bet", "fold", "open_card"].includes(action)) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    const userId = userData.user.id;

    const { data: room, error: roomError } = await supabaseAdmin
      .from("game_rooms")
      .select("*")
      .eq("id", room_id)
      .single();

    if (roomError || !room) {
      return jsonResponse({ error: "Room not found." }, 400);
    }

    if (action === "open_card") {
      return await handleOpenCard(room, userId, card);
    }

    if (room.round_status !== "betting") {
      return jsonResponse({ error: "This room is not in a betting phase." }, 400);
    }
    if (room.current_turn_user_id !== userId) {
      return jsonResponse({ error: "It's not your turn." }, 400);
    }

    const { data: myRow, error: myRowError } = await supabaseAdmin
      .from("room_players")
      .select("*")
      .eq("room_id", room_id)
      .eq("user_id", userId)
      .single();

    if (myRowError || !myRow || myRow.is_folded) {
      return jsonResponse({ error: "You are not an active player." }, 400);
    }

    let potAfter = room.pot;

    // ---------- 액션 처리 ----------
    if (action === "fold") {
      await supabaseAdmin
        .from("room_players")
        .update({ is_folded: true, acted_this_street: true })
        .eq("id", myRow.id);
    } else {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("chips")
        .eq("id", userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: "Profile not found." }, 400);
      }

      // 이번 스트리트 첫 베팅 금액 (아직 아무도 안 걸었으면 0)
      const base: number = room.street_base_bet ?? 0;
      const minBet = base > 0 ? base : OPENING_BET;

      let bet: number;
      if (all_in) {
        bet = profile.chips; // 올인: 가진 칩 전부 (최소 금액보다 적어도 허용)
        if (bet <= 0) {
          return jsonResponse({ error: "No chips left to bet." }, 400);
        }
      } else {
        bet = Math.floor(Number(amount));
        if (!Number.isFinite(bet) || bet < minBet) {
          return jsonResponse({ error: `Minimum bet is ${minBet}.` }, 400);
        }
        if (profile.chips < bet) {
          return jsonResponse({ error: "Not enough chips." }, 400);
        }
      }

      await supabaseAdmin.from("profiles").update({ chips: profile.chips - bet }).eq("id", userId);
      await supabaseAdmin
        .from("room_players")
        .update({ street_bet: bet, acted_this_street: true })
        .eq("id", myRow.id);

      potAfter = room.pot + bet;

      // 첫 번째 베팅이면 그 금액이 이번 스트리트의 최소 베팅 기준이 됨
      if (base === 0) {
        await supabaseAdmin.from("game_rooms").update({ street_base_bet: bet }).eq("id", room_id);
      }
    }

    // ---------- 이후 진행 상태 판단 ----------
    const { data: allPlayers } = await supabaseAdmin
      .from("room_players")
      .select("user_id, seat_order, is_folded, acted_this_street")
      .eq("room_id", room_id)
      .order("seat_order", { ascending: true });

    const players = allPlayers ?? [];
    const active = players.filter((p) => !p.is_folded);

    // 한 명만 남음 -> 즉시 승리
    if (active.length === 1) {
      const winnerId = active[0].user_id;
      const { data: winnerProfile } = await supabaseAdmin
        .from("profiles")
        .select("chips")
        .eq("id", winnerId)
        .single();

      await supabaseAdmin
        .from("profiles")
        .update({ chips: (winnerProfile?.chips ?? 0) + potAfter })
        .eq("id", winnerId);

      await supabaseAdmin
        .from("game_rooms")
        .update({ round_status: "finished", winner_ids: [winnerId], pot: potAfter })
        .eq("id", room_id);

      return jsonResponse({ ok: true, result: "won_by_fold" });
    }

    // 아직 이번 스트리트에 행동 안 한 사람 중, 내 다음 순서(시계방향)
    const curIdx = players.findIndex((p) => p.user_id === userId);
    let nextUserId: string | null = null;
    for (let i = 1; i <= players.length; i++) {
      const p = players[(curIdx + i) % players.length];
      if (!p.is_folded && !p.acted_this_street) {
        nextUserId = p.user_id;
        break;
      }
    }

    if (nextUserId) {
      await supabaseAdmin
        .from("game_rooms")
        .update({ current_turn_user_id: nextUserId, pot: potAfter })
        .eq("id", room_id);

      return jsonResponse({ ok: true, result: "next_turn" });
    }

    // ---------- 스트리트 종료: 다음 딜러 카드 오픈 or 최종 판정 ----------
    const { data: round } = await supabaseAdmin
      .from("game_rounds")
      .select("dealer_cards")
      .eq("id", room.current_round_id)
      .single();

    const dealerCardsFull: number[] = round?.dealer_cards ?? [];
    const revealed: number[] = room.dealer_revealed_cards ?? [];

    if (revealed.length < 4) {
      const nextRevealed = [...revealed, dealerCardsFull[revealed.length]];

      await supabaseAdmin
        .from("room_players")
        .update({ street_bet: 0, acted_this_street: false })
        .eq("room_id", room_id)
        .eq("is_folded", false);

      await supabaseAdmin
        .from("game_rooms")
        .update({
          dealer_revealed_cards: nextRevealed,
          current_turn_user_id: pickFirstActive(players, room.first_player_id), // 매 스트리트 선부터
          street_base_bet: 0,
          pot: potAfter,
        })
        .eq("id", room_id);

      return jsonResponse({ ok: true, result: "next_street" });
    }

    // 4장 다 오픈됨 -> 쇼다운
    const { data: hands } = await supabaseAdmin
      .from("player_cards")
      .select("user_id, cards")
      .eq("round_id", room.current_round_id)
      .in("user_id", active.map((p) => p.user_id));

    const scored = (hands ?? []).map((h) => ({
      user_id: h.user_id,
      ...scoreHand(h.cards, dealerCardsFull),
    }));

    // 레인보우 홀덤이 있으면 그 사람들끼리 겨루고, 없으면 전체에서 합이 가장 낮은 사람이 승리
    const rainbow = scored.filter((s) => s.isRainbow);
    const pool = rainbow.length > 0 ? rainbow : scored;
    const minSum = Math.min(...pool.map((s) => s.sum));
    const winners = pool.filter((s) => s.sum === minSum).map((s) => s.user_id);

    const payoutEach = Math.floor(potAfter / winners.length);

    for (const winnerId of winners) {
      const { data: p } = await supabaseAdmin.from("profiles").select("chips").eq("id", winnerId).single();
      await supabaseAdmin
        .from("profiles")
        .update({ chips: (p?.chips ?? 0) + payoutEach })
        .eq("id", winnerId);
    }

    await supabaseAdmin
      .from("game_rooms")
      .update({ round_status: "finished", winner_ids: winners, pot: potAfter })
      .eq("id", room_id);

    return jsonResponse({ ok: true, result: "showdown" });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});