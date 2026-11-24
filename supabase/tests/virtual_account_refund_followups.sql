\set ON_ERROR_STOP on

-- 토스 가상계좌 환불 후속(ADR-0049 결정 5 보강) — 20261125110000_virtual_account_refund_followups.sql,
-- 20261125110100_toss_transfer_escrow_admin_view.sql, 20261125130000_virtual_account_refund_escrow_autoclose.sql
-- 고정하는 것: 입금된 가상계좌 주문의 환급 계좌 입력·변경(주문 상세), 환불 계좌 후보 조회, 계좌 입력 뒤 취소 재시도 시작(반품은
-- 운영자 알림), 은행 환불 감시(열기·고르기·완료·실패·지연·운영자 처리 완료)와 시스템 상태·운영 알림, 계좌이체 에스크로 운영자 조회,
-- 에스크로 구매자 취소 환불의 7일 뒤 시스템 완료, 실행 권한 봉인.

begin;

-- ---------------------------------------------------------------------------
-- 실행 권한(선언적 — CI 이미지의 권한 거부 런타임 호출은 피한다)
-- ---------------------------------------------------------------------------
select 1 / case when
  has_function_privilege('service_role', 'public.service_goods_virtual_account_refund_accounts(uuid,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_goods_virtual_account_refund_accounts(uuid,text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.service_goods_virtual_account_refund_accounts(uuid,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_begin_virtual_account_refund_retry(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_begin_virtual_account_refund_retry(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.service_begin_virtual_account_refund_retry(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_claim_virtual_account_refund_watches(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_claim_virtual_account_refund_watches(integer)', 'execute')
  and has_function_privilege('service_role', 'public.service_record_virtual_account_refund_watch(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_record_virtual_account_refund_watch(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.service_record_virtual_account_refund_watch(uuid,text,text,boolean)', 'execute')
  -- 인자가 늘어 예전 3인자 함수는 지웠다(새 인자는 기본값 null이라 3인자 호출은 그대로 받는다).
  and to_regprocedure('public.service_record_virtual_account_refund_watch(uuid,text,text)') is null
  and has_function_privilege('authenticated', 'public.admin_resolve_virtual_account_refund_watch(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_resolve_virtual_account_refund_watch(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_resolve_virtual_account_refund_watch(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_order_transfer_escrow(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_order_transfer_escrow(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.order_toss_virtual_account_payment(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.order_toss_virtual_account_payment(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.order_claim_virtual_account_refund_blocker(public.order_cancellation_requests,public.orders)', 'execute')
  and not has_function_privilege('service_role', 'private.virtual_account_refund_watch_opened()', 'execute')
  and not has_table_privilege('service_role', 'private.virtual_account_refund_watches', 'select')
  and not has_table_privilege('authenticated', 'private.virtual_account_refund_watches', 'select')
  and not has_function_privilege('service_role', 'private.virtual_account_refund_account_usable(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.virtual_account_refund_account_usable(text,text,text)', 'execute')
  -- 예전 단수형 계좌 조회(평문 계좌를 돌려주던 service 함수)는 지웠다.
  and to_regprocedure('public.service_goods_virtual_account_refund_account(uuid,text)') is null
  and has_function_privilege('authenticated', 'public.admin_virtual_account_refund_failures(integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_virtual_account_refund_failures(integer)', 'execute')
  and (select count(*) from private.operator_rpc_contracts where signature in (
    'public.admin_resolve_virtual_account_refund_watch(uuid,text)', 'public.admin_order_transfer_escrow(uuid)',
    'public.admin_virtual_account_refund_failures(integer)')) = 3
then 1 else 0 end as assert_followup_function_acl;

-- 환불 송금 실패 알림은 운영 알림 요약 메일의 '시스템 장애'에 센다(두 곳).
select 1 / case when (
  select (length(def) - length(replace(def, 'virtual_account_refund_failed:%', ''))) / length('virtual_account_refund_failed:%') = 2
  from (select pg_get_functiondef('private.prepare_ops_alert_digest(timestamptz)'::regprocedure) as def) d
) then 1 else 0 end as assert_digest_counts_refund_failures;

-- ---------------------------------------------------------------------------
-- 고정 데이터
--   4911: 가상계좌 입금(결제 화면 환불 계좌 없음) → 취소 자동 승인 → 계좌 없음으로 결제확인필요
--   4912: 가상계좌 입금(결제 화면 환불 계좌 있음) → 반품, 결제사가 계좌를 거절해 결제확인필요
--   4913: 카드 결제(가상계좌 아님) 취소         4914: 계좌이체 승인(에스크로 작업)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'Expected error: % (statement %)', expected, statement;
end $$;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000004911', 'authenticated', 'authenticated', 'var-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000004919', 'authenticated', 'authenticated', 'var-operator@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000004911', 'var-buyer@example.test', 'var_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000004919', 'var-operator@example.test', 'var_operator', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000004919';
insert into private.operator_memberships(profile_id, manager_role) values ('00000000-0000-4000-8000-000000004919', 'primary')
on conflict do nothing;
update private.operator_access_state set configured = true where id;
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values ('00000000-0000-4000-8000-0000000049a1', '00000000-0000-4000-8000-000000004911', now(), now(), null);

create function pg_temp.as_buyer() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000004911',
    'session_id', '00000000-0000-4000-8000-0000000049a1')::text, true);
end $$;
create function pg_temp.as_operator() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004919', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000004919')::text, true);
end $$;

insert into public.verticals (key, label, color) values ('va-refund', '가상계좌 환불', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('va-refund-ip', '가상계좌 환불 IP', 'va-refund')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('va-refund-good', 'va-refund-ip', '가상계좌 환불 굿즈', 28000, 'ok', 10)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key, address)
select ('21000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004911', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('11000000-0000-4000-8000-00000000' || n)::uuid,
  '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb
from unnest(array['4911', '4912', '4913', '4914']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-refund-good', 1, 28000, '가상계좌 환불 굿즈', 'va-refund-ip',
  (select id from public.goods_variants where good_id = 'va-refund-good' and is_default)
from public.orders o where o.id::text like '21000000-0000-4000-8000-0000000049%';
update public.goods_variants set stock_qty = stock_qty - 4 where good_id = 'va-refund-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('31000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004911', 'order',
  ('21000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:var:' || n,
  'O31000000000040008000' || lpad(n, 11, '0'), 'P31000000000040008000' || lpad(n, 11, '0'),
  ('41000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4911', '4912', '4913', '4914']) as n;

-- 가상계좌 두 건: 입금 대기 → 입금 승인(재정합)
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '31000000-0000-4000-8000-000000004911', '41000000-0000-4000-8000-000000004911', 'var-key-4911',
  '20', 'X6505636518311', now() + interval '24 hours', false) = 'awaiting_deposit'
  and public.finalize_goods_payment_awaiting_deposit(
  '31000000-0000-4000-8000-000000004912', '41000000-0000-4000-8000-000000004912', 'var-key-4912',
  '20', 'X6505636518312', now() + interval '24 hours', false, '88', '110123456789', '김토스') = 'awaiting_deposit'
then 1 else 0 end as assert_virtual_accounts_issued;
select (public.claim_goods_payment_reconciliation('31000000-0000-4000-8000-000000004911', '51000000-0000-4000-8000-000000004911', 'var-smoke-refund-4911'))->>'claim_status' = 'claimed' as claimed_4911 \gset
select (public.claim_goods_payment_reconciliation('31000000-0000-4000-8000-000000004912', '51000000-0000-4000-8000-000000004912', 'var-smoke-refund-4912'))->>'claim_status' = 'claimed' as claimed_4912 \gset
select 1 / case when public.finalize_goods_payment_reconciliation('31000000-0000-4000-8000-000000004911', '51000000-0000-4000-8000-000000004911', 'approved',
    'var-key-4911', 'VARTX4911', null, 'DONE', '가상계좌', '가상계좌', now()) = 'approved'
  and public.finalize_goods_payment_reconciliation('31000000-0000-4000-8000-000000004912', '51000000-0000-4000-8000-000000004912', 'approved',
    'var-key-4912', 'VARTX4912', null, 'DONE', '가상계좌', '가상계좌', now()) = 'approved'
then 1 else 0 end as assert_virtual_accounts_deposited;
-- 카드·계좌이체 승인
select 1 / case when public.finalize_goods_payment_attempt(
    '31000000-0000-4000-8000-000000004913', '41000000-0000-4000-8000-000000004913', 'approved',
    'card-key-4913', 'CARDTX4913', null, 'DONE', '카드', '4330****', now()) = 'approved'
  and public.finalize_goods_payment_attempt(
    '31000000-0000-4000-8000-000000004914', '41000000-0000-4000-8000-000000004914', 'approved',
    'tr-key-4914', 'TRTX4914', null, 'DONE', '계좌이체', '계좌이체', now()) = 'approved'
then 1 else 0 end as assert_card_and_transfer_approved;

select 1 / case when private.order_toss_virtual_account_payment('21000000-0000-4000-8000-000000004911')->>'paymentKey' = 'var-key-4911'
  and private.order_toss_virtual_account_payment('21000000-0000-4000-8000-000000004913') is null
  and private.order_toss_virtual_account_payment('21000000-0000-4000-8000-000000004914') is null
then 1 else 0 end as assert_virtual_account_payment_detected;

-- 계좌 판정은 DB 함수 하나다(앱은 후보 응답의 usable을 따른다): 목록의 은행 이름 + 하이픈을 뺀 숫자 6~20자리 + 예금주 1~50자.
select 1 / case when private.virtual_account_refund_account_usable('신한은행', '110-987-654321', ' 김합성 ')
  and not private.virtual_account_refund_account_usable('농협', '110987654321', '김합성')
  and not private.virtual_account_refund_account_usable('신한은행', '1234567890123456789012', '김합성')
  and not private.virtual_account_refund_account_usable('신한은행', '12345', '김합성')
  and not private.virtual_account_refund_account_usable('신한은행', '110987654321', ' ')
  and not private.virtual_account_refund_account_usable(null, '110987654321', '김합성')
then 1 else 0 end as assert_refund_account_usable_rule;
-- 반품·취소 신청 화면도 입금된 가상계좌 주문에는 그대로 보낼 수 없는 계좌를 받지 않는다(신청 전체가 되돌려진다).
select pg_temp.expect_error($$select public.request_order_claim('21000000-0000-4000-8000-000000004911',
  '00000000-0000-4000-8000-000000004911', 'cancel', '사용자 주문 취소', 'change_of_mind', '농협', '110-987-654321', '김합성')$$,
  'invalid_virtual_account_refund_account');
select pg_temp.expect_error($$select public.request_order_claim('21000000-0000-4000-8000-000000004911',
  '00000000-0000-4000-8000-000000004911', 'cancel', '사용자 주문 취소', 'change_of_mind', '신한은행', '1234567890123456789012', '김합성')$$,
  'invalid_virtual_account_refund_account');
select 1 / case when not exists (
  select 1 from public.order_cancellation_requests where order_id = '21000000-0000-4000-8000-000000004911'
) then 1 else 0 end as assert_unusable_claim_account_rejected_at_request;

-- 4911 취소: 자동 승인(처리 중) → 결제사가 환불 계좌를 요구해 결제확인필요. 4913 카드 취소도 같은 상태로 둔다.
select 1 / case when public.request_order_claim('21000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-000000004911',
    'cancel', '사용자 주문 취소', 'change_of_mind', null, null, null) = 'auto_approved'
  and public.request_order_claim('21000000-0000-4000-8000-000000004913', '00000000-0000-4000-8000-000000004911',
    'cancel', '사용자 주문 취소', 'change_of_mind', null, null, null) = 'auto_approved'
then 1 else 0 end as assert_cancel_claims_auto_approved;
select id as claim_4911 from public.order_cancellation_requests where order_id = '21000000-0000-4000-8000-000000004911' \gset
select id as claim_4913 from public.order_cancellation_requests where order_id = '21000000-0000-4000-8000-000000004913' \gset

-- 처리 중(결제사 환불 진행)에는 계좌를 받지 않는다.
select 1 / case when private.order_claim_refund_account_blocker(c, o) = 'refund_account_refund_in_progress'
then 1 else 0 end as assert_refund_in_progress_blocks
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = :'claim_4911';

select public.mark_order_cancellation_needs_review(:'claim_4911', null, 'provider_refund_account_required');
select public.mark_order_cancellation_needs_review(:'claim_4913', null, 'provider_refund_account_required');

-- 4912 반품: 결제사가 결제 화면 계좌를 거절해 결제확인필요(직접 고정).
insert into public.order_cancellation_requests (id, order_id, requested_by, reason, reason_type, claim_type, stage, status, requested_at, last_error_code)
values ('61000000-0000-4000-8000-000000004912', '21000000-0000-4000-8000-000000004912', '00000000-0000-4000-8000-000000004911',
  '단순 변심 반품', 'change_of_mind', 'return', 'needs_review', private.order_claim_status_for_stage('needs_review'), now(),
  'provider_refund_account_invalid');
-- 환불 단계까지 온 반품에는 취소 원장 행이 있다(운영자 재시작·시스템 재시작 모두 이 행을 요구한다).
insert into public.order_cancellation_claims(order_id, requested_by, previous_status)
values ('21000000-0000-4000-8000-000000004912', '00000000-0000-4000-8000-000000004911', 'paid'::public.order_status);

-- 카드 주문은 지금 차단 그대로(회사 계좌 무통장만), 가상계좌 결제확인필요는 열린다.
select 1 / case when private.order_claim_refund_account_blocker(c, o) = 'refund_account_payment_unavailable'
then 1 else 0 end as assert_card_order_still_blocked
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = :'claim_4913';
select 1 / case when private.order_claim_refund_account_blocker(c, o) is null
then 1 else 0 end as assert_virtual_account_needs_review_opens
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = :'claim_4911';
-- 계좌 때문이 아닌 결제확인필요(결과 불명 등)는 결제사가 이미 앞 계좌로 환불했을 수 있어 계좌를 바꾸지 않는다.
select 1 / case when private.order_claim_refund_account_blocker(jsonb_populate_record(c, jsonb_build_object('last_error_code', 'provider_unavailable')), o)
  = 'refund_account_finance_started'
then 1 else 0 end as assert_other_review_codes_block_replacement
from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = :'claim_4911';

-- ---------------------------------------------------------------------------
-- 1. 구매자 문맥·저장·변경
-- ---------------------------------------------------------------------------
select claim_revision as revision_4911 from public.order_cancellation_requests where id = :'claim_4911' \gset
set local role authenticated;
select pg_temp.as_buyer();
select 1 / case when (
  select ctx->>'mode' = 'virtual_account' and (ctx->>'allowed')::boolean and ctx->>'refundAccountIssue' = 'required'
    and ctx->'checkoutAccount' = 'null'::jsonb and ctx->'maskedAccount' = 'null'::jsonb
  from (select public.get_my_order_claim_refund_account_context('21000000-0000-4000-8000-000000004911', :'claim_4911',
    '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1') as ctx) c
) then 1 else 0 end as assert_buyer_context_requires_account;
select 1 / case when (
  select ctx->>'mode' = 'virtual_account' and ctx->>'refundAccountIssue' = 'invalid'
    and ctx->'checkoutAccount'->>'bankCode' = '88' and ctx->'checkoutAccount'->>'maskedAccount' like '%6789'
    and ctx->'checkoutAccount'->>'maskedAccount' not like '%110123456789%'
  from (select public.get_my_order_claim_refund_account_context('21000000-0000-4000-8000-000000004912', '61000000-0000-4000-8000-000000004912',
    '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1') as ctx) c
) then 1 else 0 end as assert_buyer_context_shows_masked_checkout_account;
select 1 / case when (
  select ctx->>'mode' = 'bank_transfer' and not (ctx->>'allowed')::boolean and ctx->>'blocker' = 'refund_account_payment_unavailable'
  from (select public.get_my_order_claim_refund_account_context('21000000-0000-4000-8000-000000004913', :'claim_4913',
    '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1') as ctx) c
) then 1 else 0 end as assert_card_context_unchanged;

-- 가상계좌 환불은 은행 코드·숫자 6~20자리로 보낸다 — 목록 밖 은행 이름·형식 밖 계좌번호는 저장하지 않는다.
select pg_temp.expect_error(format($$select public.set_my_order_claim_refund_account('21000000-0000-4000-8000-000000004911', %L,
  '71000000-0000-4000-8000-0000000049f1', %s, '국민은행', '123-456-789012', '김합성',
  '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1')$$, :'claim_4911', :revision_4911),
  'invalid_virtual_account_refund_account');
select pg_temp.expect_error(format($$select public.set_my_order_claim_refund_account('21000000-0000-4000-8000-000000004911', %L,
  '71000000-0000-4000-8000-0000000049f2', %s, '신한은행', '1234-5678-9012-3456-7890-12', '김합성',
  '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1')$$, :'claim_4911', :revision_4911),
  'invalid_virtual_account_refund_account');
select 1 / case when (public.set_my_order_claim_refund_account('21000000-0000-4000-8000-000000004911', :'claim_4911',
  '71000000-0000-4000-8000-000000004911', :revision_4911, 'KB국민은행', '123-456-789012', '김합성',
  '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1'))->>'state' = 'saved'
then 1 else 0 end as assert_virtual_account_refund_account_saved;
reset role;
select set_config('request.jwt.claims', '{}', true);

select 1 / case when (
  select a.bank_name = 'KB국민은행' and a.account_number = '123-456-789012' and a.account_holder = '김합성' and a.purged_at is null
  from private.claim_refund_accounts a where a.claim_id = :'claim_4911'
) and exists (
  select 1 from public.audit_log where action = 'order.claim_refund_account_confirmed' and diff->>'mode' = 'virtual_account'
    and (diff->>'replaced')::boolean = false and target = 'order:21000000-0000-4000-8000-000000004911'
) then 1 else 0 end as assert_claim_account_recorded;

-- 결제사가 이 계좌를 거절했다면 고친 계좌로 바꿀 수 있다(가상계좌 주문만).
select claim_revision as revision_4911b from public.order_cancellation_requests where id = :'claim_4911' \gset
select claim_revision as revision_4912 from public.order_cancellation_requests where id = '61000000-0000-4000-8000-000000004912' \gset
set local role authenticated;
select pg_temp.as_buyer();
select 1 / case when (public.set_my_order_claim_refund_account('21000000-0000-4000-8000-000000004911', :'claim_4911',
  '71000000-0000-4000-8000-000000004912', :revision_4911b, '신한은행', '110987654321', '김합성',
  '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1'))->>'state' = 'saved'
then 1 else 0 end as assert_virtual_account_refund_account_replaced;
-- 반품이 계좌 때문에 멈춰 있으면 계좌 입력이 운영 알림을 올린다.
select 1 / case when (public.set_my_order_claim_refund_account('21000000-0000-4000-8000-000000004912', '61000000-0000-4000-8000-000000004912',
  '71000000-0000-4000-8000-000000004913', :revision_4912, '우리은행', '1002-123-456789', '김합성',
  '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1'))->>'state' = 'saved'
then 1 else 0 end as assert_return_refund_account_saved;
reset role;
select set_config('request.jwt.claims', '{}', true);

select 1 / case when (
  select a.bank_name = '신한은행' and a.account_number = '110987654321' and a.masked_account like '신한은행 %'
  from private.claim_refund_accounts a where a.claim_id = :'claim_4911'
) and exists (
  select 1 from public.audit_log where action = 'order.claim_refund_account_confirmed' and (diff->>'replaced')::boolean
    and target = 'order:21000000-0000-4000-8000-000000004911'
) and exists (
  select 1 from private.admin_operation_alerts
  where event_key like 'virtual_account_refund_account_updated:61000000-0000-4000-8000-000000004912:%' and category = 'claims'
    and href = '/admin/sales/claims/returns/61000000-0000-4000-8000-000000004912'
) and not exists (
  select 1 from private.admin_operation_alerts where event_key like 'virtual_account_refund_account_updated:' || :'claim_4911' || ':%'
) then 1 else 0 end as assert_account_replaced_and_return_alerted;

-- ---------------------------------------------------------------------------
-- 2. 환불 계좌 후보(서버) — 클레임 계좌와 결제 화면 계좌. 원장 결제 키가 다르면 아무것도 주지 않는다.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select r->'claim'->>'bankName' = '신한은행' and r->'claim'->>'accountNumber' = '110987654321' and r->'claim'->>'holderName' = '김합성'
    and r->'checkout' = 'null'::jsonb
  from (select public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004911', 'var-key-4911', :'claim_4911') as r) x
) and (
  select r->'checkout'->>'bankCode' = '88' and r->'checkout'->>'accountNumber' = '110123456789'
    and r->'claim'->>'bankName' = '우리은행'
  from (select public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004912', 'var-key-4912',
    '61000000-0000-4000-8000-000000004912') as r) x
) and public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004911', 'other-key', :'claim_4911') is null
  -- 다른 주문의 요청 계좌는 싣지 않는다.
  and public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004911', 'var-key-4911',
    '61000000-0000-4000-8000-000000004912')->'claim' = 'null'::jsonb
then 1 else 0 end as assert_refund_account_candidates;

-- ---------------------------------------------------------------------------
-- 3. 계좌 입력 뒤 재시도 시작 — 취소는 처리 중으로(시스템), 반품은 운영자, 카드·처리 중은 대상 아님
-- ---------------------------------------------------------------------------
select 1 / case when public.service_begin_virtual_account_refund_retry('61000000-0000-4000-8000-000000004912') = 'operator_required'
  and public.service_begin_virtual_account_refund_retry(:'claim_4913') = 'not_applicable'
then 1 else 0 end as assert_retry_routes_return_and_card;
-- 입력된 계좌를 결제사에 그대로 보낼 수 없으면(예: 운영자 접수 경로의 자유 입력 은행 이름) 재시도를 시작하지 않고 계좌를 고치라고 돌려준다
-- — 결제 화면 계좌로 넘어가지 않고, 구매자 문맥은 '바꿔야 하는 계좌'로 보인다.
update private.claim_refund_accounts set bank_name = '농협' where claim_id = :'claim_4911';
select 1 / case when public.service_begin_virtual_account_refund_retry(:'claim_4911') = 'account_invalid'
  and (select c.status = 'needs_review' from public.order_cancellation_requests c where c.id = :'claim_4911')
  and (public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004911', 'var-key-4911', :'claim_4911')
    ->'claim'->>'usable')::boolean = false
then 1 else 0 end as assert_retry_refuses_unusable_account;
set local role authenticated;
select pg_temp.as_buyer();
select 1 / case when (
  select ctx->>'refundAccountIssue' = 'unusable' and (ctx->>'allowed')::boolean
  from (select public.get_my_order_claim_refund_account_context('21000000-0000-4000-8000-000000004911', :'claim_4911',
    '00000000-0000-4000-8000-000000004911', '00000000-0000-4000-8000-0000000049a1') as ctx) c
) then 1 else 0 end as assert_buyer_context_flags_unusable_account;
reset role;
select set_config('request.jwt.claims', '{}', true);
update private.claim_refund_accounts set account_number = '1234567890123456789012', bank_name = '신한은행' where claim_id = :'claim_4911';
select 1 / case when public.service_begin_virtual_account_refund_retry(:'claim_4911') = 'account_invalid'
then 1 else 0 end as assert_retry_refuses_overlong_account;
update private.claim_refund_accounts set account_number = '110987654321' where claim_id = :'claim_4911';
select 1 / case when (public.service_goods_virtual_account_refund_accounts('31000000-0000-4000-8000-000000004911', 'var-key-4911', :'claim_4911')
    ->'claim'->>'usable')::boolean
then 1 else 0 end as assert_candidate_reports_usable_account;
select 1 / case when public.service_begin_virtual_account_refund_retry(:'claim_4911') = 'started'
then 1 else 0 end as assert_retry_started;
select 1 / case when (
  select c.status = 'processing' from public.order_cancellation_requests c where c.id = :'claim_4911'
) and exists (
  select 1 from public.audit_log where action = 'system.order.cancellation_reconcile_started' and actor_id is null
    and diff->>'reason' = 'virtual_account_refund_account_updated' and diff->>'requestId' = :'claim_4911'
) and public.service_begin_virtual_account_refund_retry(:'claim_4911') = 'not_applicable'
then 1 else 0 end as assert_retry_moves_to_processing_once;

-- ---------------------------------------------------------------------------
-- 4. 은행 환불 감시 — 환불 확정(결제 원장 refunded)이 감시를 연다
-- ---------------------------------------------------------------------------
select coalesce((private.system_health_report()->'counts'->>'refundFailures')::integer, -1) as refund_failures_before \gset
select 1 / case when :refund_failures_before >= 0 then 1 else 0 end as assert_health_reports_refund_failures;

select public.complete_order_cancellation_request(:'claim_4911', array['var-key-4911'], null);
select 1 / case when (
  select w.state = 'pending' and w.order_id = '21000000-0000-4000-8000-000000004911' and w.provider_payment_key = 'var-key-4911'
    and w.next_check_at > now()
  from private.virtual_account_refund_watches w where w.attempt_id = '31000000-0000-4000-8000-000000004911'
) and not exists (
  select 1 from private.virtual_account_refund_watches w where w.attempt_id = '31000000-0000-4000-8000-000000004913'
) then 1 else 0 end as assert_watch_opened_for_virtual_account_only;
-- 카드 결제 환불은 감시하지 않는다.
update public.payments set status = 'refunded' where payment_key = 'card-key-4913';
select 1 / case when not exists (
  select 1 from private.virtual_account_refund_watches w where w.attempt_id = '31000000-0000-4000-8000-000000004913'
) then 1 else 0 end as assert_card_refund_not_watched;

-- 아직 볼 때가 아니면 고르지 않는다. 때가 되면 결제 키·주문번호와 함께 고르고 10분 리스를 건다.
select 1 / case when public.service_claim_virtual_account_refund_watches(5) = '[]'::jsonb then 1 else 0 end as assert_watch_not_due_yet;
update private.virtual_account_refund_watches set next_check_at = now() - interval '1 minute'
where attempt_id = '31000000-0000-4000-8000-000000004911';
select 1 / case when public.service_claim_virtual_account_refund_watches(5) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'attemptId', '31000000-0000-4000-8000-000000004911', 'paymentKey', 'var-key-4911',
  'providerOrderId', 'O31000000000040008000' || lpad('4911', 11, '0'), 'amount', 31000))
then 1 else 0 end as assert_watch_claimed;
select 1 / case when public.service_claim_virtual_account_refund_watches(5) = '[]'::jsonb
  and (select checks = 1 and next_check_at > now() from private.virtual_account_refund_watches
    where attempt_id = '31000000-0000-4000-8000-000000004911')
then 1 else 0 end as assert_watch_leased;

-- 송금 확인 전(PENDING)은 상태를 바꾸지 않고 2시간 뒤 다시 본다.
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004911', 'pending', 'PENDING') = 'pending'
then 1 else 0 end as assert_watch_pending_recorded;
select 1 / case when (
  select state = 'pending' and refund_status = 'PENDING' and next_check_at > now() + interval '100 minutes'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004911'
) then 1 else 0 end as assert_watch_pending_rescheduled;

-- 은행 송금 실패 → 실패·운영 알림·감사·시스템 상태
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004911', 'failed', 'FAILED') = 'failed'
then 1 else 0 end as assert_watch_failed_recorded;
select 1 / case when (
  select state = 'failed' and failure_code = 'refund_failed' and failed_at is not null and refund_status = 'FAILED'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004911'
) and exists (
  select 1 from private.admin_operation_alerts
  where event_key = 'virtual_account_refund_failed:31000000-0000-4000-8000-000000004911' and category = 'orders'
    and href = '/admin/sales/orders/21000000-0000-4000-8000-000000004911'
) and exists (
  select 1 from public.audit_log where action = 'system.order.virtual_account_refund_failed'
    and target = 'order:21000000-0000-4000-8000-000000004911' and diff->>'failureCode' = 'refund_failed'
) and (private.system_health_report()->'counts'->>'refundFailures')::integer = :refund_failures_before + 1
  and (private.system_health_report()->'refunds'->>'virtualAccountFailed')::integer = :refund_failures_before + 1
then 1 else 0 end as assert_refund_failure_surfaced;
-- 같은 실패를 다시 읽어도 알림은 한 번이다.
select public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004911', 'failed', 'FAILED');
select 1 / case when (select count(*) = 1 from private.admin_operation_alerts
  where event_key = 'virtual_account_refund_failed:31000000-0000-4000-8000-000000004911')
then 1 else 0 end as assert_refund_failure_alerted_once;

-- 실패 뒤 재환불이 진행 중(PENDING)으로 읽혀도 실패로 남고 처음 사유를 지킨다(7일이 지났어도 지연으로 덮지 않는다).
update private.virtual_account_refund_watches set refunded_at = now() - interval '8 days'
where attempt_id = '31000000-0000-4000-8000-000000004911';
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004911', 'pending', 'PENDING') = 'failed'
then 1 else 0 end as assert_failed_watch_stays_failed_while_pending;
select 1 / case when (
  select state = 'failed' and failure_code = 'refund_failed' and refund_status = 'PENDING'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004911'
) then 1 else 0 end as assert_failure_code_kept;

-- 운영자 주문 패널은 송금 상태를 보고, 구매자 조회에는 운영용 상태가 없다.
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004911'))->'refund'->>'state' = 'failed'
  and (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004911'))->'refund'->>'failureCode' = 'refund_failed'
then 1 else 0 end as assert_operator_sees_refund_watch;
select 1 / case when (
  select (r->>'total')::integer = :refund_failures_before + 1
    and r->'items' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderId', '21000000-0000-4000-8000-000000004911', 'failureCode', 'refund_failed', 'amount', 31000, 'refundStatus', 'PENDING'))
  from (select public.admin_virtual_account_refund_failures(20) as r) x
) then 1 else 0 end as assert_operator_lists_refund_failures;
select pg_temp.as_buyer();
select 1 / case when not (public.get_my_order_virtual_account('21000000-0000-4000-8000-000000004911') ? 'refund')
  and not (public.get_my_order_virtual_account('21000000-0000-4000-8000-000000004911') ? 'escrow')
then 1 else 0 end as assert_buyer_does_not_see_refund_watch;
-- 구매자는 '처리 완료'를 할 수 없다(함수 자신의 운영자 판정).
select pg_temp.expect_error($$select public.admin_resolve_virtual_account_refund_watch('21000000-0000-4000-8000-000000004911', '구매자 시도')$$,
  'operator_capability_required');
select pg_temp.expect_error($$select public.admin_virtual_account_refund_failures(20)$$, 'operator_capability_required');
-- 운영자 처리 완료: 사유가 필요하고, 닫히면 시스템 상태에서 빠진다.
select pg_temp.as_operator();
select pg_temp.expect_error($$select public.admin_resolve_virtual_account_refund_watch('21000000-0000-4000-8000-000000004911', ' ')$$,
  'invalid_refund_resolution');
select 1 / case when public.admin_resolve_virtual_account_refund_watch('21000000-0000-4000-8000-000000004911',
  '구매자 계좌로 직접 송금 완료') = 'resolved'
then 1 else 0 end as assert_operator_resolves;
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select 1 / case when (
  select state = 'resolved' and resolved_by = '00000000-0000-4000-8000-000000004919' and resolution_note = '구매자 계좌로 직접 송금 완료'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004911'
) and exists (
  select 1 from public.audit_log where action = 'admin.order.virtual_account_refund_resolved'
    and actor_id = '00000000-0000-4000-8000-000000004919' and target = 'order:21000000-0000-4000-8000-000000004911'
) and (private.system_health_report()->'counts'->>'refundFailures')::integer = :refund_failures_before
  -- 닫힌 감시는 다시 고르지도 바꾸지도 않는다.
  and public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004911', 'completed', 'COMPLETED') = 'resolved'
then 1 else 0 end as assert_resolved_watch_closed;

-- 7일 넘게 송금 확인 전이면 지연으로 올리고, 뒤에 완료가 확인되면 저절로 닫는다(감사 기록).
insert into private.virtual_account_refund_watches(attempt_id, order_id, payment_id, provider_payment_key, refunded_at)
select a.id, a.ref_id, a.payment_id, 'var-key-4912', now() - interval '8 days'
from public.payment_attempts a where a.id = '31000000-0000-4000-8000-000000004912';
-- 조회 전이어도(자동 재확인이 멈춰도) 7일 지난 송금 확인 전 감시는 시스템 상태와 확인 목록에 오른다.
select 1 / case when (private.system_health_report()->'counts'->>'refundFailures')::integer = :refund_failures_before + 1
then 1 else 0 end as assert_stale_pending_counted;
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when public.admin_virtual_account_refund_failures(20)->'items' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'orderId', '21000000-0000-4000-8000-000000004912', 'failureCode', 'refund_overdue'))
then 1 else 0 end as assert_stale_pending_listed;
-- 주문 화면도 확인 필요(지연)로 보여 '처리 완료로 표시'가 열린다.
select 1 / case when (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004912'))->'refund'->>'state' = 'failed'
  and (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004912'))->'refund'->>'failureCode' = 'refund_overdue'
then 1 else 0 end as assert_stale_pending_shown_as_attention;
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
-- 조회가 멈춘 채 7일이 지난 감시도 운영자가 처리 완료로 닫을 수 있다(4913 결제 시도로 따로 만든 감시).
insert into private.virtual_account_refund_watches(attempt_id, order_id, payment_id, provider_payment_key, refunded_at)
select a.id, a.ref_id, a.payment_id, 'card-key-4913', now() - interval '9 days'
from public.payment_attempts a where a.id = '31000000-0000-4000-8000-000000004913';
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when public.admin_resolve_virtual_account_refund_watch('21000000-0000-4000-8000-000000004913', '회사 계좌로 직접 송금') = 'resolved'
then 1 else 0 end as assert_stale_pending_resolvable;
reset role;
select 1 / case when (
  select state = 'resolved' from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004913'
) and exists (
  select 1 from public.audit_log where action = 'admin.order.virtual_account_refund_resolved'
    and target = 'order:21000000-0000-4000-8000-000000004913' and diff->>'failureCode' = 'refund_overdue' and diff->>'fromState' = 'pending'
) then 1 else 0 end as assert_stale_pending_resolution_audited;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004912', 'pending', 'PENDING') = 'failed'
then 1 else 0 end as assert_overdue_refund_flagged;
select 1 / case when (
  select failure_code = 'refund_overdue' from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004912'
) and exists (
  select 1 from private.admin_operation_alerts where event_key = 'virtual_account_refund_failed:31000000-0000-4000-8000-000000004912'
    and title like '%7일째%'
) then 1 else 0 end as assert_overdue_alerted;
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004912', 'completed', 'COMPLETED') = 'completed'
then 1 else 0 end as assert_failed_watch_completes;
select 1 / case when (
  select state = 'completed' and completed_at is not null from private.virtual_account_refund_watches
  where attempt_id = '31000000-0000-4000-8000-000000004912'
) and exists (
  select 1 from public.audit_log where action = 'system.order.virtual_account_refund_completed'
    and target = 'order:21000000-0000-4000-8000-000000004912'
) then 1 else 0 end as assert_completion_audited;
-- 조회하지 못했으면(unavailable) 상태를 바꾸지 않는다. 형식 밖 결과는 거부한다.
select pg_temp.expect_error($$select public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004912', 'done', null)$$,
  'invalid_refund_watch_result');
select pg_temp.expect_error($$select public.service_claim_virtual_account_refund_watches(6)$$, 'invalid_refund_watch_limit');

-- ---------------------------------------------------------------------------
-- 5. 계좌이체 에스크로(운영자 조회) — 가상계좌 원장이 없는 시도의 작업만, 적용 여부는 작업자 확인 뒤
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when (
  select r->>'deliveryState' = 'ready' and r->'useEscrow' = 'null'::jsonb and r->'escrowStatus' = 'null'::jsonb
  from (select public.admin_order_transfer_escrow('21000000-0000-4000-8000-000000004914') as r) x
) and public.admin_order_transfer_escrow('21000000-0000-4000-8000-000000004913') is null
then 1 else 0 end as assert_transfer_escrow_visible;
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select public.service_finish_toss_escrow_job('21000000-0000-4000-8000-000000004914', 1, 'manual_required',
  'escrow_transfer_key', null, 'IN_PROGRESS', 'carrier_unmapped');
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when (
  select r->>'deliveryState' = 'manual_required' and (r->>'useEscrow')::boolean and r->>'escrowStatus' = 'IN_PROGRESS'
    and r->>'lastErrorCode' = 'carrier_unmapped'
  from (select public.admin_order_transfer_escrow('21000000-0000-4000-8000-000000004914') as r) x
) then 1 else 0 end as assert_transfer_escrow_manual_required;
select pg_temp.as_buyer();
select pg_temp.expect_error($$select public.admin_order_transfer_escrow('21000000-0000-4000-8000-000000004914')$$,
  'operator_capability_required');
reset role;

-- ---------------------------------------------------------------------------
-- 6. 에스크로 구매자 취소 환불(20261125130000) — 토스가 송금 상태를 알리지 않은 채(NONE) 7일이 지나면 시스템이 완료로 닫는다
--    (4914 결제 시도에 에스크로 가상계좌 원장과 감시를 따로 만든다). 확인이 없거나, 원장이 에스크로가 아니거나, 송금 상태가 있거나,
--    송금 실패·기록 불일치면 지금 판정 그대로다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
insert into private.payment_attempt_virtual_accounts(attempt_id, order_id, provider_payment_key, bank_code, account_number, due_at, use_escrow)
select a.id, a.ref_id, 'esc-key-4914', '20', 'X6505636518314', now() - interval '9 days', true
from public.payment_attempts a where a.id = '31000000-0000-4000-8000-000000004914';
insert into private.virtual_account_refund_watches(attempt_id, order_id, payment_id, provider_payment_key, refunded_at)
select a.id, a.ref_id, a.payment_id, 'esc-key-4914', now() - interval '7 days' + interval '30 minutes'
from public.payment_attempts a where a.id = '31000000-0000-4000-8000-000000004914';
select (select count(*) from private.admin_operation_alerts) as alerts_before \gset
create function pg_temp.reset_escrow_watch(p_state text, p_failure text) returns void language sql as $$
  update private.virtual_account_refund_watches
  set state = p_state, failure_code = p_failure, failed_at = case when p_state = 'failed' then now() end,
      completed_at = null, completed_via = null, refund_status = null
  where attempt_id = '31000000-0000-4000-8000-000000004914';
$$;

-- 7일 전에는 확인이 와도 닫지 않고, 다음 조회를 환불 7일 경계에 맞춘다(하루 뒤가 아니다).
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', true) = 'pending'
then 1 else 0 end as assert_escrow_not_closed_before_seven_days;
select 1 / case when (
  select state = 'pending' and refund_status = 'NONE' and completed_via is null
    and next_check_at between now() + interval '29 minutes' and now() + interval '31 minutes'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004914'
) then 1 else 0 end as assert_next_check_aligned_to_seven_days;
-- 에스크로 확인이 없는 송금 확인 전(PENDING)도 2시간 간격이 7일 경계를 넘지 않는다.
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'PENDING') = 'pending'
then 1 else 0 end as assert_pending_rescheduled_near_boundary;
select 1 / case when (
  select next_check_at between now() + interval '29 minutes' and now() + interval '31 minutes'
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004914'
) then 1 else 0 end as assert_two_hour_check_capped_at_boundary;

-- 7일이 지난 송금 확인 전 감시: 구매자 취소 수락이 확인되면 완료로 닫고 감사 기록만 남긴다(운영 알림·시스템 상태 건수 없음).
update private.virtual_account_refund_watches set refunded_at = now() - interval '8 days', refund_status = null
where attempt_id = '31000000-0000-4000-8000-000000004914';
select 1 / case when (private.system_health_report()->'counts'->>'refundFailures')::integer = :refund_failures_before + 1
then 1 else 0 end as assert_escrow_pending_counted_until_closed;
-- 원장이 에스크로가 아니라고 기록한 결제는 확인이 와도 닫지 않는다(DB 근거).
update private.payment_attempt_virtual_accounts set use_escrow = false where attempt_id = '31000000-0000-4000-8000-000000004914';
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', true) = 'failed'
then 1 else 0 end as assert_non_escrow_ledger_not_settled;
select pg_temp.reset_escrow_watch('pending', null);
update private.payment_attempt_virtual_accounts set use_escrow = true where attempt_id = '31000000-0000-4000-8000-000000004914';
select count(*) as alerts_before from private.admin_operation_alerts \gset
-- 송금 상태 칸이 없어도(null) NONE과 같다.
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', null, true) = 'completed'
then 1 else 0 end as assert_escrow_buyer_cancel_settled;
select 1 / case when (
  select state = 'completed' and completed_via = 'escrow_buyer_cancel' and completed_at is not null and failure_code is null
  from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004914'
) and exists (
  select 1 from public.audit_log where action = 'system.order.virtual_account_refund_escrow_settled' and actor_id is null
    and target = 'order:21000000-0000-4000-8000-000000004914' and diff->>'fromState' = 'pending'
    and diff->>'basis' = 'escrow_buyer_cancel' and (diff->>'useEscrow')::boolean
) and (select count(*) from private.admin_operation_alerts) = :alerts_before
  and (private.system_health_report()->'counts'->>'refundFailures')::integer = :refund_failures_before
  -- 닫힌 감시는 다시 바꾸지 않는다.
  and public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'failed', 'FAILED', null) = 'completed'
then 1 else 0 end as assert_escrow_settlement_audited_without_alert;
-- 주문 패널은 완료 근거를 싣는다.
set local role authenticated;
select pg_temp.as_operator();
select 1 / case when (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004914'))->'refund'->>'state' = 'completed'
  and (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004914'))->'refund'->>'completedVia' = 'escrow_buyer_cancel'
  and (public.admin_order_virtual_account('21000000-0000-4000-8000-000000004912'))->'refund'->'completedVia' = 'null'::jsonb
then 1 else 0 end as assert_panel_reports_completion_basis;
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);

-- 완료 근거는 완료 상태에만 붙는다.
select pg_temp.expect_error($$update private.virtual_account_refund_watches set state = 'pending', completed_at = null
  where attempt_id = '31000000-0000-4000-8000-000000004914'$$, 'virtual_account_refund_watches_completed_via');

-- 송금 상태가 있으면(토스가 송금을 추적한다) 확인이 와도 지금처럼 7일 지연으로 올린다.
select pg_temp.reset_escrow_watch('pending', null);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'PENDING', true) = 'failed'
then 1 else 0 end as assert_tracked_escrow_refund_still_overdue;
select 1 / case when (select failure_code = 'refund_overdue' from private.virtual_account_refund_watches where attempt_id = '31000000-0000-4000-8000-000000004914')
  and exists (select 1 from private.admin_operation_alerts where event_key = 'virtual_account_refund_failed:' || '31000000-0000-4000-8000-000000004914')
then 1 else 0 end as assert_tracked_escrow_refund_alerted;
-- 이미 지연으로 오른 감시도 송금 상태 NONE과 구매자 취소 확인이 오면 닫는다.
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', true) = 'completed'
then 1 else 0 end as assert_overdue_escrow_refund_settled;
select 1 / case when exists (select 1 from public.audit_log where action = 'system.order.virtual_account_refund_escrow_settled'
    and target = 'order:21000000-0000-4000-8000-000000004914' and diff->>'fromState' = 'failed' and diff->>'before' = 'refund_overdue')
then 1 else 0 end as assert_overdue_escrow_settlement_audited;

-- 송금 실패·기록 불일치로 오른 감시는 닫지 않고 처음 사유를 지킨다.
select pg_temp.reset_escrow_watch('failed', 'refund_failed');
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', true) = 'failed'
then 1 else 0 end as assert_failed_escrow_refund_not_settled;
select 1 / case when (select failure_code = 'refund_failed' and completed_via is null from private.virtual_account_refund_watches
    where attempt_id = '31000000-0000-4000-8000-000000004914')
then 1 else 0 end as assert_failed_escrow_refund_keeps_reason;
select pg_temp.reset_escrow_watch('failed', 'payment_mismatch');
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', true) = 'failed'
then 1 else 0 end as assert_mismatch_escrow_refund_not_settled;
select 1 / case when (select failure_code = 'payment_mismatch' and completed_via is null from private.virtual_account_refund_watches
    where attempt_id = '31000000-0000-4000-8000-000000004914')
then 1 else 0 end as assert_mismatch_escrow_refund_keeps_reason;
-- 결제사 결과가 실패·불일치면 확인이 함께 와도 닫지 않는다.
select pg_temp.reset_escrow_watch('pending', null);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'mismatch', 'NONE', true) = 'failed'
then 1 else 0 end as assert_mismatch_outcome_not_settled;
select pg_temp.reset_escrow_watch('pending', null);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'failed', 'NONE', true) = 'failed'
then 1 else 0 end as assert_failed_outcome_not_settled;

-- 확인이 없으면(false·null, 예전 3인자 호출 포함) 지금처럼 7일 지연이다.
select pg_temp.reset_escrow_watch('pending', null);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE', false) = 'failed'
then 1 else 0 end as assert_unconfirmed_escrow_refund_overdue;
select pg_temp.reset_escrow_watch('pending', null);
select 1 / case when public.service_record_virtual_account_refund_watch('31000000-0000-4000-8000-000000004914', 'pending', 'NONE') = 'failed'
then 1 else 0 end as assert_legacy_call_still_overdue;

rollback;
