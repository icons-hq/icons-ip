\set ON_ERROR_STOP on

-- 가상계좌 환불 계좌 요청 알림·운영자 대신 입력(ADR-0049 결정 5 보강, 2026-11-25) — 20261126101000_virtual_account_refund_account_notice.sql
-- 고정하는 것: 계좌 사유 결제확인필요 전이에서 구매자 앱 알림(같은 사유 한 번·가상계좌만), 메일 판정 서비스 함수, 메일 템플릿,
-- 운영자 대신 입력(같은 판정·감사 기록·재생·충돌·권한) 뒤 기존 재시도 시작, 실행 권한 봉인.

begin;

-- ---------------------------------------------------------------------------
-- 실행 권한(선언적)
-- ---------------------------------------------------------------------------
select 1 / case when
  has_function_privilege('service_role', 'public.service_virtual_account_refund_account_notice(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_virtual_account_refund_account_notice(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.service_virtual_account_refund_account_notice(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_order_claim_refund_account(uuid,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_order_claim_refund_account(uuid,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_set_order_claim_refund_account(uuid,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'private.virtual_account_refund_account_notice(public.order_cancellation_requests)', 'execute')
  and not has_function_privilege('authenticated', 'private.virtual_account_refund_account_notice(public.order_cancellation_requests)', 'execute')
  and not has_function_privilege('service_role', 'private.notify_virtual_account_refund_account_needed()', 'execute')
  and to_regprocedure('private.va_notice_patch(regprocedure,jsonb)') is null
  and (select count(*) from private.operator_rpc_contracts
    where signature = 'public.admin_set_order_claim_refund_account(uuid,uuid,text,text,text,text)'
      and capability = 'sales.manage' and guard_kind = 'write') = 1
  and pg_get_functiondef('public.claim_email_delivery(text,text,text,text,interval)'::regprocedure) like '%''order_refund_account''%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'email_deliveries_template_check')) like '%order_refund_account%'
then 1 else 0 end as assert_notice_function_acl;

-- ---------------------------------------------------------------------------
-- 고정 데이터
--   4951: 가상계좌 입금(결제 화면 환불 계좌 없음) → 취소 → 계좌 없음으로 결제확인필요
--   4952: 카드 결제 취소(가상계좌 아님)        4953: 가상계좌 입금 → 반품, 결제사가 계좌를 거절
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
  ('00000000-0000-4000-8000-000000004951', 'authenticated', 'authenticated', 'van-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000004959', 'authenticated', 'authenticated', 'van-operator@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000004951', 'van-buyer@example.test', 'van_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000004959', 'van-operator@example.test', 'van_operator', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000004959';
insert into private.operator_memberships(profile_id, manager_role) values ('00000000-0000-4000-8000-000000004959', 'primary')
on conflict do nothing;
update private.operator_access_state set configured = true where id;

create function pg_temp.as_buyer() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004951', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000004951')::text, true);
end $$;
create function pg_temp.as_operator() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004959', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000004959')::text, true);
end $$;

insert into public.verticals (key, label, color) values ('va-notice', '가상계좌 알림', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('va-notice-ip', '가상계좌 알림 IP', 'va-notice')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('va-notice-good', 'va-notice-ip', '가상계좌 알림 상품', 28000, 'ok', 10)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key, address)
select ('25000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004951', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('15000000-0000-4000-8000-00000000' || n)::uuid,
  '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb
from unnest(array['4951', '4952', '4953']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-notice-good', 1, 28000, '가상계좌 알림 상품', 'va-notice-ip',
  (select id from public.goods_variants where good_id = 'va-notice-good' and is_default)
from public.orders o where o.id::text like '25000000-0000-4000-8000-0000000049%';
update public.goods_variants set stock_qty = stock_qty - 3 where good_id = 'va-notice-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('35000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004951', 'order',
  ('25000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:van:' || n,
  'O35000000000040008000' || lpad(n, 11, '0'), 'P35000000000040008000' || lpad(n, 11, '0'),
  ('45000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4951', '4952', '4953']) as n;

select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '35000000-0000-4000-8000-000000004951', '45000000-0000-4000-8000-000000004951', 'van-key-4951',
  '20', 'X6505636518351', now() + interval '24 hours', false) = 'awaiting_deposit'
  and public.finalize_goods_payment_awaiting_deposit(
  '35000000-0000-4000-8000-000000004953', '45000000-0000-4000-8000-000000004953', 'van-key-4953',
  '20', 'X6505636518353', now() + interval '24 hours', false, '88', '110123456789', '김토스') = 'awaiting_deposit'
then 1 else 0 end as assert_virtual_accounts_issued;
select (public.claim_goods_payment_reconciliation('35000000-0000-4000-8000-000000004951', '55000000-0000-4000-8000-000000004951', 'van-smoke-notice-4951'))->>'claim_status' = 'claimed' as claimed_4951 \gset
select (public.claim_goods_payment_reconciliation('35000000-0000-4000-8000-000000004953', '55000000-0000-4000-8000-000000004953', 'van-smoke-notice-4953'))->>'claim_status' = 'claimed' as claimed_4953 \gset
select 1 / case when public.finalize_goods_payment_reconciliation('35000000-0000-4000-8000-000000004951', '55000000-0000-4000-8000-000000004951', 'approved',
    'van-key-4951', 'VANTX4951', null, 'DONE', '가상계좌', '가상계좌', now()) = 'approved'
  and public.finalize_goods_payment_reconciliation('35000000-0000-4000-8000-000000004953', '55000000-0000-4000-8000-000000004953', 'approved',
    'van-key-4953', 'VANTX4953', null, 'DONE', '가상계좌', '가상계좌', now()) = 'approved'
  and public.finalize_goods_payment_attempt(
    '35000000-0000-4000-8000-000000004952', '45000000-0000-4000-8000-000000004952', 'approved',
    'card-key-4952', 'CARDTX4952', null, 'DONE', '카드', '4330****', now()) = 'approved'
then 1 else 0 end as assert_payments_approved;

-- 4951·4952 취소(자동 승인 → 처리 중), 4953 반품(결제사가 결제 화면 계좌를 거절해 결제확인필요 직전 단계)
select 1 / case when public.request_order_claim('25000000-0000-4000-8000-000000004951', '00000000-0000-4000-8000-000000004951',
    'cancel', '사용자 주문 취소', 'change_of_mind', null, null, null) = 'auto_approved'
  and public.request_order_claim('25000000-0000-4000-8000-000000004952', '00000000-0000-4000-8000-000000004951',
    'cancel', '사용자 주문 취소', 'change_of_mind', null, null, null) = 'auto_approved'
then 1 else 0 end as assert_cancel_claims_auto_approved;
select id as claim_4951 from public.order_cancellation_requests where order_id = '25000000-0000-4000-8000-000000004951' \gset
select id as claim_4952 from public.order_cancellation_requests where order_id = '25000000-0000-4000-8000-000000004952' \gset
-- 반품은 운영자 환불 단계에서 결과 불명으로 먼저 멈춰 있다(다른 사유 — 알리지 않는다).
insert into public.order_cancellation_requests (id, order_id, requested_by, reason, reason_type, claim_type, stage, status, requested_at, last_error_code)
values ('65000000-0000-4000-8000-000000004953', '25000000-0000-4000-8000-000000004953', '00000000-0000-4000-8000-000000004951',
  '단순 변심 반품', 'change_of_mind', 'return', 'needs_review', private.order_claim_status_for_stage('needs_review'), now(),
  'provider_unavailable');
insert into public.order_cancellation_claims(order_id, requested_by, previous_status)
values ('25000000-0000-4000-8000-000000004953', '00000000-0000-4000-8000-000000004951', 'paid'::public.order_status);

-- 처리 중에는 알림 대상이 아니다.
select 1 / case when public.service_virtual_account_refund_account_notice(:'claim_4951') is null
  and not exists (select 1 from public.notifications where source_id = :'claim_4951' and dedupe_key like 'claim:refund_account_%')
then 1 else 0 end as assert_no_notice_while_processing;

-- ---------------------------------------------------------------------------
-- 1. 계좌 사유 결제확인필요 → 구매자 앱 알림(같은 트랜잭션), 메일 판정
-- ---------------------------------------------------------------------------
select public.mark_order_cancellation_needs_review(:'claim_4951', null, 'provider_refund_account_required');
select public.mark_order_cancellation_needs_review(:'claim_4952', null, 'provider_refund_account_required');
select 1 / case when (
  select count(*) = 1 and bool_and(n.user_id = '00000000-0000-4000-8000-000000004951' and n.type = 'claim_updated'
    and n.title = '환불받을 계좌를 입력해 주세요' and n.link_path = '/orders/25000000-0000-4000-8000-000000004951'
    and n.source_type = 'order_claim' and n.dedupe_key = 'claim:refund_account_required:' || :'claim_4951')
  from public.notifications n where n.source_id = :'claim_4951' and n.dedupe_key like 'claim:refund_account_%'
) and (
  select r->>'code' = 'required' and r->>'claimType' = 'cancel' and r->>'orderId' = '25000000-0000-4000-8000-000000004951'
    and r->>'userId' = '00000000-0000-4000-8000-000000004951'
  from (select public.service_virtual_account_refund_account_notice(:'claim_4951') as r) x
) then 1 else 0 end as assert_virtual_account_notice_sent;
-- 카드 결제는 가상계좌 환불이 아니라 알리지 않는다.
select 1 / case when public.service_virtual_account_refund_account_notice(:'claim_4952') is null
  and not exists (select 1 from public.notifications where source_id = :'claim_4952' and dedupe_key like 'claim:refund_account_%')
then 1 else 0 end as assert_card_not_noticed;

-- 같은 사유로 다시 멈춰도(운영자 재시도 → 처리 중 → 결제확인필요) 다시 알리지 않는다.
update public.order_cancellation_requests set status = 'processing', updated_at = now() where id = :'claim_4951';
select public.mark_order_cancellation_needs_review(:'claim_4951', null, 'provider_refund_account_required');
select 1 / case when (select count(*) = 1 from public.notifications where source_id = :'claim_4951' and dedupe_key like 'claim:refund_account_%')
then 1 else 0 end as assert_same_cause_noticed_once;

-- 반품이 다시 확인한 결과 결제사 거절로 멈추면 '다시 확인' 알림(사유가 바뀌는 전이 — 부분 반품의 상태 동기화처럼 단계·사유만 바꾼다).
select 1 / case when not exists (select 1 from public.notifications where source_id = '65000000-0000-4000-8000-000000004953'
  and dedupe_key like 'claim:refund_account_%') then 1 else 0 end as assert_other_review_code_not_noticed;
update public.order_cancellation_requests set last_error_code = 'provider_refund_account_invalid', updated_at = now()
where id = '65000000-0000-4000-8000-000000004953';
select 1 / case when exists (
  select 1 from public.notifications n where n.source_id = '65000000-0000-4000-8000-000000004953'
    and n.dedupe_key = 'claim:refund_account_invalid:65000000-0000-4000-8000-000000004953' and n.title = '환불 계좌를 다시 확인해 주세요'
) and public.service_virtual_account_refund_account_notice('65000000-0000-4000-8000-000000004953')->>'code' = 'invalid'
then 1 else 0 end as assert_return_invalid_noticed;

-- ---------------------------------------------------------------------------
-- 2. 운영자 대신 입력 — 구매자 입력과 같은 판정·저장소, 감사 기록(누가·사유), 재생·충돌
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_buyer();
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b0',
  '신한은행', '110987654321', '김합성', '고객 전화로 계좌 확인')$$, :'claim_4951'), 'operator_capability');
select pg_temp.as_operator();
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b1',
  '신한은행', '110987654321', '김합성', '고객 전화로 계좌 확인')$$, :'claim_4952'), 'refund_account_not_virtual_account');
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b2',
  '농협', '110987654321', '김합성', '고객 전화로 계좌 확인')$$, :'claim_4951'), 'invalid_virtual_account_refund_account');
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b3',
  '신한은행', '110987654321', '김합성', ' ')$$, :'claim_4951'), 'invalid_refund_account_reason');
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b4',
  '신한은행', '1109', '김합성', '고객 전화로 계좌 확인')$$, :'claim_4951'), 'invalid_claim_refund_account');
select 1 / case when (
  select r->>'state' = 'saved' and not (r->>'replayed')::boolean and r->>'claimType' = 'cancel'
    and r->>'orderId' = '25000000-0000-4000-8000-000000004951'
  from (select public.admin_set_order_claim_refund_account(:'claim_4951', '75000000-0000-4000-8000-000000004951',
    '신한은행', '110-987-654321', '김합성', '11/26 고객 전화로 계좌 확인') as r) x
) then 1 else 0 end as assert_operator_saved;
-- 같은 작업 번호·같은 내용은 같은 결과(다시 저장하지 않는다), 다른 내용은 충돌.
select 1 / case when (public.admin_set_order_claim_refund_account(:'claim_4951', '75000000-0000-4000-8000-000000004951',
    '신한은행', '110-987-654321', '김합성', '11/26 고객 전화로 계좌 확인'))->>'replayed' = 'true'
then 1 else 0 end as assert_operator_replay;
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-000000004951',
  '우리은행', '1002123456789', '김합성', '11/26 고객 전화로 계좌 확인')$$, :'claim_4951'), 'refund_account_request_conflict');
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when (
  select a.bank_name = '신한은행' and a.account_number = '110-987-654321' and a.account_holder = '김합성'
    and a.masked_account like '신한은행 %4321' and a.purged_at is null
  from private.claim_refund_accounts a where a.claim_id = :'claim_4951'
) and (
  select count(*) = 1 and bool_and(l.actor_id = '00000000-0000-4000-8000-000000004959'
    and l.diff->>'reason' = '11/26 고객 전화로 계좌 확인' and l.diff->>'claimId' = :'claim_4951'
    and (l.diff->>'replaced')::boolean = false and l.diff->>'lastErrorCode' = 'provider_refund_account_required'
    -- 계좌 원문은 감사 기록에 남기지 않는다.
    and l.diff::text not like '%987654321%' and l.diff::text not like '%김합성%')
  from public.audit_log l where l.action = 'admin.order.claim_refund_account_entered' and l.target = 'order:25000000-0000-4000-8000-000000004951'
) then 1 else 0 end as assert_operator_entry_audited;

-- 저장 뒤 동작은 기존 재시도 규칙 그대로 — 취소는 시스템이 처리 중으로 되돌린다(이 계좌로 환불), 반품은 운영자.
select public.service_begin_virtual_account_refund_retry(:'claim_4951') as retry_4951 \gset
-- 재시도가 바꾼 상태는 다음 문장에서 본다(한 문장 안의 하위 질의는 문장 시작 때의 스냅샷을 본다).
select 1 / case when :'retry_4951' = 'started'
  and (select status = 'processing' from public.order_cancellation_requests where id = :'claim_4951')
  and public.service_virtual_account_refund_account_notice(:'claim_4951') is null
then 1 else 0 end as assert_cancel_retry_started_after_operator_entry;

set local role authenticated;
select pg_temp.as_operator();
select 1 / case when (public.admin_set_order_claim_refund_account('65000000-0000-4000-8000-000000004953', '75000000-0000-4000-8000-000000004953',
    'KB국민은행', '123456789012', '김합성', '고객 1:1 문의로 계좌 확인'))->>'claimType' = 'return'
then 1 else 0 end as assert_return_operator_saved;
-- 결제사 환불이 진행 중이면(처리 중) 바꾸지 않는다.
select pg_temp.expect_error(format($$select public.admin_set_order_claim_refund_account(%L, '75000000-0000-4000-8000-0000000049b5',
  '우리은행', '1002123456789', '김합성', '고객 전화로 계좌 확인')$$, :'claim_4951'), 'refund_account_refund_in_progress');
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select 1 / case when public.service_begin_virtual_account_refund_retry('65000000-0000-4000-8000-000000004953') = 'operator_required'
then 1 else 0 end as assert_return_waits_for_operator;

rollback;
