\set ON_ERROR_STOP on

-- 입금된 토스 가상계좌(에스크로 아님)의 부분 취소·부분 반품·반품배송비 차감 — 20261126102000_virtual_account_partial_cancel.sql
-- 고정하는 것: 에스크로가 아님이 확인된 입금 가상계좌만 세 판정(부분 취소·부분 반품·반품배송비 차감)이 연다(선택 모름·에스크로·입금 오류
-- 되돌림은 막는다), 부분 반품 환급 계좌 입력 판정이 같은 판정을 쓴다, 가상계좌 부분 환불도 은행 송금 감시를 열고 끝난 감시는 새 환불로 다시
-- 연다, 작업자에게 결제사에 남아야 할 잔액을 준다(부분 환불 뒤·반품배송비 차감 반품 뒤), 부분 반품 재시도는 결제사를 부르기 전에 원장을
-- 처리 중으로 옮기고(그동안 환급 계좌 변경을 막는다) 결제확인필요 사유가 바뀌면 반품 요청에도 옮긴다, 실행 권한 봉인.

begin;

select 1 / case when
  not has_function_privilege('service_role', 'private.toss_virtual_account_partial_cancel_ready(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.toss_virtual_account_partial_cancel_ready(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.open_virtual_account_refund_watch(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.open_virtual_account_refund_watch(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.virtual_account_partial_refund_watch_opened()', 'execute')
  and to_regprocedure('private.va_partial_patch(regprocedure,jsonb)') is null
  and has_function_privilege('service_role', 'public.service_begin_order_partial_cancellation_retry(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_begin_order_partial_cancellation_retry(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.service_begin_order_partial_cancellation_retry(uuid,uuid)', 'execute')
  and (select pg_get_triggerdef(oid) like '%AFTER UPDATE OF state, last_error_code%' from pg_trigger
    where tgname = 'order_partial_cancellations_return_claim')
then 1 else 0 end as assert_partial_function_acl;

-- 세 판정이 같은 규칙으로 가상계좌를 본다(동작은 아래 1·3에서 고정한다). 계좌이체 규칙은 그대로다.
select 1 / case when (
  select bool_and(pg_get_functiondef(f::regprocedure) like '%(e.payment_method = ''가상계좌'' or e.result_code = ''DONE_virtual_account'') and not private.toss_virtual_account_partial_cancel_ready(a.id)%'
    and pg_get_functiondef(f::regprocedure) like '%e.payment_method = ''계좌이체'' and not private.toss_transfer_confirmed_non_escrow(a.id)%')
  from unnest(array['private.order_partial_cancellation_blockers(uuid)', 'private.order_partial_return_order_blocker(uuid)',
    'private.return_fee_deduction_plan(uuid)']) as f
) and pg_get_functiondef('private.order_claim_virtual_account_refund_blocker(public.order_cancellation_requests,public.orders)'::regprocedure)
  like '%claim_is_partial_return(p_claim.id) and not coalesce(private.toss_virtual_account_partial_cancel_ready(%'
  and pg_get_functiondef('private.virtual_account_refund_watch_opened()'::regprocedure) like '%where private.virtual_account_refund_watches.state in (''completed'', ''resolved'')%'
  and pg_get_functiondef('public.service_claim_virtual_account_refund_watches(integer)'::regprocedure) like '%''expectedBalance''%'
then 1 else 0 end as assert_virtual_account_rule_in_all_partial_paths;

-- ---------------------------------------------------------------------------
-- 고정 데이터 — 4961: 가상계좌 입금(에스크로 아님) · 4962: 가상계좌 입금(에스크로 선택 모름) · 4963: 가상계좌 입금(에스크로)
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000004961', 'authenticated', 'authenticated', 'va-partial@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values ('00000000-0000-4000-8000-000000004961', 'va-partial@example.test', 'va_partial', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;
insert into public.verticals (key, label, color) values ('va-partial', '가상계좌 부분 취소', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('va-partial-ip', '가상계좌 부분 취소 IP', 'va-partial')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('va-partial-good', 'va-partial-ip', '가상계좌 부분 취소 상품', 14000, 'ok', 20)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key, calculation_version, address)
select ('26000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004961', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('16000000-0000-4000-8000-00000000' || n)::uuid, 1,
  '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb
from unnest(array['4961', '4962', '4963', '4964']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-partial-good', 2, 14000, '가상계좌 부분 취소 상품', 'va-partial-ip',
  (select id from public.goods_variants where good_id = 'va-partial-good' and is_default)
from public.orders o where o.id::text like '26000000-0000-4000-8000-0000000049%';
update public.goods_variants set stock_qty = stock_qty - 8 where good_id = 'va-partial-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('36000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004961', 'order',
  ('26000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:va-partial:' || n,
  'O36000000000040008000' || lpad(n, 11, '0'), 'P36000000000040008000' || lpad(n, 11, '0'),
  ('46000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4961', '4962', '4963', '4964']) as n;

-- 발급: 4961은 결제 조회가 useEscrow:false, 4962는 값 없음(null), 4963은 에스크로(true). 계정당 열린 입금 대기는 2건까지라 두 건을
-- 입금 승인(재정합)으로 닫은 뒤 셋째를 발급한다.
create function pg_temp.deposit(n text) returns void language plpgsql as $$
begin
  if (public.claim_goods_payment_reconciliation(('36000000-0000-4000-8000-00000000' || n)::uuid,
      ('56000000-0000-4000-8000-00000000' || n)::uuid, 'vap-smoke-partial-' || n))->>'claim_status' <> 'claimed'
    or public.finalize_goods_payment_reconciliation(('36000000-0000-4000-8000-00000000' || n)::uuid,
      ('56000000-0000-4000-8000-00000000' || n)::uuid, 'approved', 'vap-key-' || n, 'VAPTX' || n, null, 'DONE', '가상계좌', '가상계좌', now())
      <> 'approved' then
    raise exception 'deposit failed for %', n;
  end if;
end $$;
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
    '36000000-0000-4000-8000-000000004961', '46000000-0000-4000-8000-000000004961', 'vap-key-4961',
    '20', 'X6505636518361', now() + interval '24 hours', false, '88', '110123456789', '김토스') = 'awaiting_deposit'
  and public.finalize_goods_payment_awaiting_deposit(
    '36000000-0000-4000-8000-000000004962', '46000000-0000-4000-8000-000000004962', 'vap-key-4962',
    '20', 'X6505636518362', now() + interval '24 hours', null::boolean) = 'awaiting_deposit'
then 1 else 0 end as assert_first_virtual_accounts_issued;
select pg_temp.deposit('4961');
select pg_temp.deposit('4962');
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
    '36000000-0000-4000-8000-000000004963', '46000000-0000-4000-8000-000000004963', 'vap-key-4963',
    '20', 'X6505636518363', now() + interval '24 hours', true) = 'awaiting_deposit'
then 1 else 0 end as assert_escrow_virtual_account_issued;
select pg_temp.deposit('4963');
-- 4964: 가상계좌 입금(에스크로 아님) — 부분 반품 재시도 시험용.
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
    '36000000-0000-4000-8000-000000004964', '46000000-0000-4000-8000-000000004964', 'vap-key-4964',
    '20', 'X6505636518364', now() + interval '24 hours', false) = 'awaiting_deposit'
then 1 else 0 end as assert_retry_virtual_account_issued;
select pg_temp.deposit('4964');
select 1 / case when (
  select count(*) = 4 and bool_and(a.state = 'approved')
  from public.payment_attempts a where a.id::text like '36000000-0000-4000-8000-0000000049%'
) then 1 else 0 end as assert_virtual_accounts_deposited;

-- ---------------------------------------------------------------------------
-- 1. 에스크로가 아님이 확인된 입금 가상계좌만 연다
-- ---------------------------------------------------------------------------
select 1 / case when private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004961')
  and not ('partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('26000000-0000-4000-8000-000000004961')))
  and private.order_partial_return_order_blocker('26000000-0000-4000-8000-000000004961') is distinct from 'unsupported_payment'
then 1 else 0 end as assert_confirmed_non_escrow_virtual_account_opens;

-- 선택을 모르면(에스크로 작업이 확인 대기) 막는다. 에스크로 결제(거래 키)도 막는다.
select 1 / case when not private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004962')
  and 'partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('26000000-0000-4000-8000-000000004962'))
  and private.order_partial_return_order_blocker('26000000-0000-4000-8000-000000004962') = 'unsupported_payment'
  and not private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004963')
  and 'partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('26000000-0000-4000-8000-000000004963'))
  and private.order_partial_return_order_blocker('26000000-0000-4000-8000-000000004963') = 'unsupported_payment'
then 1 else 0 end as assert_escrow_or_unknown_virtual_account_blocked;

-- 작업자가 결제 조회로 에스크로가 아님을 확인하면(거래 키 없이 건너뜀) 연다 — 계좌이체와 같은 근거.
select 1 / case when exists (select 1 from private.toss_escrow_deliveries where order_id = '26000000-0000-4000-8000-000000004962')
then 1 else 0 end as assert_unknown_choice_has_escrow_job;
select public.service_finish_toss_escrow_job('26000000-0000-4000-8000-000000004962', 1, 'skipped', null, null, null, null);
select 1 / case when private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004962')
  and not ('partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('26000000-0000-4000-8000-000000004962')))
then 1 else 0 end as assert_worker_confirmed_virtual_account_opens;

-- 은행이 입금을 되돌린 결제는 되돌림 처리가 끝날 때까지 막는다.
insert into private.virtual_account_deposit_reversals(attempt_id, order_id, payment_id, provider_payment_key, due_at, next_check_at)
select a.id, a.ref_id, a.payment_id, 'vap-key-4961', now() + interval '1 day', now() + interval '1 hour'
from public.payment_attempts a where a.id = '36000000-0000-4000-8000-000000004961';
select 1 / case when not private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004961')
  and 'partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('26000000-0000-4000-8000-000000004961'))
then 1 else 0 end as assert_open_deposit_reversal_blocks;
update private.virtual_account_deposit_reversals set state = 'closed', resolution = 'redeposited', resolved_at = now()
where attempt_id = '36000000-0000-4000-8000-000000004961';
select 1 / case when private.toss_virtual_account_partial_cancel_ready('36000000-0000-4000-8000-000000004961')
then 1 else 0 end as assert_closed_reversal_reopens;

-- ---------------------------------------------------------------------------
-- 2. 가상계좌 부분 환불도 은행 송금 감시를 연다 · 작업자에게 남아야 할 잔액을 준다 · 끝난 감시는 새 환불로 다시 연다
-- ---------------------------------------------------------------------------
select id as payment_4961 from public.payments where purpose = 'order' and ref_id = '26000000-0000-4000-8000-000000004961' \gset
insert into private.order_partial_cancellations(id, order_id, payment_id, provider, sequence, reason_code, customer_decision,
  warehouse_stop_confirmed, payment_amount, balance_before, goods_refund_amount, shipping_refund_amount, refund_amount, state,
  operation_id, created_by)
values ('76000000-0000-4000-8000-000000004961', '26000000-0000-4000-8000-000000004961', :'payment_4961', 'toss', 1, 'out_of_stock',
  '고객 동의 확인(합성)', false, 31000, 31000, 14000, 0, 14000, 'processing', '86000000-0000-4000-8000-000000004961',
  '00000000-0000-4000-8000-000000004961');
select 1 / case when not exists (select 1 from private.virtual_account_refund_watches where attempt_id = '36000000-0000-4000-8000-000000004961')
then 1 else 0 end as assert_no_watch_before_partial_refund;
update private.order_partial_cancellations
set state = 'completed', applied_at = now(), completed_at = now(), provider_confirmed_at = now(), provider_transaction_key = 'VAPCANCEL4961'
where id = '76000000-0000-4000-8000-000000004961';
select 1 / case when (
  select state = 'pending' and payment_id = :'payment_4961'::uuid and provider_payment_key = 'vap-key-4961'
  from private.virtual_account_refund_watches where attempt_id = '36000000-0000-4000-8000-000000004961'
) then 1 else 0 end as assert_partial_refund_opens_watch;

-- 결제 원장은 아직 paid다 — 결제사에 남아야 할 잔액은 31,000 − 14,000 = 17,000원.
update private.virtual_account_refund_watches set next_check_at = now() - interval '1 minute'
where attempt_id = '36000000-0000-4000-8000-000000004961';
select 1 / case when public.service_claim_virtual_account_refund_watches(5) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'attemptId', '36000000-0000-4000-8000-000000004961', 'paymentKey', 'vap-key-4961', 'amount', 31000, 'expectedBalance', 17000))
then 1 else 0 end as assert_watch_reports_expected_balance;

-- 송금이 끝나 닫힌 감시는 다음 환불(남은 잔액 취소 — 결제 원장 refunded)이 다시 연다. 실패한 감시는 그대로 둔다.
select public.service_record_virtual_account_refund_watch('36000000-0000-4000-8000-000000004961', 'completed', 'COMPLETED');
select 1 / case when (select state = 'completed' from private.virtual_account_refund_watches where attempt_id = '36000000-0000-4000-8000-000000004961')
then 1 else 0 end as assert_partial_watch_completed;
update public.payments set status = 'refunded' where id = :'payment_4961';
select 1 / case when (
  select state = 'pending' and completed_at is null and refund_status is null and checks = 0 and refunded_at > now() - interval '1 minute'
  from private.virtual_account_refund_watches where attempt_id = '36000000-0000-4000-8000-000000004961'
) then 1 else 0 end as assert_full_refund_reopens_completed_watch;
update private.virtual_account_refund_watches set next_check_at = now() - interval '1 minute'
where attempt_id = '36000000-0000-4000-8000-000000004961';
-- 원장이 환불 완료면 남아야 할 잔액은 0이다(전액 취소 상태를 기대한다).
select 1 / case when public.service_claim_virtual_account_refund_watches(5) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'attemptId', '36000000-0000-4000-8000-000000004961', 'expectedBalance', 0))
then 1 else 0 end as assert_full_refund_expects_zero_balance;

select public.service_record_virtual_account_refund_watch('36000000-0000-4000-8000-000000004961', 'failed', 'FAILED');
select private.open_virtual_account_refund_watch(:'payment_4961');
select 1 / case when (
  select state = 'failed' and failure_code = 'refund_failed'
  from private.virtual_account_refund_watches where attempt_id = '36000000-0000-4000-8000-000000004961'
) then 1 else 0 end as assert_failed_watch_not_reopened;

-- ---------------------------------------------------------------------------
-- 3. 반품배송비 차감 — 에스크로가 아님이 확인된 입금 가상계좌는 차감을 결정하고(에스크로는 전액 환불), 차감 반품이 끝나면 결제사에는
--    차감액이 남는다(PARTIAL_CANCELED) — 은행 송금 감시가 그 잔액을 기대해야 결제사 기록 불일치로 잘못 오르지 않는다.
-- ---------------------------------------------------------------------------
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 배송·반품 정책 개정 공지',
  enabled_at = clock_timestamp() - interval '10 days' where singleton;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy,
  collected_at, requested_at)
select ('66000000-0000-4000-8000-00000000' || n)::uuid, ('26000000-0000-4000-8000-00000000' || n)::uuid,
  '00000000-0000-4000-8000-000000004961', '단순 변심 반품', 'change_of_mind', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '2 days'
from unnest(array['4962', '4963']) as n;
select 1 / case when private.return_fee_deduction_plan('66000000-0000-4000-8000-000000004962')
    @> '{"applicable": true, "basis": "one_way", "deductionAmount": 3000, "paymentAmount": 31000, "refundAmount": 28000}'
  and private.return_fee_deduction_plan('66000000-0000-4000-8000-000000004963')
    @> '{"applicable": false, "reason": "partial_cancel_unsupported", "refundAmount": 31000}'
then 1 else 0 end as assert_deduction_follows_escrow_rule;

select id as payment_4962 from public.payments where purpose = 'order' and ref_id = '26000000-0000-4000-8000-000000004962' \gset
insert into private.claim_refund_deductions(claim_id, order_id, payment_id, provider, payment_amount, one_way_amount, basis,
  initial_shipping_fee, deduction_amount, refund_amount, settings_revision, state, provider_confirmed_at, provider_transaction_key, applied_at)
values ('66000000-0000-4000-8000-000000004962', '26000000-0000-4000-8000-000000004962', :'payment_4962', 'toss', 31000, 3000, 'one_way',
  3000, 3000, 28000, 1, 'applied', now(), 'VAPDEDUCT4962', now());
update public.payments set status = 'refunded' where id = :'payment_4962';
update private.virtual_account_refund_watches set next_check_at = now() - interval '1 minute'
where attempt_id = '36000000-0000-4000-8000-000000004962';
select 1 / case when public.service_claim_virtual_account_refund_watches(5) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'attemptId', '36000000-0000-4000-8000-000000004962', 'amount', 31000, 'expectedBalance', 3000))
then 1 else 0 end as assert_deduction_return_expects_retained_balance;

-- ---------------------------------------------------------------------------
-- 4. 부분 반품 재시도 — 결제사를 부르기 전에 원장을 처리 중으로 옮기고(그동안 환급 계좌를 바꾸지 못한다), 결제확인필요 사유가 바뀌면
--    반품 요청에도 옮긴다(구매자 알림이 사유별로 간다).
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000004969', 'authenticated', 'authenticated', 'va-partial-operator@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values ('00000000-0000-4000-8000-000000004969', 'va-partial-operator@example.test', 'va_partial_operator', '2000-01-01',
  '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000004969';
insert into private.operator_memberships(profile_id, manager_role) values ('00000000-0000-4000-8000-000000004969', 'primary')
on conflict do nothing;
update private.operator_access_state set configured = true where id;

select id as payment_4964 from public.payments where purpose = 'order' and ref_id = '26000000-0000-4000-8000-000000004964' \gset
-- 부분 반품은 배송 건의 품목을 고른다(고정 데이터는 배송 건 없이 만든 주문이라 하나 만든다).
insert into public.fulfillment_origins(id, code, name, base_fee, return_address, is_active)
values ('96000000-0000-4000-8000-000000004964', 'va-partial-origin', '합성 출고지', 0, '합성 반송지', true);
insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
values ('96100000-0000-4000-8000-000000004964', '26000000-0000-4000-8000-000000004964', '96000000-0000-4000-8000-000000004964',
  '합성 출고지', 3000, '{}');
insert into public.order_shipment_items(order_id, shipment_id, order_item_id)
select oi.order_id, '96100000-0000-4000-8000-000000004964', oi.id from public.order_items oi where oi.order_id = '26000000-0000-4000-8000-000000004964';
select oi.id as item_4964, si.shipment_id as shipment_4964
from public.order_items oi join public.order_shipment_items si on si.order_item_id = oi.id
where oi.order_id = '26000000-0000-4000-8000-000000004964' limit 1 \gset
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy,
  collected_at, requested_at)
values ('66000000-0000-4000-8000-000000004964', '26000000-0000-4000-8000-000000004964', '00000000-0000-4000-8000-000000004961',
  '단순 변심 반품', 'change_of_mind', 'return', 'collected', 'legacy', clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '1 day');
insert into public.order_claim_items(claim_id, order_id, order_item_id, shipment_id, qty)
values ('66000000-0000-4000-8000-000000004964', '26000000-0000-4000-8000-000000004964', :'item_4964', :'shipment_4964', 1);
insert into private.order_partial_cancellations(id, order_id, payment_id, provider, sequence, reason_code, customer_decision,
  warehouse_stop_confirmed, payment_amount, balance_before, goods_refund_amount, shipping_refund_amount, refund_amount, state,
  operation_id, created_by, claim_id)
values ('76000000-0000-4000-8000-000000004964', '26000000-0000-4000-8000-000000004964', :'payment_4964', 'toss', 1, 'return',
  '반품 클레임(합성)', false, 31000, 31000, 14000, 0, 14000, 'processing', '86000000-0000-4000-8000-000000004964',
  '00000000-0000-4000-8000-000000004969', '66000000-0000-4000-8000-000000004964');
update public.order_cancellation_requests set stage = 'processing', updated_at = now() where id = '66000000-0000-4000-8000-000000004964';
select 1 / case when private.claim_is_partial_return('66000000-0000-4000-8000-000000004964')
  and private.order_claim_refund_account_blocker(c, o) = 'refund_account_refund_in_progress'
then 1 else 0 end as assert_partial_return_processing_blocks_account
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = '66000000-0000-4000-8000-000000004964';

-- 계좌 없음으로 멈춤 → 반품 요청 결제확인필요(계좌 없음) · 구매자 알림 · 계좌 입력 열림
select public.service_mark_order_partial_cancellation_needs_review('76000000-0000-4000-8000-000000004964',
  'provider_refund_account_required', '00000000-0000-4000-8000-000000004969');
select 1 / case when (
  select stage = 'needs_review' and last_error_code = 'provider_refund_account_required'
  from public.order_cancellation_requests where id = '66000000-0000-4000-8000-000000004964'
) and exists (select 1 from public.notifications where dedupe_key = 'claim:refund_account_required:66000000-0000-4000-8000-000000004964')
then 1 else 0 end as assert_partial_return_required_noticed;
select 1 / case when private.order_claim_refund_account_blocker(c, o) is null
then 1 else 0 end as assert_partial_return_account_open_on_account_code
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = '66000000-0000-4000-8000-000000004964';

-- 원장이 결제확인필요에 머문 채 사유만 바뀌어도(계좌 없음 → 결제사가 계좌 거절) 반품 요청 사유와 구매자 알림이 따라간다.
select public.service_mark_order_partial_cancellation_needs_review('76000000-0000-4000-8000-000000004964',
  'provider_refund_account_invalid', '00000000-0000-4000-8000-000000004969');
select 1 / case when (
  select last_error_code = 'provider_refund_account_invalid'
  from public.order_cancellation_requests where id = '66000000-0000-4000-8000-000000004964'
) and exists (select 1 from public.notifications where dedupe_key = 'claim:refund_account_invalid:66000000-0000-4000-8000-000000004964')
  and public.service_virtual_account_refund_account_notice('66000000-0000-4000-8000-000000004964')->>'code' = 'invalid'
then 1 else 0 end as assert_partial_return_code_change_synced;

-- 재시도 시작 → 원장·반품 요청이 처리 중(감사 기록), 그동안 계좌를 받지 않는다. 처리 중에 다시 불러도 상태만 돌려준다.
select public.service_begin_order_partial_cancellation_retry('76000000-0000-4000-8000-000000004964',
  '00000000-0000-4000-8000-000000004969') as begun \gset
select 1 / case when :'begun' = 'processing' and (
  select h.state = 'processing' and h.last_error_code is null
  from private.order_partial_cancellations h where h.id = '76000000-0000-4000-8000-000000004964'
) and (
  select c.stage = 'processing' and c.status = 'processing' and c.last_error_code is null
  from public.order_cancellation_requests c where c.id = '66000000-0000-4000-8000-000000004964'
) and exists (
  select 1 from public.audit_log where action = 'admin.order.partial_cancellation_retry_started'
    and diff->>'partialCancellationId' = '76000000-0000-4000-8000-000000004964' and diff->>'previousCode' = 'provider_refund_account_invalid'
) then 1 else 0 end as assert_partial_return_retry_moves_to_processing;
select 1 / case when public.service_begin_order_partial_cancellation_retry('76000000-0000-4000-8000-000000004964',
  '00000000-0000-4000-8000-000000004969') = 'processing'
then 1 else 0 end as assert_partial_return_retry_idempotent_while_processing;
select 1 / case when private.order_claim_refund_account_blocker(c, o) = 'refund_account_refund_in_progress'
then 1 else 0 end as assert_partial_return_retry_blocks_account_change
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = '66000000-0000-4000-8000-000000004964';

-- 결과 불명으로 멈추면 결제사가 이미 그 계좌로 환불했을 수 있어 계좌를 바꾸지 않는다.
select public.service_mark_order_partial_cancellation_needs_review('76000000-0000-4000-8000-000000004964',
  'provider_cancel_ambiguous', '00000000-0000-4000-8000-000000004969');
select 1 / case when private.order_claim_refund_account_blocker(c, o) = 'refund_account_finance_started'
  and c.last_error_code = 'provider_cancel_ambiguous'
then 1 else 0 end as assert_partial_return_ambiguous_blocks_account_change
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = '66000000-0000-4000-8000-000000004964';

rollback;

