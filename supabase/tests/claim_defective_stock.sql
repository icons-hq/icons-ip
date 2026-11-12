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
select pg_temp.ds_error(format('select public.admin_record_claim_defective_stock(%L)', pg_temp.ds_id('claim', 3)), 'defective_stock_return_only');
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

rollback;
