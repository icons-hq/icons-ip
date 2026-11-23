\set ON_ERROR_STOP on

-- 토스 에스크로 키 분리 뒤처리·계좌이체 에스크로 부분 취소 차단 — 20261125105000_toss_escrow_key_and_transfer_partial_cancel.sql
-- 고정하는 것: 에스크로 키가 없을 때 처리할 작업 수(서비스 전용), 계좌이체는 에스크로가 아님이 확인되기 전까지 부분 취소·부분 반품·
-- 반품배송비 차감(결제사 부분 취소)을 받지 않음, 카드 결제는 그대로, 입금 직전 취소 경합의 DB 전제(입금 승인이 열린 취소 요청을
-- 처리 중으로 승인 — 앱이 같은 실행에서 환불을 잇는다), 실행 권한 봉인.

begin;

select 1 / case when
  has_function_privilege('service_role', 'public.service_count_toss_escrow_jobs_due()', 'execute')
  and not has_function_privilege('authenticated', 'public.service_count_toss_escrow_jobs_due()', 'execute')
  and not has_function_privilege('anon', 'public.service_count_toss_escrow_jobs_due()', 'execute')
  and not has_function_privilege('service_role', 'private.toss_transfer_confirmed_non_escrow(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.toss_transfer_confirmed_non_escrow(uuid)', 'execute')
  and to_regprocedure('private.escrow_key_patch(regprocedure,jsonb)') is null
then 1 else 0 end as assert_escrow_key_function_acl;

-- 세 판정 모두 계좌이체를 같은 규칙으로 본다(반품배송비 차감은 클레임 픽스처가 무거워 정의로 고정한다).
select 1 / case when (
  select bool_and(pg_get_functiondef(f::regprocedure) like '%e.payment_method = ''계좌이체'' and not private.toss_transfer_confirmed_non_escrow(a.id)%')
  from unnest(array['private.order_partial_cancellation_blockers(uuid)', 'private.order_partial_return_order_blocker(uuid)',
    'private.return_fee_deduction_plan(uuid)']) as f
) then 1 else 0 end as assert_transfer_rule_in_all_partial_paths;

-- ---------------------------------------------------------------------------
-- 고정 데이터 — 4931: 계좌이체 승인 · 4932: 카드 승인 · 4933: 가상계좌 입금 대기 + 고객 취소
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000004931', 'authenticated', 'authenticated', 'escrow-key@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values ('00000000-0000-4000-8000-000000004931', 'escrow-key@example.test', 'escrow_key', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;
insert into public.verticals (key, label, color) values ('escrow-key', '에스크로 키', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('escrow-key-ip', '에스크로 키 IP', 'escrow-key')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('escrow-key-good', 'escrow-key-ip', '에스크로 키 굿즈', 14000, 'ok', 20)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key, calculation_version, address)
select ('22000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004931', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('12000000-0000-4000-8000-00000000' || n)::uuid, 1,
  '{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb
from unnest(array['4931', '4932', '4933']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'escrow-key-good', 2, 14000, '에스크로 키 굿즈', 'escrow-key-ip',
  (select id from public.goods_variants where good_id = 'escrow-key-good' and is_default)
from public.orders o where o.id::text like '22000000-0000-4000-8000-0000000049%';
update public.goods_variants set stock_qty = stock_qty - 6 where good_id = 'escrow-key-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('32000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004931', 'order',
  ('22000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:escrow-key:' || n,
  'O32000000000040008000' || lpad(n, 11, '0'), 'P32000000000040008000' || lpad(n, 11, '0'),
  ('42000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4931', '4932', '4933']) as n;

select 1 / case when public.finalize_goods_payment_attempt(
    '32000000-0000-4000-8000-000000004931', '42000000-0000-4000-8000-000000004931', 'approved',
    'tr-key-4931', 'TRTX4931', null, 'DONE', '계좌이체', '계좌이체', now()) = 'approved'
  and public.finalize_goods_payment_attempt(
    '32000000-0000-4000-8000-000000004932', '42000000-0000-4000-8000-000000004932', 'approved',
    'card-key-4932', 'CARDTX4932', null, 'DONE', '카드', '4330****', now()) = 'approved'
then 1 else 0 end as assert_transfer_and_card_approved;

-- ---------------------------------------------------------------------------
-- 1. 에스크로 키가 없을 때 처리할 작업 수 — 계좌이체 승인이 만든 작업(작업자가 에스크로 여부를 확인하기 전)
-- ---------------------------------------------------------------------------
select public.service_count_toss_escrow_jobs_due() as due_before \gset
select 1 / case when :due_before >= 1 and exists (
  select 1 from private.toss_escrow_deliveries where order_id = '22000000-0000-4000-8000-000000004931' and state in ('ready', 'waiting')
) then 1 else 0 end as assert_due_jobs_counted;
update private.toss_escrow_deliveries set next_attempt_at = now() + interval '1 hour' where order_id = '22000000-0000-4000-8000-000000004931';
select 1 / case when public.service_count_toss_escrow_jobs_due() = :due_before - 1 then 1 else 0 end as assert_future_jobs_not_counted;

-- ---------------------------------------------------------------------------
-- 2. 계좌이체는 에스크로가 아님이 확인되기 전까지 결제사 부분 취소를 받지 않는다. 카드는 그대로.
-- ---------------------------------------------------------------------------
select 1 / case when 'partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('22000000-0000-4000-8000-000000004931'))
  and private.order_partial_return_order_blocker('22000000-0000-4000-8000-000000004931') = 'unsupported_payment'
  and not private.toss_transfer_confirmed_non_escrow('32000000-0000-4000-8000-000000004931')
then 1 else 0 end as assert_unconfirmed_transfer_blocked;
select 1 / case when not ('partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('22000000-0000-4000-8000-000000004932')))
  and private.order_partial_return_order_blocker('22000000-0000-4000-8000-000000004932') is distinct from 'unsupported_payment'
then 1 else 0 end as assert_card_unchanged;

-- 에스크로 결제로 확인되면(거래 키가 남는다) 계속 막는다.
select public.service_finish_toss_escrow_job('22000000-0000-4000-8000-000000004931', 1, 'status_only', 'escrow_transfer_key', null, 'IN_PROGRESS', null);
select 1 / case when 'partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('22000000-0000-4000-8000-000000004931'))
  and not private.toss_transfer_confirmed_non_escrow('32000000-0000-4000-8000-000000004931')
then 1 else 0 end as assert_escrow_transfer_blocked;

-- 작업자가 결제 조회로 에스크로가 아님을 확인하면(거래 키 없이 건너뜀) 부분 취소를 연다.
update private.toss_escrow_deliveries set escrow_key = null, escrow_status = null where order_id = '22000000-0000-4000-8000-000000004931';
select public.service_finish_toss_escrow_job('22000000-0000-4000-8000-000000004931', 1, 'skipped', null, null, null, null);
select 1 / case when private.toss_transfer_confirmed_non_escrow('32000000-0000-4000-8000-000000004931')
  and not ('partial_cancel_unsupported' = any(private.order_partial_cancellation_blockers('22000000-0000-4000-8000-000000004931')))
  and private.order_partial_return_order_blocker('22000000-0000-4000-8000-000000004931') is distinct from 'unsupported_payment'
then 1 else 0 end as assert_confirmed_non_escrow_transfer_opens;

-- ---------------------------------------------------------------------------
-- 3. 입금 직전 취소 경합 — 입금 대기 주문에 고객 취소가 접수된 뒤(반납 전) 입금 승인이 먼저 닫히면, 열린 취소 요청은 처리 중으로
--    승인된다. 앱(cancellation-auto)이 반납 결과 approved를 보고 같은 실행에서 이 요청의 환불을 잇는다.
-- ---------------------------------------------------------------------------
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '32000000-0000-4000-8000-000000004933', '42000000-0000-4000-8000-000000004933', 'va-key-4933',
  '20', 'X6505636518333', now() + interval '24 hours', false) = 'awaiting_deposit'
then 1 else 0 end as assert_awaiting_deposit_entered;
select public.request_order_claim('22000000-0000-4000-8000-000000004933', '00000000-0000-4000-8000-000000004931',
  'cancel', '사용자 주문 취소', 'change_of_mind', null, null, null) as cancel_outcome \gset
select 1 / case when :'cancel_outcome' = 'requested' and (
  select status = 'requested' from public.order_cancellation_requests where order_id = '22000000-0000-4000-8000-000000004933'
) then 1 else 0 end as assert_cancel_waits_for_release;
select (public.claim_goods_payment_reconciliation('32000000-0000-4000-8000-000000004933', '52000000-0000-4000-8000-000000004933',
  'escrow-key-race-4933'))->>'claim_status' = 'claimed' as claimed_4933 \gset
select 1 / case when public.finalize_goods_payment_reconciliation('32000000-0000-4000-8000-000000004933',
  '52000000-0000-4000-8000-000000004933', 'approved', 'va-key-4933', 'VATX4933', null, 'DONE', '가상계좌', '가상계좌', now()) = 'approved'
then 1 else 0 end as assert_deposit_won_the_race;
-- 결제는 승인되고(입금 확인), 열린 취소는 결제사 환불을 기다리는 처리 중이다 — 주문은 환불·취소 확정 전이라 결제완료로 넘어가지 않는다.
select 1 / case when (
  select r.status = 'processing' and r.claim_type = 'cancel' and a.state = 'approved' and o.status = 'pending'
  from public.order_cancellation_requests r join public.orders o on o.id = r.order_id
  join public.payment_attempts a on a.ref_id = o.id and a.purpose = 'order'
  where r.order_id = '22000000-0000-4000-8000-000000004933'
) then 1 else 0 end as assert_cancel_approved_for_refund;

rollback;
