\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. All fixtures and settings roll back.
begin;
create function pg_temp.expect_presentation_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','presentation-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,5)n;
update public.profiles set role='staff',nickname='presentation-test-'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '87000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('87000000-0000-4000-8000-000000000001','primary'),('87000000-0000-4000-8000-000000000002','deputy'),
 ('87000000-0000-4000-8000-000000000003','influencer'),('87000000-0000-4000-8000-000000000004','agency'),('87000000-0000-4000-8000-000000000005','logistics');
insert into public.ips(id,title,vertical_key,published_at,public_slug) select 'presentation-test-ip','전시 합성 IP',key,now(),'presentation-test-ip' from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price,published_at) values('presentation-test-good','presentation-test-ip','전시 합성 상품','문구',1000,null),('presentation-test-draft','presentation-test-ip','초안 합성 상품','문구',1000,null);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('presentation-test-good'),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5('presentation-test-good')||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now());
update public.profiles set role='staff' where id=('47c47700'||left(md5('presentation-test-good'),24))::uuid;
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('presentation-test-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('presentation-test-good');
update public.goods set description='<p>실제 &amp; 상품 설명</p><script>hidden-script</script>',description_format='html',gallery_paths=array['goods/test/1.webp','goods/test/2.webp','goods/test/3.webp','goods/test/4.webp','goods/test/5.webp','goods/test/6.webp','goods/test/7.webp','goods/test/8.webp','goods/test/9.webp'] where id='presentation-test-good';
select 1/case when not has_table_privilege('anon','private.store_presentation_settings','select') and not has_table_privilege('authenticated','private.store_presentation_settings','update')
 and not has_table_privilege('service_role','private.goods_listing_colors','select') and not has_function_privilege('anon','public.admin_get_store_presentation()','execute')
 and not has_function_privilege('service_role','public.admin_save_store_presentation(text,jsonb,bigint,uuid)','execute') and has_function_privilege('anon','public.get_storefront_presentation()','execute')
 and not has_function_privilege('authenticated','private.goods_listing_colors_valid(jsonb)','execute') then 1 else 0 end as sealed_acl;
select public.get_storefront_presentation() as initial_settings \gset
select revision as common_revision from private.store_presentation_settings where section='common' \gset
select revision as listing_revision from private.store_presentation_settings where section='listing' \gset
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select 1/case when public.admin_get_store_presentation()->'values'=:'initial_settings'::jsonb then 1 else 0 end as admin_readback;
select pg_temp.expect_presentation_error($q$select public.admin_save_store_presentation('common','{"themeColor":null,"headerStyle":"basic","showHomeSearch":false}',0,'87000000-0000-4000-8000-000000000101')$q$,'invalid_store_presentation');
select pg_temp.expect_presentation_error($q$select public.admin_save_store_presentation('common','{"themeColor":"red","headerStyle":"basic","showHomeSearch":false}',0,'87000000-0000-4000-8000-000000000101')$q$,'invalid_store_presentation');
select pg_temp.expect_presentation_error($q$select public.admin_save_store_presentation('common','{"themeColor":"#78bb53","headerStyle":"basic","showHomeSearch":false,"bankAccount":"leak"}',0,'87000000-0000-4000-8000-000000000101')$q$,'invalid_store_presentation');
select public.admin_save_store_presentation('common','{"themeColor":"#654f43","headerStyle":"color","showHomeSearch":true}',:'common_revision','87000000-0000-4000-8000-000000000101') as saved_common \gset
select 1/case when public.admin_save_store_presentation('common','{"themeColor":"#654f43","headerStyle":"color","showHomeSearch":true}',:'common_revision','87000000-0000-4000-8000-000000000101')=:'saved_common'::jsonb then 1 else 0 end as exact_retry;
select pg_temp.expect_presentation_error($q$select public.admin_save_store_presentation('common','{"themeColor":"#78bb53","headerStyle":"basic","showHomeSearch":false}',0,'87000000-0000-4000-8000-000000000101')$q$,'operation_conflict');
select pg_temp.expect_presentation_error(format($q$select public.admin_save_store_presentation('common','{"themeColor":"#78bb53","headerStyle":"basic","showHomeSearch":false}',%s,'87000000-0000-4000-8000-000000000102')$q$,:'common_revision'),'store_presentation_conflict');
select public.admin_save_store_presentation('listing','{"imageShape":"portrait","imageMode":"gallery","showColors":true,"showDescription":true,"showCart":true,"showTags":false}',:'listing_revision','87000000-0000-4000-8000-000000000103');
select pg_temp.expect_presentation_error($q$select public.admin_save_goods_listing_colors('presentation-test-good','[{"label":"빈색","hex":"red"}]',0,'87000000-0000-4000-8000-000000000104')$q$,'invalid_goods_listing_colors');
select pg_temp.expect_presentation_error($q$select public.admin_save_goods_listing_colors('presentation-test-good','[{"label":"같음","hex":"#ffffff"},{"label":"같음","hex":"#000000"}]',0,'87000000-0000-4000-8000-000000000104')$q$,'invalid_goods_listing_colors');
select public.admin_save_goods_listing_colors('presentation-test-good','[{"label":"검정","hex":"#000000"},{"label":"크림","hex":"#eae1d8"}]',0,'87000000-0000-4000-8000-000000000104') as saved_colors \gset
select 1/case when public.admin_save_goods_listing_colors('presentation-test-good','[{"label":"검정","hex":"#000000"},{"label":"크림","hex":"#eae1d8"}]',0,'87000000-0000-4000-8000-000000000104')=:'saved_colors'::jsonb then 1 else 0 end as color_exact_retry;
select pg_temp.expect_presentation_error($q$select public.admin_save_goods_listing_colors('presentation-test-good','[]',0,'87000000-0000-4000-8000-000000000105')$q$,'goods_listing_colors_conflict');
select public.admin_save_goods_listing_colors('presentation-test-draft','[{"label":"초안","hex":"#000000"}]',0,'87000000-0000-4000-8000-000000000106');
reset role;
set local role anon;
select public.get_goods_listing_appearance(array['presentation-test-good','presentation-test-draft','missing']) as appearance \gset
select 1/case when jsonb_array_length(:'appearance'::jsonb)=1 and :'appearance'::jsonb#>>'{0,id}'='presentation-test-good'
 and jsonb_array_length(:'appearance'::jsonb#>'{0,galleryPaths}')=9 and jsonb_array_length(:'appearance'::jsonb#>'{0,colors}')=2
 and position('hidden-script' in :'appearance')=0 and position('<p>' in :'appearance')=0
 and (select count(*) from jsonb_object_keys(public.get_storefront_presentation()))=2 then 1 else 0 end as bounded_public_projection;
reset role;
update public.goods set description='A < B > C',description_format='plain' where id='presentation-test-good';
select 1/case when public.get_goods_listing_appearance(array['presentation-test-good'])#>>'{0,description}'='A < B > C' and public.get_goods_listing_appearance(array['presentation-test-good'])#>>'{0,descriptionFormat}'='plain' then 1 else 0 end as plain_text_preserved;
update public.goods set sale_restriction='adult' where id='presentation-test-good';
select 1/case when public.get_goods_listing_appearance(array['presentation-test-good'])='[]' then 1 else 0 end as restricted_is_hidden;
update public.goods set sale_restriction='none' where id='presentation-test-good';
update public.ips set published_at=null where id='presentation-test-ip';
select 1/case when public.get_goods_listing_appearance(array['presentation-test-good'])='[]' then 1 else 0 end as private_parent_is_hidden;
update public.goods set id='presentation-test-renamed' where id='presentation-test-draft';
select 1/case when exists(select 1 from private.goods_listing_colors where good_id='presentation-test-renamed' and revision=1) then 1 else 0 end as draft_rename_keeps_colors;
-- Deputy/agency have store and catalog access; logistics has neither.
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.admin_get_store_presentation();select public.admin_get_goods_listing_colors('presentation-test-good');
reset role;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.admin_get_store_presentation();
select public.admin_get_goods_listing_colors('presentation-test-good');
reset role;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.expect_presentation_error($q$select public.admin_get_store_presentation()$q$,'operator_capability_required');
select pg_temp.expect_presentation_error($q$select public.admin_get_goods_listing_colors('presentation-test-good')$q$,'operator_capability_required');
select pg_temp.expect_presentation_error($q$select public.admin_save_store_presentation('common','{"themeColor":"#78bb53","headerStyle":"basic","showHomeSearch":false}',0,'87000000-0000-4000-8000-000000000109')$q$,'operator_capability_required');
reset role;
delete from private.operator_memberships where profile_id='87000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_presentation_error($q$select public.admin_get_store_presentation()$q$,'operator_capability_required');
reset role;
select 1/case when (select count(*) from public.audit_log where id::text like '87000000-0000-4000-8000-%')=4 then 1 else 0 end as one_audit_per_write;
rollback;
