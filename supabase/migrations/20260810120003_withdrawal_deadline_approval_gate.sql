-- ============================================================================
-- ICONS · 청약철회 기한 승인 게이트 (#189)
-- 요청 RPC의 기한 판정만으로는 부족하다. 요청 행이 다른 경로로 만들어지면
-- 승인이 그대로 전액 환불과 재고 복원을 실행한다. 돈이 걸린 판정은 승인
-- 단계에서도 다시 본다(AGENTS.md 불변).
--
-- 판정 기준 시각은 요청 시점(requested_at)이다. 운영자 검토가 늦어졌다는
-- 이유로 적법하게 접수된 요청이 소멸하면 안 된다.
-- 거절은 기한과 무관하게 열어 둔다 — 막으면 기한 초과 요청이 미결로 남아
-- 주문의 다른 상태 전이까지 잠근다.
-- ============================================================================

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
  v_delivered_at timestamptz;
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

  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
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

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_request.reason_type,
    v_request.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
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
      'reasonType', v_request.reason_type,
      'paymentCount', v_payment_count
    )
  );
end;
$$;

revoke all on function public.admin_decide_order_cancellation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_order_cancellation(uuid, text, text)
  to authenticated;
