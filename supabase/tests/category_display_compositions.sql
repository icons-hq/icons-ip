\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the SAME psql session. Rollback-only.
begin;
create function pg_temp.cd_id(n integer) returns uuid language sql immutable as $$select ('93930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.cd_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'category display assertion: %',label;end if;end$$;
create function pg_temp.cd_revision(id uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.category_display_compositions where category_id=id$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.cd_id(n),'authenticated','authenticated','category-display-'||n||'@example.test',now(),'{"testFixture":"category-display"}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.cd_id(3) then 'user'::public.user_role else 'staff'::public.user_role end where id in(select pg_temp.cd_id(n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cd_id(1),'deputy'),(pg_temp.cd_id(2),'deputy');
update private.operator_access_state set configured=true where id;
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 (pg_temp.cd_id(11),'cd-display-root','전시 검증 분류',null,0),
 (pg_temp.cd_id(12),'cd-display-child','전시 검증 말단',pg_temp.cd_id(11),0),
 (pg_temp.cd_id(13),'cd-display-other','다른 분류',null,1);
insert into private.category_display_nodes(id,parent_id,name,sort_order,archived_at,legacy_category_id)
 select id,parent_id,name,sort_order,archived_at,id from public.catalog_categories where code like 'cd-display-%';
update public.category_activation_control set customer_enabled=true where id='catalog';
insert into public.ips(id,title,vertical_key,published_at) values('cd-display-ip','카테고리 전시 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,category_id)
select 'cd-display-g-'||n,'cd-display-ip','카테고리 검증 상품 '||n,'문구',1000,case when n<=1001 then pg_temp.cd_id(12) else pg_temp.cd_id(13) end from generate_series(1,1003)n;
insert into public.goods_additional_categories(good_id,category_id) values('cd-display-g-1002',pg_temp.cd_id(12));
-- Use the real KC review contract with an explicitly provisioned fixture actor.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5('cd-display-g-'||n),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5('cd-display-g-'||n)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from generate_series(1,1002)n;
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5('cd-display-g-'||n),24))::uuid,'primary' from generate_series(1,1002)n;
select pg_temp.publish_goods_kc_fixture('cd-display-g-'||n) from generate_series(1,1002)n;
update public.goods_variants set stock_qty=10 where good_id like 'cd-display-g-%';
-- Synthetic bulk inserts need representative planner statistics in this clone.
analyze public.goods;analyze public.goods_variants;analyze public.ips;analyze public.catalog_categories;analyze public.goods_additional_categories;
create temp table cd_original as select md5(jsonb_agg(to_jsonb(g) order by id)::text) goods from public.goods g where id like 'cd-display-g-%';
create temp table cd_categories_original as select md5(jsonb_agg(to_jsonb(c) order by id)::text) categories from public.catalog_categories c where code like 'cd-display-%';
create temp table cd_home_original as select md5(coalesce(jsonb_agg(to_jsonb(h) order by id),'[]'::jsonb)::text) home from public.home_curations h;

select pg_temp.cd_assert(not has_table_privilege('anon','private.category_display_compositions','select')
 and not has_table_privilege('authenticated','private.category_display_goods','update')
 and not has_function_privilege('service_role','public.admin_save_category_display(uuid,jsonb,bigint,uuid)','execute')
 and not has_function_privilege('anon','public.admin_preview_category_display(uuid,jsonb,jsonb)','execute'),'private tables and write/preview ACL sealed');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cd_id(1)::text,true);
do $$declare v jsonb;s jsonb;replayed jsonb;p jsonb;page jsonb;query jsonb:='{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}';token text;sort_value text;seen text[]:='{}';offset_value integer:=0;
begin
 s:=public.admin_get_category_display(pg_temp.cd_id(11));v:=s->'values';
 perform pg_temp.cd_assert(s->>'revision'='0' and v->>'enabled'='false','new disabled default');
 v:=v||'{"enabled":true}';
 s:=public.admin_save_category_display(pg_temp.cd_id(11),v,0,pg_temp.cd_id(100));
 replayed:=public.admin_save_category_display(pg_temp.cd_id(11),v,0,pg_temp.cd_id(100));
 perform pg_temp.cd_assert(s=replayed and pg_temp.cd_revision(pg_temp.cd_id(11))=1,'same operation exactly once with actual row revision');
 begin perform public.admin_save_category_display(pg_temp.cd_id(11),v,0,pg_temp.cd_id(101));raise exception 'stale accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_save_category_display(pg_temp.cd_id(11),v||'{"enabled":false}',0,pg_temp.cd_id(100));raise exception 'different payload reused';exception when unique_violation then null;end;
 p:=public.get_category_display_page(pg_temp.cd_id(11),query);token:=p->>'token';
 perform pg_temp.cd_assert(p->>'total'='1002' and p->>'filteredTotal'='1002' and jsonb_array_length(p->'rows')=20,'primary plus additional category, over 1000 complete total');
 perform pg_temp.cd_assert(p#>>'{rows,0,id}'='cd-display-g-1' and p#>>'{rows,1,id}'='cd-display-g-2' and p#>>'{rows,19,id}'='cd-display-g-20','natural recommended ordering');
 loop
  page:=public.get_category_display_page(pg_temp.cd_id(11),query,offset_value,case when offset_value=0 then null else token end);
  seen:=seen||array(select value->>'id' from jsonb_array_elements(page->'rows'));
  exit when page->>'nextOffset' is null;offset_value:=(page->>'nextOffset')::integer;
 end loop;
 perform pg_temp.cd_assert(cardinality(seen)=1002 and (select count(distinct id) from unnest(seen)id)=1002 and 'cd-display-g-1002'=any(seen),'all 51 pages exact and no duplicate');
 perform pg_temp.cd_assert(public.admin_preview_category_display(pg_temp.cd_id(11),v,query)->'rows'=p->'rows','preview uses same row query');
 foreach sort_value in array array['newest','price_asc','price_desc'] loop
  page:=public.admin_preview_category_display(pg_temp.cd_id(11),v,query||jsonb_build_object('sort',sort_value));
  perform pg_temp.cd_assert(page#>>'{rows,0,id}'='cd-display-g-1' and page#>>'{rows,1,id}'='cd-display-g-2' and page#>>'{rows,9,id}'='cd-display-g-10','category ties preserve recommended natural order: '||sort_value);
  page:=public.admin_preview_category_display(pg_temp.cd_id(11),v||'{"mode":"manual","goodIds":["cd-display-g-10","cd-display-g-2","cd-display-g-1"]}',query||jsonb_build_object('sort',sort_value));
  perform pg_temp.cd_assert(page#>>'{rows,0,id}'='cd-display-g-10' and page#>>'{rows,1,id}'='cd-display-g-2' and page#>>'{rows,2,id}'='cd-display-g-1','manual ties preserve configured order: '||sort_value);
 end loop;
 perform pg_temp.cd_assert(public.get_category_display_page(pg_temp.cd_id(11),query||'{"ips":["missing-ip"]}')->>'filteredTotal'='0','unknown IP never widens scope');
 -- The normal rebuild deletes one link and also changes video: response and DB
 -- must remain N+1, not the N+2 caused by treating a normal save as an FK cascade.
 v:=v||'{"mode":"manual","goodIds":["cd-display-g-3"]}';s:=public.admin_save_category_display(pg_temp.cd_id(11),v,1,pg_temp.cd_id(102));
 v:=jsonb_set(v,'{video,goodId}','"cd-display-g-3"');s:=public.admin_save_category_display(pg_temp.cd_id(11),v,2,pg_temp.cd_id(103));
 perform pg_temp.cd_assert(s->>'revision'='3' and pg_temp.cd_revision(pg_temp.cd_id(11))=3,'one main link rebuild plus video addition increments once');
 v:=jsonb_set(v,'{video,goodId}','null');s:=public.admin_save_category_display(pg_temp.cd_id(11),v,3,pg_temp.cd_id(104));
 perform pg_temp.cd_assert(s->>'revision'='4' and pg_temp.cd_revision(pg_temp.cd_id(11))=4,'one main link rebuild plus video clear increments once');
 begin perform public.get_category_display_page(pg_temp.cd_id(11),query,20,token);raise exception 'stale page accepted';exception when sqlstate 'PT409' then null;end;
 v:=jsonb_set(v,'{goodIds}',(select jsonb_agg('cd-display-g-'||case when n=1000 then 1003 else n end order by n) from generate_series(1,1000)n));
 s:=public.admin_save_category_display(pg_temp.cd_id(11),v,4,pg_temp.cd_id(105));
 perform pg_temp.cd_assert(jsonb_array_length(s#>'{values,goodIds}')=1000,'manual 1000 accepted');
 begin perform public.admin_save_category_display(pg_temp.cd_id(11),jsonb_set(v,'{goodIds}',v->'goodIds'||'["cd-display-g-1001"]'),5,pg_temp.cd_id(106));raise exception 'manual 1001 accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_save_category_display(pg_temp.cd_id(11),jsonb_set(v,'{goodIds}','["cd-display-g-1","cd-display-g-1"]'),5,pg_temp.cd_id(107));raise exception 'duplicate accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
select pg_temp.cd_assert((select goods from cd_original)=(select md5(jsonb_agg(to_jsonb(g) order by id)::text) from public.goods g where id like 'cd-display-g-%'),'goods rows unchanged by display saves');
select pg_temp.cd_assert((select categories from cd_categories_original)=(select md5(jsonb_agg(to_jsonb(c) order by id)::text) from public.catalog_categories c where code like 'cd-display-%'),'category rows unchanged by display saves');
select pg_temp.cd_assert((select home from cd_home_original)=(select md5(coalesce(jsonb_agg(to_jsonb(h) order by id),'[]'::jsonb)::text) from public.home_curations h),'home rows unchanged by display saves');

-- A never-published draft can change its slug; published slug immutability stays intact.
-- FK ID change and deletion invalidate stale editor revisions without a writer.
update public.goods set id='cd-display-renamed' where id='cd-display-g-1003';
select pg_temp.cd_assert(pg_temp.cd_revision(pg_temp.cd_id(11))=6 and exists(select 1 from private.category_display_goods where category_id=pg_temp.cd_id(11) and good_id='cd-display-renamed'),'FK rename follows reference and bumps revision');
delete from public.goods where id='cd-display-renamed';
select pg_temp.cd_assert(pg_temp.cd_revision(pg_temp.cd_id(11))=7 and not exists(select 1 from private.category_display_goods where category_id=pg_temp.cd_id(11) and good_id='cd-display-renamed'),'FK deletion removes reference and bumps revision');
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,status,expires_at,verified_at,final_size,processing_started_at)
 values('catalog/curation/93930000-0000-4000-8000-000000000201.png',pg_temp.cd_id(1),'curation','image/png',100,'verified',now()+interval '1 hour',now(),100,now());
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cd_id(1)::text,true);
do $$declare s jsonb;v jsonb;p jsonb;begin
 s:=public.admin_get_category_display(pg_temp.cd_id(11));v:=s->'values';
 v:=jsonb_set(v,'{banner}',v->'banner'||'{"enabled":true,"imagePath":"public-media/catalog/curation/93930000-0000-4000-8000-000000000201.png","altTitle":"꺼진 대체텍스트"}');
 s:=public.admin_save_category_display(pg_temp.cd_id(11),v,7,pg_temp.cd_id(108));
 perform pg_temp.cd_assert(s->>'revision'='8' and pg_temp.cd_revision(pg_temp.cd_id(11))=8,'image save revision');
 p:=public.get_category_display_page(pg_temp.cd_id(11),'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}');
 perform pg_temp.cd_assert(p#>>'{banner,altText}'='' and not p->'banner' ? 'altTitle' and not p ? 'revision' and not p ? 'values','public banner and page minimum fields');
 begin perform public.admin_save_category_display(pg_temp.cd_id(13),v,0,pg_temp.cd_id(109));raise exception 'other display reused attached claim';exception when check_violation then null;end;
end $$;
reset role;
select pg_temp.cd_assert((select status='attached' from public.admin_artwork_upload_claims where path='catalog/curation/93930000-0000-4000-8000-000000000201.png'),'fresh claim consumed');
set local role service_role;
select pg_temp.cd_assert(not exists(select 1 from public.service_list_admin_artwork_cleanup_candidates(10000) where path='catalog/curation/93930000-0000-4000-8000-000000000201.png' and cleanup_mode='all'),'attached display banner is never an all-object cleanup candidate');
reset role;
update public.catalog_categories set archived_at=clock_timestamp() where id=pg_temp.cd_id(11);
select pg_temp.cd_assert(public.get_category_display_page(pg_temp.cd_id(11),'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}') is not null,'merchandise taxonomy archive does not hide independent manual display');
update private.category_display_nodes set archived_at=clock_timestamp() where id=pg_temp.cd_id(11);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.cd_assert(public.get_category_display_page(pg_temp.cd_id(11),'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}') is null,'archived parent blocks display');
select pg_temp.cd_assert(not exists(select 1 from jsonb_array_elements(public.get_category_display_navigation()) row where row->>'id'=pg_temp.cd_id(11)::text),'archived parent absent from navigation');
reset role;
update public.catalog_categories set archived_at=null where id=pg_temp.cd_id(11);
update public.profiles set suspended_at=now(),suspension_reason='test' where id=pg_temp.cd_id(1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cd_id(1)::text,true);
do $$begin
 perform public.admin_save_category_display(pg_temp.cd_id(11),'{}',0,pg_temp.cd_id(100));raise exception 'revoked actor reached receipt';
exception when insufficient_privilege then null;end$$;
select set_config('request.jwt.claim.sub',pg_temp.cd_id(3)::text,true);
do $$begin perform public.admin_get_category_display(pg_temp.cd_id(11));raise exception 'customer read admin settings';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
