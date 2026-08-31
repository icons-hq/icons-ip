-- S8 참여형 코인 (#330): 출석 적립 → 카드팩 교환.
--
-- 코인은 결제 수단이 아니다. 충전 경로가 없고(ADR-0003·ADR-0004 — 유료 가챠와
-- 충전금은 폐기됐다), 굿즈·티켓 금액에 개입하지 않으며, 오직 출석으로만 늘고
-- 카드팩(뽑기권) 교환으로만 줄어든다. 그래서 이 파일에는 결제 seam이 없다.
--
-- ## 잔액은 profiles가 아니라 별도 테이블이다
--
-- profiles는 컬럼 화이트리스트 grant(20260717100001)로 읽기를 좁혀 둔 테이블이고,
-- 잔액을 거기 얹으면 프로필 한 행이 원장·캐시·프로필을 동시에 지게 된다.
-- 원장(coin_ledger)이 진실이고 coin_balances는 그 합의 캐시다 — 두 값이 갈라질
-- 경로를 만들지 않으려고 쓰기를 RPC 두 개로 좁혔다.
--
-- ## 교환은 전역 카드 리워드 게이트를 통과해야만 성립한다
--
-- 20260813203000의 BEFORE INSERT 트리거는 게이트가 OFF일 때 draw_tickets 행을
-- 조용히 삼킨다(결제 확정을 깨뜨리지 않기 위한 설계). 교환에서는 그 침묵이 곧
-- "코인만 빠지고 카드팩은 없음"이다. 그래서 이 파일의 교환 RPC는 삽입된 행 수를
-- 직접 세고, 요청 수량과 다르면 예외로 전체를 되돌린다.

-- ── 원장·잔액·출석 ──────────────────────────────────────────────────────────

-- append-only 원장. 잔액 분쟁은 이 테이블을 재생해 답한다.
create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 양수는 적립, 음수는 사용. 0은 아무 사건도 아니다.
  amount integer not null
    check (amount <> 0),
  reason text not null
    check (reason in ('attendance', 'exchange')),
  -- 교환 멱등 키. 출석 적립에는 없다(날짜가 곧 키다).
  operation_id uuid,
  -- 출석 적립분이 어느 날짜에 대한 것인지.
  attended_on date,
  created_at timestamptz not null default now()
);

create unique index coin_ledger_operation_uidx
  on public.coin_ledger (operation_id)
  where operation_id is not null;

create index coin_ledger_user_recent_idx
  on public.coin_ledger (user_id, id desc);

-- 잔액 캐시. check (balance >= 0)이 마이너스 잔액을 스키마에서 막는다 —
-- 차감 경로가 하나라도 조건을 빠뜨리면 커밋 자체가 실패한다.
create table public.coin_balances (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0
    check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- 하루 1회 출석. PK가 곧 중복 방지다 — 상태 컬럼도, 카운터도 필요 없다.
create table public.coin_attendance (
  user_id uuid not null references public.profiles (id) on delete cascade,
  attended_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, attended_on)
);

-- 카드팩 교환 상품. UI 표기는 "카드팩"이다(CONTEXT.md) — DB 식별자만 draw_ticket을 쓴다.
create table public.coin_exchange_offers (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.card_pools (id),
  label text not null
    check (char_length(label) between 1 and 80),
  coin_cost integer not null
    check (coin_cost > 0 and coin_cost <= 100000),
  ticket_count integer not null default 1
    check (ticket_count between 1 and 10),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coin_exchange_offers_pool_id_idx
  on public.coin_exchange_offers (pool_id);

create trigger coin_exchange_offers_set_updated_at
before update on public.coin_exchange_offers
for each row execute function public.set_updated_at();

-- ── 원장 불변성 ─────────────────────────────────────────────────────────────

-- 어떤 롤에도 update/delete 권한을 주지 않지만, 소유자 권한으로 도는 security
-- definer 경로가 하나만 잘못 써도 원장이 조용히 고쳐진다. 트리거로 한 번 더 막는다.
--
-- FK cascade(프로필 삭제)만 예외다. 부모 행이 이미 사라진 뒤에 도는 삭제라,
-- 여기서 막으면 계정 정리 자체가 불가능해진다.
create function private.reject_coin_ledger_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (
       select 1 from public.profiles as profile where profile.id = old.user_id
     ) then
    return old;
  end if;

  raise exception 'coin_ledger_append_only' using errcode = '55000';
end;
$$;

revoke all on function private.reject_coin_ledger_mutation()
  from public, anon, authenticated, service_role;

create trigger coin_ledger_append_only
before update or delete on public.coin_ledger
for each row execute function private.reject_coin_ledger_mutation();

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.coin_ledger enable row level security;
alter table public.coin_balances enable row level security;
alter table public.coin_attendance enable row level security;
alter table public.coin_exchange_offers enable row level security;

create policy coin_ledger_select_own_or_staff on public.coin_ledger
  for select using (
    user_id = (select auth.uid()) or (select public.is_staff())
  );

create policy coin_balances_select_own_or_staff on public.coin_balances
  for select using (
    user_id = (select auth.uid()) or (select public.is_staff())
  );

create policy coin_attendance_select_own_or_staff on public.coin_attendance
  for select using (
    user_id = (select auth.uid()) or (select public.is_staff())
  );

-- 교환 상품은 캠페인 상세에서 비로그인도 본다(공개 브라우징). 내린 상품은 숨긴다.
create policy coin_exchange_offers_public_read on public.coin_exchange_offers
  for select
  to anon, authenticated
  using (status = 'active' or (select public.is_staff()));

revoke all on table public.coin_ledger from public, anon, authenticated, service_role;
revoke all on table public.coin_balances from public, anon, authenticated, service_role;
revoke all on table public.coin_attendance from public, anon, authenticated, service_role;
revoke all on table public.coin_exchange_offers from public, anon, authenticated, service_role;
grant select on table public.coin_ledger to authenticated;
grant select on table public.coin_balances to authenticated;
grant select on table public.coin_attendance to authenticated;
grant select on table public.coin_exchange_offers to anon, authenticated;

-- ── 뽑기권 발급 출처 확장 ───────────────────────────────────────────────────

-- 코인 교환분을 자동 발급·수동 발급과 섞지 않는다. 정책 효과 집계
-- (reward_policy_id 기반)와도 분리된다.
alter table public.draw_tickets
  drop constraint draw_tickets_source_check;

alter table public.draw_tickets
  add constraint draw_tickets_source_check
    check (source in ('order_paid', 'admin_grant', 'coin_exchange'));

create index draw_tickets_coin_exchange_idx
  on public.draw_tickets (source_id, created_at desc)
  where source = 'coin_exchange';

-- ── 카드풀 준비 판정 ────────────────────────────────────────────────────────

-- admin_grant_draw_tickets(20260807130002)의 준비 판정과 같은 규칙이다. 확률 합이
-- 100%가 아니거나 확률이 양수인 등급에 카드가 없으면 개봉이 실패한다 — 열 수 없는
-- 카드팩을 코인과 바꿔 주지 않는다.
create function private.assert_card_pool_ready(p_pool_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_pool public.card_pools%rowtype;
  v_ready boolean := false;
begin
  select pool.*
    into v_pool
  from public.card_pools as pool
  where pool.id = p_pool_id
  for share;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if v_pool.active_to is not null and now() >= v_pool.active_to then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;

  select
    count(*) = 5
    and coalesce(sum(pool_odd.probability), 0) = 1
    and coalesce(bool_and(pool_odd.probability between 0 and 1), false)
    and not exists (
      select 1
      from public.pool_odds as positive_odd
      where positive_odd.pool_id = p_pool_id
        and positive_odd.probability > 0
        and not exists (
          select 1
          from public.cards as card
          where card.pool_id = p_pool_id
            and card.rarity = positive_odd.rarity
        )
    )
    into v_ready
  from public.pool_odds as pool_odd
  where pool_odd.pool_id = p_pool_id;

  if not v_ready then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.assert_card_pool_ready(uuid)
  from public, anon, authenticated, service_role;

-- ── 사용자 RPC: 출석 ────────────────────────────────────────────────────────

-- 일일 경계는 Asia/Seoul 자정이다(참여형 게임 일일 한도와 같은 정의 —
-- 20260707093001). UTC 자정을 쓰면 한국 사용자에게 오전 9시 리셋으로 보인다.
create function public.attendance_check_in()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date;
  v_inserted integer;
  v_balance integer;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.suspended_at is not null
  ) then
    raise exception 'account_suspended' using errcode = '55000';
  end if;

  v_today := (now() at time zone 'Asia/Seoul')::date;

  -- 같은 날 두 번째 호출은 아무것도 바꾸지 않는다. 경합하는 두 탭도 PK가
  -- 직렬화한다 — 하나만 원장을 남기고 다른 하나는 already_checked를 받는다.
  insert into public.coin_attendance (user_id, attended_on)
  values (v_user, v_today)
  on conflict (user_id, attended_on) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select balance into v_balance
    from public.coin_balances
    where user_id = v_user;

    return jsonb_build_object(
      'status', 'already_checked',
      'balance', coalesce(v_balance, 0),
      'attended_on', v_today
    );
  end if;

  insert into public.coin_ledger (user_id, amount, reason, attended_on)
  values (v_user, 1, 'attendance', v_today);

  insert into public.coin_balances (user_id, balance)
  values (v_user, 1)
  on conflict (user_id) do update set
    balance = coin_balances.balance + 1,
    updated_at = now()
  returning balance into v_balance;

  return jsonb_build_object(
    'status', 'checked',
    'balance', v_balance,
    'attended_on', v_today
  );
end;
$$;

revoke all on function public.attendance_check_in()
  from public, anon, authenticated, service_role;
grant execute on function public.attendance_check_in() to authenticated;

-- ── 사용자 RPC: 코인 → 카드팩 교환 ─────────────────────────────────────────

-- 이 함수의 핵심 불변식: 코인이 빠졌으면 카드팩도 반드시 발급됐다.
--
-- 전역 카드 리워드 게이트가 OFF면 BEFORE INSERT 트리거가 draw_tickets 행을
-- 삼킨다(예외를 던지지 않는다 — 결제 확정을 깨지 않으려는 설계). 삽입 행 수를
-- 세지 않으면 그 침묵이 코인만 소각하는 결과로 나타난다.
create function public.exchange_coins_for_draw_tickets(
  p_operation_id uuid,
  p_offer_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_offer public.coin_exchange_offers%rowtype;
  v_ledger_owner uuid;
  v_balance integer;
  v_issued integer;
  v_existing_count integer;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.suspended_at is not null
  ) then
    raise exception 'account_suspended' using errcode = '55000';
  end if;

  if p_operation_id is null then
    raise exception 'invalid_operation' using errcode = '22004';
  end if;

  -- 응답이 유실된 재시도는 먼저 커밋된 원장을 관측한 뒤에 판단해야 한다
  -- (admin_grant_draw_tickets와 같은 관용구). 잠금이 없으면 두 재시도가 모두
  -- "없음"을 보고 각자 차감한 뒤 하나가 unique 위반으로 되돌아간다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('coin_exchange:' || p_operation_id::text, 0)
  );

  select ledger.user_id
    into v_ledger_owner
  from public.coin_ledger as ledger
  where ledger.operation_id = p_operation_id;

  if found then
    -- 남의 멱등 키를 재생해 잔액·발급 수를 읽어 가는 경로를 막는다.
    if v_ledger_owner is distinct from v_user then
      raise exception 'exchange_operation_conflict' using errcode = '23505';
    end if;

    select coalesce(balance, 0) into v_balance
    from public.coin_balances
    where user_id = v_user;

    select count(*)::integer into v_existing_count
    from public.draw_tickets as ticket
    where ticket.source = 'coin_exchange'
      and ticket.source_id = p_operation_id;

    return jsonb_build_object(
      'status', 'already_exchanged',
      'balance', coalesce(v_balance, 0),
      'issued_count', v_existing_count
    );
  end if;

  select offer.*
    into v_offer
  from public.coin_exchange_offers as offer
  where offer.id = p_offer_id
  for share;

  if not found or v_offer.status <> 'active' then
    raise exception 'offer_unavailable' using errcode = 'P0002';
  end if;

  perform private.assert_card_pool_ready(v_offer.pool_id);

  -- 직렬화 지점. 두 세션이 같은 잔액을 노리면 뒤에 온 쪽은 잠금 해제 후 갱신된
  -- 행으로 조건을 다시 평가해 0행을 얻는다 — 초과 인출이 성립할 창이 없다.
  update public.coin_balances
  set balance = balance - v_offer.coin_cost,
      updated_at = now()
  where user_id = v_user
    and balance >= v_offer.coin_cost
  returning balance into v_balance;

  if not found then
    raise exception 'insufficient_coins';
  end if;

  insert into public.coin_ledger (user_id, amount, reason, operation_id)
  values (v_user, -v_offer.coin_cost, 'exchange', p_operation_id);

  -- source_id = operation_id 라서 unique (source, source_id, ordinal)이 재시도
  -- 이중 발급을 DB 레벨에서 한 번 더 막는다.
  insert into public.draw_tickets (user_id, pool_id, source, source_id, ordinal)
  select v_user, v_offer.pool_id, 'coin_exchange', p_operation_id, issue_series.n
  from pg_catalog.generate_series(1, v_offer.ticket_count) as issue_series(n);

  get diagnostics v_issued = row_count;

  -- 게이트가 행을 삼켰다. 코인 차감·원장·잔액까지 전부 되돌린다.
  if v_issued <> v_offer.ticket_count then
    raise exception 'card_rewards_disabled' using errcode = '55000';
  end if;

  -- 알림은 draw_tickets STATEMENT 트리거(20260716090001)가 보낸다. 여기서 직접
  -- 넣으면 발급 한 건에 알림이 두 번 간다.
  return jsonb_build_object(
    'status', 'exchanged',
    'balance', v_balance,
    'issued_count', v_issued
  );
end;
$$;

revoke all on function public.exchange_coins_for_draw_tickets(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.exchange_coins_for_draw_tickets(uuid, uuid) to authenticated;

-- ── 어드민: 교환 상품 upsert ────────────────────────────────────────────────

create function public.admin_upsert_coin_exchange_offer(
  target_id uuid,
  target_pool_id uuid,
  target_label text,
  target_coin_cost integer,
  target_ticket_count integer,
  target_status text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_label text := btrim(coalesce(target_label, ''), E' \t\n\r\f\v');
  normalized_status text := coalesce(nullif(btrim(coalesce(target_status, '')), ''), 'active');
  normalized_ticket_count integer := coalesce(target_ticket_count, 1);
  offer_id uuid;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_label) not between 1 and 80 then
    raise exception 'invalid_offer_label' using errcode = '22023';
  end if;

  if target_coin_cost is null or target_coin_cost not between 1 and 100000 then
    raise exception 'invalid_offer_coin_cost' using errcode = '22023';
  end if;

  if normalized_ticket_count not between 1 and 10 then
    raise exception 'invalid_offer_ticket_count' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'disabled') then
    raise exception 'invalid_offer_status' using errcode = '22023';
  end if;

  -- 없는 풀을 가리키는 상품은 캠페인 화면에 "교환 가능"으로 그려진 뒤 교환
  -- 시점에야 실패한다. 등록 시점에 막는다.
  perform 1 from public.card_pools where id = target_pool_id for share;
  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if target_id is null then
    insert into public.coin_exchange_offers (pool_id, label, coin_cost, ticket_count, status)
    values (target_pool_id, normalized_label, target_coin_cost, normalized_ticket_count, normalized_status)
    returning id into offer_id;
  else
    update public.coin_exchange_offers
    set pool_id = target_pool_id,
        label = normalized_label,
        coin_cost = target_coin_cost,
        ticket_count = normalized_ticket_count,
        status = normalized_status
    where id = target_id
    returning id into offer_id;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'coin.exchange_offer.upsert',
    'coin_exchange_offers:' || offer_id::text,
    jsonb_build_object(
      'mode', case when target_id is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'poolId', target_pool_id,
        'label', normalized_label,
        'coinCost', target_coin_cost,
        'ticketCount', normalized_ticket_count,
        'status', normalized_status
      )
    )
  );

  return offer_id;
end;
$$;

revoke all on function public.admin_upsert_coin_exchange_offer(uuid, uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_coin_exchange_offer(uuid, uuid, text, integer, integer, text)
  to authenticated;
