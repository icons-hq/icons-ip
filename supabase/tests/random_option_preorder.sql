\set ON_ERROR_STOP on
-- 랜덤 판매 + 예약판매·같은 옵션 배정 상한(20261111100000, 12/2 홍실 퀘스트 2차 예약 판매).
-- 일정이 섞인 랜덤 예약 거절·일괄 RPC(초안·활성화·중지·일반 재고 전환)·풀 공급 은닉·예약 물량 비례 배정·예약 기록·취소 복원·
-- 입고 할당·같은 옵션 배정 상한(조건·정적 견적 한도·결정적 배정·가능 수량 거절)을 확인한다.
-- Prepend supabase/tests/helpers/goods_kc_fixture.sql in the same psql session.
begin;
select set_config('request.jwt.claim.sub','',true);

create function pg_temp.expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and expected_message='preorder_admin_required' then return; end if;
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
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
create function pg_temp.approve_fixture(p_order_id uuid,p_user_id uuid,p_claim_id uuid,p_provider_key text) returns void
language plpgsql as $$ declare attempt public.payment_attempts; begin
  perform public.prepare_goods_payment_attempt(p_user_id,p_order_id,'toss');
  select * into attempt from public.payment_attempts where ref_id=p_order_id order by created_at desc limit 1;
  perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('b',64));
  perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('b',64),p_claim_id);
  if public.finalize_goods_payment_attempt(attempt.id,p_claim_id,'approved',null,p_provider_key)<>'approved' then raise exception 'synthetic approval must complete'; end if;
end $$;
-- 공통 일정. 발송 예정일만 바꿔 일정이 다른 정책을 만든다.
create function pg_temp.rp_values(p_ship_offset integer default 7) returns jsonb language sql as $$
  select jsonb_build_object('startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
    'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+p_ship_offset,'approvalReference','TEST-ONLY 랜덤 예약 승인');
$$;
create function pg_temp.place(p_user uuid,p_key uuid) returns uuid language sql as $$
  select public.place_order(p_user,'{"recipientName":"랜덤 예약 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
    p_key,'card'::public.order_payment_method);
$$;
grant execute on function pg_temp.place(uuid,uuid) to service_role;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000211101','authenticated','authenticated','random-preorder-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000211102','authenticated','authenticated','random-preorder-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000211103','authenticated','authenticated','random-preorder-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000211104','authenticated','authenticated','random-preorder-limit@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='랜덤예약관리' where id='00000000-0000-4000-8000-000000211101';
update public.profiles set role='staff',nickname='랜덤예약운영' where id='00000000-0000-4000-8000-000000211102';
update public.profiles set nickname='랜덤예약구매'||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211104');
insert into public.verticals(key,label,color) values('random-preorder-tests','랜덤 예약 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('random-preorder-tests','랜덤 예약 검증','random-preorder-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000211130','random-preorder-tests','검증 출고지','hanjin',3000,20000,'배송 금지 검증 주소',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select public.admin_save_good('{"id":"rp-main","ip_id":"random-preorder-tests","name":"랜덤 예약 포토카드","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"RP-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":0},
  {"name":"B","code":"RP-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":0},
  {"name":"C","code":"RP-C","attributes":{"멤버":"C"},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_good('{"id":"rp-limit","ip_id":"random-preorder-tests","name":"랜덤 배정 상한","price":3000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"RL-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":10,"orderMaxQty":2},
  {"name":"B","code":"RL-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":10},
  {"name":"C","code":"RL-C","attributes":{"멤버":"C"},"extraPrice":0,"stockQty":1}]}');
reset role;
select id as rp_a from public.goods_variants where code='RP-A' \gset
select id as rp_b from public.goods_variants where code='RP-B' \gset
select id as rp_c from public.goods_variants where code='RP-C' \gset
select id as rl_a from public.goods_variants where code='RL-A' \gset
select id as rl_b from public.goods_variants where code='RL-B' \gset
select id as rl_c from public.goods_variants where code='RL-C' \gset
select 1/case when exists(select 1 from public.goods_variants where id=:'rp_a' and is_default)
 and exists(select 1 from public.goods_variants where id=:'rl_a' and is_default) then 1 else 0 end as assert_first_option_is_cart_key;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/random-preorder-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-11',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000211130'
 where id in ('rp-main','rp-limit');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('rp-main','rp-limit');

-- 1. 일반 재고 랜덤으로 바꾼 뒤, 옵션 하나만 예약을 켜면(섞인 상태) 커밋에서 거절된다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select public.admin_set_goods_option_sale_mode('rp-main','random',(select updated_at from public.goods where id='rp-main'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211101',true);
select pg_temp.expect_deferred_error(format('select public.admin_save_goods_preorder(%L,%L,null,%L::jsonb)','rp-main',:'rp_a',
 (pg_temp.rp_values()||'{"state":"active","capacityQty":2}')::text),'random_option_preorder_mismatch');
reset role;
select 1/case when not exists(select 1 from public.goods_variants where good_id='rp-main' and preorder_policy_id is not null)
 then 1 else 0 end as assert_mixed_selection_rolled_back;

-- 2. 일괄 RPC 입력·대상 검증과 초안 저장(운영자). 초안은 판매에 반영되지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,%L::jsonb,%L::jsonb)','rp-main','draft',
 pg_temp.rp_values()::text,jsonb_build_array(jsonb_build_object('variantId','not-a-uuid','capacityQty',1))::text),'invalid_random_preorder','22023');
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,%L::jsonb,%L::jsonb)','rp-main','draft',
 (pg_temp.rp_values()||'{"state":"active"}')::text,jsonb_build_array(jsonb_build_object('variantId',:'rp_a','capacityQty',1))::text),'invalid_random_preorder','22023');
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,%L::jsonb,%L::jsonb)','rp-main','draft',
 pg_temp.rp_values()::text,jsonb_build_array(jsonb_build_object('variantId',:'rp_a','capacityQty',2),
   jsonb_build_object('variantId',:'rp_b','capacityQty',3))::text),'random_preorder_options_mismatch','23514');
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,%L::jsonb,%L::jsonb)','rp-limit','draft',
 pg_temp.rp_values()::text,jsonb_build_array(jsonb_build_object('variantId',:'rl_a','capacityQty',2),
   jsonb_build_object('variantId',:'rl_b','capacityQty',2),jsonb_build_object('variantId',:'rl_c','capacityQty',2))::text),'random_option_required','23514');
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,%L::jsonb,%L::jsonb)','rp-main','active',
 pg_temp.rp_values()::text,jsonb_build_array(jsonb_build_object('variantId',:'rp_a','capacityQty',2),
   jsonb_build_object('variantId',:'rp_b','capacityQty',3),jsonb_build_object('variantId',:'rp_c','capacityQty',5))::text),'preorder_admin_required','42501');
select public.admin_save_random_goods_preorders('rp-main','draft',pg_temp.rp_values(),jsonb_build_array(
 jsonb_build_object('variantId',:'rp_a','capacityQty',2),jsonb_build_object('variantId',:'rp_b','capacityQty',3),
 jsonb_build_object('variantId',:'rp_c','capacityQty',5))) as draft_result \gset
reset role;
select 1/case when jsonb_array_length(:'draft_result'::jsonb->'results')=3
 and (select count(*) from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id
   where v.good_id='rp-main' and p.state='draft' and p.approval_reference='TEST-ONLY 랜덤 예약 승인')=3
 and not exists(select 1 from public.goods_variants where good_id='rp-main' and preorder_policy_id is not null)
 and (select public.goods_variant_supply(v)->>'mode' from public.goods_variants v where v.id=:'rp_a')='stock'
 then 1 else 0 end as assert_bulk_draft_has_no_sales_effect;

-- 3. 일괄 활성화(관리자): 저장된 초안을 이어 쓰고, 한 트랜잭션에서 모든 옵션이 같은 일정으로 예약을 선택한다.
select jsonb_agg(jsonb_build_object('variantId',p.variant_id,'policyId',p.id,'expectedRevision',p.revision,'capacityQty',p.capacity_qty)) as activation_options
 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='rp-main' and p.state='draft' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211101',true);
select public.admin_save_random_goods_preorders('rp-main','active',pg_temp.rp_values(),:'activation_options'::jsonb);
reset role;
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select p.id as rp_policy_a from private.goods_preorder_policies p where p.variant_id=:'rp_a' and p.state='active' \gset
select p.id as rp_policy_b from private.goods_preorder_policies p where p.variant_id=:'rp_b' and p.state='active' \gset
select p.id as rp_policy_c from private.goods_preorder_policies p where p.variant_id=:'rp_c' and p.state='active' \gset
select 1/case when (select count(*) from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id
   where v.good_id='rp-main' and p.state='active')=3
 and (select array_agg(p.capacity_qty order by v.code) from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id
   where v.good_id='rp-main')='{2,3,5}'::integer[]
 and exists(select 1 from public.audit_log where target='goods:rp-main' and action='admin.good.random_preorders_saved' and diff->>'state'='active')
 and (select count(*) from public.audit_log where target='goods:rp-main' and action='admin.good.preorder_saved')=6
 and private.goods_random_option_problem('rp-main') is null
 then 1 else 0 end as assert_bulk_activation_selects_all_options;
select (now() at time zone 'Asia/Seoul')::date+7 as ship_date \gset

-- 4. 고객 공급은 풀 기준이다: 어느 옵션 id로 불러도 같은 값(남은 예약 물량 합 10)이고, 정책은 기본 옵션의 것이다.
select 1/case when (select count(distinct public.goods_variant_supply(v)-'calculatedAt') from public.goods_variants v where v.good_id='rp-main')=1
 and (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_c')
   @>jsonb_build_object('mode','preorder','availableQty',10,'state','open','expectedShipDate',:'ship_date','policyId',:'rp_policy_a')
 then 1 else 0 end as assert_option_supply_is_pool;
set local role anon;
select 1/case when (select public.goods_random_option(g) from public.goods g where g.id='rp-main')
   @>jsonb_build_object('name','랜덤','id',:'rp_a','stock_qty',0,'order_max_qty',null,'member_max_qty',null,
     'allocation_limit',jsonb_build_object('orderMaxQty',null,'memberMaxQty',null))
 and (select public.goods_random_option(g)->'supply' from public.goods g where g.id='rp-main')
   @>jsonb_build_object('mode','preorder','availableQty',10,'state','open','expectedShipDate',:'ship_date')
 then 1 else 0 end as assert_public_random_line_is_preorder_pool;
reset role;

-- 옵션 하나의 접수를 멈추면(선택은 그대로) 풀에서만 빠지고, 다른 일정으로 다시 열면 거절된다. 같은 일정이면 허용된다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select public.admin_save_goods_preorder('rp-main',:'rp_c',:'rp_policy_c','{"state":"stopped"}',2);
reset role;
select 1/case when (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_a')
   @>jsonb_build_object('availableQty',5,'state','open')
 then 1 else 0 end as assert_stopped_option_leaves_pool;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211101',true);
select pg_temp.expect_deferred_error(format('select public.admin_save_goods_preorder(%L,%L,null,%L::jsonb)','rp-main',:'rp_c',
 (pg_temp.rp_values(10)||'{"state":"active","capacityQty":5}')::text),'random_option_preorder_mismatch');
select public.admin_save_goods_preorder('rp-main',:'rp_c',null,pg_temp.rp_values()||'{"state":"active","capacityQty":5}')->>'id' as rp_policy_c \gset
reset role;
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select 1/case when (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_a')
   @>jsonb_build_object('availableQty',10,'state','open')
 and exists(select 1 from public.goods_variants where id=:'rp_c' and preorder_policy_id=:'rp_policy_c')
 then 1 else 0 end as assert_same_window_reactivation_allowed;

-- 5. 장바구니·견적: 기본 옵션 한 줄, 가용 수량은 남은 예약 물량 합.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211103',true);
select public.set_cart_item_quantity('rp-main',:'rp_c',4);
select 1/case when (select count(*) from public.cart_items where good_id='rp-main')=1
 and exists(select 1 from public.cart_items where good_id='rp-main' and variant_id=:'rp_a' and qty=4)
 then 1 else 0 end as assert_cart_key_line;
select pg_temp.expect_error(format('select public.set_cart_item_quantity(%L,%L,11)','rp-main',:'rp_a'),'out of stock','23514');
select public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','rp-main','variantId',:'rp_a','qty',4))) as rp_quote \gset
reset role;
select 1/case when (select line->>'optionSaleMode'='random' and (line->>'available')::boolean
   and line->'supply'@>jsonb_build_object('mode','preorder','availableQty',10,'state','open','expectedShipDate',:'ship_date')
   and line->'optionLimit'=jsonb_build_object('orderMaxQty',null,'memberMaxQty',null,'memberReservedQty',null,'memberRemainingQty',null,'reason',null)
   from jsonb_array_elements(:'rp_quote'::jsonb->'lines') line)
 and (:'rp_quote'::jsonb#>>'{shipping,groups,0,expectedShipDate}')=:'ship_date'
 then 1 else 0 end as assert_quote_uses_preorder_pool;

-- 6. 주문: 남은 예약 물량에 비례해 배정하고, 배정 행마다 그 옵션 정책의 스냅샷·예약을 만든다. 실물 재고는 그대로다.
set local role service_role;
select pg_temp.place('00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211140') as first_order \gset
reset role;
select 1/case when (select sum(qty) from public.order_items where order_id=:'first_order')=4
 and not exists(select 1 from public.order_items item join public.goods_variants variant on variant.id=item.variant_id
   where item.order_id=:'first_order' and (item.supply_source<>'preorder' or item.option_sale_mode_snapshot is distinct from 'random'
     or item.preorder_policy_id is distinct from variant.preorder_policy_id or item.preorder_expected_ship_date<>:'ship_date'::date
     or item.preorder_snapshot->>'policyId'<>item.preorder_policy_id::text))
 and (select count(*) from public.order_items where order_id=:'first_order')
   =(select count(distinct variant_id) from public.order_items where order_id=:'first_order')
 and (select count(*) from private.goods_preorder_reservations r join public.order_items i on i.id=r.order_item_id
   where r.order_id=:'first_order' and r.state='reserved' and r.qty=i.qty and r.policy_id=i.preorder_policy_id)
   =(select count(*) from public.order_items where order_id=:'first_order')
 and (select sum(stock_qty) from public.goods_variants where good_id='rp-main')=0
 and private.goods_preorder_remaining(:'rp_policy_a')+private.goods_preorder_remaining(:'rp_policy_b')+private.goods_preorder_remaining(:'rp_policy_c')=6
 and not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000211103' and good_id='rp-main')
 then 1 else 0 end as assert_preorder_allocation_rows;
select 1/case when (select pool_before from private.order_item_random_allocations where order_id=:'first_order' limit 1)
   =(select jsonb_agg(jsonb_build_object('variantId',id,'availableQty',case id when :'rp_a'::uuid then 2 when :'rp_b'::uuid then 3 else 5 end) order by id)
     from public.goods_variants where good_id='rp-main')
 and not exists(select 1 from private.order_item_random_allocations a cross join lateral jsonb_array_elements(a.draws) d
   where a.order_id=:'first_order' and (d->>'bound')::bigint<>11-(d->>'step')::integer)
 and exists(select 1 from public.audit_log where target='order:'||:'first_order' and action='order.random_option_allocated'
   and diff->>'supplySource'='preorder' and (diff->>'qty')::integer=4)
 and (select public.goods_variant_supply(v)->>'availableQty' from public.goods_variants v where v.id=:'rp_b')='6'
 then 1 else 0 end as assert_preorder_allocation_evidence;
-- 고객은 한 줄 '랜덤'과 공통 발송 예정일만 본다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211103',true);
select 1/case when (select count(*) from public.my_order_items(array[:'first_order'::uuid]))=1
 and exists(select 1 from public.my_order_items(array[:'first_order'::uuid]) where qty=4 and variant_name_snapshot='랜덤'
   and variant_id=:'rp_a'::uuid and supply_source='preorder' and preorder_expected_ship_date=:'ship_date'::date)
 and not exists(select 1 from public.order_items where order_id=:'first_order')
 then 1 else 0 end as assert_customer_sees_masked_preorder_line;
reset role;

-- 7. 전체 취소는 배정 옵션의 예약 물량을 돌려준다(실물 재고는 그대로).
select public.finalize_order_cancellation_with_provider_evidence(:'first_order','합성 미결제 취소','{}');
select 1/case when not exists(select 1 from private.goods_preorder_reservations where order_id=:'first_order' and state<>'released')
 and (select public.goods_variant_supply(v)->>'availableQty' from public.goods_variants v where v.id=:'rp_a')='10'
 and (select sum(stock_qty) from public.goods_variants where good_id='rp-main')=0
 then 1 else 0 end as assert_cancellation_releases_capacity;

-- 8. 남은 예약 물량 전부(10)를 주문하면 옵션별 승인 물량대로 배정되고, 더 받으면 예약 물량 초과로 거절된다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211103',true);
select public.set_cart_item_quantity('rp-main',:'rp_a',10);
set local role service_role;
select pg_temp.place('00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211141') as full_order \gset
reset role;
select 1/case when (select array_agg(item.qty order by variant.code) from public.order_items item join public.goods_variants variant on variant.id=item.variant_id
   where item.order_id=:'full_order')='{2,3,5}'::integer[]
 and (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_a')@>'{"availableQty":0,"state":"open"}'
 then 1 else 0 end as assert_full_capacity_allocated;
insert into public.cart_items(user_id,good_id,variant_id,qty) values('00000000-0000-4000-8000-000000211103','rp-main',:'rp_a',1);
set local role service_role;
select pg_temp.expect_error($sql$select pg_temp.place('00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211142')$sql$,
 'preorder_capacity_exceeded','23514');
reset role;

-- 9. 결제 뒤 옵션별 입고를 할당하면 배정 옵션의 실물 재고로 출고할 수 있다.
select pg_temp.approve_fixture(:'full_order','00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211150','TEST-RANDOM-PREORDER-FULL');
select id as full_shipment from public.order_shipments where order_id=:'full_order' \gset
select array_agg(id order by id)::text as full_items from public.order_items where order_id=:'full_order' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select public.admin_update_order_status(:'full_order','confirmed',null,null);
select pg_temp.expect_error(format('select public.admin_shipment_export(array[%L::uuid])',:'full_shipment'),'preorder_allocation_required','23514');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000211160','rp-main',:'rp_a',0,2,'TEST-ONLY 입고 A');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000211161','rp-main',:'rp_b',0,3,'TEST-ONLY 입고 B');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000211162','rp-main',:'rp_c',0,5,'TEST-ONLY 입고 C');
select public.admin_allocate_goods_preorders('rp-main',:'full_items'::uuid[],
 jsonb_build_object(:'rp_a',2,:'rp_b',3,:'rp_c',5),'TEST-ONLY 랜덤 예약 입고');
select public.admin_shipment_export(array[:'full_shipment'::uuid]);
reset role;
select 1/case when (select count(*) from private.goods_preorder_reservations where order_id=:'full_order' and state='allocated')=3
 and (select sum(stock_qty) from public.goods_variants where good_id='rp-main')=0
 then 1 else 0 end as assert_receipt_allocation_by_allocated_option;

-- 10. 일괄 중지: 새 접수는 멈추고(풀 0, stopped) 주문은 접수 중이 아님으로 거절된다. 일괄 일반 재고 전환은 관리자만 한다.
select jsonb_agg(jsonb_build_object('variantId',v.id,'policyId',p.id,'expectedRevision',p.revision)) as stop_options
 from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id where v.good_id='rp-main' and p.state='active' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select public.admin_save_random_goods_preorders('rp-main','stopped',null,:'stop_options'::jsonb);
reset role;
select 1/case when (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_b')@>'{"mode":"preorder","availableQty":0,"state":"stopped"}'
 and (select public.goods_variant_supply(v)->'nextChangeAt' from public.goods_variants v where v.id=:'rp_b')='null'::jsonb
 then 1 else 0 end as assert_bulk_stop_closes_pool;
set local role service_role;
select pg_temp.expect_error($sql$select pg_temp.place('00000000-0000-4000-8000-000000211103','00000000-0000-4000-8000-000000211143')$sql$,
 'preorder_sale_not_open','23514');
reset role;
delete from public.cart_items where user_id='00000000-0000-4000-8000-000000211103';
select jsonb_agg(jsonb_build_object('variantId',v.id,'policyId',p.id,'expectedRevision',p.revision)) as stock_options
 from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id where v.good_id='rp-main' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select pg_temp.expect_error(format('select public.admin_save_random_goods_preorders(%L,%L,null,%L::jsonb)','rp-main','stock',:'stock_options'),
 'preorder_admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211101',true);
select public.admin_save_random_goods_preorders('rp-main','stock',null,:'stock_options'::jsonb);
reset role;
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select 1/case when not exists(select 1 from public.goods_variants where good_id='rp-main' and preorder_policy_id is not null)
 and (select public.goods_variant_supply(v) from public.goods_variants v where v.id=:'rp_c')@>'{"mode":"stock","availableQty":0,"state":"stock"}'
 then 1 else 0 end as assert_bulk_stock_switch;

-- 11. 같은 옵션 배정 상한: 옵션마다 값이 다르면 랜덤으로 바꿀 수 없고, 같으면 바꿀 수 있다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211102',true);
select pg_temp.expect_error(format('select public.admin_set_goods_option_sale_mode(%L,%L,%L)','rp-limit','random',(select updated_at from public.goods where id='rp-limit')),
 'random_option_limit_mismatch','23514');
reset role;
update public.goods_variants set order_max_qty=2,member_max_qty=3 where good_id='rp-limit';
set local role authenticated;
select public.admin_set_goods_option_sale_mode('rp-limit','random',(select updated_at from public.goods where id='rp-limit'));
reset role;
select pg_temp.random_guards('immediate');
select pg_temp.random_guards('deferred');
select pg_temp.expect_deferred_error(format('update public.goods_variants set member_max_qty=4 where id=%L',:'rl_b'),'random_option_limit_mismatch');
set local role anon;
select 1/case when (select public.goods_random_option(g) from public.goods g where g.id='rp-limit')
   @>jsonb_build_object('order_max_qty',6,'member_max_qty',9,'allocation_limit',jsonb_build_object('orderMaxQty',2,'memberMaxQty',3),
     'supply',jsonb_build_object('mode','stock','availableQty',21))
 then 1 else 0 end as assert_random_line_exposes_static_limits;
reset role;

-- 견적 한도는 배정과 무관한 정적 값이다: 줄 상한 = 옵션 수 × 상한, 회원 누적은 이 굿즈 전체 수량.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211104',true);
select 1/case when (select line->'optionLimit' from jsonb_array_elements(public.quote_goods_sales(jsonb_build_array(
    jsonb_build_object('goodId','rp-limit','variantId',:'rl_a','qty',7)))->'lines') line)
   =jsonb_build_object('orderMaxQty',6,'memberMaxQty',9,'memberReservedQty',0,'memberRemainingQty',9,'reason','option_order_limit_exceeded')
 and (select line->'optionLimit'->>'reason' from jsonb_array_elements(public.quote_goods_sales(jsonb_build_array(
    jsonb_build_object('goodId','rp-limit','variantId',:'rl_a','qty',5)))->'lines') line) is null
 then 1 else 0 end as assert_quote_static_limits;

-- 가능 수량(min(2,10)+min(2,10)+min(2,1)=5)을 정확히 주문하면 배정은 A2·B2·C1로 정해진다. 증빙에 상한 잔여가 남는다.
select public.set_cart_item_quantity('rp-limit',:'rl_b',5);
set local role service_role;
select pg_temp.place('00000000-0000-4000-8000-000000211104','00000000-0000-4000-8000-000000211170') as limit_order \gset
reset role;
select 1/case when (select array_agg(item.qty order by variant.code) from public.order_items item join public.goods_variants variant on variant.id=item.variant_id
   where item.order_id=:'limit_order')='{2,2,1}'::integer[]
 and (select pool_before from private.order_item_random_allocations where order_id=:'limit_order' limit 1)
   =(select jsonb_agg(jsonb_build_object('variantId',id,'availableQty',case id when :'rl_c'::uuid then 1 else 10 end,'capQty',2) order by id)
     from public.goods_variants where good_id='rp-limit')
 and (select sum(stock_qty) from public.goods_variants where good_id='rp-limit')=16
 then 1 else 0 end as assert_capped_allocation_is_deterministic;
-- 같은 회원의 다음 주문: 상한 잔여 A1·B1·C(재고 0) → 가능 수량 2. 4개는 추출 전에 거절된다(견적은 정적 한도라 통과).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211104',true);
select public.set_cart_item_quantity('rp-limit',:'rl_a',4);
select 1/case when (select line->'optionLimit' from jsonb_array_elements(public.quote_goods_sales(jsonb_build_array(
    jsonb_build_object('goodId','rp-limit','variantId',:'rl_a','qty',4)))->'lines') line)
   @>jsonb_build_object('memberReservedQty',5,'memberRemainingQty',4,'reason',null)
 then 1 else 0 end as assert_quote_does_not_probe_allocation;
set local role service_role;
select pg_temp.expect_error($sql$select pg_temp.place('00000000-0000-4000-8000-000000211104','00000000-0000-4000-8000-000000211171')$sql$,
 'random_option_limit_exceeded','23514');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211104',true);
select public.set_cart_item_quantity('rp-limit',:'rl_a',2);
set local role service_role;
select pg_temp.place('00000000-0000-4000-8000-000000211104','00000000-0000-4000-8000-000000211172') as limit_second \gset
reset role;
select 1/case when (select array_agg(item.qty order by variant.code) from public.order_items item join public.goods_variants variant on variant.id=item.variant_id
   where item.order_id=:'limit_second')='{1,1}'::integer[]
 and not exists(select 1 from public.goods_variants v where v.good_id='rp-limit'
   and (select coalesce(sum(i.qty),0) from public.order_items i join public.orders o on o.id=i.order_id
     where o.user_id='00000000-0000-4000-8000-000000211104' and o.status<>'canceled' and i.variant_id=v.id)>3)
 then 1 else 0 end as assert_member_cap_respected;
-- 이제 회원 누적 7 + 3 > 9: 견적이 1인 상한을 알린다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000211104',true);
select 1/case when (select line->'optionLimit' from jsonb_array_elements(public.quote_goods_sales(jsonb_build_array(
    jsonb_build_object('goodId','rp-limit','variantId',:'rl_a','qty',3)))->'lines') line)
   @>jsonb_build_object('memberReservedQty',7,'memberRemainingQty',2,'reason','option_member_limit_exceeded')
 then 1 else 0 end as assert_quote_member_limit;
reset role;

-- 함수 봉인: 새 풀 함수는 내부 전용, 일괄 RPC는 로그인 사용자만(권한은 함수 안에서 판정).
select 1/case when not has_function_privilege('anon','private.random_option_pool_supply(text,timestamptz)','execute')
 and not has_function_privilege('authenticated','private.random_option_pool_supply(text,timestamptz)','execute')
 and not has_function_privilege('service_role','private.random_option_pool_supply(text,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_save_random_goods_preorders(text,text,jsonb,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_random_goods_preorders(text,text,jsonb,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_save_random_goods_preorders(text,text,jsonb,jsonb)','execute')
 then 1 else 0 end as assert_function_grants;

rollback;
