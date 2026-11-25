-- ==========================================================================
-- ICONS · 가상계좌 환불이 계좌 때문에 멈추면 구매자에게 알리고, 운영자가 받은 계좌를 대신 입력한다 — ADR-0049 결정 5 보강(2026-11-25)
--
-- 실운영 시나리오 VAC-041·VAC-042(2026-11-25 전수 조사): 입금된 토스 가상계좌 환불이 환급 계좌 때문에 결제확인필요
-- (provider_refund_account_required·provider_refund_account_invalid)로 멈춰도 구매자에게 알림·메일이 가지 않아, 구매자가 주문 상세를
-- 다시 열기 전까지 환불이 멈췄다(청약철회 환급 기한 3영업일). 운영자가 전화로 계좌를 받아도 시스템에 넣을 곳이 없었다.
--
-- 1. 알림: 클레임(취소·반품)이 그 두 사유로 결제확인필요가 되면 같은 트랜잭션에서 구매자(주문자)에게 앱 알림을 남긴다. 같은 클레임·같은
--    사유는 한 번만(dedupe — 재시도가 같은 사유로 다시 멈춰도 다시 보내지 않는다). 메일은 앱이 그 전이를 만든 같은 실행에서 보내고
--    (email_deliveries 템플릿 order_refund_account, 같은 dedupe), 보낼지는 서비스 함수(service_virtual_account_refund_account_notice)가
--    잠금 없이 지금 상태로 다시 판정한다 — 그 사이 계좌가 입력돼 환불이 진행됐으면 거짓 안내를 보내지 않는다. 선물 주문은 받는 분·보낸 분
--    흐름이 따로라 알리지 않는다(지금처럼 운영자가 처리).
-- 2. 운영자 대신 입력: admin_set_order_claim_refund_account(sales.manage — 환불 처리·[상태 다시 확인]과 같은 권한). 구매자 입력
--    (set_my_order_claim_refund_account)과 같은 판정(private.order_claim_refund_account_blocker → 가상계좌 판정,
--    private.virtual_account_refund_account_usable)과 같은 저장소(private.claim_refund_accounts)를 쓴다. 사유를 받고 감사 기록
--    (admin.order.claim_refund_account_entered — 누가·언제·사유, 계좌 원문 없음)을 남긴다. 개인정보 접속기록(정정)은 서버가 남긴다(IP).
--    저장 뒤 동작은 기존 재시도 규칙 그대로다 — 취소는 서버가 service_begin_virtual_account_refund_retry로 시스템 재시도, 반품은 운영자가
--    [상태 다시 확인]·[환불 완료 확정]을 누른다.
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환한다(앵커 개수가 다르면 실패).
-- ==========================================================================

begin;

create function private.va_notice_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'va_notice_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.va_notice_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 메일 템플릿(dedupe 'order_refund_account:<클레임 uuid>:<required|invalid>'). 운영자 재발송 대상은 아니다.
-- ---------------------------------------------------------------------------
alter table public.email_deliveries drop constraint email_deliveries_template_check;
alter table public.email_deliveries add constraint email_deliveries_template_check check (template = any (array[
  'order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account', 'order_deposit_reversal',
  'order_refund_account'
]));
select private.va_notice_patch(
  'public.claim_email_delivery(text,text,text,text,interval)'::regprocedure,
  $patch$[["target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account', 'order_deposit_reversal')", "target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account', 'order_deposit_reversal', 'order_refund_account')"]]$patch$::jsonb
);

-- ---------------------------------------------------------------------------
-- 2. 판정: 이 클레임이 지금 '구매자에게 환급 계좌를 받아야 하는' 가상계좌 환불인가. 아니면 null.
--    결제확인필요 + 계좌 사유(계좌 없음·결제사 거절) + 취소·반품 + 입금된 토스 가상계좌 주문 + 선물 아님.
-- ---------------------------------------------------------------------------
create function private.virtual_account_refund_account_notice(p_claim public.order_cancellation_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'claimId', p_claim.id,
    'orderId', purchase.id,
    'orderNumber', purchase.order_number,
    'userId', purchase.user_id,
    'claimType', p_claim.claim_type,
    'code', case p_claim.last_error_code when 'provider_refund_account_invalid' then 'invalid' else 'required' end)
  from public.orders as purchase
  where purchase.id = p_claim.order_id
    and p_claim.status = 'needs_review'
    and p_claim.last_error_code in ('provider_refund_account_required', 'provider_refund_account_invalid')
    and p_claim.claim_type in ('cancel', 'return')
    and purchase.payment_method = 'card'
    and purchase.user_id is not null
    and private.order_toss_virtual_account_payment(purchase.id) is not null
    and not exists (select 1 from private.gift_intents as gift where gift.order_id = purchase.id);
$function$;
revoke all on function private.virtual_account_refund_account_notice(public.order_cancellation_requests)
  from public, anon, authenticated, service_role;

-- 앱 알림 — 클레임이 계좌 사유로 결제확인필요가 되는 전이(주문 전체 취소·반품은 mark_order_cancellation_needs_review, 부분 반품은 부분 환불
-- 원장의 상태 동기화)에서 남긴다. 알림이 실패해도 결제확인필요 전이는 막지 않는다(경고만).
create function private.notify_virtual_account_refund_account_needed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_notice jsonb;
begin
  begin
    v_notice := private.virtual_account_refund_account_notice(new);
    if v_notice is null then
      return null;
    end if;
    insert into public.notifications (user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
    values (
      (v_notice->>'userId')::uuid,
      'claim_updated',
      case v_notice->>'code' when 'invalid' then '환불 계좌를 다시 확인해 주세요' else '환불받을 계좌를 입력해 주세요' end,
      case v_notice->>'code'
        when 'invalid' then '입력하신 계좌로 환불하지 못했어요. 주문 상세에서 은행·계좌번호·예금주를 확인해 다시 입력해 주세요.'
        else '가상계좌로 결제하신 주문을 환불하려면 환불받을 계좌가 필요해요. 주문 상세에서 은행·계좌번호·예금주를 입력해 주세요.'
      end,
      '/orders/' || (v_notice->>'orderId'),
      'order_claim',
      new.id::text,
      'claim:refund_account_' || (v_notice->>'code') || ':' || new.id::text)
    on conflict (user_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'virtual account refund account notice failed for claim %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke all on function private.notify_virtual_account_refund_account_needed() from public, anon, authenticated, service_role;

create trigger order_cancellation_requests_refund_account_notice
after update on public.order_cancellation_requests
for each row
when (new.status = 'needs_review'
  and new.last_error_code in ('provider_refund_account_required', 'provider_refund_account_invalid')
  and (old.status is distinct from new.status or old.last_error_code is distinct from new.last_error_code))
execute function private.notify_virtual_account_refund_account_needed();

-- 서버(service role) 전용: 메일을 보낼지 지금 상태로 다시 판정한다(주문번호·구매자 id·사유). 대상이 아니면 null.
create function public.service_virtual_account_refund_account_notice(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.virtual_account_refund_account_notice(request)
  from public.order_cancellation_requests as request
  where request.id = p_request_id;
$function$;
revoke all on function public.service_virtual_account_refund_account_notice(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_virtual_account_refund_account_notice(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. 운영자 대신 입력(sales.manage). 구매자 입력과 같은 판정·같은 저장소. 같은 작업 번호로 다시 부르면 같은 결과를 돌려준다(감사 기록 id).
-- ---------------------------------------------------------------------------
create function public.admin_set_order_claim_refund_account(
  p_claim_id uuid,
  p_operation_id uuid,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := pg_catalog.btrim(p_reason);
  v_order_id uuid;
  v_user_id uuid;
  v_purchase public.orders%rowtype;
  v_claim public.order_cancellation_requests%rowtype;
  v_prior public.audit_log%rowtype;
  v_request_hash text;
  v_blocker text;
  v_replaced boolean;
  v_revision integer;
begin
  perform private.require_operator_capability('sales.manage', false);
  if v_actor is null then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  -- 형식은 구매자 입력(set_my_order_claim_refund_account)과 같다. 결제사에 그대로 보낼 수 있는지는 아래 판정 함수 하나가 정한다.
  if p_claim_id is null or p_operation_id is null
    or p_bank_name is null or p_bank_name <> pg_catalog.btrim(p_bank_name) or pg_catalog.char_length(p_bank_name) not between 1 and 40
    or p_bank_name ~ '[[:cntrl:]]'
    or p_account_number is null or p_account_number !~ '^[0-9-]{8,30}$' or p_account_number !~ '[0-9]'
    or p_account_holder is null or p_account_holder <> pg_catalog.btrim(p_account_holder)
    or pg_catalog.char_length(p_account_holder) not between 1 and 40 or p_account_holder ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_claim_refund_account';
  end if;
  if v_reason is null or pg_catalog.char_length(v_reason) not between 2 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_refund_account_reason';
  end if;

  select request.order_id into v_order_id from public.order_cancellation_requests as request where request.id = p_claim_id;
  if v_order_id is null then
    raise no_data_found using message = 'claim_not_found';
  end if;
  select order_record.user_id into v_user_id from public.orders as order_record where order_record.id = v_order_id;
  -- 잠금 순서는 구매자 입력과 같다: 회원 → 작업 번호 → 주문 → 배송 건 → 클레임 → 결제 → 환불.
  if v_user_id is not null then
    perform private.lock_operator_subjects(array[v_user_id]);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim-refund-account:' || p_operation_id::text, 0));
  v_request_hash := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_array(
    p_operation_id, p_claim_id, v_actor, p_bank_name, p_account_number, p_account_holder, v_reason)::text, 'sha256'), 'hex');
  select entry.* into v_prior from public.audit_log as entry where entry.id = p_operation_id;
  if found then
    if v_prior.actor_id is distinct from v_actor or v_prior.action <> 'admin.order.claim_refund_account_entered'
      or v_prior.diff->>'claimId' is distinct from p_claim_id::text or v_prior.diff->>'requestHash' is distinct from v_request_hash then
      raise unique_violation using message = 'refund_account_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object('state', 'saved', 'replayed', true, 'claimId', p_claim_id, 'orderId', v_order_id,
      'claimType', v_prior.diff->>'claimType', 'revision', (v_prior.diff->>'resultRevision')::integer);
  end if;

  select order_record.* into v_purchase from public.orders as order_record where order_record.id = v_order_id for update;
  perform shipment.id from public.order_shipments as shipment where shipment.order_id = v_order_id order by shipment.id for update;
  select request.* into v_claim from public.order_cancellation_requests as request
  where request.id = p_claim_id and request.order_id = v_order_id for update;
  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;
  perform payment.id from public.payments as payment where payment.purpose = 'order' and payment.ref_id = v_order_id order by payment.id for update;
  perform refund.id from public.refunds as refund join public.payments as payment on payment.id = refund.payment_id
  where payment.purpose = 'order' and payment.ref_id = v_order_id order by refund.id for update of refund;

  -- 대신 입력은 입금된 토스 가상계좌 주문만이다(회사 계좌 무통장의 환불계좌는 송금 담당 흐름이 따로 있다).
  if v_purchase.payment_method is distinct from 'card' or private.order_toss_virtual_account_payment(v_order_id) is null then
    raise check_violation using message = 'refund_account_not_virtual_account';
  end if;
  v_blocker := private.order_claim_refund_account_blocker(v_claim, v_purchase);
  if v_blocker is not null then
    raise check_violation using message = v_blocker;
  end if;
  if not private.virtual_account_refund_account_usable(p_bank_name, p_account_number, p_account_holder) then
    raise invalid_parameter_value using message = 'invalid_virtual_account_refund_account';
  end if;

  v_replaced := exists (select 1 from private.claim_refund_accounts as account where account.claim_id = v_claim.id);
  insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
  values (v_claim.id, p_bank_name, p_account_number, p_account_holder,
    p_bank_name || ' ' || public.mask_refund_account_number(p_account_number), public.mask_refund_account_holder(p_account_holder))
  on conflict (claim_id) do update set bank_name = excluded.bank_name, account_number = excluded.account_number,
    account_holder = excluded.account_holder, masked_account = excluded.masked_account, masked_holder = excluded.masked_holder,
    created_at = pg_catalog.clock_timestamp(), purge_after = null, purged_at = null;
  update public.order_cancellation_requests set updated_at = pg_catalog.clock_timestamp()
  where id = v_claim.id
  returning claim_revision into v_revision;

  -- 누가·언제(created_at)·왜. 계좌 원문은 남기지 않는다(같은 요청인지 대조하는 해시만 — 작업 번호를 섞는다).
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (p_operation_id, v_actor, 'admin.order.claim_refund_account_entered', 'order:' || v_order_id::text,
    pg_catalog.jsonb_build_object('claimId', v_claim.id, 'claimType', v_claim.claim_type, 'reason', v_reason,
      'mode', 'virtual_account', 'replaced', v_replaced, 'resultRevision', v_revision,
      'lastErrorCode', v_claim.last_error_code, 'requestHash', v_request_hash));

  return pg_catalog.jsonb_build_object('state', 'saved', 'replayed', false, 'claimId', v_claim.id, 'orderId', v_order_id,
    'claimType', v_claim.claim_type, 'revision', v_revision);
end;
$function$;
revoke all on function public.admin_set_order_claim_refund_account(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_order_claim_refund_account(uuid, uuid, text, text, text, text) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_set_order_claim_refund_account(uuid,uuid,text,text,text,text)'::regprocedure, 'sales.manage', 'write', false);

-- ---------------------------------------------------------------------------
-- 4. 운영자 계약 재등록(재정의한 함수)
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'public.claim_email_delivery(text,text,text,text,interval)'::regprocedure
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

drop function private.va_notice_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
