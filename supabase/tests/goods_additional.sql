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
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000048201','authenticated','authenticated','additional-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048202','authenticated','authenticated','additional-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='추가운영8201' where id='00000000-0000-4000-8000-000000048201';
update public.profiles set nickname='추가구매8202',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000048202';
insert into public.verticals(key,label,color) values('additional-tests','추가상품 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('additional-tests','추가상품 검증','additional-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000048230','additional-tests','검증 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048201',true);
select public.admin_save_good('{"id":"additional-base","ip_id":"additional-tests","name":"추가 본상품","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"ADD-BASE","attributes":{},"extraPrice":0,"stockQty":20}]}');
select public.admin_save_good('{"id":"additional-extra","ip_id":"additional-tests","name":"추가 선택상품","price":3000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"ADD-EXTRA","attributes":{},"extraPrice":0,"stockQty":20},
 {"name":"파랑","code":"ADD-EXTRA-BLUE","attributes":{"색상":"파랑"},"extraPrice":1000,"stockQty":20}]}');
select public.admin_save_good('{"id":"additional-third","ip_id":"additional-tests","name":"추가 세번째","price":5000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"ADD-THIRD","attributes":{},"extraPrice":0,"stockQty":20}]}');
select public.admin_save_good('{"id":"additional-hidden","ip_id":"additional-tests","name":"추가 비공개","price":5000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"ADD-HIDDEN","attributes":{},"extraPrice":0,"stockQty":20}]}');
select id as base_variant from public.goods_variants where good_id='additional-base' and is_default \gset
select id as extra_variant from public.goods_variants where good_id='additional-extra' and is_default \gset
select id as blue_variant from public.goods_variants where good_id='additional-extra' and not is_default \gset
select id as third_variant from public.goods_variants where good_id='additional-third' and is_default \gset
select public.admin_save_goods_price_period('additional-extra',:'extra_variant',null,
 jsonb_build_object('state','active','discountPrice',2500,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'));
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/additional-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000048230'
 where id in ('additional-base','additional-extra','additional-third');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('additional-base','additional-extra','additional-third');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048201',true);
select public.admin_save_goods_additional('additional-base','{additional-extra}',null);
select public.admin_save_goods_additional('additional-extra','{additional-third}',null);
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-third','{additional-base}',null)$sql$,'additional_goods_cycle','23514');
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-base','{additional-base}',1)$sql$,'invalid_additional_goods','23514');
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-base','{additional-extra,additional-extra}',1)$sql$,'invalid_additional_goods','23514');
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-base','{additional-hidden}',1)$sql$,'additional_good_unavailable','23514');
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-base','{}',0)$sql$,'additional_goods_changed','PT409');
select 1/case when public.admin_read_goods_additional('additional-base')#>>'{items,0,goodId}'='additional-extra'
 and public.admin_save_goods_additional('additional-base','{additional-extra}',1)->>'changed'='false'
 then 1 else 0 end as assert_saved_direct_links_and_noop_revision;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select public.goods_additional_ids(good) from public.goods good where id='additional-base')='{additional-extra}'::text[]
 then 1 else 0 end as assert_public_reads_only_one_level;
select pg_temp.expect_error($sql$select public.admin_read_goods_additional('additional-base')$sql$,'permission denied','42501');
reset role;
update public.goods set stock='soldout' where id='additional-extra';
set local role anon;
select 1/case when (select public.goods_additional_ids(good) from public.goods good where id='additional-base')='{}'::text[]
 then 1 else 0 end as assert_stopped_additional_good_hidden;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048201',true);
select 1/case when public.admin_read_goods_additional('additional-base')#>>'{items,0,available}'='false'
 then 1 else 0 end as assert_staff_keeps_unavailable_link_visible;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set stock='ok' where id='additional-extra';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048202',true);
select pg_temp.expect_error($sql$select public.admin_save_goods_additional('additional-base','{}',1)$sql$,'staff required','42501');
select pg_temp.expect_error(format('select public.add_cart_selection(%L,%L::jsonb)','additional-base',jsonb_build_array(
 jsonb_build_object('good_id','additional-base','variant_id',:'base_variant','qty',1,'expected_qty',0),
 jsonb_build_object('good_id','additional-extra','variant_id',:'extra_variant','qty',21,'expected_qty',0))::text),'out of stock','23514');
select 1/case when not exists(select 1 from public.cart_items where user_id=auth.uid()) then 1 else 0 end as assert_failed_extra_does_not_leave_base;
select pg_temp.expect_error(format('select public.add_cart_selection(%L,%L::jsonb)','additional-base',jsonb_build_array(
 jsonb_build_object('good_id','additional-base','variant_id',:'base_variant','qty',1,'expected_qty',0),
 jsonb_build_object('good_id','additional-third','variant_id',:'third_variant','qty',1,'expected_qty',0))::text),'additional_good_unavailable','23514');
select 1/case when not exists(select 1 from public.cart_items where user_id=auth.uid()) then 1 else 0 end as assert_descendants_are_not_implicit_additions;
select public.add_cart_selection('additional-base',jsonb_build_array(
 jsonb_build_object('good_id','additional-base','variant_id',:'base_variant','qty',1,'expected_qty',0),
 jsonb_build_object('good_id','additional-extra','variant_id',:'extra_variant','qty',1,'expected_qty',0))) as added_snapshot \gset
select 1/case when jsonb_array_length(:'added_snapshot'::jsonb)=2 and (select sum(qty) from public.cart_items where user_id=auth.uid())=2
 then 1 else 0 end as assert_atomic_cart_snapshot_contains_base_and_extra;
select pg_temp.expect_error(format('select public.add_cart_selection(%L,%L::jsonb)','additional-base',jsonb_build_array(
 jsonb_build_object('good_id','additional-base','variant_id',:'base_variant','qty',1,'expected_qty',0),
 jsonb_build_object('good_id','additional-extra','variant_id',:'extra_variant','qty',1,'expected_qty',0))::text),'cart_selection_changed','PT409');
select 1/case when (select sum(qty) from public.cart_items where user_id=auth.uid())=2 then 1 else 0 end as assert_uncertain_retry_cannot_add_twice;
select public.set_cart_item_quantity('additional-extra',:'blue_variant',2);
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set order_quantity_limit_enabled=true,min_order_qty=1,max_order_qty=2 where id='additional-extra';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048202',true);
select pg_temp.expect_error($sql$select public.place_order('{"recipientName":"추가 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048220'::uuid,'card'::public.order_payment_method)$sql$,'order_quantity_above_maximum','23514');
select public.set_cart_item_quantity('additional-extra',:'blue_variant',0);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048201',true);
select public.admin_save_goods_additional('additional-base','{}',1);
-- A removed selector link does not invalidate independent, ordinary cart lines.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048202',true);
select public.place_order('{"recipientName":"추가 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048221'::uuid,'card'::public.order_payment_method) as order_id \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'order_id')=2
 and exists(select 1 from public.order_items where order_id=:'order_id' and good_id='additional-extra' and variant_id=:'extra_variant'
   and qty=1 and unit_price=2500 and regular_unit_price_snapshot=3000)
 and (select total from public.orders where id=:'order_id')=15500
 and (select stock_qty from public.goods_variants where id=:'base_variant')=19
 and (select stock_qty from public.goods_variants where id=:'extra_variant')=19
 then 1 else 0 end as assert_normal_order_prices_stock_and_shipping;
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','합성 추가상품 미결제 취소','{}');
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','합성 추가상품 미결제 취소','{}');
select 1/case when (select stock_qty from public.goods_variants where id=:'base_variant')=20
 and (select stock_qty from public.goods_variants where id=:'extra_variant')=20
 then 1 else 0 end as assert_cancellation_restores_both_normal_options_once;
rollback;
