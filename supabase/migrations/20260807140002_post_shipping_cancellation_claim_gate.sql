-- ============================================================================
-- ICONS · 배송 후 청약철회 finalizer의 fail closed 복원
--
-- 20260807120001(#176)이 finalizer의 상태 게이트만 shipping·done으로 넓히면서
-- "배송된 주문을 취소해도 되는가"의 판단 근거가 사라졌다. 상태만 보는 게이트는
-- staff 결정도 청약철회 요청도 없는 호출을 그대로 통과시킨다.
--
-- 실제 도달 경로는 service_role 호환 wrapper(cancel_order_with_provider_evidence)와
-- 결제 웹훅의 TOCTOU다. 웹훅은 orders를 잠금 없이 읽어 paid로 판단한 뒤 RPC를
-- 부르는데, 그 사이 staff가 shipping으로 전이하면 finalizer가 보는 실제 상태는
-- shipping이다. 예전에는 DB가 raise해 500 fail closed였지만 지금은 통과해
-- 배송 중인 굿즈의 할당 재고가 복원되고 반품 입고 근거 없이 주문이 취소된다.
--
-- 배송 후 취소의 유일한 정당 경로는 staff 승인이 남기는 durable claim이다(D10·D11).
-- shipping·done에서는 claim 존재를 요구해 승인 경로 밖 호출을 다시 거절한다.
-- 배송 전(pending·paid)과 canceled 재시도 경로의 동작은 그대로 둔다.
-- ============================================================================

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

  -- 배송이 나간 뒤의 취소는 staff 결정이 남긴 durable claim이 반드시 선행한다.
  -- claim이 없다는 것은 승인 경로 밖에서 들어왔다는 뜻이므로 거절한다.
  if v_status in ('shipping', 'done') and not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
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
