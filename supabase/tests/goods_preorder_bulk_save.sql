\set ON_ERROR_STOP on
-- 예약판매 한 번에 저장(20261126100000, 옵션 선택 판매 상품). 권한·입력 형식·한 트랜잭션(하나라도 거절되면 전부 되돌림)·
-- 여러 옵션 저장과 감사 기록·이미 적용 중인 옵션 건너뛰기(받은 예약 수량을 잃지 않는다)·중지한 옵션의 다음 회차·
-- 판매기간과의 배타·사용 중지 옵션·랜덤 판매 조건(커밋 때 거절)·실행 권한과 운영자 계약 등록을 확인한다.
-- 운영자는 명시한 매니저 역할로 만든다(legacy fixture helper 없이 돈다). 상품을 공개하지 않으므로 KC fixture도 필요 없다.
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
create function pg_temp.random_guards(p_mode text) returns void language plpgsql as $$
begin
  execute 'set constraints public.goods_variants_option_sale_mode_guard,private.goods_variant_price_periods_option_sale_mode_guard,'
    ||'public.goods_option_sale_mode_guard '||p_mode;
end $$;
-- 공통 일정. 물량만 옵션별로 다르다.
create function pg_temp.pb_values(p_capacity integer,p_ship_offset integer default 7) returns jsonb language sql as $$
  select jsonb_build_object('capacityQty',p_capacity,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
    'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+p_ship_offset);
$$;
create function pg_temp.pb_option(p_variant uuid,p_capacity integer,p_ship_offset integer default 7) returns jsonb language sql as $$
  select jsonb_build_object('variantId',p_variant,'values',pg_temp.pb_values(p_capacity,p_ship_offset));
$$;

-- 1101 상품 담당 운영자(deputy: catalog.manage 있음, platform.manage 없음), 1102 일반 회원, 1103 출고 전용 운영자(logistics: catalog.manage 없음)
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000261101','authenticated','authenticated','preorder-bulk-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000261102','authenticated','authenticated','preorder-bulk-member@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000261103','authenticated','authenticated','preorder-bulk-logistics@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='일괄예약운영'||right(id::text,2) where id in ('00000000-0000-4000-8000-000000261101','00000000-0000-4000-8000-000000261103');
update public.profiles set nickname='일괄예약회원' where id='00000000-0000-4000-8000-000000261102';
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000261101','deputy'),('00000000-0000-4000-8000-000000261103','logistics');
insert into public.verticals(key,label,color) values('preorder-bulk-tests','예약 일괄 저장 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('preorder-bulk-tests','예약 일괄 저장 검증','preorder-bulk-tests',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_good('{"id":"pb-main","ip_id":"preorder-bulk-tests","name":"예약 일괄 저장 상품","price":10000,
 "variant_baseline":[],"variants":[
  {"name":"빨강","code":"PB-A","attributes":{"색상":"빨강"},"extraPrice":0,"stockQty":50},
  {"name":"파랑","code":"PB-B","attributes":{"색상":"파랑"},"extraPrice":0,"stockQty":30},
  {"name":"초록","code":"PB-C","attributes":{"색상":"초록"},"extraPrice":0,"stockQty":0},
  {"name":"노랑","code":"PB-D","attributes":{"색상":"노랑"},"extraPrice":0,"stockQty":10},
  {"name":"검정","code":"PB-E","attributes":{"색상":"검정"},"extraPrice":0,"stockQty":10}]}');
select public.admin_save_good('{"id":"pb-period","ip_id":"preorder-bulk-tests","name":"판매기간 상품","price":10000,
 "variant_baseline":[],"variants":[
  {"name":"빨강","code":"PP-A","attributes":{"색상":"빨강"},"extraPrice":0,"stockQty":5},
  {"name":"파랑","code":"PP-B","attributes":{"색상":"파랑"},"extraPrice":0,"stockQty":5}]}');
select public.admin_save_good('{"id":"pb-random","ip_id":"preorder-bulk-tests","name":"랜덤 판매 상품","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"PR-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":0},
  {"name":"B","code":"PR-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":0}]}');
reset role;
select set_config('request.jwt.claim.sub','',true);
select id as pb_a from public.goods_variants where code='PB-A' \gset
select id as pb_b from public.goods_variants where code='PB-B' \gset
select id as pb_c from public.goods_variants where code='PB-C' \gset
select id as pb_d from public.goods_variants where code='PB-D' \gset
select id as pb_e from public.goods_variants where code='PB-E' \gset
select id as pp_a from public.goods_variants where code='PP-A' \gset
select id as pp_b from public.goods_variants where code='PP-B' \gset
select id as pr_a from public.goods_variants where code='PR-A' \gset
select id as pr_b from public.goods_variants where code='PR-B' \gset

-- 1. 권한: 상품 관리 권한(catalog.manage)이 있는 운영자만 부른다. 일반 회원·출고 전용 운영자는 거절되고, anon·service_role에는 실행 권한이 없다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select 1/case when public.has_operator_capability('catalog.manage') and not public.has_operator_capability('platform.manage')
 then 1 else 0 end as assert_staff_is_catalog_manager_without_admin_gate;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261102',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',5))::text),'operator_capability_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261103',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',5))::text),'operator_capability_required','42501');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_save_goods_preorders_bulk(text,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_preorders_bulk(text,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_preorders_bulk(text,jsonb)','execute')
 and exists(select 1 from private.operator_rpc_contracts where to_regprocedure(signature)='public.admin_save_goods_preorders_bulk(text,jsonb)'::regprocedure
   and capability='catalog.manage' and guard_kind='write' and not legacy_admin_only)
 and exists(select 1 from private.operator_internal_contracts where to_regprocedure(signature)='public.admin_save_goods_preorders_bulk(text,jsonb)'::regprocedure)
 then 1 else 0 end as assert_function_grants_and_contract;

-- 2. 입력 형식: 배열이 아니거나 비었거나 100개를 넘거나, 모르는 키·중복 옵션·values 안의 state는 거절한다(중지는 이 함수로 할 수 없다).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main','{}'),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main','[]'),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 (select jsonb_agg(pg_temp.pb_option(gen_random_uuid(),1)) from generate_series(1,101))::text),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(jsonb_build_object('variantId','not-a-uuid','values',pg_temp.pb_values(1)))::text),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',1)||'{"policyId":null}')::text),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(jsonb_build_object('variantId',:'pb_a','values',pg_temp.pb_values(1)||'{"state":"stopped"}'))::text),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(jsonb_build_object('variantId',:'pb_a','values',pg_temp.pb_values(1)||'{"approvalReference":"TEST-ONLY"}'))::text),'invalid_preorder_bulk','22023');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',1),pg_temp.pb_option(:'pb_a',2))::text),'invalid_preorder_bulk','22023');
-- 다른 상품의 옵션·없는 상품은 찾지 못한다.
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',1),pg_temp.pb_option(:'pp_a',1))::text),'goods_variant_not_found','P0002');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-missing',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',1))::text),'good_not_found','P0002');

-- 3. 한 트랜잭션: 옵션 하나라도 거절되면(접수 종료 빠짐·물량 0) 앞의 옵션도 저장되지 않는다.
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',5),pg_temp.pb_option(:'pb_b',3),
   jsonb_build_object('variantId',:'pb_c','values',pg_temp.pb_values(2)-'endsAt'))::text),'preorder_policy_not_configured','23514');
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_a',5),pg_temp.pb_option(:'pb_b',0))::text),'invalid_preorder_policy','23514');
reset role;
select 1/case when not exists(select 1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='pb-main')
 and not exists(select 1 from public.goods_variants where good_id='pb-main' and preorder_policy_id is not null)
 and not exists(select 1 from public.audit_log where target='goods:pb-main' and action in ('admin.good.preorder_saved','admin.good.preorders_bulk_saved'))
 then 1 else 0 end as assert_rejected_bulk_saves_leave_nothing;

-- 4. 여러 옵션을 한 번에 저장한다: 같은 일정, 옵션별 물량. 옵션마다 기존 저장 함수의 감사 기록이 남고 묶음 기록이 하나 더 남는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_goods_preorders_bulk('pb-main',jsonb_build_array(
 pg_temp.pb_option(:'pb_a',50),pg_temp.pb_option(:'pb_b',30),pg_temp.pb_option(:'pb_c',20))) as first_bulk \gset
reset role;
select p.id as policy_a from private.goods_preorder_policies p where p.variant_id=:'pb_a' and p.state='active' \gset
select 1/case when jsonb_array_length((:'first_bulk')::jsonb->'saved')=3 and jsonb_array_length((:'first_bulk')::jsonb->'skipped')=0
 and (:'first_bulk')::jsonb->>'goodId'='pb-main'
 and (select array_agg(p.capacity_qty order by v.code) from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id
   where v.good_id='pb-main')='{50,30,20}'::integer[]
 and (select count(distinct (p.starts_at,p.ends_at,p.expected_ship_date)) from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id
   where v.good_id='pb-main')=1
 and (select bool_and(p.state='active' and p.revision=1 and p.activated_by='00000000-0000-4000-8000-000000261101' and p.approval_reference is null)
   from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id where v.good_id='pb-main')
 and (select count(*) from public.goods_variants where good_id='pb-main' and preorder_policy_id is null)=2
 and (select count(*) from public.audit_log where target='goods:pb-main' and action='admin.good.preorder_saved')=3
 and (select count(*) from public.audit_log where target='goods:pb-main' and action='admin.good.preorders_bulk_saved'
   and jsonb_array_length(diff->'saved')=3 and actor_id='00000000-0000-4000-8000-000000261101')=1
 and (select mode='preorder' and available_qty=50 and state='open' from private.resolve_goods_variant_supply(:'pb_a',now()))
 and (select mode='stock' and available_qty=10 from private.resolve_goods_variant_supply(:'pb_d',now()))
 then 1 else 0 end as assert_bulk_save_applies_all_options;

-- 5. 과판매 방지: 이미 적용 중인 옵션은 건너뛰고 알린다. 그 예약 조건(물량·남은 물량·버전)은 그대로이고 새 조건이 생기지 않는다.
select to_jsonb(p) as policy_a_before from private.goods_preorder_policies p where p.id=:'policy_a' \gset
select private.goods_preorder_remaining(:'policy_a') as remaining_a_before \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_goods_preorders_bulk('pb-main',jsonb_build_array(
 pg_temp.pb_option(:'pb_a',999,14),pg_temp.pb_option(:'pb_d',10,14))) as second_bulk \gset
reset role;
select 1/case when jsonb_array_length((:'second_bulk')::jsonb->'saved')=1 and (:'second_bulk')::jsonb->'saved'->0->>'variantId'=:'pb_d'
 and (:'second_bulk')::jsonb->'skipped'=jsonb_build_array(jsonb_build_object('variantId',:'pb_a','policyId',:'policy_a','reason','preorder_policy_already_active'))
 and (select to_jsonb(p) from private.goods_preorder_policies p where p.id=:'policy_a')=(:'policy_a_before')::jsonb
 and private.goods_preorder_remaining(:'policy_a')=:'remaining_a_before'::integer
 and (select count(*) from private.goods_preorder_policies where variant_id=:'pb_a')=1
 and (select preorder_policy_id=:'policy_a'::uuid from public.goods_variants where id=:'pb_a')
 and (select p.capacity_qty=10 and p.expected_ship_date=(now() at time zone 'Asia/Seoul')::date+14
   from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id where v.id=:'pb_d')
 and (select count(*) from public.audit_log where target='goods:pb-main' and action='admin.good.preorders_bulk_saved'
   and diff->'skipped'->0->>'variantId'=:'pb_a')=1
 then 1 else 0 end as assert_active_option_is_skipped_untouched;
-- 모든 옵션이 이미 적용 중이면 바꾼 것이 없고 묶음 기록도 남기지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_goods_preorders_bulk('pb-main',jsonb_build_array(pg_temp.pb_option(:'pb_a',1),pg_temp.pb_option(:'pb_b',1))) as noop_bulk \gset
reset role;
select 1/case when jsonb_array_length((:'noop_bulk')::jsonb->'saved')=0 and jsonb_array_length((:'noop_bulk')::jsonb->'skipped')=2
 and (select count(*) from public.audit_log where target='goods:pb-main' and action='admin.good.preorders_bulk_saved')=2
 and (select count(*) from public.audit_log where target='goods:pb-main' and action='admin.good.preorder_saved')=4
 then 1 else 0 end as assert_all_skipped_changes_nothing;

-- 6. 운영자가 접수를 중지한 옵션은 다음 회차를 새로 저장할 수 있다(중지는 기존 함수로만 한다). 옛 조건은 기록으로 남는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_goods_preorder('pb-main',:'pb_a',:'policy_a','{"state":"stopped"}',1);
select public.admin_save_goods_preorders_bulk('pb-main',jsonb_build_array(pg_temp.pb_option(:'pb_a',40,21))) as next_round \gset
reset role;
select 1/case when jsonb_array_length((:'next_round')::jsonb->'saved')=1
 and (select state='stopped' and capacity_qty=50 from private.goods_preorder_policies where id=:'policy_a')
 and (select p.id<>:'policy_a'::uuid and p.state='active' and p.capacity_qty=40
   from public.goods_variants v join private.goods_preorder_policies p on p.id=v.preorder_policy_id where v.id=:'pb_a')
 and (select count(*) from private.goods_preorder_policies where variant_id=:'pb_a')=2
 then 1 else 0 end as assert_stopped_option_takes_next_round;

-- 7. 사용 중지한 옵션이 섞이면 전부 거절한다(같은 요청의 다른 옵션도 저장되지 않는다).
update public.goods_variants set archived_at=now() where id=:'pb_e';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-main',
 jsonb_build_array(pg_temp.pb_option(:'pb_e',5))::text),'goods_variant_inactive','23514');
reset role;
select 1/case when (select preorder_policy_id is null from public.goods_variants where id=:'pb_e') then 1 else 0 end as assert_archived_option_rejected;

-- 8. 판매기간이 저장된 상품은 예약을 받지 않는다(기존 배타 트리거 그대로). 앞의 옵션도 남지 않는다.
update public.goods set sale_starts_at=now()-interval '1 day',sale_ends_at=now()+interval '7 days' where id='pb-period';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select pg_temp.expect_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-period',
 jsonb_build_array(pg_temp.pb_option(:'pp_a',5),pg_temp.pb_option(:'pp_b',5))::text),'goods_sale_period_preorder_conflict','23514');
reset role;
select 1/case when not exists(select 1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='pb-period')
 and not exists(select 1 from public.goods_variants where good_id='pb-period' and preorder_policy_id is not null)
 then 1 else 0 end as assert_sale_period_blocks_bulk_preorder;
-- 판매기간을 끈 뒤에는 저장된다.
update public.goods set sale_starts_at=null,sale_ends_at=null where id='pb-period';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_save_goods_preorders_bulk('pb-period',jsonb_build_array(pg_temp.pb_option(:'pp_a',5),pg_temp.pb_option(:'pp_b',5)));
reset role;
select 1/case when (select count(*) from public.goods_variants where good_id='pb-period' and preorder_policy_id is not null)=2
 then 1 else 0 end as assert_bulk_preorder_after_sale_period_off;

-- 9. 랜덤 판매 상품의 조건은 그대로다: 일부 옵션만 예약하면 커밋에서 거절된다(랜덤 판매는 admin_save_random_goods_preorders를 쓴다).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select public.admin_set_goods_option_sale_mode('pb-random','random',(select updated_at from public.goods where id='pb-random'));
reset role;
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
grant execute on function pg_temp.expect_deferred_error(text,text) to authenticated;
grant execute on function pg_temp.random_guards(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000261101',true);
select pg_temp.expect_deferred_error(format('select public.admin_save_goods_preorders_bulk(%L,%L::jsonb)','pb-random',
 jsonb_build_array(pg_temp.pb_option(:'pr_a',5))::text),'random_option_preorder_mismatch');
reset role;
select 1/case when not exists(select 1 from public.goods_variants where good_id='pb-random' and preorder_policy_id is not null)
 then 1 else 0 end as assert_random_goods_keep_all_or_nothing;

rollback;
