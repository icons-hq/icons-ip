\set ON_ERROR_STOP on
-- Prepend supabase/tests/helpers/goods_kc_fixture.sql in the same psql session.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
create function pg_temp.approve_preorder_fixture(p_order_id uuid,p_user_id uuid,p_claim_id uuid,p_provider_key text) returns void
language plpgsql as $$ declare attempt public.payment_attempts; begin
  perform public.prepare_goods_payment_attempt(p_user_id,p_order_id,'toss');
  select * into attempt from public.payment_attempts where ref_id=p_order_id order by created_at desc limit 1;
  perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('a',64));
  perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('a',64),p_claim_id);
  if public.finalize_goods_payment_attempt(attempt.id,p_claim_id,'approved',null,p_provider_key)<>'approved' then raise exception 'synthetic approval must complete'; end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000048501','authenticated','authenticated','preorder-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048502','authenticated','authenticated','preorder-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048503','authenticated','authenticated','preorder-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048504','authenticated','authenticated','preorder-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='예약관리8501' where id='00000000-0000-4000-8000-000000048501';
update public.profiles set role='staff',nickname='예약운영8502' where id='00000000-0000-4000-8000-000000048502';
update public.profiles set nickname='예약구매'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000048503','00000000-0000-4000-8000-000000048504');
insert into public.verticals(key,label,color) values('preorder-tests','예약판매 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('preorder-tests','예약판매 검증','preorder-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('00000000-0000-4000-8000-000000048530','preorder-tests-one','검증 출고지 1','hanjin',3000,null,'배송 금지 검증 주소 1',true),
 ('00000000-0000-4000-8000-000000048531','preorder-tests-two','검증 출고지 2','hanjin',4000,null,'배송 금지 검증 주소 2',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048502',true);
select public.admin_save_good('{"id":"preorder-supply","ip_id":"preorder-tests","name":"예약 공급 상품","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PREORDER-BASE","attributes":{},"extraPrice":0,"stockQty":0},
 {"name":"늦은 옵션","code":"PREORDER-LATER","attributes":{"구성":"늦은 옵션"},"extraPrice":1000,"stockQty":0}]}');
select public.admin_save_good('{"id":"preorder-normal","ip_id":"preorder-tests","name":"같은 출고지 일반 상품","price":5000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PREORDER-NORMAL","attributes":{},"extraPrice":0,"stockQty":20}]}');
select public.admin_save_good('{"id":"preorder-separate","ip_id":"preorder-tests","name":"다른 출고지 일반 상품","price":7000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PREORDER-SEPARATE","attributes":{},"extraPrice":0,"stockQty":20}]}');
select id as base_variant from public.goods_variants where good_id='preorder-supply' and is_default \gset
select id as later_variant from public.goods_variants where good_id='preorder-supply' and not is_default \gset
select id as normal_variant from public.goods_variants where good_id='preorder-normal' \gset
select id as separate_variant from public.goods_variants where good_id='preorder-separate' \gset
select public.admin_save_goods_preorder('preorder-supply',:'base_variant',null,
 '{"state":"draft","capacityQty":null,"startsAt":null,"endsAt":null,"expectedShipDate":null,"approvalReference":null}')->>'id' as base_policy \gset
select pg_temp.expect_error(format('select public.admin_save_goods_preorder(%L,%L,%L,%L::jsonb,1)',
 'preorder-supply',:'base_variant',:'base_policy','{"state":"active"}'),'preorder_admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048501',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorder(%L,%L,%L,%L::jsonb,1)',
 'preorder-supply',:'base_variant',:'base_policy','{"state":"active"}'),'preorder_policy_not_configured','23514');
select 1/case when public.admin_list_goods_preorders('preorder-supply')#>'{0,capacityQty}'='null'::jsonb
 and public.admin_list_goods_preorders('preorder-supply')#>'{0,remainingQty}'='null'::jsonb
 then 1 else 0 end as assert_missing_supply_is_not_zero_or_unlimited;
select public.admin_save_goods_preorder('preorder-supply',:'base_variant',:'base_policy',jsonb_build_object('state','active','capacityQty',3,
 'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,
 'approvalReference','TEST-ONLY 공급 승인 3개'),1);
select public.admin_save_goods_preorder('preorder-supply',:'later_variant',null,jsonb_build_object('state','active','capacityQty',2,
 'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedShipDate',(now() at time zone 'Asia/Seoul')::date+10,
 'approvalReference','TEST-ONLY 공급 승인 2개'))->>'id' as later_policy \gset
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/preorder-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id=case when id='preorder-separate'
 then '00000000-0000-4000-8000-000000048531'::uuid else '00000000-0000-4000-8000-000000048530'::uuid end
 where id in ('preorder-supply','preorder-normal','preorder-separate');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('preorder-supply','preorder-normal','preorder-separate');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048501',true);
select 1/case when (select public.goods_sale_available_qty(good) from public.goods good where good.id='preorder-supply')=5
 then 1 else 0 end as assert_admin_sale_readiness_uses_preorder_capacity;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set stock='soldout' where id='preorder-supply';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048501',true);
select 1/case when (select public.goods_sale_available_qty(jsonb_populate_record(null::public.goods,to_jsonb(good)||'{"stock":"ok"}'::jsonb))
 from public.goods good where good.id='preorder-supply')=0 then 1 else 0 end as assert_sale_readiness_reloads_manual_stop;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set stock='ok' where id='preorder-supply';
select 1/case when (select state from private.resolve_goods_variant_supply(:'base_variant',now()-interval '1 hour' - interval '1 microsecond'))='scheduled'
 and (select available_qty from private.resolve_goods_variant_supply(:'base_variant',now()-interval '1 hour'))=3
 and (select state from private.resolve_goods_variant_supply(:'base_variant',now()+interval '1 hour'))='closed'
 and (select available_qty from private.resolve_goods_variant_supply(:'base_variant',now()+interval '1 hour'))=0
 then 1 else 0 end as assert_preorder_half_open_window;
set local role anon;
select 1/case when (select public.goods_variant_supply(variant)->>'availableQty' from public.goods_variants variant where id=:'base_variant')='3'
 and (select stock_qty from public.goods_variants where id=:'base_variant')=0
 and (select stock_qty from public.goods where id='preorder-supply')=0
 then 1 else 0 end as assert_public_capacity_does_not_invent_physical_stock;
select pg_temp.expect_error($sql$select public.admin_list_goods_preorders('preorder-supply')$sql$,'permission denied','42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048503',true);
select public.set_cart_item_quantity('preorder-supply',:'base_variant',2);
select public.place_order('{"recipientName":"예약 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048520'::uuid,'card'::public.order_payment_method) as canceled_order \gset
reset role;
select public.finalize_order_cancellation_with_provider_evidence(:'canceled_order'::uuid,'합성 미입고 취소','{}'::text[]);
select public.finalize_order_cancellation_with_provider_evidence(:'canceled_order'::uuid,'합성 미입고 취소','{}'::text[]);
select 1/case when private.goods_preorder_remaining(:'base_policy')=3 and (select stock_qty from public.goods_variants where id=:'base_variant')=0
 and exists(select 1 from private.goods_preorder_reservations where order_id=:'canceled_order' and state='released')
 then 1 else 0 end as assert_unreceived_cancel_restores_capacity_only_once;

set local role authenticated;
select public.set_cart_item_quantity('preorder-supply',:'base_variant',2);
select public.set_cart_item_quantity('preorder-supply',:'later_variant',1);
select public.set_cart_item_quantity('preorder-normal',:'normal_variant',1);
select public.set_cart_item_quantity('preorder-separate',:'separate_variant',1);
select public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','preorder-supply','variantId',:'base_variant','qty',2),
 jsonb_build_object('goodId','preorder-supply','variantId',:'later_variant','qty',1),jsonb_build_object('goodId','preorder-normal','variantId',:'normal_variant','qty',1),
 jsonb_build_object('goodId','preorder-separate','variantId',:'separate_variant','qty',1))) as mixed_quote \gset
select public.place_order('{"recipientName":"예약 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048521'::uuid,'card'::public.order_payment_method) as mixed_order \gset
reset role;
select id as together_shipment from public.order_shipments where order_id=:'mixed_order' and origin_id='00000000-0000-4000-8000-000000048530' \gset
select id as separate_shipment from public.order_shipments where order_id=:'mixed_order' and origin_id='00000000-0000-4000-8000-000000048531' \gset
select id as base_item from public.order_items where order_id=:'mixed_order' and variant_id=:'base_variant' \gset
select id as later_item from public.order_items where order_id=:'mixed_order' and variant_id=:'later_variant' \gset
select 1/case when (select count(*) from public.order_shipments where order_id=:'mixed_order')=2
 and (select total=50000 and shipping_fee=7000 and discount_total=0 and store_credit_total=0 from public.orders where id=:'mixed_order')
 and (select original_expected_ship_date=(now() at time zone 'Asia/Seoul')::date+10 and expected_ship_date=original_expected_ship_date
   from public.order_shipments where id=:'together_shipment')
 and (select original_expected_ship_date is null and expected_ship_date is null from public.order_shipments where id=:'separate_shipment')
 and exists(select 1 from jsonb_array_elements(:'mixed_quote'::jsonb#>'{shipping,groups}') group_row where group_row->>'originId'='00000000-0000-4000-8000-000000048530'
   and (group_row->>'hasPreorder')::boolean and (group_row->>'hasStockItems')::boolean and (group_row->>'expectedShipDate')::date=(now() at time zone 'Asia/Seoul')::date+10)
 and (select bool_and((line->>'available')::boolean) from jsonb_array_elements(:'mixed_quote'::jsonb->'lines') line)
 then 1 else 0 end as assert_mixed_origin_prices_and_latest_promise;
select 1/case when private.goods_preorder_remaining(:'base_policy')=1 and private.goods_preorder_remaining(:'later_policy')=1
 and (select stock_qty from public.goods_variants where id=:'base_variant')=0 and (select stock_qty from public.goods_variants where id=:'later_variant')=0
 and (select stock_qty from public.goods_variants where id=:'normal_variant')=19
 then 1 else 0 end as assert_pending_reserves_only_its_supply_source;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048504',true);
select public.merge_cart_items(jsonb_build_array(jsonb_build_object('good_id','preorder-supply','variant_id',:'base_variant','qty',2)));
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"예약 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048522'::uuid,'card'::public.order_payment_method)$sql$,'preorder_capacity_exceeded','23514');
select public.set_cart_item_quantity('preorder-supply',:'base_variant',0);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048502',true);
select public.admin_save_goods_preorder('preorder-supply',:'base_variant',:'base_policy','{"state":"stopped"}',2);
select pg_temp.expect_error(format('select public.admin_use_stock_supply(%L,%L,%L,3)','preorder-supply',:'base_variant',:'base_policy'),
 'preorder_admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048501',true);
select pg_temp.expect_error(format('select public.admin_use_stock_supply(%L,%L,%L,3)','preorder-supply',:'base_variant',:'base_policy'),
 'preorder_allocations_pending','23514');
reset role;
select pg_temp.approve_preorder_fixture(:'mixed_order','00000000-0000-4000-8000-000000048503','00000000-0000-4000-8000-000000048540','TEST-PREORDER-MIXED');
select 1/case when (select status='paid' from public.orders where id=:'mixed_order')
 and private.goods_order_snapshot_matches(:'mixed_order',50000,7000)
 then 1 else 0 end as assert_stopped_new_sales_does_not_invalidate_reserved_payment;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048502',true);
select public.admin_update_order_status(:'mixed_order','confirmed',null,null);
select pg_temp.expect_error(format('select public.admin_shipment_export(array[%L::uuid])',:'together_shipment'),'preorder_allocation_required','23514');
select pg_temp.expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'together_shipment','shipping','hanjin','100048501'),
 'preorder_allocation_required','23514');
select public.admin_shipment_export(array[:'separate_shipment'::uuid]);
select public.admin_update_shipment_status(:'separate_shipment','shipping','hanjin','100048502');
select 1/case when (select status='shipping' from public.order_shipments where id=:'separate_shipment')
 and (select status='ready' from public.order_shipments where id=:'together_shipment')
 then 1 else 0 end as assert_other_origin_can_dispatch_independently;
select pg_temp.expect_error(format('select public.admin_allocate_goods_preorders(%L,array[%L::uuid,%L::uuid],%L::jsonb,%L)',
 'preorder-supply',:'base_item',:'later_item',jsonb_build_object(:'base_variant',0,:'later_variant',0)::text,'TEST-ONLY 미입고'),
 'preorder_physical_stock_shortfall','23514');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000048550','preorder-supply',:'base_variant',0,2,'TEST-ONLY 실입고 기본 2개');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000048551','preorder-supply',:'later_variant',0,1,'TEST-ONLY 실입고 늦은 옵션 1개');
select pg_temp.expect_error(format('select public.admin_allocate_goods_preorders(%L,array[%L::uuid,%L::uuid],%L::jsonb,%L)',
 'preorder-supply',:'base_item',:'later_item',jsonb_build_object(:'base_variant',0,:'later_variant',0)::text,'TEST-ONLY 오래된 재고'),
 'preorder_physical_stock_changed','PT409');
select public.admin_allocate_goods_preorders('preorder-supply',array[:'base_item'::uuid,:'later_item'::uuid],
 jsonb_build_object(:'base_variant',2,:'later_variant',1),'TEST-ONLY 실입고 증빙 A');
select public.admin_allocate_goods_preorders('preorder-supply',array[:'base_item'::uuid,:'later_item'::uuid],
 jsonb_build_object(:'base_variant',2,:'later_variant',1),'TEST-ONLY 중복 재시도');
select public.admin_shipment_export(array[:'together_shipment'::uuid]);
reset role;
select 1/case when (select stock_qty from public.goods_variants where id=:'base_variant')=0 and (select stock_qty from public.goods_variants where id=:'later_variant')=0
 and private.goods_preorder_remaining(:'base_policy')=1 and private.goods_preorder_remaining(:'later_policy')=1
 and (select count(*) from private.goods_preorder_reservations where order_id=:'mixed_order' and state='allocated' and allocation_reference='TEST-ONLY 실입고 증빙 A')=2
 then 1 else 0 end as assert_allocation_moves_only_real_stock_once;
select updated_at as expected_shipment_version from public.order_shipments where id=:'together_shipment' \gset
set local role authenticated;
select public.admin_change_shipment_preorder_date(:'together_shipment',(now() at time zone 'Asia/Seoul')::date+12,'TEST-ONLY 공급 일정 변경',:'expected_shipment_version');
select pg_temp.expect_error(format('select public.admin_change_shipment_preorder_date(%L,%L,%L,%L)',:'together_shipment',
 ((now() at time zone 'Asia/Seoul')::date+13)::text,'TEST-ONLY 오래된 화면',:'expected_shipment_version'),'shipment_promise_changed','PT409');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048503',true);
select public.place_order('{"recipientName":"예약 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048521'::uuid,'card'::public.order_payment_method);
reset role;
select 1/case when (select original_expected_ship_date=(now() at time zone 'Asia/Seoul')::date+10 and expected_ship_date=(now() at time zone 'Asia/Seoul')::date+12
 from public.order_shipments where id=:'together_shipment')
 and (select preorder_expected_ship_date=(now() at time zone 'Asia/Seoul')::date+7 from public.order_items where id=:'base_item')
 and (select count(*) from private.order_shipment_promise_changes where shipment_id=:'together_shipment')=1
 then 1 else 0 end as assert_replay_preserves_original_and_changed_promises;
select pg_temp.expect_error(format('update public.order_items set preorder_expected_ship_date=preorder_expected_ship_date+1 where id=%L',:'base_item'),
 'order_supply_snapshot_immutable','23514');
update public.orders set confirmed_at=now()-interval '4 days' where id=:'mixed_order';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048502',true);
select 1/case when not exists(select 1 from jsonb_array_elements(public.admin_search_shipments('delayed','00000000-0000-4000-8000-000000048530',null,null,null,100,0)->'rows') row
 where row->>'id'=:'together_shipment') then 1 else 0 end as assert_future_preorder_is_not_three_day_delay;
select public.admin_update_shipment_status(:'together_shipment','shipping','hanjin','100048503');

-- Allocate and refund a separate unshipped order: physical stock returns, future
-- approved capacity remains consumed. Its repeated finalizer cannot restore twice.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048504',true);
select public.set_cart_item_quantity('preorder-supply',:'later_variant',1);
select public.place_order('{"recipientName":"예약 환불","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048523'::uuid,'card'::public.order_payment_method) as refund_order \gset
reset role;
select id as refund_item from public.order_items where order_id=:'refund_order' \gset
select pg_temp.approve_preorder_fixture(:'refund_order','00000000-0000-4000-8000-000000048504','00000000-0000-4000-8000-000000048541','TEST-PREORDER-REFUND');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048502',true);
select public.admin_adjust_stock('00000000-0000-4000-8000-000000048552','preorder-supply',:'later_variant',0,1,'TEST-ONLY 추가 실입고 1개');
select public.admin_allocate_goods_preorders('preorder-supply',array[:'refund_item'::uuid],jsonb_build_object(:'later_variant',1),'TEST-ONLY 실입고 증빙 B');
reset role;
select public.finalize_order_cancellation_with_provider_evidence(:'refund_order'::uuid,'합성 전액 환불',array['TEST-PREORDER-REFUND']);
select public.finalize_order_cancellation_with_provider_evidence(:'refund_order'::uuid,'합성 전액 환불',array['TEST-PREORDER-REFUND']);
select 1/case when private.goods_preorder_remaining(:'later_policy')=0 and (select stock_qty from public.goods_variants where id=:'later_variant')=1
 and exists(select 1 from private.goods_preorder_reservations where order_id=:'refund_order' and state='returned')
 and (select public.goods_variant_supply(variant)->>'availableQty' from public.goods_variants variant where id=:'later_variant')='0'
 then 1 else 0 end as assert_allocated_refund_never_double_restores_supply;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048501',true);
select public.admin_save_goods_preorder('preorder-supply',:'later_variant',:'later_policy','{"state":"stopped"}',1);
select public.admin_use_stock_supply('preorder-supply',:'later_variant',:'later_policy',2);
select 1/case when (select public.goods_variant_supply(variant)->>'mode' from public.goods_variants variant where id=:'later_variant')='stock'
 and (select public.goods_variant_supply(variant)->>'availableQty' from public.goods_variants variant where id=:'later_variant')='1'
 then 1 else 0 end as assert_only_explicit_admin_switch_resumes_physical_sales;
rollback;
