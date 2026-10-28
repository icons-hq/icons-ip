\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same psql connection.
-- Every fixture, claim, audit and schema-local helper is rolled back.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_benefit_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected benefits error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('93800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','benefit-content-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '93800000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('93800000-0000-4000-8000-000000000001','primary'),('93800000-0000-4000-8000-000000000002','deputy'),('93800000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('benefit-content-ip','혜택 독립검토 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price) values('benefit-content-good','benefit-content-ip','혜택 독립검토 합성 상품','문구',1000),('benefit-content-empty','benefit-content-ip','혜택 없는 합성 상품','문구',1000),('benefit-content-images','benefit-content-ip','혜택 이미지 합성 상품','문구',1000);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='benefit-content-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='benefit-content-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='benefit-content-good';
select pg_temp.publish_goods_kc_fixture('benefit-content-good');
select 1/case when not has_table_privilege('authenticated','private.goods_benefit_content','select') and not has_table_privilege('service_role','private.goods_event_templates','insert') and not has_function_privilege('service_role','public.admin_save_goods_benefit_content(text,integer,uuid,jsonb)','execute') and not has_function_privilege('anon','public.admin_get_goods_benefit_content(text)','execute') then 1 else 0 end as sealed_acl;
select 1/case when not exists(
 select 1 from pg_class c cross join unnest(array['anon','authenticated','service_role']) role_name
 where c.oid in ('private.goods_benefit_content'::regclass,'private.goods_event_templates'::regclass)
 and (not c.relrowsecurity or has_table_privilege(role_name,c.oid,'select,insert,update,delete,truncate,references,trigger'))
) and not exists(
 select 1 from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role_name
 where p.oid in ('private.goods_benefit_document(text)'::regprocedure,'private.goods_benefit_has_photo(text,text)'::regprocedure,'private.clone_goods_benefit_content(text,text,uuid)'::regprocedure)
 and has_function_privilege(role_name,p.oid,'execute')
) then 1 else 0 end as private_rls_and_all_untrusted_acl_sealed;
select set_config('request.jwt.claim.sub','93800000-0000-4000-8000-000000000001',true);
set local role authenticated;
select 1/case when public.admin_get_goods_benefit_content('benefit-content-good')->>'revision'='0' then 1 else 0 end as absent_has_revision_zero;
select public.admin_save_goods_benefit_content('benefit-content-good',0,'93800000-0000-4000-8000-000000000101','{"eventText":"이벤트 안내","giftText":"사은품 안내","giftImagePaths":[]}') as saved \gset
select 1/case when public.admin_save_goods_benefit_content('benefit-content-good',0,'93800000-0000-4000-8000-000000000101','{"eventText":"이벤트 안내","giftText":"사은품 안내","giftImagePaths":[]}')=:'saved'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',0,'93800000-0000-4000-8000-000000000101','{"eventText":"수정","giftText":"사은품 안내","giftImagePaths":[]}')$q$,'operation_conflict');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',0,gen_random_uuid(),'{"eventText":"수정","giftText":"사은품 안내","giftImagePaths":[]}')$q$,'goods_benefits_changed');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',1,gen_random_uuid(),'{"eventText":"수정","giftText":"사은품 안내","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp"]}')$q$,'unverified_artwork');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',1,gen_random_uuid(),'{"eventText":"수정","giftText":"","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp"]}')$q$,'invalid_goods_benefit_images');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',1,gen_random_uuid(),'{"eventText":"수정","giftText":null,"giftImagePaths":[]}')$q$,'invalid_goods_benefit_content');
select set_config('request.jwt.claim.sub','93800000-0000-4000-8000-000000000003',true);
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-good',1,gen_random_uuid(),'{"eventText":"수정","giftText":"사은품 안내","giftImagePaths":[]}')$q$,'operator_capability_required');
select pg_temp.expect_benefit_error($q$select public.admin_get_goods_benefit_content('benefit-content-good')$q$,'operator_capability_required');
select pg_temp.expect_benefit_error($q$select public.admin_list_goods_event_templates()$q$,'operator_capability_required');
reset role;
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good')='{"eventText":"이벤트 안내","giftText":"사은품 안내","giftImagePaths":[]}'::jsonb then 1 else 0 end as public_projects_information_only;
reset role;
update public.goods set published_at=null where id='benefit-content-good';
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good') is null then 1 else 0 end as unpublished_good_hidden;
reset role;
update public.goods set published_at=now() where id='benefit-content-good';
update public.ips set published_at=null where id='benefit-content-ip';
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good') is null then 1 else 0 end as unpublished_ip_hidden;
reset role;
update public.ips set published_at=now() where id='benefit-content-ip';
set local role service_role;
select public.service_prepare_admin_artwork_upload('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000777.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000777.webp');
select public.service_verify_admin_artwork_upload('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000777.webp',100);
reset role;
select set_config('request.jwt.claim.sub','93800000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000778','public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp','혜택 사진',0);
select public.admin_save_goods_benefit_content('benefit-content-good',1,gen_random_uuid(),'{"eventText":"이벤트 안내","giftText":"사은품 안내","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp"]}');
select 1/case when jsonb_array_length(public.admin_list_goods_photos('혜택 사진')->'rows'->0->'references')=1 then 1 else 0 end as benefit_reference_tracked;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000778','public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp','혜택 사진',1,true)$q$,'goods_photo_in_use');
select public.admin_clone_good('93800000-0000-4000-8000-000000000201','benefit-content-good','benefit-content-clone','BENEFIT-REVIEW','혜택 복사 합성');
select public.admin_clone_good('93800000-0000-4000-8000-000000000201','benefit-content-good','benefit-content-clone','BENEFIT-REVIEW','혜택 복사 합성');
select public.admin_clone_good('93800000-0000-4000-8000-000000000202','benefit-content-empty','benefit-content-empty-clone','BENEFIT-NONE','혜택 없는 복사');
select 1/case when public.admin_get_goods_benefit_content('benefit-content-empty-clone')->>'revision'='0' then 1 else 0 end as clone_without_benefit_remains_empty;
select 1/case when public.admin_get_goods_benefit_content('benefit-content-clone')->>'revision'='1' and public.admin_get_goods_benefit_content('benefit-content-clone')->'giftImagePaths'='["public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp"]'::jsonb then 1 else 0 end as cloned_information_preserved;
select public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','템플릿 안내',false,0,'93800000-0000-4000-8000-000000000302') as template \gset
select 1/case when public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','템플릿 안내',false,0,'93800000-0000-4000-8000-000000000302')=:'template'::jsonb then 1 else 0 end as template_exact_replay;
select public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','템플릿 안내',true,1,'93800000-0000-4000-8000-000000000303');
select 1/case when public.admin_list_goods_event_templates('템플릿 안내',false,1)->>'total'='0' and public.admin_list_goods_event_templates('템플릿 안내',true,1)->>'total'='1' then 1 else 0 end as template_archive_search;
reset role;
select 1/case when (select count(*) from public.audit_log where id='93800000-0000-4000-8000-000000000201')=1 and (select revision from private.goods_benefit_content where good_id='benefit-content-clone')=1 then 1 else 0 end as clone_replay_writes_once;
select 1/case when not has_function_privilege('authenticated','private.clone_goods_benefit_content(text,text,uuid)','execute') and not has_function_privilege('service_role','private.goods_benefit_has_photo(text,text)','execute') then 1 else 0 end as new_helpers_sealed;
set local role service_role;
select public.service_prepare_admin_artwork_upload('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000779.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000779.webp');
select public.service_verify_admin_artwork_upload('93800000-0000-4000-8000-000000000001','catalog/good/93800000-0000-4000-8000-000000000779.webp',100);
reset role;
set local role authenticated;
select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000780','public-media/catalog/good/93800000-0000-4000-8000-000000000779.webp','메인 사진',0);
reset role;
update public.goods set image_path='public-media/catalog/good/93800000-0000-4000-8000-000000000779.webp' where id='benefit-content-good';
set local role authenticated;
select 1/case when jsonb_array_length(public.admin_list_goods_photos('메인 사진')->'rows'->0->'references')=1 and jsonb_array_length(public.admin_list_goods_photos('혜택 사진')->'rows'->0->'references')=2 then 1 else 0 end as existing_main_and_gift_only_references_preserved;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000780','public-media/catalog/good/93800000-0000-4000-8000-000000000779.webp','메인 사진',1,true)$q$,'goods_photo_in_use');
-- R19: 참조처 조회를 색인·조인으로 바꿔도 같은 상품이 갤러리와 사은품 양쪽에서 같은 사진을 쓰면 한 번만 센다.
savepoint r19_gallery_and_gift;
reset role;
update public.goods set gallery_paths=array['public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp'] where id='benefit-content-good';
set local role authenticated;
select 1/case when (select count(*) from jsonb_array_elements(public.admin_list_goods_photos('혜택 사진')->'rows'->0->'references') ref where ref->>'id'='benefit-content-good')=1
 and jsonb_array_length(public.admin_list_goods_photos('혜택 사진')->'rows'->0->'references')=2 then 1 else 0 end as gallery_and_gift_reference_listed_once;
rollback to savepoint r19_gallery_and_gift;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000778','public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp','혜택 사진',1,true)$q$,'goods_photo_in_use');
reset role;

-- The public projection must stop immediately for a restricted or archived good/IP.
update public.goods set sale_restriction='adult' where id='benefit-content-good';
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good') is null then 1 else 0 end as restricted_good_hidden;
reset role;
update public.goods set sale_restriction='none',archived_at=now() where id='benefit-content-good';
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good') is null then 1 else 0 end as archived_good_hidden;
reset role;
update public.goods set archived_at=now() where ip_id='benefit-content-ip' and archived_at is null;
update public.ips set archived_at=now() where id='benefit-content-ip';
set local role anon;
select 1/case when public.get_good_benefit_content('benefit-content-good') is null then 1 else 0 end as archived_ip_hidden;
reset role;
update public.ips set archived_at=null where id='benefit-content-ip';
update public.goods set archived_at=null where ip_id='benefit-content-ip';

create function pg_temp.benefit_verified_upload(actor uuid,image uuid) returns void language plpgsql as $$begin
 perform public.service_prepare_admin_artwork_upload(actor,'catalog/good/'||image||'.webp','good','image/webp',100,now()+interval '10 minutes');
 perform public.service_begin_admin_artwork_verification(actor,'catalog/good/'||image||'.webp');
 perform public.service_verify_admin_artwork_upload(actor,'catalog/good/'||image||'.webp',100);
end$$;
select pg_temp.benefit_verified_upload('93800000-0000-4000-8000-000000000001',('93800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) from generate_series(801,804)n where n<>803;
select pg_temp.benefit_verified_upload('93800000-0000-4000-8000-000000000002','93800000-0000-4000-8000-000000000803');
update public.admin_artwork_upload_claims set expires_at=clock_timestamp()-interval '1 second' where path='catalog/good/93800000-0000-4000-8000-000000000804.webp';
set local role authenticated;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',0,gen_random_uuid(),'{"eventText":"","giftText":"다른 운영자 사진","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp"]}')$q$,'unverified_artwork');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',0,gen_random_uuid(),'{"eventText":"","giftText":"기한 만료 사진","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000804.webp"]}')$q$,'unverified_artwork');
select set_config('request.jwt.claim.sub','93800000-0000-4000-8000-000000000002',true);
select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000805','public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp','다른 운영자 공용 사진',0);
select set_config('request.jwt.claim.sub','93800000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_benefit_content('benefit-content-images',0,'93800000-0000-4000-8000-000000000811',jsonb_build_object(
 'eventText',repeat('가',40),'giftText',repeat('나',100),'giftImagePaths',jsonb_build_array('public-media/catalog/good/93800000-0000-4000-8000-000000000801.webp','public-media/catalog/good/93800000-0000-4000-8000-000000000802.webp','public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp')));
select 1/case when jsonb_array_length(public.admin_get_goods_benefit_content('benefit-content-images')->'giftImagePaths')=3 and char_length(public.admin_get_goods_benefit_content('benefit-content-images')->>'eventText')=40 and char_length(public.admin_get_goods_benefit_content('benefit-content-images')->>'giftText')=100 then 1 else 0 end as three_images_and_unicode_boundaries;
select public.admin_save_goods_benefit_content('benefit-content-images',1,gen_random_uuid(),jsonb_build_object('eventText','순서 보존','giftText','기존 사진 유지',
 'giftImagePaths',jsonb_build_array('public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp','public-media/catalog/good/93800000-0000-4000-8000-000000000801.webp','public-media/catalog/good/93800000-0000-4000-8000-000000000802.webp')));
select 1/case when public.admin_get_goods_benefit_content('benefit-content-images')#>>'{giftImagePaths,0}'='public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp' then 1 else 0 end as attached_claims_retained_without_reconsume_and_order_preserved;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),jsonb_build_object('eventText',repeat('가',41),'giftText','','giftImagePaths','[]'::jsonb))$q$,'invalid_goods_benefit_content');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),jsonb_build_object('eventText','','giftText',repeat('나',101),'giftImagePaths','[]'::jsonb))$q$,'invalid_goods_benefit_content');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),jsonb_build_object('eventText',E'두\n줄','giftText','','giftImagePaths','[]'::jsonb))$q$,'invalid_goods_benefit_content');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"","giftText":"네 장","giftImagePaths":["a","b","c","d"]}')$q$,'invalid_goods_benefit_content');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"","giftText":"중복 사진","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000801.webp","public-media/catalog/good/93800000-0000-4000-8000-000000000801.webp"]}')$q$,'invalid_goods_benefit_images');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"","giftText":"잘못된 경로","giftImagePaths":["https://example.test/image.png"]}')$q$,'invalid_goods_benefit_images');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"","giftText":"빈 값","giftImagePaths":[null]}')$q$,'invalid_goods_benefit_content');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"","giftText":"","giftImagePaths":[],"grantCredits":100}')$q$,'invalid_goods_benefit_content');
select 1/case when public.admin_get_goods_benefit_content('benefit-content-images')->>'revision'='2' then 1 else 0 end as invalid_inputs_preserve_saved_revision;
select public.admin_save_goods_benefit_content('benefit-content-images',2,gen_random_uuid(),'{"eventText":"  공백 정규화  ","giftText":"  ","giftImagePaths":[]}');
select 1/case when public.admin_get_goods_benefit_content('benefit-content-images')->>'eventText'='공백 정규화' and public.admin_get_goods_benefit_content('benefit-content-images')->>'giftText'='' then 1 else 0 end as trimmed_clear_values;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',3,gen_random_uuid(),'{"eventText":"","giftText":"소비된 일회 업로드","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000801.webp"]}')$q$,'unverified_artwork');
select public.admin_save_goods_photo('93800000-0000-4000-8000-000000000805','public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp','다른 운영자 공용 사진',1,true);
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_benefit_content('benefit-content-images',3,gen_random_uuid(),'{"eventText":"","giftText":"보관 사진","giftImagePaths":["public-media/catalog/good/93800000-0000-4000-8000-000000000803.webp"]}')$q$,'unverified_artwork');
reset role;
select 1/case when (select count(*) from public.admin_artwork_upload_claims where path in ('catalog/good/93800000-0000-4000-8000-000000000801.webp','catalog/good/93800000-0000-4000-8000-000000000802.webp','catalog/good/93800000-0000-4000-8000-000000000803.webp') and status='attached' and attached_at is not null)=3 then 1 else 0 end as verified_or_library_claims_attached;

set local role authenticated;
select public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','템플릿 복원',false,2,'93800000-0000-4000-8000-000000000304');
select 1/case when public.admin_list_goods_event_templates('템플릿 복원',false,1)#>>'{rows,0,revision}'='3' then 1 else 0 end as template_restore_with_revision;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','오래된 문구',false,2,gen_random_uuid())$q$,'goods_event_template_changed');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_event_template(gen_random_uuid(),repeat('가',41),false,0,gen_random_uuid())$q$,'invalid_goods_event_template');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_event_template(gen_random_uuid(),'   ',false,0,gen_random_uuid())$q$,'invalid_goods_event_template');
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_event_template(gen_random_uuid(),'없던 템플릿 보관',true,0,gen_random_uuid())$q$,'goods_event_template_changed');
do $$declare n integer;begin
 for n in 1..21 loop
  perform public.admin_save_goods_event_template(('93800000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,'혜택페이지 '||n,false,0,('93800000-0000-4000-8200-'||lpad(n::text,12,'0'))::uuid);
 end loop;
end$$;
select 1/case when public.admin_list_goods_event_templates('혜택페이지 ',false,1)->>'total'='21'
 and jsonb_array_length(public.admin_list_goods_event_templates('혜택페이지 ',false,1)->'rows')=20
 and jsonb_array_length(public.admin_list_goods_event_templates('혜택페이지 ',false,2)->'rows')=1
 and (select count(distinct e->>'id') from jsonb_array_elements((public.admin_list_goods_event_templates('혜택페이지 ',false,1)->'rows')||(public.admin_list_goods_event_templates('혜택페이지 ',false,2)->'rows'))e)=21 then 1 else 0 end as template_server_pagination_twenty;
select pg_temp.expect_benefit_error($q$select public.admin_list_goods_event_templates('',false,0)$q$,'invalid_event_template_search');
reset role;

update private.operator_memberships set manager_role='logistics' where profile_id='93800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_benefit_error($q$select public.admin_save_goods_event_template('93800000-0000-4000-8000-000000000301','템플릿 안내',false,0,'93800000-0000-4000-8000-000000000302')$q$,'operator_capability_required');
reset role;

rollback;
