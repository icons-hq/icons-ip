\set ON_ERROR_STOP on
begin;
create function pg_temp.group_console_error(q text) returns void language plpgsql as $$begin
 begin execute q; exception when invalid_parameter_value or invalid_text_representation or datetime_field_overflow then return; end;
 raise exception 'Expected invalid input: %',q;
end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a6160000-0000-4000-8000-000000000001','authenticated','authenticated','group-console@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='TEST 그룹 목록',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='a6160000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('a6160000-0000-4000-8000-000000000001','primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('a6160000-0000-4000-8000-000000000002','a6160000-0000-4000-8000-000000000001',now(),now(),now()+interval '1 hour');
insert into public.ips(id,title,vertical_key,published_at) values('group-console-ip','TEST 목록 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,notice_maker) select 'group-console-'||n,'group-console-ip','TEST 상품 '||n,'문구',10000,'ok',n,'TEST 제작사' from generate_series(1,4) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','a6160000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a6160000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a6160000-0000-4000-8000-000000000002"}',true);
select public.admin_save_goods_group('a6160000-0000-4000-8000-000000000003',0,
 '{"name":"TEST 목록 A","optionNames":["색상"],"members":[{"goodId":"group-console-1","values":["빨강"]},{"goodId":"group-console-2","values":["파랑"]}]}',
 'a6160000-0000-4000-8000-000000000004','a6160000-0000-4000-8000-000000000001','a6160000-0000-4000-8000-000000000002');
select public.admin_save_goods_group('a6160000-0000-4000-8000-000000000005',0,
 '{"name":"TEST 목록 B","optionNames":["색상"],"members":[{"goodId":"group-console-3","values":["빨강"]},{"goodId":"group-console-4","values":["파랑"]}]}',
 'a6160000-0000-4000-8000-000000000006','a6160000-0000-4000-8000-000000000001','a6160000-0000-4000-8000-000000000002');
select public.admin_search_goods_group_console('{"query":"TEST 목록","sort":"name_asc"}') as result \gset
select 1/case when :'result'::jsonb->>'total'='2' and :'result'::jsonb#>>'{counts,draft}'='2' and :'result'::jsonb#>>'{rows,0,name}'='TEST 목록 A'
 and :'result'::jsonb#>>'{metadata,a6160000-0000-4000-8000-000000000003,createdAt}' is not null then 1 else 0 end as assert_counts_order_metadata;
select 1/case when public.admin_search_goods_group_console('{"query":"group-console-1","field":"goodId"}')->>'total'='1'
 and public.admin_search_goods_group_console('{"query":"TEST 제작사","field":"maker"}')->>'total'='2'
 and public.admin_search_goods_group_console('{"query":"group-console","field":"goodId","status":"published"}')->>'total'='0'
 and public.admin_search_goods_group_console('{"query":"TEST 목록","stock":"soldout"}')->>'total'='0'
 and public.admin_search_goods_group_console('{"query":"TEST 목록","stock":"available"}')->>'total'='2' then 1 else 0 end as assert_filters;
select 1/case when public.admin_search_goods_group_console('{"query":"TEST 목록","page":2,"pageSize":20}')->>'total'='2'
 and jsonb_array_length(public.admin_search_goods_group_console('{"query":"TEST 목록","page":2,"pageSize":20}')->'rows')=0 then 1 else 0 end as assert_page_total;
select public.admin_archive_goods_group('a6160000-0000-4000-8000-000000000005',1,'a6160000-0000-4000-8000-000000000007','a6160000-0000-4000-8000-000000000001','a6160000-0000-4000-8000-000000000002');
select public.admin_search_goods_group_console('{"query":"TEST 목록","status":"archived"}') as archived \gset
select 1/case when :'archived'::jsonb->>'total'='1' and :'archived'::jsonb#>>'{counts,all}'='2'
 and :'archived'::jsonb#>>'{counts,draft}'='1' and :'archived'::jsonb#>>'{counts,archived}'='1' then 1 else 0 end as assert_status_count_scope;
select pg_temp.group_console_error('select public.admin_search_goods_group_console(''{"pageSize":1000}'')');
select pg_temp.group_console_error('select public.admin_search_goods_group_console(''{"field":"unsafe"}'')');
select pg_temp.group_console_error('select public.admin_search_goods_group_console(''{"from":"2026-02-30"}'')');
select pg_temp.group_console_error('select public.admin_search_goods_group_console(''{"from":"2026-03-01","to":"2026-02-01"}'')');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_search_goods_group_console(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_group_console(jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_search_goods_group_console(jsonb)','execute') then 1 else 0 end as assert_execute_roles;
update public.profiles set role='user' where id='a6160000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 begin perform public.admin_search_goods_group_console('{}'); exception when insufficient_privilege then return; end;
 raise exception 'Non-operator received private groups';
end$$;
rollback;
