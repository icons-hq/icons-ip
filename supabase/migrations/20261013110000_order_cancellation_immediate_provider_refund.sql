-- ============================================================================
-- 승인된 취소는 곧바로 토스 전액 취소로 닫는다 (2026-10-12 점검 REF-2)
--
-- 지금까지 자동 승인(발주확인 전 변심 취소)과 클레임 콘솔 승인은 원장만 열고
-- (order_cancellation_claims + refunds requested) 결제사 취소를 부르지 않았다.
-- 실제 토스 취소는 운영자가 '환불 완료 확정'을 누를 때만 나갔는데, 화면은 그
-- 반대(결제사 원장에서 취소를 먼저 확인)를 안내했다.
--
-- 이 migration은 서버가 승인 직후 같은 오케스트레이터를 실행할 수 있게 DB 계약을
-- 넓힌다. 앱이 하는 일과 DB가 하는 일은 지금과 같다:
--   앱  : 오케스트레이터 → 토스 전액 취소 → fresh 조회로 전액 취소 검증
--   DB  : 검증된 paymentKey로만 complete_order_cancellation_request → finalizer
--
-- 1. 시스템 actor
--    고객이 연 자동 승인에는 staff가 없다. 오케스트레이터 RPC 4종은 모두
--    service_role 전용이라 호출자는 이미 서버 신뢰 경계다. p_actor_id = null을
--    "시스템(서버 자동 발행)"으로 받되 취소(claim_type='cancel') 요청에만 허용한다.
--    반품·교환은 회수 확인이 선행하는 staff 절차라 시스템이 닫을 수 없다.
--    감사 로그는 actor_id null + 'system.order.*' 액션으로 남긴다(기존 선례:
--    system.order.delay_notice_*).
--
-- 2. 환불 원장 완료 기록
--    토스 취소가 fresh 조회로 검증된 결제의 refunds 행은 완료 시점에
--    method='pg_cancel'·filed_at·completed_at을 함께 적는다. 이전에는 운영자가
--    '환불 완료를 원장에 기록'을 따로 눌러야 원장이 닫혔다. 구매자 알림도 이
--    시점(실제 발행·검증 뒤)에 보낸다.
--
-- 3. '환불 접수' 알림 문구
--    토스 결제에 pg_cancel 접수를 기록하는 순간에는 아직 결제사 취소가 나가지
--    않았다. "결제사에 결제 취소를 접수했습니다"는 Korpay(이메일 접수 후 기록)에만
--    사실이므로, 토스 결제가 있는 주문은 "환불 절차를 시작했습니다"로 알린다.
--
-- 함수 본문은 각 함수의 최신 정의를 복사해 위 차이만 넣었다:
--   assert_order_cancellation_reconciliation_allowed  ← 20260909001505:481
--   reconcile_expired_prepared_goods_cancellation     ← 20260909001505:2465
--   mark_order_cancellation_needs_review               ← 20260714190001:611
--   complete_order_cancellation_request                ← 20260714190001:797
--   admin_record_order_claim_refund                    ← 20260909001505:1322
-- ============================================================================

create or replace function public.assert_order_cancellation_reconciliation_allowed(p_request_id uuid,p_actor_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare claim public.order_cancellation_requests;purchase public.orders;order_key uuid;
begin
 -- p_actor_id null = 시스템(서버 자동 발행). 아래에서 취소 유형만 허용한다.
 if p_actor_id is not null and not exists(select 1 from public.profiles where id=p_actor_id and role in ('staff','admin') and suspended_at is null) then
   raise insufficient_privilege using message='staff required'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_request_id;
 if not found then raise no_data_found using message='cancellation_request_not_found'; end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_request_id for update;
 if p_actor_id is null and claim.claim_type<>'cancel' then
   raise insufficient_privilege using message='staff required'; end if;
 if claim.stage='completed' and purchase.status='canceled' then return 'completed'; end if;
 if claim.stage='on_hold' then raise check_violation using message='claim_on_hold'; end if;
 if claim.claim_type='exchange' or claim.status not in ('processing','needs_review') then
   raise check_violation using message='cancellation_request_not_processing'; end if;
 perform private.assert_claim_collections_complete(p_request_id);
 if claim.claim_type='cancel' and not claim.collection_required and not private.order_cancel_eligible(order_key) then
   raise check_violation using message='order_not_cancelable'; end if;
 return 'allowed';
end $$;
revoke all on function public.assert_order_cancellation_reconciliation_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_order_cancellation_reconciliation_allowed(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.reconcile_expired_prepared_goods_cancellation(p_request_id uuid, p_actor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_transitioned boolean := false;
begin
  -- p_actor_id null = 시스템(서버 자동 발행). 유형 제한은
  -- assert_order_cancellation_reconciliation_allowed가 잠금 아래에서 다시 본다.
  if p_request_id is null then
    raise invalid_parameter_value using
      message = 'prepared_goods_cancellation_input_invalid';
  end if;

  if p_actor_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- Resolve only the lock key first. Every money and stock writer below uses
  -- the shared order -> request -> attempt -> payments ordering.
  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  order by attempt.id
  limit 1
  for update;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  if v_request.status = 'completed' then
    -- loadContext and this lock can be separated by another successful Toss,
    -- Korpay manual, or terminal-attempt reconciliation. A completed request
    -- plus canceled order is the provider-neutral terminal identity.
    if v_order.status = 'canceled' then
      return 'completed';
    end if;
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_terminal_mismatch';
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id,p_actor_id);

  if v_attempt.id is null then
    return 'not_applicable';
  end if;

  -- A callback or another evidence path that moved the attempt beyond
  -- prepared owns the resolution. Do not fall through to the Toss empty-ledger
  -- completion path and do not mutate the request to needs_review here.
  -- An approved, identity-matched Toss ledger is a captured payment, never a
  -- no-capture timeout. Continue to provider reconciliation without mutating it.
  if v_attempt.state='approved' and v_attempt.provider='toss'
    and v_attempt.user_id=v_order.user_id and v_attempt.amount=v_order.total and v_attempt.currency='KRW'
    and exists(select 1 from public.payments p where p.id=v_attempt.payment_id and p.provider=v_attempt.provider
      and p.purpose='order' and p.ref_id=v_order.id and p.user_id=v_order.user_id and p.amount=v_order.total
      and p.status in ('paid','canceled','refunded') and nullif(btrim(p.payment_key),'') is not null) then
    return 'not_applicable';
  end if;
  if v_attempt.state in ('confirming', 'approved', 'unknown', 'needs_review') then
    return 'in_progress';
  end if;

  if v_attempt.state in ('declined', 'canceled') then
    return 'not_applicable';
  end if;

  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_payment_attempt_invalid';
  end if;

  if v_order.status is distinct from 'pending'
    or v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status <> 'failed'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_payment_evidence_invalid';
  end if;

  if v_attempt.expires_at is null
    or v_attempt.expires_at > pg_catalog.clock_timestamp()
  then
    return 'in_progress';
  end if;

  update public.payment_attempts as attempt
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where attempt.id = v_attempt.id
    and attempt.state = 'prepared'
    and attempt.expires_at is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
  returning true into v_transitioned;

  if not coalesce(v_transitioned, false) then
    return 'in_progress';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    array[]::text[]
  );

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = coalesce(request.completed_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id
    and request.status in ('processing', 'needs_review');

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_request_changed';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    case when p_actor_id is null
      then 'system.order.prepared_goods_cancellation_completed'
      else 'admin.order.prepared_goods_cancellation_completed'
    end,
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'outcome', 'expired_no_capture'
    ) || case when p_actor_id is null
      then pg_catalog.jsonb_build_object('actor', 'system')
      else '{}'::jsonb
    end
  );

  return 'completed';
end;
$function$;
revoke all on function public.reconcile_expired_prepared_goods_cancellation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_expired_prepared_goods_cancellation(uuid,uuid) to service_role;

-- provider 호출 결과가 불확실하면 claim과 주문/재고를 그대로 두고 운영 검토로 전환한다.
create or replace function public.mark_order_cancellation_needs_review(
  p_request_id uuid,
  p_actor_id uuid,
  p_error_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_request_status text;
  v_claim_type text;
begin
  -- p_actor_id null = 시스템(서버 자동 발행). 취소 유형만 허용한다.
  if p_actor_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise check_violation using message = 'invalid review code';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status, request.claim_type
  into v_request_status, v_claim_type
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if p_actor_id is null and v_claim_type <> 'cancel' then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_request_status = 'needs_review' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'failed'
  where cancellation_request_id = p_request_id
    and status <> 'done';

  update public.order_cancellation_requests
  set
    status = 'needs_review',
    last_error_code = p_error_code,
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    case when p_actor_id is null
      then 'system.order.cancellation_needs_review'
      else 'admin.order.cancellation_needs_review'
    end,
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'processing',
      'to', 'needs_review',
      'errorCode', p_error_code
    ) || case when p_actor_id is null
      then jsonb_build_object('actor', 'system')
      else '{}'::jsonb
    end
  );
end;
$$;

revoke all on function public.mark_order_cancellation_needs_review(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_order_cancellation_needs_review(uuid, uuid, text)
  to service_role;

-- fresh provider GET으로 모든 active 결제의 전액 취소를 확인한 뒤에만 finalizer를
-- 호출한다. payment key 배열은 증거 비교에만 쓰고 테이블/감사 로그에는 남기지 않는다.
create or replace function public.complete_order_cancellation_request(
  p_request_id uuid,
  p_provider_payment_keys text[],
  p_actor_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_reason text;
  v_request_status text;
  v_claim_type text;
  v_provider_payment_keys text[];
  v_refund_count integer;
  v_provider_refund_count integer;
begin
  -- p_actor_id null = 시스템(서버 자동 발행). 취소 유형만 허용한다.
  if p_actor_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status, request.reason, request.claim_type
  into v_request_status, v_reason, v_claim_type
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if p_actor_id is null and v_claim_type <> 'cancel' then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_request_status = 'completed' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  select coalesce(array_agg(keys.payment_key order by keys.payment_key), array[]::text[])
  into v_provider_payment_keys
  from (
    select distinct btrim(payment_key) as payment_key
    from unnest(coalesce(p_provider_payment_keys, array[]::text[])) as input(payment_key)
    where payment_key is not null
      and btrim(payment_key) <> ''
  ) as keys;

  -- 로컬 장부가 canceled/refunded여도 provider 취소 완료의 진실원은 fresh GET이다.
  -- 실제 capture가 없었던 failed 결제만 증거 대상에서 제외한다.
  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
      and payment.status <> 'failed'
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order_id,
    v_reason,
    v_provider_payment_keys
  );

  update public.refunds as refund
  set cancellation_request_id = p_request_id
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and (
      refund.cancellation_request_id is null
      or refund.cancellation_request_id = p_request_id
    );

  if exists (
    select 1
    from public.refunds as refund
    where refund.cancellation_request_id = p_request_id
      and refund.status <> 'done'
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  select count(*)::integer
  into v_refund_count
  from public.refunds as refund
  where refund.cancellation_request_id = p_request_id
    and refund.status = 'done';

  /*
   * 토스 취소가 fresh 조회로 검증된 결제는 여기서 환불 원장까지 닫는다.
   *
   * 검증된 키에 대해서만 적는다 — 이 함수에 들어온 키는 오케스트레이터가 취소 API
   * 발행 뒤 조회로 전액 취소를 확인한 것뿐이다. 수단·처리자·시각은 첫 기록이
   * 이긴다(admin_record_order_claim_refund와 같은 규칙). 계좌 송금이 이미 접수된
   * 결제에는 오케스트레이터가 취소를 발행하지 않으므로 여기 들어오지 않는다.
   */
  update public.refunds as refund
  set
    method = coalesce(refund.method, 'pg_cancel'),
    handled_by = coalesce(refund.handled_by, p_actor_id),
    filed_at = coalesce(refund.filed_at, now()),
    completed_at = coalesce(refund.completed_at, now())
  from public.payments as payment
  where refund.payment_id = payment.id
    and refund.cancellation_request_id = p_request_id
    and refund.status = 'done'
    and payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.provider = 'toss'
    and payment.payment_key = any(v_provider_payment_keys);

  get diagnostics v_provider_refund_count = row_count;

  update public.order_cancellation_requests
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_request_id
    and status = 'processing';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    case when p_actor_id is null
      then 'system.order.cancellation_completed'
      else 'admin.order.cancellation_completed'
    end,
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'to', 'completed',
      'refundCount', v_refund_count,
      'providerRefundCount', v_provider_refund_count
    ) || case when p_actor_id is null
      then jsonb_build_object('actor', 'system')
      else '{}'::jsonb
    end
  );

  -- 구매자 알림은 실제 취소가 검증된 뒤에만 보낸다.
  if v_provider_refund_count > 0 then
    perform private.notify_order_claim(
      p_request_id,
      'refund_completed',
      '결제 취소가 완료됐어요',
      '결제 금액 전액을 결제사에서 취소했습니다. 카드사 처리 일정에 따라 환급 반영 시점이 다를 수 있습니다.'
    );
  elsif v_refund_count = 0 then
    perform private.notify_order_claim(
      p_request_id,
      'completed',
      '주문이 취소됐어요',
      '결제가 완료되지 않은 주문이라 결제 취소 없이 주문을 취소했습니다.'
    );
  end if;
end;
$$;

revoke all on function public.complete_order_cancellation_request(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_order_cancellation_request(uuid, text[], uuid)
  to service_role;


-- 최신 정의(20260909001505:1322) 복사. 차이: 토스 결제의 pg_cancel 접수 알림 문구.
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_refund(p_claim_id uuid, p_method text, p_stage text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_order_status public.order_status;
  v_refund_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_method not in ('pg_cancel', 'bank_transfer') then
    raise check_violation using message = 'invalid refund method';
  end if;
  if p_stage not in ('filed', 'completed') then
    raise check_violation using message = 'invalid refund stage';
  end if;
  if p_note is not null
    and (btrim(p_note) <> p_note or length(p_note) not between 1 and 300)
  then
    raise check_violation using message = 'invalid settlement note';
  end if;

  select request.order_id
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  select orders.status
  into v_order_status
  from public.orders
  where orders.id = v_claim.order_id
  for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  perform private.assert_claim_collections_complete(p_claim_id);

  if v_claim.claim_type = 'exchange' then
    raise exception using message = 'exchange_has_no_refund';
  end if;

  /*
   * 계좌 송금은 받아 둔 계좌가 있을 때만 적을 수 있다.
   *
   * 없는 계좌로 'bank_transfer'를 기록하면 원장은 송금했다고 말하고 구매자에게는
   * "등록하신 환불계좌로 송금을 접수했습니다"가 나간다 — 존재하지 않는 계좌를
   * 근거로 한 안내다. 파기된 행(purged_at)은 통과시킨다: 수집 사실은 남아 있고,
   * 그때 송금은 실제로 그 계좌로 갔다.
   */
  if p_method = 'bank_transfer'
    and not exists (
      select 1
      from private.claim_refund_accounts as account
      where account.claim_id = p_claim_id
    )
  then
    raise exception using message = 'claim_refund_account_missing';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id
  order by payment.id
  for update;

  if p_stage = 'filed' then
    if v_claim.stage not in ('collected', 'processing') then
      raise exception using message = 'claim_not_refundable';
    end if;

    -- 반품은 입고가 확인된 뒤에야 durable claim이 생긴다. 그 전에 만들면
    -- 물건이 돌아오지 않은 주문의 재고가 복원 대기 상태로 열린다.
    if v_claim.stage = 'collected' then
      insert into public.order_cancellation_claims (
        order_id,
        requested_by,
        previous_status
      )
      values (v_claim.order_id, v_claim.requested_by, v_order_status)
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
        and payment.ref_id = v_claim.order_id
        and payment.status in ('pending', 'paid', 'canceled', 'refunded')
      on conflict (payment_id) do update
      set
        cancellation_request_id = excluded.cancellation_request_id,
        reason = coalesce(public.refunds.reason, excluded.reason),
        status = case
          when public.refunds.status = 'done' then 'done'
          else 'requested'
        end;

      update public.order_cancellation_requests
      set
        stage = 'processing',
        provider_started_at = coalesce(provider_started_at, now()),
        updated_at = now()
      where id = p_claim_id;
    end if;

    -- 수단·처리자·접수시각은 첫 기록이 이긴다. 재접수가 덮으면 이미 계좌로 송금한
    -- 건이 결제사 취소로 보이고, 실제로 접수한 사람이 마지막 클릭한 사람으로 바뀐다.
    -- 갱신 가능한 것은 상계·정산 메모뿐이다.
    update public.refunds as refund
    set
      method = coalesce(refund.method, p_method),
      handled_by = coalesce(refund.handled_by, v_actor),
      filed_at = coalesce(refund.filed_at, now()),
      settlement_note = coalesce(p_note, refund.settlement_note)
    from public.payments as payment
    where refund.payment_id = payment.id
      and payment.purpose = 'order'
      and payment.ref_id = v_claim.order_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_refund_filed',
      'order:' || v_claim.order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'method', p_method,
        'from', v_claim.stage,
        'to', 'processing'
      )
    );

    /*
     * 토스 결제의 pg_cancel 접수는 아직 결제사 취소가 나가기 전이다. 취소는
     * 서버 오케스트레이터가 발행하고, 검증되면 complete_order_cancellation_request가
     * '결제 취소가 완료됐어요'를 따로 보낸다. "결제사에 접수했다"는 문구는 운영자가
     * 이메일로 접수한 뒤 기록하는 Korpay에만 사실이다.
     */
    perform private.notify_order_claim(
      p_claim_id,
      'refund_filed',
      '환불 접수가 완료됐어요',
      case
        when p_method = 'bank_transfer'
          then '등록하신 환불계좌로 송금을 접수했습니다.'
        when exists (
          select 1
          from public.payments as payment
          where payment.purpose = 'order'
            and payment.ref_id = v_claim.order_id
            and payment.provider = 'toss'
            and payment.status <> 'failed'
        )
          then '환불 절차를 시작했습니다. 결제사 취소가 확인되면 다시 알려드립니다.'
        else '결제사에 결제 취소를 접수했습니다. 카드사 처리 일정에 따라 반영 시점이 다를 수 있습니다.'
      end
    );

    return 'filed';
  end if;

  -- 완료 기록.
  if v_claim.stage <> 'completed' then
    raise exception using message = 'claim_refund_finalization_required';
  end if;

  update public.refunds as refund
  set
    method = coalesce(refund.method, p_method),
    handled_by = coalesce(refund.handled_by, v_actor),
    completed_at = coalesce(refund.completed_at, now()),
    settlement_note = coalesce(p_note, refund.settlement_note)
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id;

  get diagnostics v_refund_count = row_count;

  -- 환불 원장이 한 줄도 없는 완료는 "돈은 돌아갔는데 장부가 비었다"는 뜻이다.
  -- 첫 판매 리스크 목록이 지적한 그 상태를 여기서 막는다.
  if v_refund_count = 0 then
    raise exception using message = 'claim_refund_ledger_missing';
  end if;

  -- 환불계좌 파기 기한은 여기서 잡지 않는다. 클레임이 종결 stage에 닿는 순간
  -- private.seal_order_claim_refund_account가 이미 잡았다 — 거절·교환·레거시
  -- 완료까지 같은 규칙을 받으려면 판정이 한 곳에 있어야 한다.

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_refund_completed',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'method', p_method,
      'refundRows', v_refund_count,
      'settlementNote', p_note
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'refund_completed',
    '환불이 완료됐어요',
    '환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.'
  );

  return 'completed';
end;
$function$;


revoke all on function public.admin_record_order_claim_refund(uuid, text, text, text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_refund(uuid, text, text, text) to authenticated;
