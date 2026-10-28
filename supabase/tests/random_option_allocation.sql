\set ON_ERROR_STOP on
-- D5② 랜덤 판매 굿즈: 주문 생성 때 DB가 남은 재고 비례 비복원 추출로 옵션을 배정한다.
-- 전용 setter·조건 재검사·장바구니 키 정규화·견적 풀 합계·배정 증빙·고객 은닉(restrictive RLS + 마스킹 RPC)·복원을 확인한다.
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

-- 랜덤 조건 지연 제약 트리거만 지금 판정한다(테스트는 커밋하지 않으므로). 다른 지연 제약은 건드리지 않는다.
create function pg_temp.random_guards(p_mode text) returns void language plpgsql as $$
begin
  execute 'set constraints public.goods_variants_option_sale_mode_guard,private.goods_variant_price_periods_option_sale_mode_guard,'
    ||'public.goods_option_sale_mode_guard '||p_mode;
end $$;
create function pg_temp.expect_deferred_error(statement text,expected_message text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin
    execute statement;
    perform pg_temp.random_guards('immediate');
  exception when others then
    if position(expected_message in sqlerrm)=0 then raise; end if;
    rejected:=true;
  end;
  perform pg_temp.random_guards('deferred');
  if not rejected then raise exception 'Expected deferred rejection: %',expected_message; end if;
end $$;

create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null) order by (value->>'sort_order')::integer)
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000162001','authenticated','authenticated','random-option-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000162002','authenticated','authenticated','random-option-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000162001';
update public.profiles set nickname='랜덤구매',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000162002';
insert into public.verticals(key,label,color) values('random-option-tests','랜덤 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('random-option-tests','랜덤 검증','random-option-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000162030','random-option-tests','검증 출고지','hanjin',3000,20000,'배송 금지 검증 주소',true);

-- 스키마 기본값: 기존 굿즈는 select, 기존 주문 품목은 null이다.
select 1/case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='goods'
   and column_name='option_sale_mode' and is_nullable='NO' and column_default like '''select''%')
 and exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_items'
   and column_name='option_sale_mode_snapshot' and is_nullable='YES')
 and not exists(select 1 from public.goods where option_sale_mode<>'select')
 then 1 else 0 end as assert_option_sale_mode_columns;

-- 난수: [0, n) 균등 정수(gen_random_bytes 거부 추출).
select 1/case when (select min(value)=0 and max(value)=2 and count(distinct value)=3
   from (select private.random_below(3) value from generate_series(1,300)) draws)
 and private.random_below(1)=0
 then 1 else 0 end as assert_random_below_range;
select pg_temp.expect_error('select private.random_below(0)','invalid_random_bound');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_save_good('{"id":"random-main","ip_id":"random-option-tests","name":"랜덤 포토카드","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"RANDOM-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":2},
  {"name":"B","code":"RANDOM-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":3},
  {"name":"C","code":"RANDOM-C","attributes":{"멤버":"C"},"extraPrice":0,"stockQty":5}],
 "allow_card_payment":true,"allow_bank_transfer":true,"sale_restriction":"none"}');
select public.admin_save_good('{"id":"random-single","ip_id":"random-option-tests","name":"단일 옵션","price":5000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"RANDOM-S","attributes":{},"extraPrice":0,"stockQty":5}]}');
select public.admin_save_good('{"id":"random-priced","ip_id":"random-option-tests","name":"가격 다른 옵션","price":5000,
 "variant_baseline":[],"variants":[{"name":"A","code":"RANDOM-PA","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":5},
  {"name":"B","code":"RANDOM-PB","attributes":{"멤버":"B"},"extraPrice":1000,"stockQty":5}]}');
select public.admin_save_good('{"id":"random-limited","ip_id":"random-option-tests","name":"옵션 제한","price":5000,
 "variant_baseline":[],"variants":[{"name":"A","code":"RANDOM-LA","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":5,"orderMaxQty":1},
  {"name":"B","code":"RANDOM-LB","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":5}]}');
select public.admin_save_good('{"id":"select-main","ip_id":"random-option-tests","name":"일반 굿즈","price":3000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"RANDOM-N","attributes":{},"extraPrice":0,"stockQty":10}]}');
reset role;
select id as variant_a from public.goods_variants where code='RANDOM-A' \gset
select id as variant_b from public.goods_variants where code='RANDOM-B' \gset
select id as variant_c from public.goods_variants where code='RANDOM-C' \gset
select id as select_variant from public.goods_variants where code='RANDOM-N' \gset
select 1/case when exists(select 1 from public.goods_variants where id=:'variant_a' and is_default) then 1 else 0 end as assert_first_option_is_cart_key;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/random-option-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000162030'
 where id in ('random-main','select-main');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('random-main','select-main');

-- setter: 권한·낙관 잠금·랜덤 조건.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
select pg_temp.expect_error(format('select public.admin_set_goods_option_sale_mode(%L,%L,%L)','random-main','random',(select updated_at from public.goods where id='random-main')),
 'operator_capability_required','42501');
select pg_temp.expect_error($sql$select public.admin_goods_option_sale_mode('random-main')$sql$,'operator_capability_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select pg_temp.expect_error($sql$select public.admin_set_goods_option_sale_mode('random-main','random','2000-01-01T00:00:00Z')$sql$,'goods_changed','PT409');
select pg_temp.expect_error($sql$select public.admin_set_goods_option_sale_mode('random-main','lucky',now())$sql$,'invalid_option_sale_mode');
select pg_temp.expect_error(format('select public.admin_set_goods_option_sale_mode(%L,%L,%L)','random-single','random',(select updated_at from public.goods where id='random-single')),
 'random_option_count','23514');
select pg_temp.expect_error(format('select public.admin_set_goods_option_sale_mode(%L,%L,%L)','random-priced','random',(select updated_at from public.goods where id='random-priced')),
 'random_option_price_mismatch','23514');
select pg_temp.expect_error(format('select public.admin_set_goods_option_sale_mode(%L,%L,%L)','random-limited','random',(select updated_at from public.goods where id='random-limited')),
 'random_option_variant_limits','23514');
select 1/case when public.admin_goods_option_sale_mode('random-priced')->>'randomProblem'='random_option_price_mismatch'
 and public.admin_goods_option_sale_mode('random-main')->>'randomProblem' is null
 and public.admin_goods_option_sale_mode('random-main')->>'optionSaleMode'='select'
 and (public.admin_goods_option_sale_mode('random-main')->>'activeOptionCount')::integer=3
 then 1 else 0 end as assert_admin_reader_reports_eligibility;
select public.admin_set_goods_option_sale_mode('random-main','random',(select updated_at from public.goods where id='random-main')) as switched \gset
reset role;
select 1/case when (:'switched'::jsonb->>'optionSaleMode')='random'
 and exists(select 1 from public.goods where id='random-main' and option_sale_mode='random')
 and exists(select 1 from public.audit_log where target='goods:random-main' and action='admin.good.option_sale_mode_changed'
   and diff=jsonb_build_object('before','select','after','random'))
 then 1 else 0 end as assert_setter_switches_and_audits;

-- 랜덤 굿즈의 판매가는 하나다. 상품 판매가를 바꾸면(목록 인라인·일괄 변경) 판매 중인 모든 옵션 가격이 함께 바뀐다.
update public.goods set price=5500 where id='random-main';
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select 1/case when (select count(*) from public.goods_variants where good_id='random-main' and archived_at is null and price=5500)=3
 and (select price from public.goods_variants where id=:'select_variant')=3000
 then 1 else 0 end as assert_random_price_follows_good_price;
update public.goods set price=5000 where id='random-main';

-- 조건 재검사: 랜덤 굿즈의 옵션 가격·옵션별 제한·판매 중지·단일 옵션 기간 할인 저장은 커밋에서 거절된다.
select pg_temp.expect_deferred_error(format('update public.goods_variants set price=6000 where id=%L',:'variant_b'),'random_option_price_mismatch');
select pg_temp.expect_deferred_error(format('update public.goods_variants set order_max_qty=2 where id=%L',:'variant_c'),'random_option_variant_limits');
select pg_temp.expect_deferred_error(format('update public.goods_variants set archived_at=now() where id in (%L,%L)',:'variant_b',:'variant_c'),'random_option_count');
select pg_temp.expect_deferred_error(format('update public.goods_variants set archived_at=now() where id=%L',:'variant_a'),'random_option_default_inactive');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select pg_temp.expect_deferred_error(format('select public.admin_save_goods_price_period(%L,%L,null,%L)','random-main',:'variant_b',
 '{"state":"active","discountPrice":4000,"startsAt":"2020-01-01T00:00:00Z","endsAt":"2099-01-01T00:00:00Z"}'),'random_option_price_mismatch');
reset role;
-- 모든 옵션에 같은 기간 할인을 한 번에 넣으면 균일하다.
set local role authenticated;
select public.admin_save_goods_price_period('random-main',id,null,'{"state":"active","discountPrice":4000,"startsAt":"2020-01-01T00:00:00Z","endsAt":"2099-01-01T00:00:00Z"}')
 from public.goods_variants where good_id='random-main' and archived_at is null order by id;
reset role;
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select 1/case when (select count(distinct effective_price) from public.goods_variants v
   cross join lateral private.resolve_goods_variant_price(v.id,clock_timestamp()) where v.good_id='random-main')=1
 then 1 else 0 end as assert_uniform_period_allowed;

-- 장바구니: 어떤 옵션 id로 담아도 기본 옵션 한 줄이고, 가용 수량은 풀 합계(2+3+5)다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
select public.set_cart_item_quantity('random-main',:'variant_c',4);
select 1/case when (select count(*) from public.cart_items where good_id='random-main')=1
 and exists(select 1 from public.cart_items where good_id='random-main' and variant_id=:'variant_a' and qty=4)
 then 1 else 0 end as assert_cart_key_is_default_option;
select pg_temp.expect_error(format('select public.set_cart_item_quantity(%L,%L,11)','random-main',:'variant_a'),'out of stock','23514');
select public.set_cart_item_quantity('random-main',:'variant_a',4);
select public.set_cart_item_quantity('select-main',:'select_variant',1);
-- 견적: 랜덤 줄은 optionSaleMode='random', supply.availableQty = 풀 합계.
select public.quote_goods_sales(jsonb_build_array(
  jsonb_build_object('goodId','random-main','variantId',:'variant_a','qty',4),
  jsonb_build_object('goodId','select-main','variantId',:'select_variant','qty',1))) as random_quote \gset
reset role;
select 1/case when (select line->>'optionSaleMode'='random' and (line#>>'{supply,availableQty}')::integer=10 and (line->>'available')::boolean
   and (line->>'effectivePrice')::integer=4000
   from jsonb_array_elements(:'random_quote'::jsonb->'lines') line where line->>'goodId'='random-main')
 and (select line->>'optionSaleMode'='select' and (line#>>'{supply,availableQty}')::integer=10
   from jsonb_array_elements(:'random_quote'::jsonb->'lines') line where line->>'goodId'='select-main')
 then 1 else 0 end as assert_quote_uses_pool;
set local role authenticated;
select 1/case when (select (line->>'available')::boolean from jsonb_array_elements(public.quote_goods_sales(jsonb_build_array(
  jsonb_build_object('goodId','random-main','variantId',:'variant_a','qty',11)))->'lines') line)=false
 then 1 else 0 end as assert_quote_over_pool_unavailable;

-- 주문: 배정은 옵션별 행으로 나뉘고, 재고는 배정 옵션에서 빠지며, 증빙·감사가 남는다.
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000162002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000162020'::uuid,'card'::public.order_payment_method) as random_order \gset
reset role;
select 1/case when (select sum(qty) from public.order_items where order_id=:'random_order' and good_id='random-main')=4
 and not exists(select 1 from public.order_items where order_id=:'random_order' and good_id='random-main' and option_sale_mode_snapshot is distinct from 'random')
 and (select count(*) from public.order_items where order_id=:'random_order' and good_id='random-main')
   =(select count(distinct variant_id) from public.order_items where order_id=:'random_order' and good_id='random-main')
 and exists(select 1 from public.order_items where order_id=:'random_order' and good_id='select-main' and option_sale_mode_snapshot is null)
 and (select sum(stock_qty) from public.goods_variants where good_id='random-main')=6
 and (select stock_qty from public.goods where id='random-main')=6
 and (select sum(qty*unit_price) from public.order_items where order_id=:'random_order')=4*4000+3000
 and not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and good_id='random-main')
 then 1 else 0 end as assert_random_allocation_rows_and_stock;
select 1/case when (select count(*) from private.order_item_random_allocations a join public.order_items i on i.id=a.order_item_id
   where a.order_id=:'random_order' and a.variant_id=i.variant_id and a.qty=i.qty and a.cart_variant_id=:'variant_a'
     and a.user_id='00000000-0000-4000-8000-000000162002' and a.rng='pgcrypto.gen_random_bytes:rejection')
   =(select count(*) from public.order_items where order_id=:'random_order' and good_id='random-main')
 and (select count(distinct draw_id) from private.order_item_random_allocations where order_id=:'random_order')=1
 and (select sum(jsonb_array_length(draws)) from private.order_item_random_allocations where order_id=:'random_order')=4
 and (select pool_before from private.order_item_random_allocations where order_id=:'random_order' limit 1)
   =(select jsonb_agg(jsonb_build_object('variantId',id,'availableQty',case id when :'variant_a'::uuid then 2 when :'variant_b'::uuid then 3 else 5 end) order by id)
     from public.goods_variants where good_id='random-main')
 and exists(select 1 from public.audit_log where target='order:'||:'random_order' and action='order.random_option_allocated'
   and actor_id='00000000-0000-4000-8000-000000162002' and (diff->>'qty')::integer=4)
 then 1 else 0 end as assert_allocation_evidence;
-- 추출 근거는 배정 행마다 그 옵션에 떨어진 추출만 담는다(같은 근거를 행마다 중복 저장하지 않는다, SEC-DB-2).
-- 같은 draw_id의 행을 step 순으로 합치면 전체 추출 순서이고, step k의 bound는 남은 풀 합계(10-(k-1))다.
select 1/case when not exists(select 1 from private.order_item_random_allocations a where a.order_id=:'random_order'
     and (jsonb_array_length(a.draws)<>a.qty
       or exists(select 1 from jsonb_array_elements(a.draws) d where (d->>'variantId')::uuid<>a.variant_id)))
 and (select array_agg((d->>'step')::integer order by (d->>'step')::integer)
   from private.order_item_random_allocations a cross join lateral jsonb_array_elements(a.draws) d
   where a.order_id=:'random_order')='{1,2,3,4}'::integer[]
 and not exists(select 1 from private.order_item_random_allocations a cross join lateral jsonb_array_elements(a.draws) d
   where a.order_id=:'random_order'
     and ((d->>'bound')::bigint<>11-(d->>'step')::integer or (d->>'roll')::bigint not between 0 and (d->>'bound')::bigint-1))
 then 1 else 0 end as assert_allocation_draws_partitioned;
-- 각 배정 옵션의 재고 감소 = 그 옵션 배정 수량.
select 1/case when not exists(select 1 from public.goods_variants v where v.good_id='random-main'
   and v.stock_qty<>(case v.id when :'variant_a'::uuid then 2 when :'variant_b'::uuid then 3 else 5 end)
     -coalesce((select sum(qty) from public.order_items i where i.order_id=:'random_order' and i.variant_id=v.id),0))
 then 1 else 0 end as assert_stock_follows_allocation;

-- 같은 checkout key 재시도는 다시 뽑지 않는다.
set local role service_role;
select 1/case when public.place_order('00000000-0000-4000-8000-000000162002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000162020'::uuid,'card'::public.order_payment_method)=:'random_order'::uuid then 1 else 0 end as assert_retry_returns_same_order;
reset role;
select 1/case when (select count(*) from private.order_item_random_allocations where order_id=:'random_order')
   =(select count(*) from public.order_items where order_id=:'random_order' and good_id='random-main')
 and (select sum(stock_qty) from public.goods_variants where good_id='random-main')=6
 then 1 else 0 end as assert_retry_does_not_redraw;

-- 공개 리뷰의 구매 옵션명도 '랜덤'이다.
insert into public.reviews(user_id,good_id,order_id,rating,body)
 values('00000000-0000-4000-8000-000000162002','random-main',:'random_order',5,'랜덤 포토카드 검증용 리뷰입니다');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when public.get_good_group_reviews_v3('random-main')#>'{reviews,0,variantNames}'='["랜덤"]'::jsonb
 then 1 else 0 end as assert_public_review_masks_random_option;
reset role;

-- 고객 은닉: 직접 select에서는 랜덤 행이 빠지고, 마스킹 RPC는 '랜덤'·기본 옵션 키로 보여 준다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
select 1/case when (select count(*) from public.order_items where order_id=:'random_order')=1
 and not exists(select 1 from public.order_items where order_id=:'random_order' and good_id='random-main')
 then 1 else 0 end as assert_customer_direct_read_hides_random_rows;
select 1/case when (select count(*) from public.my_order_items(array[:'random_order'::uuid]))
   =(select count(*) from public.my_order_items(array[:'random_order'::uuid]) where good_id='select-main')+(select count(*) from public.my_order_items(array[:'random_order'::uuid]) where good_id='random-main')
 and (select sum(qty) from public.my_order_items(array[:'random_order'::uuid]) where good_id='random-main')=4
 and not exists(select 1 from public.my_order_items(array[:'random_order'::uuid]) where good_id='random-main'
   and (variant_name_snapshot<>'랜덤' or variant_code_snapshot is not null or variant_id<>:'variant_a'::uuid or option_sale_mode<>'random'))
 and exists(select 1 from public.my_order_items(array[:'random_order'::uuid]) where good_id='select-main'
   and variant_id=:'select_variant'::uuid and option_sale_mode='select' and variant_code_snapshot='RANDOM-N')
 then 1 else 0 end as assert_masked_reader;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select 1/case when (select count(*) from public.my_order_items(array[:'random_order'::uuid]))=0
 then 1 else 0 end as assert_masked_reader_is_owner_only;
-- 운영자(sales.read)는 배정 옵션 행을 그대로 읽는다.
select 1/case when (select sum(qty) from public.order_items where order_id=:'random_order' and good_id='random-main')=4
 then 1 else 0 end as assert_staff_reads_allocated_rows;
-- 어드민 주문 상세 품목은 배정 옵션 그대로이고, 랜덤 배정 행은 optionSaleMode='random', 고른 옵션 행은 'select'다.
select public.admin_order_detail(:'random_order')->'items' as admin_detail_items \gset
select 1/case when (select count(*) from jsonb_array_elements(:'admin_detail_items'::jsonb) line
     join public.order_items item on item.id=(line->>'id')::uuid and item.order_id=:'random_order'
     where line->>'variantId'=item.variant_id::text
       and line->>'variantName' is not distinct from item.variant_name_snapshot
       and line->>'optionSaleMode'=case when item.option_sale_mode_snapshot='random' then 'random' else 'select' end)
   =(select count(*) from public.order_items where order_id=:'random_order')
 and (select count(*) from jsonb_array_elements(:'admin_detail_items'::jsonb) line where line->>'optionSaleMode'='random')
   =(select count(*) from public.order_items where order_id=:'random_order' and good_id='random-main')
 and (select count(*) from jsonb_array_elements(:'admin_detail_items'::jsonb) line where line->>'optionSaleMode'='select')=1
 then 1 else 0 end as assert_admin_order_detail_marks_random_allocation;
reset role;
select pg_temp.expect_error($sql$update public.order_items set option_sale_mode_snapshot=null where option_sale_mode_snapshot='random'$sql$,
 'order_item_option_sale_mode_immutable');

-- 다른 경로가 랜덤 굿즈 행을 배정 없이 만들 수 없다(거래 런타임·선물·구독 차단).
select pg_temp.expect_error(format($sql$insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot)
 values(%L,'random-main',%L,1,4000,'랜덤','문구')$sql$,:'random_order',:'variant_b'),'random_option_checkout_unsupported','23514');

-- 전체 취소는 배정된 옵션으로 재고를 돌려준다.
select public.finalize_order_cancellation_with_provider_evidence(:'random_order','합성 미결제 취소','{}');
select 1/case when (select stock_qty from public.goods_variants where id=:'variant_a')=2
 and (select stock_qty from public.goods_variants where id=:'variant_b')=3
 and (select stock_qty from public.goods_variants where id=:'variant_c')=5
 then 1 else 0 end as assert_cancellation_restores_allocated_options;

-- 재고가 한 옵션에만 남으면 전부 그 옵션으로 배정되고, 풀보다 많으면 주문이 거절된다.
update public.goods_variants set stock_qty=0 where id in (:'variant_a',:'variant_b');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
select public.set_cart_item_quantity('select-main',:'select_variant',0);
select public.set_cart_item_quantity('random-main',:'variant_a',3);
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000162002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000162021'::uuid,'card'::public.order_payment_method) as only_c_order \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'only_c_order')=1
 and exists(select 1 from public.order_items where order_id=:'only_c_order' and variant_id=:'variant_c' and qty=3 and variant_name_snapshot='C')
 and (select stock_qty from public.goods_variants where id=:'variant_c')=2
 then 1 else 0 end as assert_single_remaining_option_takes_all;
set local role authenticated;
select pg_temp.expect_error(format('select public.set_cart_item_quantity(%L,%L,3)','random-main',:'variant_a'),'out of stock','23514');
reset role;
insert into public.cart_items(user_id,good_id,variant_id,qty) values('00000000-0000-4000-8000-000000162002','random-main',:'variant_a',3);
set local role service_role;
select pg_temp.expect_error($sql$select public.place_order('00000000-0000-4000-8000-000000162002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000162022'::uuid,'card'::public.order_payment_method)$sql$,'out of stock','23514');
reset role;

-- 랜덤 해제(select)는 조건 없이 된다. 이후 새 주문은 고른 옵션 그대로다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_set_goods_option_sale_mode('random-main','select',(select updated_at from public.goods where id='random-main'));
reset role;
select 1/case when exists(select 1 from public.goods where id='random-main' and option_sale_mode='select') then 1 else 0 end as assert_switch_back_to_select;

-- 랜덤 전환 전에 담긴 비기본 옵션 줄(B)은 그 줄의 수량으로 바꾼 뒤 기본 옵션 줄에 합친다. 기본 옵션 줄 수량은 보존된다(T6-R3).
-- 병합·추가 담기는 장바구니 키(기본 옵션) 줄의 수량을 기준으로 하므로, 남은 B 줄을 두 번 세지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_save_good('{"id":"random-cart","ip_id":"random-option-tests","name":"랜덤 장바구니","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"RANDOM-CA","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":20},
  {"name":"B","code":"RANDOM-CB","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":20}]}');
reset role;
select id as cart_a from public.goods_variants where code='RANDOM-CA' \gset
select id as cart_b from public.goods_variants where code='RANDOM-CB' \gset
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/random-option-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000162030'
 where id='random-cart';
select pg_temp.publish_goods_kc_fixture('random-cart');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
select public.set_cart_item_quantity('random-cart',:'cart_a',1);
select public.set_cart_item_quantity('random-cart',:'cart_b',2);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_set_goods_option_sale_mode('random-cart','random',(select updated_at from public.goods where id='random-cart'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162002',true);
-- 추가 담기: 기대 수량은 키 줄(A=1)이고 키 줄만 늘어난다. 남은 B 줄(2)은 그대로다.
select public.add_cart_selection('random-cart',jsonb_build_array(jsonb_build_object('good_id','random-cart','variant_id',:'cart_b','qty',1,'expected_qty',1)));
reset role;
select 1/case when (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_a')=2
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_b')=2
 then 1 else 0 end as assert_add_selection_targets_cart_key_line;
-- 병합: 키 줄(2)과 들어온 수량(2) 중 큰 값이다. B 줄을 더하지 않는다.
set local role authenticated;
select public.merge_cart_items(jsonb_build_array(jsonb_build_object('good_id','random-cart','variant_id',:'cart_b','qty',2)));
reset role;
select 1/case when (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_a')=2
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_b')=2
 then 1 else 0 end as assert_merge_targets_cart_key_line;
-- 고객이 남은 B 줄(2개)을 3개로 바꾼다 → A 2 + B 3 = 기본 옵션 한 줄 5개.
set local role authenticated;
select public.set_cart_item_quantity('random-cart',:'cart_b',3);
reset role;
select 1/case when (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and good_id='random-cart')=1
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and good_id='random-cart' and variant_id=:'cart_a')=5
 then 1 else 0 end as assert_stale_line_folds_into_cart_key;
-- 합친 수량이 풀(40)을 넘으면 거절되고 줄은 그대로다.
set local role authenticated;
select public.set_cart_item_quantity('random-cart',:'cart_a',1);
reset role;
insert into public.cart_items(user_id,good_id,variant_id,qty) values('00000000-0000-4000-8000-000000162002','random-cart',:'cart_b',30);
set local role authenticated;
select pg_temp.expect_error(format('select public.set_cart_item_quantity(%L,%L,40)','random-cart',:'cart_b'),'out of stock','23514');
select public.set_cart_item_quantity('random-cart',:'cart_b',39);
reset role;
select 1/case when (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and good_id='random-cart')=1
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and good_id='random-cart' and variant_id=:'cart_a')=40
 then 1 else 0 end as assert_folded_line_checks_pool;
-- 0으로 바꾸면 그 줄만 지운다.
insert into public.cart_items(user_id,good_id,variant_id,qty) values('00000000-0000-4000-8000-000000162002','random-cart',:'cart_b',1);
set local role authenticated;
select public.set_cart_item_quantity('random-cart',:'cart_b',0);
reset role;
select 1/case when not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_b')
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000162002' and variant_id=:'cart_a')=40
 then 1 else 0 end as assert_stale_line_removal_keeps_key_line;

-- 큰 수량 주문: 추출 근거를 수량에 선형인 비용으로 쌓는다. 수량 10,000(풀 3×4,000)을 배정하는 동안 굿즈·옵션 행 잠금을
-- 몇 초씩 쥐지 않는다(SEC-DB-2: 추출마다 jsonb 배열 전체를 복사하면 6.8초가 걸렸다). 시간 상한은 선형 비용의 수십 배 여유다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000162003','authenticated','authenticated','random-option-bulk@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='랜덤대량',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000162003';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_save_good('{"id":"random-bulk","ip_id":"random-option-tests","name":"랜덤 대량","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"RANDOM-BA","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":4000},
  {"name":"B","code":"RANDOM-BB","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":4000},
  {"name":"C","code":"RANDOM-BC","attributes":{"멤버":"C"},"extraPrice":0,"stockQty":4000}],
 "allow_card_payment":true,"allow_bank_transfer":true,"sale_restriction":"none"}');
reset role;
select id as bulk_a from public.goods_variants where code='RANDOM-BA' \gset
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/random-option-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000162030'
 where id='random-bulk';
select pg_temp.publish_goods_kc_fixture('random-bulk');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162001',true);
select public.admin_set_goods_option_sale_mode('random-bulk','random',(select updated_at from public.goods where id='random-bulk'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000162003',true);
select public.set_cart_item_quantity('random-bulk',:'bulk_a',10000);
reset role;
select clock_timestamp() as bulk_started \gset
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000162003'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000162023'::uuid,'card'::public.order_payment_method) as bulk_order \gset
reset role;
select 1/case when clock_timestamp()-:'bulk_started'::timestamptz<interval '3 seconds'
 and (select sum(qty) from public.order_items where order_id=:'bulk_order')=10000
 and (select sum(stock_qty) from public.goods_variants where good_id='random-bulk')=2000
 and (select sum(jsonb_array_length(draws)) from private.order_item_random_allocations where order_id=:'bulk_order')=10000
 and not exists(select 1 from private.order_item_random_allocations a where a.order_id=:'bulk_order' and jsonb_array_length(a.draws)<>a.qty)
 then 1 else 0 end as assert_bulk_allocation_is_linear;

-- 계약: 내부 함수·증빙 테이블 봉인, 고객 RPC grant, 정책 계약 등록.
select 1/case when not has_table_privilege('authenticated','private.order_item_random_allocations','select')
 and not has_table_privilege('service_role','private.order_item_random_allocations','select')
 and not has_function_privilege('authenticated','private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamp with time zone,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','private.random_below(bigint)','execute')
 and not has_function_privilege('anon','public.my_order_items(uuid[])','execute')
 and has_function_privilege('authenticated','public.my_order_items(uuid[])','execute')
 and not has_function_privilege('anon','public.admin_set_goods_option_sale_mode(text,text,timestamp with time zone)','execute')
 and exists(select 1 from private.operator_policy_contracts where table_name='order_items' and policy_name='random_items_private_read')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_set_goods_option_sale_mode(text,text,timestamp with time zone)')
 then 1 else 0 end as assert_random_contracts_sealed;

rollback;
