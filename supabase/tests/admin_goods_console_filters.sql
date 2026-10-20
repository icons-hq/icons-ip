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
do $$ begin
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
 then 1 else 0 end as assert_console_execute_boundary;
rollback;
