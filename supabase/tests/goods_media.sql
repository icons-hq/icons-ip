\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Run in an isolated DB as supabase_admin.
begin;
create function pg_temp.expect_media_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected media error: %',expected;end $$;
update private.operator_access_state set configured=false where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('92800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','goods-media-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,7)n;
update public.profiles set role=case when id='92800000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::integer<=6 then 'staff'::public.user_role else 'user'::public.user_role end where id::text like '92800000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) select ('92800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['owner','primary','deputy','influencer','agency','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
update private.goods_media_settings set priority='image',shortclips=false,revision=0 where id;
insert into public.ips(id,title,vertical_key,published_at,public_slug) select 'media-test-ip','영상 검증 IP',key,now(),'media-test-ip' from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) values('media-test-1','media-test-ip','검증 영상 상품1','문구',1000),('media-test-2','media-test-ip','검증 영상 상품2','문구',1000);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now() from public.goods where id like 'media-test-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'media-test-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'media-test-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id='media-test-1';
load 'safeupdate';
select 1/case when not has_table_privilege('authenticated','private.goods_media_assets','select')
 and not has_function_privilege('authenticated','public.service_prepare_goods_media_upload(uuid,uuid,text,integer)','execute')
 and not has_function_privilege('anon','public.admin_save_good_media(text,jsonb,bigint,uuid)','execute') then 1 else 0 end as sealed_media_acl;
select pg_temp.expect_media_error($q$select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000007','92800000-0000-4000-8001-000000000001','video',4001)$q$,'42501');
select pg_temp.expect_media_error($q$select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001','video',52428801)$q$,'invalid_goods_media_upload');
select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001','video',4001);
select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001','video',4001);
select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000002','shortclip',4001);
select pg_temp.expect_media_error($q$select public.service_prepare_goods_media_upload('92800000-0000-4000-8000-000000000002','92800000-0000-4000-8001-000000000001','video',4001)$q$,'goods_media_claim_conflict');
set local role authenticated;
select set_config('request.jwt.claim.sub','92800000-0000-4000-8000-000000000001',true);
select 1/case when public.can_stage_goods_media('video/92800000-0000-4000-8001-000000000001.mp4') then 1 else 0 end as owner_can_stage;
select pg_temp.expect_media_error($q$select public.service_begin_goods_media_verification('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001')$q$,'42501');
select set_config('request.jwt.claim.sub','92800000-0000-4000-8000-000000000002',true);
select 1/case when not public.can_stage_goods_media('video/92800000-0000-4000-8001-000000000001.mp4') then 1 else 0 end as other_actor_cannot_stage;
reset role;
update private.goods_media_assets set expires_at=clock_timestamp()+interval '1 second' where id='92800000-0000-4000-8001-000000000001';
select 1/case when public.service_begin_goods_media_verification('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001')->>'status'='claimed'
 and public.service_begin_goods_media_verification('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001')->>'status'='processing' then 1 else 0 end as serialized_verifier;
select 1/case when (select expires_at>clock_timestamp()+interval '14 minutes' from private.goods_media_assets where id='92800000-0000-4000-8001-000000000001') then 1 else 0 end as processing_lease_renewed;
select jsonb_build_object('width',160,'height',120,'durationMs',2000,'byteSize',4001,'sha256',repeat('a',64),'videoCodec','avc1.64000a','audioCodec','mp4a.40.2') as media_metadata \gset
select 1/case when not public.service_verify_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001',:'media_metadata') then 1 else 0 end as needs_stored_object;
insert into storage.objects(bucket_id,name,metadata) values('goods-videos','video/92800000-0000-4000-8001-000000000001.mp4','{"mimetype":"video/mp4","size":4001}'),('goods-videos','shortclip/92800000-0000-4000-8001-000000000002.mp4','{"mimetype":"video/mp4","size":4001}');
select 1/case when not public.service_verify_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001',jsonb_set(:'media_metadata','{durationMs}','60001')) then 1 else 0 end as invalid_server_metadata;
select 1/case when public.service_verify_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001',:'media_metadata')
 and public.service_begin_goods_media_verification('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001')->>'status'='verified' then 1 else 0 end as verified_replay;
select public.service_complete_goods_media_cleanup('92800000-0000-4000-8001-000000000001','staging');
select public.service_begin_goods_media_verification('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000002');
select public.service_verify_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000002',:'media_metadata');
select public.service_complete_goods_media_cleanup('92800000-0000-4000-8001-000000000002','staging');
set local role authenticated;
select set_config('request.jwt.claim.sub','92800000-0000-4000-8000-000000000001',true);
select 1/case when not public.can_stage_goods_media('video/92800000-0000-4000-8001-000000000001.mp4') then 1 else 0 end as verified_path_write_closed;
select '{"video":{"id":"92800000-0000-4000-8001-000000000001","title":"검증 동영상"},"shortclip":{"id":"92800000-0000-4000-8001-000000000002","title":"검증 숏클립"}}'::jsonb as selected_media \gset
select public.admin_save_good_media('media-test-1',:'selected_media',0,'92800000-0000-4000-8002-000000000001');
select public.admin_save_good_media('media-test-1',:'selected_media',0,'92800000-0000-4000-8002-000000000001');
select pg_temp.expect_media_error($q$select public.admin_save_good_media('media-test-1','{"video":null,"shortclip":null}',0,'92800000-0000-4000-8002-000000000001')$q$,'operation_conflict');
select pg_temp.expect_media_error($q$select public.admin_save_good_media('media-test-1','{"video":null,"shortclip":null}',0,gen_random_uuid())$q$,'PT409');
select pg_temp.expect_media_error(format('select public.admin_save_good_media(%L,%L,0,gen_random_uuid())','media-test-2',:'selected_media'),'goods_media_asset_unavailable');
select 1/case when public.admin_get_good_media('media-test-1')->>'revision'='1' then 1 else 0 end as saved_media_revision;
select public.admin_save_goods_media_settings('{"priority":"shortclip","shortclips":true}',0,'92800000-0000-4000-8002-000000000002');
select public.admin_save_goods_media_settings('{"priority":"shortclip","shortclips":true}',0,'92800000-0000-4000-8002-000000000002');
select pg_temp.expect_media_error($q$select public.admin_save_goods_media_settings('{"priority":"video","shortclips":true}',0,gen_random_uuid())$q$,'PT409');
select pg_temp.expect_media_error($q$select public.admin_save_goods_media_settings('{"priority":"live","shortclips":true}',1,gen_random_uuid())$q$,'invalid_goods_media_settings');
reset role;
select 1/case when (select count(*) from audit_log where id='92800000-0000-4000-8002-000000000001')=1 then 1 else 0 end as media_once_receipt;
select 1/case when not public.service_cancel_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001') then 1 else 0 end as attached_not_canceled;
set local role anon;
select 1/case when public.get_good_media('media-test-1')#>>'{video,title}'='검증 동영상' and public.get_good_media('media-test-1')#>>'{settings,priority}'='shortclip'
 and position('actorId' in public.get_good_media('media-test-1')::text)=0 then 1 else 0 end as public_bound_media_only;
reset role;
update public.goods set published_at=null where id='media-test-1';
select 1/case when public.get_good_media('media-test-1') is null then 1 else 0 end as unpublished_gate;
select pg_temp.publish_goods_kc_fixture('media-test-1');
update public.ips set published_at=null where id='media-test-ip';
select 1/case when public.get_good_media('media-test-1') is null then 1 else 0 end as ip_gate;
update public.ips set published_at=now() where id='media-test-ip';
select set_config('request.jwt.claim.sub','92800000-0000-4000-8000-000000000001',true);
select public.admin_save_good_media('media-test-2','{"video":null,"shortclip":null}',0,'92800000-0000-4000-8002-000000000004');
update public.goods set id='media-test-draft-renamed' where id='media-test-2';
select 1/case when private.good_media_snapshot('media-test-draft-renamed')->>'revision'='1' and private.good_media_snapshot('media-test-2') is null then 1 else 0 end as draft_good_id_cascade;
-- Role contract: read and writes use current capabilities, including ordinary users.
do $$declare n integer;begin
 for n in 1..7 loop
  perform set_config('request.jwt.claim.sub',('92800000-0000-4000-8000-'||lpad(n::text,12,'0')),true);
  if private.has_operator_capability(auth.uid(),'catalog.manage',false) then perform public.admin_get_good_media('media-test-1');else perform pg_temp.expect_media_error('select public.admin_get_good_media(''media-test-1'')','42501');end if;
  if private.has_operator_capability(auth.uid(),'store.manage',false) then perform public.admin_get_goods_media_settings();else perform pg_temp.expect_media_error('select public.admin_get_goods_media_settings()','42501');end if;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','92800000-0000-4000-8000-000000000001',true);
select public.admin_save_good_media('media-test-1','{"video":null,"shortclip":null}',1,'92800000-0000-4000-8002-000000000003');
select 1/case when (select count(*) from private.goods_media_assets where id::text like '92800000-0000-4000-8001-%' and status='retired' and expires_at>now()+interval '6 days')=2 then 1 else 0 end as unlink_retention;
update private.goods_media_assets set expires_at=now()-interval '1 minute' where id::text like '92800000-0000-4000-8001-%';
select public.service_claim_goods_media_cleanup(50) as media_cleanup_candidates \gset
select 1/case when jsonb_array_length(:'media_cleanup_candidates'::jsonb)>=2
 and (select count(*) from private.goods_media_assets where id::text like '92800000-0000-4000-8001-%' and status='cleanup')=2 then 1 else 0 end as cleanup_reservation;
select pg_temp.expect_media_error(format('select public.admin_save_good_media(%L,%L,2,gen_random_uuid())','media-test-1',:'selected_media'),'goods_media_asset_unavailable');
select 1/case when public.service_complete_goods_media_cleanup('92800000-0000-4000-8001-000000000001','all') then 1 else 0 end as cleaned_after_storage_success;
-- A public Storage object can arrive after cleanup and profile deletion.
-- The immutable claim path remains sufficient evidence even without an owner.
update private.goods_media_assets set actor_id=null where id='92800000-0000-4000-8001-000000000001';
select 1/case when not public.service_cancel_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000001') then 1 else 0 end as ownerless_cancel_denied;
select 1/case when exists(select 1 from jsonb_array_elements(public.service_claim_goods_media_cleanup(50)) a where a->>'id'='92800000-0000-4000-8001-000000000001' and a->>'mode'='all') then 1 else 0 end as late_ownerless_object_reserved_again;
select public.service_complete_goods_media_cleanup('92800000-0000-4000-8001-000000000002','all');
select 1/case when public.service_cancel_goods_media_upload('92800000-0000-4000-8000-000000000001','92800000-0000-4000-8001-000000000002') then 1 else 0 end as late_owned_cancel_reopens_cleanup;
select 1/case when (select status='rejected' from private.goods_media_assets where id='92800000-0000-4000-8001-000000000002') then 1 else 0 end as late_owned_cleanup_reserved;
-- Deleting a long-attached draft starts seven days of retirement now.
insert into public.goods(id,ip_id,name,type,price) values('media-test-deleted','media-test-ip','삭제 검증','문구',1000);
insert into private.goods_media_assets(id,actor_id,kind,path,source_size,status,expires_at,metadata,attached_at,staging_cleaned_at)
 values('92800000-0000-4000-8001-000000000003','92800000-0000-4000-8000-000000000001','video','video/92800000-0000-4000-8001-000000000003.mp4',4001,'attached',now()-interval '20 days',:'media_metadata',now()-interval '30 days',now());
insert into private.goods_media_bindings(good_id,video_asset_id,video_title) values('media-test-deleted','92800000-0000-4000-8001-000000000003','삭제 영상');
delete from public.goods where id='media-test-deleted';
select 1/case when (select status='retired' and expires_at>clock_timestamp()+interval '6 days 23 hours' from private.goods_media_assets where id='92800000-0000-4000-8001-000000000003') then 1 else 0 end as deleted_binding_retirement_from_now;
rollback;
