\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.ct_id(n integer) returns uuid language sql immutable as $$select ('94700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ct_expect(statement text,expected text) returns void language plpgsql as $$begin
  begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
  raise exception 'Expected error: %',expected;end$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 (pg_temp.ct_id(1),'authenticated','authenticated','category-template-primary@example.test','{}','{}'),
 (pg_temp.ct_id(2),'authenticated','authenticated','category-template-other@example.test','{}','{}');
update public.profiles set role='staff' where id=pg_temp.ct_id(1);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ct_id(1),'primary');
insert into public.catalog_categories(id,code,name,depth,sort_order) values(pg_temp.ct_id(100),'qa-cat-template-root','QA 분류 템플릿 상위',1,0);
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order)
 select pg_temp.ct_id(100+n),'qa-cat-template-'||n,'QA 분류 템플릿 '||n,pg_temp.ct_id(100),2,n from generate_series(1,22)n;
insert into public.ips(id,title,vertical_key) values('qa-category-template-ip','QA 분류 템플릿 IP','character');
insert into public.goods(id,ip_id,name,type,price,category_id) values('qa-category-template-good','qa-category-template-ip','QA 분류 템플릿 상품','문구',1000,pg_temp.ct_id(101));
create temp table ct_good_before as select to_jsonb(g) original from public.goods g where id='qa-category-template-good';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ct_id(1)::text,true);
select public.admin_save_catalog_category_templates(jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',0),jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',0)),false,pg_temp.ct_id(1001)) as first_receipt \gset
select 1/case when public.admin_save_catalog_category_templates(jsonb_build_array(jsonb_build_object('revision',0,'categoryId',pg_temp.ct_id(102)),jsonb_build_object('revision',0,'categoryId',pg_temp.ct_id(101))),false,pg_temp.ct_id(1001))=:'first_receipt'::jsonb then 1 else 0 end as reordered_same_operation_replays;
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,true,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',1),jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',0)),pg_temp.ct_id(1002)),'PT409');
select 1/case when public.admin_list_catalog_category_templates('qa-cat-template',false,1)->>'total'='2'
 and public.admin_list_catalog_category_templates('qa-cat-template',true,1)->>'total'='0'
 and public.admin_list_catalog_category_templates('qa-cat-template',false,1)#>>'{rows,0,revision}'='1' then 1 else 0 end as entire_bulk_update_rolls_back_on_late_conflict;
select public.admin_save_catalog_category_templates(jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',1)),true,pg_temp.ct_id(1003));
select 1/case when public.admin_list_catalog_category_templates('qa-cat-template',true,1)->>'total'='1' then 1 else 0 end as archived_list_matches;
select public.admin_save_catalog_category_templates(jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',2)),false,pg_temp.ct_id(1004));
select 1/case when public.admin_list_catalog_category_templates('qa-cat-template',true,1)->>'total'='0' then 1 else 0 end as restored;
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,false,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(100),'revision',0)),pg_temp.ct_id(1005)),'category_not_usable');
select pg_temp.ct_expect('select public.admin_save_catalog_category_templates(''[true]''::jsonb,false,''94700000-0000-4000-8000-000000001006'')','22023');
select pg_temp.ct_expect('select public.admin_save_catalog_category_templates(''[{"categoryId":"not-a-uuid","revision":0}]''::jsonb,false,''94700000-0000-4000-8000-000000001007'')','22023');
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,false,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',1),jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',1)),pg_temp.ct_id(1008)),'22023');
select pg_temp.ct_expect('select public.admin_list_catalog_category_templates('''',false,0)','22023');
select pg_temp.ct_expect('select * from private.catalog_category_templates','42501');
select public.admin_save_catalog_category_templates((select jsonb_agg(jsonb_build_object('categoryId',pg_temp.ct_id(100+n),'revision',0)) from generate_series(3,21)n),false,pg_temp.ct_id(1009));
select 1/case when public.admin_list_catalog_category_templates('qa-cat-template',false,1)->>'total'='21'
 and jsonb_array_length(public.admin_list_catalog_category_templates('qa-cat-template',false,1)->'rows')=20
 and jsonb_array_length(public.admin_list_catalog_category_templates('qa-cat-template',false,2)->'rows')=1
 and public.admin_list_catalog_category_templates('%',false,1)->>'total'='0' then 1 else 0 end as paging_and_literal_query;
select public.admin_save_catalog_category_templates(jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(103),'revision',1)),true,pg_temp.ct_id(1010));
reset role;
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order) values(pg_temp.ct_id(200),'qa-cat-template-new-child','QA 새 하위 분류',pg_temp.ct_id(103),3,1);
set local role authenticated;
select 1/case when public.admin_list_catalog_category_templates('qa-cat-template-3',true,1)#>>'{rows,0,usable}'='false' then 1 else 0 end as previously_leaf_is_now_unusable;
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,false,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(103),'revision',2)),pg_temp.ct_id(1011)),'category_not_usable');
select set_config('request.jwt.claim.sub',pg_temp.ct_id(2)::text,true);
select pg_temp.ct_expect('select public.admin_list_catalog_category_templates()','42501');
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,false,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',0),jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',0)),pg_temp.ct_id(1001)),'42501');
reset role;
update private.operator_memberships set manager_role='logistics',revision=revision+1 where profile_id=pg_temp.ct_id(1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ct_id(1)::text,true);
select pg_temp.ct_expect(format('select public.admin_save_catalog_category_templates(%L::jsonb,false,%L)',jsonb_build_array(jsonb_build_object('categoryId',pg_temp.ct_id(101),'revision',0),jsonb_build_object('categoryId',pg_temp.ct_id(102),'revision',0)),pg_temp.ct_id(1001)),'42501');
reset role;
select 1/case when (select to_jsonb(g) from public.goods g where id='qa-category-template-good')=(select original from ct_good_before) then 1 else 0 end as existing_goods_are_unchanged;
select 1/case when not has_function_privilege('anon','public.admin_list_catalog_category_templates(text,boolean,integer)','execute')
 and not has_function_privilege('service_role','public.admin_save_catalog_category_templates(jsonb,boolean,uuid)','execute')
 and not has_function_privilege('authenticated','private.catalog_category_template_document(uuid)','execute')
 then 1 else 0 end as function_acl_is_sealed;
rollback;
