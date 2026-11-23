\set ON_ERROR_STOP on

-- 토스 가상계좌 입금 대기(ADR-0049) — 20261125090100_toss_virtual_account_awaiting_deposit.sql
-- 고정하는 것: 전용 finalizer의 진입 조건·거부, 정리 함수가 입금 대기 주문을 취소·대체하지 않음, 재정합으로 입금(승인)·
-- 반납(declined)이 닫히고 만료 정리가 재고를 되돌림, 구매자·운영자 계좌 조회, 입금 오류 되돌림 보류, 자동 재확인 후보,
-- 환불 계좌 조회·파기, 실행 권한 봉인.

begin;

-- ---------------------------------------------------------------------------
-- 실행 권한(선언적 — CI 이미지의 권한 거부 런타임 호출은 피한다)
-- ---------------------------------------------------------------------------
select 1 / case when
  has_function_privilege('service_role', 'public.finalize_goods_payment_awaiting_deposit(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_goods_payment_awaiting_deposit(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.finalize_goods_payment_awaiting_deposit(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_goods_payment_reconciliation_awaiting_deposit(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_goods_payment_reconciliation_awaiting_deposit(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_order_virtual_account(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_order_virtual_account(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_order_virtual_account(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_order_virtual_account(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_order_virtual_account(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_order_virtual_account(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_flag_goods_deposit_reversal(uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_flag_goods_deposit_reversal(uuid,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.service_goods_attempt_payment_key_hint(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_goods_attempt_payment_key_hint(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.service_goods_virtual_account_refund_account(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_goods_virtual_account_refund_account(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'private.finalize_goods_payment_awaiting_deposit_core(uuid,uuid,text,text,text,timestamptz,boolean,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'private.purge_virtual_account_refund_accounts()', 'execute')
  and has_function_privilege('service_role', 'public.service_claim_toss_escrow_jobs(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_claim_toss_escrow_jobs(integer)', 'execute')
  and has_function_privilege('service_role', 'public.service_finish_toss_escrow_job(uuid,integer,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_finish_toss_escrow_job(uuid,integer,text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'private.refresh_toss_escrow_delivery(uuid)', 'execute')
then 1 else 0 end as assert_virtual_account_function_acl;

select 1 / case when exists (
  select 1 from cron.job where jobname = 'purge-virtual-account-refund-accounts' and schedule = '20 19 * * *'
) then 1 else 0 end as assert_refund_account_purge_scheduled;

-- ---------------------------------------------------------------------------
-- 고정 데이터
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000004901', 'authenticated', 'authenticated', 'va-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000004902', 'authenticated', 'authenticated', 'va-other@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000004901', 'va-buyer@example.test', 'va_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000004902', 'va-other@example.test', 'va_other', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set suspended_at = null, suspension_reason = null;

insert into public.verticals (key, label, color) values ('va-awaiting', '가상계좌 입금 대기', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('va-awaiting-ip', '가상계좌 IP', 'va-awaiting')
on conflict (id) do update set title = excluded.title;
insert into public.goods (id, ip_id, name, price, stock, stock_qty)
values ('va-awaiting-good', 'va-awaiting-ip', '가상계좌 굿즈', 28000, 'ok', 10)
on conflict (id) do update set price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

-- 주문 6건(모두 구매자 4901, 굿즈 1개 28,000원 + 배송비 3,000원 = 31,000원)
--   4901: 입금 대기 진입·재정합·승인·되돌림   4902: 입금 대기 진입 → 반납(declined) → 만료 정리
--   4903: 입금 기한 72시간 초과 거부           4904: 취소 요청 중 거부
--   4905: 계정당 열린 입금 대기 상한(3번째)   4906: 4905의 상한 채우기용
insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004901', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('10000000-0000-4000-8000-00000000' || n)::uuid
from unnest(array['4901', '4902', '4903', '4904', '4905', '4906']) as n;

insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-awaiting-good', 1, 28000, '가상계좌 굿즈', 'va-awaiting-ip',
  (select id from public.goods_variants where good_id = 'va-awaiting-good' and is_default)
from public.orders o where o.id::text like '20000000-0000-4000-8000-0000000049%';

-- 주문 생성처럼 재고를 하나씩 잡아 둔다(만료 정리가 되돌리는지 본다).
update public.goods_variants set stock_qty = stock_qty - 6 where good_id = 'va-awaiting-good' and is_default;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('30000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004901', 'order',
  ('20000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:va:' || n,
  'O30000000000040008000' || lpad(n, 11, '0'), 'P30000000000040008000' || lpad(n, 11, '0'),
  ('40000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4901', '4902', '4903', '4904', '4905', '4906']) as n;

-- ---------------------------------------------------------------------------
-- 1. 입금 대기 진입
-- ---------------------------------------------------------------------------
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004901', '40000000-0000-4000-8000-000000004901', 'va-key-4901',
  '20', 'X6505636518308', now() + interval '24 hours', true, '88', '110123456789', '김토스'
) = 'awaiting_deposit' then 1 else 0 end as assert_awaiting_entered;

select 1 / case when (
  select a.state = 'awaiting_deposit' and a.claim_token is null and a.claim_expires_at is null
    and a.expires_at > now() + interval '23 hours'
    and o.status = 'pending' and o.expires_at = a.expires_at
  from public.payment_attempts a join public.orders o on o.id = a.ref_id
  where a.id = '30000000-0000-4000-8000-000000004901'
) then 1 else 0 end as assert_order_held_until_due;

select 1 / case when (
  select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000004901' and type = 'order_virtual_account_issued'
    and dedupe_key = 'order:virtual_account_issued:20000000-0000-4000-8000-000000004901'
) and (
  select count(*) = 1 from private.payment_provider_evidence
  where payment_attempt_id = '30000000-0000-4000-8000-000000004901' and evidence_kind = 'confirm_awaiting_deposit'
    and payment_method = '가상계좌' and provider_payment_key = 'va-key-4901'
) then 1 else 0 end as assert_notification_and_evidence;

-- 이미 입금 대기면 그 상태를 그대로 돌려준다(중복 콜백·재시도).
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004901', '40000000-0000-4000-8000-000000004901', 'va-key-4901',
  '20', 'X6505636518308', now() + interval '24 hours', true
) = 'awaiting_deposit' then 1 else 0 end as assert_awaiting_replay;

-- ---------------------------------------------------------------------------
-- 2. 거부 → needs_review (앱이 계좌를 반납한다)
-- ---------------------------------------------------------------------------
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004903', '40000000-0000-4000-8000-000000004903', 'va-key-4903',
  '20', 'X0000000004903', now() + interval '80 hours', false
) = 'needs_review' then 1 else 0 end as assert_window_out_of_range_refused;

insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, claim_type, stage, requested_at)
values ('20000000-0000-4000-8000-000000004904', '00000000-0000-4000-8000-000000004901', '변심', 'change_of_mind', 'cancel', 'requested', now());
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004904', '40000000-0000-4000-8000-000000004904', 'va-key-4904',
  '20', 'X0000000004904', now() + interval '24 hours', false
) = 'needs_review' then 1 else 0 end as assert_cancel_requested_refused;

select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004906', '40000000-0000-4000-8000-000000004906', 'va-key-4906',
  '20', 'X0000000004906', now() + interval '24 hours', false
) = 'awaiting_deposit' then 1 else 0 end as assert_second_open_deposit_allowed;
select 1 / case when public.finalize_goods_payment_awaiting_deposit(
  '30000000-0000-4000-8000-000000004902', '40000000-0000-4000-8000-000000004902', 'va-key-4902',
  '04', 'X0000000004902', now() + interval '24 hours', false
) = 'needs_review' then 1 else 0 end as assert_third_open_deposit_refused;

select 1 / case when (
  select count(*) = 3 from private.payment_provider_evidence
  where payment_attempt_id in ('30000000-0000-4000-8000-000000004903', '30000000-0000-4000-8000-000000004904', '30000000-0000-4000-8000-000000004902')
    and evidence_kind = 'confirm_needs_review' and result_code like 'WAITING_FOR_DEPOSIT_%'
) then 1 else 0 end as assert_refusals_recorded;

-- 상한 시험을 위해 needs_review로 간 4902를 다시 잡아 반납 경로 시험에 쓴다: 4906을 먼저 반납해 자리를 비운다.
-- (재정합 claim은 needs_review·awaiting_deposit을 confirming으로 잡는다.)
select (public.claim_goods_payment_reconciliation('30000000-0000-4000-8000-000000004906', '50000000-0000-4000-8000-000000004906', 'va-smoke-release-4906'))->>'claim_status' = 'claimed'
  as claimed_4906 \gset
select 1 / case when :'claimed_4906' then 1 else 0 end as assert_awaiting_is_reconcilable;
select 1 / case when public.finalize_goods_payment_reconciliation(
  '30000000-0000-4000-8000-000000004906', '50000000-0000-4000-8000-000000004906', 'declined',
  'va-key-4906', null, null, 'CANCELED_virtual_account_released', '가상계좌', null, null
) = 'declined' then 1 else 0 end as assert_release_declines;

select (public.claim_goods_payment_reconciliation('30000000-0000-4000-8000-000000004902', '50000000-0000-4000-8000-000000004902', 'va-smoke-enter-4902'))->>'claim_status' = 'claimed'
  as claimed_4902 \gset
select 1 / case when public.finalize_goods_payment_reconciliation_awaiting_deposit(
  '30000000-0000-4000-8000-000000004902', '50000000-0000-4000-8000-000000004902', 'va-key-4902',
  '04', 'X0000000004902', now() + interval '24 hours', false
) = 'awaiting_deposit' then 1 else 0 end as assert_reconciliation_enters_awaiting;

-- ---------------------------------------------------------------------------
-- 3. 정리 함수는 입금 대기 주문을 건드리지 않는다
-- ---------------------------------------------------------------------------
do $guard$
declare rejected boolean := false;
begin
  begin
    perform public.finalize_order_cancellation_with_provider_evidence('20000000-0000-4000-8000-000000004901', '직접 취소 우회', array[]::text[]);
  exception when check_violation then rejected := sqlerrm = 'goods_payment_attempt_requires_reconciliation';
  end;
  if not rejected then raise exception 'awaiting deposit order was canceled directly'; end if;
end;
$guard$;

select 1 / case when private.close_unpaid_cart_order('20000000-0000-4000-8000-000000004901', 'superseded', 'va-smoke') = 'unresolved'
then 1 else 0 end as assert_cart_supersede_skips_awaiting;

select 1 / case when private.checkout_draft_order_payment_unresolved('20000000-0000-4000-8000-000000004901')
then 1 else 0 end as assert_draft_treats_awaiting_unresolved;

-- 입금 기한이 지났다고 가정해도 만료 정리는 입금 대기 주문을 취소하지 않는다(입금이 들어올 수 있다).
update public.orders set expires_at = now() - interval '20 minutes' where id = '20000000-0000-4000-8000-000000004901';
update public.payment_attempts set expires_at = now() - interval '20 minutes' where id = '30000000-0000-4000-8000-000000004901';
select public.expire_stale_checkouts();
select 1 / case when (select status = 'pending' from public.orders where id = '20000000-0000-4000-8000-000000004901')
then 1 else 0 end as assert_sweep_keeps_awaiting_order;

-- 기한이 지난 입금 대기는 자동 재확인 후보다(입금 기한 만료에는 웹훅이 없다).
select 1 / case when public.service_claim_payment_reconciliation_candidates(5, array['toss']) @> pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('attemptId', '30000000-0000-4000-8000-000000004901')
) then 1 else 0 end as assert_overdue_awaiting_is_auto_reconcile_candidate;

-- 기한 + 2시간이 지나도 닫히지 않으면 미종결 결제로 보인다.
update public.payment_attempts set expires_at = now() - interval '3 hours' where id = '30000000-0000-4000-8000-000000004901';
select 1 / case when exists (
  select 1 from public.payment_attempts a
  where a.id = '30000000-0000-4000-8000-000000004901'
    and a.state = 'awaiting_deposit' and a.expires_at <= now() - interval '2 hours'
) and (private.system_health_report()->'payments'->>'goods')::integer >= 1
then 1 else 0 end as assert_stuck_awaiting_is_unresolved;

-- ---------------------------------------------------------------------------
-- 4. 구매자·운영자 계좌 조회
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000004901","role":"authenticated"}', true);
set local role authenticated;
select 1 / case when (
  select public.get_my_order_virtual_account('20000000-0000-4000-8000-000000004902') ->> 'accountNumber' = 'X0000000004902'
    and public.get_my_order_virtual_account('20000000-0000-4000-8000-000000004902') ->> 'state' = 'awaiting'
) then 1 else 0 end as assert_buyer_reads_own_account;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000004902","role":"authenticated"}', true);
set local role authenticated;
select 1 / case when public.get_my_order_virtual_account('20000000-0000-4000-8000-000000004902') is null
then 1 else 0 end as assert_other_user_reads_nothing;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 5. 입금(승인) → 결제완료, 입금 오류 되돌림 → 출고 보류
-- ---------------------------------------------------------------------------
select (public.claim_goods_payment_reconciliation('30000000-0000-4000-8000-000000004901', '50000000-0000-4000-8000-000000004901', 'va-smoke-deposit-4901'))->>'claim_status' = 'claimed'
  as claimed_4901 \gset
select 1 / case when public.finalize_goods_payment_reconciliation(
  '30000000-0000-4000-8000-000000004901', '50000000-0000-4000-8000-000000004901', 'approved',
  'va-key-4901', 'VATX1', null, 'DONE', '가상계좌', '가상계좌', now()
) = 'approved' then 1 else 0 end as assert_deposit_approves;
select 1 / case when (
  select o.status = 'paid' and o.expires_at is null and p.status = 'paid' and p.payment_key = 'va-key-4901'
  from public.orders o join public.payments p on p.ref_id = o.id and p.purpose = 'order'
  where o.id = '20000000-0000-4000-8000-000000004901'
) then 1 else 0 end as assert_order_paid_after_deposit;

-- 에스크로(20261125090200): 에스크로를 고른 가상계좌가 입금 승인되면 배송 등록 작업이 생긴다. 실물 배송 건이 없는 주문은
-- 승인 즉시 직접 전달(DIRECT) 등록 대기다.
select 1 / case when (
  select job.state = 'ready' and job.delivery_method = 'DIRECT' and job.received_at is not null
  from private.toss_escrow_deliveries as job where job.order_id = '20000000-0000-4000-8000-000000004901'
) then 1 else 0 end as assert_escrow_job_created_on_approval;
select 1 / case when public.service_claim_toss_escrow_jobs(10) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'orderId', '20000000-0000-4000-8000-000000004901', 'state', 'ready', 'deliveryMethod', 'DIRECT', 'paymentKey', 'va-key-4901'))
then 1 else 0 end as assert_escrow_job_claimable;
-- (함수가 바꾼 행은 같은 문장의 하위 조회에 보이지 않으므로 기록과 확인을 나눈다.)
select 1 / case when public.service_finish_toss_escrow_job('20000000-0000-4000-8000-000000004901', 1, 'registered',
  'escrow_smoke_key', 'delivery_smoke', 'IN_PROGRESS', null) = 'recorded' then 1 else 0 end as assert_escrow_job_recorded;
select 1 / case when (select state = 'registered' and escrow_key = 'escrow_smoke_key' and toss_delivery_id = 'delivery_smoke'
    from private.toss_escrow_deliveries where order_id = '20000000-0000-4000-8000-000000004901')
then 1 else 0 end as assert_escrow_job_registered;
select 1 / case when public.service_finish_toss_escrow_job('20000000-0000-4000-8000-000000004901', 1, 'status_only',
  null, null, 'CANCEL_REQUESTED', null) = 'recorded' then 1 else 0 end as assert_escrow_status_recorded;
select 1 / case when exists (select 1 from private.order_fulfillment_holds
    where order_id = '20000000-0000-4000-8000-000000004901' and reason = 'escrow_cancel_requested' and released_at is null)
then 1 else 0 end as assert_escrow_cancel_request_holds_order;
select 1 / case when private.order_virtual_account_json('20000000-0000-4000-8000-000000004901') -> 'escrow' ->> 'escrowStatus' = 'CANCEL_REQUESTED'
then 1 else 0 end as assert_escrow_status_in_order_json;

select 1 / case when public.service_flag_goods_deposit_reversal(
  '30000000-0000-4000-8000-000000004901', 'va-key-4901', 'REVERSALTX1', 'va-smoke-reversal-0001') = 'held'
  and public.service_flag_goods_deposit_reversal(
  '30000000-0000-4000-8000-000000004901', 'va-key-4901', 'REVERSALTX1', 'va-smoke-reversal-0002') = 'already_recorded'
  and public.service_flag_goods_deposit_reversal(
  '30000000-0000-4000-8000-000000004901', 'other-key', 'REVERSALTX1', null) = 'not_applicable'
then 1 else 0 end as assert_deposit_reversal_hold;
select 1 / case when private.order_fulfillment_held('20000000-0000-4000-8000-000000004901')
then 1 else 0 end as assert_reversed_order_held;

-- 환불 계좌는 원장 결제 키가 맞을 때만 준다. 기한이 지나면 지운다.
select 1 / case when public.service_goods_virtual_account_refund_account('30000000-0000-4000-8000-000000004901', 'va-key-4901')
  = '{"bankCode":"88","accountNumber":"110123456789","holderName":"김토스"}'::jsonb
  and public.service_goods_virtual_account_refund_account('30000000-0000-4000-8000-000000004901', 'other-key') is null
then 1 else 0 end as assert_refund_account_lookup;
update private.payment_attempt_virtual_accounts set refund_account_purge_after = now() - interval '1 minute'
where attempt_id = '30000000-0000-4000-8000-000000004901';
select 1 / case when private.purge_virtual_account_refund_accounts() >= 1 then 1 else 0 end as assert_refund_account_purge_ran;
select 1 / case when public.service_goods_virtual_account_refund_account('30000000-0000-4000-8000-000000004901', 'va-key-4901') is null
then 1 else 0 end as assert_refund_account_purged;

-- ---------------------------------------------------------------------------
-- 6. 반납(declined) 뒤 만료 정리가 주문을 취소하고 재고를 되돌린다
-- ---------------------------------------------------------------------------
select (public.claim_goods_payment_reconciliation('30000000-0000-4000-8000-000000004902', '60000000-0000-4000-8000-000000004902', 'va-smoke-expire-4902'))->>'claim_status' = 'claimed'
  as reclaimed_4902 \gset
select 1 / case when public.finalize_goods_payment_reconciliation(
  '30000000-0000-4000-8000-000000004902', '60000000-0000-4000-8000-000000004902', 'declined',
  'va-key-4902', null, null, 'WAITING_FOR_DEPOSIT_expired', '가상계좌', null, null
) = 'declined' then 1 else 0 end as assert_expiry_declines;
update public.orders set expires_at = now() - interval '20 minutes' where id = '20000000-0000-4000-8000-000000004902';
select (select stock_qty from public.goods_variants where good_id = 'va-awaiting-good' and is_default) as stock_before \gset
select public.expire_stale_checkouts();
select 1 / case when (select status = 'canceled' from public.orders where id = '20000000-0000-4000-8000-000000004902')
  and (select stock_qty from public.goods_variants where good_id = 'va-awaiting-good' and is_default) = :stock_before + 1
then 1 else 0 end as assert_released_order_expires_and_restocks;

-- ---------------------------------------------------------------------------
-- 6b. 계좌이체(20261125090300): 계좌이체로 승인된 굿즈 주문도 에스크로 배송 등록 작업 대상이다(에스크로 선택은 작업자가 결제
--     조회로 확인한다). 카드 승인 주문은 대상이 아니다.
-- ---------------------------------------------------------------------------
select 1 / case when not has_function_privilege('service_role', 'private.toss_escrow_candidate_attempt(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.toss_escrow_candidate_attempt(uuid)', 'execute')
then 1 else 0 end as assert_escrow_candidate_sealed;

insert into public.orders (id, user_id, status, total, shipping_fee, expires_at, checkout_key)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, '00000000-0000-4000-8000-000000004901', 'pending', 31000, 3000,
  now() + interval '15 minutes', ('10000000-0000-4000-8000-00000000' || n)::uuid
from unnest(array['4907', '4908']) as n;
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot, variant_id)
select o.id, 'va-awaiting-good', 1, 28000, '가상계좌 굿즈', 'va-awaiting-ip',
  (select id from public.goods_variants where good_id = 'va-awaiting-good' and is_default)
from public.orders o where o.id in ('20000000-0000-4000-8000-000000004907', '20000000-0000-4000-8000-000000004908');
update public.goods_variants set stock_qty = stock_qty - 2 where good_id = 'va-awaiting-good' and is_default;
insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
  provider_order_id, provider_product_code, claim_token, claim_expires_at, expires_at)
select ('30000000-0000-4000-8000-00000000' || n)::uuid, 'toss', '00000000-0000-4000-8000-000000004901', 'order',
  ('20000000-0000-4000-8000-00000000' || n)::uuid, 31000, 'KRW', 'confirming', 'goods:transfer:' || n,
  'O30000000000040008000' || lpad(n, 11, '0'), 'P30000000000040008000' || lpad(n, 11, '0'),
  ('40000000-0000-4000-8000-00000000' || n)::uuid, now() + interval '10 minutes', now() + interval '10 minutes'
from unnest(array['4907', '4908']) as n;

select 1 / case when public.finalize_goods_payment_attempt(
  '30000000-0000-4000-8000-000000004907', '40000000-0000-4000-8000-000000004907', 'approved',
  'tr-key-4907', 'TRTX4907', null, 'DONE', '계좌이체', '계좌이체', now()
) = 'approved' then 1 else 0 end as assert_transfer_approves;
select 1 / case when (
  select job.state = 'ready' and job.delivery_method = 'DIRECT' and job.attempt_id = '30000000-0000-4000-8000-000000004907'
  from private.toss_escrow_deliveries as job where job.order_id = '20000000-0000-4000-8000-000000004907'
) then 1 else 0 end as assert_transfer_escrow_job_created;
select 1 / case when public.finalize_goods_payment_attempt(
  '30000000-0000-4000-8000-000000004908', '40000000-0000-4000-8000-000000004908', 'approved',
  'card-key-4908', 'CARDTX4908', null, 'DONE', '카드', '4330****', now()
) = 'approved' then 1 else 0 end as assert_card_approves;
select 1 / case when not exists (
  select 1 from private.toss_escrow_deliveries where order_id = '20000000-0000-4000-8000-000000004908'
) and not private.toss_escrow_candidate_attempt('30000000-0000-4000-8000-000000004908')
then 1 else 0 end as assert_card_order_not_escrow_candidate;

-- ---------------------------------------------------------------------------
-- 7. 입금 대기는 운영자 [결제 상태 다시 확인] 대상이고, 자동 재확인 표식을 정리 작업이 지우지 않는다
-- ---------------------------------------------------------------------------
select 1 / case when private.payment_attempt_unresolved('awaiting_deposit', null, now())
  and not private.payment_attempt_unresolved('approved', null, now())
  and not private.payment_attempt_unresolved('declined', null, now())
then 1 else 0 end as assert_awaiting_deposit_counts_as_unresolved;
-- 앞 단계의 입금 대기는 모두 닫혔다 — 확인 중 시도 하나를 입금 대기로 옮겨 표식을 남긴다(이 트랜잭션 안에서만).
select a.id as marker_attempt from public.payment_attempts a where a.state = 'confirming' order by a.id limit 1 \gset
update public.payment_attempts set state = 'awaiting_deposit', claim_token = null, claim_expires_at = null where id = :'marker_attempt';
insert into private.payment_reconciliation_auto_checks(attempt_id, last_picked_at) values (:'marker_attempt', now())
on conflict (attempt_id) do update set last_picked_at = excluded.last_picked_at;
select private.maintain_system_job_records();
select 1 / case when exists(select 1 from private.payment_reconciliation_auto_checks m where m.attempt_id = :'marker_attempt')
then 1 else 0 end as assert_awaiting_deposit_auto_check_marker_kept;

rollback;
