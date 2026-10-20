begin;
-- Gift claims retain the payer in the financial ledger and separately identify
-- the real requester. No recipient is represented as the payer or auth.uid().
create table private.gift_claim_parties (
 claim_id uuid primary key references public.order_cancellation_requests(id) on delete cascade,
 gift_id uuid not null references private.gift_intents(id),payer_id uuid not null,recipient_id uuid not null,actual_requester uuid not null,
 check(actual_requester=payer_id or actual_requester=recipient_id)
);
create table private.gift_claim_operations (
 id uuid primary key,actor_id uuid not null,gift_id uuid not null references private.gift_intents(id),kind text not null,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.gift_claim_parties enable row level security;
alter table private.gift_claim_operations enable row level security;
revoke all on private.gift_claim_parties,private.gift_claim_operations from public,anon,authenticated,service_role;

CREATE FUNCTION private.request_order_claim_for_parties(p_order_id uuid, p_actor uuid, p_user_id uuid, p_gift_id uuid, p_claim_type text, p_reason text, p_reason_type text, p_bank_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_account_holder text DEFAULT NULL::text)
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

  -- 반품·교환은 물리적 회수를 전제한다. 배송이 끝나기 전에는 회수할 물건이
  -- Customer cancellation is available only before order confirmation.
  if p_claim_type in ('return', 'exchange') then
    if not private.order_all_items_delivered(p_order_id) then
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

create or replace function public.request_order_claim(p_order_id uuid,p_user_id uuid,p_claim_type text,p_reason text,p_reason_type text,
 p_bank_name text default null,p_account_number text default null,p_account_holder text default null) returns text
language plpgsql volatile security definer set search_path='' as $$declare gift private.gift_intents;begin
 select * into gift from private.gift_intents where order_id=p_order_id;
 return private.request_order_claim_for_parties(p_order_id,p_user_id,coalesce(gift.sender_id,p_user_id),gift.id,p_claim_type,p_reason,p_reason_type,p_bank_name,p_account_number,p_account_holder)->>'outcome';
end $$;
revoke all on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) to service_role;

create function private.gift_claim_actor(p_claim_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(g.actual_requester,c.requested_by) from public.order_cancellation_requests c left join private.gift_claim_parties g on g.claim_id=c.id where c.id=p_claim_id;
$$;
create function private.gift_claim_context(p_actor uuid,p_gift_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare gift private.gift_intents;claim public.order_cancellation_requests;purchase public.orders;own boolean;account private.claim_refund_accounts;begin
 select * into gift from private.gift_intents where id=p_gift_id and(p_actor=sender_id or p_actor=recipient_id);
 if not found or p_actor is null then return null;end if;
 select * into purchase from public.orders where id=gift.order_id;
 select * into claim from public.order_cancellation_requests where order_id=gift.order_id order by requested_at desc,id desc limit 1;
 own:=claim.id is not null and private.gift_claim_actor(claim.id)=p_actor;
 select * into account from private.claim_refund_accounts where claim_id=claim.id;
 return jsonb_build_object('giftId',gift.id,'isSender',p_actor=gift.sender_id,'isRecipient',p_actor=gift.recipient_id,
  'canRequest',purchase.id is not null and private.order_all_items_delivered(purchase.id) and purchase.status<>'canceled'
    and not exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in('requested','processing','needs_review')),
  'claim',case when claim.id is null then null else jsonb_build_object('id',claim.id,'type',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,'requestedAt',claim.requested_at,
   'isRequester',own,'canWithdraw',own and private.order_claim_withdrawal_blocker(claim) is null,
   'refundAccountNeeded',p_actor=gift.sender_id and(purchase.payment_method='bank_transfer' or claim.stage='needs_review') and claim.claim_type<>'exchange' and claim.stage not in('completed','rejected','withdrawn') and(account.claim_id is null or account.purged_at is not null),
   'maskedRefundAccount',case when p_actor=gift.sender_id then account.masked_account else null end,
   'reshipCarrier',case when p_actor=gift.recipient_id then claim.reship_carrier else null end,
   'reshipTrackingNumber',case when p_actor=gift.recipient_id then claim.reship_tracking_number else null end) end);
end $$;
create function public.get_my_gift_claim_context(p_gift_id uuid,p_expected_actor_id uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 return private.gift_claim_context(auth.uid(),p_gift_id);
end $$;
create function public.request_my_gift_claim(p_gift_id uuid,p_claim_type text,p_reason_type text,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;previous private.gift_claim_operations;request_hash text;outcome jsonb;claim_id uuid;result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 if p_operation_id is null or p_claim_type is null or p_claim_type not in('return','exchange') or p_reason_type is null or p_reason_type not in('change_of_mind','defect') then raise invalid_parameter_value using message='invalid_gift_claim';end if;
 select * into gift from private.gift_intents where id=p_gift_id and(actor=sender_id or actor=recipient_id);
 if not found or gift.order_id is null then raise no_data_found using message='gift_not_found';end if;
 perform private.gift_lock_subjects(array[actor,gift.sender_id,gift.recipient_id]);
 perform pg_advisory_xact_lock(hashtextextended('gift-claim-operation:'||p_operation_id,0));
 request_hash:=encode(extensions.digest(jsonb_build_array(p_gift_id,p_claim_type,p_reason_type)::text,'sha256'),'hex');
 select * into previous from private.gift_claim_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.gift_id<>p_gift_id or previous.kind<>'requested' or previous.request_hash<>request_hash then raise unique_violation using message='gift_operation_conflict';end if;
  return jsonb_build_object('receipt',previous.result,'context',private.gift_claim_context(actor,p_gift_id));
 end if;
 outcome:=private.request_order_claim_for_parties(gift.order_id,actor,gift.sender_id,gift.id,p_claim_type,
  case p_reason_type when 'defect' then '상품 하자' else '단순 변심' end,p_reason_type);
 if outcome->>'outcome'<>'requested' then raise check_violation using message=outcome->>'outcome';end if;
 claim_id:=(outcome->>'claimId')::uuid;
 result:=jsonb_build_object('operationId',p_operation_id,'kind','requested','claimId',claim_id);
 insert into private.gift_claim_operations(id,actor_id,gift_id,kind,request_hash,result) values(p_operation_id,actor,p_gift_id,'requested',request_hash,result);
 return jsonb_build_object('receipt',result,'context',private.gift_claim_context(actor,p_gift_id));
end $$;
create function public.set_my_gift_claim_refund_account(p_gift_id uuid,p_claim_id uuid,p_operation_id uuid,p_bank_name text,p_account_number text,p_account_holder text,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;claim public.order_cancellation_requests;purchase public.orders;previous private.gift_claim_operations;request_hash text;result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 if p_operation_id is null or p_bank_name is null or p_bank_name<>btrim(p_bank_name) or length(p_bank_name) not between 1 and 40
  or p_account_number is null or p_account_number!~'^[0-9-]{8,30}$' or p_account_holder is null or p_account_holder<>btrim(p_account_holder) or length(p_account_holder) not between 1 and 40 then
  raise invalid_parameter_value using message='invalid_refund_account';end if;
 select * into gift from private.gift_intents where id=p_gift_id and sender_id=actor;
 if not found or gift.order_id is null then raise no_data_found using message='gift_not_found';end if;
 perform private.gift_lock_subjects(array[actor,gift.recipient_id]);
 perform pg_advisory_xact_lock(hashtextextended('gift-claim-operation:'||p_operation_id,0));
 request_hash:=encode(extensions.digest(jsonb_build_array(p_operation_id,p_gift_id,p_claim_id,p_bank_name,p_account_number,p_account_holder)::text,'sha256'),'hex');
 select * into previous from private.gift_claim_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.gift_id<>p_gift_id or previous.kind<>'refund_account' or previous.request_hash<>request_hash then raise unique_violation using message='gift_operation_conflict';end if;
  return jsonb_build_object('receipt',previous.result,'context',private.gift_claim_context(actor,p_gift_id));
 end if;
 select * into purchase from public.orders where id=gift.order_id for update;
 perform id from public.order_shipments where order_id=purchase.id order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id for update;
 if not found or (purchase.payment_method<>'bank_transfer' and claim.stage<>'needs_review') or claim.claim_type='exchange' or claim.stage not in('requested','in_review','collecting','collected','on_hold','needs_review') then raise check_violation using message='gift_refund_account_closed';end if;
 if exists(select 1 from private.claim_refund_accounts where claim_id=claim.id) then raise check_violation using message='gift_refund_account_exists';end if;
 insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(claim.id,p_bank_name,p_account_number,p_account_holder,p_bank_name||' '||public.mask_refund_account_number(p_account_number),public.mask_refund_account_holder(p_account_holder));
 result:=jsonb_build_object('operationId',p_operation_id,'kind','refund_account','claimId',claim.id);
 insert into private.gift_claim_operations(id,actor_id,gift_id,kind,request_hash,result) values(p_operation_id,actor,gift.id,'refund_account',request_hash,result);
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'gift.refund_account_confirmed','order:'||purchase.id,jsonb_build_object('claimId',claim.id,'giftId',gift.id));
 return jsonb_build_object('receipt',result,'context',private.gift_claim_context(actor,gift.id));
end $$;

create or replace function private.read_order_claim_withdrawal_context(p_claim_id uuid,p_actor uuid,p_as_operator boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim public.order_cancellation_requests;purchase public.orders;blocker text;
begin
 if p_actor is null then raise insufficient_privilege using message='auth_required';end if;
 if p_as_operator and not private.has_operator_capability(p_actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select * into purchase from public.orders where id=claim.order_id;
 if not p_as_operator and private.gift_claim_actor(p_claim_id) is distinct from p_actor then raise no_data_found using message='claim_not_found';end if;
 blocker:=private.order_claim_withdrawal_blocker(claim);
 return jsonb_build_object('claimId',claim.id,'orderId',claim.order_id,'claimType',claim.claim_type,'stage',claim.stage,
  'revision',claim.claim_revision,'allowed',blocker is null,'blocker',blocker,'orderTotal',case when p_as_operator or purchase.user_id=p_actor then purchase.total else null end,
  'withdrawal',(select jsonb_build_object('actorKind',w.actor_kind,'reason',case when exists(select 1 from private.gift_intents where order_id=claim.order_id) then '선물 요청 철회' else w.reason end,'createdAt',w.created_at) from private.order_claim_withdrawals w where w.claim_id=claim.id));
end $$;

create or replace function private.apply_order_claim_withdrawal(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_reason text,p_confirmed boolean,p_as_operator boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();purchase public.orders;claim public.order_cancellation_requests;previous private.order_claim_withdrawals;
 order_key uuid;buyer uuid;blocker text;kind text:=case when p_as_operator then 'operator' else 'customer' end;reason text:=btrim(p_reason);happened timestamptz;
begin
 if actor is null then raise insufficient_privilege using message='auth_required';end if;
 if p_as_operator and not private.has_operator_capability(actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_confirmed is distinct from true
  or reason is null or char_length(reason) not between 2 and 500 or reason~'[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_claim_withdrawal';end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null or not p_as_operator and private.gift_claim_actor(p_claim_id) is distinct from actor then raise no_data_found using message='claim_not_found';end if;
 -- Existing-order recovery remains available to its owner, including suspended owners.
 perform private.lock_operator_subjects(array[actor,buyer]);
 if p_as_operator then perform private.require_actor_operator_capability(actor,'sales.manage',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-withdrawal:'||p_operation_id::text,0));
 select * into previous from private.order_claim_withdrawals where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.actor_kind<>kind or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision or previous.reason<>reason then
   raise unique_violation using message='claim_withdrawal_request_conflict';end if;
  return private.order_claim_withdrawal_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 perform shipment_id from public.order_claim_collections where claim_id=p_claim_id order by shipment_id for update;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 blocker:=private.order_claim_withdrawal_blocker(claim);
 if blocker is not null then raise check_violation using message=blocker;end if;
 happened:=clock_timestamp();
 insert into private.order_claim_withdrawals(id,claim_id,order_id,actor_id,actor_kind,expected_revision,reason,from_stage,created_at)
 values(p_operation_id,p_claim_id,order_key,actor,kind,p_expected_revision,reason,claim.stage,happened);
 update public.order_cancellation_requests set stage='withdrawn',withdrawn_at=happened,decided_at=happened,decided_by=actor,
  decision_note=null,held_from=null,hold_reason=null,held_at=null,updated_at=happened where id=p_claim_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'order.claim_withdrawn','order:'||order_key,
  jsonb_build_object('claimId',p_claim_id,'claimType',claim.claim_type,'from',claim.stage,'to','withdrawn','actorKind',kind,'customerConfirmed',true));
 perform private.notify_order_claim(p_claim_id,'withdrawn','요청을 철회했어요',
  case when p_as_operator then '고객님과 확인한 요청 철회를 담당자가 기록했습니다. 주문과 결제는 유지되며 환불을 실행하지 않습니다.'
  else '요청을 철회했습니다. 주문과 결제는 유지되며 환불을 실행하지 않습니다.' end);
 return private.order_claim_withdrawal_receipt(p_operation_id,actor);
end $$;

create or replace function private.notify_order_claim(
  p_claim_id uuid,
  p_event text,
  p_title text,
  p_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_claim public.order_cancellation_requests%rowtype;
  gift private.gift_intents;
begin
  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    return;
  end if;

  select * into gift from private.gift_intents where order_id=v_claim.order_id;
  if found then
    insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
    select party,'claim_updated','선물 요청 상태가 변경됐어요','선물함에서 교환·반품·취소 요청의 진행 상태를 확인해주세요.','/gifts/'||gift.id,'order_claim',v_claim.id::text,
      'gift-claim:'||p_event||':'||v_claim.id||':'||to_char(v_claim.updated_at,'YYYYMMDDHH24MISSUS')
    from(select distinct unnest(array[gift.sender_id,gift.recipient_id]) party) parties where party is not null
    on conflict(user_id,dedupe_key) do nothing;
    return;
  end if;
  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_claim.requested_by,
    'claim_updated',
    p_title,
    p_body,
    '/orders/' || v_claim.order_id::text,
    'order_claim',
    v_claim.id::text,
    'claim:' || p_event || ':' || v_claim.id::text
      || ':' || pg_catalog.to_char(v_claim.updated_at, 'YYYYMMDDHH24MISSUS')
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$function$;

create or replace function public.get_my_order_claim_reason_changes(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message='auth_required';end if;
 if not exists(select 1 from public.orders where id=p_order_id and user_id=auth.uid()) then raise no_data_found using message='order_not_found';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'fromReasonType',from_reason_type,'fromReason',case when exists(select 1 from private.gift_intents where order_id=p_order_id) then case from_reason_type when 'defect' then '상품 하자' else '단순 변심' end else from_reason end,
  'toReasonType',to_reason_type,'toReason',case when exists(select 1 from private.gift_intents where order_id=p_order_id) then case to_reason_type when 'defect' then '상품 하자' else '단순 변심' end else to_reason end,'requestedAt',requested_at,'createdAt',created_at)
  order by created_at,id),'[]'::jsonb) from private.order_claim_reason_operations where order_id=p_order_id and changed);
end $$;

create function public.withdraw_my_gift_claim(p_gift_id uuid,p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();receipt jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 if not exists(select 1 from private.gift_intents g join public.order_cancellation_requests c on c.order_id=g.order_id where g.id=p_gift_id and c.id=p_claim_id and(actor=g.sender_id or actor=g.recipient_id)) then raise no_data_found using message='gift_not_found';end if;
 receipt:=private.apply_order_claim_withdrawal(p_claim_id,p_operation_id,p_expected_revision,'선물 요청 철회',true,false);
 return jsonb_build_object('receipt',jsonb_build_object('operationId',p_operation_id,'kind','withdrawn','claimId',p_claim_id),'context',private.gift_claim_context(actor,p_gift_id));
end $$;

-- Operational claim detail distinguishes the actual requester from the buyer.
-- A withdrawn request is terminal and must not block a later, fully collected
-- return. Preserve active-claim checks for gift and ordinary orders alike.
do $patch$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('private.assert_order_collections_complete(uuid)'::regprocedure);
 anchor:=$old$stage not in ('completed','rejected') and collection_required$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'gift_withdrawn_collection_anchor_changed';end if;
 execute replace(definition,anchor,$new$stage not in ('completed','rejected','withdrawn') and collection_required$new$);
 perform private.register_operator_internal_contract('private.assert_order_collections_complete(uuid)'::regprocedure);
end $patch$;

create function private.gift_admin_claim_party(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('giftId',g.id,'requesterRole',case when coalesce(parties.actual_requester,c.requested_by)=g.sender_id then 'payer' else 'recipient' end,
  'requesterName',coalesce(nullif(btrim(p.nickname),''),case when coalesce(parties.actual_requester,c.requested_by)=g.sender_id then g.sender_label else g.recipient_label end,'이름 미등록'))
 from public.order_cancellation_requests c join private.gift_intents g on g.order_id=c.order_id
 left join private.gift_claim_parties parties on parties.claim_id=c.id
 left join public.profiles p on p.id=coalesce(parties.actual_requester,c.requested_by) where c.id=p_claim_id;
$$;
do $patch$declare definition text;anchor text;contract record;begin
 definition:=pg_get_functiondef('public.admin_order_claim_detail(uuid)'::regprocedure);
 anchor:=$old$return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id));$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'gift_claim_requester_anchor_changed';end if;
 execute replace(definition,anchor,$new$return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id),'gift',private.gift_admin_claim_party(p_claim_id));$new$);
 select * into contract from private.operator_rpc_contracts where signature::regprocedure='public.admin_order_claim_detail(uuid)'::regprocedure;
 if not found then raise exception 'gift_claim_requester_contract_missing';end if;
 perform private.register_operator_rpc_contract('public.admin_order_claim_detail(uuid)'::regprocedure,contract.capability,contract.guard_kind,contract.legacy_admin_only);
end $patch$;

-- These reads are used before the account fence; cleanup runs only after that
-- transaction commits and handles exactly one gift per RPC transaction.
create function private.gift_account_deletion_blockers(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when count(*)=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','active_received_gift','count',count(*),'path','/gifts')) end
 from private.gift_intents gift join public.orders purchase on purchase.id=gift.order_id where gift.recipient_id=p_actor and gift.sender_id<>p_actor and
 (purchase.status not in('canceled','done') and not private.order_all_items_delivered(purchase.id)
  or exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in('requested','processing','needs_review')));
$$;
create function public.service_list_fenced_gifts(p_actor uuid,p_after uuid default null,p_limit integer default 100) returns uuid[]
language plpgsql stable security definer set search_path='' as $$begin
 if p_actor is null or p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='invalid_gift_cleanup';end if;
 if not exists(select 1 from private.account_action_fences where subject_user_id=p_actor) then return array[]::uuid[];end if;
 return array(select g.id from private.gift_intents g where(g.sender_id=p_actor or g.recipient_id=p_actor) and g.order_id is null
  and(g.state in('awaiting_acceptance','accepted') or exists(select 1 from private.gift_recipient_addresses where gift_id=g.id)
    or exists(select 1 from private.goods_transaction_quotes q where q.source->>'kind'='gift' and q.source->>'id'=g.id::text and q.order_id is null))
  and(p_after is null or g.id>p_after) order by g.id limit p_limit);
end $$;
create function public.service_list_fenced_gift_cleanup_candidates(p_limit integer default 100) returns uuid[]
language plpgsql stable security definer set search_path='' as $$begin
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='invalid_gift_cleanup';end if;
 return array(select g.id from private.gift_intents g where g.order_id is null
  and exists(select 1 from private.account_action_fences f where f.subject_user_id in(g.sender_id,g.recipient_id))
  and(g.state in('awaiting_acceptance','accepted') or exists(select 1 from private.gift_recipient_addresses where gift_id=g.id)
   or exists(select 1 from private.goods_transaction_quotes q where q.source->>'kind'='gift' and q.source->>'id'=g.id::text and q.order_id is null))
  order by g.id limit p_limit);
end $$;
create function public.service_cleanup_fenced_gift(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare gift private.gift_intents;begin
 begin gift:=private.gift_lock(p_id);exception when no_data_found then return jsonb_build_object('giftId',p_id,'state','missing');end;
 if gift.id is null then return jsonb_build_object('giftId',p_id,'state','missing');end if;
 if gift.order_id is not null then return jsonb_build_object('giftId',p_id,'state','ordered');end if;
 if not exists(select 1 from private.account_action_fences where subject_user_id in(gift.sender_id,gift.recipient_id)) then return jsonb_build_object('giftId',p_id,'state','not_fenced');end if;
 if gift.state in('awaiting_acceptance','accepted') then update private.gift_intents set state='canceled',closed_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=gift.id;end if;
 update private.gift_link_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where gift_id=gift.id;
 delete from private.gift_claim_sessions where token_hash in(select token_hash from private.gift_link_tokens where gift_id=gift.id);
 delete from private.goods_transaction_quotes where actor_id=gift.sender_id and source->>'kind'='gift' and source->>'id'=gift.id::text and order_id is null;
 delete from private.gift_recipient_addresses where gift_id=gift.id;
 return jsonb_build_object('giftId',p_id,'state','cleaned');
end $$;
create or replace function public.service_expire_gifts(p_limit integer default 100) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare candidate uuid;ids uuid[];subjects uuid[];gift private.gift_intents;changed integer:=0;begin
 ids:=array(select id from private.gift_intents where order_id is null and state in('awaiting_acceptance','accepted') and expires_at<=clock_timestamp()
  order by id limit greatest(1,least(coalesce(p_limit,100),100)));
 select array_agg(distinct subject order by subject) into subjects from private.gift_intents g cross join lateral unnest(array[g.sender_id,g.recipient_id]) subject where g.id=any(ids) and subject is not null;
 perform private.gift_lock_subjects(subjects);
 -- A recipient may have committed while the initial sender locks were waiting.
 -- Abort before any source lock; a fresh transaction can acquire the complete set.
 if exists(select 1 from private.gift_intents where id=any(ids) and recipient_id is not null and not(recipient_id=any(subjects))) then raise sqlstate 'PT409' using message='gift_changed';end if;
 foreach candidate in array ids loop
  begin gift:=private.gift_lock(candidate);exception when sqlstate 'PT409' then continue;end;
  if gift.order_id is not null or gift.state not in('awaiting_acceptance','accepted') or gift.expires_at>clock_timestamp() then continue;end if;
  update private.gift_intents set state='expired',closed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=gift.id;
  update private.gift_link_tokens set revoked_at=clock_timestamp() where gift_id=gift.id and revoked_at is null;
  delete from private.goods_transaction_quotes where actor_id=gift.sender_id and source->>'kind'='gift' and source->>'id'=gift.id::text and order_id is null;
  delete from private.gift_recipient_addresses where gift_id=gift.id;changed:=changed+1;
 end loop;
 delete from private.gift_claim_sessions s where s.expires_at<=clock_timestamp() or exists(select 1 from private.gift_link_tokens t where t.token_hash=s.token_hash and(t.revoked_at is not null or t.consumed_at is not null));
 return jsonb_build_object('expired',changed);
end $$;

-- Preserve the established order/customer/operator policies. Gift records are
-- already hidden by their parent restrictive policy, including collection rows.
do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  n.nspname='private' and p.proname=any(array['request_order_claim_for_parties','gift_claim_actor','gift_claim_context','gift_admin_claim_party','gift_account_deletion_blockers']) or
  n.nspname='public' and p.proname=any(array['withdraw_my_gift_claim','get_my_gift_claim_context','request_my_gift_claim','set_my_gift_claim_refund_account','service_list_fenced_gifts','service_list_fenced_gift_cleanup_candidates','service_cleanup_fenced_gift']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  if (select n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=fn::oid)='public' then
   execute format('grant execute on function %s to %s',fn,case when (select proname from pg_proc where oid=fn::oid) like 'service_%' then 'service_role' else 'authenticated' end);
  else execute format('grant execute on function %s to postgres',fn);end if;
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_internal_contract('private.apply_order_claim_withdrawal(uuid,uuid,integer,text,boolean,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.read_order_claim_withdrawal_context(uuid,uuid,boolean)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_order_claim_reason_changes(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_expire_gifts(integer)'::regprocedure);
notify pgrst,'reload schema';

commit;
