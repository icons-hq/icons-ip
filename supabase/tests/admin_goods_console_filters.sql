\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Use an isolated local database only.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000061201','authenticated','authenticated','goods-console-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000061202','authenticated','authenticated','goods-console-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000061201';
insert into public.verticals(key,label,color) values('goods-console-test','상품콘솔 검증','#000');
insert into public.ips(id,title,vertical_key,published_at) values('goods-console-test','콘솔 검증','goods-console-test',now());
insert into public.goods(id,code,ip_id,name,type,price,stock,created_at) values
 ('console-a','CONSOLE-A','goods-console-test','키링 검증 A','문구',1000,'ok','2026-10-01T03:00:00Z'),
 ('console-b','CONSOLE-B','goods-console-test','키링 검증 B','문구',2500,'ok','2026-10-01T14:59:59Z'),
 ('console-c','CONSOLE-C','goods-console-test','인형 검증 C','문구',1500,'ok','2026-09-30T03:00:00Z'),
 ('console-d','CONSOLE-D','goods-console-test','키링 검증 D','문구',3000,'ok','2026-10-01T15:00:00Z');
update public.goods set image_path='public-media/console-fixture.webp',notice_maker='합성',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026',notice_as_manager='합성 CS',notice_as_contact='02-000'
 where id='console-a';
update public.goods set image_path='public-media/console-fixture.webp',sale_restriction='adult' where id='console-d';
update public.goods set allow_card_payment=false,allow_bank_transfer=true where id='console-b';
update public.goods set archived_at=now(),allow_card_payment=false,allow_bank_transfer=false where id='console-c';
update public.goods_variants set stock_qty=case good_id when 'console-a' then 2 when 'console-b' then 8 when 'console-c' then 4 else 6 end where good_id like 'console-%';
select pg_temp.publish_goods_kc_fixture('console-a');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061201',true);
select public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'draft',p_limit=>1) as scoped \gset
select 1/case when (:'scoped'::jsonb->>'total')::int=2 and jsonb_array_length(:'scoped'::jsonb->'rows')=1
 and :'scoped'::jsonb->'statusCounts'='{"all":4,"active":3,"draft":2,"published":1,"archived":1}'::jsonb
 then 1 else 0 end as assert_status_counts_are_not_current_page_or_selected_status;
select public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"from":"2026-10-01","to":"2026-10-01","sort":"price_desc"}') as dated \gset
select 1/case when (:'dated'::jsonb->>'total')::int=2
 and :'dated'::jsonb->'rows'->0->>'id'='console-b'
 and :'dated'::jsonb->'rows'->1->>'id'='console-a'
 then 1 else 0 end as assert_kst_inclusive_date_end_and_price_sort;
select 1/case when (select count(*) from public.admin_goods_console_export_candidates(
 p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"from":"2026-10-01","to":"2026-10-01","sort":"price_desc"}'))=2
 then 1 else 0 end as assert_export_matches_advanced_list_scope;
select 1/case when (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_query=>'console-a, console-d',p_filters=>'{"field":"id","sort":"id_asc"}')->>'total')::int=2
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_query=>'CONSOLE-B',p_filters=>'{"field":"code"}')->'rows'->0->>'id')='console-b'
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_query=>'키링',p_filters=>'{"field":"name"}')->>'total')::int=3
 then 1 else 0 end as assert_search_fields_apply_before_pagination;
select 1/case when (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_filters=>'{"image":"without","payment":"bank"}')->>'total')::int=1
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_filters=>'{"restriction":"adult"}')->'rows'->0->>'id')='console-d'
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_filters=>'{"sort":"stock_desc"}',p_limit=>1,p_offset=>1)->'rows'->0->>'id')='console-d'
 then 1 else 0 end as assert_combined_details_and_sort_before_offset;
select 1/case when (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_filters=>'{"dateField":"published","from":"2000-01-01"}')->>'total')::int=1
 then 1 else 0 end as assert_published_date_excludes_unpublished_rows;
reset role;
-- R16 판매기간: A=시작 전(판매대기), B=종료, D=판매 중, C=기간 없음(무제한).
update public.goods set sale_starts_at=now()+interval '1 day',sale_ends_at=now()+interval '10 days' where id='console-a';
update public.goods set sale_starts_at=now()-interval '10 days',sale_ends_at=now()-interval '1 day' where id='console-b';
update public.goods set sale_starts_at=now()-interval '1 day',sale_ends_at=now()+interval '1 day' where id='console-d';
set local role authenticated;
select 1/case when (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"scheduled"}')->>'total')::int=1
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"scheduled"}')->'rows'->0->>'id'='console-a'
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"ended"}')->>'total')::int=1
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"ended"}')->'rows'->0->>'id'='console-b'
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"all"}')->>'total')::int=4
 and (select count(*) from public.admin_goods_console_export_candidates(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"salePeriod":"ended"}'))=1
 then 1 else 0 end as assert_sale_period_filter_matches_list_and_export;
reset role;
-- MD-0026 판매상태: B·D=판매중지(B 재고 8, D 재고 0), A=판매중지 아님·재고 0(품절), C=보관·판매중(재고 4).
update public.goods set stock='soldout' where id in ('console-b','console-d');
update public.goods_variants set stock_qty=0 where good_id in ('console-a','console-d');
set local role authenticated;
select 1/case when (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'stopped')->>'total')::int=2
 and (select jsonb_agg(item->>'id' order by item->>'id') from jsonb_array_elements(
   public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'stopped')->'rows') item)='["console-b","console-d"]'::jsonb
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'out_of_stock')->>'total')::int=1
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'out_of_stock')->'rows'->0->>'id'='console-a'
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'soldout')->>'total')::int=3
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'ok')->>'total')::int=1
 and (select count(*) from public.admin_goods_console_export_candidates(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'out_of_stock'))=1
 and (select count(*) from public.admin_goods_console_export_candidates(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'stopped'))=2
 and (public.admin_search_goods_workspace(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'stopped')->>'total')::int=2
 and (public.admin_search_goods_workspace(p_ip_id=>'goods-console-test',p_status=>'all',p_stock=>'out_of_stock')->>'total')::int=1
 then 1 else 0 end as assert_stock_filter_separates_stopped_from_out_of_stock;
reset role;
-- 품절·소량 재고 칸의 건수. A=전시·품절, B=임시·판매중지, C=보관·소량(재고 4), D=임시·판매중지(재고 0),
-- E=임시·소량(재고 3), F=임시·소량 지정인데 재고 0(품절로 센다), G=보관·품절.
insert into public.goods(id,code,ip_id,name,type,price,stock,created_at) values
 ('console-e','CONSOLE-E','goods-console-test','소량 검증 E','문구',1000,'low','2026-10-02T03:00:00Z'),
 ('console-f','CONSOLE-F','goods-console-test','소량 검증 F','문구',1000,'low','2026-10-02T04:00:00Z'),
 ('console-g','CONSOLE-G','goods-console-test','품절 검증 G','문구',1000,'ok','2026-10-02T05:00:00Z');
update public.goods_variants set stock_qty=3 where good_id='console-e';
update public.goods_variants set stock_qty=0 where good_id in ('console-f','console-g');
update public.goods set stock='low' where id='console-c';
update public.goods set archived_at=now() where id='console-g';
set local role authenticated;
select 1/case when public.admin_search_goods_console(p_ip_id=>'goods-console-test')->'stockCounts'='{"out_of_stock":2,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all')->'stockCounts'='{"out_of_stock":3,"low":2}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'archived')->'stockCounts'='{"out_of_stock":1,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'published')->'stockCounts'='{"out_of_stock":1,"low":0}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'draft')->'stockCounts'='{"out_of_stock":1,"low":1}'::jsonb
 then 1 else 0 end as assert_stock_counts_follow_status_and_all_other_conditions;
-- 재고 칸은 자기 축(재고 조건)을 빼고 세고, 전시상태 칸은 자기 축(전시상태 조건)을 빼고 센다.
select 1/case when public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_stock=>'low')->'stockCounts'='{"out_of_stock":2,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_stock=>'stopped')->'stockCounts'='{"out_of_stock":2,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_stock=>'low')->'statusCounts'='{"all":2,"active":1,"draft":1,"published":0,"archived":1}'::jsonb
 and (public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_stock=>'low')->>'total')::int=1
 then 1 else 0 end as assert_each_card_row_excludes_only_its_own_axis;
-- 카드 숫자 = 그 카드를 눌렀을 때의 목록 총 개수.
do $$ declare status_value text; bucket text; search record; card integer; clicked integer; begin
 foreach status_value in array array['active','all','draft','published','archived'] loop
  foreach bucket in array array['out_of_stock','low'] loop
   for search in select * from (values ('','{}'::jsonb),('소량','{"field":"name"}'::jsonb),('','{"image":"without"}'::jsonb),('','{"payment":"bank"}'::jsonb)) v(q,f) loop
    card:=(public.admin_search_goods_console(p_query=>search.q,p_ip_id=>'goods-console-test',p_status=>status_value,p_filters=>search.f)->'stockCounts'->>bucket)::integer;
    clicked:=(public.admin_search_goods_console(p_query=>search.q,p_ip_id=>'goods-console-test',p_status=>status_value,p_stock=>bucket,p_filters=>search.f)->>'total')::integer;
    if card is null or card<>clicked then raise exception 'stock card % differs from clicked total (status %, filters %): % vs %',bucket,status_value,search.f,card,clicked; end if;
   end loop;
  end loop;
 end loop;
end $$;
select 1/case when public.admin_search_goods_console(p_query=>'소량',p_ip_id=>'goods-console-test',p_filters=>'{"field":"name"}')->'stockCounts'='{"out_of_stock":1,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_status=>'all',p_filters=>'{"image":"without"}')->'stockCounts'='{"out_of_stock":2,"low":2}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-test',p_limit=>1,p_offset=>1000)->'stockCounts'='{"out_of_stock":2,"low":1}'::jsonb
 and public.admin_search_goods_console(p_ip_id=>'goods-console-no-such-ip')->'stockCounts'='{"out_of_stock":0,"low":0}'::jsonb
 then 1 else 0 end as assert_stock_counts_ignore_page_and_apply_search;
do $$ begin
 begin perform public.admin_search_goods_console(p_stock=>'sold_out'); raise exception 'unsupported stock filter accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_stock=>null); raise exception 'null stock filter accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_ip_id=>'goods-console-no-such-ip',p_stock=>'sold_out'); raise exception 'unsupported stock filter accepted without candidates'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"salePeriod":"open"}'); raise exception 'unsupported sale period accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"sort":"injected"}'); raise exception 'invalid sort accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"from":"2026-10-12","to":"2026-10-01"}'); raise exception 'invalid date range accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_search_goods_console(p_filters=>'{"unknown":true}'); raise exception 'unknown predicate accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061202',true);
do $$ begin
 begin perform public.admin_search_goods_console(); raise exception 'member can read console'; exception when insufficient_privilege then null; end;
 begin perform public.admin_goods_console_export_candidates(); raise exception 'member can export console'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','execute')
 and not has_function_privilege('authenticated','private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)','execute')
 and not has_function_privilege('anon','private.admin_goods_stock_filter_matches(text,text,bigint)','execute')
 and not has_function_privilege('authenticated','private.admin_goods_stock_filter_matches(text,text,bigint)','execute')
 and not has_function_privilege('service_role','private.admin_goods_stock_filter_matches(text,text,bigint)','execute')
 then 1 else 0 end as assert_console_execute_boundary;
rollback;
