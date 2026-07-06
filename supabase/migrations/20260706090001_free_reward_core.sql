-- ============================================================================
-- ICONS · 무료 리워드 발급 코어 — 뽑기권(카드팩) 개봉 모델 (#62)
-- draw_tickets · reward_policies · card_grants · grant_cards · open_draw_ticket
--   + confirm_order_payment 뽑기권 발급 부수효과 / cancel_order 미사용 뽑기권 회수
-- 근거: docs/adr/0004-draw-ticket-card-packs.md · docs/adr/0003-free-reward-pivot.md
-- 원칙: 카드에 닿는 유상 경로를 만들지 않는다(무상 구조 코드 보장).
--       결과는 서버가 결정하고 클라이언트 개봉 연출은 코스메틱(ADR-0002 규율).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 뽑기권 발급 정책 — trigger별(현재 order_paid만). 게임 보상은 games.reward_pool_id
-- 직접 발급(#64)이라 여기를 거치지 않는다. popups 미구현 단계라 풀(=IP) 기준 스코프.
-- ---------------------------------------------------------------------------
create table public.reward_policies (
  id                uuid primary key default extensions.gen_random_uuid(),
  pool_id           uuid not null references public.card_pools (id) on delete cascade,
  trigger           text not null check (trigger in ('order_paid')),
  min_amount        bigint not null default 0 check (min_amount >= 0),  -- 풀 IP 굿즈 소계 기준(KRW)
  tickets_per_grant integer not null default 1 check (tickets_per_grant between 1 and 100),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_reward_policies_updated before update on public.reward_policies
  for each row execute function public.set_updated_at();
create index reward_policies_trigger_idx on public.reward_policies (trigger, active);

-- ---------------------------------------------------------------------------
-- 뽑기권(UI "카드팩") — 낱장 모델: 티켓 1행 = 개봉 1회 = 카드 1장.
-- 풀 바인딩 · 무기한(만료 컬럼 없음) · 천장 없음 (ADR-0004)
-- ---------------------------------------------------------------------------
create table public.draw_tickets (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  pool_id     uuid not null references public.card_pools (id),
  source      text not null check (source in ('order_paid')),
  source_id   uuid not null,
  ordinal     integer not null check (ordinal > 0),
  consumed_at timestamptz,                          -- null = 미사용
  created_at  timestamptz not null default now(),
  unique (source, source_id, ordinal)               -- 발급 멱등(재처리 이중 발급 방지)
);
create index draw_tickets_user_idx on public.draw_tickets (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 카드 발급 이력 — 유료 pulls 대체(무상). 개봉(·이후 #64 게임) 트리거.
-- ---------------------------------------------------------------------------
create table public.card_grants (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  pool_id         uuid not null references public.card_pools (id),
  source          text not null check (source in ('draw_ticket')),
  source_id       uuid not null,
  granted_cards   jsonb not null,                   -- [{cardId, rarity, isNew}]
  idempotency_key text not null unique,             -- 'draw_ticket:<ticket_id>' 네임스페이스
  created_at      timestamptz not null default now()
);
create index card_grants_user_idx on public.card_grants (user_id, created_at desc);

-- ============================================================================
-- RPC
-- ============================================================================

-- 카드 발급 프리미티브: pool_odds 기반(roll_rarity) 무작위 무상 발급 + 바인더 적립.
-- 내부 호출 전용 — open_draw_ticket(·이후 #64 play_game) 안에서만 부른다.
-- 결제로 카드·뽑기권을 직접 사는 RPC는 존재하지 않는다(ADR-0003 규제 가드).
create or replace function public.grant_cards(
  p_user_id uuid, p_pool_id uuid, p_source text, p_source_id uuid,
  p_idempotency_key text, p_count integer default 1
)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_cards    jsonb := '[]'::jsonb;
  v_rarity   rarity;
  v_card     text;
  v_new      boolean;
begin
  if p_count < 1 or p_count > 100 then raise exception 'invalid count'; end if;

  -- 멱등: 같은 키의 기존 발급이 있으면 그 결과를 그대로 반환
  select granted_cards into v_existing from card_grants where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  for i in 1..p_count loop
    v_rarity := roll_rarity(p_pool_id);
    select c.id into v_card from cards c
      where c.pool_id = p_pool_id and c.rarity = v_rarity
      order by random() limit 1;
    if v_card is null then raise exception 'pool has no card of rarity %', v_rarity; end if;

    v_new := not exists (
      select 1 from user_cards uc where uc.user_id = p_user_id and uc.card_id = v_card
    );
    insert into user_cards as uc (user_id, card_id, qty) values (p_user_id, v_card, 1)
      on conflict on constraint user_cards_pkey do update set qty = uc.qty + 1;

    v_cards := v_cards || jsonb_build_object('cardId', v_card, 'rarity', v_rarity, 'isNew', v_new);
  end loop;

  insert into card_grants (user_id, pool_id, source, source_id, granted_cards, idempotency_key)
  values (p_user_id, p_pool_id, p_source, p_source_id, v_cards, p_idempotency_key);
  return v_cards;
end; $$;

-- 뽑기권 개봉: 본인·미사용 검증 → 행 잠금 → 서버가 카드 결정 → 소비 기록.
-- 미사용 티켓은 풀 운영 기간과 무관하게 개봉 가능(무기한, ADR-0004).
-- 멱등: 이미 개봉된 티켓을 재요청하면 동일한 발급 결과를 반환한다(결과 불변).
create or replace function public.open_draw_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user   uuid := (select auth.uid());
  v_ticket record;
  v_cards  jsonb;
  v_idem   text;
begin
  if v_user is null then raise exception 'auth required'; end if;

  select id, user_id, pool_id, consumed_at into v_ticket
    from draw_tickets where id = p_ticket_id for update;
  if v_ticket.id is null then raise exception 'ticket not found'; end if;
  if v_ticket.user_id <> v_user then raise exception 'forbidden'; end if;

  v_idem := 'draw_ticket:' || v_ticket.id::text;

  if v_ticket.consumed_at is not null then
    select granted_cards into v_cards from card_grants where idempotency_key = v_idem;
    if v_cards is not null then return v_cards; end if;  -- 멱등 재생
    raise exception 'ticket already consumed';
  end if;

  v_cards := grant_cards(v_user, v_ticket.pool_id, 'draw_ticket', v_ticket.id, v_idem, 1);
  update draw_tickets set consumed_at = now() where id = p_ticket_id;
  return v_cards;
end; $$;

-- 결제 확정(웹훅): 멱등. 주문을 paid로. (P1 본문 유지 + ★뽑기권 발급 부수효과 추가)
create or replace function public.confirm_order_payment(
  p_idempotency_key text, p_order_id uuid, p_payment_key text, p_amount bigint, p_raw jsonb
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_total bigint; v_status order_status; v_expires_at timestamptz;
        v_existing record;
begin
  -- 멱등: 같은 목적/대상으로 이미 처리된 키만 무시한다.
  select id, purpose, ref_id, amount, status into v_existing
    from payments where idempotency_key = p_idempotency_key for update;
  if v_existing.id is not null then
    if v_existing.purpose <> 'order' or v_existing.ref_id is distinct from p_order_id then
      raise exception 'idempotency conflict';
    end if;
    if v_existing.status in ('paid', 'refunded') then return; end if;
    if v_existing.status <> 'pending' then raise exception 'payment not payable'; end if;
  end if;

  select user_id, total, status, expires_at into v_user, v_total, v_status, v_expires_at
    from orders where id = p_order_id for update;
  if v_user is null then raise exception 'order not found'; end if;
  if v_status <> 'pending' then raise exception 'order not payable'; end if;
  if v_expires_at is not null and now() >= v_expires_at then raise exception 'order expired'; end if;
  if p_amount <> v_total then raise exception 'amount mismatch'; end if;
  if v_existing.id is not null and v_existing.amount <> p_amount then raise exception 'amount mismatch'; end if;

  insert into payments (user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, raw)
  values (v_user, 'order', p_order_id, p_amount, 'paid', p_payment_key, p_idempotency_key, p_raw)
  on conflict (idempotency_key) do update set status = 'paid', payment_key = excluded.payment_key, raw = excluded.raw;

  if v_status = 'pending' then
    update orders set status = 'paid', expires_at = null where id = p_order_id;

    -- ★ 무상 뽑기권(카드팩) 발급 부수효과(ADR-0004).
    -- 정책 매칭은 풀 바인딩 서사대로 IP 스코프: 풀의 IP에 속한 굿즈 소계가 min_amount 이상일 때만.
    -- 발급 시점엔 풀이 운영 중이어야 한다(풀 종료 = 신규 발급 중단).
    insert into draw_tickets (user_id, pool_id, source, source_id, ordinal)
    select v_user, rp.pool_id, 'order_paid', p_order_id,
           row_number() over (order by rp.id, gs.n)
    from reward_policies rp
    join card_pools cp on cp.id = rp.pool_id
    join lateral (
      select coalesce(sum(oi.qty * oi.unit_price), 0) as ip_subtotal
      from order_items oi
      join goods g on g.id = oi.good_id
      where oi.order_id = p_order_id and g.ip_id = cp.ip_id
    ) sub on true
    cross join lateral generate_series(1, rp.tickets_per_grant) as gs(n)
    where rp.trigger = 'order_paid'
      and rp.active
      and sub.ip_subtotal > 0
      and sub.ip_subtotal >= rp.min_amount
      and now() >= cp.active_from and (cp.active_to is null or now() < cp.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;
end; $$;

-- 주문 취소/환불: 재고 복원 + refunds 기록. (P1 본문 유지 + ★미사용 뽑기권 회수 추가)
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_status order_status; v_pay uuid; v_amt bigint; v_staff boolean := is_staff(); r record;
begin
  select user_id, status into v_user, v_status from orders where id = p_order_id for update;
  if v_user is null then raise exception 'order not found'; end if;
  if (select auth.uid()) <> v_user and not v_staff then raise exception 'forbidden'; end if;
  if v_status = 'canceled' then return; end if;
  if not v_staff and v_status not in ('pending', 'paid') then raise exception 'order not cancelable'; end if;

  for r in select good_id, qty from order_items where order_id = p_order_id loop
    update goods set stock_qty = stock_qty + r.qty where id = r.good_id;
  end loop;

  update orders set status = 'canceled' where id = p_order_id;

  -- ★ 미사용 뽑기권 회수(개봉된 티켓·발급된 카드는 회수하지 않음 — 무상 리워드).
  --   재고 복원과 같은 운영 상태 원복이며, 발급 이력(card_grants)은 그대로 남는다.
  delete from draw_tickets
    where source = 'order_paid' and source_id = p_order_id and consumed_at is null;

  select id, amount into v_pay, v_amt from payments
    where purpose = 'order' and ref_id = p_order_id and status = 'paid' limit 1;
  if v_pay is not null then
    insert into refunds (payment_id, amount, reason) values (v_pay, v_amt, p_reason);
    update payments set status = 'refunded' where id = v_pay;
  end if;
end; $$;

-- ============================================================================
-- RLS · 권한
-- ============================================================================
alter table public.reward_policies enable row level security;
alter table public.draw_tickets    enable row level security;
alter table public.card_grants     enable row level security;

-- 발급 정책은 공개 읽기(카탈로그성), staff 쓰기 — card_pools 패턴과 동일
create policy reward_policies_read   on public.reward_policies for select using (true);
create policy reward_policies_insert on public.reward_policies for insert with check ((select public.is_staff()));
create policy reward_policies_update on public.reward_policies for update using ((select public.is_staff())) with check ((select public.is_staff()));
create policy reward_policies_delete on public.reward_policies for delete using ((select public.is_staff()));

-- 뽑기권·발급 이력은 본인 읽기만. 쓰기는 전부 RPC로만(직접 쓰기 정책 없음).
create policy draw_tickets_self_read on public.draw_tickets for select using ((select auth.uid()) = user_id);
create policy card_grants_self_read  on public.card_grants  for select using ((select auth.uid()) = user_id);

grant select on public.reward_policies to anon, authenticated;
grant insert, update, delete on public.reward_policies to authenticated;
grant select on public.draw_tickets, public.card_grants to authenticated;

-- ⚠️ Supabase는 default privileges로 신규 함수에 anon/authenticated/service_role의
--    execute를 자동 부여한다. public만 revoke해서는 봉인되지 않으므로 롤별로 명시 revoke.
-- grant_cards는 내부 전용 — 어떤 클라이언트 롤도 실행 불가(유상/직접 발급 경로 부재 보장).
revoke all on function public.grant_cards(uuid, uuid, text, uuid, text, integer)
  from public, anon, authenticated, service_role;
-- 개봉은 사용자 시작 RPC — authenticated만.
revoke all on function public.open_draw_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.open_draw_ticket(uuid) to authenticated;

-- 기존 P1 함수 ACL 교정(같은 default-privileges 함정으로 anon/authenticated에 열려 있었음).
-- 결제 확정은 웹훅(service_role) 전용 — 클라이언트가 직접 주문을 paid로 만들 수 없어야 한다.
revoke all on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_order_payment(text, uuid, text, bigint, jsonb) to service_role;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, text) to authenticated, service_role;
