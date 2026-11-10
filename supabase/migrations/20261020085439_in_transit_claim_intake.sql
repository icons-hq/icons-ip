begin;
-- Intake broadens to in-transit whole orders. Physical recovery is still a
-- separate prerequisite for every refund or replacement; no carrier API runs.
create function private.order_return_intake_eligible(p_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.order_all_items_delivered(p_order_id) or exists(
  select 1 from public.orders o where o.id=p_order_id and o.status='shipping'
   and exists(select 1 from public.order_items i where i.order_id=o.id)
   and exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status in ('shipping','delivered') and s.shipped_at is not null)
   and not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status='canceled')
   and not exists(select 1 from public.order_items i where i.order_id=o.id and coalesce((select sum(link.qty) from public.order_shipment_items link
    join public.order_shipments s on s.id=link.shipment_id where link.order_id=i.order_id and link.order_item_id=i.id and s.status in ('ready','shipping','delivered')),0)<>i.qty)
   and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.claim_type='exchange' and c.stage='completed'
    and (c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null))
 );
$$;
revoke all on function private.order_return_intake_eligible(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.order_claim_eligibility(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare delivery_complete boolean;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.orders o where o.id=p_order_id and (o.user_id=(select auth.uid()) or public.has_operator_capability('sales.read',false))) then return null; end if;
 delivery_complete:=private.order_return_intake_eligible(p_order_id);
 return jsonb_build_object('cancel',private.order_cancel_eligible(p_order_id),'return',delivery_complete,'exchange',delivery_complete);
end $function$;

CREATE OR REPLACE FUNCTION private.seller_claim_intake_block(p_order_id uuid, p_reason_type text, p_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare target public.orders;
begin
  select * into target from public.orders where id = p_order_id;
  if not found then return 'order_not_found'; end if;
  if target.status = 'canceled' then return 'already_canceled'; end if;
  if not private.order_return_intake_eligible(p_order_id) then return 'not_claimable'; end if;
  if public.order_withdrawal_deadline_passed(target.delivered_at, p_reason_type, p_at) then return 'deadline_expired'; end if;
  if exists (select 1 from public.order_cancellation_requests where order_id = p_order_id and status in ('requested', 'processing', 'needs_review')) then return 'already_requested'; end if;
  if exists (select 1 from public.order_cancellation_claims where order_id = p_order_id) then return 'reconciliation_in_progress'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.request_order_claim_for_parties(p_order_id uuid, p_actor uuid, p_user_id uuid, p_gift_id uuid, p_claim_type text, p_reason text, p_reason_type text, p_bank_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_account_holder text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  claim_at timestamptz;
  gift private.gift_intents;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_claim_id uuid;
  v_has_unresolved_attempt boolean;
  v_masked_account text;
  v_masked_holder text;
  v_payment_count integer;
begin
  if p_claim_type is null or p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type';
  end if;
  if p_reason_type is null or p_reason_type not in ('change_of_mind', 'defect') then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;
  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  -- Actor is the actual requester; p_user_id is exclusively the financial owner.
  if p_gift_id is null then
    if p_actor is distinct from p_user_id then return jsonb_build_object('outcome','not_found','claimId',v_claim_id);end if;
    -- Preserve the ordinary-order intake lock graph unchanged.
  else
    select * into gift from private.gift_intents where id=p_gift_id and order_id=p_order_id;
    if not found or p_actor is null or p_user_id is distinct from gift.sender_id or not(p_actor=gift.sender_id or p_actor=gift.recipient_id)
      or p_actor<>gift.sender_id and p_claim_type='cancel' then return jsonb_build_object('outcome','not_found','claimId',v_claim_id);end if;
    perform private.gift_lock_subjects(array[p_actor,gift.sender_id,gift.recipient_id]);
    if p_actor<>gift.sender_id and (p_bank_name is not null or p_account_number is not null or p_account_holder is not null) then
      raise insufficient_privilege using message='gift_payer_refund_account_required';end if;
  end if;

  -- Common intake/dispatch lock order: order → shipments → payment attempts/payments.
  select orders.user_id, orders.status, orders.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return jsonb_build_object('outcome','not_found','claimId',v_claim_id);
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
      )
  )
  into v_has_unresolved_attempt;

  claim_at:=case when p_gift_id is null then now() else clock_timestamp() end;
  if v_status = 'canceled' then
    return jsonb_build_object('outcome','already_canceled','claimId',v_claim_id);
  end if;

  -- 반품·교환은 배송 중부터 접수하되 전체 실물 회수는 후속 단계에서 검사한다.
  -- Customer cancellation is available only before order confirmation.
  if p_claim_type in ('return', 'exchange') then
    if not private.order_return_intake_eligible(p_order_id) then
      return jsonb_build_object('outcome','not_claimable','claimId',v_claim_id);
    end if;
  elsif not private.order_cancel_eligible(p_order_id) then
    return jsonb_build_object('outcome','not_cancelable','claimId',v_claim_id);
  end if;

  -- 교환도 청약철회 기한을 준용한다(변심 7일 · 하자 3개월). 판정의 진실원은
  -- 계속 order_withdrawal_deadline_passed 하나다.
  if public.order_withdrawal_deadline_passed(v_delivered_at, p_reason_type, claim_at) then
    return jsonb_build_object('outcome','deadline_expired','claimId',v_claim_id);
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return jsonb_build_object('outcome','already_requested','claimId',v_claim_id);
  end if;

  -- status는 적지 않는다. 투영은 private.order_claim_status_for_stage 하나가 만든다.
  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage,
    requested_at
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    p_claim_type,
    'requested',
    claim_at
  )
  returning id into v_claim_id;
  if p_gift_id is not null then
    insert into private.gift_claim_parties(claim_id,gift_id,payer_id,recipient_id,actual_requester)
    values(v_claim_id,p_gift_id,gift.sender_id,gift.recipient_id,p_actor);
    insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'gift.claim_requested','order:'||p_order_id,
      jsonb_build_object('giftId',p_gift_id,'claimId',v_claim_id,'claimType',p_claim_type,'reasonType',p_reason_type,'requesterParty',case when p_actor=gift.sender_id then 'sender' else 'recipient' end));
  end if;


  /*
   * 환불계좌는 무통장 환불의 유일한 경로이고 카드 fallback의 안전망이다.
   * 세 칸이 모두 있을 때만 저장한다 — 반쪽 계좌는 송금에 쓸 수 없다.
   *
   * 교환에는 저장하지 않는다. 교환의 종결은 재출고이고 어떤 경로로도 돈이
   * 돌아가지 않으므로 계좌를 받을 목적 자체가 없다. 화면은 반품에만 폼을
   * 보이지만 API로는 실어 보낼 수 있으므로 접수 함수가 거른다. 취소·반품은
   * 결제사 취소가 막혔을 때 송금이 유일한 경로라 계속 받고, 보관 기간은
   * 종결 stage에서 seal_order_claim_refund_account가 잡는다.
   */
  if p_claim_type <> 'exchange'
    and p_bank_name is not null
    and p_account_number is not null
    and p_account_holder is not null
  then
    v_masked_account := public.mask_refund_account_number(p_account_number);
    v_masked_holder := public.mask_refund_account_holder(p_account_holder);

    insert into private.claim_refund_accounts (
      claim_id,
      bank_name,
      account_number,
      account_holder,
      masked_account,
      masked_holder
    )
    values (
      v_claim_id,
      btrim(p_bank_name),
      p_account_number,
      btrim(p_account_holder),
      btrim(p_bank_name) || ' ' || v_masked_account,
      v_masked_holder
    );
  end if;

  -- 결제 이력이 없는 pending 주문은 예전처럼 즉시 종결한다.
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and not v_has_unresolved_attempt
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
      stage = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_claim_id;

    return jsonb_build_object('outcome','completed','claimId',v_claim_id);
  end if;

  /*
   * 자동 승인 — paid(발주확인 전) 변심 취소.
   *
   * 아직 발주확인도 하지 않은 주문의 변심 취소를 사람이 판단할 이유가 없다.
   * 스마트스토어와 같은 경계다. confirmed부터는 발송 준비가 시작됐으므로
   * 운영자 판단으로 남긴다.
   *
   * 승인의 실질(durable claim + 환불 intent)은 admin_decide_order_cancellation의
   * 승인 분기와 같다. decided_by는 null로 남긴다 — 사람이 누른 적이 없다.
   */
  if p_claim_type = 'cancel'
    and v_status = 'paid'
    and p_reason_type = 'change_of_mind'
  then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (p_order_id, p_user_id, v_status)
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
      p_reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      v_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
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
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');

    update public.order_cancellation_requests
    set
      stage = 'processing',
      decided_at = now(),
      provider_started_at = now(),
      updated_at = now()
    where id = v_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_user_id,
      'order.claim_auto_approved',
      'order:' || p_order_id::text,
      jsonb_build_object(
        'claimId', v_claim_id,
        'claimType', 'cancel',
        'from', 'requested',
        'to', 'processing',
        'previousOrderStatus', v_status::text,
        'reasonType', p_reason_type,
        'paymentCount', v_payment_count
      )
    );

    perform private.notify_order_claim(
      v_claim_id,
      'auto_approved',
      '취소 요청이 접수됐어요',
      '발송 전 주문이라 자동으로 승인됐습니다. 결제 취소 처리를 시작합니다.'
    );

    return jsonb_build_object('outcome','auto_approved','claimId',v_claim_id);
  end if;

  perform private.notify_order_claim(
    v_claim_id,
    'requested',
    '클레임 요청이 접수됐어요',
    '요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다.'
  );

  return jsonb_build_object('outcome','requested','claimId',v_claim_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.decide_order_claim(p_claim_id uuid, p_decision text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_claim record;
  v_next_stage text;
  v_payment_count integer;
  /*
   * 보류를 벗긴 실질 단계.
   *
   * on_hold는 절차의 단계가 아니라 그 위에 덮인 표시다. 보류 중인 클레임을
   * 판정할 때 stage만 보면 processing에서 건 보류가 "아직 착수 전"으로 보인다.
   * lib/orders/claims.ts의 orderClaimEffectiveStage와 같은 정의다.
   */
  v_effective_stage text;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('review', 'approve', 'reject', 'hold', 'resume') then
    raise check_violation using message = 'invalid claim decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if v_order_id is null then
    raise no_data_found using message = 'claim_not_found';
  end if;

  -- 잠금 순서: 주문 → 클레임. admin_decide_order_cancellation과 같다.
  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if v_claim.stage in ('completed', 'rejected') then
    raise exception using message = 'claim_not_decidable';
  end if;

  v_effective_stage := case
    when v_claim.stage = 'on_hold' then coalesce(v_claim.held_from, 'requested')
    else v_claim.stage
  end;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    /*
     * 거절은 처리에 착수하기 전에만 가능하다.
     *
     * processing·needs_review는 이미 durable claim과 refunds(status='requested')를
     * 열어 둔 상태다. 그 상태에서 요청만 rejected로 닫으면 주문은 "취소 진행 중"인
     * 채로 남고 complete_order_cancellation_request가 cancellation_request_not_processing
     * 으로 막아 돈이 갇힌다. needs_review는 Korpay 수동 복구 seam까지 함께 닫혀
     * 복구 경로가 하나도 남지 않는다. 그 단계에서 되돌릴 일이 있으면 거절이 아니라
     * 보류·정합화로 처리한다.
     */
    if v_effective_stage not in ('requested', 'in_review', 'collecting', 'collected') then
      raise exception using message = 'claim_not_rejectable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'rejected',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'rejected',
      '클레임 요청이 거절됐어요',
      '요청이 거절됐습니다. 사유: ' || p_note
    );
    return 'rejected';
  end if;

  if p_decision = 'hold' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid hold reason';
    end if;
    if v_claim.stage = 'on_hold' then
      return 'on_hold';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'on_hold',
      held_from = v_claim.stage,
      hold_reason = p_note,
      held_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_held',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'on_hold',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'held',
      '클레임 처리가 보류됐어요',
      '처리가 보류됐습니다. 사유: ' || p_note
    );
    return 'on_hold';
  end if;

  if p_decision = 'resume' then
    if v_claim.stage <> 'on_hold' then
      raise exception using message = 'claim_not_held';
    end if;

    v_next_stage := coalesce(v_claim.held_from, 'requested');

    -- status를 여기서 계산하지 않는다. held_from이 needs_review면 이 자리에서
    -- 'requested'를 적어 투영 CHECK에 막혔고, 보류가 영원히 풀리지 않았다(F3).
    update public.order_cancellation_requests
    set
      stage = v_next_stage,
      held_from = null,
      hold_reason = null,
      held_at = null,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_resumed',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'on_hold',
        'to', v_next_stage
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'resumed',
      '클레임 처리가 재개됐어요',
      '보류가 해제되어 처리가 다시 시작됐습니다.'
    );
    return v_next_stage;
  end if;

  if p_decision = 'review' then
    if v_claim.stage <> 'requested' then
      raise exception using message = 'claim_not_decidable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'in_review',
      decided_by = v_actor,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_in_review',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'requested',
        'to', 'in_review'
      )
    );
    return 'in_review';
  end if;

  -- 승인.
  if v_claim.stage not in ('requested', 'in_review') then
    raise exception using message = 'claim_not_decidable';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if v_claim.claim_type='cancel' and not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;
  if v_claim.claim_type in ('return','exchange') and not private.order_return_intake_eligible(v_order_id) then raise exception using message='order_not_claimable'; end if;
  perform private.prepare_claim_collections(p_claim_id);

  -- Money/deadline approval continues to use the original request time.
  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_claim.reason_type,
    v_claim.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  -- 취소는 회수할 물건이 없으므로 곧장 환불 처리로 간다. 반품·교환은 수거부터다.
  if v_claim.claim_type = 'cancel' then
    v_next_stage := 'processing';
  else
    v_next_stage := 'collecting';
  end if;

  if v_next_stage = 'processing' then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (v_order_id, v_claim.requested_by, v_order_status)
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
      v_claim.reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      p_claim_id
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
  end if;

  update public.order_cancellation_requests
  set
    stage = v_next_stage,
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = case when v_next_stage = 'processing' then now() else provider_started_at end,
    collecting_at = case when v_next_stage = 'collecting' then now() else collecting_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', v_next_stage,
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_claim.reason_type,
      'paymentCount', coalesce(v_payment_count, 0)
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'approved',
    '클레임 요청이 승인됐어요',
    case
      when v_next_stage = 'collecting'
        then '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.'
      else '요청이 승인됐습니다. 결제 취소 처리를 시작합니다.'
    end
  );

  return v_next_stage;
end;
$function$;

CREATE OR REPLACE FUNCTION private.gift_claim_context(p_actor uuid, p_gift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare gift private.gift_intents;claim public.order_cancellation_requests;purchase public.orders;own boolean;account private.claim_refund_accounts;begin
 select * into gift from private.gift_intents where id=p_gift_id and(p_actor=sender_id or p_actor=recipient_id);
 if not found or p_actor is null then return null;end if;
 select * into purchase from public.orders where id=gift.order_id;
 select * into claim from public.order_cancellation_requests where order_id=gift.order_id order by requested_at desc,id desc limit 1;
 own:=claim.id is not null and private.gift_claim_actor(claim.id)=p_actor;
 select * into account from private.claim_refund_accounts where claim_id=claim.id;
 return jsonb_build_object('giftId',gift.id,'isSender',p_actor=gift.sender_id,'isRecipient',p_actor=gift.recipient_id,
  'reshipmentHistory',case when p_actor=gift.recipient_id then private.order_claim_reshipment_history(gift.order_id) else '[]'::jsonb end,
  'canRequest',purchase.id is not null and private.order_return_intake_eligible(purchase.id) and purchase.status<>'canceled'
    and not exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in('requested','processing','needs_review')),
  'claim',case when claim.id is null then null else jsonb_build_object('id',claim.id,'type',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,'requestedAt',claim.requested_at,
   'isRequester',own,'canWithdraw',own and private.order_claim_withdrawal_blocker(claim) is null,
   'refundAccountNeeded',p_actor=gift.sender_id and(purchase.payment_method='bank_transfer' or claim.stage='needs_review') and claim.claim_type<>'exchange' and claim.stage not in('completed','rejected','withdrawn') and(account.claim_id is null or account.purged_at is not null),
   'maskedRefundAccount',case when p_actor=gift.sender_id then account.masked_account else null end,
   'reshipCarrier',case when p_actor=gift.recipient_id then claim.reship_carrier else null end,
   'reshipTrackingNumber',case when p_actor=gift.recipient_id then claim.reship_tracking_number else null end) end);
end $function$;

CREATE OR REPLACE FUNCTION private.admin_update_shipment_status_before_delivery_methods(p_shipment_id uuid, p_status text, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); shipment public.order_shipments; purchase public.orders;
 carrier_value text:=nullif(btrim(p_carrier),'');tracking_value text:=nullif(btrim(p_tracking_number),'');
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select o.* into purchase from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=p_shipment_id for update of o;
 if not found then raise no_data_found using message='shipment_not_found';end if;
 select * into shipment from public.order_shipments where id=p_shipment_id for update;
 if p_status is null or p_status not in ('shipping','delivered') then raise check_violation using message='invalid_shipment_status';end if;
 if shipment.status=p_status then return;end if;
 if purchase.status not in ('confirmed','shipping','delivered')
   or not ((shipment.status='ready' and p_status='shipping') or (shipment.status='shipping' and p_status='delivered')) then
   raise check_violation using message='invalid_shipment_transition';
 end if;
 if p_status<>'delivered' then perform private.assert_order_dispatch_allowed(purchase.id);end if;
 carrier_value:=coalesce(carrier_value,shipment.carrier);tracking_value:=coalesce(tracking_value,shipment.tracking_number);
 if carrier_value is null or tracking_value is null then raise check_violation using message='tracking_required';end if;
 if tracking_value !~ '^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid_tracking_input';end if;
 if carrier_value is distinct from shipment.carrier and not exists(select 1 from public.shipping_carriers where code=carrier_value and is_active) then
   raise check_violation using message='inactive_shipping_carrier';end if;
 update public.order_shipments set status=p_status,carrier=carrier_value,tracking_number=tracking_value,
   shipped_at=case when p_status='shipping' then clock_timestamp() else shipped_at end,
   delivered_at=case when p_status='delivered' then clock_timestamp() else delivered_at end,updated_at=clock_timestamp()
   where id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.status_updated','order:'||purchase.id,
   jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot,'from',shipment.status,'to',p_status,'carrier',carrier_value,'trackingNumber',tracking_value));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_record_shipment_delivery(p_shipment_id uuid, p_kind text, p_evidence jsonb, p_receipt_code text, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; operation private.shipment_delivery_operations;
  confirmation private.shipment_receipt_confirmations; evidence jsonb:='{}'; field text; allowed_fields text[]; occurred timestamptz;
  value text; confirmation_value text:=upper(regexp_replace(coalesce(p_receipt_code,''),'[[:space:]-]','','g'));
  fingerprint bytea; instant timestamptz; next_status text; max_length integer;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_operation_id is null or p_kind is null or p_kind not in ('quick_handoff','quick_receive','pickup_receive')
    or jsonb_typeof(p_evidence) is distinct from 'object' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  allowed_fields:=case when p_kind='quick_handoff' then array['operatorName','providerName','providerPhone','handoffReference','occurredAt']
    else array['operatorName','receiptReference','recipientKind','occurredAt'] end;
  if exists(select 1 from jsonb_object_keys(p_evidence) key where not key=any(allowed_fields)) then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  foreach field in array allowed_fields loop
    if jsonb_typeof(p_evidence->field) is distinct from 'string' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    value:=btrim(p_evidence->>field);
    max_length:=case when field in ('operatorName','providerName') then 100 when field='providerPhone' then 40 else 2000 end;
    if length(value) not between 1 and max_length then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    evidence:=evidence||jsonb_build_object(field,value);
  end loop;
  if evidence->>'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  begin occurred:=(evidence->>'occurredAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_delivery_evidence'; end;
  evidence:=evidence||jsonb_build_object('occurredAt',occurred);
  if p_kind<>'quick_handoff' and (evidence->>'recipientKind' not in ('self','delegate') or confirmation_value!~'^[0-9A-F]{12}$') then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  if p_kind='quick_handoff' and confirmation_value<>'' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  instant:=clock_timestamp();
  fingerprint:=extensions.digest(jsonb_build_object('actor',actor,'kind',p_kind,'evidence',evidence,'expectedAt',p_expected_updated_at,
    'receiptDigest',case when confirmation_value<>'' then encode(extensions.digest(confirmation_value,'sha256'),'hex') end)::text,'sha256');
  select * into operation from private.shipment_delivery_operations where id=p_operation_id;
  if found then
    if operation.shipment_id<>shipment.id or operation.kind<>p_kind or operation.actor_id is distinct from actor
      or operation.request_digest is distinct from fingerprint then raise sqlstate 'PT409' using message='delivery_operation_conflict'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'shipmentId',shipment.id);
  end if;
  if p_expected_updated_at is null or shipment.updated_at<>p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_delivery_changed'; end if;
  if purchase.status not in ('confirmed','shipping') or not ((shipment.delivery_method='quick' and shipment.status='ready' and p_kind='quick_handoff')
    or (shipment.delivery_method='quick' and shipment.status='shipping' and p_kind='quick_receive')
    or (shipment.delivery_method='pickup' and shipment.status='ready' and p_kind='pickup_receive')) then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  if p_kind<>'quick_receive' then perform private.assert_order_dispatch_allowed(purchase.id);end if;
  perform private.assert_shipment_preorder_ready(shipment.id);
  if occurred>instant or occurred<greatest(shipment.created_at,coalesce(purchase.confirmed_at,shipment.created_at))
    or (p_kind='quick_receive' and occurred<shipment.shipped_at) then raise check_violation using message='invalid_delivery_evidence'; end if;
  if evidence->>'recipientKind'='delegate' and shipment.delivery_method_snapshot->'allowDelegate' is distinct from 'true'::jsonb then
    raise check_violation using message='delivery_delegate_not_allowed'; end if;
  if p_kind<>'quick_handoff' then
    select * into confirmation from private.shipment_receipt_confirmations where shipment_id=shipment.id for update;
    if not found or confirmation.selection_id is distinct from shipment.delivery_selection_id or confirmation.owner_id<>purchase.user_id
      or confirmation.consumed_at is not null or confirmation.expires_at<=instant or confirmation.failed_attempts>=5 then
      return jsonb_build_object('ok',false,'error','delivery_receipt_code_unavailable'); end if;
    if confirmation.confirmation_digest is distinct from extensions.digest(confirmation_value,'sha256') then
      update private.shipment_receipt_confirmations set failed_attempts=failed_attempts+1 where shipment_id=shipment.id;
      -- Return a failure object so the failed-attempt count commits without a status change.
      return jsonb_build_object('ok',false,'error',case when confirmation.failed_attempts+1>=5 then 'delivery_receipt_code_unavailable'
        else 'delivery_receipt_code_invalid' end,'remainingAttempts',greatest(0,4-confirmation.failed_attempts));
    end if;
  end if;
  evidence:=evidence||jsonb_build_object('selectionId',shipment.delivery_selection_id,'policyId',shipment.delivery_policy_id,
    'policyRevision',shipment.delivery_method_snapshot->'revision');
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(p_operation_id,shipment.id,p_kind,actor,fingerprint,evidence);
  if p_kind<>'quick_handoff' then
    update private.shipment_receipt_confirmations set consumed_at=instant,consumed_operation_id=p_operation_id where shipment_id=shipment.id;
  end if;
  next_status:=case when p_kind='quick_handoff' then 'shipping' else 'delivered' end;
  update public.order_shipments set status=next_status,delivery_event_id=p_operation_id,
    shipped_at=case when p_kind in ('quick_handoff','pickup_receive') then occurred else shipped_at end,
    delivered_at=case when next_status='delivered' then occurred else delivered_at end,updated_at=instant where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_evidence_recorded','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'operationId',p_operation_id,'method',shipment.delivery_method,'kind',p_kind,'occurredAt',occurred));
  return jsonb_build_object('ok',true,'replayed',false,'shipmentId',shipment.id);
end $function$;

CREATE OR REPLACE FUNCTION public.guard_order_transition_during_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status is distinct from old.status
    and new.status <> 'canceled'
    -- Arrival records an already-dispatched package; it never releases a
    -- not-yet-dispatched item or advances a refund.
    and not (old.status='shipping' and new.status='delivered'
      and private.order_return_intake_eligible(old.id)
      and not exists(select 1 from public.order_shipments s where s.order_id=old.id and (s.status<>'delivered' or s.delivered_at is null))
      and not exists(select 1 from public.order_cancellation_claims c where c.order_id=old.id))
    and (
      exists (
        select 1
        from public.order_cancellation_claims as claim
        where claim.order_id = old.id
      )
      or exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = old.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'order cancellation in progress';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.record_order_claim_reshipment_physical(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid()); selected_order uuid; order_status public.order_status;
  claim public.order_cancellation_requests; item record; selected_variant uuid; source_variant uuid;
  variant public.goods_variants; carrier text:=nullif(btrim(p_carrier),''); tracking text:=nullif(btrim(p_tracking_number),'');
  selections jsonb; requested jsonb; shipped_items jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
  if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items'; end if;
  for requested in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
      or (select count(*) from jsonb_object_keys(requested))<>2
      or (requested->>'orderItemId') is null or (requested->>'variantId') is null
      or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise check_violation using message='invalid reshipment items'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
    raise check_violation using message='invalid reshipment items';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
    order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
  select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Cancellation, payment finalization and claim operations all lock order first.
  select status into order_status from public.orders where id=selected_order for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment'; end if;
  perform private.lock_goods_stock_successor_topology();
  if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id)
    or (claim.stage<>'completed' and (
      exists(select 1 from public.order_items oi cross join lateral private.order_item_physical_unit(oi.id) unit
        where oi.order_id=selected_order and (unit.good_id<>oi.good_id
          or exists(select 1 from private.goods_stock_successors where source_variant_id=unit.variant_id)
          or exists(select 1 from private.goods_group_members where variant_id=unit.variant_id)
          or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=oi.id)))
      or exists(select 1 from jsonb_array_elements(selections) x join public.order_items oi on oi.id=(x->>'orderItemId')::uuid
        join public.goods_variants v on v.id=(x->>'variantId')::uuid where oi.good_id<>v.good_id))) then
    return private.record_group_claim_reshipment(p_claim_id,carrier,tracking,selections);
  end if;
  if claim.stage='completed' then
    if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
      select 1 from jsonb_array_elements(selections) selected where not exists(
        select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
          and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
      then return 'completed'; end if;
    raise unique_violation using message='reshipment_conflict';
  end if;
  perform private.assert_claim_collections_complete(p_claim_id);
  if claim.stage<>'collected' or order_status not in('shipping','delivered','done')
    or exists(select 1 from public.order_cancellation_claims where order_id=selected_order)
    then raise exception using message='claim_not_reshippable'; end if;
  if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier'; end if;
  if exists(select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_items oi where oi.id=(selected->>'orderItemId')::uuid and oi.order_id=selected_order)) then
    raise check_violation using message='invalid reshipment items';
  end if;
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where order_id=selected_order) order by g.id for update;
  for item in select * from public.order_items where order_id=selected_order order by good_id,id loop
    source_variant:=private.order_item_stock_variant(item.id);
    select (selected->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) selected where (selected->>'orderItemId')::uuid=item.id;
    selected_variant:=coalesce(selected_variant,source_variant);
    select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
    if not found or (variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable'; end if;
    insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
      values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty);
  end loop;
  -- Net all returned/shipped options first. A two-line blue/red swap also works
  -- with no spare stock; every recovered unit belongs to this collected claim.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from (
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where claim_id=p_claim_id
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where claim_id=p_claim_id
  ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta::bigint);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $function$;

CREATE OR REPLACE FUNCTION private.record_group_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking text, p_selections jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;order_state public.order_status;receipt private.group_claim_reshipment_receipts;
 item public.order_items;physical record;target record;choice record;selected_variant uuid;allocations jsonb:='[]';entry jsonb;
 good_ids text[];variant_ids uuid[];deltas jsonb;shipped_items jsonb;inserted integer;
begin
 perform private.require_operator_capability('sales.manage',false);
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select status into order_state from public.orders where id=claim.order_id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.claim_type<>'exchange' then raise check_violation using message='claim_type_has_no_reshipment';end if;
 select * into receipt from private.group_claim_reshipment_receipts where claim_id=p_claim_id;
 if found then
  if claim.stage='completed' and receipt.actor_id=actor and receipt.carrier=p_carrier and receipt.tracking_number=p_tracking and receipt.selections=p_selections then return 'completed';end if;
  raise unique_violation using message='reshipment_conflict';
 end if;
 if claim.stage='completed' or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim_id) then
  raise unique_violation using message='reshipment_conflict';
 end if;
 perform private.assert_claim_collections_complete(p_claim_id);
 if claim.stage<>'collected' or order_state not in ('shipping','delivered','done') or exists(select 1 from public.order_cancellation_claims where order_id=claim.order_id) then
  raise check_violation using message='claim_not_reshippable';
 end if;
 if not exists(select 1 from public.shipping_carriers where code=p_carrier and is_active) then raise check_violation using message='unknown shipping carrier';end if;
 if exists(select 1 from jsonb_array_elements(p_selections) x where not exists(select 1 from public.order_items oi where oi.id=(x->>'orderItemId')::uuid and oi.order_id=claim.order_id)) then
  raise check_violation using message='invalid reshipment items';
 end if;
 perform private.lock_goods_stock_successor_topology();
 for item in select * from public.order_items where order_id=claim.order_id order by good_id,id loop
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id,physical.variant_id);
  select (x->>'variantId')::uuid into selected_variant from jsonb_array_elements(p_selections) x where (x->>'orderItemId')::uuid=item.id;
  selected_variant:=coalesce(selected_variant,target.variant_id);
  select * into choice from private.order_item_reshipment_options(item.id) where variant_id=selected_variant;
  if not found then raise check_violation using message='reshipment_variant_unavailable';end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('orderItemId',item.id,'originalGoodId',item.good_id,'originalVariantId',item.variant_id,
   'sourceGoodId',physical.good_id,'sourceVariantId',physical.variant_id,'generationKind',physical.generation_kind,'generationId',physical.generation_id,
   'returnedGoodId',target.good_id,'returnedVariantId',target.variant_id,'operationPath',to_jsonb(target.operation_path),
   'goodId',choice.good_id,'variantId',choice.variant_id,'goodName',choice.good_name,'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',item.qty));
 end loop;
 if jsonb_array_length(allocations) not between 1 and 1000 then raise check_violation using message='invalid reshipment items';end if;
 select array_agg(distinct id order by id) into good_ids from (
  select x->>'originalGoodId' id from jsonb_array_elements(allocations) x union select x->>'sourceGoodId' from jsonb_array_elements(allocations) x
  union select x->>'returnedGoodId' from jsonb_array_elements(allocations) x union select x->>'goodId' from jsonb_array_elements(allocations) x) ids;
 select array_agg(distinct id order by id) into variant_ids from (
  select (x->>'originalVariantId')::uuid id from jsonb_array_elements(allocations) x union select (x->>'sourceVariantId')::uuid from jsonb_array_elements(allocations) x
  union select (x->>'returnedVariantId')::uuid from jsonb_array_elements(allocations) x union select (x->>'variantId')::uuid from jsonb_array_elements(allocations) x) ids;
 perform 1 from public.goods where id=any(good_ids) order by id for update nowait;
 perform 1 from public.goods_variants where id=any(variant_ids) order by id for update nowait;
 -- Metadata and availability are read again after locks; topology remains fixed.
 for entry in select value from jsonb_array_elements(allocations) loop
  if not exists(select 1 from private.order_item_reshipment_options((entry->>'orderItemId')::uuid) where variant_id=(entry->>'variantId')::uuid) then
   raise sqlstate 'PT409' using message='reshipment_variant_unavailable';
  end if;
 end loop;
 insert into private.group_claim_reshipment_receipts(claim_id,actor_id,carrier,tracking_number,selections) values(p_claim_id,actor,p_carrier,p_tracking,p_selections);
 for entry in select value from jsonb_array_elements(allocations) loop
  insert into private.group_stock_restorations(order_item_id,generation_kind,generation_id,original_good_id,original_variant_id,
   source_good_id,source_variant_id,target_good_id,target_variant_id,operation_path,qty,cause,claim_id,actor_id,reason)
  values((entry->>'orderItemId')::uuid,entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,
   entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
   array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),(entry->>'qty')::integer,'exchange',p_claim_id,actor,'교환 회수품 입고') on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted<>1 then raise check_violation using message='physical_generation_already_restored';end if;
  insert into private.group_claim_reshipment_allocations(claim_id,order_item_id,original_good_id,original_variant_id,source_good_id,source_variant_id,
   source_generation_kind,source_generation_id,returned_good_id,returned_variant_id,operation_path,target_good_id,target_variant_id,
   good_name_snapshot,variant_name_snapshot,variant_code_snapshot,qty)
  select p_claim_id,(entry->>'orderItemId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,
   entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
   array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),entry->>'goodId',(entry->>'variantId')::uuid,g.name,v.name,v.code,(entry->>'qty')::integer
  from public.goods g join public.goods_variants v on v.good_id=g.id where v.id=(entry->>'variantId')::uuid and g.id=entry->>'goodId';
 end loop;
 select jsonb_agg(value) into deltas from (
  select jsonb_build_object('goodId',a.returned_good_id,'variantId',a.returned_variant_id,'delta',a.qty) value from private.group_claim_reshipment_allocations a where claim_id=p_claim_id
  union all select jsonb_build_object('goodId',a.target_good_id,'variantId',a.target_variant_id,'delta',-a.qty) from private.group_claim_reshipment_allocations a where claim_id=p_claim_id) movement;
 perform private.apply_group_physical_stock_deltas(deltas);
 select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'originalGoodId',r.original_good_id,'sourceGoodId',r.source_good_id,'sourceVariantId',r.source_variant_id,
  'goodId',r.good_id,'variantId',r.variant_id,'qty',r.qty) order by r.order_item_id),'[]') into shipped_items from private.claim_reshipment_items_read(p_claim_id) r;
 update public.order_cancellation_requests set stage='completed',reship_carrier=p_carrier,reship_tracking_number=p_tracking,reshipped_at=clock_timestamp(),completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_claim_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||claim.order_id::text,
  jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',p_carrier,'items',shipped_items));
 perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
 return 'completed';
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$function$;

-- A whole-order replacement can be the first physical supply when the
-- original parcel was recalled in transit. Its own receipt is the evidence;
-- the original shipment timestamps are never fabricated or overwritten.
create or replace function private.order_all_items_delivered(target_order uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=target_order and o.status in ('delivered','done'))
  and exists(select 1 from public.order_items i where i.order_id=target_order)
  and (not exists(select 1 from public.order_items i where i.order_id=target_order and
    coalesce((select sum(link.qty) from public.order_shipment_items link join public.order_shipments s on s.id=link.shipment_id
     where link.order_item_id=i.id and link.order_id=i.order_id and s.status='delivered' and s.delivered_at is not null),0)<>i.qty)
   or exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
    and c.reship_delivered_at is not null and c.reship_delivered_by is not null and c.reship_delivery_evidence is not null and private.claim_collections_complete(c.id)))
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
    and (c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null));
$$;
revoke all on function private.order_all_items_delivered(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment_delivery(p_claim_id uuid, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid());
  order_key uuid;
  claim public.order_cancellation_requests;
  observed_at timestamptz;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message='staff required';
  end if;
  if p_evidence is null or p_evidence<>btrim(p_evidence)
    or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise check_violation using message='invalid_reshipment_delivery_evidence';
  end if;
  select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Same parent-first ordering as intake and reshipment: concurrent confirmation
  -- cannot reopen intake against a different replacement transaction.
  perform id from public.orders where id=order_key for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  observed_at:=clock_timestamp();
  if claim.claim_type<>'exchange' or claim.stage<>'completed' or claim.reshipped_at is null
    or claim.reship_carrier is null or btrim(claim.reship_carrier)=''
    or claim.reship_tracking_number is null or btrim(claim.reship_tracking_number)=''
    or claim.reshipped_at>observed_at then
    raise check_violation using message='claim_reshipment_not_dispatched';
  end if;
  if claim.reship_delivered_at is not null then
    if claim.reship_delivered_by=actor and claim.reship_delivery_evidence=p_evidence then return 'delivered'; end if;
    raise unique_violation using message='reshipment_delivery_conflict';
  end if;
  update public.order_cancellation_requests
    set reship_delivered_at=observed_at,reship_delivered_by=actor,reship_delivery_evidence=p_evidence
    where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'admin.order.claim_reshipment_delivered','order:'||order_key::text,
      jsonb_build_object('claimId',p_claim_id,'reshippedAt',claim.reshipped_at,
        'reshipDeliveredAt',observed_at,'evidence',p_evidence));
  if exists(select 1 from public.orders where id=order_key and status='shipping' and delivered_at is null)
    and private.claim_collections_complete(p_claim_id) and not exists(select 1 from public.order_cancellation_requests c where c.order_id=order_key
      and c.claim_type='exchange' and c.stage='completed' and (c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null)) then
    update public.orders set status='delivered',delivered_at=observed_at where id=order_key and status='shipping' and delivered_at is null;
  end if;
  return 'delivered';
end $function$;

commit;
