\set ON_ERROR_STOP on
-- D5② 고객 은닉(T6 리뷰 R1): 랜덤 판매 굿즈의 옵션별 재고는 고객이 닿는 어떤 경로에서도 보이지 않는다.
-- 주문 뒤 옵션별 재고 차이로 배정 옵션을 알아내고, 결제 대기 주문을 자동 취소(supersede)시켜 다시 뽑는 재추첨을 막는다.
--
-- 검증 방법: 고객(익명·로그인)이 볼 수 있는 표면 — REST goods_variants, 공개 계산 열(goods_variant_supply·goods_random_option),
-- 견적, 카테고리 전시, 배송비 절약 추천, 옵션 재입고 신청 — 을 한 덩어리로 찍는다. 주문 뒤 실제 배정 상태와,
-- 풀 합계는 같고 어느 옵션에서 빠졌는지만 다른 상태에서 그 덩어리가 같으면 고객은 배정 옵션을 알 수 없다.
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

-- 재입고 신청을 시도하고 되돌린다. 결과(오류 메시지 또는 accepted:<신청 옵션>)만 돌려준다.
create function pg_temp.restock_probe(p_good text,p_variant uuid) returns text language plpgsql as $$
declare outcome text;
begin
  begin
    perform public.request_variant_restock_alert(p_good,p_variant);
    select 'accepted:'||coalesce(variant_id::text,'good') into outcome from public.restock_alerts
      where user_id=auth.uid() and good_id=p_good order by created_at desc limit 1;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm='probe_rollback' then return outcome; end if;
    return sqlerrm;
  end;
end $$;

-- 현재 롤로 볼 수 있는 고객 표면. 계산 시각(calculatedAt)은 문장마다 달라 뺀다.
create function pg_temp.customer_view(p_good text,p_rows text[],p_variants uuid[],p_neighbor text,p_neighbor_variant uuid,p_pool integer)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  result:=jsonb_build_object(
    'restVariants',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from public.goods_variants v where v.good_id=p_good),
    'good',(select jsonb_build_object('stockQty',g.stock_qty,'stock',g.stock,'mode',g.option_sale_mode) from public.goods g where g.id=p_good),
    'randomOption',(select public.goods_random_option(g) from public.goods g where g.id=p_good),
    'supply',(select jsonb_agg(public.goods_variant_supply(row_text::public.goods_variants) order by ordinality)
      from unnest(p_rows) with ordinality row_text),
    'quoteOne',(select jsonb_agg(public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId',p_good,'variantId',variant,'qty',1)))->'lines'
      order by ordinality) from unnest(p_variants) with ordinality variant),
    'quotePool',(select jsonb_agg(public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId',p_good,'variantId',variant,'qty',p_pool)))->'lines'
      order by ordinality) from unnest(p_variants) with ordinality variant),
    'savings',public.get_product_shipping_savings(p_neighbor,p_neighbor_variant,1)->'items',
    'restock',case when auth.uid() is null then null else (select jsonb_agg(pg_temp.restock_probe(p_good,variant) order by ordinality)
      from unnest(p_variants) with ordinality variant) end);
  return regexp_replace(result::text,'"calculatedAt": "[^"]*"','"calculatedAt": null','g')::jsonb;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000163001','authenticated','authenticated','random-mask-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000163002','authenticated','authenticated','random-mask-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000163001';
update public.profiles set nickname='랜덤은닉',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000163002';
insert into public.verticals(key,label,color) values('random-mask-tests','랜덤 은닉 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('random-mask-tests','랜덤 은닉 검증','random-mask-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000163030','random-mask-tests','검증 출고지','hanjin',3000,20000,'배송 금지 검증 주소',true);
update private.product_detail_experience_settings set values=values||'{"shippingSavings":true}' where section='discovery';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select public.admin_save_good('{"id":"random-mask","ip_id":"random-mask-tests","name":"랜덤 은닉","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"MASK-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":20},
  {"name":"B","code":"MASK-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":20},
  {"name":"C","code":"MASK-C","attributes":{"멤버":"C"},"extraPrice":0,"stockQty":20}],
 "allow_card_payment":true,"allow_bank_transfer":true,"sale_restriction":"none"}');
select public.admin_save_good('{"id":"random-mask-neighbor","ip_id":"random-mask-tests","name":"같은 출고지 굿즈","price":15000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"MASK-N","attributes":{},"extraPrice":0,"stockQty":10}]}');
reset role;
select id as variant_a from public.goods_variants where code='MASK-A' \gset
select id as variant_b from public.goods_variants where code='MASK-B' \gset
select id as variant_c from public.goods_variants where code='MASK-C' \gset
select id as neighbor_variant from public.goods_variants where code='MASK-N' \gset
select 1/case when exists(select 1 from public.goods_variants where id=:'variant_a' and is_default) then 1 else 0 end as assert_a_is_cart_key;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/random-mask-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000163030'
 where id in ('random-mask','random-mask-neighbor');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('random-mask','random-mask-neighbor');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select public.admin_set_goods_option_sale_mode('random-mask','random',(select updated_at from public.goods where id='random-mask'));
reset role;
-- 옵션 id를 아는 공격자가 공개 계산 열에 직접 넘길 행 값(랜덤 전환 전에 알았거나 다른 경로로 얻은 id).
select array[(select v::text from public.goods_variants v where v.id=:'variant_a'),(select v::text from public.goods_variants v where v.id=:'variant_b'),
  (select v::text from public.goods_variants v where v.id=:'variant_c')]::text as variant_rows \gset
select array[:'variant_a',:'variant_b',:'variant_c']::text as variant_ids \gset

-- 1. 고객 직접 읽기: 랜덤 굿즈의 옵션 행은 익명·로그인 고객에게 보이지 않고, 운영자(catalog.read)에게는 보인다.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select count(*) from public.goods_variants where good_id='random-mask')=0
 and (select count(*) from public.goods_variants where good_id='random-mask-neighbor')=1
 then 1 else 0 end as assert_anon_cannot_read_random_option_rows;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select 1/case when (select count(*) from public.goods_variants where good_id='random-mask')=0 then 1 else 0 end as assert_customer_cannot_read_random_option_rows;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select 1/case when (select count(*) from public.goods_variants where good_id='random-mask')=3 then 1 else 0 end as assert_staff_reads_random_option_rows;
reset role;

-- 2. 고객 구매 표면: 랜덤 한 줄(id = 장바구니 키 A, 이름 '랜덤', 재고 = 풀 합계).
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.goods_random_option(g) as random_option from public.goods g where g.id='random-mask' \gset
select 1/case when (:'random_option'::jsonb->>'id')::uuid=:'variant_a'::uuid and :'random_option'::jsonb->>'name'='랜덤'
 and :'random_option'::jsonb->>'code'='' and (:'random_option'::jsonb->>'is_default')::boolean
 and (:'random_option'::jsonb->>'stock_qty')::integer=60 and (:'random_option'::jsonb#>>'{supply,availableQty}')::integer=60
 and (:'random_option'::jsonb#>>'{pricing,effectivePrice}')::integer=5000
 and (select public.goods_random_option(g) is null from public.goods g where g.id='random-mask-neighbor')
 then 1 else 0 end as assert_random_option_projection;
reset role;
select 1/case when jsonb_array_length(private.category_display_public_variants('random-mask'))=1
 and private.category_display_public_variants('random-mask')->0->>'name'='랜덤'
 and (private.category_display_public_variants('random-mask')->0->>'id')::uuid=:'variant_a'::uuid
 and (private.category_display_public_variants('random-mask')->0#>>'{supply,availableQty}')::integer=60
 then 1 else 0 end as assert_category_display_masks_random_options;

-- 3. 옵션 재입고 신청은 옵션별 품절 여부를 알려 주지 않는다(풀 기준 판정, 굿즈 단위 신청).
update public.goods_variants set stock_qty=0 where id=:'variant_b';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select 1/case when pg_temp.restock_probe('random-mask',:'variant_b')='variant_available'
 and pg_temp.restock_probe('random-mask',:'variant_a')='variant_available'
 then 1 else 0 end as assert_variant_restock_uses_pool;
reset role;
update public.goods_variants set stock_qty=0 where good_id='random-mask';
update public.goods set stock='soldout' where id='random-mask';
set local role authenticated;
select 1/case when pg_temp.restock_probe('random-mask',:'variant_b')='accepted:good'
 then 1 else 0 end as assert_soldout_random_restock_is_good_level;
reset role;
update public.goods set stock='ok' where id='random-mask';
update public.goods_variants set stock_qty=20 where good_id='random-mask';

-- 4. 주문(배정) 뒤 고객 표면은 풀 합계만 반영한다. 배정 옵션 X에서 빠진 상태와, 다른 옵션 Y에서 빠졌다고 가정한 상태가 같아야 한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select public.set_cart_item_quantity('random-mask',:'variant_a',1);
select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)),'[]') as cart
 from public.cart_items where user_id='00000000-0000-4000-8000-000000163002' \gset
-- 앱과 같은 경로(카드 결제 대기 주문).
set local role service_role;
select public.place_order_with_cart_snapshot('00000000-0000-4000-8000-000000163002',
 '{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}','00000000-0000-4000-8000-000000163020','card',0,null,:'cart') as mask_order \gset
reset role;
select variant_id as allocated from public.order_items where order_id=:'mask_order' and good_id='random-mask' \gset
select min(id::text) as other from public.goods_variants where good_id='random-mask' and id<>:'allocated'::uuid \gset
select 1/case when (select sum(stock_qty) from public.goods_variants where good_id='random-mask')=59 then 1 else 0 end as assert_order_allocated_one;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.customer_view('random-mask',:'variant_rows'::text[],:'variant_ids'::uuid[],'random-mask-neighbor',:'neighbor_variant',59) as anon_actual \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select pg_temp.customer_view('random-mask',:'variant_rows'::text[],:'variant_ids'::uuid[],'random-mask-neighbor',:'neighbor_variant',59) as buyer_actual \gset
reset role;
select regexp_replace(private.category_display_public_variants('random-mask')::text,'"calculatedAt": "[^"]*"','"calculatedAt": null','g') as display_actual \gset

-- 배정을 Y로 바꿔 놓은 가상 상태(풀 합계 같음).
update public.goods_variants set stock_qty=stock_qty+1 where id=:'allocated';
update public.goods_variants set stock_qty=stock_qty-1 where id=:'other';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.customer_view('random-mask',:'variant_rows'::text[],:'variant_ids'::uuid[],'random-mask-neighbor',:'neighbor_variant',59) as anon_other \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select pg_temp.customer_view('random-mask',:'variant_rows'::text[],:'variant_ids'::uuid[],'random-mask-neighbor',:'neighbor_variant',59) as buyer_other \gset
reset role;
select regexp_replace(private.category_display_public_variants('random-mask')::text,'"calculatedAt": "[^"]*"','"calculatedAt": null','g') as display_other \gset
update public.goods_variants set stock_qty=stock_qty-1 where id=:'allocated';
update public.goods_variants set stock_qty=stock_qty+1 where id=:'other';

select 1/case when :'anon_actual'::jsonb=:'anon_other'::jsonb then 1 else 0 end as assert_anon_view_hides_allocation;
select 1/case when :'buyer_actual'::jsonb=:'buyer_other'::jsonb then 1 else 0 end as assert_buyer_view_hides_allocation;
select 1/case when :'display_actual'::jsonb=:'display_other'::jsonb then 1 else 0 end as assert_category_display_hides_allocation;
-- 덩어리가 실제로 풀 합계를 보고 있는지(빈 값끼리 같은 게 아닌지)도 본다.
select 1/case when (select bool_and((value->>'availableQty')::integer=59) from jsonb_array_elements(:'buyer_actual'::jsonb->'supply'))
 and jsonb_array_length(:'buyer_actual'::jsonb->'supply')=3
 and (select bool_and((value->0->>'available')::boolean and (value->0#>>'{supply,availableQty}')::integer=59)
   from jsonb_array_elements(:'buyer_actual'::jsonb->'quotePool'))
 and (:'buyer_actual'::jsonb#>>'{randomOption,supply,availableQty}')::integer=59
 and jsonb_array_length(:'buyer_actual'::jsonb->'restVariants')=0
 and (select bool_and(value='"variant_available"'::jsonb) from jsonb_array_elements(:'buyer_actual'::jsonb->'restock'))
 then 1 else 0 end as assert_view_reports_pool_total;
-- 배송비 절약 추천의 랜덤 굿즈 후보는 장바구니 키와 '랜덤'으로 보인다.
select 1/case when exists(select 1 from jsonb_array_elements(:'buyer_actual'::jsonb->'savings') item
   where item->>'goodId'='random-mask' and (item->>'variantId')::uuid=:'variant_a'::uuid and item->>'variantName'='랜덤')
 then 1 else 0 end as assert_shipping_savings_masks_random_candidate;

-- 5. 결제 대기 주문을 같은 장바구니로 다시 주문해 닫아도(supersede) 고객이 보는 값은 풀 합계뿐이다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select public.set_cart_item_quantity('random-mask',:'variant_a',1);
select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)),'[]') as cart
 from public.cart_items where user_id='00000000-0000-4000-8000-000000163002' \gset
reset role;
set local role service_role;
select public.place_order_with_cart_snapshot('00000000-0000-4000-8000-000000163002',
 '{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}','00000000-0000-4000-8000-000000163021','card',0,null,:'cart') as reroll_order \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163002',true);
select 1/case when (select count(*) from public.goods_variants where good_id='random-mask')=0
 and (select count(*) from public.order_items where order_id in (:'mask_order',:'reroll_order'))=0
 and not exists(select 1 from public.my_order_items(array[:'mask_order'::uuid,:'reroll_order'::uuid])
   where variant_id<>:'variant_a'::uuid or variant_name_snapshot<>'랜덤')
 then 1 else 0 end as assert_reroll_stays_hidden;
reset role;

-- 6. 주문 품목 행 분할(T7 리뷰 RV-1): 주문 코어는 배정 옵션마다 order_items 행을 나눠 넣으므로 행 수·행별 수량도 배정
--    결과다(모두 다른 옵션이 나왔는지 = 중복이 없는지). 고객 품목 조회(my_order_items)는 같은 주문·같은 굿즈의 랜덤 행을
--    한 줄로 합치고, 고객의 배송 건 품목 직접 읽기(order_shipment_items)에서는 랜덤 행이 빠진다(배송 건 대응은
--    my_order_items.shipment_id). 세 옵션이 하나씩 나온 주문과 한 옵션만 세 개 나온 주문이 고객에게 같아야 한다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000163003','authenticated','authenticated','random-mask-buyer2@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000163004','authenticated','authenticated','random-mask-buyer3@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='랜덤은닉'||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000163003','00000000-0000-4000-8000-000000163004');
create function pg_temp.place_cart_order(p_user uuid,p_checkout uuid) returns uuid language plpgsql as $$
declare cart jsonb; placed uuid;
begin
  select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)),'[]')
    into cart from public.cart_items where user_id=p_user;
  execute 'set local role service_role';
  placed:=public.place_order_with_cart_snapshot(p_user,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}',
    p_checkout,'card',0,null,cart);
  execute 'reset role';
  return placed;
end $$;
-- 고객 세션에서 보이는 주문 품목 모양. 품목 id·상품주문번호·배송 건 id는 주문마다 달라 뺀다.
create function pg_temp.customer_order_rows(p_order uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'items',(select jsonb_agg(jsonb_build_object('good',item.good_id,'qty',item.qty,'variant',item.variant_id,'name',item.variant_name_snapshot,
       'code',item.variant_code_snapshot,'mode',item.option_sale_mode,'unitPrice',item.unit_price,'shipped',item.shipment_id is not null)
       order by item.good_id) from public.my_order_items(array[p_order]) item),
    'shipmentItems',(select coalesce(jsonb_agg(shipment_item.qty order by shipment_item.qty),'[]') from public.order_shipment_items shipment_item
       where shipment_item.order_id=p_order));
$$;

update public.goods_variants set stock_qty=1 where good_id='random-mask';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163003',true);
select public.set_cart_item_quantity('random-mask',:'variant_a',3);
select public.set_cart_item_quantity('random-mask-neighbor',:'neighbor_variant',1);
reset role;
select pg_temp.place_cart_order('00000000-0000-4000-8000-000000163003','00000000-0000-4000-8000-000000163022') as spread_order \gset
update public.goods_variants set stock_qty=case when id=:'variant_a' then 3 else 0 end where good_id='random-mask';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163004',true);
select public.set_cart_item_quantity('random-mask',:'variant_a',3);
select public.set_cart_item_quantity('random-mask-neighbor',:'neighbor_variant',1);
reset role;
select pg_temp.place_cart_order('00000000-0000-4000-8000-000000163004','00000000-0000-4000-8000-000000163023') as same_order \gset
-- 운영자 진실: 앞 주문은 세 옵션으로 나뉘었고, 뒤 주문은 한 옵션만 나왔다.
select 1/case when (select count(*) from public.order_items where order_id=:'spread_order' and good_id='random-mask')=3
 and (select count(*) from public.order_items where order_id=:'same_order' and good_id='random-mask')=1
 and (select count(*) from public.order_shipment_items where order_id=:'spread_order')=4
 then 1 else 0 end as assert_allocation_rows_split;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163003',true);
select pg_temp.customer_order_rows(:'spread_order') as spread_view \gset
select item.id as spread_item, item.shipment_id as spread_shipment, item.qty as spread_qty, item.variant_id as spread_variant
 from public.my_order_items(array[:'spread_order'::uuid]) item where item.good_id='random-mask' \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163004',true);
select pg_temp.customer_order_rows(:'same_order') as same_view \gset
reset role;
select 1/case when :'spread_view'::jsonb=:'same_view'::jsonb then 1 else 0 end as assert_customer_rows_hide_allocation_split;
-- 합친 줄: 수량 합계, 장바구니 키, 가장 작은 배정 행 id, 그 행의 배송 건. 고객 배송 건 품목에는 선택 판매 줄만 남는다.
select 1/case when :'spread_qty'::integer=3 and :'spread_variant'::uuid=:'variant_a'::uuid
 and :'spread_item'::uuid=(select min(id::text)::uuid from public.order_items where order_id=:'spread_order' and good_id='random-mask')
 and :'spread_shipment'::uuid=(select shipment_id from public.order_shipment_items where order_item_id=:'spread_item'::uuid)
 and jsonb_array_length(:'spread_view'::jsonb->'items')=2 and :'spread_view'::jsonb->'shipmentItems'='[1]'::jsonb
 then 1 else 0 end as assert_merged_random_row_shape;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select 1/case when (select count(*) from public.order_shipment_items where order_id=:'spread_order')=4
 then 1 else 0 end as assert_staff_reads_random_shipment_items;
reset role;

-- 랜덤 전환 전에 담은 비기본 옵션 줄(B)로 만든 주문도 고객에게는 장바구니 키 한 줄이다(다시 담기가 키 하나로 합친다, RV-3).
update public.goods_variants set stock_qty=20 where good_id='random-mask';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select public.admin_set_goods_option_sale_mode('random-mask','select',(select updated_at from public.goods where id='random-mask'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163003',true);
select public.set_cart_item_quantity('random-mask',:'variant_a',2);
select public.set_cart_item_quantity('random-mask',:'variant_b',3);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163001',true);
select public.admin_set_goods_option_sale_mode('random-mask','random',(select updated_at from public.goods where id='random-mask'));
reset role;
select 1/case when (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000163003' and good_id='random-mask')=2
 then 1 else 0 end as assert_pre_switch_cart_lines_remain;
select pg_temp.place_cart_order('00000000-0000-4000-8000-000000163003','00000000-0000-4000-8000-000000163024') as pre_switch_order \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163003',true);
select 1/case when (select count(*) from public.my_order_items(array[:'pre_switch_order'::uuid]) where good_id='random-mask')=1
 and (select qty from public.my_order_items(array[:'pre_switch_order'::uuid]) where good_id='random-mask')=5
 and (select variant_id from public.my_order_items(array[:'pre_switch_order'::uuid]) where good_id='random-mask')=:'variant_a'::uuid
 then 1 else 0 end as assert_pre_switch_order_is_one_key_row;
reset role;
-- 한 번에 병합하는 줄(이 기기 장바구니 동기화)이 같은 장바구니 키로 모이면 수량을 더한다 — 줄마다 greatest를 쓰면 앞 줄이 사라진다.
delete from public.cart_items where user_id='00000000-0000-4000-8000-000000163004';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000163004',true);
select public.merge_cart_items(jsonb_build_array(jsonb_build_object('good_id','random-mask','variant_id',:'variant_a','qty',2),
  jsonb_build_object('good_id','random-mask','variant_id',:'variant_b','qty',3)));
select public.merge_cart_items(jsonb_build_array(jsonb_build_object('good_id','random-mask','variant_id',:'variant_c','qty',4)));
reset role;
select 1/case when (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000163004' and good_id='random-mask')=1
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000163004' and variant_id=:'variant_a')=5
 then 1 else 0 end as assert_merge_sums_lines_sharing_random_key;

-- 계약: 공개 계산 열 grant, 정책 계약 등록.
select 1/case when has_function_privilege('anon','public.goods_random_option(public.goods)','execute')
 and has_function_privilege('authenticated','public.goods_random_option(public.goods)','execute')
 and exists(select 1 from private.operator_policy_contracts where table_name='goods_variants' and policy_name='goods_variants_random_private_read')
 and not has_function_privilege('authenticated','private.random_option_pool_qty(text,timestamp with time zone)','execute')
 and exists(select 1 from private.operator_policy_contracts where table_name='order_shipment_items' and policy_name='random_shipment_items_private_read')
 and has_function_privilege('authenticated','public.my_order_items(uuid[])','execute')
 and not has_function_privilege('anon','public.my_order_items(uuid[])','execute')
 then 1 else 0 end as assert_masking_contracts;

rollback;
