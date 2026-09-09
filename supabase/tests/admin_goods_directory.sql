\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000041301','authenticated','authenticated','goods-list-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000041302','authenticated','authenticated','goods-list-user@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000041301';
insert into public.verticals(key,label,color) values ('goods-list','상품 목록','#000000');
insert into public.ips(id,title,vertical_key) values ('goods-list','상품 목록','goods-list');
insert into public.goods(id,code,ip_id,name,type,price,stock)
select 'goods-list-'||lpad(n::text,4,'0'),'LIST-'||lpad(n::text,4,'0'),'goods-list','목록 상품 '||n,'키링',1000,'ok'
from generate_series(1,1000)n;
update public.goods set name='문자 %_ 검색' where id='goods-list-0999';
update public.goods_variants set code='WAREHOUSE-EXACT-1000' where good_id='goods-list-1000' and is_default;
select 1 / case when not has_function_privilege('anon','public.admin_search_goods(text)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods(text)','execute')
 then 1 else 0 end as assert_search_is_staff_session_only;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000041302',true);
do $$ begin
  begin
    perform public.admin_search_goods('');
    raise exception 'nonstaff directory read allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000041301',true);
select 1 / case when (select count(*) from public.admin_search_goods('') where ip_id='goods-list')=1000
 and (select count(*) from (select id from public.admin_search_goods('') where ip_id='goods-list' order by id limit 20) page)=20
 and (select id from public.admin_search_goods('') where ip_id='goods-list' order by id limit 1 offset 20)='goods-list-0021'
 then 1 else 0 end as assert_thousand_records_have_exact_twenty_row_page_and_stable_next_page;
select 1 / case when (select id from public.admin_search_goods('warehouse-exact-1000'))='goods-list-1000'
 and (select id from public.admin_search_goods('LIST-0888'))='goods-list-0888'
 and (select id from public.admin_search_goods('goods-list-0777'))='goods-list-0777'
 and (select id from public.admin_search_goods('%_'))='goods-list-0999'
 then 1 else 0 end as assert_searches_option_product_code_id_and_literal_wildcards;
do $$ begin
  begin
    perform public.admin_search_goods(repeat('x',101));
    raise exception 'overlong search allowed';
  exception when invalid_parameter_value then null; end;
end $$;
explain (analyze, costs off, timing off)
 select id from public.admin_search_goods('') where ip_id='goods-list' order by id limit 20;
rollback;
