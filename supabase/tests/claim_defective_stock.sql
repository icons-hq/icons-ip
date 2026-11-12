\set ON_ERROR_STOP on
-- 반품 불량 재고 분리(QNA-035). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 실결제·결제사 호출 없음.
--  1. 선택(planned): 반품만·확정 전만·자기 주문 품목만, 빈 선택은 모두 복원으로 되돌림, 다른 클레임 중복 거절.
--  2. 환불 확정(finalizer): 불량 품목은 판매 재고(stock_qty)와 복원 기록('order.option_stock_restored')에 없고 나머지는 복원된다.
--  3. 기록(recorded): 확정 뒤 원장에 옵션·수량·클레임·처리자가 남고, 재호출은 멱등이며, 기록 전에는 '기록 필요'로 보인다.
--  4. 목록·옵션별 합계·재고 대조 참고 칸, 권한(sales.manage/catalog.read), 기록된 행 불변.
--  5. 재고 대조 흐름은 불량 품목을 '창고를 떠나 돌아오지 않은 수량'으로 읽어 판매 재고와 어긋나지 않는다.
begin;
create function pg_temp.ds_id(kind text, n integer) returns uuid language sql immutable as $$select md5('defective-stock:'||kind||':'||n)::uuid$$;
create function pg_temp.ds_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected defective stock rejection: %', expected; end $$;
create function pg_temp.ds_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.ds_id('user', actor),
  'session_id', pg_temp.ds_id('session', actor))::text, true);
end $$;
create function pg_temp.ds_stock(n integer) returns integer language sql as $$
 select v.stock_qty from public.goods_variants v where v.good_id = 'defective-stock-good-'||n and v.is_default$$;
grant execute on function pg_temp.ds_id(text, integer), pg_temp.ds_error(text, text), pg_temp.ds_auth(integer), pg_temp.ds_stock(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.ds_id('user', n), 'authenticated', 'authenticated', 'defective-stock-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 4) n;
insert into auth.sessions(id, user_id, created_at, updated_at)
 select pg_temp.ds_id('session', n), pg_temp.ds_id('user', n), clock_timestamp(), clock_timestamp() from generate_series(1, 4) n;
update public.profiles set nickname = 'TEST 불량재고 '||right(id::text, 6),
 role = case when id = pg_temp.ds_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.ds_id('user', n) from generate_series(1, 4) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.ds_id('user', 1), 'primary');
-- 사용자 4: 재고·상품 읽기가 없는 물류 담당(sales.manage·catalog.read 모두 없다).
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.ds_id('user', 3), 'logistics');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 values (pg_temp.ds_id('origin', 1), 'defective-stock-origin', 'TEST 불량재고 출고지', 'hanjin', 3000, 'TEST 반품 주소', true);
insert into public.ips(id, title, vertical_key) values ('defective-stock-ip', 'TEST 불량재고 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id)
 select 'defective-stock-good-'||n, 'defective-stock-ip', 'TEST 불량재고 상품 '||n, '문구', 10000, 'ok', 10, pg_temp.ds_id('origin', 1)
 from generate_series(1, 4) n;

-- 주문 1: 반품(상품1 ×2 · 상품2 ×3) 카드 결제 5만원 · 주문 2: 반품(상품3 ×1) · 주문 3: 교환(상품4 ×1) · 주문 4: 반품(상품1 ×2, 같은 품목 중복 선택용)
insert into public.orders(id, user_id, status, total, shipping_fee, address, payment_method, created_at, delivered_at)
 select pg_temp.ds_id('order', n), pg_temp.ds_id('user', 2), 'delivered'::public.order_status, case n when 1 then 50000 else 10000 end, 0,
  '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
  'card'::public.order_payment_method, clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day' from generate_series(1, 4) n;
update public.orders set shipped_at = clock_timestamp() - interval '2 days' where id in (select pg_temp.ds_id('order', n) from generate_series(1, 4) n);
insert into public.order_items(id, order_id, good_id, variant_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
 select pg_temp.ds_id('item', k.item), pg_temp.ds_id('order', k.ord), 'defective-stock-good-'||k.good, v.id, 'TEST 불량재고 상품 '||k.good, '문구', 'defective-stock-ip', k.qty, 10000
 from (values (1, 1, 1, 2), (2, 1, 2, 3), (3, 2, 3, 1), (4, 3, 4, 1), (5, 4, 1, 2)) k(item, ord, good, qty)
 join public.goods_variants v on v.good_id = 'defective-stock-good-'||k.good and v.is_default;
insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 select pg_temp.ds_id('payment', n), pg_temp.ds_id('user', 2), 'toss'::public.payment_provider, 'order', pg_temp.ds_id('order', n),
  case n when 1 then 50000 else 10000 end, 'paid'::public.payment_status, 'TEST-DS-KEY-'||n, 'defective-stock-test-'||n, clock_timestamp() - interval '3 days'
 from generate_series(1, 4) n;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 select pg_temp.ds_id('claim', n), pg_temp.ds_id('order', n), pg_temp.ds_id('user', 2), 'TEST 불량 재고 검증', 'defect',
  case when n = 3 then 'exchange' else 'return' end, case when n = 3 then 'requested' else 'collected' end, 'legacy',
  case when n = 3 then null else clock_timestamp() - interval '30 minutes' end, clock_timestamp() - interval '2 days' from generate_series(1, 4) n;

-- 1. 선택 -----------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(3);
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.ds_id('claim', 1), pg_temp.ds_id('item', 1)), 'operator_capability_required');
select pg_temp.ds_error(format('select public.admin_claim_defective_items(array[%L]::uuid[])', pg_temp.ds_id('claim', 1)), 'operator_capability_required');
select pg_temp.ds_error('select public.admin_list_defective_stock(10)', 'operator_capability_required');
select pg_temp.ds_auth(1);
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.ds_id('claim', 3), pg_temp.ds_id('item', 4)), 'defective_stock_return_only');
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.ds_id('claim', 1), pg_temp.ds_id('item', 3)), 'defective_stock_item_not_in_order');
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L, null]::uuid[])', pg_temp.ds_id('claim', 1), pg_temp.ds_id('item', 1)), '22023');
select 1/case when public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 1), array[pg_temp.ds_id('item', 1)]) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 1), 'planned', 1)
 then 1 else 0 end as plan_one_of_two_items_defective;
-- 같은 선택을 다시 저장해도 같다. 다른 선택은 바꾼다(품목 2로 바꿨다가 비워 모두 복원으로).
select 1/case when public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 1), array[pg_temp.ds_id('item', 1)]) ->> 'planned' = '1' then 1 else 0 end as plan_is_idempotent;
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 1), array[pg_temp.ds_id('item', 2)]);
select 1/case when (select count(*) = 1 and bool_and(i->>'orderItemId' = pg_temp.ds_id('item', 2)::text)
   from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 1)])->0->'items') i where (i->>'defective')::boolean)
 then 1 else 0 end as plan_replaces_previous_choice;
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 1), '{}');
select 1/case when (public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 1)])->0->>'pending')::int = 0
 then 1 else 0 end as empty_plan_restores_everything;
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 1), array[pg_temp.ds_id('item', 1)]);
reset role;
-- 주문 4의 반품은 거절됐고 낡은 선택 행이 남은 상태다(아래 9번에서 복원을 막지 않음을 확인한다).
update public.order_cancellation_requests set stage = 'rejected', status = 'rejected' where id = pg_temp.ds_id('claim', 4);
insert into private.claim_defective_stock(claim_id, order_item_id, qty, planned_by) values (pg_temp.ds_id('claim', 4), pg_temp.ds_id('item', 5), 2, pg_temp.ds_id('user', 1));

-- 2. 읽기: 선택은 '불량'으로 보이고 아직 기록 전(planned)이다 -------------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when (select (c->>'pending')::int = 1
   and (select count(*) = 2 from jsonb_array_elements(c->'items'))
   and (select (i->>'defective')::boolean and i->>'state' = 'planned' and (i->>'qty')::int = 2
     from jsonb_array_elements(c->'items') i where i->>'orderItemId' = pg_temp.ds_id('item', 1)::text)
   and (select not (i->>'defective')::boolean and i->>'state' is null
     from jsonb_array_elements(c->'items') i where i->>'orderItemId' = pg_temp.ds_id('item', 2)::text)
   from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 1), pg_temp.ds_id('claim', 3)])) c
   where c->>'claimId' = pg_temp.ds_id('claim', 1)::text)
 and jsonb_array_length(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 3)])) = 0
 then 1 else 0 end as items_view_shows_choice_and_skips_non_returns;
-- 처리완료 전에는 기록할 수 없다.
select pg_temp.ds_error(format('select public.admin_record_claim_defective_stock(%L)', pg_temp.ds_id('claim', 1)), 'defective_stock_claim_not_completed');
-- 선택 행이 없으면 클레임 유형과 관계없이 결과 없음이다(무통장 취소 클레임의 [취소 확정] 뒤에도 같은 호출이 간다).
select 1/case when public.admin_record_claim_defective_stock(pg_temp.ds_id('claim', 3)) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 3), 'recorded', 0, 'total', 0, 'pending', 0) then 1 else 0 end as recording_a_non_return_without_choice_is_a_noop;
select public.admin_record_order_claim_refund(pg_temp.ds_id('claim', 1), 'pg_cancel', 'filed', null);
reset role;

-- 3. 환불 확정(결제사 취소가 끝난 뒤의 finalizer): 불량 품목은 복원하지 않는다 ------------------------------------------------
select 1/case when pg_temp.ds_stock(1) = 10 and pg_temp.ds_stock(2) = 10 then 1 else 0 end as stocks_start_at_ten;
select public.complete_order_cancellation_request(pg_temp.ds_id('claim', 1), array['TEST-DS-KEY-1'], pg_temp.ds_id('user', 1));
select 1/case when pg_temp.ds_stock(1) = 10 and pg_temp.ds_stock(2) = 13
 and (select stage = 'completed' from public.order_cancellation_requests where id = pg_temp.ds_id('claim', 1))
 and (select status = 'canceled' from public.orders where id = pg_temp.ds_id('order', 1))
 and exists(select 1 from public.audit_log where action = 'order.option_stock_restored' and target = 'order:'||pg_temp.ds_id('order', 1)
   and diff->>'orderItemId' = pg_temp.ds_id('item', 2)::text and (diff->>'delta')::int = 3)
 and not exists(select 1 from public.audit_log where action = 'order.option_stock_restored' and target = 'order:'||pg_temp.ds_id('order', 1)
   and diff->>'orderItemId' = pg_temp.ds_id('item', 1)::text)
 then 1 else 0 end as defective_item_skips_restore_and_the_other_is_restored;
-- goods.stock_qty 캐시도 옵션 합계와 같다(불량 품목은 어느 쪽에도 없다).
select 1/case when (select stock_qty = 10 from public.goods where id = 'defective-stock-good-1')
 and (select stock_qty = 13 from public.goods where id = 'defective-stock-good-2') then 1 else 0 end as goods_cache_matches_variants;

-- 확정 직후 기록 전: '불량 기록 필요'로 보이고 목록에는 아직 없다.
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when jsonb_array_length(public.admin_list_defective_stock(50)->'variants') = 0
 and public.admin_list_defective_stock(50)->'pending'->0 @> jsonb_build_object('claimId', pg_temp.ds_id('claim', 1), 'qty', 2, 'items', 1)
 and (select (c->>'pending')::int = 1 from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 1)])) c)
 then 1 else 0 end as unrecorded_choice_is_pending_not_listed;
-- 확정 뒤에는 선택을 바꿀 수 없다(이미 복원이 끝났다).
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, ''{}'')', pg_temp.ds_id('claim', 1)), 'defective_stock_claim_closed');

-- 4. 기록 -----------------------------------------------------------------------------------------------------------------
select 1/case when public.admin_record_claim_defective_stock(pg_temp.ds_id('claim', 1)) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 1), 'recorded', 1, 'total', 1, 'pending', 0)
 then 1 else 0 end as record_writes_ledger_row;
select 1/case when public.admin_record_claim_defective_stock(pg_temp.ds_id('claim', 1)) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 1), 'recorded', 0, 'total', 1, 'pending', 0)
 then 1 else 0 end as record_is_idempotent;
reset role;
select 1/case when (select count(*) = 1 from private.claim_defective_stock where claim_id = pg_temp.ds_id('claim', 1) and state = 'recorded')
 and (select qty = 2 and recorded_by = pg_temp.ds_id('user', 1) and planned_by = pg_temp.ds_id('user', 1) and recorded_at is not null
   and good_id = 'defective-stock-good-1' and variant_name is not null and variant_code is not null
   from private.claim_defective_stock where order_item_id = pg_temp.ds_id('item', 1))
 and (select count(*) = 1 from public.audit_log where action = 'order.claim_defective_stock_recorded' and diff->>'claimId' = pg_temp.ds_id('claim', 1)::text
   and (diff->>'physicalStockDelta')::int = 0)
 and pg_temp.ds_stock(1) = 10
 then 1 else 0 end as ledger_row_has_variant_qty_actor_and_stock_is_untouched;

-- 5. 목록·옵션별 합계·재고 대조 참고 칸 ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when (select (v->>'qty')::int = 2 and v->>'goodId' = 'defective-stock-good-1' and (v->>'entries')::int = 1
   from jsonb_array_elements(public.admin_list_defective_stock(50)->'variants') v)
 and (select e->>'claimId' = pg_temp.ds_id('claim', 1)::text and (e->>'qty')::int = 2 and e->>'recordedByName' like 'TEST 불량재고 %'
   from jsonb_array_elements(public.admin_list_defective_stock(50)->'entries') e)
 and jsonb_array_length(public.admin_list_defective_stock(50)->'pending') = 0
 then 1 else 0 end as list_shows_variant_total_claim_link_and_actor;
select 1/case when public.admin_defective_stock_by_variant(array[(select id from public.goods_variants where good_id = 'defective-stock-good-1' and is_default),
   (select id from public.goods_variants where good_id = 'defective-stock-good-2' and is_default)])
  = jsonb_build_array(jsonb_build_object('variantId', (select id from public.goods_variants where good_id = 'defective-stock-good-1' and is_default), 'qty', 2))
 then 1 else 0 end as reconcile_reference_counts_only_defective_variants;
reset role;

-- 6. 기록된 행은 불변, 같은 품목 두 번 기록 금지 -----------------------------------------------------------------------------
select pg_temp.ds_error(format('update private.claim_defective_stock set qty = 1 where order_item_id = %L', pg_temp.ds_id('item', 1)), 'defective_stock_ledger_immutable');
select pg_temp.ds_error(format('delete from private.claim_defective_stock where order_item_id = %L', pg_temp.ds_id('item', 1)), 'defective_stock_ledger_immutable');
select pg_temp.ds_error(format('insert into private.claim_defective_stock(claim_id, order_item_id, qty, planned_by) values (%L, %L, 2, %L)',
  pg_temp.ds_id('claim', 1), pg_temp.ds_id('item', 1), pg_temp.ds_id('user', 1)), '23505');

-- 7. 재고 대조: 불량 품목은 창고를 떠나 돌아오지 않은 수량으로 읽혀 판매 재고와 어긋나지 않는다 ------------------------------------
select 1/case when (select count(*) = 1 from public.audit_log where action = 'order.option_stock_restored' and target = 'order:'||pg_temp.ds_id('order', 1))
 and (select f.returned_since_qty = 0 and f.awaiting_return_qty = 0 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id = 'defective-stock-good-1' and is_default)], clock_timestamp() - interval '1 day') f)
 and (select f.returned_since_qty = 3 and f.awaiting_return_qty = 0 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id = 'defective-stock-good-2' and is_default)], clock_timestamp() - interval '1 day') f)
 then 1 else 0 end as reconcile_flows_do_not_count_defective_as_returned;

-- 8. 불량을 고르지 않으면 기존 동작 그대로: 주문 2는 선택 없이 전부 복원 ---------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_record_order_claim_refund(pg_temp.ds_id('claim', 2), 'pg_cancel', 'filed', null);
reset role;
select public.complete_order_cancellation_request(pg_temp.ds_id('claim', 2), array['TEST-DS-KEY-2'], pg_temp.ds_id('user', 1));
select 1/case when pg_temp.ds_stock(3) = 11
 and not exists(select 1 from private.claim_defective_stock where claim_id = pg_temp.ds_id('claim', 2))
 and exists(select 1 from public.audit_log where action = 'order.option_stock_restored' and target = 'order:'||pg_temp.ds_id('order', 2))
 then 1 else 0 end as no_choice_means_restore_as_before;
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when public.admin_record_claim_defective_stock(pg_temp.ds_id('claim', 2)) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 2), 'recorded', 0, 'total', 0, 'pending', 0)
 then 1 else 0 end as recording_without_choice_is_a_noop;
reset role;

-- 9. 거절된 클레임의 낡은 선택은 복원을 막지 않는다 ------------------------------------------------------------------------
-- 주문 4(상품1 ×2)는 거절돼 선택 행이 남아 있다. 이 주문을 직접 취소 복원 경로로 되돌려도 복원된다.
select private.restore_order_item_supply(pg_temp.ds_id('item', 5), 'TEST 거절된 클레임의 낡은 선택');
select 1/case when pg_temp.ds_stock(1) = 12 then 1 else 0 end as rejected_claim_choice_does_not_block_restore;


-- 10~15. 리뷰 수정: 무통장 얼림·기록 전제, 이중 복원 방어선, 미출고 거절, 교환 전환, 교환 뒤 반품 재고 대조 ------------------------------------
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id)
 select 'defective-stock-good-'||n, 'defective-stock-ip', 'TEST 불량재고 상품 '||n, '문구', 10000, 'ok', 10, pg_temp.ds_id('origin', 1)
 from generate_series(5, 10) n;
-- 주문 5(무통장 얼림: 상품5 ×2·상품6 ×1) · 6(이중 복원 방어: 상품7) · 7(미출고: 상품8) · 8(교환 전환: 상품5 ×1) · 9(교환 뒤 반품: 상품9→상품10 ×2)
insert into public.orders(id, user_id, status, total, shipping_fee, address, payment_method, created_at, delivered_at, shipped_at)
 select pg_temp.ds_id('order', n), pg_temp.ds_id('user', 2), 'delivered'::public.order_status, 30000, 0,
  '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
  'card'::public.order_payment_method, clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day',
  case when n = 7 then null else clock_timestamp() - interval '2 days' end from generate_series(5, 9) n;
insert into public.order_items(id, order_id, good_id, variant_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
 select pg_temp.ds_id('item', k.item), pg_temp.ds_id('order', k.ord), 'defective-stock-good-'||k.good, v.id, 'TEST 불량재고 상품 '||k.good, '문구', 'defective-stock-ip', k.qty, 10000
 from (values (6, 5, 5, 2), (7, 5, 6, 1), (8, 6, 7, 1), (9, 7, 8, 1), (10, 8, 5, 1), (11, 9, 9, 2)) k(item, ord, good, qty)
 join public.goods_variants v on v.good_id = 'defective-stock-good-'||k.good and v.is_default;
insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 select pg_temp.ds_id('payment', n), pg_temp.ds_id('user', 2), 'toss'::public.payment_provider, 'order', pg_temp.ds_id('order', n),
  30000, 'paid'::public.payment_status, 'TEST-DS-KEY-'||n, 'defective-stock-test-'||n, clock_timestamp() - interval '3 days' from generate_series(5, 9) n;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 select pg_temp.ds_id('claim', n), pg_temp.ds_id('order', n), pg_temp.ds_id('user', 2), 'TEST 불량 재고 검증', 'defect', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '2 days' from generate_series(5, 8) n;

-- 10. 무통장: 취소 확정(환불 행 생김) 뒤에는 선택을 바꿀 수 없고, 주문이 canceled가 되면 클레임이 처리완료 전이어도 기록된다 ----------------
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 5), array[pg_temp.ds_id('item', 6)]);
reset role;
insert into private.bank_transfer_claim_refunds(claim_id, order_id, payment_id, payer_id, amount, state, confirmation_operation_id, confirmed_by, confirmed_at,
  confirmation_evidence, confirmation_note)
 values (pg_temp.ds_id('claim', 5), pg_temp.ds_id('order', 5), pg_temp.ds_id('payment', 5), pg_temp.ds_id('user', 2), 30000, 'awaiting_transfer',
  pg_temp.ds_id('operation', 5), pg_temp.ds_id('user', 1), clock_timestamp(), 'TEST 증빙', 'TEST 메모');
set local role authenticated;
select pg_temp.ds_auth(1);
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, ''{}'')', pg_temp.ds_id('claim', 5)), 'defective_stock_claim_closed');
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.ds_id('claim', 5), pg_temp.ds_id('item', 7)), 'defective_stock_claim_closed');
select 1/case when (select (c->>'frozen')::boolean from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 5)])) c) then 1 else 0 end as bank_refund_row_freezes_the_choice;
-- 주문이 아직 canceled가 아니면 기록하지 않는다.
select pg_temp.ds_error(format('select public.admin_record_claim_defective_stock(%L)', pg_temp.ds_id('claim', 5)), 'defective_stock_claim_not_completed');
reset role;
-- [취소 확정]의 finalizer를 모사: 주문 canceled + 품목마다 복원 함수. 클레임 stage는 collected(송금 완료 전)로 둔다.
-- finalizer가 아닌 직접 갱신이라 결제 증빙 가드를 이 문장에서만 끈다(합성 데이터).
set local session_replication_role = replica;
update public.orders set status = 'canceled' where id = pg_temp.ds_id('order', 5);
set local session_replication_role = origin;
select private.restore_order_item_supply(pg_temp.ds_id('item', 6), 'TEST 무통장 취소 확정');
select private.restore_order_item_supply(pg_temp.ds_id('item', 7), 'TEST 무통장 취소 확정');
select 1/case when pg_temp.ds_stock(5) = 10 and pg_temp.ds_stock(6) = 11 then 1 else 0 end as bank_cancel_confirm_skips_the_defective_item;
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when jsonb_array_length(public.admin_list_defective_stock(50)->'pending') = 1 then 1 else 0 end as bank_choice_waits_for_record_after_cancel_confirm;
select 1/case when public.admin_record_claim_defective_stock(pg_temp.ds_id('claim', 5)) = jsonb_build_object('claimId', pg_temp.ds_id('claim', 5), 'recorded', 1, 'total', 1, 'pending', 0)
 then 1 else 0 end as bank_defective_is_recorded_right_after_cancel_confirm;
reset role;

-- 11. 방어선: 이미 복원된 품목은 기록할 수 없다(이중 계상 거절) -----------------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 6), array[pg_temp.ds_id('item', 8)]);
reset role;
-- finalizer가 아닌 직접 갱신이라 결제 증빙 가드를 이 문장에서만 끈다(합성 데이터).
set local session_replication_role = replica;
update public.orders set status = 'canceled' where id = pg_temp.ds_id('order', 6);
set local session_replication_role = origin;
insert into public.audit_log(actor_id, action, target, diff) values (pg_temp.ds_id('user', 1), 'order.option_stock_restored', 'order:'||pg_temp.ds_id('order', 6),
 jsonb_build_object('orderItemId', pg_temp.ds_id('item', 8), 'delta', 1));
set local role authenticated;
select pg_temp.ds_auth(1);
select pg_temp.ds_error(format('select public.admin_record_claim_defective_stock(%L)', pg_temp.ds_id('claim', 6)), 'defective_stock_item_already_restored');
reset role;

-- 12. 출고되지 않은 품목은 선택 칸에서 빠지고 선택도 거절한다 -------------------------------------------------------------------
set local role authenticated;
select pg_temp.ds_auth(1);
select pg_temp.ds_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.ds_id('claim', 7), pg_temp.ds_id('item', 9)), 'defective_stock_item_not_shipped');
select 1/case when jsonb_array_length(public.admin_claim_defective_items(array[pg_temp.ds_id('claim', 7)])->0->'items') = 0 then 1 else 0 end as unshipped_items_are_not_offered;
reset role;

-- 13. 반품 → 교환 전환: 낡은 선택은 복원을 막지 않고 기록 필요에도 뜨지 않으며, 같은 주문의 새 반품을 막지 않는다 -------------------------
insert into public.order_items(id, order_id, good_id, variant_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
 select pg_temp.ds_id('item', 12), pg_temp.ds_id('order', 8), 'defective-stock-good-6', v.id, 'TEST 불량재고 상품 6', '문구', 'defective-stock-ip', 1, 10000
 from public.goods_variants v where v.good_id = 'defective-stock-good-6' and v.is_default;
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 8), array[pg_temp.ds_id('item', 10), pg_temp.ds_id('item', 12)]);
reset role;
update public.order_cancellation_requests set claim_type = 'exchange' where id = pg_temp.ds_id('claim', 8);
select private.restore_order_item_supply(pg_temp.ds_id('item', 10), 'TEST 전환된 교환 클레임의 낡은 선택');
select 1/case when pg_temp.ds_stock(5) = 11 then 1 else 0 end as converted_claim_choice_does_not_block_restore;
update public.order_cancellation_requests set stage = 'rejected', status = 'rejected' where id = pg_temp.ds_id('claim', 8);
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 values (pg_temp.ds_id('claim', 10), pg_temp.ds_id('order', 8), pg_temp.ds_id('user', 2), 'TEST 전환 뒤 새 반품', 'defect', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '1 hour');
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 10), array[pg_temp.ds_id('item', 10)]);
reset role;
select 1/case when not exists(select 1 from private.claim_defective_stock where claim_id = pg_temp.ds_id('claim', 8) and order_item_id = pg_temp.ds_id('item', 10))
 and exists(select 1 from private.claim_defective_stock where claim_id = pg_temp.ds_id('claim', 10)) then 1 else 0 end as stale_choice_is_replaced_by_the_new_return;
-- 남은 낡은 행(품목 12)은 복원을 막지 않고 기록 필요에도 뜨지 않는다.
set local session_replication_role = replica;
update public.orders set status = 'canceled' where id = pg_temp.ds_id('order', 8);
set local session_replication_role = origin;
select private.restore_order_item_supply(pg_temp.ds_id('item', 12), 'TEST 낡은 선택');
select 1/case when pg_temp.ds_stock(6) = 12 then 1 else 0 end as stale_non_return_row_does_not_block_restore;
set local role authenticated;
select pg_temp.ds_auth(1);
select 1/case when not exists(select 1 from jsonb_array_elements(public.admin_list_defective_stock(50)->'pending') p where p->>'claimId' = pg_temp.ds_id('claim', 8)::text)
 then 1 else 0 end as stale_claim_is_not_pending;
reset role;

-- 14. 교환 뒤 반품: 교환 때 돌아온 V1 회수분은 반품의 불량 선택과 상관없이 '돌아온 수량'에 남는다 -----------------------------------------------
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at,
  reshipped_at, completed_at)
 values (pg_temp.ds_id('claim', 11), pg_temp.ds_id('order', 9), pg_temp.ds_id('user', 2), 'TEST 교환', 'defect', 'exchange', 'completed', 'legacy',
  clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 day', clock_timestamp() - interval '90 minutes', clock_timestamp() - interval '90 minutes');
insert into public.goods_variants(id, good_id, name, price, stock_qty, sort_order) values (pg_temp.ds_id('variant', 2), 'defective-stock-good-9', 'TEST 교환 옵션 V2', 10000, 10, 5);
insert into public.order_claim_reshipment_items(claim_id, order_item_id, good_id, source_variant_id, variant_id, variant_name_snapshot, variant_code_snapshot, qty)
 select pg_temp.ds_id('claim', 11), pg_temp.ds_id('item', 11), 'defective-stock-good-9', v1.id, pg_temp.ds_id('variant', 2), 'TEST 교환 옵션 V2', '', 2
 from public.goods_variants v1 where v1.good_id = 'defective-stock-good-9' and v1.is_default;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 values (pg_temp.ds_id('claim', 12), pg_temp.ds_id('order', 9), pg_temp.ds_id('user', 2), 'TEST 교환 뒤 반품', 'defect', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '1 hour');
create function pg_temp.ds_returned(v uuid) returns bigint language sql as $$
 select f.returned_since_qty from private.stock_reconcile_flows(array[v], clock_timestamp() - interval '3 hours') f$$;
select 1/case when pg_temp.ds_returned((select id from public.goods_variants where good_id = 'defective-stock-good-9' and is_default)) = 2 then 1 else 0 end as before_choice_exchange_pickup_counts_on_v1;
set local role authenticated;
select pg_temp.ds_auth(1);
select public.admin_plan_claim_defective_stock(pg_temp.ds_id('claim', 12), array[pg_temp.ds_id('item', 11)]);
reset role;
select 1/case when pg_temp.ds_returned((select id from public.goods_variants where good_id = 'defective-stock-good-9' and is_default)) = 2
 and pg_temp.ds_returned(pg_temp.ds_id('variant', 2)) = 0 then 1 else 0 end as defective_return_keeps_exchange_pickup_on_v1_and_excludes_only_its_own;

rollback;

-- 재고 부족 부분 취소(T12b, ADR-0032) 뒤 반품 불량(T14b): 불량 수량은 살아 있는 수량(order_item_active_qty)이다. 남은 수량이 없는 품목은
-- 고를 수 없고 목록에서 빠지며, 복원은 '불량이면 건너뜀, 아니면 남은 수량만'이다(웨이브 2 통합 5e). 합성 주문은
-- order_partial_cancellation.sql의 픽스처(-- END FIXTURE까지)를 그대로 쓴다 — 그 픽스처를 바꾸면 이 절도 함께 맞춘다.
begin;
create function pg_temp.pc_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-cancel:'||kind||':'||n)::uuid$$;
create function pg_temp.pc_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Partial cancellation assertion failed: %', label; end if; end $$;
create function pg_temp.pc_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected partial cancellation rejection: %', expected; end $$;
create function pg_temp.pc_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pc_id('user', actor),
  'session_id', pg_temp.pc_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.pc_id(text, integer), pg_temp.pc_assert(boolean, text), pg_temp.pc_error(text, text), pg_temp.pc_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pc_id('user', n), 'authenticated', 'authenticated', 'partial-cancel-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pc_id('session', n), pg_temp.pc_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 부분취소 '||right(id::text, 6),
 role = case when id = pg_temp.pc_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.pc_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pc_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.pc_id('origin', n), 'partial-cancel-origin-'||n, 'TEST 부분취소 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소', true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-cancel-ip', 'TEST 부분취소 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id) values
 ('partial-cancel-a', 'partial-cancel-ip', 'TEST 품절 상품 A', '문구', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-b', 'partial-cancel-ip', 'TEST 남는 상품 B', '문구', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-c', 'partial-cancel-ip', 'TEST 다른 출고지 상품 C', '문구', 5000, 'ok', 10, pg_temp.pc_id('origin', 2));
create function pg_temp.pc_stock(good text) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id = good and is_default$$;

-- 주문 n: A 2개(10,000원·쿠폰 1,000원) + B 1개(10,000원)는 출고지 1, C 1개(5,000원)는 출고지 2. 배송비 배송 건마다 3,000원.
-- 결제 40,000원 = 굿즈 결제 몫 34,000원 + 배송비 6,000원. n=8은 A에 적립금 2,000원(결제 38,000원).
-- provider: 1·2·5·6·8 토스, 3 무통장, 4 나이스페이, 7 토스(버전 1 주문 — 배분 원장 없음). 9 이후는 리뷰 보완 시험(9절)용이고
-- a_coupon(A 쿠폰)·b_coupon(B 쿠폰)·ship_fee(배송 건마다 배송비)·initial(시작 상태)로 금액·상태를 바꾼다.
create function pg_temp.pc_order(n integer, provider text, version integer default 2, a_coupon bigint default 1000, b_coupon bigint default 0,
  ship_fee bigint default 3000, initial text default 'confirmed') returns void language plpgsql as $$
declare credit bigint := case when n = 8 then 2000 else 0 end;
  total bigint := (20000 - a_coupon - credit) + (10000 - b_coupon) + 5000 + 2 * ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), initial::public.order_status, total, 2 * ship_fee, a_coupon + b_coupon, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   case when n = 2 then '2031-04-01T03:00:00Z'::timestamptz else '2031-03-01T03:00:00Z'::timestamptz end,
   case when initial = 'confirmed' then clock_timestamp() - interval '1 hour' end);
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pc_id('item-'||g.id, n), pg_temp.pc_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-a' then 2 else 1 end, g.price,
   g.name, '문구', 'partial-cancel-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-cancel-%';
 if version = 2 then
  -- 버전 2 주문은 거래 계약 묶음이 있어야 품목을 넣을 수 있다. 합성 주문은 품목을 넣은 뒤 버전을 올린다(배분 원장만 쓴다).
  update public.orders set calculation_version = 2 where id = pg_temp.pc_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.pc_id('item-partial-cancel-a', n), pg_temp.pc_id('order', n), 2, 20000, 0, 20000, a_coupon, credit, 20000 - a_coupon - credit),
   (pg_temp.pc_id('item-partial-cancel-b', n), pg_temp.pc_id('order', n), 2, 10000, 0, 10000, b_coupon, 0, 10000 - b_coupon),
   (pg_temp.pc_id('item-partial-cancel-c', n), pg_temp.pc_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pc_id('shipment-'||o, n), pg_temp.pc_id('order', n), pg_temp.pc_id('origin', o), 'TEST 부분취소 출고지 '||o, ship_fee, '{}' from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pc_id('shipment-'||case when i.good_id = 'partial-cancel-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pc_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pc_id('payment', n), pg_temp.pc_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pc_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pc_id('order', n) else 'TEST-PC-KEY-'||n end, 'partial-cancel-payment-'||n, clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pc_id('attempt', n), provider::public.payment_provider, pg_temp.pc_id('user', 2), 'order', pg_temp.pc_id('order', n), total, 'KRW', 'approved',
   'partial-cancel-attempt-'||n, 'TEST-PC-ORDER-'||n, 'TEST-PC-PRODUCT-'||n, pg_temp.pc_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
select pg_temp.pc_order(1, 'toss'), pg_temp.pc_order(2, 'toss'), pg_temp.pc_order(3, 'bank_transfer'), pg_temp.pc_order(4, 'nicepay'),
 pg_temp.pc_order(5, 'toss'), pg_temp.pc_order(6, 'toss'), pg_temp.pc_order(7, 'toss', 1), pg_temp.pc_order(8, 'toss');
-- 9: A 전액 할인(결제 몫 0원), 10: B 전액 할인·배송비 0원(A·C를 빼면 남는 잔액 0원), 17·18·24: 발주확인 전(paid), 20: 무통장, 나머지 토스.
select pg_temp.pc_order(9, 'toss', 2, 20000), pg_temp.pc_order(10, 'toss', 2, 1000, 10000, 0), pg_temp.pc_order(20, 'bank_transfer');
select pg_temp.pc_order(n, 'toss', 2, 1000, 0, 3000, 'paid') from unnest(array[17, 18, 24]) n;
select pg_temp.pc_order(n, 'toss') from unnest(array[11, 12, 13, 14, 15, 16, 19, 21, 22, 23]) n;
create function pg_temp.pc_items(spec text) returns jsonb language sql as $$
 -- 'a:1,c:1@2' → 주문 2의 A 1개·C 1개
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.pc_id('item-partial-cancel-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.pc_start(spec text, op integer, expected bigint, decision text default 'TEST 11/12 통화 — 품절 상품만 취소하고 나머지 먼저 받기',
  warehouse boolean default false, account jsonb default null) returns jsonb language sql as $$
 select public.admin_start_order_partial_cancellation(pg_temp.pc_id('order', split_part(spec, '@', 2)::integer), pg_temp.pc_items(spec), decision, null,
  warehouse, expected, pg_temp.pc_id('operation', op), account)$$;
create function pg_temp.pc_head(op integer) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where operation_id = pg_temp.pc_id('operation', op)$$;
grant execute on function pg_temp.pc_items(text), pg_temp.pc_start(text, integer, bigint, text, boolean, jsonb), pg_temp.pc_stock(text), pg_temp.pc_head(integer) to authenticated;
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST 부분 취소 뒤 반품 불량', partial_cancel_enabled_at = clock_timestamp() where singleton;
-- 주문 2·5: A 2개 중 1개를 재고 부족 부분 취소(결제사 확인 기록까지). 주문 6: A 2개 모두 부분 취소.
set local role authenticated; select pg_temp.pc_auth();
select pg_temp.pc_start('a:1@2', 31, 9500), pg_temp.pc_start('a:1@5', 32, 9500), pg_temp.pc_start('a:2@6', 33, 19000);
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.pc_head(31)).id, 9500, 'TEST-PC-KEY-2', 'TEST-PC-TX-31', pg_temp.pc_id('user', 1)),
 public.service_complete_order_partial_cancellation((pg_temp.pc_head(32)).id, 9500, 'TEST-PC-KEY-5', 'TEST-PC-TX-32', pg_temp.pc_id('user', 1)),
 public.service_complete_order_partial_cancellation((pg_temp.pc_head(33)).id, 19000, 'TEST-PC-KEY-6', 'TEST-PC-TX-33', pg_temp.pc_id('user', 1));
select pg_temp.pc_assert(private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 2)) = 1
 and private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 5)) = 1
 and private.order_item_active_qty(pg_temp.pc_id('item-partial-cancel-a', 6)) = 0, 'partial_cancel_leaves_live_qty');
update public.order_shipments s set status = 'shipping', shipped_at = now(), carrier = 'hanjin',
 tracking_number = 'TESTPD' || lpad((abs(hashtext(s.id::text)) % 100000000)::text, 8, '0')
 where order_id in (pg_temp.pc_id('order', 2), pg_temp.pc_id('order', 5), pg_temp.pc_id('order', 6)) and status = 'ready';
update public.order_shipments set status = 'delivered', delivered_at = now()
 where order_id in (pg_temp.pc_id('order', 2), pg_temp.pc_id('order', 5), pg_temp.pc_id('order', 6)) and status = 'shipping';
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 select pg_temp.pc_id('defect-claim', n), pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), 'TEST 부분 취소 뒤 반품', 'defect', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 hour' from unnest(array[2, 5, 6]) n;
select pg_temp.pc_auth();
-- 고를 수 있는 품목 목록의 수량은 살아 있는 수량이고, 남은 수량이 없는 품목(주문 6의 A)은 싣지 않는다.
select pg_temp.pc_assert((select (x->'items') @> jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pc_id('item-partial-cancel-a', 2), 'qty', 1))
   from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.pc_id('defect-claim', 2)])) x), 'defective_items_show_live_qty');
select pg_temp.pc_assert((select not ((x->'items') @> jsonb_build_array(jsonb_build_object('orderItemId', pg_temp.pc_id('item-partial-cancel-a', 6))))
   from jsonb_array_elements(public.admin_claim_defective_items(array[pg_temp.pc_id('defect-claim', 6)])) x), 'defective_items_hide_fully_canceled');
select pg_temp.pc_error(format('select public.admin_plan_claim_defective_stock(%L, array[%L]::uuid[])', pg_temp.pc_id('defect-claim', 6), pg_temp.pc_id('item-partial-cancel-a', 6)),
 'defective_stock_item_fully_canceled');
-- 주문 2: A를 불량으로 고르면 계획 수량은 살아 있는 수량 1이다.
select public.admin_plan_claim_defective_stock(pg_temp.pc_id('defect-claim', 2), array[pg_temp.pc_id('item-partial-cancel-a', 2)]);
select pg_temp.pc_assert((select qty from private.claim_defective_stock where claim_id = pg_temp.pc_id('defect-claim', 2)) = 1, 'planned_defective_qty_is_live_qty');
reset role;
create temp table pd_stock_before as select good_id, stock_qty from public.goods_variants where good_id like 'partial-cancel-%' and is_default;
update public.order_cancellation_requests set stage = 'processing', status = 'processing' where id in (pg_temp.pc_id('defect-claim', 2), pg_temp.pc_id('defect-claim', 5));
insert into public.order_cancellation_claims(order_id, requested_by, previous_status)
 select pg_temp.pc_id('order', n), pg_temp.pc_id('user', 1), 'delivered' from unnest(array[2, 5]) n;
select pg_temp.pc_auth();
select public.finalize_order_cancellation_with_provider_evidence(pg_temp.pc_id('order', 2), 'TEST 부분 취소 뒤 불량 반품', array['TEST-PC-KEY-2']);
-- 복원: 주문 2는 불량 A를 건너뛰고(재고 그대로) B·C는 1개씩 복원한다.
select pg_temp.pc_assert(pg_temp.pc_stock('partial-cancel-a') = (select stock_qty from pd_stock_before where good_id = 'partial-cancel-a')
 and pg_temp.pc_stock('partial-cancel-b') = (select stock_qty from pd_stock_before where good_id = 'partial-cancel-b') + 1
 and pg_temp.pc_stock('partial-cancel-c') = (select stock_qty from pd_stock_before where good_id = 'partial-cancel-c') + 1, 'defective_item_skips_restore_after_partial_cancel');
-- 확정 직후 기록(앱이 이어서 부른다). 기록 수량은 살아 있는 수량 1이다.
select pg_temp.pc_assert((public.admin_record_claim_defective_stock(pg_temp.pc_id('defect-claim', 2)))->>'recorded' = '1', 'defective_record_after_finalize');
select pg_temp.pc_assert((select qty from private.claim_defective_stock where claim_id = pg_temp.pc_id('defect-claim', 2) and state = 'recorded') = 1
 and (select (diff->>'qty')::integer from public.audit_log where action = 'order.claim_defective_stock_recorded'
   and diff->>'claimId' = pg_temp.pc_id('defect-claim', 2)::text) = 1, 'recorded_defective_qty_is_live_qty');
-- 주문 5: 불량이 아니면 A는 남은 수량(1)만 복원한다(부분 취소분은 이미 복원했다).
select public.finalize_order_cancellation_with_provider_evidence(pg_temp.pc_id('order', 5), 'TEST 부분 취소 뒤 반품', array['TEST-PC-KEY-5']);
select pg_temp.pc_assert(pg_temp.pc_stock('partial-cancel-a') = (select stock_qty from pd_stock_before where good_id = 'partial-cancel-a') + 1
 and pg_temp.pc_stock('partial-cancel-b') = (select stock_qty from pd_stock_before where good_id = 'partial-cancel-b') + 2, 'non_defective_restores_only_live_qty');
select pg_temp.pc_assert((select count(*) from public.audit_log where action = 'order.option_stock_restored' and target = 'order:' || pg_temp.pc_id('order', 2)::text
   and diff->>'orderItemId' = pg_temp.pc_id('item-partial-cancel-a', 2)::text) = 0
 and (select (diff->>'delta')::integer from public.audit_log where action = 'order.option_stock_restored' and target = 'order:' || pg_temp.pc_id('order', 5)::text
   and diff->>'orderItemId' = pg_temp.pc_id('item-partial-cancel-a', 5)::text) = 1, 'restore_audit_matches_live_qty');
rollback;
