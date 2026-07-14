-- ============================================================================
-- ICONS · 주문 취소/청약철회 계약 (#92)
-- provider 취소 증거 확인 → 재고/무상 리워드/환불 장부 원자 정합화
-- ============================================================================

-- 전액 환불만 지원하는 현재 계약에서는 결제 1건당 환불 장부도 1건이다.
-- 재시도가 refunds를 중복 생성하지 않도록 DB에서 멱등 키를 고정한다.
create unique index refunds_payment_id_unique_idx
  on public.refunds (payment_id);

-- 결제 승인과 취소가 같은 주문에서 겹쳐도 교착하지 않도록 두 RPC 모두
-- 주문을 먼저 잠그고 결제 행을 잠근다. 기존 승인 동작과 멱등 계약은 유지한다.
create or replace function public.confirm_order_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_payment_key text,
  p_amount bigint,
  p_raw jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_total bigint;
  v_status public.order_status;
  v_expires_at timestamptz;
  v_existing record;
begin
  select orders.user_id, orders.total, orders.status, orders.expires_at
    into v_user, v_total, v_status, v_expires_at
  from public.orders
  where orders.id = p_order_id
  for update;

  -- 멱등: 같은 목적/대상으로 이미 처리된 키만 무시한다.
  select payments.id, payments.purpose, payments.ref_id, payments.amount, payments.status
    into v_existing
  from public.payments
  where payments.idempotency_key = p_idempotency_key
  for update;

  if v_existing.id is not null then
    if v_existing.purpose <> 'order' or v_existing.ref_id is distinct from p_order_id then
      raise exception 'idempotency conflict';
    end if;
    if v_existing.status in ('paid', 'refunded') then
      return;
    end if;
    if v_existing.status <> 'pending' then
      raise exception 'payment not payable';
    end if;
  end if;

  if v_user is null then
    raise exception 'order not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'order not payable';
  end if;
  if v_expires_at is not null and now() >= v_expires_at then
    raise exception 'order expired';
  end if;
  if p_amount <> v_total then
    raise exception 'amount mismatch';
  end if;
  if v_existing.id is not null and v_existing.amount <> p_amount then
    raise exception 'amount mismatch';
  end if;

  insert into public.payments (
    user_id,
    purpose,
    ref_id,
    amount,
    status,
    payment_key,
    idempotency_key,
    raw
  )
  values (
    v_user,
    'order',
    p_order_id,
    p_amount,
    'paid',
    p_payment_key,
    p_idempotency_key,
    p_raw
  )
  on conflict (idempotency_key) do update
    set
      status = 'paid',
      payment_key = excluded.payment_key,
      raw = excluded.raw;

  if v_status = 'pending' then
    update public.orders
    set status = 'paid', expires_at = null
    where id = p_order_id;

    insert into public.draw_tickets (user_id, pool_id, source, source_id, ordinal)
    select
      v_user,
      reward_policy.pool_id,
      'order_paid',
      p_order_id,
      row_number() over (order by reward_policy.id, grant_series.n)
    from public.reward_policies as reward_policy
    join public.card_pools as card_pool on card_pool.id = reward_policy.pool_id
    join lateral (
      select coalesce(sum(order_item.qty * order_item.unit_price), 0) as ip_subtotal
      from public.order_items as order_item
      where order_item.order_id = p_order_id
        and order_item.good_ip_id_snapshot = card_pool.ip_id
    ) as subtotal on true
    cross join lateral generate_series(1, reward_policy.tickets_per_grant) as grant_series(n)
    where reward_policy.trigger = 'order_paid'
      and reward_policy.active
      and subtotal.ip_subtotal > 0
      and subtotal.ip_subtotal >= reward_policy.min_amount
      and now() >= card_pool.active_from
      and (card_pool.active_to is null or now() < card_pool.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;
end;
$$;

revoke all on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  to service_role;

create or replace function public.cancel_order_with_provider_evidence(
  p_order_id uuid,
  p_reason text,
  p_provider_payment_keys text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.order_status;
  v_provider_payment_keys text[] := coalesce(
    array_remove(p_provider_payment_keys, null),
    array[]::text[]
  );
  v_item record;
begin
  -- 주문 잠금이 결제 확정과 취소를 직렬화한다. 잠금 뒤 결제를 다시 확인하므로
  -- 앱의 사전 조회 직후 결제가 확정되는 race도 로컬 원복으로 새지 않는다.
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  if v_status not in ('pending', 'paid', 'canceled') then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  -- 한 주문에 재시도 결제가 여럿 생겨도 결정적 순서로 모두 잠근다.
  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  -- pending/paid는 provider에 아직 돈이 남아 있을 수 있다. 서버가 실제 토스 취소에
  -- 성공했거나 ALREADY_CANCELED를 확인한 paymentKey를 모두 제시해야만 원복한다.
  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid')
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'provider cancellation required';
  end if;

  -- paid 주문은 결제 행이 없거나 failed 행만 있으면 장부가 불일치한 상태다.
  -- 이때 로컬 주문/재고를 먼저 취소하지 않고 운영 확인으로 fail closed한다.
  if v_status = 'paid' and not exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and (
        payment.status in ('canceled', 'refunded')
        or payment.payment_key = any(v_provider_payment_keys)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'payment evidence required';
  end if;

  -- canceled 주문은 이미 재고·카드팩 원복을 끝냈다. 이후 늦게 기록된 provider
  -- 결제만 아래에서 정합화하고 물류 상태는 다시 건드리지 않는다.
  if v_status <> 'canceled' then
    for v_item in
      select order_item.good_id, order_item.qty
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id
    loop
      update public.goods
      set stock_qty = stock_qty + v_item.qty
      where id = v_item.good_id;
    end loop;

    -- 미사용 카드팩만 회수한다. 이미 개봉된 카드팩과 card_grants는 무상 리워드
    -- 발급 이력으로 보존한다(ADR-0003·ADR-0004).
    delete from public.draw_tickets
    where source = 'order_paid'
      and source_id = p_order_id
      and consumed_at is null;
  end if;

  -- provider 취소 증거가 있는 결제와 이미 terminal인 결제를 한 번의 전액 환불
  -- 장부로 수렴시킨다. reason은 최초 기록을 보존해 감사 맥락을 덮어쓰지 않는다.
  insert into public.refunds (payment_id, amount, reason, status)
  select
    payment.id,
    payment.amount,
    p_reason,
    'done'
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      -- verified CANCELED key는 local failed 장부도 provider terminal 증거로 교정한다.
      or payment.payment_key = any(v_provider_payment_keys)
    )
  on conflict (payment_id) do update
  set
    amount = excluded.amount,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = 'done';

  update public.payments as payment
  set status = 'refunded'
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    );

  if v_status <> 'canceled' then
    update public.orders
    set
      status = 'canceled',
      expires_at = null
    where id = p_order_id;
  end if;
end;
$$;

-- 기존 cron과 이미 배포된 provider-terminal 반영 경로는 empty evidence wrapper를
-- 계속 사용한다. active provider payment가 생기면 내부 함수가 반드시 차단한다.
create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.cancel_order_with_provider_evidence(
    p_order_id,
    p_reason,
    array[]::text[]
  );
end;
$$;

-- SECURITY DEFINER 함수는 default privileges까지 명시적으로 제거하고 서버만 연다.
revoke all on function public.cancel_order_with_provider_evidence(uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_order_with_provider_evidence(uuid, text, text[])
  to service_role;

revoke all on function public.cancel_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_order(uuid, text)
  to service_role;

-- 환불 사유는 운영 감사 정보다. 브라우저는 본인 환불의 진행 상태에 필요한
-- 비민감 컬럼만 읽고, reason 및 직접 쓰기는 서버 신뢰 경계에 둔다.
drop policy if exists refunds_self_read on public.refunds;
create policy refunds_self_read
on public.refunds
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.payments as payment
    where payment.id = refunds.payment_id
      and payment.user_id = (select auth.uid())
  )
);

revoke all on table public.refunds from public, anon, authenticated;
grant select (
  id,
  payment_id,
  amount,
  status,
  created_at
) on table public.refunds to authenticated;

grant select, insert, update, delete on table public.refunds to service_role;
