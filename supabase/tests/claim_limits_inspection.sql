\set ON_ERROR_STOP on

-- D-3 — 클레임 사유 코드 · 환불 한도 · 승인 분리 · 검수 재고 복원 (설계서 v2 §1-3)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 'claim-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 'claim-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000a003', 'authenticated', 'authenticated', 'claim-admin@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-00000000a001', 'claim-buyer@example.test', 'claim_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-00000000a002', 'claim-staff@example.test', 'claim_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-00000000a003', 'claim-admin@example.test', 'claim_admin', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'admin')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('claim-test', '클레임 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('claim-ip', '클레임 테스트 IP', 'claim-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('claim-g1', 'claim-ip', '클레임 테스트 굿즈', '문구', 90000, 'ok', 30)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 사유 마스터 — 카페24 8종 + 자사 2종, 과실 구분이 붙는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select count(*) from public.claim_reason_codes where active) = 10
  and (select fault from public.claim_reason_codes where code = 'damaged') = 'seller'
  and (select fault from public.claim_reason_codes where code = 'change_of_mind') = 'customer'
  and (select always_requires_approval from public.claim_reason_codes where code = 'other')
  and (select cafe24_code from public.claim_reason_codes where code = 'wrong_delivery') = 'C'
  -- 사유마다 한도가 하나씩 있다. 없는 사유는 「모르는 사유」라 승인으로 간다.
  and (select count(*) from public.claim_refund_limits) = (select count(*) from public.claim_reason_codes)
) then 1 else 0 end as assert_reason_master_is_seeded;

-- ---------------------------------------------------------------------------
-- B. 한도 판정 — 넘으면 승인자를 부른다
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-00000000a001', 'claim-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-00000000a001'::uuid,
  '{"recipientName":"최클레임","phone":"01077778888","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 3","address2":"7층"}'::jsonb,
  '00000000-0000-4000-8000-00000000a010'::uuid
) as big_order \gset
select set_config('claim.big', :'big_order', true);
update public.orders set status = 'paid' where id = current_setting('claim.big')::uuid;
-- 결제 줄이 있어야 환불 줄이 생긴다. 승인의 요점이 「환불 착수」라 결제를 실제로 둔다.
insert into public.payments (user_id, purpose, ref_id, amount, status, idempotency_key)
values ('00000000-0000-4000-8000-00000000a001', 'order', current_setting('claim.big')::uuid, 180000, 'paid', 'claim-big-pay');

insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, reason_code, claim_type, stage, status)
values (
  current_setting('claim.big')::uuid, '00000000-0000-4000-8000-00000000a001',
  '단순 변심으로 전체 취소를 원합니다', 'change_of_mind', 'change_of_mind', 'cancel', 'requested', 'requested'
) returning id as big_claim \gset
select set_config('claim.big_claim', :'big_claim', true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);

-- 18만 원 환불은 단순 변심 한도(10만 원)를 넘는다 → 처리로 못 넘어간다.
select public.admin_decide_order_claim(current_setting('claim.big_claim')::uuid, 'approve', null) as big_stage \gset
reset role;
select 1 / case when :'big_stage' = 'approval_pending'
  and (select approval_requested_at from public.order_cancellation_requests where id = current_setting('claim.big_claim')::uuid) is not null
  and (select (limit_snapshot ->> 'amount')::bigint from public.order_cancellation_requests where id = current_setting('claim.big_claim')::uuid) = 180000
  and (select (limit_snapshot ->> 'requires_approval')::boolean from public.order_cancellation_requests where id = current_setting('claim.big_claim')::uuid)
  -- 승인 전에는 환불 줄이 생기지 않는다.
  and (select count(*) from public.refunds where cancellation_request_id = current_setting('claim.big_claim')::uuid) = 0
  then 1 else 0 end as assert_over_limit_waits_for_approval;

-- 처리자가 자기 건을 승인할 수 없다(그리고 스태프는 애초에 승인자가 아니다).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
do $$
begin
  perform public.admin_approve_claim_refund(current_setting('claim.big_claim')::uuid, null);
  raise exception 'staff must not approve';
exception when others then
  if sqlerrm <> 'approver_role_required' then raise; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a003', true);
select public.admin_approve_claim_refund(current_setting('claim.big_claim')::uuid, '대표 확인 후 승인') as approved \gset
reset role;
select 1 / case when :'approved' = 'processing'
  and (select approved_by from public.order_cancellation_requests where id = current_setting('claim.big_claim')::uuid)
    = '00000000-0000-4000-8000-00000000a003'
  and (select count(*) from public.refunds where cancellation_request_id = current_setting('claim.big_claim')::uuid) >= 1
  then 1 else 0 end as assert_approver_starts_the_refund;

-- 승인은 한 번이다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a003', true);
do $$
begin
  perform public.admin_approve_claim_refund(current_setting('claim.big_claim')::uuid, null);
  raise exception 'approval must not repeat';
exception when others then
  if sqlerrm <> 'claim_not_awaiting_approval' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- C. 한도 안 — 승인 없이 곧장 처리로 간다
-- ---------------------------------------------------------------------------
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('claim-g2', 'claim-ip', '싼 굿즈', '키링', 9000, 'ok', 30) on conflict (id) do nothing;
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-00000000a001', 'claim-g2', 1);
select public.place_order(
  '00000000-0000-4000-8000-00000000a001'::uuid,
  '{"recipientName":"최클레임","phone":"01077778888","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 3","address2":"7층"}'::jsonb,
  '00000000-0000-4000-8000-00000000a011'::uuid
) as small_order \gset
select set_config('claim.small', :'small_order', true);
update public.orders set status = 'paid' where id = current_setting('claim.small')::uuid;

insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, reason_code, claim_type, stage, status)
values (
  current_setting('claim.small')::uuid, '00000000-0000-4000-8000-00000000a001',
  '단순 변심으로 취소를 원합니다', 'change_of_mind', 'change_of_mind', 'cancel', 'requested', 'requested'
) returning id as small_claim \gset
select set_config('claim.small_claim', :'small_claim', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
select public.admin_decide_order_claim(current_setting('claim.small_claim')::uuid, 'approve', null) as small_stage \gset
reset role;
select 1 / case when :'small_stage' = 'processing'
  -- 통과한 건에도 그때의 한도가 남는다 — 나중에 「그때 기준이 뭐였나」를 물을 수 있어야 한다.
  and (select limit_snapshot from public.order_cancellation_requests where id = current_setting('claim.small_claim')::uuid) is not null
  and not (select (limit_snapshot ->> 'requires_approval')::boolean from public.order_cancellation_requests where id = current_setting('claim.small_claim')::uuid)
  then 1 else 0 end as assert_within_limit_needs_no_approval;
reset role;

-- ---------------------------------------------------------------------------
-- D. 검수 — 다시 팔 수 있는 것만 재고로 돌아간다
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-00000000a001', 'claim-g2', 2);
select public.place_order(
  '00000000-0000-4000-8000-00000000a001'::uuid,
  '{"recipientName":"최클레임","phone":"01077778888","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 3","address2":"7층"}'::jsonb,
  '00000000-0000-4000-8000-00000000a012'::uuid
) as return_order \gset
select set_config('claim.ret', :'return_order', true);
update public.orders set status = 'paid' where id = current_setting('claim.ret')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
select public.admin_update_order_status(current_setting('claim.ret')::uuid, 'confirmed', null, null);
select public.admin_update_order_status(current_setting('claim.ret')::uuid, 'shipping', 'hanjin', 'HANJIN0001');
select public.admin_update_order_status(current_setting('claim.ret')::uuid, 'delivered', null, null);
reset role;

select id as ret_item from public.order_items where order_id = current_setting('claim.ret')::uuid \gset
select set_config('claim.ret_item', :'ret_item', true);
select on_hand_qty as before_restock from public.variant_stocks as stock
join public.order_items as item on item.variant_id = stock.variant_id and item.location_id = stock.location_id
where item.id = current_setting('claim.ret_item')::uuid \gset

insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, reason_code, claim_type, stage, status, order_item_id, qty)
values (
  current_setting('claim.ret')::uuid, '00000000-0000-4000-8000-00000000a001',
  '파손된 상품이 도착했습니다', 'defect', 'damaged', 'return', 'collected', 'requested',
  current_setting('claim.ret_item')::uuid, 1
) returning id as ret_claim \gset
select set_config('claim.ret_claim', :'ret_claim', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
select public.admin_record_claim_inspection(current_setting('claim.ret_claim')::uuid, 'restock', 1) as inspected \gset
reset role;
select 1 / case when :'inspected' = 'restock'
  and (select count(*) from public.stock_restorations where claim_id = current_setting('claim.ret_claim')::uuid) = 1
  and (select qty_returned from public.order_items where id = current_setting('claim.ret_item')::uuid) = 1
  and (
    select stock.on_hand_qty from public.variant_stocks as stock
    join public.order_items as item on item.variant_id = stock.variant_id and item.location_id = stock.location_id
    where item.id = current_setting('claim.ret_item')::uuid
  ) = :'before_restock'::integer + 1
  then 1 else 0 end as assert_restock_returns_stock;

-- 검수는 한 번이다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
do $$
begin
  perform public.admin_record_claim_inspection(current_setting('claim.ret_claim')::uuid, 'discard', 1);
  raise exception 'inspection must not repeat';
exception when others then
  if sqlerrm <> 'inspection_already_recorded' then raise; end if;
end $$;
reset role;

-- 한 주문에 열린 클레임은 하나다. 다음 건을 넣기 전에 앞 건을 닫는다.
update public.order_cancellation_requests
set stage = 'completed', status = 'completed', completed_at = now()
where id = current_setting('claim.ret_claim')::uuid;

-- 폐기는 기록만 남고 재고는 그대로다.
insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, reason_code, claim_type, stage, status, order_item_id, qty)
values (
  current_setting('claim.ret')::uuid, '00000000-0000-4000-8000-00000000a001',
  '두 번째 상품도 파손입니다', 'defect', 'damaged', 'return', 'collected', 'requested',
  current_setting('claim.ret_item')::uuid, 1
) returning id as discard_claim \gset
select set_config('claim.discard', :'discard_claim', true);
select on_hand_qty as before_discard from public.variant_stocks as stock
join public.order_items as item on item.variant_id = stock.variant_id and item.location_id = stock.location_id
where item.id = current_setting('claim.ret_item')::uuid \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
select public.admin_record_claim_inspection(current_setting('claim.discard')::uuid, 'discard', 1) as discarded \gset
reset role;
select 1 / case when :'discarded' = 'discard'
  and (select outcome from public.stock_restorations where claim_id = current_setting('claim.discard')::uuid) = 'discard'
  and (
    select stock.on_hand_qty from public.variant_stocks as stock
    join public.order_items as item on item.variant_id = stock.variant_id and item.location_id = stock.location_id
    where item.id = current_setting('claim.ret_item')::uuid
  ) = :'before_discard'::integer
  then 1 else 0 end as assert_discard_records_without_restocking;

-- 한 주문에 열린 클레임은 하나다. 다음 건을 넣기 전에 앞 건을 닫는다.
update public.order_cancellation_requests
set stage = 'completed', status = 'completed', completed_at = now()
where id = current_setting('claim.discard')::uuid;

-- 도착하지 않은 수량은 돌아올 수 없다.
insert into public.order_cancellation_requests (order_id, requested_by, reason, reason_type, reason_code, claim_type, stage, status, order_item_id, qty)
values (
  current_setting('claim.ret')::uuid, '00000000-0000-4000-8000-00000000a001',
  '수량을 넘겨 반품하려 합니다', 'defect', 'damaged', 'return', 'collected', 'requested',
  current_setting('claim.ret_item')::uuid, 9
) returning id as over_claim \gset
select set_config('claim.over', :'over_claim', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', true);
do $$
begin
  perform public.admin_record_claim_inspection(current_setting('claim.over')::uuid, 'restock', 9);
  raise exception 'over-qty restock must fail';
exception when others then
  if sqlerrm <> 'qty_exceeds_delivered' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- E. 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_approve_claim_refund(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_approve_claim_refund(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_record_claim_inspection(uuid,text,integer)', 'execute')
  and not has_table_privilege('authenticated', 'public.claim_refund_limits', 'update')
  and not has_table_privilege('anon', 'public.stock_restorations', 'select')
) then 1 else 0 end as assert_claim_acl;

rollback;
