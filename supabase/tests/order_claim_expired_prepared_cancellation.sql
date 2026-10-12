\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 결제 유효 시간이 지난 결제 대기 주문의 고객 취소 (2026-10-12 QA-1 · R2-1)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · request_order_claim은 계속 service_role 전용이다
--   · 결제 원장이 없는 결제 대기 주문에서 만료된 prepared 시도는 고객 취소가 같은
--     잠금 아래에서 canceled로 닫고 요청을 즉시 completed로 종결한다(재고 즉시 복원)
--   · 닫힌 시도에 늦게 도착한 결제 완료 콜백은 claim되지 않는다(승인 API 미호출)
--   · 유효 시간이 남은 prepared·confirming은 종전처럼 requested다. 결제 원장이 있으면
--     만료돼도 시도를 건드리지 않는다. 취소가 아닌 접수·중복 접수도 시도를 건드리지 않는다
--   · 결제 대기 주문의 접수 알림은 "담당자가 확인"이 아니라 결제 결과로 닫히는 길을
--     말한다. 결제완료 주문의 하자 취소는 종전 문구를 쓴다
-- ============================================================================

select 1 / case when (
  has_function_privilege('service_role', 'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('public', 'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)', 'execute')
) then 1 else 0 end as assert_request_order_claim_stays_service_only;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-0000000e9e01', 'authenticated', 'authenticated',
  'expired-prepared-buyer@example.test', now(), '{}', '{}', now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values (
  '00000000-0000-4000-8000-0000000e9e01', 'expired-prepared-buyer@example.test', 'expired_prepared_buyer',
  '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
)
on conflict (id) do update set nickname = excluded.nickname;

insert into public.ips (id, title, vertical_key) values ('expired-prepared-ip', '만료 결제 취소 IP', 'character');
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('expired-prepared-goods', 'expired-prepared-ip', '만료 결제 취소 굿즈', '문구', 10000, 'ok', 20);

create temporary table expired_prepared_case (
  label text primary key,
  order_id uuid not null,
  order_status public.order_status not null,
  attempt_state public.payment_attempt_state,
  attempt_expires_at timestamptz
) on commit drop;

insert into expired_prepared_case values
  -- U: 결제 유효 시간이 남은 결제 준비
  ('U', '61000000-0000-4000-8000-0000000e9e01', 'pending', 'prepared', now() + interval '10 minutes'),
  -- X: 결제 유효 시간이 지난 결제 준비 — 고객 취소로 바로 닫힌다
  ('X', '61000000-0000-4000-8000-0000000e9e02', 'pending', 'prepared', now() - interval '1 minute'),
  -- C: 결제 승인 확인 중
  ('C', '61000000-0000-4000-8000-0000000e9e03', 'pending', 'confirming', now() + interval '10 minutes'),
  -- F: 만료된 결제 준비 + 실패 결제 원장(레거시) — 시도를 건드리지 않는다
  ('F', '61000000-0000-4000-8000-0000000e9e04', 'pending', 'prepared', now() - interval '1 minute'),
  -- R: 만료된 결제 준비에 취소가 아닌 반품 접수 — 시도를 건드리지 않는다
  ('R', '61000000-0000-4000-8000-0000000e9e05', 'pending', 'prepared', now() - interval '1 minute'),
  -- D: 만료된 결제 준비 + 이미 접수된 취소 요청 — 중복 접수는 시도를 건드리지 않는다
  ('D', '61000000-0000-4000-8000-0000000e9e06', 'pending', 'prepared', now() - interval '1 minute'),
  -- P: 결제완료 주문의 하자 취소 — 담당자 검토
  ('P', '61000000-0000-4000-8000-0000000e9e07', 'paid', null, null);

insert into public.orders (id, user_id, status, total, address, expires_at)
select c.order_id, '00000000-0000-4000-8000-0000000e9e01', c.order_status, 10000, '{}'::jsonb,
  case when c.order_status = 'pending' then now() + interval '30 minutes' end
from expired_prepared_case c;

insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, variant_id)
select c.order_id, 'expired-prepared-goods', 1, 10000, '만료 결제 취소 굿즈', '문구', 'expired-prepared-ip',
  (select id from public.goods_variants where good_id = 'expired-prepared-goods' and is_default)
from expired_prepared_case c;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code,
  callback_nonce_digest, expires_at, claim_token, claim_expires_at
)
select
  ('62000000-0000-4000-8000-0000000e9e0' || right(c.order_id::text, 1))::uuid,
  'toss', '00000000-0000-4000-8000-0000000e9e01', 'order', c.order_id, 10000, 'KRW', c.attempt_state,
  'goods:' || c.order_id::text,
  'OEXPPREP' || c.label || right(c.order_id::text, 4),
  'PEXPPREP' || c.label || right(c.order_id::text, 4),
  repeat(case c.label when 'U' then 'a' when 'X' then 'b' when 'C' then 'c' when 'F' then 'd' when 'R' then 'e' else 'f' end, 64),
  c.attempt_expires_at,
  case when c.attempt_state = 'confirming' then '63000000-0000-4000-8000-0000000e9e03'::uuid end,
  case when c.attempt_state = 'confirming' then now() + interval '10 minutes' end
from expired_prepared_case c
where c.attempt_state is not null;

insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, provider)
values
  ('64000000-0000-4000-8000-0000000e9e04', '00000000-0000-4000-8000-0000000e9e01', 'order',
    '61000000-0000-4000-8000-0000000e9e04', 10000, 'failed', null, 'idem_expired_prepared_f', 'toss'),
  ('64000000-0000-4000-8000-0000000e9e07', '00000000-0000-4000-8000-0000000e9e01', 'order',
    '61000000-0000-4000-8000-0000000e9e07', 10000, 'paid', 'pk_expired_prepared_p', 'idem_expired_prepared_p', 'toss');

insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, claim_type, stage)
values ('61000000-0000-4000-8000-0000000e9e06', '00000000-0000-4000-8000-0000000e9e01',
  '사용자 주문 취소', 'change_of_mind', 'cancel', 'requested');

create temporary table expired_prepared_stock on commit drop as
select stock_qty as before_qty
from public.goods_variants where good_id = 'expired-prepared-goods' and is_default;

-- ---------------------------------------------------------------------------
-- U: 유효 시간이 남은 결제 준비는 결제 결과(결제 기한 sweep)가 닫는다
-- ---------------------------------------------------------------------------
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e01', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'requested' then 1 else 0 end as assert_unexpired_prepared_stays_requested;

-- 활성 요청이 있으면 유효 시간 안의 결제 완료 콜백도 claim되지 않는다 — 접수 알림이
-- "결제가 끝나지 않은 주문"이라고 단정할 수 있는 근거다.
do $unexpired_claim$
declare rejected boolean := false;
begin
  begin
    perform public.claim_goods_payment_attempt(
      'toss', 'OEXPPREPU9e01', repeat('a', 64), '63000000-0000-4000-8000-0000000e9e01'
    );
  exception when object_not_in_prerequisite_state then
    rejected := sqlerrm = 'goods_order_not_payable';
  end;
  if not rejected then raise exception 'callback claimed an attempt whose order has an active cancellation request'; end if;
end;
$unexpired_claim$;
reset role;

select 1 / case when (
  select o.status = 'pending' and a.state = 'prepared' and r.status = 'requested' and r.stage = 'requested'
    and (select count(*) = 1 from public.notifications n
      where n.source_id = r.id::text and n.dedupe_key like 'claim:requested:%'
        and n.title = '취소 요청이 접수됐어요'
        and n.body = '결제가 끝나지 않은 주문이라 결제 기한이 지나면 결제 없이 자동으로 취소되고 알림을 보내드려요.')
  from public.orders o
  join public.payment_attempts a on a.purpose = 'order' and a.ref_id = o.id
  join public.order_cancellation_requests r on r.order_id = o.id
  where o.id = '61000000-0000-4000-8000-0000000e9e01'
) then 1 else 0 end as assert_unexpired_prepared_notice_names_payment_deadline;

-- ---------------------------------------------------------------------------
-- X: 유효 시간이 지난 결제 준비는 고객 취소가 즉시 닫는다
-- ---------------------------------------------------------------------------
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e02', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'completed' then 1 else 0 end as assert_expired_prepared_completes_immediately;
reset role;

select 1 / case when (
  select o.status = 'canceled' and o.expires_at is null
    and a.state = 'canceled' and a.claim_token is null and a.claim_expires_at is null and a.payment_id is null
    and r.status = 'completed' and r.stage = 'completed' and r.completed_at is not null
    and not exists (select 1 from public.payments p where p.purpose = 'order' and p.ref_id = o.id)
    and not exists (select 1 from public.order_cancellation_claims k where k.order_id = o.id)
    and (select count(*) = 1 from public.audit_log l
      where l.target = 'order:' || o.id::text
        and l.action = 'order.prepared_goods_cancellation_completed'
        and l.actor_id = '00000000-0000-4000-8000-0000000e9e01'
        and l.diff->>'attemptId' = a.id::text
        and l.diff->>'requestId' = r.id::text
        and l.diff->>'outcome' = 'expired_no_capture'
        and l.diff->>'trigger' = 'customer_cancel_request')
    -- 결과는 화면이 바로 보여준다. "담당자가 확인" 접수 알림은 나가지 않는다.
    and not exists (select 1 from public.notifications n
      where n.source_id = r.id::text and n.dedupe_key like 'claim:requested:%')
  from public.orders o
  join public.payment_attempts a on a.purpose = 'order' and a.ref_id = o.id
  join public.order_cancellation_requests r on r.order_id = o.id
  where o.id = '61000000-0000-4000-8000-0000000e9e02'
) then 1 else 0 end as assert_expired_prepared_closes_attempt_request_and_order;

select 1 / case when (
  select stock_qty = (select before_qty from expired_prepared_stock) + 1
  from public.goods_variants where good_id = 'expired-prepared-goods' and is_default
) then 1 else 0 end as assert_expired_prepared_restores_stock_once;

-- 닫힌 시도에 늦게 도착한 결제 완료 콜백은 terminal canceled만 돌려준다(confirm 없음).
set local role service_role;
select 1 / case when (
  select r->>'claim_status' = 'terminal' and r->>'outcome' = 'canceled'
  from (select public.claim_goods_payment_attempt(
    'toss', 'OEXPPREPX9e02', repeat('b', 64), '63000000-0000-4000-8000-0000000e9e02'
  ) as r) late
) then 1 else 0 end as assert_late_callback_is_not_claimed;

-- 같은 주문의 재신청·만료 sweep은 다시 복원하지 않는다.
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e02', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'already_canceled' then 1 else 0 end as assert_expired_prepared_replay_is_terminal;
select public.expire_stale_checkouts() >= 0 as sweep_ran;
reset role;

select 1 / case when (
  select stock_qty = (select before_qty from expired_prepared_stock) + 1
  from public.goods_variants where good_id = 'expired-prepared-goods' and is_default
) then 1 else 0 end as assert_expired_prepared_replay_does_not_restore_again;

-- ---------------------------------------------------------------------------
-- C: 결제 승인 확인 중은 종전처럼 requested — finalizer가 닫는다
-- ---------------------------------------------------------------------------
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e03', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'requested' then 1 else 0 end as assert_confirming_stays_requested;
reset role;

select 1 / case when (
  select a.state = 'confirming' and a.claim_token is not null and r.status = 'requested'
    and (select count(*) = 1 from public.notifications n
      where n.source_id = r.id::text and n.dedupe_key like 'claim:requested:%'
        and n.title = '취소 요청이 접수됐어요'
        and n.body = '결제 승인 결과를 확인한 뒤 주문 취소를 마무리합니다. 승인됐다면 결제를 취소하고, 승인되지 않았다면 결제 없이 취소한 뒤 알림을 보내드려요.'
        and n.body not like '%담당자%')
  from public.payment_attempts a
  join public.order_cancellation_requests r on r.order_id = a.ref_id
  where a.ref_id = '61000000-0000-4000-8000-0000000e9e03'
) then 1 else 0 end as assert_confirming_notice_names_payment_result;

-- ---------------------------------------------------------------------------
-- F·R·D: 시도를 닫으면 안 되는 경우
-- ---------------------------------------------------------------------------
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e04', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'requested' then 1 else 0 end as assert_failed_ledger_stays_requested;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e05', '00000000-0000-4000-8000-0000000e9e01',
  'return', '사용자 반품', 'change_of_mind'
) = 'not_claimable' then 1 else 0 end as assert_return_on_pending_is_not_claimable;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e06', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '사용자 주문 취소', 'change_of_mind'
) = 'already_requested' then 1 else 0 end as assert_duplicate_request_is_already_requested;
reset role;

select 1 / case when (
  select bool_and(a.state = 'prepared' and o.status = 'pending')
  from public.payment_attempts a join public.orders o on o.id = a.ref_id
  where a.ref_id in (
    '61000000-0000-4000-8000-0000000e9e04',
    '61000000-0000-4000-8000-0000000e9e05',
    '61000000-0000-4000-8000-0000000e9e06'
  )
) then 1 else 0 end as assert_attempt_untouched_outside_immediate_cancel;

select 1 / case when not exists (
  select 1 from public.audit_log l
  where l.action = 'order.prepared_goods_cancellation_completed'
    and l.target in (
      'order:61000000-0000-4000-8000-0000000e9e04',
      'order:61000000-0000-4000-8000-0000000e9e05',
      'order:61000000-0000-4000-8000-0000000e9e06'
    )
) then 1 else 0 end as assert_no_prepared_closure_audit_outside_immediate_cancel;

-- ---------------------------------------------------------------------------
-- P: 결제완료 주문의 하자 취소는 담당자 검토 — 종전 접수 문구
-- ---------------------------------------------------------------------------
set local role service_role;
select 1 / case when public.request_order_claim(
  '61000000-0000-4000-8000-0000000e9e07', '00000000-0000-4000-8000-0000000e9e01',
  'cancel', '상품 하자', 'defect'
) = 'requested' then 1 else 0 end as assert_paid_defect_cancel_stays_requested;
reset role;

select 1 / case when (
  select count(*) = 1 from public.notifications n
  join public.order_cancellation_requests r on r.id::text = n.source_id
  where r.order_id = '61000000-0000-4000-8000-0000000e9e07'
    and n.dedupe_key like 'claim:requested:%'
    and n.title = '클레임 요청이 접수됐어요'
    and n.body = '요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다.'
) then 1 else 0 end as assert_staff_review_notice_unchanged;

rollback;
