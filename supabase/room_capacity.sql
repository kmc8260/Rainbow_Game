-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- 방 인원을 최대 4명으로 제한하고, 시작된 게임에는 새로 들어올 수 없게 합니다.

create or replace function enforce_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target game_rooms%rowtype;
  seated integer;
begin
  -- 동시에 입장해도 인원을 넘지 않도록 방을 잠금
  select * into target from game_rooms where id = new.room_id for update;
  if not found then
    raise exception 'Room not found';
  end if;

  -- 이미 참가 중이면 기존 unique 제약이 처리
  if exists (
    select 1 from room_players
    where room_id = new.room_id and user_id = new.user_id
  ) then
    return new;
  end if;

  if target.status <> 'waiting' then
    raise exception 'Game already started';
  end if;

  select count(*) into seated from room_players where room_id = new.room_id;
  if seated >= least(target.max_players, 4) then
    raise exception 'Room is full';
  end if;

  return new;
end;
$$;

drop trigger if exists room_capacity_check on room_players;
create trigger room_capacity_check
  before insert on room_players
  for each row execute function enforce_room_capacity();
