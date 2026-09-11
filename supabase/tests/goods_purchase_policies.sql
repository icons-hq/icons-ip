\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;

create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047601','authenticated','authenticated','sales-policy-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047602','authenticated','authenticated','sales-policy-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047603','authenticated','authenticated','sales-policy-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000047601';
update public.profiles set nickname='구매정책'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000047602','00000000-0000-4000-8000-000000047603');
insert into public.verticals(key,label,color) values('sales-policy-tests','판매 조건 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('sales-policy-tests','판매 조건 검증','sales-policy-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000047630','sales-policy-tests','검증 출고지','hanjin',3000,20000,'배송 금지 검증 주소',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047601',true);
select public.admin_save_good('{"id":"sales-policy-main","ip_id":"sales-policy-tests","name":"판매 정책 검증","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"SALE-POLICY-01","attributes":{},"extraPrice":0,"stockQty":100},
 {"name":"파랑","code":"SALE-POLICY-02","attributes":{"색상":"파랑"},"extraPrice":2000,"stockQty":100}],
 "allow_card_payment":true,"allow_bank_transfer":false,"sale_restriction":"none",
 "order_quantity_limit_enabled":false,"min_order_qty":2,"max_order_qty":4,
 "member_purchase_limit_enabled":false,"member_lifetime_qty_limit":5}');
select public.admin_save_good('{"id":"sales-policy-bank","ip_id":"sales-policy-tests","name":"무통장 전용 검증","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"SALE-POLICY-BANK","attributes":{},"extraPrice":0,"stockQty":100}],
 "allow_card_payment":false,"allow_bank_transfer":true,"sale_restriction":"none"}');
select public.admin_save_good('{"id":"sales-policy-free","ip_id":"sales-policy-tests","name":"기존 0원 품목 검증","price":0,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"SALE-POLICY-FREE","attributes":{},"extraPrice":0,"stockQty":10}]}');
select id as default_variant from public.goods_variants where good_id='sales-policy-main' and is_default \gset
select id as other_variant from public.goods_variants where good_id='sales-policy-main' and not is_default \gset
select id as bank_variant from public.goods_variants where good_id='sales-policy-bank' \gset
select id as free_variant from public.goods_variants where good_id='sales-policy-free' \gset
select public.admin_save_goods_price_period('sales-policy-free',:'free_variant',null,
 '{"state":"draft","discountPrice":null,"startsAt":null,"endsAt":null}');
select 1/case when exists(select 1 from public.goods where id='sales-policy-main' and not allow_bank_transfer
 and not order_quantity_limit_enabled and min_order_qty=2 and max_order_qty=4 and member_lifetime_qty_limit=5)
 and exists(select 1 from public.goods where id='sales-policy-bank' and not allow_card_payment and allow_bank_transfer)
 then 1 else 0 end as assert_saved_disabled_drafts_and_method_combinations;

select pg_temp.expect_error($sql$select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"max_order_qty":0}')$sql$,
 'invalid_goods_sales_policy','23514');
select pg_temp.expect_error($sql$select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"order_quantity_limit_enabled":true,"max_order_qty":null}')$sql$,
 'goods_order_quantity_activation','23514');
select pg_temp.expect_error($sql$select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"member_purchase_limit_enabled":true,"member_lifetime_qty_limit":null}')$sql$,
 'goods_member_quantity_activation','23514');
select pg_temp.expect_error($sql$select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"sale_restriction":"unreviewed"}')$sql$,
 'invalid_goods_sales_policy','23514');
select public.admin_save_good(pg_temp.good_payload('sales-policy-main') - array['allow_bank_transfer','allow_card_payment','sale_restriction',
 'order_quantity_limit_enabled','min_order_qty','max_order_qty','member_purchase_limit_enabled','member_lifetime_qty_limit']);
select 1/case when exists(select 1 from public.goods where id='sales-policy-main' and not allow_bank_transfer and min_order_qty=2 and member_lifetime_qty_limit=5)
 then 1 else 0 end as assert_omitted_policy_fields_are_preserved;

select public.admin_save_goods_price_period('sales-policy-main',:'default_variant',null,
 '{"state":"draft","discountPrice":null,"startsAt":null,"endsAt":null}')->>'id' as draft_period \gset
select pg_temp.expect_error(format('select public.admin_save_goods_price_period(%L,%L,%L,%L,1)',
 'sales-policy-main',:'default_variant',:'draft_period','{"state":"active","discountPrice":null,"startsAt":null,"endsAt":null}'),
 'price_period_not_configured','23514');
select public.admin_save_goods_price_period('sales-policy-main',:'other_variant',null,
 '{"state":"active","discountPrice":10000,"startsAt":"2099-01-01T00:00:00Z","endsAt":"2099-01-02T00:00:00Z"}')->>'id' as future_period \gset
select public.admin_save_goods_price_period('sales-policy-main',:'other_variant',null,
 '{"state":"active","discountPrice":10000,"startsAt":"2099-01-02T00:00:00Z","endsAt":"2099-01-03T00:00:00Z"}');
select pg_temp.expect_error(format('select public.admin_save_goods_price_period(%L,%L,null,%L)',
 'sales-policy-main',:'other_variant','{"state":"active","discountPrice":9000,"startsAt":"2099-01-01T23:59:59Z","endsAt":"2099-01-03T00:00:00Z"}'),
 'price_period_overlap','23P01');
select public.admin_save_goods_price_period('sales-policy-main',:'default_variant',null,
 jsonb_build_object('state','active','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'))->>'id' as active_period \gset
select pg_temp.expect_error(format('select public.admin_save_goods_price_period(%L,%L,%L,%L,0)',
 'sales-policy-main',:'default_variant',:'active_period',jsonb_build_object('state','disabled','discountPrice',8000,
 'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour')::text),'price_period_changed','PT409');

reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select effective_price from private.resolve_goods_variant_price(:'other_variant','2098-12-31T23:59:59.999999Z'))=12000
 and (select effective_price from private.resolve_goods_variant_price(:'other_variant','2099-01-01T00:00:00Z'))=10000
 and (select effective_price from private.resolve_goods_variant_price(:'other_variant','2099-01-01T23:59:59.999999Z'))=10000
 and (select price_period_id from private.resolve_goods_variant_price(:'other_variant','2099-01-02T00:00:00Z'))<>:'future_period'::uuid
 and (select effective_price from private.resolve_goods_variant_price(:'other_variant','2099-01-03T00:00:00Z'))=12000
 then 1 else 0 end as assert_half_open_period_boundaries;
select pg_temp.expect_error(format('update public.goods_variants set price=11000 where id=%L',:'default_variant'),
 'active_price_period_requires_reset','23514');
update public.goods set type='문구',image_path='public-media/sales-policy-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000047630'
 where id in ('sales-policy-main','sales-policy-bank','sales-policy-free');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('sales-policy-main','sales-policy-bank','sales-policy-free');

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select public.goods_variant_pricing(variant)->>'effectivePrice' from public.goods_variants variant where id=:'default_variant')='8000'
 then 1 else 0 end as assert_public_computed_price;
select 1/case when (public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',2)))
 #>>'{goods,0,memberReservedQty}') is null then 1 else 0 end as assert_anonymous_quote_has_no_member_history;
select pg_temp.expect_error($sql$select public.admin_list_goods_price_periods('sales-policy-main')$sql$,'permission denied','42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.goods_variant_price_periods','select,insert,update,delete')
 and not has_table_privilege('service_role','private.goods_variant_price_periods','select,insert,update,delete')
 and not has_function_privilege('authenticated','private.resolve_goods_variant_price(uuid,timestamptz)','execute')
 and not has_function_privilege('service_role','private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)','execute')
 then 1 else 0 end as assert_private_economics_are_sealed;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047602',true);
select pg_temp.expect_error($sql$select public.admin_list_goods_price_periods('sales-policy-main')$sql$,'staff_required','42501');
select public.set_cart_item_quantity('sales-policy-main',:'default_variant',2);
select public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',2))) as shipping_quote \gset
reset role;
select 1/case when private.cart_subtotal('00000000-0000-4000-8000-000000047602')=16000 then 1 else 0 end as assert_coupon_subtotal_uses_period_price;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000047602',
 '{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}',
 '00000000-0000-4000-8000-000000047620','card') as first_order \gset
reset role;
select 1/case when exists(select 1 from public.order_items where order_id=:'first_order' and qty=2 and unit_price=8000
 and regular_unit_price_snapshot=10000 and price_period_id=:'active_period' and price_evaluated_at is not null
 and sales_policy_snapshot->>'memberPurchaseLimitEnabled'='false')
 and exists(select 1 from public.orders where id=:'first_order' and total=19000 and shipping_fee=3000)
 and (:'shipping_quote'::jsonb->>'totalFee')::integer=3000
 then 1 else 0 end as assert_order_shipping_and_price_snapshots;

-- Actual payment seam: an unknown result keeps the pending order and its quantity.
select public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000047602',:'first_order','toss') as first_attempt \gset
select public.bind_goods_payment_callback_nonce((:'first_attempt'::jsonb->>'id')::uuid,repeat('6',64));
select public.claim_goods_payment_attempt('toss',:'first_attempt'::jsonb->>'provider_order_id',repeat('6',64),'00000000-0000-4000-8000-000000047640');
select public.finalize_goods_payment_attempt((:'first_attempt'::jsonb->>'id')::uuid,'00000000-0000-4000-8000-000000047640','unknown');
update public.orders set expires_at=now()-interval '1 minute' where id=:'first_order';
select 1/case when private.member_goods_reserved_qty('00000000-0000-4000-8000-000000047602','sales-policy-main')=2
 then 1 else 0 end as assert_expired_ambiguous_attempt_keeps_reservation;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047601',true);
select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"order_quantity_limit_enabled":true,"member_purchase_limit_enabled":true}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047602',true);
select public.set_cart_item_quantity('sales-policy-main',:'default_variant',1);
select 1/case when public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',1)))
 #>>'{goods,0,reason}'='order_quantity_below_minimum' then 1 else 0 end as assert_cart_minimum_feedback;
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047621'::uuid,'card'::public.order_payment_method)$sql$,'order_quantity_below_minimum','23514');
select public.set_cart_item_quantity('sales-policy-main',:'default_variant',3);
select public.set_cart_item_quantity('sales-policy-main',:'other_variant',2);
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047622'::uuid,'card'::public.order_payment_method)$sql$,'order_quantity_above_maximum','23514');
select public.set_cart_item_quantity('sales-policy-main',:'other_variant',1);
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047623'::uuid,'card'::public.order_payment_method)$sql$,'member_purchase_limit_exceeded','23514');
select 1/case when public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',4)))
 #>>'{goods,0,memberReservedQty}'='2' then 1 else 0 end as assert_orders_before_activation_are_included;

select public.set_cart_item_quantity('sales-policy-main',:'default_variant',2);
select public.set_cart_item_quantity('sales-policy-bank',:'bank_variant',1);
select 1/case when public.quote_goods_sales(jsonb_build_array(
 jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',2),
 jsonb_build_object('goodId','sales-policy-bank','variantId',:'bank_variant','qty',1)))
 ->'paymentMethods'='{"card":false,"bankTransfer":false}'::jsonb then 1 else 0 end as assert_mixed_payment_intersection_is_empty;
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047624'::uuid,'card'::public.order_payment_method)$sql$,'card payment blocked','23514');
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047625'::uuid,'bank_transfer'::public.order_payment_method)$sql$,'bank transfer blocked','23514');
select public.set_cart_item_quantity('sales-policy-bank',:'bank_variant',0);
select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047626'::uuid,'card'::public.order_payment_method) as second_order \gset
select 1/case when public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047626'::uuid,'card'::public.order_payment_method)=:'second_order'::uuid then 1 else 0 end as assert_checkout_retry_does_not_reserve_twice;
reset role;
select 1/case when private.member_goods_reserved_qty('00000000-0000-4000-8000-000000047602','sales-policy-main')=5
 and (select count(*) from public.order_items where order_id=:'second_order')=2
 and (select sum(qty*unit_price) from public.order_items where order_id=:'second_order')=28000
 then 1 else 0 end as assert_all_options_share_one_member_limit;

-- A verified declined attempt is still not a canceled order: only the existing
-- whole-order cancellation finalizer releases the reservation, exactly once.
select public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000047602',:'second_order','toss') as second_attempt \gset
select public.bind_goods_payment_callback_nonce((:'second_attempt'::jsonb->>'id')::uuid,repeat('7',64));
select public.claim_goods_payment_attempt('toss',:'second_attempt'::jsonb->>'provider_order_id',repeat('7',64),'00000000-0000-4000-8000-000000047641');
select public.finalize_goods_payment_attempt((:'second_attempt'::jsonb->>'id')::uuid,'00000000-0000-4000-8000-000000047641','declined');
select 1/case when private.member_goods_reserved_qty('00000000-0000-4000-8000-000000047602','sales-policy-main')=5
 then 1 else 0 end as assert_declined_attempt_does_not_release_order;
select public.finalize_order_cancellation_with_provider_evidence(:'second_order','합성 미결제 취소','{}');
select public.finalize_order_cancellation_with_provider_evidence(:'second_order','합성 미결제 취소','{}');
select 1/case when private.member_goods_reserved_qty('00000000-0000-4000-8000-000000047602','sales-policy-main')=2
 and (select stock_qty from public.goods_variants where id=:'default_variant')=98
 and (select stock_qty from public.goods_variants where id=:'other_variant')=100
 then 1 else 0 end as assert_complete_cancellation_restores_exact_quantity_once;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047603',true);
select 1/case when public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','sales-policy-main','variantId',:'default_variant','qty',2)))
 #>>'{goods,0,memberReservedQty}'='0' then 1 else 0 end as assert_member_history_is_isolated;
select public.set_cart_item_quantity('sales-policy-main',:'default_variant',2);
select public.set_cart_item_quantity('sales-policy-free',:'free_variant',1);
reset role;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000047603',
 '{"recipientName":"다른 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}',
 '00000000-0000-4000-8000-000000047628','card') as mixed_free_order \gset
reset role;
select 1/case when exists(select 1 from public.order_items where order_id=:'mixed_free_order' and good_id='sales-policy-free'
 and unit_price=0 and regular_unit_price_snapshot=0 and price_period_id is null)
 and exists(select 1 from public.orders where id=:'mixed_free_order' and total=19000)
 then 1 else 0 end as assert_existing_zero_price_item_in_payable_mixed_order;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047601',true);
select public.admin_save_goods_price_period('sales-policy-main',:'default_variant',:'active_period',
 jsonb_build_object('state','disabled','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'),1);
reset role;
update public.goods_variants set price=11000 where id=:'default_variant';
select 1/case when exists(select 1 from public.order_items where order_id=:'first_order' and unit_price=8000 and regular_unit_price_snapshot=10000 and price_period_id=:'active_period')
 and exists(select 1 from public.orders where id=:'first_order' and private.goods_order_snapshot_matches(id,total,shipping_fee))
 and (select effective_price from private.resolve_goods_variant_price(:'default_variant',clock_timestamp()))=11000
 then 1 else 0 end as assert_stopped_offer_and_price_changes_preserve_old_orders;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047602',true);
select public.set_cart_item_quantity('sales-policy-main',:'default_variant',2);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047601',true);
select public.admin_save_good(pg_temp.good_payload('sales-policy-main')||'{"sale_restriction":"adult"}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047602',true);
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047627'::uuid,'card'::public.order_payment_method)$sql$,'restricted good blocked','23514');
reset role;
select 1/case when (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000047602')=2
 and exists(select 1 from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:sales-policy-main'
   and diff#>>'{after,sale_restriction}'='adult')
 then 1 else 0 end as assert_rejections_leave_no_orders_and_policy_changes_are_audited;

rollback;
