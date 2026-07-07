-- ============================================================================
-- ICONS · 참여형 게임 서버 경로 (#64) — games · game_plays · play_game RPC
-- 근거: docs/online-popup/05-game-miniapp-spec.md §3·§4 · ADR-0002 · ADR-0004
-- 원칙: 게임 = 렌더러, 결과 = 서버. 보상은 뽑기권을 거치지 않는 grant_cards 직접 발급.
-- 결정: games.id는 카탈로그 관례대로 text 슬러그(스펙 §3 uuid 스케치와 다름 —
--       ips/goods/cards/events 전부 text PK, 라우트 /games/[gameId]·mock id와 1:1).
--       일일 경계는 Asia/Seoul 자정(한국 대상 서비스 — UTC 자정은 오전 9시 리셋으로 보임).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 참여형 게임 카탈로그 — 공개 읽기, staff 쓰기 (card_pools 패턴).
-- reward_pool_id null = 서버 플레이 불가(굿즈 마블 등 래플 연출 데모 전용).
-- popups 미구현 단계라 연결 이벤트(event_id)로 대용.
-- ---------------------------------------------------------------------------
create table public.games (
  id                   text primary key,
  type                 text not null check (type in ('marble_roulette')),
  title                text not null,
  event_id             text references public.events (id),
  config               jsonb not null,                          -- {marbleCount, variant} — 연출·룰(코스메틱)
  reward_pool_id       uuid references public.card_pools (id),
  per_user_daily_limit integer not null default 1 check (per_user_daily_limit between 1 and 100),
  active_from          timestamptz not null default now(),
  active_to            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_games_updated before update on public.games
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 플레이 이력 — 무상 발급 트리거이자 멱등 재생 원장. 쓰기는 play_game RPC로만.
-- idempotency_key = 'game_play:<game>:<user>:<KST일자>:<슬롯>' — 슬롯은 당일 n회차.
-- ---------------------------------------------------------------------------
create table public.game_plays (
  id              uuid primary key default extensions.gen_random_uuid(),
  game_id         text not null references public.games (id),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  result          jsonb not null,                    -- {playId, rewards, animationSeed} 반환형 전문
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
create index game_plays_game_user_idx on public.game_plays (game_id, user_id, created_at desc);
create index game_plays_user_idx on public.game_plays (user_id, created_at desc);

-- 발급 이력 source에 게임 플레이 허용 (공유 migration 수정 금지 — constraint 재생성)
alter table public.card_grants drop constraint card_grants_source_check;
alter table public.card_grants add constraint card_grants_source_check
  check (source in ('draw_ticket', 'game_play'));

-- ============================================================================
-- RPC
-- ============================================================================

-- 참여형 게임 1회: 자격·활성 창·일일 한도(KST 자정 경계) → 서버 RNG 발급 → 기록.
-- 멱등: 일일 한도 소진 후 재호출은 그 날 마지막 결과를 그대로 반환(발급 불변 —
--       같은 시드 → 같은 연출. 스펙 §4 "재호출 → 이전 결과 반환").
-- 동시성: user×game advisory xact lock으로 카운트→발급→기록을 직렬화.
--         games 행 잠금은 전 사용자를 직렬화해서 부적합. idempotency_key unique는
--         잠금 우회 시 트랜잭션 전체(발급 포함)를 원자 롤백하는 백스톱.
create or replace function public.play_game(p_game_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user   uuid := (select auth.uid());
  v_game   record;
  v_today  date;
  v_count  integer;
  v_last   jsonb;
  v_play   uuid;
  v_idem   text;
  v_seed   text;
  v_cards  jsonb;
  v_result jsonb;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select id, reward_pool_id, per_user_daily_limit, active_from, active_to
    into v_game from games where id = p_game_id;
  if v_game.id is null then raise exception 'game not found'; end if;
  if now() < v_game.active_from or (v_game.active_to is not null and now() >= v_game.active_to) then
    raise exception 'game not active';
  end if;
  -- 풀 활성 창은 검사하지 않는다 — 게임 자체의 active_from/to가 운영 창의 진실원
  -- (개봉과 같은 무기한 규율, ADR-0004. 풀 종료 시 staff가 게임도 종료한다).
  if v_game.reward_pool_id is null then raise exception 'game has no reward pool'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('play_game:' || v_user::text || ':' || p_game_id, 0));

  v_today := (now() at time zone 'Asia/Seoul')::date;

  select count(*) into v_count from game_plays
    where game_id = p_game_id and user_id = v_user
      and (created_at at time zone 'Asia/Seoul')::date = v_today;

  if v_count >= v_game.per_user_daily_limit then
    -- 마지막 슬롯의 멱등 키로 정확 조회 — created_at 정렬은 같은 초/트랜잭션의
    -- 연속 플레이에서 동률이라 재생 결과가 흔들린다.
    select result into v_last from game_plays
      where idempotency_key = 'game_play:' || p_game_id || ':' || v_user::text || ':'
            || to_char(v_today, 'YYYY-MM-DD') || ':' || v_count;
    if v_last is null then raise exception 'daily limit state corrupted'; end if;
    return v_last;
  end if;

  v_play := extensions.gen_random_uuid();
  v_idem := 'game_play:' || p_game_id || ':' || v_user::text || ':'
            || to_char(v_today, 'YYYY-MM-DD') || ':' || (v_count + 1);
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');

  v_cards := grant_cards(v_user, v_game.reward_pool_id, 'game_play', v_play, v_idem, 1);

  v_result := jsonb_build_object(
    'playId', v_play,
    'rewards', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', 'card') || t.elem order by t.ord), '[]'::jsonb)
      from jsonb_array_elements(v_cards) with ordinality as t(elem, ord)
    ),
    'animationSeed', v_seed
  );

  insert into game_plays (id, game_id, user_id, result, idempotency_key)
  values (v_play, p_game_id, v_user, v_result, v_idem);

  return v_result;
end; $$;

-- ============================================================================
-- RLS · 권한
-- ============================================================================
alter table public.games      enable row level security;
alter table public.game_plays enable row level security;

-- 게임 카탈로그는 공개 읽기, staff 쓰기 — card_pools 패턴과 동일
create policy games_read   on public.games for select using (true);
create policy games_insert on public.games for insert with check ((select public.is_staff()));
create policy games_update on public.games for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy games_delete on public.games for delete using ((select public.is_staff()));

-- 플레이 이력은 본인 읽기만. 쓰기는 전부 RPC로만(직접 쓰기 정책 없음).
create policy game_plays_self_read on public.game_plays for select using ((select auth.uid()) = user_id);

grant select on public.games to anon, authenticated;
grant insert, update, delete on public.games to authenticated;
grant select on public.game_plays to authenticated;

-- ⚠️ default privileges 누수 봉인(20260707090001 규율): 롤별 명시 revoke 후 최소 grant.
--    grant_cards는 내부 전용 그대로(시그니처 불변 — 기존 revoke 유효), play_game이 유일한 진입점.
revoke all on function public.play_game(text) from public, anon, authenticated, service_role;
grant execute on function public.play_game(text) to authenticated;
