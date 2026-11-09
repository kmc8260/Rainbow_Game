-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.

-- 게임에 필요한 컬럼
alter table room_players add column if not exists is_all_in boolean not null default false;
alter table game_rooms add column if not exists street_base_bet integer not null default 0;
alter table game_rooms add column if not exists first_player_id uuid;

-- 접속 신호(last_seen_at)만 본인이 갱신 가능
revoke update on room_players from anon, authenticated;
grant update (last_seen_at) on room_players to authenticated;
drop policy if exists "본인 접속 신호만 갱신 가능" on room_players;
create policy "본인 접속 신호만 갱신 가능"
  on room_players for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 누가 나갔을 때 다른 화면에도 바로 반영
alter table room_players replica identity full;

-- 자동 정리 재등록: 대기 중인 방만, 신호가 60초 끊긴 참가자만
select cron.schedule('cleanup-stale-rooms', '* * * * *', $$
  delete from room_players
   where last_seen_at < now() - interval '60 seconds'
     and room_id in (select id from game_rooms where status = 'waiting');
  delete from game_rooms
   where status = 'waiting'
     and id not in (select distinct room_id from room_players);
$$);
