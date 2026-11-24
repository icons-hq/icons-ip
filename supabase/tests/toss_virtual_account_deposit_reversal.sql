\set ON_ERROR_STOP on

-- 토스 가상계좌 입금 오류 되돌림 자동 처리(ADR-0049 결정 4) — 20261125150000_toss_virtual_account_deposit_reversal_auto.sql
-- 고정하는 것: 감지(보류·기록·고객 알림, 멱등), 재입금 자동 해제와 재되돌림, 자동 재확인 후보·리스·조회 결과 기록(대기·조회 불가 →
-- 확인 필요·회복·불일치), 입금 기한 뒤 반납 → 주문 취소(재고 복원·환불 행 없음·결제 canceled·환불 감시 없음), 이미 발송된 주문은
-- 확인 필요, 활성 취소 요청은 그 경로로 결제 없이 완료, 결제확인필요 요청 재시작, 열린 되돌림의 결제사 직접 취소 판정 유보, 운영자 해제가
-- 기록을 닫음, 구매자·운영자 계좌 조회 상태, 출고 보류 문서, 시스템 상태 건수, 실행 권한 봉인.

begin;

-- ---------------------------------------------------------------------------
-- 실행 권한(선언적 — CI 이미지의 권한 거부 런타임 호출은 피한다)
-- ---------------------------------------------------------------------------
select 1 / case when
  has_function_privilege('service_role', 'public.service_flag_goods_deposit_reversal(uuid,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_flag_goods_deposit_reversal(uuid,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.service_flag_goods_deposit_reversal(uuid,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.service_goods_deposit_reversal(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_goods_deposit_reversal(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_claim_deposit_reversal_checks(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_claim_deposit_reversal_checks(integer)', 'execute')
  and not has_function_privilege('anon', 'public.service_claim_deposit_reversal_checks(integer)', 'execute')
  and has_function_privilege('service_role', 'public.service_record_deposit_reversal_check(uuid,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_record_deposit_reversal_check(uuid,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.service_resolve_deposit_reversal_redeposited(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_resolve_deposit_reversal_redeposited(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.service_close_deposit_reversal(uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_close_deposit_reversal(uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.service_close_deposit_reversal(uuid,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.service_begin_deposit_reversal_cancellation(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_begin_deposit_reversal_cancellation(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.payment_deposit_reversal_released(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.mark_deposit_reversal_review(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'private.deposit_reversal_next_check(timestamptz,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.close_deposit_reversal_on_hold_release()', 'execute')
  and not exists (select 1 from pg_proc where proname = 'service_flag_goods_deposit_reversal' and pronargs = 4)
then 1 else 0 end as assert_reversal_function_acl;

select 1 / case when not has_table_privilege('service_role', 'private.virtual_account_deposit_reversals', 'select')
  and not has_table_privilege('authenticated', 'private.virtual_account_deposit_reversals', 'select')
then 1 else 0 end as assert_reversal_table_sealed;

create function pg_temp.expect_error(p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if strpos(sqlerrm, p_message) > 0 then return; end if;
    raise exception 'expected error containing %, got %', p_message, sqlerrm;
  end;
  raise exception 'expected error containing %, got success', p_message;
end $$;

-- ---------------------------------------------------------------------------
-- 고정 데이터 — 구매자 1명, 굿즈 1개(28,000원 + 배송비 3,000원 = 31,000원), 주문 6건(입금 대기 → 입금 승인까지)
--   5101: 되돌림 → 재입금 → 다시 되돌림          5102: 되돌림 → 기한 뒤 반납 → 자동 취소(재고 복원)
--   5103: 발송 뒤 되돌림 → 확인 필요(취소 안 함)    5104: 되돌림 + 처리 중 취소 요청 → 결제 없이 완료
--   5105: 되돌림 + 결제확인필요 취소 요청 → 재시작   5106: 조회 불가 → 확인 필요 → 회복, 불일치, 운영자 해제
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000005101', 'authenticated', 'authenticated', 'va-reversal@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values ('00000000-0000-4000-8000-000000005101', 'va-reversal@example.test', 'va_reversal', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;

insert into public.verticals (key, label, color) values ('va-reversal', '가상계좌 되돌림', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('va-reversal-ip', '가상계좌 되돌림 IP', 'va-reversal')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('va-reversal-good', 'va-reversal-ip', '가상계좌 되돌림 굿즈', 28000, 'ok', 20)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key)
select ('21000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000005101', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('11000000-0000-4000-8000-00000000' || n)::uuid
from unnest(array['5101', '5102', '5103', '5104', '5105', '5106']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-reversal-good', 1, 28000, '가상계좌 되돌림 굿즈', 'va-reversal-ip',
  (select id from public.goods_variants where good_id = 'va-reversal-good' and is_default)
from public.orders o where o.id::text like '21000000-0000-4000-8000-0000000051%';
-- 주문 생성처럼 재고를 하나씩 잡아 둔다(자동 취소가 되돌리는지 본다).
update public.goods_variants set stock_qty = stock_qty - 6 where good_id = 'va-reversal-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('31000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000005101', 'order',
  ('21000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:va-reversal:' || n,
  'O31000000000040008000' || lpad(n, 11, '0'), 'P31000000000040008000' || lpad(n, 11, '0'),
  ('41000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['5101', '5102', '5103', '5104', '5105', '5106']) as n;

-- 한 건씩 입금 대기 → 입금 승인(계정당 열린 입금 대기 상한 2건을 넘지 않게).
create function pg_temp.deposit(n text) returns void language plpgsql as $$
begin
  if public.finalize_goods_payment_awaiting_deposit(('31000000-0000-4000-8000-00000000' || n)::uuid,
      ('41000000-0000-4000-8000-00000000' || n)::uuid, 'va-rev-key-' || n, '20', 'X65056365' || n, now() + interval '24 hours',
      n in ('5102', '5104'))
    <> 'awaiting_deposit' then
    raise exception 'awaiting deposit failed for %', n;
  end if;
  if (public.claim_goods_payment_reconciliation(('31000000-0000-4000-8000-00000000' || n)::uuid,
      ('51000000-0000-4000-8000-00000000' || n)::uuid, 'va-rev-deposit-' || n))->>'claim_status' <> 'claimed' then
    raise exception 'claim failed for %', n;
  end if;
  if public.finalize_goods_payment_reconciliation(('31000000-0000-4000-8000-00000000' || n)::uuid,
      ('51000000-0000-4000-8000-00000000' || n)::uuid, 'approved', 'va-rev-key-' || n, 'VARTX' || n, null, 'DONE', '가상계좌',
      '가상계좌', now()) <> 'approved' then
    raise exception 'deposit approval failed for %', n;
  end if;
end $$;
select pg_temp.deposit(n) from unnest(array['5101', '5102', '5103', '5104', '5105', '5106']) as n;

-- 5102·5104는 구매안전서비스(에스크로)를 고른 결제다 — 입금 승인으로 배송 등록 작업이 생긴다(자동 취소가 지운다).
select 1 / case when (select count(*) = 2 from private.toss_escrow_deliveries
  where order_id in ('21000000-0000-4000-8000-000000005102', '21000000-0000-4000-8000-000000005104'))
then 1 else 0 end as assert_escrow_jobs_created;

select 1 / case when (select count(*) = 6 from public.orders o join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  where o.id::text like '21000000-0000-4000-8000-0000000051%' and o.status = 'paid' and p.status = 'paid')
then 1 else 0 end as assert_orders_paid;

-- 5103은 되돌림 전에 이미 발송됐다(배송 경로 트리거는 이 시험의 대상이 아니다).
set local session_replication_role = replica;
update public.order_shipments set status = 'shipping', shipped_at = now() where order_id = '21000000-0000-4000-8000-000000005103';
update public.orders set status = 'shipping' where id = '21000000-0000-4000-8000-000000005103';
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. 감지 — 보류 + 기록(조회한 기한) + 고객 알림, 같은 관측은 한 번
-- ---------------------------------------------------------------------------
select 1 / case when public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  'REVTX-5101-A', 'va-reversal-case-5101a', now() + interval '20 hours') = 'held'
  and public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  'REVTX-5101-A', 'va-reversal-case-5101b', now() + interval '20 hours') = 'already_recorded'
  and public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'other-key',
  'REVTX-5101-A', null) = 'not_applicable'
then 1 else 0 end as assert_reversal_flag_idempotent;

select 1 / case when (
  select r.state = 'awaiting_redeposit' and r.sequence = 1 and r.release_evidence is null
    and r.due_at between now() + interval '19 hours' and now() + interval '21 hours'
    and r.next_check_at between now() + interval '50 minutes' and now() + interval '70 minutes'
    and r.hold_id = (select h.id from private.order_fulfillment_holds h where h.order_id = r.order_id and h.reason = 'deposit_reversed')
  from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005101'
) and (
  select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000005101' and type = 'order_deposit_reversed'
    and dedupe_key = 'order:deposit_reversed:21000000-0000-4000-8000-000000005101:1'
) and private.order_fulfillment_blocking('21000000-0000-4000-8000-000000005101')
then 1 else 0 end as assert_reversal_recorded_and_customer_notified;

select 1 / case when (public.service_goods_deposit_reversal('31000000-0000-4000-8000-000000005101'))->>'state' = 'awaiting_redeposit'
  and (public.service_goods_deposit_reversal('31000000-0000-4000-8000-000000005101'))->>'paymentKey' = 'va-rev-key-5101'
  and public.service_goods_deposit_reversal('31000000-0000-4000-8000-000000005102') is null
then 1 else 0 end as assert_open_reversal_read;

-- 구매자는 '재입금 안내'(조회한 기한)를 보고 운영용 값은 보지 않는다. 운영자는 되돌림 상태를 본다.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000005101","role":"authenticated"}', true);
set local role authenticated;
select 1 / case when (
  select j->>'state' = 'reversed' and (j->>'dueAt')::timestamptz between now() + interval '19 hours' and now() + interval '21 hours'
    and not (j ? 'reversal') and not (j ? 'refund') and not (j ? 'escrow')
  from (select public.get_my_order_virtual_account('21000000-0000-4000-8000-000000005101') as j) x
) then 1 else 0 end as assert_buyer_sees_redeposit_notice;
reset role;
select set_config('request.jwt.claims', '{}', true);
select 1 / case when private.order_virtual_account_json('21000000-0000-4000-8000-000000005101')->'reversal'->>'state' = 'awaiting_redeposit'
  and (select d->'depositReversal'->>'state' = 'awaiting_redeposit' and (d->>'outboundBlocked')::boolean
    from jsonb_array_elements(private.order_fulfillment_hold_document('21000000-0000-4000-8000-000000005101')) d
    where d->>'reason' = 'deposit_reversed')
then 1 else 0 end as assert_operator_sees_reversal_state;

-- 열린 되돌림 결제의 상태 변경 웹훅은 결제사 직접 취소로 판정하지 않고 미룬다(되돌림 처리가 닫을 때까지).
select 1 / case when public.service_flag_goods_provider_cancellation('31000000-0000-4000-8000-000000005101', 'CANCELED', 0,
  'va-reversal-case-5101c') = 'in_flight'
  and not exists (select 1 from private.order_fulfillment_holds where order_id = '21000000-0000-4000-8000-000000005101'
    and reason = 'provider_canceled')
then 1 else 0 end as assert_provider_cancellation_deferred_while_reversal_open;

-- 확인 기록의 해제 종류: deposit_confirmed는 되돌림 보류에만, 사유 없이.
select pg_temp.expect_error($$update private.order_fulfillment_holds set released_at = now(), release_kind = 'deposit_confirmed',
  release_note = '사유가 있으면 안 된다' where order_id = '21000000-0000-4000-8000-000000005101' and reason = 'deposit_reversed'$$,
  'order_fulfillment_holds_release');

-- ---------------------------------------------------------------------------
-- 2. 재입금 → 보류 자동 해제·고객 알림 → 다시 되돌림이면 다시 연다(번호 2)
-- ---------------------------------------------------------------------------
select 1 / case when public.service_resolve_deposit_reversal_redeposited('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  'va-reversal-case-5101d') = 'redeposited' then 1 else 0 end as assert_redeposit_resolves;
select 1 / case when public.service_resolve_deposit_reversal_redeposited('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  null) = 'already_resolved' then 1 else 0 end as assert_redeposit_idempotent;
select 1 / case when (
  select r.state = 'closed' and r.resolution = 'redeposited' and r.resolved_at is not null
  from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005101'
) and (
  select h.release_kind = 'deposit_confirmed' and h.release_note is null and h.released_at is not null
  from private.order_fulfillment_holds h where h.order_id = '21000000-0000-4000-8000-000000005101' and h.reason = 'deposit_reversed'
) and not private.order_fulfillment_held('21000000-0000-4000-8000-000000005101')
  and exists (select 1 from public.notifications where type = 'order_paid'
    and dedupe_key = 'order:deposit_redeposited:21000000-0000-4000-8000-000000005101:1')
  and exists (select 1 from public.audit_log where action = 'system.order.fulfillment_hold_released'
    and target = 'order:21000000-0000-4000-8000-000000005101' and diff->>'trigger' = 'deposit_confirmed')
  and private.order_virtual_account_json('21000000-0000-4000-8000-000000005101')->>'state' = 'deposited'
then 1 else 0 end as assert_redeposit_releases_hold;

-- (함수가 바꾼 행은 같은 문장의 하위 조회에 보이지 않으므로 기록과 확인을 나눈다.)
select 1 / case when public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  'REVTX-5101-B', 'va-reversal-case-5101e', null) = 'held' then 1 else 0 end as assert_second_reversal_held;
select 1 / case when (select r.state = 'awaiting_redeposit' and r.sequence = 2 and r.resolution is null
    from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005101')
  and exists (select 1 from public.notifications where dedupe_key = 'order:deposit_reversed:21000000-0000-4000-8000-000000005101:2')
  and private.order_fulfillment_blocking('21000000-0000-4000-8000-000000005101')
then 1 else 0 end as assert_second_reversal_reopens;

-- 다시 입금된 뒤 결제사가 같은 거래 키(또는 거래 키 없이 같은 대체 근거)로 또 입금 전을 보여도 새 되돌림으로 다시 연다(놓치면 결제 없이 출고).
select 1 / case when public.service_resolve_deposit_reversal_redeposited('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101', null)
  = 'redeposited' then 1 else 0 end as assert_second_redeposit;
select 1 / case when public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
  'REVTX-5101-B', 'va-reversal-case-5101f', null) = 'held' then 1 else 0 end as assert_same_ref_reversal_held;
select 1 / case when (select r.state = 'awaiting_redeposit' and r.sequence = 3
    from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005101')
  and private.order_fulfillment_blocking('21000000-0000-4000-8000-000000005101')
  and public.service_flag_goods_deposit_reversal('31000000-0000-4000-8000-000000005101', 'va-rev-key-5101',
    'REVTX-5101-B', 'va-reversal-case-5101g', null) = 'already_recorded'
then 1 else 0 end as assert_same_ref_reversal_reopens_once;

-- ---------------------------------------------------------------------------
-- 3. 자동 재확인 후보·리스·조회 결과
-- ---------------------------------------------------------------------------
select public.service_flag_goods_deposit_reversal(('31000000-0000-4000-8000-00000000' || n)::uuid, 'va-rev-key-' || n, 'REVTX-' || n,
  'va-reversal-case-' || n || 'a', now() + interval '20 hours') as flagged
from unnest(array['5102', '5103', '5104', '5105', '5106']) as n;

update private.virtual_account_deposit_reversals set next_check_at = now() - interval '1 minute'
where attempt_id in ('31000000-0000-4000-8000-000000005102', '31000000-0000-4000-8000-000000005106');
select public.service_claim_deposit_reversal_checks(5) as claimed \gset
select 1 / case when :'claimed'::jsonb @> jsonb_build_array(
    jsonb_build_object('attemptId', '31000000-0000-4000-8000-000000005102', 'paymentKey', 'va-rev-key-5102', 'state', 'awaiting_redeposit',
      'released', false, 'attempt', jsonb_build_object('id', '31000000-0000-4000-8000-000000005102', 'amount', 31000,
        'provider_order_id', 'O31000000000040008000' || lpad('5102', 11, '0'))),
    jsonb_build_object('attemptId', '31000000-0000-4000-8000-000000005106'))
  and jsonb_array_length(:'claimed'::jsonb) = 2
  and jsonb_array_length(public.service_claim_deposit_reversal_checks(5)) = 0
then 1 else 0 end as assert_due_reversals_claimed_once;

-- 입금 기한 전 입금 대기: 다음 조회는 기한 + 30분과 1시간 중 이른 쪽(최소 10분 뒤).
select 1 / case when public.service_record_deposit_reversal_check('31000000-0000-4000-8000-000000005106', 'waiting',
  now() + interval '15 minutes') = 'awaiting_redeposit' then 1 else 0 end as assert_waiting_recorded;
select 1 / case when (select r.lease_until is null and r.due_at between now() + interval '14 minutes' and now() + interval '16 minutes'
      and r.next_check_at between now() + interval '44 minutes' and now() + interval '46 minutes'
    from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005106')
then 1 else 0 end as assert_waiting_reschedules;

-- 기한 + 2시간이 지나도 조회하지 못하면 확인 필요(운영 알림·시스템 상태), 조회가 회복되면 자동 처리로 돌아간다.
update private.virtual_account_deposit_reversals set due_at = now() - interval '3 hours'
where attempt_id = '31000000-0000-4000-8000-000000005106';
select 1 / case when public.service_record_deposit_reversal_check('31000000-0000-4000-8000-000000005106', 'unavailable') = 'review'
then 1 else 0 end as assert_lookup_failure_recorded;
select 1 / case when (select r.review_code = 'lookup_failed' from private.virtual_account_deposit_reversals r
    where r.attempt_id = '31000000-0000-4000-8000-000000005106')
  and exists (select 1 from private.admin_operation_alerts
    where event_key = 'virtual_account_deposit_reversal_review:31000000-0000-4000-8000-000000005106:1:lookup_failed')
  and (private.system_health_report()->'depositReversals'->>'review')::integer >= 1
  and (private.system_health_report()->'counts'->>'depositReversalReviews')::integer >= 1
then 1 else 0 end as assert_lookup_failure_escalates;
select 1 / case when public.service_record_deposit_reversal_check('31000000-0000-4000-8000-000000005106', 'waiting',
  now() + interval '2 hours') = 'awaiting_redeposit' then 1 else 0 end as assert_lookup_recovery_recorded;
select 1 / case when (select r.review_code is null from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005106')
then 1 else 0 end as assert_lookup_recovery_returns_to_auto;

-- 결제사 기록이 맞지 않으면 확인 필요. 운영자가 사유를 적고 보류를 풀면 기록이 닫힌다(시스템은 손을 뗀다).
select 1 / case when public.service_record_deposit_reversal_check('31000000-0000-4000-8000-000000005106', 'mismatch') = 'review'
then 1 else 0 end as assert_mismatch_recorded;
select 1 / case when (select r.review_code = 'payment_mismatch' from private.virtual_account_deposit_reversals r
    where r.attempt_id = '31000000-0000-4000-8000-000000005106')
  -- 결제사 기록이 맞지 않으면 고객에게 계좌를 다시 약속하지 않는다.
  and private.order_virtual_account_json('21000000-0000-4000-8000-000000005106')->>'state' = 'checking'
then 1 else 0 end as assert_mismatch_escalates;
update private.order_fulfillment_holds set released_at = now(), release_kind = 'operator', release_note = '상점관리자에서 입금 확인'
where order_id = '21000000-0000-4000-8000-000000005106' and reason = 'deposit_reversed' and released_at is null;
select 1 / case when (select r.state = 'closed' and r.resolution = 'operator_released'
    from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005106')
  and public.service_record_deposit_reversal_check('31000000-0000-4000-8000-000000005106', 'waiting') = 'closed'
then 1 else 0 end as assert_operator_release_closes_reversal;

-- ---------------------------------------------------------------------------
-- 4. 입금 기한 뒤 반납 → 자동 취소: 재고 복원, 환불 행 없음, 결제 canceled, 환불 송금 감시 없음, 고객 알림
-- ---------------------------------------------------------------------------
select (select stock_qty from public.goods_variants where good_id = 'va-reversal-good' and is_default) as stock_before \gset
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005102', 'va-rev-key-5102', 'expired',
  'va-reversal-close-5102a')->>'status' = 'closed' then 1 else 0 end as assert_release_closes_order;
select 1 / case when (
  select o.status = 'canceled' and p.status = 'canceled'
  from public.orders o join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  where o.id = '21000000-0000-4000-8000-000000005102'
) and not exists (
  select 1 from public.refunds rf join public.payments p on p.id = rf.payment_id where p.ref_id = '21000000-0000-4000-8000-000000005102'
) and not exists (
  select 1 from private.virtual_account_refund_watches w where w.order_id = '21000000-0000-4000-8000-000000005102'
) and (
  select r.state = 'closed' and r.resolution = 'released' and r.release_evidence = 'expired'
  from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005102'
) and (
  select h.release_kind = 'order_canceled' from private.order_fulfillment_holds h
  where h.order_id = '21000000-0000-4000-8000-000000005102' and h.reason = 'deposit_reversed'
) and (select stock_qty from public.goods_variants where good_id = 'va-reversal-good' and is_default) = :stock_before + 1
  and exists (select 1 from public.notifications where type = 'order_deposit_reversed'
    and dedupe_key = 'order:deposit_reversal_canceled:21000000-0000-4000-8000-000000005102')
  and exists (select 1 from public.audit_log where action = 'system.order.deposit_reversal_closed'
    and target = 'order:21000000-0000-4000-8000-000000005102')
  and private.order_virtual_account_json('21000000-0000-4000-8000-000000005102')->>'state' = 'closed'
  -- 등록할 에스크로 거래가 없다 — 배송 등록 작업이 '직접 등록 필요'로 운영자에게 가지 않게 지운다.
  and not exists (select 1 from private.toss_escrow_deliveries where order_id = '21000000-0000-4000-8000-000000005102')
then 1 else 0 end as assert_auto_cancel_without_refund;
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005102', 'va-rev-key-5102', 'expired',
  null)->>'status' = 'not_applicable'
  and public.service_resolve_deposit_reversal_redeposited('31000000-0000-4000-8000-000000005102', 'va-rev-key-5102', null)
    = 'not_applicable'
then 1 else 0 end as assert_closed_reversal_is_terminal;

-- ---------------------------------------------------------------------------
-- 5. 이미 발송된 주문 — 반납 증거는 남기되 주문은 취소하지 않고 확인 필요
-- ---------------------------------------------------------------------------
select 1 / case when not private.order_fulfillment_blocking('21000000-0000-4000-8000-000000005103')
  and public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005103', 'va-rev-key-5103', 'canceled',
    'va-reversal-close-5103a') = '{"status":"review","code":"order_shipped"}'::jsonb
then 1 else 0 end as assert_shipped_close_refused;
select 1 / case when (select o.status = 'shipping' from public.orders o where o.id = '21000000-0000-4000-8000-000000005103')
  and (select r.state = 'review' and r.review_code = 'order_shipped' and r.release_evidence = 'canceled'
    from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005103')
  and exists (select 1 from private.admin_operation_alerts
    where event_key = 'virtual_account_deposit_reversal_review:31000000-0000-4000-8000-000000005103:1:order_shipped')
  and private.order_virtual_account_json('21000000-0000-4000-8000-000000005103')->>'state' = 'closed'
then 1 else 0 end as assert_shipped_order_goes_to_review;
-- 발송된 주문의 반품은 그 요청의 길로 닫는다(반납 증거가 있어 환불 없이). 반납을 확인한 지 2시간이 지나도 닫히지 않은 요청은 사람에게 넘긴다.
insert into public.order_cancellation_requests (id, order_id, requested_by, reason, reason_type, claim_type, stage, status, requested_at)
values ('61000000-0000-4000-8000-000000005103', '21000000-0000-4000-8000-000000005103', '00000000-0000-4000-8000-000000005101',
  '변심 반품', 'change_of_mind', 'return', 'processing', private.order_claim_status_for_stage('processing'), now());
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005103', 'va-rev-key-5103', 'canceled', null)
  = jsonb_build_object('status', 'cancellation_pending', 'requestId', '61000000-0000-4000-8000-000000005103',
    'requestStatus', 'processing', 'claimType', 'return')
then 1 else 0 end as assert_shipped_return_uses_request_path;
update private.virtual_account_deposit_reversals set released_at = now() - interval '3 hours'
where attempt_id = '31000000-0000-4000-8000-000000005103';
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005103', 'va-rev-key-5103', 'canceled', null)
  = '{"status":"review","code":"cancellation_pending"}'::jsonb
then 1 else 0 end as assert_stuck_request_escalates;
delete from public.order_cancellation_requests where id = '61000000-0000-4000-8000-000000005103';

-- 반납을 확인한 결제에 입금 확인이 오면 증거가 엇갈린다 — 닫지 않고 확인 필요로 남긴다.
select 1 / case when public.service_resolve_deposit_reversal_redeposited('31000000-0000-4000-8000-000000005103', 'va-rev-key-5103', null)
  = 'conflict' then 1 else 0 end as assert_conflict_detected;
select 1 / case when (select r.review_code = 'payment_mismatch' and r.state = 'review' from private.virtual_account_deposit_reversals r
    where r.attempt_id = '31000000-0000-4000-8000-000000005103')
then 1 else 0 end as assert_conflicting_evidence_stays_in_review;

-- ---------------------------------------------------------------------------
-- 6. 활성 취소 요청 — 반납 증거를 남기고 그 요청이 결제 없이 완료된다
-- ---------------------------------------------------------------------------
insert into public.order_cancellation_requests (id, order_id, requested_by, reason, reason_type, claim_type, stage, status, requested_at)
values ('61000000-0000-4000-8000-000000005104', '21000000-0000-4000-8000-000000005104', '00000000-0000-4000-8000-000000005101',
  '변심', 'change_of_mind', 'cancel', 'processing', private.order_claim_status_for_stage('processing'), now());
insert into public.order_cancellation_claims(order_id, requested_by, previous_status)
values ('21000000-0000-4000-8000-000000005104', '00000000-0000-4000-8000-000000005101', 'paid'::public.order_status);
-- 승인 경로(운영자 전액 취소·결정·고객 자동 승인)는 환불 의도 행(requested)을 먼저 남긴다 — 완료가 이 행 때문에 막히지 않아야 한다.
insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
select p.id, p.amount, '변심', 'requested', '61000000-0000-4000-8000-000000005104'
from public.payments p where p.purpose = 'order' and p.ref_id = '21000000-0000-4000-8000-000000005104';
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005104', 'va-rev-key-5104', 'canceled',
  'va-reversal-close-5104a') = jsonb_build_object('status', 'cancellation_pending',
    'requestId', '61000000-0000-4000-8000-000000005104', 'requestStatus', 'processing', 'claimType', 'cancel')
then 1 else 0 end as assert_active_request_reported;
select 1 / case when (select r.lease_until is null and r.next_check_at between now() + interval '29 minutes' and now() + interval '31 minutes'
  from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005104')
then 1 else 0 end as assert_active_request_defers_next_check;
select 1 / case when (select o.status = 'paid' from public.orders o where o.id = '21000000-0000-4000-8000-000000005104')
then 1 else 0 end as assert_active_request_left_to_its_path;
-- 오케스트레이터가 결제사 조회로 반납(CANCELED)을 확인하고 완료를 부른 것과 같다.
select public.complete_order_cancellation_request('61000000-0000-4000-8000-000000005104', array['va-rev-key-5104'], null);
select 1 / case when (
  select o.status = 'canceled' and p.status = 'canceled' and c.status = 'completed'
  from public.orders o join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  join public.order_cancellation_requests c on c.order_id = o.id
  where o.id = '21000000-0000-4000-8000-000000005104'
) and not exists (
  select 1 from public.refunds rf join public.payments p on p.id = rf.payment_id where p.ref_id = '21000000-0000-4000-8000-000000005104'
) and not exists (
  select 1 from private.virtual_account_refund_watches w where w.order_id = '21000000-0000-4000-8000-000000005104'
) and (
  select r.state = 'closed' and r.resolution = 'released'
  from private.virtual_account_deposit_reversals r where r.attempt_id = '31000000-0000-4000-8000-000000005104'
) and exists (
  select 1 from public.audit_log where action = 'system.order.cancellation_completed'
    and target = 'order:21000000-0000-4000-8000-000000005104' and (diff->>'refundCount')::integer = 0
) and not exists (select 1 from private.toss_escrow_deliveries where order_id = '21000000-0000-4000-8000-000000005104')
then 1 else 0 end as assert_request_completes_without_refund;

-- 결제확인필요로 멈춘 취소 요청: 반납 증거가 있을 때만 처리 중으로 되돌린다.
insert into public.order_cancellation_requests (id, order_id, requested_by, reason, reason_type, claim_type, stage, status, requested_at,
  last_error_code)
values ('61000000-0000-4000-8000-000000005105', '21000000-0000-4000-8000-000000005105', '00000000-0000-4000-8000-000000005101',
  '변심', 'change_of_mind', 'cancel', 'needs_review', private.order_claim_status_for_stage('needs_review'), now(),
  'provider_deposit_reversed');
insert into public.order_cancellation_claims(order_id, requested_by, previous_status)
values ('21000000-0000-4000-8000-000000005105', '00000000-0000-4000-8000-000000005101', 'paid'::public.order_status);
insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
select p.id, p.amount, '변심', 'failed', '61000000-0000-4000-8000-000000005105'
from public.payments p where p.purpose = 'order' and p.ref_id = '21000000-0000-4000-8000-000000005105';
select 1 / case when public.service_begin_deposit_reversal_cancellation('61000000-0000-4000-8000-000000005105') = 'not_applicable'
then 1 else 0 end as assert_restart_needs_release_evidence;
select 1 / case when public.service_close_deposit_reversal('31000000-0000-4000-8000-000000005105', 'va-rev-key-5105', 'canceled',
  'va-reversal-close-5105a')->>'status' = 'cancellation_pending' then 1 else 0 end as assert_needs_review_request_pending;
select 1 / case when public.service_begin_deposit_reversal_cancellation('61000000-0000-4000-8000-000000005105') = 'started'
then 1 else 0 end as assert_needs_review_request_restarts;
select 1 / case when (select c.status = 'processing' from public.order_cancellation_requests c where c.id = '61000000-0000-4000-8000-000000005105')
  and public.service_begin_deposit_reversal_cancellation('61000000-0000-4000-8000-000000005105') = 'started'
then 1 else 0 end as assert_restart_idempotent;
-- 재시작한 요청도 결제 없이 완료된다(결제확인필요 때 failed로 남았던 환불 의도 행 포함).
select public.complete_order_cancellation_request('61000000-0000-4000-8000-000000005105', array['va-rev-key-5105'], null);
select 1 / case when (select o.status = 'canceled' and p.status = 'canceled'
    from public.orders o join public.payments p on p.ref_id = o.id and p.purpose = 'order' where o.id = '21000000-0000-4000-8000-000000005105')
  and not exists (select 1 from public.refunds rf join public.payments p on p.id = rf.payment_id
    where p.ref_id = '21000000-0000-4000-8000-000000005105')
then 1 else 0 end as assert_restarted_request_completes_without_refund;

-- 시스템 상태 건수: 확인 필요(5103)가 할 일로 남는다. 재입금·반납·운영자 해제로 닫힌 건은 빠진다.
select 1 / case when (
  select count(*) = 1 from private.virtual_account_deposit_reversals r where r.state = 'review'
    and r.order_id::text like '21000000-0000-4000-8000-0000000051%'
) and (private.system_health_report()->'counts'->>'issues')::integer >= 1
then 1 else 0 end as assert_review_counted;

rollback;
