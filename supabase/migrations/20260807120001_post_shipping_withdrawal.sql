-- ============================================================================
-- ICONS · 배송 후 청약철회 경로 (#176)
-- 기존 청약철회 인프라의 상태 제약만 넓혀 shipping·done 주문을 재사용한다(D10).
-- 반품 입고 확인은 별도 상태가 아니라 운영자 승인 행위에 내포되므로(D11)
-- 상태기계·orchestrator·환불 장부 계약은 그대로 둔다.
-- ============================================================================

-- durable claim은 승인 시점의 원상태를 기록한다. 배송 후 승인도 같은 claim을
-- 쓰므로 shipping·done을 허용값에 추가한다.
alter table public.order_cancellation_claims
  drop constraint order_cancellation_claims_previous_status_check;
alter table public.order_cancellation_claims
  add constraint order_cancellation_claims_previous_status_check
  check (previous_status in ('pending', 'paid', 'shipping', 'done'));

-- 사용자 요청 진입점. 배송 전 계약(결제 없는 pending 즉시 정리, 그 외 requested
-- 보류)은 그대로 두고 허용 상태만 넓힌다.
create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_user_id uuid,
  p_reason text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_request_id uuid;
begin
  select orders.user_id, orders.status
  into v_user_id, v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  if v_status not in ('pending', 'paid', 'shipping', 'done') then
    return 'not_cancelable';
  end if;

  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return 'already_requested';
  end if;

  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    status
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    'requested'
  )
  returning id into v_request_id;

  if v_status = 'pending'
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_request_id;

    return 'completed';
  end if;

  return 'requested';
end;
$$;

revoke all on function public.request_order_cancellation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_order_cancellation(uuid, uuid, text)
  to service_role;

-- staff 결정. 승인은 배송 후에도 같은 claim·환불 intent를 만들고, 재고 복원은
-- 이후 finalizer가 담당한다. 물건을 받은 뒤 승인한다는 전제에서 정확하다.
create or replace function public.admin_decide_order_cancellation(
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_request record;
  v_payment_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise check_violation using message = 'invalid cancellation decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select orders.status
  into v_order_status
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request.status <> 'requested' then
    raise exception using message = 'cancellation_request_not_decidable';
  end if;

  if v_order_status not in ('pending', 'paid', 'shipping', 'done') then
    raise exception using message = 'order_not_cancelable';
  end if;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    update public.order_cancellation_requests
    set
      status = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.cancellation_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'from', 'requested',
        'to', 'rejected',
        'reason', p_note
      )
    );
    return;
  end if;

  insert into public.order_cancellation_claims (
    order_id,
    requested_by,
    previous_status
  )
  values (
    v_order_id,
    v_request.requested_by,
    v_order_status
  )
  on conflict (order_id) do nothing;

  insert into public.refunds (
    payment_id,
    amount,
    reason,
    status,
    cancellation_request_id
  )
  select
    payment.id,
    payment.amount,
    v_request.reason,
    case when refund.status = 'done' then 'done' else 'requested' end,
    p_request_id
  from public.payments as payment
  left join public.refunds as refund on refund.payment_id = payment.id
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded')
  on conflict (payment_id) do update
  set
    cancellation_request_id = excluded.cancellation_request_id,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = case
      when public.refunds.status = 'done' then 'done'
      else 'requested'
    end;

  select count(*)::integer
  into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded');

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = now(),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'requested',
      'to', 'processing',
      'previousOrderStatus', v_order_status::text,
      'paymentCount', v_payment_count
    )
  );
end;
$$;

revoke all on function public.admin_decide_order_cancellation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_order_cancellation(uuid, text, text)
  to authenticated;

-- finalizer. 배송 후 취소도 재고 복원·카드팩 회수·전액 환불 장부를 한 트랜잭션에서
-- 처리한다. shipping·done 주문은 결제가 반드시 선행하므로 결제 증거 요구를
-- paid와 동일하게 적용한다.
create or replace function public.finalize_order_cancellation_with_provider_evidence(
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
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  if v_status not in ('pending', 'paid', 'shipping', 'done', 'canceled') then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

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

  if v_status in ('paid', 'shipping', 'done') and not exists (
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

    perform ticket.id
    from public.draw_tickets as ticket
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null
    order by ticket.id
    for update;

    update public.draw_tickets as ticket
    set revoked_at = now()
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null;
  end if;

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

  delete from public.order_cancellation_claims
  where order_id = p_order_id;
end;
$$;

-- finalizer는 검증된 내부 경로에서만 호출한다. 공개 grant를 만들지 않는다.
revoke all on function public.finalize_order_cancellation_with_provider_evidence(
  uuid, text, text[]
) from public, anon, authenticated, service_role;
