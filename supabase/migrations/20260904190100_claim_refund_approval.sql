-- D-3 ⑩ — 환불 금액 산정 · 한도 판정 · 승인 분리 (설계서 v2 §1-3)
--
-- 「얼마를 돌려주는가」와 「누가 그걸 정할 수 있는가」를 나눈다.
-- 금액은 계산이고, 승인은 권한이다. 지금은 둘 다 승인 버튼 하나에 뭉쳐 있어서
-- 담당자가 전액 환불을 혼자 끝낼 수 있다.

create or replace function private.claim_refund_assessment(p_claim_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claim public.order_cancellation_requests;
  v_order public.orders;
  v_amount bigint;
  v_limit public.claim_refund_limits;
  v_reason_code text;
  v_always boolean := false;
begin
  select * into v_claim from public.order_cancellation_requests as claim where claim.id = p_claim_id;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders as ord where ord.id = v_claim.order_id;

  -- 금액이 이미 적혀 있으면 그것을 쓴다(부분 취소는 화면이 수량과 금액을 정한다).
  -- 없으면 「무엇을 취소하는가」로 계산한다: 품목이 지정됐으면 단가×수량, 아니면 주문 전액.
  if v_claim.refund_amount is not null then
    v_amount := v_claim.refund_amount;
  elsif v_claim.order_item_id is not null then
    select item.unit_price::bigint * coalesce(v_claim.qty, item.qty)::bigint
    into v_amount
    from public.order_items as item
    where item.id = v_claim.order_item_id;
  else
    v_amount := v_order.total;
  end if;
  v_amount := coalesce(v_amount, 0) + coalesce(v_claim.refund_shipping_fee, 0);

  v_reason_code := coalesce(
    v_claim.reason_code,
    case when v_claim.reason_type = 'defect' then 'damaged' else 'change_of_mind' end
  );
  select * into v_limit from public.claim_refund_limits as lim where lim.reason_code = v_reason_code;
  select code.always_requires_approval into v_always
  from public.claim_reason_codes as code where code.code = v_reason_code;

  return jsonb_build_object(
    'reason_code', v_reason_code,
    'amount', v_amount,
    'order_total', v_order.total,
    'max_amount_no_approval', v_limit.max_amount_no_approval,
    'max_ratio', v_limit.max_ratio,
    'always_requires_approval', coalesce(v_always, false),
    'requires_approval', (
      coalesce(v_always, false)
      -- 한도표에 줄이 없는 사유는 「모르는 사유」다. 모를 때는 사람을 부른다.
      or v_limit.reason_code is null
      or v_amount > v_limit.max_amount_no_approval
      or (v_order.total > 0 and v_amount::numeric > v_order.total::numeric * v_limit.max_ratio)
    ),
    'assessed_at', pg_catalog.now()
  );
end;
$$;

create or replace function public.admin_claim_refund_assessment(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return private.claim_refund_assessment(p_claim_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 환불 착수 — 승인 경로와 자동 경로가 같은 코드를 지난다
-- ---------------------------------------------------------------------------
create or replace function private.start_claim_refund(p_claim_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_claim public.order_cancellation_requests;
  v_order_status public.order_status;
  v_payment_count integer;
begin
  select * into v_claim from public.order_cancellation_requests as claim where claim.id = p_claim_id;
  select ord.status into v_order_status from public.orders as ord where ord.id = v_claim.order_id;

  insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
  values (v_claim.order_id, v_claim.requested_by, v_order_status)
  on conflict (order_id) do nothing;

  insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
  select payment.id, payment.amount, v_claim.reason,
         case when refund.status = 'done' then 'done' else 'requested' end,
         p_claim_id
  from public.payments as payment
  left join public.refunds as refund on refund.payment_id = payment.id
  where payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded')
  on conflict (payment_id) do update
  set cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case when public.refunds.status = 'done' then 'done' else 'requested' end;

  select pg_catalog.count(*)::integer into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded');
  return coalesce(v_payment_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 승인 — 처리자와 다른 사람이어야 한다
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_claim_refund(p_claim_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_claim public.order_cancellation_requests;
  v_assessment jsonb;
begin
  -- 승인은 관리자만 한다. 스태프가 스스로의 한도를 올릴 수 있으면 한도가 없는 것과 같다.
  if not private.is_admin_actor() then
    raise exception 'approver_role_required' using errcode = '42501';
  end if;

  select * into v_claim from public.order_cancellation_requests as claim
  where claim.id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.stage <> 'approval_pending' then
    raise exception 'claim_not_awaiting_approval' using errcode = 'P0001';
  end if;
  -- 자기가 올린 건을 자기가 승인하면 승인 절차가 서류 한 장 더 쓰는 일이 된다.
  if v_claim.decided_by = v_actor then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;

  v_assessment := private.claim_refund_assessment(p_claim_id);
  perform private.start_claim_refund(p_claim_id);

  update public.order_cancellation_requests
  set stage = 'processing',
      status = 'processing',
      approved_by = v_actor,
      approved_at = now(),
      limit_snapshot = v_assessment,
      provider_started_at = coalesce(provider_started_at, now()),
      decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note),
      updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.order.claim_refund_approved', 'order:' || v_claim.order_id::text,
          jsonb_build_object('claimId', p_claim_id, 'assessment', v_assessment));
  return 'processing';
end;
$$;

revoke all on function private.claim_refund_assessment(uuid) from public, anon, authenticated, service_role;
revoke all on function private.start_claim_refund(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_claim_refund_assessment(uuid) from public, anon, service_role;
grant execute on function public.admin_claim_refund_assessment(uuid) to authenticated;
revoke all on function public.admin_approve_claim_refund(uuid, text) from public, anon, service_role;
grant execute on function public.admin_approve_claim_refund(uuid, text) to authenticated;
