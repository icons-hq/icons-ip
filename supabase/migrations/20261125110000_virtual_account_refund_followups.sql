-- ==========================================================================
-- ICONS · 토스 가상계좌 환불 후속 — ADR-0049 결정 5 보강(2026-11-23)
--
-- 1. 환불 계좌가 없거나 결제사가 거절한 가상계좌 환불을 사람 손에서 시스템으로 옮긴다.
--    - 구매자가 반품·취소 신청 화면이나 주문 상세에서 입력한 환급 계좌(private.claim_refund_accounts — 법정 문서가 이미 '반품·취소
--      신청 화면에서 입력한 환급 계좌'와 '환급 완료 30일 뒤 원문 파기'를 말한다)를 가상계좌 환불의 첫째 계좌로 쓴다. 없으면 결제 UI가
--      받은 계좌(private.payment_attempt_virtual_accounts.refund_*, 발급 180일 뒤 파기)다. 고르는 규칙·은행 이름 → 토스 은행 코드는
--      앱(lib/payments/virtual-account-refund-account.ts)이 정한다. 계좌별 멱등키(refund:{attemptId}:va-{계좌 해시})는 그대로다.
--    - 기존 차단(주문 상세의 환불계좌 보완은 회사 계좌 무통장 주문만)을 입금된 토스 가상계좌 주문에 연다. 가상계좌 주문은 계좌를 바꿀 수
--      있다(결제사가 거절한 계좌를 고친다) — 결제사 환불이 진행 중(processing)이거나 환불이 끝났으면 바꾸지 않는다.
--    - 계좌를 저장하면: 취소(시스템 actor 허용)는 앱이 service_begin_virtual_account_refund_retry로 결제확인필요 → 처리 중으로 되돌린 뒤
--      같은 요청에서 환불을 다시 시도한다. 반품은 DB 규칙상 시스템 actor로 환불하지 않으므로(운영자만) 운영 알림을 올린다 — 운영자가
--      [상태 다시 확인]을 누르면 그 계좌로 환불한다.
-- 2. 은행 환불 실패 감시. 가상계좌 결제가 환불(payments paid → refunded/canceled)되면 감시 행을 만든다. 자동 재확인 cron이 결제
--    조회의 virtualAccount.refundStatus를 읽어 COMPLETED면 닫고, FAILED·PARTIAL_FAILED(또는 7일 넘게 송금 확인 전)면 실패로 올린다 —
--    운영 알림(벨·운영 알림 요약 메일)과 시스템 상태의 '환불 송금 실패'. 운영자가 토스 상점관리자에서 재환불한 뒤 조회가 COMPLETED면
--    저절로 닫히고, 회사 밖에서 끝냈으면 운영자가 사유와 함께 '처리 완료'로 닫는다.
-- ==========================================================================

begin;

create function private.va_refund_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
  v_expected integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_expected := coalesce((v_patch->>2)::integer, 1);
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> v_expected then
      raise exception 'va_refund_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.va_refund_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1-1. 입금된 토스 가상계좌 결제(주문당 하나). 승인된 시도의 가상계좌 원장 결제 키가 결제 원장의 키와 같을 때만.
-- ---------------------------------------------------------------------------
create function private.order_toss_virtual_account_payment(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('attemptId', attempt.id, 'paymentId', payment.id, 'paymentKey', payment.payment_key)
  from public.payments as payment
  join public.payment_attempts as attempt on attempt.payment_id = payment.id
  join private.payment_attempt_virtual_accounts as va
    on va.attempt_id = attempt.id and va.provider_payment_key = payment.payment_key
  where payment.purpose = 'order' and payment.ref_id = p_order_id and payment.provider = 'toss'
    and attempt.purpose = 'order' and attempt.provider = 'toss' and attempt.state = 'approved'
  order by payment.id
  limit 1;
$function$;
revoke all on function private.order_toss_virtual_account_payment(uuid) from public, anon, authenticated, service_role;

-- 가상계좌 주문의 환급 계좌 입력 판정. 결제사 환불이 진행 중이거나 끝났으면 막는다. 이미 입력한 계좌는 바꿀 수 있다.
create function private.order_claim_virtual_account_refund_blocker(
  p_claim public.order_cancellation_requests,
  p_order public.orders
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_order.status::text not in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
      or p_claim.claim_type not in ('cancel', 'return')
      or p_claim.stage not in ('requested', 'in_review', 'collecting', 'collected', 'on_hold', 'processing', 'needs_review')
      or p_claim.status not in ('requested', 'processing', 'needs_review') then 'refund_account_claim_closed'
    -- 결제사 환불을 부르는 중이다 — 결과(완료 또는 결제확인필요)가 나온 뒤 다시 입력한다.
    when p_claim.status = 'processing' then 'refund_account_refund_in_progress'
    -- 가상계좌는 부분 반품을 받지 않는다(부분 취소 불가). 지금 SQL 차단과 같은 판단이다.
    when private.claim_is_partial_return(p_claim.id) then 'refund_account_payment_unavailable'
    when exists (
        select 1 from public.payments as payment
        where payment.purpose = 'order' and payment.ref_id = p_order.id and (payment.provider <> 'toss' or payment.status <> 'paid'))
      or (select sum(payment.amount) from public.payments as payment
        where payment.purpose = 'order' and payment.ref_id = p_order.id) is distinct from p_order.total
      then 'refund_account_payment_unavailable'
    -- 환불이 끝났거나(완료) 운영자가 계좌 송금으로 접수했다.
    when exists (
        select 1 from public.refunds as refund
        join public.payments as payment on payment.id = refund.payment_id
        where payment.purpose = 'order' and payment.ref_id = p_order.id
          and (refund.status = 'done' or refund.method is not null or refund.completed_at is not null))
      then 'refund_account_finance_started'
    else null
  end;
$function$;
revoke all on function private.order_claim_virtual_account_refund_blocker(public.order_cancellation_requests, public.orders)
  from public, anon, authenticated, service_role;

create or replace function private.order_claim_refund_account_blocker(p_claim public.order_cancellation_requests, p_order public.orders)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
 select case
  when p_order.id is null or p_claim.id is null or p_claim.order_id is distinct from p_order.id then 'claim_not_found'
  when exists(select 1 from private.gift_intents where order_id=p_order.id) then 'refund_account_gift_order'
  -- 입금된 토스 가상계좌(ADR-0049 보강): 결제사 환불이 환급 계좌를 요구한다. 클레임 환급 계좌를 환불 계좌로 쓴다.
  when p_order.payment_method = 'card' and private.order_toss_virtual_account_payment(p_order.id) is not null
   then private.order_claim_virtual_account_refund_blocker(p_claim, p_order)
  when private.bank_transfer_zero_refund_payment(p_order.id) is not null then 'refund_account_not_needed'
  when p_order.payment_method is distinct from 'bank_transfer' or p_order.total<=0 then 'refund_account_payment_unavailable'
  when p_order.status::text not in('paid','confirmed','shipping','delivered','done')
   or p_claim.claim_type not in('cancel','return')
   or p_claim.stage not in('requested','in_review','collecting','collected','on_hold','processing','needs_review')
   or p_claim.status not in('requested','processing','needs_review') then 'refund_account_claim_closed'
  when exists(select 1 from private.claim_refund_accounts where claim_id=p_claim.id) then 'refund_account_already_recorded'
  when not exists(select 1 from public.payments where purpose='order' and ref_id=p_order.id and provider='bank_transfer' and status='paid' and amount>0)
   or exists(select 1 from public.payments where purpose='order' and ref_id=p_order.id and(provider<>'bank_transfer' or status<>'paid'))
   or (select sum(amount) from public.payments where purpose='order' and ref_id=p_order.id) is distinct from p_order.total then 'refund_account_payment_unavailable'
  when exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id
   where p.purpose='order' and p.ref_id=p_order.id and(r.status<>'requested' or r.method is not null
    or r.filed_at is not null or r.completed_at is not null or r.handled_by is not null
    or r.cancellation_request_id is distinct from p_claim.id or r.amount<>p.amount)) then 'refund_account_finance_started'
  else null end;
$function$;

-- ---------------------------------------------------------------------------
-- 1-2. 구매자 화면 문맥: 결제 방식(mode), 가상계좌 환불이 계좌 때문에 멈췄는지(refundAccountIssue), 결제 화면에서 받은 계좌(가린 형태).
-- ---------------------------------------------------------------------------
create or replace function public.get_my_order_claim_refund_account_context(p_order_id uuid, p_claim_id uuid, p_expected_actor_id uuid, p_expected_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare purchase public.orders;claim public.order_cancellation_requests;account private.claim_refund_accounts;blocker text;
 va_payment jsonb;checkout_account jsonb;
begin
 perform private.require_claim_refund_account_identity(p_expected_actor_id,p_expected_session_id);
 select * into purchase from public.orders where id=p_order_id and user_id=p_expected_actor_id;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id;
 if purchase.id is null or claim.id is null or exists(select 1 from private.gift_intents where order_id=purchase.id) then
  raise sqlstate 'PT404' using message='claim_not_found';end if;
 blocker:=private.order_claim_refund_account_blocker(claim,purchase);
 select * into account from private.claim_refund_accounts where claim_id=claim.id and purged_at is null;
 if purchase.payment_method='card' then va_payment:=private.order_toss_virtual_account_payment(purchase.id);end if;
 if va_payment is not null then
  select jsonb_build_object('bankCode',va.refund_bank_code,'maskedAccount',public.mask_refund_account_number(va.refund_account_number),
    'maskedHolder',public.mask_refund_account_holder(va.refund_holder_name))
  into checkout_account
  from private.payment_attempt_virtual_accounts va
  where va.attempt_id=(va_payment->>'attemptId')::uuid and va.refund_bank_code is not null;
 end if;
 return jsonb_build_object('actorId',p_expected_actor_id,'orderId',purchase.id,'claimId',claim.id,
  'claimType',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,'allowed',blocker is null,'blocker',blocker,
  'maskedAccount',account.masked_account,'maskedHolder',account.masked_holder,'recordedAt',account.created_at,
  'mode',case when va_payment is not null then 'virtual_account' else 'bank_transfer' end,
  'refundAccountIssue',case when va_payment is not null and claim.status='needs_review' then case claim.last_error_code
    when 'provider_refund_account_required' then 'required' when 'provider_refund_account_invalid' then 'invalid' end end,
  'checkoutAccount',checkout_account);
end $function$;

-- ---------------------------------------------------------------------------
-- 1-3. 저장: 가상계좌 주문은 이미 입력한 계좌를 바꾼다(결제사가 거절한 계좌를 고친다). 반품이 계좌 때문에 멈춰 있으면 운영 알림을 올린다.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_order_claim_refund_account(p_order_id uuid, p_claim_id uuid, p_operation_id uuid, p_expected_revision integer, p_bank_name text, p_account_number text, p_account_holder text, p_expected_actor_id uuid, p_expected_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare purchase public.orders;claim public.order_cancellation_requests;previous private.order_claim_refund_account_operations;
 request_hash text;blocker text;result_revision integer;virtual_account boolean;replaced boolean;
begin
 perform private.require_claim_refund_account_identity(p_expected_actor_id,p_expected_session_id);
 if p_order_id is null or p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_bank_name is null or p_bank_name<>btrim(p_bank_name) or char_length(p_bank_name) not between 1 and 40 or p_bank_name~'[[:cntrl:]]'
  or p_account_number is null or p_account_number!~'^[0-9-]{8,30}$' or p_account_number!~'[0-9]'
  or p_account_holder is null or p_account_holder<>btrim(p_account_holder) or char_length(p_account_holder) not between 1 and 40 or p_account_holder~'[[:cntrl:]]'
  then raise invalid_parameter_value using message='invalid_claim_refund_account';end if;
 if not exists(select 1 from public.orders o join public.order_cancellation_requests c on c.order_id=o.id
  where o.id=p_order_id and o.user_id=p_expected_actor_id and c.id=p_claim_id)
  or exists(select 1 from private.gift_intents where order_id=p_order_id) then raise sqlstate 'PT404' using message='claim_not_found';end if;
 -- Match existing account-deletion, claim, and refund ordering. Existing-order
 -- recovery remains available to its owner even when new purchases are fenced.
 perform private.lock_operator_subjects(array[p_expected_actor_id]);
 perform private.lock_claim_refund_account_session(p_expected_actor_id,p_expected_session_id);
 perform pg_advisory_xact_lock(hashtextextended('claim-refund-account:'||p_operation_id::text,0));
 request_hash:=encode(extensions.digest(jsonb_build_array(p_operation_id,p_order_id,p_claim_id,p_expected_actor_id,
  p_expected_session_id,p_expected_revision,p_bank_name,p_account_number,p_account_holder)::text,'sha256'),'hex');
 select * into previous from private.order_claim_refund_account_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.order_id<>p_order_id
   or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision then
   raise unique_violation using message='refund_account_request_conflict';end if;
  if previous.state='sealed' then raise check_violation using message='refund_account_request_sealed';end if;
  if previous.request_hash is null then raise check_violation using message='refund_account_request_expired';end if;
  if previous.request_hash<>request_hash then raise unique_violation using message='refund_account_request_conflict';end if;
  return private.order_claim_refund_account_receipt(p_operation_id,p_expected_actor_id,p_expected_session_id);
 end if;
 select * into purchase from public.orders where id=p_order_id and user_id=p_expected_actor_id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 perform id from public.order_shipments where order_id=purchase.id order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 perform id from public.payments where purpose='order' and ref_id=purchase.id order by id for update;
 perform r.id from public.refunds r join public.payments p on p.id=r.payment_id
  where p.purpose='order' and p.ref_id=purchase.id order by r.id for update of r;
 blocker:=private.order_claim_refund_account_blocker(claim,purchase);
 if blocker is not null then raise check_violation using message=blocker;end if;
 virtual_account:=purchase.payment_method='card' and private.order_toss_virtual_account_payment(purchase.id) is not null;
 replaced:=exists(select 1 from private.claim_refund_accounts where claim_id=claim.id);
 -- 차단 판정이 기존 계좌를 막지 않은 것은 가상계좌 주문뿐이다(회사 계좌 무통장은 refund_account_already_recorded).
 insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(claim.id,p_bank_name,p_account_number,p_account_holder,p_bank_name||' '||public.mask_refund_account_number(p_account_number),public.mask_refund_account_holder(p_account_holder))
 on conflict(claim_id) do update set bank_name=excluded.bank_name,account_number=excluded.account_number,account_holder=excluded.account_holder,
  masked_account=excluded.masked_account,masked_holder=excluded.masked_holder,created_at=clock_timestamp(),purge_after=null,purged_at=null;
 update public.order_cancellation_requests set updated_at=clock_timestamp() where id=claim.id returning claim_revision into result_revision;
 insert into private.order_claim_refund_account_operations(id,actor_id,session_id,order_id,claim_id,expected_revision,result_revision,state,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,purchase.id,claim.id,p_expected_revision,result_revision,'saved',request_hash);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'order.claim_refund_account_confirmed','order:'||purchase.id,
  jsonb_build_object('claimId',claim.id,'claimType',claim.claim_type,'revision',p_expected_revision,'resultRevision',result_revision)
  || case when virtual_account then jsonb_build_object('mode','virtual_account','replaced',replaced) else '{}'::jsonb end);
 -- 반품은 시스템이 환불을 다시 부르지 않는다(시스템 actor는 취소만) — 계좌 때문에 멈춘 반품이면 운영자에게 알린다.
 if virtual_account and claim.claim_type='return' and claim.status='needs_review'
  and claim.last_error_code in ('provider_refund_account_required','provider_refund_account_invalid') then
  insert into private.admin_operation_alerts(event_key,category,title,href)
  values('virtual_account_refund_account_updated:'||claim.id::text||':'||result_revision::text,'claims',
   '반품 환급 계좌가 입력됐습니다 · 상태 다시 확인으로 환불해주세요','/admin/sales/claims/returns/'||claim.id::text)
  on conflict(event_key) do nothing;
 end if;
 return private.order_claim_refund_account_receipt(p_operation_id,p_expected_actor_id,p_expected_session_id);
end $function$;

-- ---------------------------------------------------------------------------
-- 1-4. 서버(service role) 전용: 가상계좌 환불에 실을 계좌 후보 두 개. 결제 시도의 원장 결제 키와 같을 때만 준다.
--      claim = 이 취소·반품 요청에서 구매자가 입력한 계좌(은행 이름), checkout = 결제 UI가 받은 계좌(토스 은행 코드).
-- ---------------------------------------------------------------------------
create function public.service_goods_virtual_account_refund_accounts(p_attempt_id uuid, p_payment_key text, p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'claim', (
      select pg_catalog.jsonb_build_object(
        'bankName', account.bank_name, 'accountNumber', account.account_number, 'holderName', account.account_holder)
      from private.claim_refund_accounts as account
      join public.order_cancellation_requests as request on request.id = account.claim_id
      where account.claim_id = p_request_id and request.order_id = va.order_id
        and account.purged_at is null and account.account_number is not null),
    'checkout', case when va.refund_bank_code is not null then pg_catalog.jsonb_build_object(
      'bankCode', va.refund_bank_code, 'accountNumber', va.refund_account_number, 'holderName', va.refund_holder_name) end)
  from private.payment_attempt_virtual_accounts as va
  where va.attempt_id = p_attempt_id and va.provider_payment_key = p_payment_key;
$function$;
revoke all on function public.service_goods_virtual_account_refund_accounts(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_virtual_account_refund_accounts(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1-5. 서버(service role) 전용: 구매자가 계좌를 입력한 뒤 계좌 때문에 멈춘 가상계좌 취소를 처리 중으로 되돌린다(시스템 actor).
--      started = 앱이 같은 요청에서 환불을 다시 시도한다 / operator_required = 반품(운영자 [상태 다시 확인]) /
--      account_missing = 쓸 계좌가 없다 / not_applicable = 대상 아님(이미 처리 중·다른 사유·가상계좌 아님).
-- ---------------------------------------------------------------------------
create function public.service_begin_virtual_account_refund_retry(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_purchase public.orders%rowtype;
  v_claim public.order_cancellation_requests%rowtype;
  v_payment jsonb;
begin
  if p_request_id is null then
    raise invalid_parameter_value using message = 'invalid_refund_retry';
  end if;
  select request.order_id into v_order_id from public.order_cancellation_requests as request where request.id = p_request_id;
  if not found then
    return 'not_applicable';
  end if;
  -- 공통 잠금 순서: order → shipments → request(admin_begin_order_cancellation_reconcile·assert와 같다).
  select order_record.* into v_purchase from public.orders as order_record where order_record.id = v_order_id for update;
  perform shipment.id from public.order_shipments as shipment where shipment.order_id = v_order_id order by shipment.id for update;
  select request.* into v_claim from public.order_cancellation_requests as request where request.id = p_request_id for update;

  if v_claim.status is distinct from 'needs_review'
    or v_claim.last_error_code is null
    or v_claim.last_error_code not in ('provider_refund_account_required', 'provider_refund_account_invalid')
    or v_purchase.payment_method is distinct from 'card'
    or exists (select 1 from private.gift_intents as gift where gift.order_id = v_order_id) then
    return 'not_applicable';
  end if;
  v_payment := private.order_toss_virtual_account_payment(v_order_id);
  if v_payment is null then
    return 'not_applicable';
  end if;
  if v_claim.claim_type <> 'cancel' then
    return 'operator_required';
  end if;
  if not exists (
      select 1 from private.claim_refund_accounts as account
      where account.claim_id = v_claim.id and account.purged_at is null and account.account_number is not null)
    and not exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = (v_payment->>'attemptId')::uuid and va.refund_bank_code is not null) then
    return 'account_missing';
  end if;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id, null);

  update public.refunds
  set status = 'requested'
  where cancellation_request_id = p_request_id and status = 'failed';

  update public.order_cancellation_requests
  set status = 'processing',
      provider_started_at = coalesce(provider_started_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where id = p_request_id;

  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.cancellation_reconcile_started', 'order:' || v_order_id::text,
    pg_catalog.jsonb_build_object('requestId', p_request_id, 'from', 'needs_review', 'to', 'processing',
      'actor', 'system', 'reason', 'virtual_account_refund_account_updated'));
  return 'started';
end;
$function$;
revoke all on function public.service_begin_virtual_account_refund_retry(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_begin_virtual_account_refund_retry(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2-1. 은행 환불 감시 원장(가상계좌 결제당 하나).
-- ---------------------------------------------------------------------------
create table private.virtual_account_refund_watches (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_payment_key text not null check (
    char_length(provider_payment_key) between 1 and 200 and provider_payment_key !~ '[[:space:][:cntrl:]]'),
  -- pending: 은행 송금 확인 전 / completed: 송금 완료 / failed: 송금 실패·지연(운영자 확인) / resolved: 운영자가 처리 완료로 닫음
  state text not null default 'pending' check (state in ('pending', 'completed', 'failed', 'resolved')),
  -- 마지막으로 읽은 virtualAccount.refundStatus(NONE·PENDING·FAILED·PARTIAL_FAILED·COMPLETED) 또는 조회 판정 표지.
  refund_status text check (refund_status is null or refund_status ~ '^[A-Z_]{1,32}$'),
  failure_code text check (failure_code is null or failure_code in ('refund_failed', 'refund_partial_failed', 'refund_overdue', 'payment_mismatch')),
  checks integer not null default 0 check (checks >= 0),
  refunded_at timestamptz not null default pg_catalog.clock_timestamp(),
  next_check_at timestamptz not null default pg_catalog.clock_timestamp() + interval '30 minutes',
  last_checked_at timestamptz,
  failed_at timestamptz,
  completed_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text check (resolution_note is null or (char_length(resolution_note) between 2 and 200 and resolution_note !~ '[[:cntrl:]]')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint virtual_account_refund_watches_failed_at check (state <> 'failed' or (failed_at is not null and failure_code is not null)),
  constraint virtual_account_refund_watches_resolved check ((state = 'resolved') = (resolved_at is not null))
);
create index virtual_account_refund_watches_due on private.virtual_account_refund_watches(next_check_at)
  where state in ('pending', 'failed');
create index virtual_account_refund_watches_order on private.virtual_account_refund_watches(order_id);
alter table private.virtual_account_refund_watches enable row level security;
revoke all on private.virtual_account_refund_watches from public, anon, authenticated, service_role;

-- 가상계좌 결제가 환불되면(결제 원장 paid → refunded·canceled) 감시를 연다. 실패해도 환불 확정은 막지 않는다.
create function private.virtual_account_refund_watch_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    insert into private.virtual_account_refund_watches(attempt_id, order_id, payment_id, provider_payment_key)
    select attempt.id, new.ref_id, new.id, new.payment_key
    from public.payment_attempts as attempt
    join private.payment_attempt_virtual_accounts as va
      on va.attempt_id = attempt.id and va.provider_payment_key = new.payment_key
    where attempt.payment_id = new.id and attempt.purpose = 'order' and attempt.provider = 'toss'
    on conflict (attempt_id) do nothing;
  exception when others then
    raise warning 'virtual account refund watch failed for payment %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke all on function private.virtual_account_refund_watch_opened() from public, anon, authenticated, service_role;

create trigger payments_virtual_account_refund_watch
after update of status on public.payments
for each row
when (old.status = 'paid' and new.status in ('refunded', 'canceled') and new.purpose = 'order' and new.provider = 'toss'
  and new.payment_key is not null and new.ref_id is not null)
execute function private.virtual_account_refund_watch_opened();

-- 작업자(service role): 조회할 감시를 고른다(송금 확인 전·실패, 환불 30일 안). 고르는 순간 10분 리스를 건다.
create function public.service_claim_virtual_account_refund_watches(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_now timestamptz := pg_catalog.clock_timestamp(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5 then
    raise invalid_parameter_value using message = 'invalid_refund_watch_limit';
  end if;
  with picked as (
    select watch.attempt_id
    from private.virtual_account_refund_watches as watch
    where watch.state in ('pending', 'failed') and watch.next_check_at <= v_now
      and watch.refunded_at > v_now - interval '30 days'
    order by watch.next_check_at, watch.attempt_id
    limit p_limit
    for update skip locked
  ), leased as (
    update private.virtual_account_refund_watches as watch
    set next_check_at = v_now + interval '10 minutes', checks = watch.checks + 1, last_checked_at = v_now, updated_at = v_now
    from picked where watch.attempt_id = picked.attempt_id
    returning watch.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'attemptId', leased.attempt_id,
    'orderId', leased.order_id,
    'paymentKey', leased.provider_payment_key,
    'providerOrderId', attempt.provider_order_id,
    'amount', attempt.amount
  ) order by leased.next_check_at, leased.attempt_id), '[]'::jsonb)
  into v_result
  from leased
  join public.payment_attempts as attempt on attempt.id = leased.attempt_id;
  return v_result;
end;
$function$;
revoke all on function public.service_claim_virtual_account_refund_watches(integer) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_virtual_account_refund_watches(integer) to service_role;

-- 작업자(service role): 조회 결과 기록. p_outcome: completed | pending | failed | mismatch | unavailable.
-- 실패(처음 한 번)는 운영 알림·감사 로그를 남긴다. 송금 확인 전이 7일을 넘으면 지연(refund_overdue)으로 실패와 같이 올린다.
create function public.service_record_virtual_account_refund_watch(p_attempt_id uuid, p_outcome text, p_refund_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_watch private.virtual_account_refund_watches%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_failure text;
begin
  if p_attempt_id is null or p_outcome is null or p_outcome not in ('completed', 'pending', 'failed', 'mismatch', 'unavailable')
    or (p_refund_status is not null and p_refund_status !~ '^[A-Z_]{1,32}$') then
    raise invalid_parameter_value using message = 'invalid_refund_watch_result';
  end if;
  select watch.* into v_watch from private.virtual_account_refund_watches as watch where watch.attempt_id = p_attempt_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_watch.state in ('completed', 'resolved') then
    return v_watch.state;
  end if;

  if p_outcome = 'completed' then
    update private.virtual_account_refund_watches
    set state = 'completed', refund_status = coalesce(p_refund_status, refund_status), completed_at = v_now, updated_at = v_now
    where attempt_id = p_attempt_id;
    if v_watch.state = 'failed' then
      insert into public.audit_log(actor_id, action, target, diff)
      values (null, 'system.order.virtual_account_refund_completed', 'order:' || v_watch.order_id::text,
        pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'after', v_watch.failure_code, 'actor', 'system'));
    end if;
    return 'completed';
  end if;

  if p_outcome = 'unavailable' then
    update private.virtual_account_refund_watches
    set next_check_at = v_now + interval '30 minutes', updated_at = v_now
    where attempt_id = p_attempt_id;
    return v_watch.state;
  end if;

  v_failure := case
    when p_outcome = 'failed' and p_refund_status = 'PARTIAL_FAILED' then 'refund_partial_failed'
    when p_outcome = 'failed' then 'refund_failed'
    when p_outcome = 'mismatch' then 'payment_mismatch'
    when v_watch.refunded_at <= v_now - interval '7 days' then 'refund_overdue'
  end;

  if v_failure is null then
    -- 송금 확인 전(PENDING 등) — 2시간 뒤 다시 본다.
    update private.virtual_account_refund_watches
    set refund_status = coalesce(p_refund_status, refund_status), next_check_at = v_now + interval '2 hours', updated_at = v_now
    where attempt_id = p_attempt_id;
    return v_watch.state;
  end if;

  update private.virtual_account_refund_watches
  set state = 'failed', refund_status = coalesce(p_refund_status, refund_status), failure_code = v_failure,
      failed_at = coalesce(failed_at, v_now), next_check_at = v_now + interval '6 hours', updated_at = v_now
  where attempt_id = p_attempt_id;

  if v_watch.state <> 'failed' then
    insert into private.admin_operation_alerts(event_key, category, title, href)
    values ('virtual_account_refund_failed:' || p_attempt_id::text, 'orders',
      case v_failure when 'refund_overdue' then '가상계좌 환불 송금이 7일째 확인되지 않습니다 · 주문을 확인해주세요'
        when 'payment_mismatch' then '가상계좌 환불 결제사 기록이 맞지 않습니다 · 주문을 확인해주세요'
        else '가상계좌 환불 송금이 실패했습니다 · 주문을 확인해주세요' end,
      '/admin/sales/orders/' || v_watch.order_id::text)
    on conflict (event_key) do nothing;
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.virtual_account_refund_failed', 'order:' || v_watch.order_id::text,
      pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'failureCode', v_failure, 'refundStatus', p_refund_status, 'actor', 'system'));
  end if;
  return 'failed';
end;
$function$;
revoke all on function public.service_record_virtual_account_refund_watch(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.service_record_virtual_account_refund_watch(uuid, text, text) to service_role;

-- 운영자(sales.manage): 회사 밖에서 끝낸 환불 실패를 사유와 함께 '처리 완료'로 닫는다.
create function public.admin_resolve_virtual_account_refund_watch(p_order_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_watch private.virtual_account_refund_watches%rowtype;
  v_note text := pg_catalog.btrim(p_note);
begin
  perform private.require_operator_capability('sales.manage', false);
  if v_actor is null then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_order_id is null or v_note is null or char_length(v_note) not between 2 and 200 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_refund_resolution';
  end if;
  perform order_record.id from public.orders as order_record where order_record.id = p_order_id for update;
  select watch.* into v_watch from private.virtual_account_refund_watches as watch
  where watch.order_id = p_order_id
  order by watch.created_at desc
  limit 1
  for update;
  if not found then
    raise no_data_found using message = 'refund_watch_not_found';
  end if;
  if v_watch.state = 'resolved' then
    return 'already_resolved';
  end if;
  if v_watch.state <> 'failed' then
    raise check_violation using message = 'refund_watch_not_failed';
  end if;
  update private.virtual_account_refund_watches
  set state = 'resolved', resolved_at = pg_catalog.clock_timestamp(), resolved_by = v_actor, resolution_note = v_note,
      updated_at = pg_catalog.clock_timestamp()
  where attempt_id = v_watch.attempt_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (v_actor, 'admin.order.virtual_account_refund_resolved', 'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object('attemptId', v_watch.attempt_id, 'failureCode', v_watch.failure_code, 'note', v_note));
  return 'resolved';
end;
$function$;
revoke all on function public.admin_resolve_virtual_account_refund_watch(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_resolve_virtual_account_refund_watch(uuid, text) to authenticated;

-- 운영자(sales.read): 시스템 상태 화면의 '환불 송금 확인 필요' 목록(실패·지연, 오래된 순). 주문 화면으로 가는 번호만 싣는다.
create function public.admin_virtual_account_refund_failures(p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- 읽기 전용(STABLE) 운영자 RPC — 잠금을 거는 require_operator_capability 대신 판정만 한다(PostgREST READ ONLY 모드).
  if (select auth.uid()) is null or not public.has_operator_capability('sales.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise invalid_parameter_value using message = 'invalid_refund_failure_limit';
  end if;
  return pg_catalog.jsonb_build_object(
    'total', (select count(*) from private.virtual_account_refund_watches as watch where watch.state = 'failed'),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'orderId', picked.order_id,
        'orderNumber', picked.order_number,
        'amount', picked.amount,
        'failureCode', picked.failure_code,
        'refundStatus', picked.refund_status,
        'refundedAt', picked.refunded_at,
        'failedAt', picked.failed_at,
        'checkedAt', picked.last_checked_at) order by picked.failed_at, picked.order_id)
      from (
        select watch.order_id, order_record.order_number, attempt.amount, watch.failure_code, watch.refund_status,
          watch.refunded_at, watch.failed_at, watch.last_checked_at
        from private.virtual_account_refund_watches as watch
        join public.orders as order_record on order_record.id = watch.order_id
        join public.payment_attempts as attempt on attempt.id = watch.attempt_id
        where watch.state = 'failed'
        order by watch.failed_at, watch.order_id
        limit p_limit
      ) as picked), '[]'::jsonb));
end;
$function$;
revoke all on function public.admin_virtual_account_refund_failures(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_virtual_account_refund_failures(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2-2. 주문 패널(운영자)에 환불 송금 상태를 더한다. 구매자 조회에서는 운영용 상태(escrow·refund)를 뺀다.
-- ---------------------------------------------------------------------------
create or replace function private.order_virtual_account_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'bankCode', va.bank_code,
    'accountNumber', va.account_number,
    'dueAt', va.due_at,
    'amount', attempt.amount,
    'useEscrow', va.use_escrow,
    'state', case
      when attempt.state = 'approved' then 'deposited'
      when attempt.state = 'awaiting_deposit' and va.due_at > pg_catalog.clock_timestamp() then 'awaiting'
      when attempt.state in ('awaiting_deposit', 'confirming', 'unknown', 'needs_review') then 'checking'
      else 'closed'
    end,
    'escrow', (
      select pg_catalog.jsonb_build_object(
        'deliveryState', job.state,
        'escrowStatus', job.escrow_status,
        'lastErrorCode', job.last_error_code)
      from private.toss_escrow_deliveries as job where job.order_id = p_order_id),
    'refund', (
      select pg_catalog.jsonb_build_object(
        'state', watch.state,
        'refundStatus', watch.refund_status,
        'failureCode', watch.failure_code,
        'refundedAt', watch.refunded_at,
        'checkedAt', watch.last_checked_at,
        'failedAt', watch.failed_at,
        'resolvedAt', watch.resolved_at,
        'resolutionNote', watch.resolution_note)
      from private.virtual_account_refund_watches as watch where watch.attempt_id = va.attempt_id)
  )
  from private.payment_attempt_virtual_accounts as va
  join public.payment_attempts as attempt on attempt.id = va.attempt_id
  where va.order_id = p_order_id
  order by va.issued_at desc
  limit 1;
$function$;
revoke all on function private.order_virtual_account_json(uuid) from public, anon, authenticated, service_role;

select private.va_refund_patch('public.get_my_order_virtual_account(uuid)'::regprocedure,
  $p$[["return private.order_virtual_account_json(p_order_id) - 'escrow';", "return private.order_virtual_account_json(p_order_id) - 'escrow' - 'refund';"]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 2-3. 시스템 상태·운영 알림 요약 메일 — 환불 송금 실패(처리 완료로 닫기 전까지)를 할 일로 센다.
-- ---------------------------------------------------------------------------
select private.va_refund_patch('private.system_health_report()'::regprocedure, pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_array(
    'failing integer; stalled integer; problem integer; unresolved integer; mail_failed integer; mail_bounced integer;',
    'failing integer; stalled integer; problem integer; unresolved integer; mail_failed integer; mail_bounced integer; refund_failed integer; refund_oldest timestamptz;'),
  pg_catalog.jsonb_build_array(
    $a$  emails := jsonb_build_object('failed24h', mail_failed, 'bounced24h', mail_bounced);$a$,
    $a$  emails := jsonb_build_object('failed24h', mail_failed, 'bounced24h', mail_bounced);

  -- 가상계좌 환불 송금 실패·지연(운영자가 처리 완료로 닫기 전까지). 토스 상점관리자에서 재환불하면 조회가 저절로 닫는다.
  select count(*), min(w.failed_at) into refund_failed, refund_oldest
  from private.virtual_account_refund_watches w where w.state = 'failed';$a$),
  pg_catalog.jsonb_build_array(
    $a$'payments', payments, 'emails', emails,$a$,
    $a$'payments', payments, 'emails', emails,
    'refunds', jsonb_build_object('virtualAccountFailed', refund_failed, 'oldestAt', refund_oldest),$a$),
  pg_catalog.jsonb_build_array(
    $a$'emailFailures', mail_failed, 'emailBounces', mail_bounced,$a$,
    $a$'emailFailures', mail_failed, 'emailBounces', mail_bounced, 'refundFailures', refund_failed,$a$),
  pg_catalog.jsonb_build_array(
    $a$'issues', problem + unresolved + mail_failed));$a$,
    $a$'issues', problem + unresolved + mail_failed + refund_failed));$a$)));

-- 환불 송금 실패 알림(주문 범주)은 출고 이상과 같이 '시스템 장애' 요약에 센다 — 주문 범주 전체(신규 결제 알림)는 넣지 않는다.
select private.va_refund_patch('private.prepare_ops_alert_digest(timestamptz)'::regprocedure,
  $p$[["(a.category='system' or a.event_key like 'canceled_shipment_dispatch%')", "(a.category='system' or a.event_key like 'canceled_shipment_dispatch%' or a.event_key like 'virtual_account_refund_failed:%')", 2]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 3. 운영자 계약 재등록(재정의한 함수) · 새 운영자 RPC 등록
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'private.order_claim_refund_account_blocker(public.order_cancellation_requests,public.orders)'::regprocedure,
    'public.get_my_order_claim_refund_account_context(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)'::regprocedure,
    'public.get_my_order_virtual_account(uuid)'::regprocedure,
    'private.system_health_report()'::regprocedure,
    'private.prepare_ops_alert_digest(timestamptz)'::regprocedure
  ] loop
    select * into v_contract from private.operator_rpc_contracts as contract
    where contract.signature::regprocedure = v_function;
    if found then
      perform private.register_operator_rpc_contract(
        v_function, v_contract.capability, v_contract.guard_kind, v_contract.legacy_admin_only);
    end if;
    if exists (select 1 from private.operator_internal_contracts as contract where contract.signature::regprocedure = v_function) then
      perform private.register_operator_internal_contract(v_function);
    end if;
  end loop;
end;
$register$;

select private.register_operator_rpc_contract(
  'public.admin_resolve_virtual_account_refund_watch(uuid,text)'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract(
  'public.admin_virtual_account_refund_failures(integer)'::regprocedure, 'sales.read', 'read', false);

drop function private.va_refund_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
