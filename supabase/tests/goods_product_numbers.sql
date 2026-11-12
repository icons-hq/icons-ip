\set ON_ERROR_STOP on
-- 상품번호(ADR-0038): 시스템이 매기는 바뀌지 않는 숫자, 상품 조회/수정의 번호 검색·정렬·건수 칸(판매대기·판매중지·판매종료).
-- Use an isolated local database only.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000061301','authenticated','authenticated','goods-number-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000061301';
insert into private.operator_memberships(profile_id,manager_role) values ('00000000-0000-4000-8000-000000061301','primary');
update private.operator_access_state set configured=true where id;
insert into public.verticals(key,label,color) values('goods-number-test','상품번호 검증','#000');
insert into public.ips(id,title,vertical_key,published_at) values('goods-number-test','상품번호 검증','goods-number-test',now());

-- 1. 열 계약: NOT NULL·고유·identity ALWAYS, 순번은 상품 저장 함수(소유자)만 쓴다.
select 1/case when (select is_nullable='NO' and is_identity='YES' and identity_generation='ALWAYS' and data_type='bigint'
   from information_schema.columns where table_schema='public' and table_name='goods' and column_name='product_no')
 and exists(select 1 from pg_constraint where conrelid='public.goods'::regclass and contype='u' and conname='goods_product_no_key')
 and not exists(select 1 from public.goods where product_no is null)
 and not has_sequence_privilege('anon',pg_get_serial_sequence('public.goods','product_no'),'usage,select,update')
 and not has_sequence_privilege('authenticated',pg_get_serial_sequence('public.goods','product_no'),'usage,select,update')
 and not has_sequence_privilege('service_role',pg_get_serial_sequence('public.goods','product_no'),'usage,select,update')
 and not has_function_privilege('authenticated','private.guard_goods_product_no()','execute')
 and not has_function_privilege('anon','private.admin_goods_sale_period_matches(text,timestamptz,timestamptz)','execute')
 and not has_function_privilege('authenticated','private.admin_goods_sale_period_matches(text,timestamptz,timestamptz)','execute')
 then 1 else 0 end as assert_product_no_column_contract;

-- 2. 새 상품은 등록 순서대로 이어지는 번호를 받는다(값을 지정해 넣을 수 없다).
select coalesce(max(product_no),0) as before_max from public.goods \gset
insert into public.goods(id,code,ip_id,name,type,price,stock,created_at) values
 ('number-a','NUMBER-A','goods-number-test','번호 검증 A','문구',1000,'ok','2026-10-01T03:00:00Z');
insert into public.goods(id,code,ip_id,name,type,price,stock,created_at) values
 ('number-b','NUMBER-B','goods-number-test','번호 검증 B','문구',2000,'ok','2026-09-01T03:00:00Z');
insert into public.goods(id,code,ip_id,name,type,price,stock,created_at) values
 ('number-c','NUMBER-C','goods-number-test','번호 검증 C','문구',3000,'ok','2026-11-01T03:00:00Z');
select product_no as number_a from public.goods where id='number-a' \gset
select product_no as number_b from public.goods where id='number-b' \gset
select product_no as number_c from public.goods where id='number-c' \gset
select 1/case when :number_a > :before_max and :number_b = :number_a + 1 and :number_c = :number_b + 1
 then 1 else 0 end as assert_new_goods_get_next_numbers;
do $$ begin
 begin
  insert into public.goods(id,code,ip_id,name,type,price,stock,product_no) values('number-x','NUMBER-X','goods-number-test','지정 번호','문구',1,'ok',1);
  raise exception 'explicit product number accepted';
 exception when generated_always then null; end;
end $$;

-- 3. 번호는 바꿀 수 없다 — 값 지정과 새 순번(default) 모두 막는다. 다른 열 수정은 그대로 된다.
do $$ begin
 begin update public.goods set product_no=product_no+1000 where id='number-a'; raise exception 'product number overwritten';
 exception when generated_always then null; end;
 begin update public.goods set product_no=default where id='number-a'; raise exception 'product number renumbered';
 exception when invalid_parameter_value then
  if sqlerrm <> 'goods_product_no_immutable' then raise; end if;
 end;
end $$;
update public.goods set name='번호 검증 A 수정' where id='number-a';
select 1/case when (select product_no from public.goods where id='number-a') = :number_a
 then 1 else 0 end as assert_product_no_survives_other_updates;

-- 4. 지운 상품의 번호는 다시 쓰지 않는다.
savepoint reuse;
delete from public.goods where id='number-c';
insert into public.goods(id,code,ip_id,name,type,price,stock) values('number-d','NUMBER-D','goods-number-test','번호 검증 D','문구',4000,'ok');
select 1/case when (select product_no from public.goods where id='number-d') > :number_c
 then 1 else 0 end as assert_deleted_number_is_not_reused;
rollback to savepoint reuse;

-- 5. 상품 조회/수정: 상품번호 검색(쉼표·공백 여러 개)·정렬·행 값, 전체 검색의 번호 일치.
-- A=판매대기(시작 전), B=판매중지·판매기간 종료, C=판매 중(기간 없음).
update public.goods set sale_starts_at=now()+interval '1 day',sale_ends_at=now()+interval '10 days' where id='number-a';
update public.goods set sale_starts_at=now()-interval '10 days',sale_ends_at=now()-interval '1 day',stock='soldout' where id='number-b';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061301',true);
select public.admin_search_goods_console(p_query=>format('%s, %s',:number_a,:number_c),p_ip_id=>'goods-number-test',p_status=>'all',
 p_filters=>'{"field":"number","sort":"number_desc"}') as by_number \gset
select 1/case when (:'by_number'::jsonb->>'total')::int=2
 and :'by_number'::jsonb->'rows'->0->>'id'='number-c' and (:'by_number'::jsonb->'rows'->0->>'productNo')::bigint=:number_c
 and :'by_number'::jsonb->'rows'->1->>'id'='number-a' and (:'by_number'::jsonb->'rows'->1->>'productNo')::bigint=:number_a
 then 1 else 0 end as assert_number_search_and_descending_sort;
select 1/case when (select jsonb_agg(item->>'id') from jsonb_array_elements(public.admin_search_goods_console(
   p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"sort":"number_asc"}')->'rows') item)='["number-a","number-b","number-c"]'::jsonb
 and (public.admin_search_goods_console(p_query=>:'number_b',p_ip_id=>'goods-number-test',p_status=>'all')->'rows'->0->>'id')='number-b'
 and (public.admin_search_goods_console(p_query=>:'number_b',p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"field":"number"}')->>'total')::int=1
 and (public.admin_search_goods_console(p_query=>'number-b',p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"field":"number"}')->>'total')::int=0
 and (public.admin_search_goods_console(p_query=>'number-b',p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"field":"id"}')->>'total')::int=1
 then 1 else 0 end as assert_number_sort_and_url_search_stay_separate;

-- 6. 건수 칸: 판매중지는 재고 축, 판매대기·판매종료는 판매기간 축만 빼고 같은 조건으로 센다 — 누르면 나오는 목록 개수와 같다.
select 1/case when public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all')->'saleStateCounts'
   ='{"scheduled":1,"stopped":1,"ended":1}'::jsonb
 and (public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"salePeriod":"scheduled"}')->>'total')::int=1
 and (public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_stock=>'stopped')->>'total')::int=1
 and (public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"salePeriod":"ended"}')->>'total')::int=1
 -- 판매기간 조건이 켜져 있어도 다른 판매기간 칸 숫자는 그 칸으로 바꿨을 때의 개수다.
 and public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"salePeriod":"scheduled"}')->'saleStateCounts'
   ='{"scheduled":1,"stopped":0,"ended":1}'::jsonb
 -- 판매중지 조건이 켜져 있으면 판매기간 칸은 판매중지 상품 안에서 센다(재고 축은 판매중지 칸에서만 뺀다).
 and public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_stock=>'stopped')->'saleStateCounts'
   ='{"scheduled":0,"stopped":1,"ended":1}'::jsonb
 -- 전시상태·검색어 조건은 세 칸 모두에 적용된다(보관 제외 = 기본, 보관 상품은 빠진다).
 and public.admin_search_goods_console(p_query=>'번호 검증 A',p_ip_id=>'goods-number-test',p_status=>'all')->'saleStateCounts'
   ='{"scheduled":1,"stopped":0,"ended":0}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'archived')->'saleStateCounts'
   ='{"scheduled":0,"stopped":0,"ended":0}'::jsonb
 -- 기존 건수는 그대로다.
 and public.admin_search_goods_console(p_ip_id=>'goods-number-test',p_status=>'all',p_filters=>'{"salePeriod":"scheduled"}')->'statusCounts'
   ='{"all":1,"active":1,"draft":1,"published":0,"archived":0}'::jsonb
 then 1 else 0 end as assert_sale_state_counts_follow_their_cards;

-- 7. 판매기간·검색 대상·정렬 값 검증은 그대로 엄격하다.
do $$ begin
 begin perform public.admin_search_goods_console(p_filters=>'{"salePeriod":1}'); raise exception 'non-string sale period accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"salePeriod":"open"}'); raise exception 'unsupported sale period accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'[]'::jsonb); raise exception 'array filters accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"field":"product_no"}'); raise exception 'unsupported search field accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"sort":"number"}'); raise exception 'unsupported sort accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
rollback;
