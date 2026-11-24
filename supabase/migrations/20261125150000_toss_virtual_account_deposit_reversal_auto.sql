-- ==========================================================================
-- ICONS · 토스 가상계좌 입금 오류 되돌림 자동 처리 — ADR-0049 결정 4(2026-11-24 개정)
--
-- 입금 통보(DONE) 뒤 은행이 입금을 취소해 결제가 WAITING_FOR_DEPOSIT으로 돌아가면(토스 웹훅 이벤트 문서 DEPOSIT_CALLBACK
-- "구매자에게 다시 입금하도록 안내해야 합니다") 지금까지는 출고 보류만 걸고 해결은 운영자 몫이었다. 주문이 몰리면 사람이 하나하나 볼 수
-- 없으므로 해결을 시스템이 끝까지 한다. 결제 원장은 되돌리지 않는다(approved + 출고 보류) — 결제완료 이후 효과(확인 메일·적립·발주
-- 대기열·에스크로 작업)가 이미 퍼져 있어 원장을 입금 대기로 되돌리는 역전이 더 위험하다.
--
--   1. 되돌림 기록(private.virtual_account_deposit_reversals, 결제 시도당 한 행): 감지(웹훅이 조회로 확인) 때 열고 조회한 입금 기한을
--      남긴다. 고객에게 앱 알림을 남긴다(재입금 안내 메일은 앱이 보낸다).
--   2. 재입금: 조회가 DONE(잔액 = 총액)이면 보류를 자동으로 푼다(release_kind 'deposit_confirmed') — 주문이 그대로 진행된다.
--   3. 입금 기한까지 재입금이 없으면 앱이 계좌를 반납(입금 전 취소, 멱등키 release-va:{attemptId})하고 조회로 반납·만료를 확인한 뒤
--      service_close_deposit_reversal이 '입금 없음' 증거를 남기고 기존 취소 확정(cancel_order_with_provider_evidence)으로 주문을 닫는다 —
--      재고·쿠폰·적립금·뽑기권이 돌아간다. 돈이 들어오지 않았으므로 환불 행을 만들지 않고 결제 원장은 refunded가 아니라 canceled이며
--      가상계좌 환불 송금 감시도 열지 않는다(확정 함수와 감시 트리거가 증거를 읽는다).
--   4. 그 사이 고객·운영자 취소 요청은 같은 반납 증거를 먼저 남긴 뒤 기존 취소 경로가 '결제 없이 취소'로 닫는다(환불 계좌 불필요).
--   5. 시스템이 끝내지 못하는 건(이미 발송, 결제사 기록 불일치, 기한 + 2시간 넘게 조회 실패, 환불 흔적이 있는 결제사 취소, 운영자
--      승인을 기다리는 취소 요청, 취소 확정 실패)만 확인 필요(review)로 올린다 — 운영 알림·시스템 상태·주문 화면.
--
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환한다(앵커 개수가 다르면 실패). 운영자 계약에 등록된 재정의 함수는 끝에서
-- 지문을 다시 적는다.
-- ==========================================================================

begin;

create function private.va_reversal_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'va_reversal_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.va_reversal_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 되돌림 기록
--    state: awaiting_redeposit(시스템이 재입금을 기다리며 조회) · review(운영자 확인 필요 — 재입금은 계속 자동으로 잡는다) · closed.
--    resolution: redeposited(재입금 확인·보류 해제) · released(입금 없이 반납·주문 취소) · order_canceled(다른 경로로 주문 취소) ·
--      operator_released(운영자가 사유를 적고 보류 해제).
--    release_evidence: 결제사 조회가 확인한 '돈이 들어올 수 없는 상태'(canceled = 입금 전 취소로 반납, expired = 입금 기한 만료).
--      이 값이 있는 결제만 확정 함수가 환불 없이 닫는다.
-- ---------------------------------------------------------------------------
create table private.virtual_account_deposit_reversals (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_payment_key text not null check (
    char_length(provider_payment_key) between 1 and 200 and provider_payment_key !~ '[[:space:][:cntrl:]]'),
  state text not null default 'awaiting_redeposit' check (state in ('awaiting_redeposit', 'review', 'closed')),
  -- 같은 결제의 몇 번째 되돌림인지(재입금 뒤 다시 되돌아가면 늘어난다) — 고객 안내 메일·알림을 되돌림마다 한 번씩 보낸다.
  sequence integer not null default 1 check (sequence between 1 and 1000),
  hold_id uuid references private.order_fulfillment_holds(id) on delete set null,
  -- 결제 조회의 virtualAccount.dueDate(모르면 발급 때 기한). 되돌림 뒤 기한이 유지되는지는 문서에 없어 조회값을 매번 다시 적는다.
  due_at timestamptz not null,
  reversed_at timestamptz not null default pg_catalog.clock_timestamp(),
  next_check_at timestamptz not null,
  lease_until timestamptz,
  last_checked_at timestamptz,
  checks integer not null default 0 check (checks >= 0),
  review_code text check (review_code is null or review_code in (
    'lookup_failed', 'payment_mismatch', 'order_shipped', 'provider_refunded', 'cancellation_pending', 'close_failed')),
  reviewed_at timestamptz,
  release_evidence text check (release_evidence is null or release_evidence in ('canceled', 'expired')),
  released_at timestamptz,
  resolution text check (resolution is null or resolution in ('redeposited', 'released', 'order_canceled', 'operator_released')),
  resolved_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint virtual_account_deposit_reversals_closed check (
    (state = 'closed') = (resolution is not null)
    and (state = 'closed') = (resolved_at is not null)
    and (state <> 'review' or review_code is not null)
    and (release_evidence is null) = (released_at is null)
    and (resolution is distinct from 'released' or release_evidence is not null))
);
create index virtual_account_deposit_reversals_due on private.virtual_account_deposit_reversals(next_check_at, attempt_id)
  where state <> 'closed';
create index virtual_account_deposit_reversals_order on private.virtual_account_deposit_reversals(order_id);
create index virtual_account_deposit_reversals_payment on private.virtual_account_deposit_reversals(payment_id);
alter table private.virtual_account_deposit_reversals enable row level security;
revoke all on private.virtual_account_deposit_reversals from public, anon, authenticated, service_role;

-- 결제 조회가 '돈이 들어올 수 없다'고 확인한 되돌림 결제인지. 취소 확정·환불 감시가 환불 대신 '결제 없이 취소'로 읽는다.
create function private.payment_deposit_reversal_released(p_payment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from private.virtual_account_deposit_reversals as reversal
    where reversal.payment_id = p_payment_id and reversal.release_evidence is not null);
$function$;
revoke all on function private.payment_deposit_reversal_released(uuid) from public, anon, authenticated, service_role;

-- 다음 조회 시각: 입금 기한 + 30분(늦은 입금 통보 재전송 유예 — 입금 대기 만료와 같은 값)에 맞추되, 그 전에도 1시간마다 한 번 본다
-- (재입금 웹훅을 놓쳐도 1시간 안에 보류가 풀린다). 같은 결제를 10분 안에 다시 조회하지 않는다.
create function private.deposit_reversal_next_check(p_due_at timestamptz, p_now timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select greatest(p_now + interval '10 minutes', least(p_due_at + interval '30 minutes', p_now + interval '1 hour'));
$function$;
revoke all on function private.deposit_reversal_next_check(timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- 확인 필요로 올린다(운영 알림·감사 기록은 되돌림마다 한 번). 재입금은 계속 자동으로 잡도록 6시간마다 조회한다.
create function private.mark_deposit_reversal_review(p_attempt_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reversal private.virtual_account_deposit_reversals%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select reversal.* into v_reversal from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id for update;
  if not found or v_reversal.state = 'closed' then
    return;
  end if;
  update private.virtual_account_deposit_reversals
  set state = 'review', review_code = p_code, reviewed_at = coalesce(reviewed_at, v_now),
      next_check_at = v_now + interval '6 hours', lease_until = null, updated_at = v_now
  where attempt_id = p_attempt_id;
  if v_reversal.state = 'review' and v_reversal.review_code = p_code then
    return;
  end if;
  insert into private.admin_operation_alerts(event_key, category, title, href)
  values ('virtual_account_deposit_reversal_review:' || p_attempt_id::text || ':' || v_reversal.sequence::text || ':' || p_code,
    'orders',
    case p_code
      when 'order_shipped' then '입금이 은행에서 취소된 주문이 이미 발송됐습니다 · 주문을 확인해주세요'
      when 'lookup_failed' then '입금이 취소된 가상계좌 결제를 결제사에서 조회하지 못하고 있습니다 · 주문을 확인해주세요'
      when 'payment_mismatch' then '입금이 취소된 가상계좌 결제의 결제사 기록이 맞지 않습니다 · 주문을 확인해주세요'
      when 'provider_refunded' then '입금이 취소된 가상계좌 결제가 결제사에서 환불 처리됐습니다 · 주문을 확인해주세요'
      when 'cancellation_pending' then '입금이 취소된 주문에 처리 대기 중인 취소 요청이 있습니다 · 주문을 확인해주세요'
      else '입금이 취소된 주문을 자동으로 취소하지 못했습니다 · 주문을 확인해주세요'
    end,
    '/admin/sales/orders/' || v_reversal.order_id::text)
  on conflict (event_key) do nothing;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.deposit_reversal_review', 'order:' || v_reversal.order_id::text,
    pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'reviewCode', p_code, 'sequence', v_reversal.sequence, 'actor', 'system'));
end;
$function$;
revoke all on function private.mark_deposit_reversal_review(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 출고 보류 — 재입금 확인 해제(deposit_confirmed), 보류가 풀리면(운영자 해제·주문 취소) 되돌림을 닫는다.
-- ---------------------------------------------------------------------------
alter table private.order_fulfillment_holds drop constraint order_fulfillment_holds_release_kind_check;
alter table private.order_fulfillment_holds add constraint order_fulfillment_holds_release_kind_check
  check (release_kind = any (array['operator', 'order_canceled', 'deposit_confirmed']));
alter table private.order_fulfillment_holds drop constraint order_fulfillment_holds_release;
alter table private.order_fulfillment_holds add constraint order_fulfillment_holds_release check (
  (released_at is null) = (release_kind is null)
  and (release_kind is distinct from 'operator' or release_note is not null)
  and (release_kind is distinct from 'order_canceled' or release_note is null)
  and (release_kind is distinct from 'deposit_confirmed' or (release_note is null and reason = 'deposit_reversed')));

create function private.close_deposit_reversal_on_hold_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resolution text;
begin
  -- 재입금 확인(deposit_confirmed)은 되돌림을 먼저 닫고 보류를 푼다 — 여기서는 운영자 해제와 주문 취소만 닫는다. 운영자 해제는 지금
  -- 되돌림의 보류일 때만 닫는다(앞선 되돌림의 보류 해제가 지금 되돌림을 닫지 않게).
  update private.virtual_account_deposit_reversals as reversal
  set state = 'closed',
      resolution = case
        when new.release_kind = 'operator' then 'operator_released'
        when reversal.release_evidence is not null then 'released'
        else 'order_canceled'
      end,
      resolved_at = pg_catalog.clock_timestamp(), lease_until = null, updated_at = pg_catalog.clock_timestamp()
  where reversal.attempt_id = new.payment_attempt_id and reversal.state <> 'closed'
    and (new.release_kind = 'order_canceled' or reversal.hold_id is null or reversal.hold_id = new.id)
  returning reversal.resolution into v_resolution;
  -- 반납이 확인된 결제의 주문이 (취소 요청 경로로) 취소됐다 — 등록할 에스크로 거래가 없으니 등록한 적 없는 배송 등록 작업을 지운다
  -- (남기면 결제 원장이 닫혀 작업자가 '직접 등록 필요'로 운영자에게 올린다). 시스템 자동 취소는 service_close_deposit_reversal이 지운다.
  if v_resolution = 'released' then
    delete from private.toss_escrow_deliveries as job
    where job.order_id = new.order_id and job.state in ('waiting', 'ready') and job.toss_delivery_id is null;
  end if;
  return null;
end;
$function$;
revoke all on function private.close_deposit_reversal_on_hold_release() from public, anon, authenticated, service_role;
create trigger order_fulfillment_holds_close_deposit_reversal after update of released_at on private.order_fulfillment_holds
  for each row when (new.reason = 'deposit_reversed' and old.released_at is null and new.released_at is not null
    and new.release_kind in ('operator', 'order_canceled'))
  execute function private.close_deposit_reversal_on_hold_release();

-- ---------------------------------------------------------------------------
-- 3. 고객 알림 종류 · 안내 메일 템플릿
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'announcement', 'claim_updated', 'draw_ticket_issued', 'drop_published', 'event_published',
  'inquiry_answered', 'loyalty_grade_upgraded', 'marketing_message', 'order_bank_transfer_pending',
  'order_delivered', 'order_paid', 'order_shipping', 'product_question_answered',
  'purchase_confirmation', 'restock_available', 'review_replied', 'loyalty_monthly_coupons_issued',
  'order_virtual_account_issued', 'order_deposit_reversed'
]));

-- 재입금 안내(dedupe 'order_deposit_reversal:<주문 uuid>:<되돌림 번호>')와 자동 취소 안내(':canceled'). 운영자 재발송 대상은 아니다.
alter table public.email_deliveries drop constraint email_deliveries_template_check;
alter table public.email_deliveries add constraint email_deliveries_template_check check (template = any (array[
  'order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account', 'order_deposit_reversal'
]));
select private.va_reversal_patch(
  'public.claim_email_delivery(text,text,text,text,interval)'::regprocedure,
  $patch$[["target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account')", "target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert', 'order_virtual_account', 'order_deposit_reversal')"]]$patch$::jsonb
);

-- ---------------------------------------------------------------------------
-- 4. 감지 — 웹훅이 원장 결제 키로 조회해 WAITING_FOR_DEPOSIT(가상계좌)을 확인하면 부른다(서비스 전용).
--    보류(사유 deposit_reversed)를 걸고 되돌림 기록을 연다. 조회한 입금 기한(p_due_at)을 남긴다(없으면 발급 때 기한).
--    재입금 뒤 다시 되돌아가면(새 거래 키 → 새 보류) 기록을 다시 열고 번호를 올린다. 새로 열 때만 고객 앱 알림을 남긴다.
-- ---------------------------------------------------------------------------
drop function public.service_flag_goods_deposit_reversal(uuid, text, text, text);
create function public.service_flag_goods_deposit_reversal(
  p_attempt_id uuid,
  p_payment_key text,
  p_transaction_ref text,
  p_case_ref text,
  p_due_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_va private.payment_attempt_virtual_accounts%rowtype;
  v_reversal private.virtual_account_deposit_reversals%rowtype;
  v_hold uuid;
  v_current_hold uuid;
  v_due timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_sequence integer;
begin
  if p_attempt_id is null or p_payment_key is null or p_transaction_ref is null
    or char_length(p_transaction_ref) not between 1 and 200
    or (p_case_ref is not null and p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$')
    or (p_due_at is not null and p_due_at not between v_now - interval '90 days' and v_now + interval '90 days') then
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
  select va.* into v_va from private.payment_attempt_virtual_accounts as va
  where va.attempt_id = v_attempt.id and va.provider_payment_key = p_payment_key;

  if v_attempt.state <> 'approved' or v_order.status = 'canceled' or v_va.attempt_id is null
    or not exists (
      select 1 from public.payments as payment
      where payment.id = v_attempt.payment_id and payment.payment_key = p_payment_key and payment.status = 'paid')
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

  select hold.id into v_current_hold from private.order_fulfillment_holds as hold
  where hold.order_id = v_order.id and hold.reason = 'deposit_reversed' and hold.payment_attempt_id = v_attempt.id
    and hold.released_at is null
  order by hold.created_at desc, hold.id desc
  limit 1;

  v_due := coalesce(p_due_at, v_va.due_at);
  select reversal.* into v_reversal from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = v_attempt.id for update;
  -- 재입금으로 닫힌 뒤 결제사 조회가 다시 입금 전을 보였다 — 새 되돌림이다. 결제사가 같은 거래 키를 주거나 거래 키가 없어(상태·잔액으로
  -- 대신한 근거) 위 보류가 근거 충돌로 들어가지 않았어도, 되돌림 번호를 섞은 근거로 새 보류를 건다(놓치면 결제 없이 출고된다).
  if v_hold is null and found and v_reversal.state = 'closed' and v_reversal.resolution = 'redeposited' then
    insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
    values (
      v_order.id, 'deposit_reversed',
      'deposit_reversed:' || v_attempt.id::text || ':'
        || pg_catalog.md5(p_transaction_ref || ':' || (v_reversal.sequence + 1)::text),
      v_attempt.id,
      pg_catalog.jsonb_build_object('providerStatus', 'WAITING_FOR_DEPOSIT', 'caseRef', p_case_ref))
    on conflict (order_id, reason, evidence_key) do nothing
    returning id into v_hold;
  end if;
  if not found then
    -- 같은 근거의 보류가 이미 해제됐으면(운영자가 확인하고 풀었다) 다시 열지 않는다.
    if v_current_hold is not null then
      insert into private.virtual_account_deposit_reversals(
        attempt_id, order_id, payment_id, provider_payment_key, hold_id, due_at, next_check_at)
      values (v_attempt.id, v_order.id, v_attempt.payment_id, p_payment_key, v_current_hold, v_due,
        private.deposit_reversal_next_check(v_due, v_now));
      v_sequence := 1;
    end if;
  elsif v_reversal.state = 'closed' then
    -- 재입금(또는 운영자 해제) 뒤 다시 되돌아갔다 — 새 근거의 보류가 걸렸을 때만 다시 연다.
    if v_hold is not null and v_reversal.resolution in ('redeposited', 'operator_released') then
      update private.virtual_account_deposit_reversals
      set state = 'awaiting_redeposit', sequence = v_reversal.sequence + 1, hold_id = v_hold, due_at = v_due,
          reversed_at = v_now, next_check_at = private.deposit_reversal_next_check(v_due, v_now), lease_until = null,
          last_checked_at = null, checks = 0, review_code = null, reviewed_at = null, resolution = null, resolved_at = null,
          updated_at = v_now
      where attempt_id = v_attempt.id;
      v_sequence := v_reversal.sequence + 1;
    end if;
  else
    update private.virtual_account_deposit_reversals
    set due_at = case when p_due_at is not null then p_due_at else due_at end,
        hold_id = coalesce(v_current_hold, hold_id), updated_at = v_now
    where attempt_id = v_attempt.id;
  end if;

  if v_sequence is not null then
    insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
    values (v_order.user_id, 'order_deposit_reversed', '입금이 확인되지 않았어요',
      case
        -- 입금 기한이 이미 지났으면 다시 입금할 수 없다(기한이 지난 입금은 실패한다 — 코어 API dueDate).
        when v_due <= v_now and private.order_fulfillment_blocking(v_order.id)
          then '은행에서 입금이 취소됐는데 입금 기한이 지나 다시 입금할 수 없어요. 주문은 자동으로 취소되고, 입금된 돈이 없어 따로 환불할 금액은 없어요.'
        when v_due <= v_now
          then '은행에서 입금이 취소됐는데 입금 기한이 지나 다시 입금할 수 없어요. 확인 뒤 따로 안내해 드릴게요.'
        when private.order_fulfillment_blocking(v_order.id)
          then '은행에서 입금이 취소됐어요. 입금 기한까지 같은 계좌로 다시 입금해 주세요. 기한이 지나면 주문이 자동으로 취소돼요.'
        else '은행에서 입금이 취소됐어요. 입금 기한까지 같은 계좌로 다시 입금해 주세요.' end,
      '/orders/' || v_order.id::text, 'order', v_order.id::text,
      'order:deposit_reversed:' || v_order.id::text || ':' || v_sequence::text)
    on conflict (user_id, dedupe_key) do nothing;
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.deposit_reversal_opened', 'order:' || v_order.id::text,
      pg_catalog.jsonb_build_object('attemptId', v_attempt.id, 'sequence', v_sequence, 'dueAt', v_due, 'caseRef', p_case_ref));
  end if;

  if v_hold is null then
    return 'already_recorded';
  end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.fulfillment_hold_placed', 'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object('reason', 'deposit_reversed', 'attemptId', v_attempt.id, 'holdId', v_hold, 'caseRef', p_case_ref));
  return 'held';
end;
$function$;
revoke all on function public.service_flag_goods_deposit_reversal(uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.service_flag_goods_deposit_reversal(uuid, text, text, text, timestamptz) to service_role;

-- 열린(닫히지 않은) 되돌림 — 웹훅이 재입금·반납 웹훅을 되돌림 처리로 보낼지, 취소 경로가 환불 전에 반납할지 정한다(서비스 전용).
create function public.service_goods_deposit_reversal(p_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'attemptId', reversal.attempt_id,
    'orderId', reversal.order_id,
    'paymentKey', reversal.provider_payment_key,
    'state', reversal.state,
    'sequence', reversal.sequence,
    'dueAt', reversal.due_at,
    'reviewCode', reversal.review_code,
    'released', reversal.release_evidence is not null)
  from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id and reversal.state <> 'closed';
$function$;
revoke all on function public.service_goods_deposit_reversal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_deposit_reversal(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. 자동 재확인(결제 재확인 cron 셋째 단계) — 조회할 차례인 열린 되돌림을 골라 10분 리스를 건다(서비스 전용).
-- ---------------------------------------------------------------------------
create function public.service_claim_deposit_reversal_checks(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5 then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal_check_limit';
  end if;
  with picked as (
    select reversal.attempt_id
    from private.virtual_account_deposit_reversals as reversal
    where reversal.state <> 'closed' and reversal.next_check_at <= v_now
      and (reversal.lease_until is null or reversal.lease_until <= v_now)
    order by reversal.next_check_at, reversal.attempt_id
    limit p_limit
    for update skip locked
  ), leased as (
    update private.virtual_account_deposit_reversals as reversal
    set lease_until = v_now + interval '10 minutes', checks = reversal.checks + 1, updated_at = v_now
    from picked
    where reversal.attempt_id = picked.attempt_id
    returning reversal.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'attemptId', leased.attempt_id,
      'orderId', leased.order_id,
      'paymentKey', leased.provider_payment_key,
      'state', leased.state,
      'reviewCode', leased.review_code,
      'dueAt', leased.due_at,
      'released', leased.release_evidence is not null,
      'attempt', pg_catalog.jsonb_build_object('id', attempt.id, 'provider', attempt.provider, 'purpose', attempt.purpose,
        'ref_id', attempt.ref_id, 'amount', attempt.amount, 'currency', attempt.currency, 'idempotency_key', attempt.idempotency_key,
        'provider_order_id', attempt.provider_order_id, 'provider_product_code', attempt.provider_product_code,
        'expires_at', attempt.expires_at)) order by leased.next_check_at, leased.attempt_id), '[]'::jsonb)
  into v_result
  from leased join public.payment_attempts as attempt on attempt.id = leased.attempt_id;
  return v_result;
end;
$function$;
revoke all on function public.service_claim_deposit_reversal_checks(integer) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_deposit_reversal_checks(integer) to service_role;

-- 조회 결과(아직 입금 전·조회 불가·불일치·환불 흔적)를 남긴다. 재입금·반납은 아래 전용 함수가 닫는다(서비스 전용).
--  waiting: 입금 기한 전 입금 대기 — 다음 조회를 잡는다. 조회 불가로 확인 필요였으면 자동 처리로 되돌린다.
--  unavailable: 10분 뒤 다시 본다. 입금 기한 + 2시간이 지나도 조회하지 못하면 확인 필요(lookup_failed).
--  mismatch·provider_refunded: 확인 필요.
create function public.service_record_deposit_reversal_check(p_attempt_id uuid, p_outcome text, p_due_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reversal private.virtual_account_deposit_reversals%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_due timestamptz;
begin
  if p_attempt_id is null or p_outcome is null
    or p_outcome not in ('waiting', 'unavailable', 'mismatch', 'provider_refunded')
    or (p_due_at is not null and p_due_at not between v_now - interval '90 days' and v_now + interval '90 days') then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal_check';
  end if;
  select reversal.* into v_reversal from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_reversal.state = 'closed' then
    return 'closed';
  end if;
  v_due := coalesce(p_due_at, v_reversal.due_at);

  if p_outcome = 'waiting' then
    update private.virtual_account_deposit_reversals
    set due_at = v_due, last_checked_at = v_now, lease_until = null, updated_at = v_now,
        state = case when state = 'review' and review_code = 'lookup_failed' then 'awaiting_redeposit' else state end,
        review_code = case when state = 'review' and review_code = 'lookup_failed' then null else review_code end,
        next_check_at = case when state = 'review' and review_code <> 'lookup_failed' then v_now + interval '6 hours'
          else private.deposit_reversal_next_check(v_due, v_now) end
    where attempt_id = p_attempt_id;
  elsif p_outcome = 'unavailable' then
    update private.virtual_account_deposit_reversals
    set last_checked_at = v_now, lease_until = null, updated_at = v_now,
        next_check_at = case when state = 'review' then v_now + interval '30 minutes' else v_now + interval '10 minutes' end
    where attempt_id = p_attempt_id;
    if v_reversal.state = 'awaiting_redeposit' and v_reversal.due_at + interval '2 hours' <= v_now then
      perform private.mark_deposit_reversal_review(p_attempt_id, 'lookup_failed');
    end if;
  else
    update private.virtual_account_deposit_reversals
    set last_checked_at = v_now, updated_at = v_now
    where attempt_id = p_attempt_id;
    perform private.mark_deposit_reversal_review(p_attempt_id,
      case p_outcome when 'mismatch' then 'payment_mismatch' else 'provider_refunded' end);
  end if;

  select reversal.state into v_reversal.state from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id;
  return v_reversal.state;
end;
$function$;
revoke all on function public.service_record_deposit_reversal_check(uuid, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.service_record_deposit_reversal_check(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. 재입금 — 앱이 원장 결제 키로 조회해 DONE(가상계좌, 잔액 = 총액)을 확인하면 부른다(서비스 전용). 보류를 풀고 기록을 닫는다.
-- ---------------------------------------------------------------------------
create function public.service_resolve_deposit_reversal_redeposited(p_attempt_id uuid, p_payment_key text, p_case_ref text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_reversal private.virtual_account_deposit_reversals%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_released integer;
begin
  if p_attempt_id is null or p_payment_key is null
    or (p_case_ref is not null and p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$') then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal';
  end if;
  select attempt.* into v_attempt from public.payment_attempts as attempt
  where attempt.id = p_attempt_id and attempt.purpose = 'order' and attempt.provider = 'toss';
  if not found then
    return 'not_applicable';
  end if;
  -- 주문 → 시도 → 기록 순서로 잠근다(감지·반납과 같은 순서).
  select order_record.* into v_order from public.orders as order_record where order_record.id = v_attempt.ref_id for update;
  select attempt.* into v_attempt from public.payment_attempts as attempt where attempt.id = p_attempt_id for update;
  select reversal.* into v_reversal from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id for update;
  if not found then
    return 'not_applicable';
  end if;
  if v_reversal.state = 'closed' then
    return case when v_reversal.resolution = 'redeposited' then 'already_resolved' else 'not_applicable' end;
  end if;
  if v_attempt.state <> 'approved' or v_order.status = 'canceled' or v_reversal.provider_payment_key <> p_payment_key
    or not exists (
      select 1 from public.payments as payment
      where payment.id = v_attempt.payment_id and payment.payment_key = p_payment_key and payment.status = 'paid') then
    return 'not_applicable';
  end if;
  if v_reversal.release_evidence is not null then
    -- 반납·만료를 확인한 결제에 입금이 확인됐다 — 증거가 서로 맞지 않는다. 사람이 본다.
    perform private.mark_deposit_reversal_review(p_attempt_id, 'payment_mismatch');
    return 'conflict';
  end if;

  update private.virtual_account_deposit_reversals
  set state = 'closed', resolution = 'redeposited', resolved_at = v_now, lease_until = null, last_checked_at = v_now,
      updated_at = v_now
  where attempt_id = p_attempt_id;
  update private.order_fulfillment_holds
  set released_at = v_now, release_kind = 'deposit_confirmed'
  where order_id = v_order.id and reason = 'deposit_reversed' and payment_attempt_id = p_attempt_id and released_at is null;
  get diagnostics v_released = row_count;

  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.fulfillment_hold_released', 'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object('trigger', 'deposit_confirmed', 'reason', 'deposit_reversed', 'released', v_released,
      'attemptId', p_attempt_id, 'sequence', v_reversal.sequence, 'caseRef', p_case_ref));
  insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
  values (v_order.user_id, 'order_paid', '입금이 다시 확인됐어요', '입금이 다시 확인돼 주문이 그대로 진행돼요.',
    '/orders/' || v_order.id::text, 'order', v_order.id::text,
    'order:deposit_redeposited:' || v_order.id::text || ':' || v_reversal.sequence::text)
  on conflict (user_id, dedupe_key) do nothing;
  return 'redeposited';
end;
$function$;
revoke all on function public.service_resolve_deposit_reversal_redeposited(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.service_resolve_deposit_reversal_redeposited(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. 반납 — 앱이 계좌를 반납(입금 전 취소)하고 조회로 반납(canceled)·만료(expired)를 확인하면 부른다(서비스 전용).
--    '돈이 들어올 수 없다'는 증거를 남기고, 취소 요청이 없으면 기존 취소 확정으로 주문을 닫는다(재고·쿠폰·적립금·뽑기권 복원,
--    환불 없음). 돌려주는 status:
--      closed: 주문을 닫았다 · cancellation_pending: 활성 취소·반품 요청이 처리 중·결제확인필요다(취소는 앱이 시스템 actor로 그 요청을 결제
--      없이 마저 닫고, 반품은 운영자의 환불 단계가 같은 길로 닫는다) · review: 확인 필요로 올렸다(이미 발송·접수 단계 요청·교환·2시간 넘게
--      닫히지 않은 요청·취소 확정 실패) · not_applicable: 대상 아님.
-- ---------------------------------------------------------------------------
create function public.service_close_deposit_reversal(p_attempt_id uuid, p_payment_key text, p_evidence text, p_case_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_reversal private.virtual_account_deposit_reversals%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_error text;
begin
  if p_attempt_id is null or p_payment_key is null or p_evidence is null or p_evidence not in ('canceled', 'expired')
    or (p_case_ref is not null and p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$') then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal_close';
  end if;
  select attempt.* into v_attempt from public.payment_attempts as attempt
  where attempt.id = p_attempt_id and attempt.purpose = 'order' and attempt.provider = 'toss';
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_applicable');
  end if;
  -- 공통 잠금 순서: 주문 → 배송 건 → 시도 → 기록(취소 확정·재시작과 같다).
  select order_record.* into v_order from public.orders as order_record where order_record.id = v_attempt.ref_id for update;
  perform shipment.id from public.order_shipments as shipment where shipment.order_id = v_order.id order by shipment.id for update;
  select attempt.* into v_attempt from public.payment_attempts as attempt where attempt.id = p_attempt_id for update;
  select reversal.* into v_reversal from private.virtual_account_deposit_reversals as reversal
  where reversal.attempt_id = p_attempt_id for update;
  if not found or v_reversal.state = 'closed' or v_reversal.provider_payment_key <> p_payment_key
    or v_attempt.state <> 'approved' or v_order.status = 'canceled'
    or not exists (
      select 1 from public.payments as payment
      where payment.id = v_attempt.payment_id and payment.payment_key = p_payment_key and payment.status = 'paid') then
    return pg_catalog.jsonb_build_object('status', 'not_applicable');
  end if;

  if v_reversal.release_evidence is null then
    update private.virtual_account_deposit_reversals
    set release_evidence = p_evidence, released_at = v_now, last_checked_at = v_now, updated_at = v_now
    where attempt_id = p_attempt_id;
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.deposit_reversal_released', 'order:' || v_order.id::text,
      pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'evidence', p_evidence, 'sequence', v_reversal.sequence,
        'caseRef', p_case_ref));
  end if;

  -- 활성 취소·반품 요청이 있으면 그 요청의 경로로 닫는다(오케스트레이터가 반납 증거를 보고 결제사 환불 없이 완료 → 취소 확정이 증거를 읽어
  -- 환불 행 없이 주문을 닫는다). 발송된 주문의 반품도 이 길이다. 운영자 결정을 기다리는 접수 단계 요청·교환은 사람이 본다.
  select request.* into v_request from public.order_cancellation_requests as request
  where request.order_id = v_order.id and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id desc
  limit 1;
  if found then
    if v_request.claim_type not in ('cancel', 'return') or v_request.status = 'requested'
      -- 반납을 확인한 지 2시간이 지나도 요청이 닫히지 않았다 — 같은 요청을 계속 다시 돌리지 않고 사람에게 넘긴다.
      or coalesce(v_reversal.released_at, v_now) <= v_now - interval '2 hours' then
      perform private.mark_deposit_reversal_review(p_attempt_id, 'cancellation_pending');
      return pg_catalog.jsonb_build_object('status', 'review', 'code', 'cancellation_pending');
    end if;
    -- 그 요청이 닫히면 기록도 닫힌다(주문 취소 → 보류 해제 트리거). 그 사이 자동 재확인이 같은 요청을 10분마다 다시 시작하지 않게
    -- 다음 조회를 30분 뒤로 미룬다.
    update private.virtual_account_deposit_reversals
    set next_check_at = v_now + interval '30 minutes', lease_until = null, updated_at = v_now
    where attempt_id = p_attempt_id;
    return pg_catalog.jsonb_build_object('status', 'cancellation_pending', 'requestId', v_request.id,
      'requestStatus', v_request.status, 'claimType', v_request.claim_type);
  end if;

  -- 이미 나간 물건은 시스템이 주문을 취소하지 않는다(반품 접수 또는 고객 연락은 운영자 몫).
  if not private.order_fulfillment_blocking(v_order.id) then
    perform private.mark_deposit_reversal_review(p_attempt_id, 'order_shipped');
    return pg_catalog.jsonb_build_object('status', 'review', 'code', 'order_shipped');
  end if;

  begin
    update private.virtual_account_deposit_reversals
    set state = 'closed', resolution = 'released', resolved_at = v_now, lease_until = null, updated_at = v_now
    where attempt_id = p_attempt_id;
    perform public.cancel_order_with_provider_evidence(v_order.id,
      '은행이 입금을 취소한 뒤 입금 기한까지 다시 입금되지 않아 자동 취소', array[p_payment_key]);
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform private.mark_deposit_reversal_review(p_attempt_id, 'close_failed');
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.deposit_reversal_close_failed', 'order:' || v_order.id::text,
      pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'error', pg_catalog.left(v_error, 200), 'caseRef', p_case_ref));
    return pg_catalog.jsonb_build_object('status', 'review', 'code', 'close_failed');
  end;

  -- 에스크로를 고른 결제면 배송 등록 작업이 남아 있다. 주문 취소가 배송 건을 닫으면 작업이 '실물 없음 → 직접 전달 등록 대기'로 바뀌는데,
  -- 돈이 들어오지 않아 등록할 거래가 없고 결제 원장도 닫혀(결제 키 없음) 작업자가 '직접 등록 필요'로 운영자에게 올린다. 등록한 적 없는
  -- 작업은 지운다(사람이 할 일이 없다).
  delete from private.toss_escrow_deliveries as job
  where job.order_id = v_order.id and job.state in ('waiting', 'ready') and job.toss_delivery_id is null;

  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.deposit_reversal_closed', 'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'evidence', coalesce(v_reversal.release_evidence, p_evidence),
      'sequence', v_reversal.sequence, 'caseRef', p_case_ref, 'actor', 'system'));
  insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
  values (v_order.user_id, 'order_deposit_reversed', '입금이 확인되지 않아 주문이 취소됐어요',
    '입금 기한까지 입금이 확인되지 않아 주문을 취소했어요. 입금된 돈이 없어 따로 환불할 금액은 없어요.',
    '/orders/' || v_order.id::text, 'order', v_order.id::text,
    'order:deposit_reversal_canceled:' || v_order.id::text)
  on conflict (user_id, dedupe_key) do nothing;
  return pg_catalog.jsonb_build_object('status', 'closed');
end;
$function$;
revoke all on function public.service_close_deposit_reversal(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.service_close_deposit_reversal(uuid, text, text, text) to service_role;

-- 결제확인필요로 멈춘 취소 요청을 처리 중으로 되돌린다 — 반납이 확인된 되돌림 결제일 때만(서비스 전용). 앱이 같은 요청에서 시스템 actor로
-- 오케스트레이터를 다시 부르면 결제사 조회가 반납(CANCELED)을 확인하고 취소 확정이 증거를 읽어 환불 없이 주문을 닫는다.
create function public.service_begin_deposit_reversal_cancellation(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_claim public.order_cancellation_requests%rowtype;
begin
  if p_request_id is null then
    raise invalid_parameter_value using message = 'invalid_deposit_reversal_cancellation';
  end if;
  select request.order_id into v_order_id from public.order_cancellation_requests as request where request.id = p_request_id;
  if not found then
    return 'not_applicable';
  end if;
  perform order_record.id from public.orders as order_record where order_record.id = v_order_id for update;
  perform shipment.id from public.order_shipments as shipment where shipment.order_id = v_order_id order by shipment.id for update;
  select request.* into v_claim from public.order_cancellation_requests as request where request.id = p_request_id for update;
  if v_claim.status = 'processing' and v_claim.claim_type = 'cancel' then
    return 'started';
  end if;
  if v_claim.status is distinct from 'needs_review' or v_claim.claim_type <> 'cancel'
    or not exists (select 1 from public.order_cancellation_claims as cancel_claim where cancel_claim.order_id = v_order_id)
    or not exists (
      select 1 from private.virtual_account_deposit_reversals as reversal
      join public.payments as payment on payment.id = reversal.payment_id
      where reversal.order_id = v_order_id and reversal.release_evidence is not null and reversal.state <> 'closed'
        and payment.status = 'paid' and payment.payment_key = reversal.provider_payment_key) then
    return 'not_applicable';
  end if;
  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id, null);
  update public.refunds set status = 'requested' where cancellation_request_id = p_request_id and status = 'failed';
  update public.order_cancellation_requests
  set status = 'processing', provider_started_at = coalesce(provider_started_at, pg_catalog.now()), updated_at = pg_catalog.now()
  where id = p_request_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order.cancellation_reconcile_started', 'order:' || v_order_id::text,
    pg_catalog.jsonb_build_object('requestId', p_request_id, 'from', 'needs_review', 'to', 'processing',
      'actor', 'system', 'reason', 'deposit_reversal_released'));
  return 'started';
end;
$function$;
revoke all on function public.service_begin_deposit_reversal_cancellation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_begin_deposit_reversal_cancellation(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. 취소 확정·환불 감시·결제사 직접 취소 감지가 반납 증거를 읽는다.
-- ---------------------------------------------------------------------------
-- 반납이 확인된 되돌림 결제는 환불 행을 만들지 않고 결제 원장을 canceled로 닫는다(돈이 들어오지 않았다). 그 밖은 지금 그대로다.
select private.va_reversal_patch(
  'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure,
  pg_catalog.jsonb_build_array(
    -- 취소·반품 승인 경로(운영자 전액 취소·결정·고객 자동 승인)가 먼저 남긴 환불 의도 행(requested·failed)을 반납 증거가 있는 결제에서
    -- 지운다 — 남기면 완료 함수가 '결제사 취소 필요'로 거부하고, 돈이 오가지 않은 결제에 환불 기록이 생길 자리도 남는다.
    pg_catalog.jsonb_build_array(
      E'  insert into public.refunds (payment_id, amount, reason, status)\n',
      E'  delete from public.refunds as refund\n  using public.payments as payment\n  where refund.payment_id = payment.id\n    and payment.purpose = ''order''\n    and payment.ref_id = p_order_id\n    and refund.status in (''requested'', ''failed'')\n    and private.payment_deposit_reversal_released(payment.id);\n\n  insert into public.refunds (payment_id, amount, reason, status)\n'),
    pg_catalog.jsonb_build_array(
      E'  where payment.purpose = ''order''\n    and payment.ref_id = p_order_id\n    and (\n      payment.status in (''canceled'', ''refunded'')\n      or payment.payment_key = any(v_provider_payment_keys)\n    )\n  on conflict (payment_id) do update',
      E'  where payment.purpose = ''order''\n    and payment.ref_id = p_order_id\n    and (\n      payment.status in (''canceled'', ''refunded'')\n      or payment.payment_key = any(v_provider_payment_keys)\n    )\n    -- 은행이 입금을 취소한 뒤 반납·만료가 확인된 가상계좌 결제는 돈이 들어오지 않았다 — 환불 행을 만들지 않는다.\n    and not private.payment_deposit_reversal_released(payment.id)\n  on conflict (payment_id) do update'),
    pg_catalog.jsonb_build_array(
      E'  update public.payments as payment\n  set status = ''refunded''\n',
      E'  update public.payments as payment\n  set status = case when private.payment_deposit_reversal_released(payment.id)\n    then ''canceled''::public.payment_status else ''refunded''::public.payment_status end\n')));

-- 환불 송금 감시는 돈이 나간 환불만 본다.
select private.va_reversal_patch('private.virtual_account_refund_watch_opened()'::regprocedure,
  $p$[["where attempt.payment_id = new.id and attempt.purpose = 'order' and attempt.provider = 'toss'", "where attempt.payment_id = new.id and attempt.purpose = 'order' and attempt.provider = 'toss'\n      and not private.payment_deposit_reversal_released(new.id)"]]$p$::jsonb);

-- 열린 되돌림 결제의 상태 변경(반납 CANCELED 등)을 결제사 직접 취소로 오탐하지 않는다 — 되돌림 처리가 닫힐 때까지 판정을 미룬다
-- (대기 기록은 5분 sweep이 다시 보고, 주문이 취소되면 대상이 아니게 된다).
select private.va_reversal_patch('private.apply_goods_provider_cancellation(uuid,text,bigint,text)'::regprocedure,
  $p$[["or exists(select 1 from public.refunds rf where rf.payment_id = payment.id and rf.status in ('requested', 'awaiting_transfer')) then", "or exists(select 1 from public.refunds rf where rf.payment_id = payment.id and rf.status in ('requested', 'awaiting_transfer'))\n        or exists(select 1 from private.virtual_account_deposit_reversals vr where vr.attempt_id = attempt.id and vr.state <> 'closed') then"]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 9. 가상계좌 조회 — 되돌림이 열려 있으면 'reversed'(재입금 안내, 기한은 조회한 기한), 반납으로 닫혔으면 'closed'.
--    구매자 조회에서는 운영용 값(escrow·refund·reversal)을 뺀다. 나머지는 20261125130000(환불 감시 완료 근거 completedVia) 그대로다.
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
    'dueAt', case when reversal.state in ('awaiting_redeposit', 'review') then reversal.due_at else va.due_at end,
    'amount', attempt.amount,
    'useEscrow', va.use_escrow,
    'state', case
      when attempt.state = 'approved' and reversal.release_evidence is not null then 'closed'
      -- 재입금을 기다리는 동안만 재입금을 안내한다. 결제사 기록 불일치·환불 흔적으로 확인 필요가 된 건은 계좌를 다시 약속하지 않는다.
      when attempt.state = 'approved' and (reversal.state = 'awaiting_redeposit'
          or (reversal.state = 'review' and reversal.review_code = 'lookup_failed'))
        then 'reversed'
      when attempt.state = 'approved' and reversal.state = 'review' then 'checking'
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
      -- 조회가 멈춰 송금 확인 전으로 7일이 지난 감시는 확인 필요(지연)로 보인다 — 시스템 상태·확인 목록·처리 완료와 같은 규칙이다.
      select pg_catalog.jsonb_build_object(
        'state', case when watch.state = 'pending' and watch.refunded_at <= pg_catalog.clock_timestamp() - interval '7 days'
          then 'failed' else watch.state end,
        'refundStatus', watch.refund_status,
        'failureCode', case when watch.state = 'pending' and watch.refunded_at <= pg_catalog.clock_timestamp() - interval '7 days'
          then coalesce(watch.failure_code, 'refund_overdue') else watch.failure_code end,
        'refundedAt', watch.refunded_at,
        'checkedAt', watch.last_checked_at,
        'failedAt', watch.failed_at,
        'resolvedAt', watch.resolved_at,
        'resolutionNote', watch.resolution_note,
        'completedVia', watch.completed_via)
      from private.virtual_account_refund_watches as watch where watch.attempt_id = va.attempt_id),
    'reversal', case when reversal.attempt_id is not null then pg_catalog.jsonb_build_object(
        'state', reversal.state,
        'sequence', reversal.sequence,
        'dueAt', reversal.due_at,
        'reviewCode', reversal.review_code,
        'released', reversal.release_evidence is not null,
        'resolution', reversal.resolution,
        'reversedAt', reversal.reversed_at,
        'resolvedAt', reversal.resolved_at) end
  )
  from private.payment_attempt_virtual_accounts as va
  join public.payment_attempts as attempt on attempt.id = va.attempt_id
  left join private.virtual_account_deposit_reversals as reversal on reversal.attempt_id = va.attempt_id
  where va.order_id = p_order_id
  order by va.issued_at desc
  limit 1;
$function$;
revoke all on function private.order_virtual_account_json(uuid) from public, anon, authenticated, service_role;

select private.va_reversal_patch('public.get_my_order_virtual_account(uuid)'::regprocedure,
  $p$[["return private.order_virtual_account_json(p_order_id) - 'escrow' - 'refund';", "return private.order_virtual_account_json(p_order_id) - 'escrow' - 'refund' - 'reversal';"]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 10. 운영 화면 — 출고 보류 안내에 되돌림 처리 상태(자동 처리 중·확인 필요·입금 기한)를 싣는다.
-- ---------------------------------------------------------------------------
create or replace function private.order_fulfillment_hold_document(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reason', r.reason,
      'placedAt', coalesce(h.created_at, (select max(a.updated_at) from public.payment_attempts a
        where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved')),
      'providerStatus', h.detail->>'providerStatus',
      'providerCanceledAmount', (h.detail->>'providerCanceledAmount')::bigint,
      'unexplainedAmount', (h.detail->>'unexplainedAmount')::bigint,
      'paymentAmount', (h.detail->>'paymentAmount')::bigint,
      'outboundBlocked', private.order_fulfillment_blocking(p_order_id))
      || case when r.reason = 'deposit_reversed' then coalesce((
        select jsonb_build_object('depositReversal', jsonb_build_object(
          'state', v.state, 'dueAt', v.due_at, 'reviewCode', v.review_code, 'released', v.release_evidence is not null))
        from private.virtual_account_deposit_reversals v
        where v.order_id = p_order_id and v.state <> 'closed'
        order by v.reversed_at desc, v.attempt_id limit 1), '{}'::jsonb) else '{}'::jsonb end
      order by r.reason), '[]'::jsonb)
  from unnest(private.order_fulfillment_hold_reasons(p_order_id)) r(reason)
  left join lateral (select x.created_at, x.detail from private.order_fulfillment_holds x
    where x.order_id = p_order_id and x.reason = r.reason and x.released_at is null order by x.created_at desc, x.id desc limit 1) h on true;
$function$;
revoke all on function private.order_fulfillment_hold_document(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. 시스템 상태·운영 알림 요약 메일 — 확인 필요 되돌림과 처리가 멈춘 되돌림(입금 기한 + 2시간이 지나도 열린 채)을 할 일로 센다.
-- ---------------------------------------------------------------------------
select private.va_reversal_patch('private.system_health_report()'::regprocedure, pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_array(
    'refund_failed integer; refund_oldest timestamptz;',
    'refund_failed integer; refund_oldest timestamptz; reversal_review integer; reversal_oldest timestamptz;'),
  pg_catalog.jsonb_build_array(
    $a$  where w.state = 'failed' or (w.state = 'pending' and w.refunded_at <= at - interval '7 days');$a$,
    $a$  where w.state = 'failed' or (w.state = 'pending' and w.refunded_at <= at - interval '7 days');

  -- 가상계좌 입금 오류 되돌림 중 시스템이 끝내지 못한 것: 확인 필요(review)와, 입금 기한 + 2시간이 지나도 열린 자동 처리(자동 재확인이
  -- 멈춘 신호). 재입금·반납·운영자 해제·주문 취소로 닫히면 빠진다.
  select count(*), min(coalesce(v.reviewed_at, v.due_at + interval '2 hours')) into reversal_review, reversal_oldest
  from private.virtual_account_deposit_reversals v
  where v.state = 'review' or (v.state = 'awaiting_redeposit' and v.due_at <= at - interval '2 hours');$a$),
  pg_catalog.jsonb_build_array(
    $a$'refunds', jsonb_build_object('virtualAccountFailed', refund_failed, 'oldestAt', refund_oldest),$a$,
    $a$'refunds', jsonb_build_object('virtualAccountFailed', refund_failed, 'oldestAt', refund_oldest),
    'depositReversals', jsonb_build_object('review', reversal_review, 'oldestAt', reversal_oldest),$a$),
  pg_catalog.jsonb_build_array(
    $a$'refundFailures', refund_failed,$a$,
    $a$'refundFailures', refund_failed, 'depositReversalReviews', reversal_review,$a$),
  pg_catalog.jsonb_build_array(
    $a$'issues', problem + unresolved + mail_failed + refund_failed));$a$,
    $a$'issues', problem + unresolved + mail_failed + refund_failed + reversal_review));$a$)));

select private.va_reversal_patch('private.prepare_ops_alert_digest(timestamptz)'::regprocedure,
  $p$[["or a.event_key like 'virtual_account_refund_failed:%')", "or a.event_key like 'virtual_account_refund_failed:%' or a.event_key like 'virtual_account_deposit_reversal_review:%')", 2]]$p$::jsonb);

-- ---------------------------------------------------------------------------
-- 12. 운영자 계약 재등록(재정의한 함수)
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'public.claim_email_delivery(text,text,text,text,interval)'::regprocedure,
    'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure,
    'private.virtual_account_refund_watch_opened()'::regprocedure,
    'private.apply_goods_provider_cancellation(uuid,text,bigint,text)'::regprocedure,
    'private.order_virtual_account_json(uuid)'::regprocedure,
    'public.get_my_order_virtual_account(uuid)'::regprocedure,
    'private.order_fulfillment_hold_document(uuid)'::regprocedure,
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

drop function private.va_reversal_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
