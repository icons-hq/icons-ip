begin;

create function private.order_has_digital_items(p_order uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.order_items where order_id=p_order and fulfillment_terms_snapshot->>'mode'='digital');
$$;
alter function private.order_has_digital_items(uuid) owner to postgres;
revoke all on function private.order_has_digital_items(uuid) from public,anon,authenticated,service_role;


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
 return jsonb_build_object('cancel',private.order_cancel_eligible(p_order_id),'return',delivery_complete,'exchange',delivery_complete and not private.order_has_digital_items(p_order_id));
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
  v_expired_prepared_attempt_id uuid;
  v_attempt_state text;
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
    if not private.order_return_intake_eligible(p_order_id) or (p_claim_type='exchange' and private.order_has_digital_items(p_order_id)) then
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

  /*
   * 결제 유효 시간이 이미 지난 결제 준비(prepared) 시도는 미해결이 아니다
   * (2026-10-12 브라우저 QA QA-1).
   *
   * 위에서 잡은 order → shipments → attempt 잠금 아래에서만 판정한다. 만료된
   * prepared 시도는 claim_goods_payment_attempt가 잠금 전·후 두 번 모두
   * goods_payment_attempt_expired로 거절하므로, 늦게 도착한 결제 완료 리디렉트가
   * 있어도 서버는 승인 API를 부르지 않는다. 토스는 인증을 마친 결제(IN_PROGRESS)도
   * 승인 API를 부르지 않으면 매입하지 않고 EXPIRED로 닫는다(코어 API Payment.status,
   * 웹훅 이벤트 PAYMENT_STATUS_CHANGED). Korpay도 confirm 호출 전에는 승인하지 않는다.
   *
   * 그래서 결제 원장이 없는 결제 대기 주문의 취소라면 그 시도를 expire_stale_checkouts·
   * reconcile_expired_prepared_goods_cancellation과 같은 규칙(prepared → canceled,
   * claim 토큰 제거, 만료 재확인을 갱신 조건에 둔다)으로 닫고 아래 즉시 종결로
   * 보낸다. 지금까지는 만료 여부와 상관없이 prepared를 미해결로 세어 요청을
   * requested로 남겼고, 재고·쿠폰·적립금이 결제 기한 + 5분 sweep까지 묶였다.
   *
   * 유효 시간이 남은 prepared, confirming·unknown·needs_review·approved는 종전처럼
   * 미해결이다. 결제 원장이 하나라도 있으면(실패 행 포함) 시도를 건드리지 않는다 —
   * 즉시 종결 조건과 같아야 시도만 닫히고 요청이 남는 중간 상태가 생기지 않는다.
   * 굿즈 주문의 시도는 하나다(payment_attempts_one_goods_order_idx).
   */
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    update public.payment_attempts as attempt
    set
      state = 'canceled',
      claim_token = null,
      claim_expires_at = null
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state = 'prepared'
      and attempt.expires_at is not null
      and attempt.expires_at <= pg_catalog.clock_timestamp()
    returning attempt.id into v_expired_prepared_attempt_id;

    if v_expired_prepared_attempt_id is not null then
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
    end if;
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

    -- 위에서 닫은 만료 시도는 reconcile_expired_prepared_goods_cancellation과 같은
    -- 결과 어휘로 남긴다. actor는 취소를 누른 구매자다.
    if v_expired_prepared_attempt_id is not null then
      insert into public.audit_log (actor_id, action, target, diff)
      values (
        p_actor,
        'order.prepared_goods_cancellation_completed',
        'order:' || p_order_id::text,
        jsonb_build_object(
          'attemptId', v_expired_prepared_attempt_id,
          'requestId', v_claim_id,
          'outcome', 'expired_no_capture',
          'trigger', 'customer_cancel_request'
        )
      );
    end if;

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
    and not exists(select 1 from private.order_production_jobs where order_id=p_order_id and claim_id is null and started_at is not null)
    and not exists(select 1 from private.order_digital_downloads where order_id=p_order_id)
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

  if p_claim_type = 'cancel' and v_status = 'pending' then
    select attempt.state
    into v_attempt_state
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
    order by attempt.id
    limit 1;

    perform private.notify_order_claim(
      v_claim_id,
      'requested',
      '취소 요청이 접수됐어요',
      case v_attempt_state
        when 'prepared' then
          '결제가 끝나지 않은 주문이라 결제 기한이 지나면 결제 없이 자동으로 취소되고 알림을 보내드려요.'
        when 'confirming' then
          '결제 승인 결과를 확인한 뒤 주문 취소를 마무리합니다. 승인됐다면 결제를 취소하고, 승인되지 않았다면 결제 없이 취소한 뒤 알림을 보내드려요.'
        else
          '결제 결과를 확인한 뒤 주문 취소를 마무리하고 진행 상황을 알려드립니다.'
      end
    );

    return jsonb_build_object('outcome','requested','claimId',v_claim_id);
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


CREATE OR REPLACE FUNCTION public.admin_seller_claim_intake_context(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.orders; result jsonb; observed_at timestamptz := clock_timestamp();
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  perform (select auth.uid());
  select * into target from public.orders where id = p_order_id;
  if not found then return null; end if;
  select jsonb_build_object(
    'orderId', target.id, 'orderStatus', target.status, 'orderTotal', target.total,
    'buyerName', profile.nickname, 'createdAt', target.created_at, 'deliveredAt', target.delivered_at,
    'address', target.address, 'observedAt', observed_at,
    'cancelBlockedReason',private.seller_cancel_intake_block(target.id),
    'digitalExchangeBlocked',private.order_has_digital_items(target.id),
    'blockedReasons', jsonb_build_object(
      'change_of_mind', private.seller_claim_intake_block(target.id, 'change_of_mind', observed_at),
      'defect', private.seller_claim_intake_block(target.id, 'defect', observed_at)),
    'activeClaim', (select jsonb_build_object('id', c.id, 'claimType', c.claim_type, 'stage', c.stage)
      from public.order_cancellation_requests c where c.order_id = target.id and c.status in ('requested', 'processing', 'needs_review') order by c.requested_at desc limit 1),
    'collections', private.seller_claim_collection_targets(target.id),
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'active', c.is_active, 'trackingUrlTemplate', c.tracking_url_template) order by c.sort_order, c.code)
      from public.shipping_carriers c where c.is_active), '[]'),
    'inquiries', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'title', i.title, 'createdAt', i.created_at) order by i.created_at desc)
      from (select * from public.inquiries where user_id = target.user_id and order_id = target.id order by created_at desc, id limit 50) i), '[]')
  ) into result from public.profiles profile where profile.id = target.user_id;
  return result;
end $function$;


CREATE OR REPLACE FUNCTION public.admin_submit_seller_claim_intake(p_request_id uuid, p_payload jsonb, p_refund_account jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid()); target public.orders;
  previous private.seller_order_claim_intakes; saved_payload jsonb; collections jsonb; targets jsonb;
  block text; submitted_at timestamptz; requested_at timestamptz; target_id uuid;
begin
  perform private.require_operator_capability('sales.manage',false);

  if p_request_id is null then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  perform private.validate_seller_claim_intake(p_payload, p_refund_account);
  target_id := (p_payload->>'orderId')::uuid;
  requested_at := (p_payload->>'customerRequestedAt')::timestamptz;
  -- Raw bank details have exactly one storage destination and its existing purge
  -- lifecycle. The idempotency receipt stores only their SHA-256 fingerprint.
  saved_payload := p_payload || jsonb_build_object('refundAccountDigest',
    case when p_refund_account is null or p_refund_account = 'null'::jsonb then null
      else encode(extensions.digest(p_refund_account::text, 'sha256'), 'hex') end);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:' || p_request_id, 0));
  select * into previous from private.seller_order_claim_intakes where claim_id = p_request_id;
  if found then
    if previous.actor_id <> actor or previous.payload <> saved_payload then
      raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
    end if;
    return private.seller_claim_intake_json(p_request_id);
  end if;
  if exists(select 1 from public.order_cancellation_requests where id = p_request_id) then
    raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
  end if;

  -- Same parent-first order as customer intake and dispatch. No financial
  -- operation is performed after these locks; they only stabilize eligibility.
  select * into target from public.orders where id = target_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform s.id from public.order_shipments s where s.order_id = target_id order by s.id for update;
  perform attempt.id from public.payment_attempts attempt where attempt.purpose = 'order' and attempt.ref_id = target_id order by attempt.id for update;
  if p_payload->>'claimType'='exchange' and private.order_has_digital_items(target_id) then
    raise check_violation using message='digital_exchange_unavailable'; end if;
  submitted_at := clock_timestamp();
  block := case when p_payload->>'claimType'='cancel' then private.seller_cancel_intake_block(target_id)
    else private.seller_claim_intake_block(target_id, p_payload->>'reasonType', submitted_at) end;
  if block is not null then raise check_violation using message = block; end if;
  if requested_at < target.created_at or requested_at > submitted_at then
    raise invalid_parameter_value using message = 'invalid_seller_claim_customer_time';
  end if;
  if p_payload->>'source' = 'inquiry' then
    perform 1 from public.inquiries where id = (p_payload->>'inquiryId')::uuid and user_id = target.user_id and order_id = target_id for share;
    if not found then raise check_violation using message = 'seller_claim_inquiry_mismatch'; end if;
  end if;
  if p_payload->>'claimType'='cancel' then
    collections:='[]'::jsonb;
  else
  targets := private.seller_claim_collection_targets(target_id);
  if jsonb_array_length(targets) <> jsonb_array_length(p_payload->'collections')
    or (select count(distinct (x->>'shipmentId')::uuid) from jsonb_array_elements(p_payload->'collections') x) <> jsonb_array_length(targets)
    or exists(select 1 from jsonb_array_elements(p_payload->'collections') x where not exists(select 1 from jsonb_array_elements(targets) t where (t->>'shipmentId')::uuid = (x->>'shipmentId')::uuid))
  then raise check_violation using message = 'seller_claim_collections_changed'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'collections') x where x->>'carrier' is not null
    and not exists(select 1 from public.shipping_carriers carrier where carrier.code = x->>'carrier' and carrier.is_active))
  then raise check_violation using message = 'unknown_shipping_carrier'; end if;
  select jsonb_agg(x || jsonb_build_object('originId', t->>'originId', 'originName', t->>'originName', 'items', t->'items') order by t->>'originId', t->>'shipmentId')
    into collections from jsonb_array_elements(p_payload->'collections') x join jsonb_array_elements(targets) t on (x->>'shipmentId')::uuid = (t->>'shipmentId')::uuid;

  end if;

  insert into public.order_cancellation_requests(id, order_id, requested_by, claim_type, reason_type, reason, stage, requested_at)
    values(p_request_id, target_id, target.user_id, p_payload->>'claimType', p_payload->>'reasonType', p_payload->>'reason', 'requested', submitted_at);
  insert into private.seller_order_claim_intakes(claim_id, actor_id, payload, collection_snapshot, created_at)
    values(p_request_id, actor, saved_payload, collections, submitted_at);
  -- Preserve the submitted payload for exact idempotency while the immutable
  -- target labels/items are stored separately inside the same private receipt.
  -- They are returned by joining the original input with its intake snapshot.
  if p_refund_account is not null and p_refund_account <> 'null'::jsonb then
    insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
      values(p_request_id, p_refund_account->>'bankName', p_refund_account->>'accountNumber', p_refund_account->>'accountHolder',
        (p_refund_account->>'bankName') || ' ' || public.mask_refund_account_number(p_refund_account->>'accountNumber'),
        public.mask_refund_account_holder(p_refund_account->>'accountHolder'));
  end if;
  insert into public.audit_log(actor_id, action, target, diff) values(actor, 'admin.order.claim_intake_created', 'order:' || target_id::text,
    jsonb_build_object('claimId', p_request_id, 'claimType', p_payload->>'claimType', 'to', 'requested', 'source', p_payload->>'source',
      'inquiryId', p_payload->>'inquiryId', 'customerRequestedAt', requested_at, 'collectionCount', jsonb_array_length(collections)));
  perform private.notify_order_claim(p_request_id, 'seller_requested', case when p_payload->>'claimType'='cancel' then '취소 요청이 접수됐어요' else '반품·교환 요청이 접수됐어요' end,
    '고객님과 확인한 내용을 바탕으로 담당자가 요청을 접수했습니다. 승인과 이후 처리는 별도로 진행됩니다.');
  return private.seller_claim_intake_json(p_request_id);
end $function$;


create function private.guard_digital_exchange_policy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.claim_type='exchange' and private.order_has_digital_items(new.order_id) then
  raise check_violation using message='digital_exchange_unavailable'; end if;
 return new;
end $$;
alter function private.guard_digital_exchange_policy() owner to postgres;
revoke all on function private.guard_digital_exchange_policy() from public,anon,authenticated,service_role;
create trigger guard_digital_exchange_policy before insert or update of claim_type,order_id on public.order_cancellation_requests
 for each row execute function private.guard_digital_exchange_policy();
select private.register_operator_internal_contract('private.order_has_digital_items(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.guard_digital_exchange_policy()'::regprocedure);
select private.register_operator_internal_contract('private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure);
select private.register_operator_rpc_contract('public.order_claim_eligibility(uuid)'::regprocedure,'sales.read','mixed',false);
select private.register_operator_rpc_contract('public.admin_seller_claim_intake_context(uuid)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)'::regprocedure,'sales.manage','write',false);
commit;
