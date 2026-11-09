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
const STALE_MS = 75_000; // 이 시간 동안 접속 신호가 없으면 나간 것으로 처리

// ---------- 점수 계산 (기획서 규칙) ----------
// 내 카드 3장과 딜러 카드 4장을 합쳐서 2장 이상 나온 숫자는 전부 지우고,
// 남은 숫자만 합산. 예) 내 8,8,7 + 딜러 7,10,2,3 -> 2+3+10 = 15
// 내 카드와 딜러 카드 사이에 겹치는 숫자가 하나도 없으면 레인보우 홀덤.
function scoreHand(playerCards: number[], dealerCards: number[]) {
  const allCards = [...playerCards, ...dealerCards];
  const countOf = (value: number) => allCards.filter((c) => c === value).length;

  const sum = allCards.filter((c) => countOf(c) === 1).reduce((a, b) => a + b, 0);
  const isRainbow = playerCards.every((c) => !dealerCards.includes(c));
  return { sum, isRainbow };
}

// 선부터 시계방향(좌석 순서)으로 돌면서 베팅할 수 있는 첫 사람 (폴드/올인 제외)
function pickFirstActive(
  players: { user_id: string; is_folded: boolean; is_all_in: boolean }[],
  firstPlayerId: string | null,
) {
  const n = players.length;
  const startIdx = Math.max(0, players.findIndex((p) => p.user_id === firstPlayerId));
  for (let i = 0; i < n; i++) {
    const p = players[(startIdx + i) % n];
    if (!p.is_folded && !p.is_all_in) return p.user_id;
  }
  return players[0].user_id;
}

// ---------- 공통 처리 ----------

async function loadPlayers(roomId: string) {
  const { data } = await supabaseAdmin
    .from("room_players")
    .select("*")
    .eq("room_id", roomId)
    .order("seat_order", { ascending: true });
  return data ?? [];
}

// 남은 한 명에게 팟을 주고 판을 끝냄
async function awardPot(roomId: string, winnerId: string, pot: number) {
  const { data: winner } = await supabaseAdmin
    .from("profiles")
    .select("chips")
    .eq("id", winnerId)
    .single();

  await supabaseAdmin
    .from("profiles")
    .update({ chips: (winner?.chips ?? 0) + pot })
    .eq("id", winnerId);

  await supabaseAdmin
    .from("game_rooms")
    .update({ round_status: "finished", winner_ids: [winnerId], pot, current_turn_user_id: null })
    .eq("id", roomId);
}

// 전원이 카드를 열었으면 가장 작은 카드를 낸 사람을 선으로 정함 (동점이면 좌석 순서가 빠른 사람)
async function startBettingIfReady(roomId: string) {
  const players = await loadPlayers(roomId);
  if (!players.every((p) => p.opened_card !== null)) return false;

  const firstPlayer = [...players].sort((a, b) => a.opened_card - b.opened_card)[0];
  await supabaseAdmin
    .from("game_rooms")
    .update({
      round_status: "betting",
      current_turn_user_id: firstPlayer.user_id,
      first_player_id: firstPlayer.user_id,
      street_base_bet: 0,
    })
    .eq("id", roomId);
  return true;
}

// 행동이 끝난 뒤 다음 턴, 다음 카드, 쇼다운 중 하나로 진행
async function advanceRound(room: any, potAfter: number, fromSeat: number) {
  const roomId = room.id;
  const players = await loadPlayers(roomId);
  const active = players.filter((p) => !p.is_folded);

  if (active.length === 1) {
    await awardPot(roomId, active[0].user_id, potAfter);
    return "won_by_fold";
  }

  // fromSeat 다음 좌석부터 시계방향으로, 이번 카드에서 아직 행동 안 한 사람
  const startIdx = Math.max(0, players.findIndex((p) => p.seat_order > fromSeat));
  let nextUserId: string | null = null;
  for (let i = 0; i < players.length; i++) {
    const p = players[(startIdx + i) % players.length];
    if (!p.is_folded && !p.is_all_in && !p.acted_this_street) {
      nextUserId = p.user_id;
      break;
    }
  }

  if (nextUserId) {
    await supabaseAdmin
      .from("game_rooms")
      .update({ current_turn_user_id: nextUserId, pot: potAfter })
      .eq("id", roomId);
    return "next_turn";
  }

  const { data: round } = await supabaseAdmin
    .from("game_rounds")
    .select("dealer_cards")
    .eq("id", room.current_round_id)
    .single();

  const dealerCardsFull: number[] = round?.dealer_cards ?? [];
  const revealed: number[] = room.dealer_revealed_cards ?? [];

  // 베팅할 수 있는 사람이 1명 이하면 남은 카드를 바로 열고 쇼다운으로 감
  const canStillBet = active.filter((p) => !p.is_all_in).length > 1;

  if (revealed.length < 4 && canStillBet) {
    await supabaseAdmin
      .from("room_players")
      .update({ street_bet: 0, acted_this_street: false })
      .eq("room_id", roomId)
      .eq("is_folded", false);

    await supabaseAdmin
      .from("game_rooms")
      .update({
        dealer_revealed_cards: [...revealed, dealerCardsFull[revealed.length]],
        current_turn_user_id: pickFirstActive(players, room.first_player_id),
        street_base_bet: 0,
        pot: potAfter,
      })
      .eq("id", roomId);
    return "next_street";
  }

  // 쇼다운
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
    .update({
      round_status: "finished",
      winner_ids: winners,
      pot: potAfter,
      dealer_revealed_cards: dealerCardsFull,
      current_turn_user_id: null,
    })
    .eq("id", roomId);
  return "showdown";
}

// ---------- 플레이어 퇴장: 좌석을 비우고, 진행 중인 판은 다이로 처리 (베팅한 칩은 팟에 남음) ----------
async function removePlayer(room: any, userId: string) {
  const players = await loadPlayers(room.id);
  const leaver = players.find((p) => p.user_id === userId);
  if (!leaver) return;

  await supabaseAdmin.from("room_players").delete().eq("id", leaver.id);

  const remaining = players.filter((p) => p.id !== leaver.id);
  if (remaining.length === 0) {
    await supabaseAdmin.from("game_rooms").delete().eq("id", room.id);
    return;
  }

  if (room.host_id === userId) {
    await supabaseAdmin.from("game_rooms").update({ host_id: remaining[0].user_id }).eq("id", room.id);
  }

  if (room.round_status === "opening") {
    const active = remaining.filter((p) => !p.is_folded);
    if (active.length === 1) {
      await awardPot(room.id, active[0].user_id, room.pot);
    } else {
      await startBettingIfReady(room.id);
    }
    return;
  }

  if (room.round_status === "betting") {
    const active = remaining.filter((p) => !p.is_folded);
    if (active.length === 1) {
      await awardPot(room.id, active[0].user_id, room.pot);
    } else if (room.current_turn_user_id === userId) {
      await advanceRound(room, room.pot, leaver.seat_order);
    }
  }
}

// 접속 신호가 끊긴 플레이어를 퇴장 처리 (창을 그냥 닫은 경우)
async function sweepStalePlayers(roomId: string) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .lt("last_seen_at", cutoff);

  for (const row of stale ?? []) {
    const { data: fresh } = await supabaseAdmin.from("game_rooms").select("*").eq("id", roomId).single();
    if (!fresh) return;
    await removePlayer(fresh, row.user_id);
  }
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

  const started = await startBettingIfReady(room.id);
  return jsonResponse({ ok: true, result: started ? "betting_started" : "waiting_for_others" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { room_id, action, card, all_in, amount } = await req.json();
    if (!room_id || !["bet", "fold", "open_card", "leave", "sweep"].includes(action)) {
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
      if (action === "leave" || action === "sweep") return jsonResponse({ ok: true });
      return jsonResponse({ error: "Room not found." }, 400);
    }

    if (action === "leave") {
      await removePlayer(room, userId);
      return jsonResponse({ ok: true, result: "left" });
    }

    if (action === "sweep") {
      const { data: member } = await supabaseAdmin
        .from("room_players")
        .select("id")
        .eq("room_id", room_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (member) await sweepStalePlayers(room_id);
      return jsonResponse({ ok: true, result: "swept" });
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
        .update({ street_bet: bet, acted_this_street: true, is_all_in: profile.chips - bet === 0 })
        .eq("id", myRow.id);

      potAfter = room.pot + bet;

      // 첫 번째 베팅이면 그 금액이 이번 스트리트의 최소 베팅 기준이 됨
      if (base === 0) {
        await supabaseAdmin.from("game_rooms").update({ street_base_bet: bet }).eq("id", room_id);
      }
    }

    const result = await advanceRound(room, potAfter, myRow.seat_order);
    return jsonResponse({ ok: true, result });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
