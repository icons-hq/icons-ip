-- ==========================================================================
-- ICONS · 토스 가상계좌 입금 대기 — ADR-0049
--
-- 승인 API 200의 WAITING_FOR_DEPOSIT은 계좌 발급이지 결제 완료가 아니다. 이 migration이
-- DB 안에서 고정하는 것:
--   1. 입금 대기 진입은 전용 finalizer(finalize_goods_payment_awaiting_deposit)만 한다.
--      confirming + claim을 쥔 시도만, 이 주문·이 사용자·이 금액일 때만, 입금 기한이
--      지금 뒤 72시간 안일 때만 'awaiting_deposit'으로 바꾸고 주문·시도의 expires_at을
--      입금 기한으로 늘린다. 조건이 맞지 않으면 needs_review로 격리한다(앱이 계좌를 반납).
--   2. 입금(DONE)·만료·반납은 기존 재정합 claim(awaiting_deposit → confirming) →
--      기존 finalizer(approved/declined)로 닫는다. 새 상태를 받아들이도록 claim을 넓힌다.
--   3. 정리 함수는 입금 대기 주문을 건드리지 않는다 — 만료 정리·장바구니 대체·취소 가드·
--      계정 삭제·상품 그룹 전환·부분 취소·고객 취소·운영자 취소·만료 준비 결제 판정의
--      상태 목록에 'awaiting_deposit'을 더한다. 하나라도 빠지면 입금이 들어올 수 있는
--      주문의 재고가 풀린다(SQL 스모크 toss_virtual_account_awaiting_deposit.sql이 고정).
--   4. 자동 재확인 cron 후보에 입금 기한이 지난(또는 6시간 넘게 조회하지 않은) 입금 대기
--      시도를 더한다. 입금 기한 만료에는 토스 웹훅이 없다.
--   5. 입금 오류 되돌림(DONE → WAITING_FOR_DEPOSIT)은 원장을 되돌리지 않고 출고 보류
--      (사유 deposit_reversed)를 건다.
--   6. 구매자는 자기 주문의 입금 계좌를, 운영자(sales.read)는 주문의 입금 계좌를 읽는다.
--   7. 결제 UI가 받은 구매자 환불 계좌(승인 응답 virtualAccount.refundReceiveAccount — 결제창을 띄운 뒤
--      30분만 조회된다)를 입금 대기 확정 때 함께 남기고, 입금 뒤 환불(취소 API refundReceiveAccount)에 쓴다.
--      180일 뒤 지운다.
--   8. 계정당 열린 입금 대기는 2건까지다(입금 기한 동안 재고를 묶는 남용 방지). 넘으면 거부해 앱이 반납한다.
--   9. 입금 기한이 2시간 넘게 지났는데 닫히지 않은 입금 대기는 시스템 상태의 미종결 결제로 보인다.
--
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환해 다시 실행한다(앵커 개수가
-- 기대와 다르면 실패). 실행 권한은 create or replace라 그대로이고, 운영자 계약은 끝에서
-- 새 본문으로 다시 적는다.
-- ==========================================================================

begin;

create function private.va_seam_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'va_seam_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;

revoke all on function private.va_seam_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 가상계좌 원장(시도당 하나). 계좌번호는 결제사가 주문마다 발급한 수납 계좌다.
-- ---------------------------------------------------------------------------
create table private.payment_attempt_virtual_accounts (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_payment_key text not null check (
    char_length(provider_payment_key) between 1 and 200 and provider_payment_key !~ '[[:space:][:cntrl:]]'),
  bank_code text not null check (bank_code ~ '^[0-9]{2,3}$'),
  account_number text not null check (
    char_length(account_number) between 4 and 40 and account_number ~ '^[0-9A-Za-z*-]+$'),
  due_at timestamptz not null,
  use_escrow boolean,
  -- 구매자가 결제 UI에 입력한 환불 계좌(토스 은행 코드). 입금 뒤 환불에만 쓰고 refund_account_purge_after에 지운다.
  refund_bank_code text check (refund_bank_code is null or refund_bank_code ~ '^[0-9]{2,3}$'),
  refund_account_number text check (refund_account_number is null or refund_account_number ~ '^[0-9]{6,20}$'),
  refund_holder_name text check (refund_holder_name is null or (
    char_length(refund_holder_name) between 1 and 50 and refund_holder_name !~ '[[:cntrl:]]')),
  refund_account_purge_after timestamptz,
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint payment_attempt_virtual_accounts_refund_account_complete check (
    (refund_bank_code is null) = (refund_account_number is null)
    and (refund_bank_code is null) = (refund_holder_name is null))
);
create index payment_attempt_virtual_accounts_order on private.payment_attempt_virtual_accounts(order_id);
alter table private.payment_attempt_virtual_accounts enable row level security;
revoke all on private.payment_attempt_virtual_accounts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 출고 보류 사유 deposit_reversed · 앱 알림 종류 order_virtual_account_issued
-- ---------------------------------------------------------------------------
alter table private.order_fulfillment_holds drop constraint order_fulfillment_holds_reason_check;
alter table private.order_fulfillment_holds add constraint order_fulfillment_holds_reason_check
  check (reason = any (array['test_payment', 'provider_canceled', 'deposit_reversed', 'escrow_cancel_requested']));
alter table private.order_fulfillment_holds drop constraint order_fulfillment_holds_evidence;
alter table private.order_fulfillment_holds add constraint order_fulfillment_holds_evidence check (
  (reason = 'test_payment' and payment_attempt_id is not null
    and evidence_key = 'test_payment:' || payment_attempt_id::text)
  or (reason = 'provider_canceled' and payment_attempt_id is not null
    and evidence_key ~ ('^provider_canceled:' || payment_attempt_id::text || ':[1-9][0-9]{0,14}$'))
  or (reason = 'deposit_reversed' and payment_attempt_id is not null
    and evidence_key ~ ('^deposit_reversed:' || payment_attempt_id::text || ':[0-9a-f]{32}$'))
  or (reason = 'escrow_cancel_requested' and payment_attempt_id is not null
    and evidence_key ~ ('^escrow_cancel_requested:' || payment_attempt_id::text || ':[0-9a-f]{32}$'))
);

select private.va_seam_patch(
  'public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)'::regprocedure,
  $patch$[["p_reason not in ('test_payment', 'provider_canceled')", "p_reason not in ('test_payment', 'provider_canceled', 'deposit_reversed', 'escrow_cancel_requested')"]]$patch$::jsonb
);

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'announcement', 'claim_updated', 'draw_ticket_issued', 'drop_published', 'event_published',
  'inquiry_answered', 'loyalty_grade_upgraded', 'marketing_message', 'order_bank_transfer_pending',
  'order_delivered', 'order_paid', 'order_shipping', 'product_question_answered',
  'purchase_confirmation', 'restock_available', 'review_replied', 'loyalty_monthly_coupons_issued',
  'order_virtual_account_issued'
]));

-- 입금 안내 메일(템플릿 order_virtual_account, dedupe 'order_virtual_account:<주문 uuid>'). 운영자 재발송 대상은 아니다.
alter table public.email_deliveries drop constraint email_deliveries_template_check;
alter table public.email_deliveries add constraint email_deliveries_template_check check (template = any (array[
  'order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account'
]));
select private.va_seam_patch(
  'public.claim_email_delivery(text,text,text,text,interval)'::regprocedure,
  $patch$[["target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert')", "target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account')"]]$patch$::jsonb
);

-- ---------------------------------------------------------------------------
-- 3. 입금 대기 진입 finalizer
-- ---------------------------------------------------------------------------
create function private.finalize_goods_payment_awaiting_deposit_core(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_provider_payment_key text,
  p_bank_code text,
  p_account_number text,
  p_due_at timestamptz,
  p_use_escrow boolean,
  p_refund_bank_code text,
  p_refund_account_number text,
  p_refund_holder_name text
)
returns public.payment_attempt_state
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_has_account boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_key text := nullif(pg_catalog.btrim(p_provider_payment_key), '');
  v_refusal text;
  v_first boolean;
begin
  if p_attempt_id is null or p_claim_token is null then
    raise invalid_parameter_value using message = 'goods_payment_finalization_invalid';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id and attempt.purpose = 'order' and attempt.provider = 'toss';
  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review', 'awaiting_deposit') then
    return v_attempt.state;
  end if;

  -- 공통 잠금 순서: order → request → attempt.
  select order_record.* into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;
  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  perform 1
  from public.order_cancellation_requests as request
  where request.order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  for update;
  if found then
    v_refusal := 'cancel_requested';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review', 'awaiting_deposit') then
    return v_attempt.state;
  end if;
  if v_attempt.state is distinct from 'confirming' or v_attempt.claim_token is distinct from p_claim_token then
    raise object_not_in_prerequisite_state using message = 'goods_payment_claim_invalid';
  end if;

  if v_refusal is null and (
    v_key is null
    or v_key ~ '[[:space:][:cntrl:]]'
    or char_length(v_key) > 200
    or p_bank_code is null or p_bank_code !~ '^[0-9]{2,3}$'
    or p_account_number is null or char_length(p_account_number) not between 4 and 40
    or p_account_number !~ '^[0-9A-Za-z*-]+$'
  ) then
    v_refusal := 'invalid_virtual_account';
  end if;
  -- 입금 기한: 새 발급은 지금 뒤 72시간 안이어야 한다. 이미 남긴 계좌를 다시 확인하는 재정합은 기한이 막 지난
  -- 1시간 유예 안에서도 입금 대기로 되돌린다(늦은 입금 통보를 기다린다 — 그 뒤 자동 재확인이 반납한다).
  select exists (select 1 from private.payment_attempt_virtual_accounts as va where va.attempt_id = v_attempt.id)
  into v_has_account;
  if v_refusal is null and (
    p_due_at is null
    or p_due_at > v_now + interval '72 hours'
    or p_due_at <= v_now - interval '1 hour'
    or (p_due_at <= v_now and not v_has_account)
  ) then
    v_refusal := 'deposit_window_out_of_range';
  end if;
  if v_refusal is null and not v_has_account and (
    select count(*) from public.payment_attempts as other
    where other.user_id = v_attempt.user_id and other.purpose = 'order'
      and other.state = 'awaiting_deposit' and other.id <> v_attempt.id
  ) >= 2 then
    v_refusal := 'open_deposit_limit';
  end if;
  if v_refusal is null and (
    (p_refund_bank_code is null) <> (p_refund_account_number is null)
    or (p_refund_bank_code is null) <> (p_refund_holder_name is null)
    or (p_refund_bank_code is not null and (
      p_refund_bank_code !~ '^[0-9]{2,3}$'
      or p_refund_account_number !~ '^[0-9]{6,20}$'
      or char_length(p_refund_holder_name) not between 1 and 50
      or p_refund_holder_name ~ '[[:cntrl:]]'))
  ) then
    -- 환불 계좌 형식이 틀리면 계좌는 버리고 입금 대기는 그대로 받는다(환불 때 계좌를 다시 받는다).
    p_refund_bank_code := null;
    p_refund_account_number := null;
    p_refund_holder_name := null;
  end if;
  if v_refusal is null and (
    v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.payment_method is distinct from 'card'
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1 from public.profiles as profile
      where profile.id = v_attempt.user_id and profile.suspended_at is not null
    )
    or not private.goods_order_snapshot_matches(v_order.id, v_order.total, v_order.shipping_fee)
    or exists (
      select 1 from public.payments as payment
      where payment.purpose = 'order' and payment.ref_id = v_order.id and payment.status in ('pending', 'paid')
    )
    or exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = v_attempt.id and va.provider_payment_key is distinct from v_key
    )
  ) then
    v_refusal := 'order_not_awaitable';
  end if;

  if v_refusal is not null then
    update public.payment_attempts
    set state = 'needs_review', claim_token = null, claim_expires_at = null
    where id = v_attempt.id;
    insert into private.payment_provider_evidence(
      payment_attempt_id, evidence_kind, provider_payment_key, result_code, payment_method)
    values (
      v_attempt.id, 'confirm_needs_review',
      case when v_key is not null and char_length(v_key) <= 200 and v_key !~ '[[:space:][:cntrl:]]' then v_key end,
      'WAITING_FOR_DEPOSIT_' || v_refusal, '가상계좌');
    return 'needs_review';
  end if;

  insert into private.payment_attempt_virtual_accounts(
    attempt_id, order_id, provider_payment_key, bank_code, account_number, due_at, use_escrow,
    refund_bank_code, refund_account_number, refund_holder_name, refund_account_purge_after)
  values (v_attempt.id, v_order.id, v_key, p_bank_code, p_account_number, p_due_at, p_use_escrow,
    p_refund_bank_code, p_refund_account_number, p_refund_holder_name,
    case when p_refund_bank_code is not null then v_now + interval '180 days' end)
  on conflict (attempt_id) do update
    set bank_code = excluded.bank_code,
        account_number = excluded.account_number,
        due_at = excluded.due_at,
        use_escrow = coalesce(excluded.use_escrow, private.payment_attempt_virtual_accounts.use_escrow),
        -- 환불 계좌는 결제창 뒤 30분만 조회되므로 재정합이 null을 가져와도 처음 남긴 값을 지우지 않는다.
        refund_bank_code = coalesce(excluded.refund_bank_code, private.payment_attempt_virtual_accounts.refund_bank_code),
        refund_account_number = coalesce(excluded.refund_account_number, private.payment_attempt_virtual_accounts.refund_account_number),
        refund_holder_name = coalesce(excluded.refund_holder_name, private.payment_attempt_virtual_accounts.refund_holder_name),
        refund_account_purge_after = coalesce(private.payment_attempt_virtual_accounts.refund_account_purge_after, excluded.refund_account_purge_after),
        updated_at = pg_catalog.clock_timestamp()
  returning (xmax = 0) into v_first;

  update public.payment_attempts
  set state = 'awaiting_deposit', claim_token = null, claim_expires_at = null, expires_at = p_due_at
  where id = v_attempt.id;
  update public.orders set expires_at = p_due_at where id = v_order.id;

  insert into private.payment_provider_evidence(
    payment_attempt_id, evidence_kind, provider_payment_key, result_code, payment_method)
  values (v_attempt.id, 'confirm_awaiting_deposit', v_key, 'WAITING_FOR_DEPOSIT', '가상계좌');

  if v_first then
    insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
    values (
      v_order.user_id,
      'order_virtual_account_issued',
      '입금 계좌를 안내해 드려요',
      pg_catalog.format('%s원을 %s까지 안내된 계좌로 입금해주세요. 기한이 지나면 주문이 자동 취소돼요.',
        pg_catalog.to_char(v_order.total, 'FM999,999,999,999'),
        pg_catalog.to_char(p_due_at at time zone 'Asia/Seoul', 'MM"월" DD"일" HH24:MI')),
      '/orders/' || v_order.id::text || '/complete',
      'order',
      v_order.id::text,
      'order:virtual_account_issued:' || v_order.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return 'awaiting_deposit';
end;
$function$;
revoke all on function private.finalize_goods_payment_awaiting_deposit_core(uuid, uuid, text, text, text, timestamptz, boolean, text, text, text)
  from public, anon, authenticated, service_role;

create function public.finalize_goods_payment_awaiting_deposit(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_provider_payment_key text,
  p_bank_code text,
  p_account_number text,
  p_due_at timestamptz,
  p_use_escrow boolean,
  p_refund_bank_code text default null,
  p_refund_account_number text default null,
  p_refund_holder_name text default null
)
returns public.payment_attempt_state
language sql
security definer
set search_path = ''
as $function$
  select private.finalize_goods_payment_awaiting_deposit_core(
    p_attempt_id, p_claim_token, p_provider_payment_key, p_bank_code, p_account_number, p_due_at, p_use_escrow,
    p_refund_bank_code, p_refund_account_number, p_refund_holder_name);
$function$;
revoke all on function public.finalize_goods_payment_awaiting_deposit(uuid, uuid, text, text, text, timestamptz, boolean, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_payment_awaiting_deposit(uuid, uuid, text, text, text, timestamptz, boolean, text, text, text)
  to service_role;

create function public.finalize_goods_payment_reconciliation_awaiting_deposit(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_provider_payment_key text,
  p_bank_code text,
  p_account_number text,
  p_due_at timestamptz,
  p_use_escrow boolean,
  p_refund_bank_code text default null,
  p_refund_account_number text default null,
  p_refund_holder_name text default null
)
returns public.payment_attempt_state
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_outcome public.payment_attempt_state;
begin
  v_outcome := private.finalize_goods_payment_awaiting_deposit_core(
    p_attempt_id, p_claim_token, p_provider_payment_key, p_bank_code, p_account_number, p_due_at, p_use_escrow,
    p_refund_bank_code, p_refund_account_number, p_refund_holder_name);
  update private.goods_payment_reconciliation_audits
  set claim_status = 'terminal', outcome = v_outcome, finalized_at = pg_catalog.clock_timestamp()
  where claim_token = p_claim_token and operation = 'payment' and target_id = p_attempt_id;
  if not found then
    raise object_not_in_prerequisite_state using message = 'goods_reconciliation_audit_missing';
  end if;
  return v_outcome;
end;
$function$;
revoke all on function public.finalize_goods_payment_reconciliation_awaiting_deposit(uuid, uuid, text, text, text, timestamptz, boolean, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_payment_reconciliation_awaiting_deposit(uuid, uuid, text, text, text, timestamptz, boolean, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. 입금 계좌 조회(구매자 본인 · 운영자 sales.read)
-- ---------------------------------------------------------------------------
create function private.order_virtual_account_json(p_order_id uuid)
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
    end
  )
  from private.payment_attempt_virtual_accounts as va
  join public.payment_attempts as attempt on attempt.id = va.attempt_id
  where va.order_id = p_order_id
  order by va.issued_at desc
  limit 1;
$function$;
revoke all on function private.order_virtual_account_json(uuid) from public, anon, authenticated, service_role;

create function public.get_my_order_virtual_account(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if p_order_id is null or not exists (
    select 1 from public.orders as order_record
    where order_record.id = p_order_id and order_record.user_id = v_actor
  ) then
    return null;
  end if;
  -- 구매자에게는 운영용 에스크로 작업 상태(20261125090200이 더한다)를 보이지 않는다.
  return private.order_virtual_account_json(p_order_id) - 'escrow';
end;
$function$;
revoke all on function public.get_my_order_virtual_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_virtual_account(uuid) to authenticated;

create function public.admin_order_virtual_account(p_order_id uuid)
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
  if p_order_id is null then
    raise invalid_parameter_value using message = 'invalid_order';
  end if;
  return private.order_virtual_account_json(p_order_id);
end;
$function$;
revoke all on function public.admin_order_virtual_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_virtual_account(uuid) to authenticated;

-- 서버(service role) 전용: 메일·화면 서버 렌더가 주문 소유 확인 뒤 읽는다.
create function public.service_order_virtual_account(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.order_virtual_account_json(p_order_id);
$function$;
revoke all on function public.service_order_virtual_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_order_virtual_account(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. 입금 오류 되돌림 → 출고 보류(원장은 그대로)
-- ---------------------------------------------------------------------------
create function public.service_flag_goods_deposit_reversal(
  p_attempt_id uuid,
  p_payment_key text,
  p_transaction_ref text,
  p_case_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_hold uuid;
begin
  if p_attempt_id is null or p_payment_key is null or p_transaction_ref is null
    or char_length(p_transaction_ref) not between 1 and 200
    or (p_case_ref is not null and p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$') then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal';
  end if;

  select attempt.* into v_attempt from public.payment_attempts as attempt
  where attempt.id = p_attempt_id and attempt.purpose = 'order' and attempt.provider = 'toss';
  if not found then
    return 'not_applicable';
  end if;
  select order_record.* into v_order from public.orders as order_record
  where order_record.id = v_attempt.ref_id for update;
  select attempt.* into v_attempt from public.payment_attempts as attempt where attempt.id = p_attempt_id for update;

  if v_attempt.state <> 'approved' or v_order.status = 'canceled'
    or not exists (
      select 1 from public.payments as payment
      where payment.id = v_attempt.payment_id and payment.payment_key = p_payment_key and payment.status = 'paid')
    or not exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = v_attempt.id and va.provider_payment_key = p_payment_key)
  then
    return 'not_applicable';
  end if;

  insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
  values (
    v_order.id, 'deposit_reversed',
    'deposit_reversed:' || v_attempt.id::text || ':' || pg_catalog.md5(p_transaction_ref),
    v_attempt.id,
    pg_catalog.jsonb_build_object('providerStatus', 'WAITING_FOR_DEPOSIT', 'caseRef', p_case_ref))
  on conflict (order_id, reason, evidence_key) do nothing
  returning id into v_hold;

  if v_hold is null then
    return 'already_recorded';
  end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.fulfillment_hold_placed', 'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object('reason', 'deposit_reversed', 'attemptId', v_attempt.id, 'holdId', v_hold, 'caseRef', p_case_ref));
  return 'held';
end;
$function$;
revoke all on function public.service_flag_goods_deposit_reversal(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_flag_goods_deposit_reversal(uuid, text, text, text) to service_role;

-- 구매자·주문 화면 서버 렌더가 입금 대기 시도인지 읽는다(서비스 전용).
create function public.service_goods_attempt_for_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('attemptId', attempt.id, 'state', attempt.state, 'provider', attempt.provider)
  from public.payment_attempts as attempt
  where attempt.purpose = 'order' and attempt.ref_id = p_order_id
  order by attempt.created_at desc, attempt.id desc
  limit 1;
$function$;
revoke all on function public.service_goods_attempt_for_order(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_attempt_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. 상태 목록 패치 — 입금 대기 주문은 정리·대체·취소되지 않는다
-- ---------------------------------------------------------------------------
select private.va_seam_patch('private.account_deletion_blockers(uuid)'::regprocedure,
  $p$[["attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')", "attempt.state in ('prepared', 'confirming', 'awaiting_deposit', 'unknown', 'needs_review')"]]$p$::jsonb);

select private.va_seam_patch('private.checkout_draft_order_payment_unresolved(uuid)'::regprocedure,
  $p$[["attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')", "attempt.state in ('confirming', 'awaiting_deposit', 'unknown', 'needs_review', 'approved')"]]$p$::jsonb);

-- 콜백 claim: 이미 입금 대기면 다시 승인하지 않고 그 상태를 돌려준다(중복 successUrl).
select private.va_seam_patch('private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure,
  $p$[["if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then", "if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review', 'awaiting_deposit') then", 2]]$p$::jsonb);

select private.va_seam_patch('private.close_unpaid_cart_order(uuid,text,text)'::regprocedure,
  $p$[["(v_has_attempt and v_attempt.state in ('confirming', 'unknown', 'needs_review', 'approved'))", "(v_has_attempt and v_attempt.state in ('confirming', 'awaiting_deposit', 'unknown', 'needs_review', 'approved'))"]]$p$::jsonb);

select private.va_seam_patch('private.contact_order_obligations(uuid)'::regprocedure,
  $p$[["state in('prepared','confirming','unknown','needs_review')", "state in('prepared','confirming','awaiting_deposit','unknown','needs_review')"]]$p$::jsonb);

select private.va_seam_patch('private.goods_group_conversion_blockers(text)'::regprocedure,
  $p$[["attempt.state in('prepared','confirming','unknown','needs_review')", "attempt.state in('prepared','confirming','awaiting_deposit','unknown','needs_review')"]]$p$::jsonb);

select private.va_seam_patch('private.guard_unresolved_goods_payment_cancellation()'::regprocedure,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(
    E'            ''prepared'',\n            ''confirming'',\n',
    E'            ''prepared'',\n            ''confirming'',\n            ''awaiting_deposit'',\n')));

select private.va_seam_patch('private.order_partial_cancellation_blockers(uuid)'::regprocedure,
  $p$[["a.state in ('prepared', 'confirming', 'unknown', 'needs_review')", "a.state in ('prepared', 'confirming', 'awaiting_deposit', 'unknown', 'needs_review')"]]$p$::jsonb);

select private.va_seam_patch(
  'private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure,
  $p$[["'prepared', 'confirming', 'unknown', 'needs_review', 'approved'", "'prepared', 'confirming', 'awaiting_deposit', 'unknown', 'needs_review', 'approved'", 2]]$p$::jsonb);

select private.va_seam_patch('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
  $p$[["attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')", "attempt.state in ('prepared', 'confirming', 'awaiting_deposit', 'unknown', 'needs_review')"]]$p$::jsonb);

-- 재정합 claim: 입금 대기 시도를 잡아(confirming, 10분 리스) 입금·만료·반납을 판정한다.
select private.va_seam_patch('public.claim_goods_payment_reconciliation(uuid,uuid,text)'::regprocedure,
  $p$[["if v_attempt.state not in ('unknown', 'needs_review', 'confirming') then", "if v_attempt.state not in ('unknown', 'needs_review', 'confirming', 'awaiting_deposit') then"]]$p$::jsonb);

select private.va_seam_patch('public.expire_stale_checkouts()'::regprocedure,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_array(
      $a$and attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')$a$,
      $a$and attempt.state in ('confirming', 'awaiting_deposit', 'unknown', 'needs_review', 'approved')$a$,
      2),
    pg_catalog.jsonb_build_array(
      E'      elsif v_attempt.state in (\n        ''confirming'',\n',
      E'      elsif v_attempt.state in (\n        ''confirming'',\n        ''awaiting_deposit'',\n',
      2)));

select private.va_seam_patch('public.get_my_gift_checkout_order(uuid,uuid)'::regprocedure,
  $p$[["attempt_state in('confirming','unknown','needs_review')", "attempt_state in('confirming','awaiting_deposit','unknown','needs_review')"]]$p$::jsonb);
select private.va_seam_patch('public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure,
  $p$[["attempt_state in('confirming','unknown','needs_review')", "attempt_state in('confirming','awaiting_deposit','unknown','needs_review')"]]$p$::jsonb);

select private.va_seam_patch('public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)'::regprocedure,
  $p$[["if v_attempt.state in ('confirming', 'approved', 'unknown', 'needs_review') then", "if v_attempt.state in ('confirming', 'awaiting_deposit', 'approved', 'unknown', 'needs_review') then"]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 7. 자동 재확인 후보 — 입금 기한이 지났거나 6시간 넘게 조회하지 않은 입금 대기
-- ---------------------------------------------------------------------------
create or replace function public.service_claim_payment_reconciliation_candidates(p_limit integer, p_providers text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare at timestamptz := clock_timestamp(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5 or p_providers is null or cardinality(p_providers) > 4
    or array_position(p_providers, null) is not null or not (p_providers <@ array['toss', 'nicepay']::text[]) then
    raise invalid_parameter_value using message = 'invalid_reconciliation_candidate_filter';
  end if;
  with picked as (
    select c.id, c.purpose, c.provider, c.ref_id, c.last_checked_at, c.updated_at from (
      select a.id, a.purpose, a.provider, a.ref_id, a.updated_at, a.state,
        greatest(
          (select max(g.requested_at) from private.goods_payment_reconciliation_audits g where g.target_id = a.id),
          (select max(t.requested_at) from private.ticket_payment_reconciliation_audits t where t.target_id = a.id),
          (select m.last_picked_at from private.payment_reconciliation_auto_checks m where m.attempt_id = a.id)) as last_checked_at
      from public.payment_attempts a
      where a.provider::text = any(p_providers)
        and a.created_at >= at - interval '7 days'
        and (
          (a.state in ('unknown', 'confirming')
            and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)
            and ((a.purpose = 'order' and a.provider in ('toss', 'nicepay')) or (a.purpose = 'ticket' and a.provider = 'toss'))
            and a.updated_at <= at - interval '10 minutes')
          or (a.state = 'awaiting_deposit' and a.purpose = 'order' and a.provider = 'toss'
            and (a.expires_at <= at - interval '2 minutes' or a.updated_at <= at - interval '6 hours'))
        )
    ) c
    where c.last_checked_at is null
      or c.last_checked_at <= at - case when c.state = 'awaiting_deposit' then interval '10 minutes' else interval '30 minutes' end
    order by c.last_checked_at nulls first, c.updated_at, c.id
    limit p_limit
  ), marked as (
    insert into private.payment_reconciliation_auto_checks as m(attempt_id, last_picked_at)
    select id, at from picked
    on conflict (attempt_id) do update set last_picked_at = excluded.last_picked_at, picks = m.picks + 1
    returning m.attempt_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('attemptId', p.id, 'purpose', p.purpose, 'provider', p.provider, 'refId', p.ref_id)
    order by p.last_checked_at nulls first, p.updated_at, p.id), '[]'::jsonb)
  into result
  from picked p where p.id in (select attempt_id from marked);
  return result;
end $function$;

-- ---------------------------------------------------------------------------
-- 7-1. 서버 전용 조회 — 재정합 힌트(저장된 결제 키)·입금 뒤 환불 계좌
-- ---------------------------------------------------------------------------
-- 재정합이 쓸 결제 키 힌트. 주문서형 시크릿 키가 쓸 수 있다고 명시된 조회는 paymentKey 조회다 — 본문에 결제
-- 키가 없는 웹훅(DEPOSIT_CALLBACK)과 자동 재확인이 이 키로 조회한다(힌트일 뿐 판정은 조회 응답이 한다).
create function public.service_goods_attempt_payment_key_hint(p_attempt_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select va.provider_payment_key from private.payment_attempt_virtual_accounts as va where va.attempt_id = p_attempt_id),
    (select evidence.provider_payment_key from private.payment_provider_evidence as evidence
      where evidence.payment_attempt_id = p_attempt_id and evidence.provider_payment_key is not null
      order by evidence.recorded_at desc, evidence.id desc limit 1));
$function$;
revoke all on function public.service_goods_attempt_payment_key_hint(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_attempt_payment_key_hint(uuid) to service_role;

-- 입금 뒤 가상계좌 환불에 실을 구매자 환불 계좌(결제 UI가 받은 값). 결제 시도의 원장 결제 키와 같을 때만 준다.
create function public.service_goods_virtual_account_refund_account(p_attempt_id uuid, p_payment_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'bankCode', va.refund_bank_code,
    'accountNumber', va.refund_account_number,
    'holderName', va.refund_holder_name)
  from private.payment_attempt_virtual_accounts as va
  where va.attempt_id = p_attempt_id
    and va.provider_payment_key = p_payment_key
    and va.refund_bank_code is not null;
$function$;
revoke all on function public.service_goods_virtual_account_refund_account(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_virtual_account_refund_account(uuid, text) to service_role;

-- 환불 계좌 파기(매일 04:20 KST). 남은 기간이 지나면 세 칸을 함께 지운다.
create function private.purge_virtual_account_refund_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  update private.payment_attempt_virtual_accounts
  set refund_bank_code = null, refund_account_number = null, refund_holder_name = null,
      updated_at = pg_catalog.clock_timestamp()
  where refund_bank_code is not null and refund_account_purge_after <= pg_catalog.clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function private.purge_virtual_account_refund_accounts() from public, anon, authenticated, service_role;

-- UTC 19:20 = KST 04:20. cron.schedule은 이름 기준 upsert라 재적용에 안전하다.
select cron.schedule(
  'purge-virtual-account-refund-accounts',
  '20 19 * * *',
  'select private.purge_virtual_account_refund_accounts()'
);

-- 입금 기한이 2시간 넘게 지났는데 닫히지 않은 입금 대기 = 자동 재확인이 멈춘 신호 → 미종결 결제로 보인다.
select private.va_seam_patch('private.system_health_report()'::regprocedure,
  $p$[["a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)", "((a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)) or (a.state = 'awaiting_deposit' and a.expires_at <= at - interval '2 hours'))"]]$p$::jsonb);
select private.va_seam_patch('public.admin_unresolved_payment_attempts(integer)'::regprocedure,
  $p$[["a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)", "((a.state in ('unknown', 'needs_review', 'confirming') and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)) or (a.state = 'awaiting_deposit' and a.expires_at <= at - interval '2 hours'))"]]$p$::jsonb);

-- 입금 대기도 아직 닫히지 않은 결제다. 이 판정을 쓰는 곳은 세 갈래다 —
--  · 상태 보고·미종결 목록·자동 재확인 후보: 상태를 먼저 거른 뒤 부르므로 영향 없다(입금 대기는 위 별도 조건).
--  · 운영자 [결제 상태 다시 확인](admin_begin_payment_reconciliation): 입금 대기를 받는다 — 위 목록의 기한 지난 입금
--    대기를 운영자가 바로 조회한다(조회가 판정하고, 기한 + 30분이 지난 계좌만 반납한다).
--  · 자동 재확인 표식 정리(maintain_system_job_records): 입금 대기의 표식을 지우지 않는다 — 10분 재확인 간격이 유지된다.
create or replace function private.payment_attempt_unresolved(p_state public.payment_attempt_state, p_claim_expires_at timestamptz, p_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_state in ('unknown', 'needs_review', 'awaiting_deposit') or (p_state = 'confirming' and p_claim_expires_at is not null and p_claim_expires_at <= p_at)
$$;
revoke all on function private.payment_attempt_unresolved(public.payment_attempt_state, timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. 운영자 계약 재등록(재정의한 함수) · 새 운영자 RPC 등록
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)'::regprocedure,
    'public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
    'public.claim_goods_payment_reconciliation(uuid,uuid,text)'::regprocedure,
    'public.expire_stale_checkouts()'::regprocedure,
    'public.get_my_gift_checkout_order(uuid,uuid)'::regprocedure,
    'public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure,
    'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)'::regprocedure,
    'public.service_claim_payment_reconciliation_candidates(integer,text[])'::regprocedure,
    'private.account_deletion_blockers(uuid)'::regprocedure,
    'private.checkout_draft_order_payment_unresolved(uuid)'::regprocedure,
    'private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure,
    'private.close_unpaid_cart_order(uuid,text,text)'::regprocedure,
    'private.contact_order_obligations(uuid)'::regprocedure,
    'private.goods_group_conversion_blockers(text)'::regprocedure,
    'private.guard_unresolved_goods_payment_cancellation()'::regprocedure,
    'private.order_partial_cancellation_blockers(uuid)'::regprocedure,
    'private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure,
    'private.system_health_report()'::regprocedure,
    'public.admin_unresolved_payment_attempts(integer)'::regprocedure,
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

select private.register_operator_rpc_contract(
  'public.admin_order_virtual_account(uuid)'::regprocedure, 'sales.read', 'read', false);

drop function private.va_seam_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
