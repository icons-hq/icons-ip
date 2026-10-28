\set ON_ERROR_STOP on
-- D7② 옵션별 구매 제한: 옵션마다 주문당 최대(order_max_qty)·1인 누적 최대(member_max_qty).
-- 저장(키가 없으면 기존 값 유지)·견적 안내(line.optionLimit)·주문 경계(order_items 트리거)를 한 번에 확인한다.
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
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold')
      order by (value->>'sort_order')::integer)
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000161001','authenticated','authenticated','option-limit-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000161002','authenticated','authenticated','option-limit-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000161003','authenticated','authenticated','option-limit-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000161001';
update public.profiles set nickname='옵션제한'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000161002','00000000-0000-4000-8000-000000161003');
insert into public.verticals(key,label,color) values('option-limit-tests','옵션 제한 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('option-limit-tests','옵션 제한 검증','option-limit-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000161030','option-limit-tests','검증 출고지','hanjin',3000,20000,'배송 금지 검증 주소',true);

-- 스키마: 두 컬럼은 nullable(제한 없음)이고 양의 정수만 받는다. 기존 행은 null로 남는다.
select 1/case when (select count(*) from information_schema.columns where table_schema='public' and table_name='goods_variants'
  and column_name in ('order_max_qty','member_max_qty') and is_nullable='YES' and data_type='integer')=2
 then 1 else 0 end as assert_variant_limit_columns;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000161001',true);
select public.admin_save_good('{"id":"option-limit-main","ip_id":"option-limit-tests","name":"옵션 제한 검증","price":10000,
 "variant_baseline":[],"variants":[
  {"name":"빨강","code":"OPT-LIMIT-01","attributes":{"색상":"빨강"},"extraPrice":0,"stockQty":100,"orderMaxQty":2,"memberMaxQty":3},
  {"name":"파랑","code":"OPT-LIMIT-02","attributes":{"색상":"파랑"},"extraPrice":0,"stockQty":100}],
 "allow_card_payment":true,"allow_bank_transfer":true,"sale_restriction":"none"}');
reset role;
select id as red_variant from public.goods_variants where good_id='option-limit-main' and code='OPT-LIMIT-01' \gset
select id as blue_variant from public.goods_variants where good_id='option-limit-main' and code='OPT-LIMIT-02' \gset
select 1/case when exists(select 1 from public.goods_variants where id=:'red_variant' and order_max_qty=2 and member_max_qty=3)
 and exists(select 1 from public.goods_variants where id=:'blue_variant' and order_max_qty is null and member_max_qty is null)
 then 1 else 0 end as assert_new_option_limits_saved;

-- 키가 없는 저장(복제·그룹·일괄 경로와 같은 모양)은 기존 값을 유지한다.
set local role authenticated;
select public.admin_save_good(pg_temp.good_payload('option-limit-main')||'{"name":"옵션 제한 검증 수정"}');
reset role;
select 1/case when exists(select 1 from public.goods_variants where id=:'red_variant' and order_max_qty=2 and member_max_qty=3)
 then 1 else 0 end as assert_missing_keys_keep_limits;

-- null은 제한을 지우고, 값은 바꾼다.
set local role authenticated;
select public.admin_save_good(jsonb_set(jsonb_set(pg_temp.good_payload('option-limit-main'),'{variants,0,memberMaxQty}','null'),'{variants,1,orderMaxQty}','5'));
reset role;
select 1/case when exists(select 1 from public.goods_variants where id=:'red_variant' and order_max_qty=2 and member_max_qty is null)
 and exists(select 1 from public.goods_variants where id=:'blue_variant' and order_max_qty=5 and member_max_qty is null)
 then 1 else 0 end as assert_null_clears_and_value_updates;

-- 양의 정수가 아니면 거절한다.
create temporary table limit_payload(payload jsonb);
grant select on limit_payload to authenticated;
insert into limit_payload select pg_temp.good_payload('option-limit-main');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_save_good(%L::jsonb)',jsonb_set(payload,'{variants,0,orderMaxQty}',bad)),'invalid_goods_options')
 from limit_payload cross join unnest(array['0','-1','1.5','"2"','true','2147483648']::jsonb[]) bad;
select pg_temp.expect_error(format('select public.admin_save_good(%L::jsonb)',jsonb_set(payload,'{variants,1,memberMaxQty}','0')),'invalid_goods_options')
 from limit_payload;
reset role;

-- 1인 누적은 다시 켠다: 빨강 주문당 2·1인 3, 파랑 주문당 5.
set local role authenticated;
select public.admin_save_good(jsonb_set(pg_temp.good_payload('option-limit-main'),'{variants,0,memberMaxQty}','3'));
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/option-limit-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000161030'
 where id='option-limit-main';
select pg_temp.publish_goods_kc_fixture('option-limit-main');

-- 견적: 비회원은 회원 이력 없이 주문당 한도만 판정한다.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','option-limit-main','variantId',:'red_variant','qty',3))) as anon_quote \gset
reset role;
select 1/case when :'anon_quote'::jsonb#>'{lines,0,optionLimit}'=jsonb_build_object('orderMaxQty',2,'memberMaxQty',3,
  'memberReservedQty',null,'memberRemainingQty',null,'reason','option_order_limit_exceeded')
 and (:'anon_quote'::jsonb#>>'{lines,0,available}')::boolean
 then 1 else 0 end as assert_anonymous_quote_option_order_limit;

-- 주문 경계: 장바구니의 같은 옵션 합계가 주문당 한도를 넘으면 주문 전체를 거절한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000161002',true);
select public.set_cart_item_quantity('option-limit-main',:'red_variant',3);
select public.set_cart_item_quantity('option-limit-main',:'blue_variant',1);
select public.quote_goods_sales(jsonb_build_array(
  jsonb_build_object('goodId','option-limit-main','variantId',:'red_variant','qty',3),
  jsonb_build_object('goodId','option-limit-main','variantId',:'blue_variant','qty',1))) as member_quote \gset
select 1/case when (select line->'optionLimit' from jsonb_array_elements(:'member_quote'::jsonb->'lines') line where line->>'variantId'=:'red_variant')
  =jsonb_build_object('orderMaxQty',2,'memberMaxQty',3,'memberReservedQty',0,'memberRemainingQty',3,'reason','option_order_limit_exceeded')
 and (select line->'optionLimit' from jsonb_array_elements(:'member_quote'::jsonb->'lines') line where line->>'variantId'=:'blue_variant')
  =jsonb_build_object('orderMaxQty',5,'memberMaxQty',null,'memberReservedQty',null,'memberRemainingQty',null,'reason',null)
 then 1 else 0 end as assert_member_quote_option_order_limit;
set local role service_role;
select pg_temp.expect_error($sql$select public.place_order('00000000-0000-4000-8000-000000161002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000161020'::uuid,'card'::public.order_payment_method)$sql$,'option_order_limit_exceeded','23514');
reset role;
select 1/case when (select stock_qty from public.goods_variants where id=:'red_variant')=100
 and not exists(select 1 from public.orders where checkout_key='00000000-0000-4000-8000-000000161020')
 then 1 else 0 end as assert_rejected_order_rolls_back;

-- 한도 안이면 주문된다(빨강 2 + 파랑 1).
set local role authenticated;
select public.set_cart_item_quantity('option-limit-main',:'red_variant',2);
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000161002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000161021'::uuid,'card'::public.order_payment_method) as first_order \gset
reset role;
select 1/case when private.member_variant_reserved_qty('00000000-0000-4000-8000-000000161002',:'red_variant')=2
 and (select sum(qty) from public.order_items where order_id=:'first_order' and variant_id=:'red_variant')=2
 then 1 else 0 end as assert_first_order_within_limit;

-- 1인 누적: 결제 대기 주문도 포함한다. 2 + 2 > 3은 거절, 2 + 1 = 3은 허용.
set local role authenticated;
select public.set_cart_item_quantity('option-limit-main',:'red_variant',2);
select 1/case when public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','option-limit-main','variantId',:'red_variant','qty',2)))
  #>'{lines,0,optionLimit}'=jsonb_build_object('orderMaxQty',2,'memberMaxQty',3,'memberReservedQty',2,'memberRemainingQty',1,'reason','option_member_limit_exceeded')
 then 1 else 0 end as assert_member_quote_includes_pending_order;
set local role service_role;
select pg_temp.expect_error($sql$select public.place_order('00000000-0000-4000-8000-000000161002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000161022'::uuid,'card'::public.order_payment_method)$sql$,'option_member_limit_exceeded','23514');
set local role authenticated;
select public.set_cart_item_quantity('option-limit-main',:'red_variant',1);
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000161002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000161023'::uuid,'card'::public.order_payment_method) as second_order \gset
reset role;
select 1/case when private.member_variant_reserved_qty('00000000-0000-4000-8000-000000161002',:'red_variant')=3
 and private.member_variant_reserved_qty('00000000-0000-4000-8000-000000161003',:'red_variant')=0
 then 1 else 0 end as assert_member_limit_is_per_member;

-- 전체 취소가 끝난 주문은 한도에서 빠진다.
select public.finalize_order_cancellation_with_provider_evidence(:'first_order','합성 미결제 취소','{}');
select 1/case when private.member_variant_reserved_qty('00000000-0000-4000-8000-000000161002',:'red_variant')=1
 then 1 else 0 end as assert_canceled_order_releases_member_limit;

-- 계약: 트리거가 주문 생성 경계 전체를 덮고, 내부 판정 함수는 봉인돼 있다.
select 1/case when exists(select 1 from pg_trigger where tgrelid='public.order_items'::regclass and tgname='order_items_variant_purchase_limit' and not tgisinternal)
 and not has_function_privilege('authenticated','private.member_variant_reserved_qty(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.goods_variant_purchase_limit_problem(uuid,uuid,bigint)','execute')
 and not has_function_privilege('anon','private.guard_order_item_variant_purchase_limit()','execute')
 then 1 else 0 end as assert_limit_boundary_sealed;

rollback;
