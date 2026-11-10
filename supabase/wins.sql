-- 승리 수 컬럼 추가 (기존 사용자는 0부터 시작)
alter table public.profiles add column if not exists wins integer not null default 0;
