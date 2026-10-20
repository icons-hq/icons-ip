\set ON_ERROR_STOP on
-- Rollback-only current-model tests. Prepend helpers/goods_kc_fixture.sql.
begin;
create function pg_temp.dt_id(n integer) returns uuid language sql immutable as $$select ('94931000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.dt_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'display tree assertion: %',label;end if;end$$;
create function pg_temp.dt_change(change jsonb,operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select public.admin_update_category_display_tree(change,(public.admin_list_category_displays()->>'revision')::bigint,operation)
$$;
create function pg_temp.dt_private_values(id uuid) returns jsonb language sql security definer set search_path='' as $$select private.category_display_values(id)$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select pg_temp.dt_id(n),'authenticated','authenticated','display-tree-'||n||'@example.test',now(),'{"testFixture":"display-tree"}','{}' from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.dt_id(1) then 'admin'::public.user_role when id=pg_temp.dt_id(2) then 'staff'::public.user_role else 'user'::public.user_role end where id in(select pg_temp.dt_id(n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.dt_id(1),'owner'),(pg_temp.dt_id(2),'primary');
update private.operator_access_state set configured=true where id;
update public.category_activation_control set customer_enabled=true where id='catalog';
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 (pg_temp.dt_id(10),'independent-source-a','생활/문구 상품분류',null,0),(pg_temp.dt_id(11),'independent-source-b','예약 상품분류',null,1);
select pg_temp.dt_assert(not exists(select 1 from private.category_display_nodes where id in(pg_temp.dt_id(10),pg_temp.dt_id(11))),'new merchandise categories do not create display nodes');
insert into public.ips(id,title,vertical_key,published_at) values('display-tree-ip','독립 전시 검증','character',now());
insert into public.goods(id,ip_id,name,type,price,category_id) values('display-tree-good','display-tree-ip','전시 연결 상품','문구',4900,pg_temp.dt_id(10));
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values(('47c47700'||left(md5('display-tree-good'),24))::uuid,'authenticated','authenticated','kc-display-tree@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('display-tree-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('display-tree-good');
update public.goods_variants set stock_qty=2 where good_id='display-tree-good';
-- The test operates within its own root; source catalog sizes do not affect it.
update private.category_display_nodes set archived_at=coalesce(archived_at,clock_timestamp()) where parent_id is null;
create temp table dt_original as select
 (select md5(jsonb_agg(to_jsonb(c) order by id)::text) from public.catalog_categories c) categories,
 (select md5(jsonb_agg(to_jsonb(g) order by id)::text) from public.goods g) goods,
 (select md5(coalesce(jsonb_agg(to_jsonb(c) order by good_id,category_id),'[]')::text) from public.goods_additional_categories c) additional,
 (select md5(to_jsonb(s)::text) from public.store_settings s) store;
select pg_temp.dt_assert(not has_table_privilege('anon','private.category_display_nodes','select')
 and not has_table_privilege('authenticated','private.category_display_nodes','update')
 and not has_function_privilege('anon','public.admin_update_category_display_tree(jsonb,bigint,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_update_category_display_tree(jsonb,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','private.category_display_source_category(uuid)','execute'),'new tables and mutation ACL sealed');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1)::text,true);
do $$declare revision bigint;created jsonb;replayed jsonb;v jsonb;p jsonb;nav jsonb;change jsonb;before_values jsonb;
 query jsonb:='{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}';
begin
 revision:=(public.admin_list_category_displays()->>'revision')::bigint;
 change:=jsonb_build_object('action','create','id',pg_temp.dt_id(20),'name','홍실 퀘스트','parentId',null,'position',0);
 created:=public.admin_update_category_display_tree(change,revision,pg_temp.dt_id(100));
 replayed:=public.admin_update_category_display_tree(change,revision,pg_temp.dt_id(100));
 perform pg_temp.dt_assert(created=replayed and (created#>>'{directory,revision}')::bigint=revision+1,'create replay exactly once');
 perform pg_temp.dt_assert(not exists(select 1 from jsonb_array_elements(created#>'{directory,sourceCategories}') s where s->>'id'=pg_temp.dt_id(20)::text),'display node not offered as merchandise source');
 begin perform public.admin_update_category_display_tree(change||'{"name":"재사용"}',revision,pg_temp.dt_id(100));raise exception 'operation payload reused';exception when unique_violation then null;end;
 begin perform public.admin_update_category_display_tree(change||jsonb_build_object('id',pg_temp.dt_id(21)),revision,pg_temp.dt_id(101));raise exception 'stale tree accepted';exception when sqlstate 'PT409' then null;end;
 perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(21),'name','일반배송','parentId',pg_temp.dt_id(20),'position',0));
 perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(22),'name','예약판매','parentId',pg_temp.dt_id(20),'position',1));
 perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(23),'name','굿즈 모음','parentId',pg_temp.dt_id(21),'position',0));
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name','허용 안 되는 4단계','parentId',pg_temp.dt_id(23),'position',0));raise exception 'fourth level accepted';exception when check_violation then null;end;
 begin perform pg_temp.dt_change(jsonb_build_object('action','update','id',pg_temp.dt_id(20),'name','순환','parentId',pg_temp.dt_id(23),'position',0));raise exception 'cycle accepted';exception when check_violation then null;end;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name',repeat('가',21),'parentId',null,'position',0));raise exception '21 characters accepted';exception when check_violation then null;end;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name','앞뒤 공백 ','parentId',null,'position',0));raise exception 'whitespace accepted';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name','잘못된 순서','parentId',null,'position',999999));raise exception 'out of range position accepted';exception when invalid_parameter_value then null;end;
 perform pg_temp.dt_assert(public.admin_get_category_display(pg_temp.dt_id(21))#>'{values,categoryIds}'='[]'::jsonb,'new display default never treats its UUID as merchandise category');
 v:=public.admin_get_category_display(pg_temp.dt_id(21))->'values';v:=v||jsonb_build_object('enabled',true,'categoryIds',jsonb_build_array(pg_temp.dt_id(10)));
 perform public.admin_save_category_display(pg_temp.dt_id(21),v,0,pg_temp.dt_id(102));
 p:=public.get_category_display_page(pg_temp.dt_id(21),query);
 perform pg_temp.dt_assert(p#>>'{category,name}'='일반배송' and p->>'total'='1' and p#>>'{rows,0,id}'='display-tree-good','independent node supports actual taxonomy matching and public destination');
 begin perform public.admin_save_category_display(pg_temp.dt_id(21),v||jsonb_build_object('categoryIds',jsonb_build_array(pg_temp.dt_id(22))),1,pg_temp.dt_id(103));raise exception 'display UUID accepted as merchandise source';exception when check_violation then null;end;
 v:=v||'{"mode":"manual","goodIds":["display-tree-good"],"video":{"enabled":true,"goodId":"display-tree-good"}}';
 perform public.admin_save_category_display(pg_temp.dt_id(21),v,1,pg_temp.dt_id(104));
 before_values:=pg_temp.dt_private_values(pg_temp.dt_id(21));
 perform pg_temp.dt_change(jsonb_build_object('action','update','id',pg_temp.dt_id(22),'name','예약 상품만','parentId',pg_temp.dt_id(20),'position',0));
 perform pg_temp.dt_assert((public.admin_get_category_display(pg_temp.dt_id(22))#>>'{category,sortOrder}')::integer=0 and (public.admin_get_category_display(pg_temp.dt_id(21))#>>'{category,sortOrder}')::integer=1,'sibling move is atomic and contiguous');
 begin perform pg_temp.dt_change(jsonb_build_object('action','update','id',pg_temp.dt_id(21),'name','배송 굿즈','parentId',pg_temp.dt_id(22),'position',0));raise exception 'subtree depth four accepted';exception when check_violation then null;end;
 perform pg_temp.dt_change(jsonb_build_object('action','update','id',pg_temp.dt_id(23),'name','굿즈 모음','parentId',pg_temp.dt_id(22),'position',0));
 perform pg_temp.dt_change(jsonb_build_object('action','update','id',pg_temp.dt_id(21),'name','배송 굿즈','parentId',pg_temp.dt_id(22),'position',1));
 perform pg_temp.dt_assert(public.admin_get_category_display(pg_temp.dt_id(21))#>>'{category,depth}'='3' and pg_temp.dt_private_values(pg_temp.dt_id(21))=before_values,'reparent and rename preserve every composition field');
 perform pg_temp.dt_assert(public.get_category_display_page(pg_temp.dt_id(21),query)#>>'{category,name}'='배송 굿즈','same public UUID now uses independent name');
 nav:=public.get_category_display_navigation();
 perform pg_temp.dt_assert(exists(select 1 from jsonb_array_elements(nav) item where item->>'id'=pg_temp.dt_id(21)::text and item->>'depth'='3'),'public menu follows display depth');
 perform pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(22)));
 perform pg_temp.dt_assert(public.get_category_display_page(pg_temp.dt_id(21),query) is null and not exists(select 1 from jsonb_array_elements(public.get_category_display_navigation()) item where item->>'id'=pg_temp.dt_id(21)::text),'archived display ancestor blocks direct URL and navigation');
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name','보관 부모','parentId',pg_temp.dt_id(22),'position',0));raise exception 'archived parent accepted';exception when check_violation then null;end;
 perform pg_temp.dt_change(jsonb_build_object('action','restore','id',pg_temp.dt_id(22)));
 perform pg_temp.dt_assert(public.get_category_display_page(pg_temp.dt_id(21),query)->>'total'='1' and pg_temp.dt_private_values(pg_temp.dt_id(21))=before_values,'restore preserves content and resumes public destination');
 perform pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(21)));
 perform pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(22)));
 begin perform pg_temp.dt_change(jsonb_build_object('action','restore','id',pg_temp.dt_id(21)));raise exception 'restore under archived parent accepted';exception when check_violation then null;end;
 perform pg_temp.dt_change(jsonb_build_object('action','restore','id',pg_temp.dt_id(22)));
 perform pg_temp.dt_assert(public.get_category_display_page(pg_temp.dt_id(21),query) is null,'restoring ancestor does not revive separately archived descendant');
 perform pg_temp.dt_change(jsonb_build_object('action','restore','id',pg_temp.dt_id(21)));
 -- Invalid keys and lifecycle payloads never mutate state.
 begin perform pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(21),'enabled',true));raise exception 'unknown lifecycle key accepted';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(24),'name',repeat('가',20),'parentId',null,'position',0,'extra',true));raise exception 'unknown create key accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
select pg_temp.dt_assert((select categories from dt_original)=(select md5(jsonb_agg(to_jsonb(c) order by id)::text) from public.catalog_categories c)
 and (select goods from dt_original)=(select md5(jsonb_agg(to_jsonb(g) order by id)::text) from public.goods g)
 and (select additional from dt_original)=(select md5(coalesce(jsonb_agg(to_jsonb(c) order by good_id,category_id),'[]')::text) from public.goods_additional_categories c)
 and (select store from dt_original)=(select md5(to_jsonb(s)::text) from public.store_settings s),'tree operations preserve merchandise rows/classification/store settings');
update public.catalog_categories set name='상품분류만 변경',archived_at=clock_timestamp() where id=pg_temp.dt_id(10);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.dt_assert(public.get_category_display_page(pg_temp.dt_id(21),'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}')#>>'{category,name}'='배송 굿즈','merchandise rename/archive leaves independent manual display unchanged');
reset role;
update public.category_activation_control set customer_enabled=false where id='catalog';
select pg_temp.dt_assert(public.get_category_display_navigation()='[]'::jsonb,'existing global customer category gate retained');
update public.category_activation_control set customer_enabled=true where id='catalog';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1)::text,true);
do $$declare n integer;result jsonb;begin
 for n in 1..18 loop
  perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(300+n),'name',case when n=18 then repeat('가',20) else '최상위 '||n end,'parentId',null,'position',0));
 end loop;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(399),'name','20번째','parentId',null,'position',0));raise exception '20 roots accepted';exception when check_violation then null;end;
 -- Root20 already has one active child22, so fourteen additional siblings fit.
 for n in 1..14 loop
  perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(400+n),'name','하위 '||n,'parentId',pg_temp.dt_id(20),'position',0));
 end loop;
 begin perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(499),'name','16번째','parentId',pg_temp.dt_id(20),'position',0));raise exception '16 children accepted';exception when check_violation then null;end;
 perform pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(414)));
 perform pg_temp.dt_change(jsonb_build_object('action','create','id',pg_temp.dt_id(499),'name','비운 자리','parentId',pg_temp.dt_id(20),'position',0));
 begin perform pg_temp.dt_change(jsonb_build_object('action','restore','id',pg_temp.dt_id(414)));raise exception 'restore over capacity accepted';exception when check_violation then null;end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(3)::text,true);
do $$begin perform public.admin_list_category_displays();raise exception 'customer read private directory';exception when insufficient_privilege then null;end$$;
do $$begin perform public.admin_update_category_display_tree(jsonb_build_object('action','archive','id',pg_temp.dt_id(21)),0,pg_temp.dt_id(599));raise exception 'customer mutated';exception when insufficient_privilege then null;end$$;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(2)::text,true);
select pg_temp.dt_change(jsonb_build_object('action','archive','id',pg_temp.dt_id(413)),pg_temp.dt_id(598));
reset role;
update public.profiles set role='user' where id=pg_temp.dt_id(2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(2)::text,true);
do $$begin perform public.admin_update_category_display_tree(jsonb_build_object('action','archive','id',pg_temp.dt_id(21)),0,pg_temp.dt_id(598));raise exception 'stale membership bypassed profile role';exception when insufficient_privilege then null;end$$;
do $$begin perform public.admin_update_category_display_tree(jsonb_build_object('action','archive','id',pg_temp.dt_id(413)),0,pg_temp.dt_id(598));raise exception 'revoked actor replayed receipt';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
