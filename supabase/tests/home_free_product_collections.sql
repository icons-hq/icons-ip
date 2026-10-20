\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; all test rows and layout changes roll back.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_free_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected free-product error: %',expected;end $$;
create function pg_temp.free_payload(ids jsonb default '[]',layout text default 'list',item_count integer default 3,shape text default 'square') returns jsonb language sql as $$
 select jsonb_build_object('layout',layout,'image_shape',shape,'item_count',item_count,'good_ids',ids)$$;
create function pg_temp.save_free(op uuid,id uuid,version timestamptz,title text,payload jsonb,enabled boolean default true)
returns uuid language sql as $$select public.admin_save_home_curation(op,id,'product_collection',null,title,null,null,0,'2020-01-01',null,enabled,null,payload,version)$$;
create function pg_temp.public_free(id uuid) returns jsonb language sql as $$select value from jsonb_array_elements(public.get_home_product_collections()) where value->>'id'=id::text$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','free-products-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '96000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('96000000-0000-4000-8000-000000000001','primary'),('96000000-0000-4000-8000-000000000002','deputy'),('96000000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('free-products-ip','자유상품 합성 IP','character',now()),('free-products-draft-ip','초안 합성 IP','character',null);
insert into public.goods(id,ip_id,name,type,price) select 'free-products-good-'||n,case when n=7 then 'free-products-draft-ip' else 'free-products-ip' end,'자유상품 합성 '||n,'문구',1000 from generate_series(1,7)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'free-products-good-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'free-products-good-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'free-products-good-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'free-products-good-%' and id<>'free-products-good-5';
update public.goods set sale_restriction='adult' where id='free-products-good-6';
update public.goods set stock='soldout' where id='free-products-good-2';
-- Sealed helpers and the same narrow public reader for anon/authenticated only.
select 1/case when has_function_privilege('anon','public.get_home_product_collections()','execute')
 and has_function_privilege('authenticated','public.get_home_product_collections()','execute')
 and not has_function_privilege('service_role','public.get_home_product_collections()','execute')
 and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='public.get_home_product_collections()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then 1 else 0 end as public_reader_acl;
select 1/case when bool_and(not has_function_privilege(r,p,'execute')) then 1 else 0 end as projection_helpers_sealed
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['private.is_valid_home_product_collection(jsonb)','private.guard_home_free_product_limit()','private.public_home_product_collection_goods(jsonb)'])p;
do $$declare candidate jsonb;begin
 foreach candidate in array array[null::jsonb,'{}'::jsonb,pg_temp.free_payload()||'{"unknown":true}',pg_temp.free_payload()||'{"layout":"mosaic"}',pg_temp.free_payload()||'{"image_shape":"auto"}',
  pg_temp.free_payload()||'{"item_count":"3"}',pg_temp.free_payload()||'{"item_count":3.1}',pg_temp.free_payload()||'{"good_ids":[1]}',pg_temp.free_payload()||'{"good_ids":[null]}',pg_temp.free_payload()||'{"good_ids":["x","x"]}',
  pg_temp.free_payload()||'{"good_ids":["/shop/x"]}',pg_temp.free_payload('[]','list',2),pg_temp.free_payload('[]','list',13),pg_temp.free_payload('[]','full_image',0),pg_temp.free_payload('[]','full_image',9),
  pg_temp.free_payload((select jsonb_agg('g-'||n) from generate_series(1,101)n))] loop
  if private.is_valid_home_product_collection(candidate) then raise exception 'Invalid collection accepted: %',candidate;end if;
 end loop;
 if not private.is_valid_home_product_collection(pg_temp.free_payload('[]','list',12,'landscape')) or not private.is_valid_home_product_collection(pg_temp.free_payload('[]','full_image',1,'portrait')) then raise exception 'Valid collection rejected';end if;
end$$;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.save_free('96000000-0000-4000-8000-000000000101','96100000-0000-4000-8000-000000000001',null,repeat('😀',15),
 pg_temp.free_payload('["missing","free-products-good-5","free-products-good-6","free-products-good-7","free-products-good-2","free-products-good-1","free-products-good-3","free-products-good-4"]'||(select jsonb_agg('extra-'||n) from generate_series(1,92)n)));
select updated_at as version_one from public.home_curations where id='96100000-0000-4000-8000-000000000001' \gset
select 1/case when char_length(title)=15 and jsonb_array_length(payload->'good_ids')=100 and image_path is null and link_path is null
 then 1 else 0 end as raw_ordered_pool_and_title from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001')#>'{payload,good_ids}'='["free-products-good-2","free-products-good-1","free-products-good-3"]'::jsonb then 1 else 0 end as staff_public_projection_fills_past_hidden_and_keeps_soldout;
reset role;
set local role anon;
select 1/case when not exists(select 1 from public.home_curations where id='96100000-0000-4000-8000-000000000001')
 and pg_temp.public_free('96100000-0000-4000-8000-000000000001')#>'{payload,good_ids}'='["free-products-good-2","free-products-good-1","free-products-good-3"]'::jsonb
 and (select array_agg(k order by k)=array['id','payload','title'] from jsonb_object_keys(pg_temp.public_free('96100000-0000-4000-8000-000000000001'))k)
 then 1 else 0 end as anon_only_gets_public_products_no_admin_pool;
reset role;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select 1/case when not exists(select 1 from public.home_curations where id='96100000-0000-4000-8000-000000000001')
 and pg_temp.public_free('96100000-0000-4000-8000-000000000001')#>'{payload,good_ids}'='["free-products-good-2","free-products-good-1","free-products-good-3"]'::jsonb then 1 else 0 end as nonstore_staff_public_projection_is_identical;
select pg_temp.expect_free_error($q$select pg_temp.save_free(gen_random_uuid(),gen_random_uuid(),null,'거절',pg_temp.free_payload())$q$,'operator_capability_required');
reset role;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_free_error($q$select pg_temp.save_free(gen_random_uuid(),'96100000-0000-4000-8000-000000000001',updated_at,repeat('😀',16),pg_temp.free_payload()) from public.home_curations where id='96100000-0000-4000-8000-000000000001'$q$,'invalid_curation_title');
select pg_temp.expect_free_error($q$select pg_temp.save_free(gen_random_uuid(),'96100000-0000-4000-8000-000000000001',updated_at,E'제목\n줄',pg_temp.free_payload()) from public.home_curations where id='96100000-0000-4000-8000-000000000001'$q$,'invalid_curation_product_collection');
select pg_temp.expect_free_error($q$select pg_temp.save_free(gen_random_uuid(),'96100000-0000-4000-8000-000000000001',updated_at,'잘못된 개수',pg_temp.free_payload('[]','full_image',12)) from public.home_curations where id='96100000-0000-4000-8000-000000000001'$q$,'invalid_curation_product_collection');
select pg_temp.expect_free_error($q$select public.admin_save_home_curation(gen_random_uuid(),'96100000-0000-4000-8000-000000000001','product_collection',null,'링크',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.free_payload(),updated_at) from public.home_curations where id='96100000-0000-4000-8000-000000000001'$q$,'invalid_curation_link_path');
-- Layout, hidden rows and public products use the same visibility conditions.
select public.admin_save_home_layout('96000000-0000-4000-8000-000000000201',(select revision from public.home_layout_settings where singleton),
 '[{"key":"products:96100000-0000-4000-8000-000000000001","enabled":true},{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]');
select 1/case when (public.get_home_layout_order())[1]='products:96100000-0000-4000-8000-000000000001' then 1 else 0 end as independent_layout_position;
select public.admin_save_home_layout('96000000-0000-4000-8000-000000000202',(select revision from public.home_layout_settings where singleton),
 '[{"key":"products:96100000-0000-4000-8000-000000000001","enabled":false},{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]');
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null
 and not ('products:96100000-0000-4000-8000-000000000001'=any(public.get_home_layout_order())) then 1 else 0 end as both_public_surfaces_hide_layout_disabled;
reset role;
update public.home_layout_settings set blocks=null where singleton;
set local role authenticated;
select pg_temp.save_free('96000000-0000-4000-8000-000000000102','96100000-0000-4000-8000-000000000001',:'version_one','큰 상품',jsonb_set(jsonb_set(payload,'{layout}','"full_image"'),'{item_count}','1')) from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select updated_at as version_two from public.home_curations where id='96100000-0000-4000-8000-000000000001' \gset
select 1/case when jsonb_array_length(payload->'good_ids')=100 and pg_temp.public_free(id)#>'{payload,good_ids}'='["free-products-good-2"]'::jsonb then 1 else 0 end as design_and_count_changes_keep_raw_pool from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select pg_temp.expect_free_error(format($q$select pg_temp.save_free(gen_random_uuid(),'96100000-0000-4000-8000-000000000001',%L,'오래된 수정',pg_temp.free_payload())$q$,:'version_one'),'PT409');
select pg_temp.save_free('96000000-0000-4000-8000-000000000101','96100000-0000-4000-8000-000000000001',null,repeat('😀',15),
 pg_temp.free_payload('["missing","free-products-good-5","free-products-good-6","free-products-good-7","free-products-good-2","free-products-good-1","free-products-good-3","free-products-good-4"]'||(select jsonb_agg('extra-'||n) from generate_series(1,92)n)));
select 1/case when title='큰 상품' and updated_at=:'version_two' then 1 else 0 end as exact_replay_keeps_latest_state from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select pg_temp.save_free(gen_random_uuid(),'96100000-0000-4000-8000-000000000001',:'version_two','빈 구성',pg_temp.free_payload());
select public.admin_save_home_layout(gen_random_uuid(),(select revision from public.home_layout_settings where singleton),
 '[{"key":"products:96100000-0000-4000-8000-000000000001","enabled":true},{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]');
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null and not ('products:96100000-0000-4000-8000-000000000001'=any(public.get_home_layout_order())) then 1 else 0 end as empty_collection_and_layout_key_both_hidden;
select pg_temp.save_free(gen_random_uuid(),id,updated_at,'한 상품',pg_temp.free_payload('["free-products-good-1"]','list',12,'landscape')) from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001')#>'{payload,good_ids}'='["free-products-good-1"]'::jsonb then 1 else 0 end as fewer_eligible_than_count_still_visible;
reset role;
update public.goods set archived_at=now() where id='free-products-good-1';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null then 1 else 0 end as goods_archive_hides_last_product;
update public.goods set archived_at=null where id='free-products-good-1';
update public.ips set published_at=null where id='free-products-ip';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null then 1 else 0 end as ip_draft_hides_last_product;
update public.ips set published_at=now() where id='free-products-ip';
update public.home_curations set active_to='2020-02-01' where id='96100000-0000-4000-8000-000000000001';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null then 1 else 0 end as ended_collection_hidden;
update public.home_curations set active_to=null,active_from=now()+interval '1 day' where id='96100000-0000-4000-8000-000000000001';
select 1/case when pg_temp.public_free('96100000-0000-4000-8000-000000000001') is null then 1 else 0 end as scheduled_collection_hidden;
update public.home_curations set active_from='2020-01-01' where id='96100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_free_error($q$select public.admin_save_home_curation(gen_random_uuid(),id,'best_tab',null,'변환',null,'/shop',0,'2020-01-01',null,true,'category','{"good_ids":["free-products-good-1"]}',updated_at) from public.home_curations where id='96100000-0000-4000-8000-000000000001'$q$,'curation_kind_change_not_allowed');
-- Fill the shared cap without editing any pre-existing row; disabled/ended count.
do $$declare remaining integer;n integer;begin
 select 5-count(*) into remaining from public.home_curations where kind in ('product_mosaic','product_collection');
 for n in 1..remaining loop
  perform public.admin_save_home_curation(gen_random_uuid(),('96100000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,'product_mosaic',null,'종료 모자이크',null,'/shop',n,'2020-01-01','2020-02-01',false,null,
   jsonb_build_object('mosaic_title','','mosaic_subtitle','','slots',(select jsonb_agg(jsonb_build_object('good_id',null,'image_path',null)) from generate_series(1,8))),null);
 end loop;
end$$;
select 1/case when count(*)=5 then 1 else 0 end as combined_cap_counts_all_states from public.home_curations where kind in ('product_mosaic','product_collection');
select pg_temp.expect_free_error($q$select pg_temp.save_free(gen_random_uuid(),gen_random_uuid(),null,'여섯번째',pg_temp.free_payload())$q$,'home_free_product_limit');
select pg_temp.save_free(gen_random_uuid(),id,updated_at,'한도에서도 수정',payload,false) from public.home_curations where id='96100000-0000-4000-8000-000000000001';
select 1/case when not enabled then 1 else 0 end as at_cap_update_and_hide_allowed from public.home_curations where id='96100000-0000-4000-8000-000000000001';
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id='96000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_free_error($q$select pg_temp.save_free('96000000-0000-4000-8000-000000000101','96100000-0000-4000-8000-000000000001',null,repeat('😀',15),pg_temp.free_payload('["missing","free-products-good-5","free-products-good-6","free-products-good-7","free-products-good-2","free-products-good-1","free-products-good-3","free-products-good-4"]'||(select jsonb_agg('extra-'||n) from generate_series(1,92)n)))$q$,'operator_capability_required');
reset role;
rollback;
