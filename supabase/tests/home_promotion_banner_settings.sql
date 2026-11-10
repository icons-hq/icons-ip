\set ON_ERROR_STOP on
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_banner_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected banner error: %',expected;end $$;
create function pg_temp.save_banner(op uuid,id uuid,version timestamptz,title text,payload jsonb,
 image text default 'public-media/catalog/curation/95100000-0000-4000-8000-000000000001.webp',link text default null,enabled boolean default true)
returns uuid language sql as $$select public.admin_save_home_curation(op,id,'hero',null,title,image,link,0,'2026-01-01',null,enabled,null,payload,version)$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('95000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','banner-synthetic-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '95000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('95000000-0000-4000-8000-000000000001','primary'),('95000000-0000-4000-8000-000000000002','deputy'),('95000000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/curation/95100000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','95000000-0000-4000-8000-000000000001','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,15)n;
select 1/case when has_function_privilege('authenticated','public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)','execute')
 and not has_function_privilege('service_role','public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)','execute') then 1 else 0 end as new_rpc_acl;
-- No application role can invoke either private helper. Historical postgres
-- wrappers can execute them even when a newer migration owner created them.
select 1/case when bool_and(not has_function_privilege(r,p,'execute')) then 1 else 0 end as helpers_sealed
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array[
 'private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)',
 'private.is_valid_home_hero_alt(jsonb)'])p;
select 1/case when has_function_privilege('postgres','private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)','execute')
 and has_function_privilege('postgres','private.is_valid_home_hero_alt(jsonb)','execute') then 1 else 0 end as old_owner_can_delegate;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.save_banner('95000000-0000-4000-8000-000000000101','95200000-0000-4000-8000-000000000001',null,repeat('😀',40),
 jsonb_build_object('subtitle',repeat('😀',150),'alt_enabled',true,'alt_title',repeat('😀',40),'alt_content',repeat('😀',150),
 'mobile_image_path','public-media/catalog/curation/95100000-0000-4000-8000-000000000002.webp'));
select updated_at as version_one from public.home_curations where id='95200000-0000-4000-8000-000000000001' \gset
select 1/case when char_length(title)=40 and char_length(payload->>'subtitle')=150 and link_path is null
 and payload->>'alt_enabled'='true' and char_length(payload->>'alt_title')=40 and char_length(payload->>'alt_content')=150 then 1 else 0 end as unicode_and_no_link_roundtrip
 from public.home_curations where id='95200000-0000-4000-8000-000000000001';
reset role;
select 1/case when count(*)=2 then 1 else 0 end as both_artwork_claims_consumed from public.admin_artwork_upload_claims
 where path in ('catalog/curation/95100000-0000-4000-8000-000000000001.webp','catalog/curation/95100000-0000-4000-8000-000000000002.webp') and status='attached';
set local role authenticated;
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,repeat('😀',41),null) from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_title');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목',jsonb_build_object('subtitle',repeat('😀',151))) from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_subtitle');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목','{"subtitle":"1\n2\n3\n4"}') from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_subtitle');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목',jsonb_build_object('alt_enabled',true,'alt_title',repeat('😀',41))) from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_alt');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목',jsonb_build_object('alt_enabled',true,'alt_content',repeat('😀',151))) from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_alt');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목','{"alt_enabled":false,"alt_title":"숨은 설명"}') from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_alt');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목','{"alt_enabled":"true"}') from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_alt');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목',jsonb_build_object('alt_enabled',true,'alt_title',E'제목\x01')) from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_hero_alt');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'제목','{"unknown":true}') from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_curation_payload');
-- A current version succeeds, an old version cannot overwrite it, and an exact
-- old receipt never recreates the former text or consumes artwork again.
select pg_temp.save_banner('95000000-0000-4000-8000-000000000102','95200000-0000-4000-8000-000000000001',:'version_one','바뀐 제목','{"alt_enabled":false}');
select updated_at as version_two from public.home_curations where id='95200000-0000-4000-8000-000000000001' \gset
select 1/case when :'version_two'::timestamptz>:'version_one'::timestamptz then 1 else 0 end as saved_version_is_monotonic;
select pg_temp.expect_banner_error(format($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',%L,'뒤늦은 수정',null)$q$,:'version_one'),'PT409');
select pg_temp.save_banner('95000000-0000-4000-8000-000000000101','95200000-0000-4000-8000-000000000001',null,repeat('😀',40),
 jsonb_build_object('subtitle',repeat('😀',150),'alt_enabled',true,'alt_title',repeat('😀',40),'alt_content',repeat('😀',150),
 'mobile_image_path','public-media/catalog/curation/95100000-0000-4000-8000-000000000002.webp'));
select 1/case when title='바뀐 제목' and updated_at=:'version_two' then 1 else 0 end as old_replay_keeps_current_state from public.home_curations where id='95200000-0000-4000-8000-000000000001';
select pg_temp.expect_banner_error(format($q$select pg_temp.save_banner('95000000-0000-4000-8000-000000000102','95200000-0000-4000-8000-000000000001',%L,'다른 요청',null)$q$,:'version_one'),'operation_conflict');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',null,'같은 ID 재생성',null)$q$,'curation_conflict');
-- Empty visible copy and empty alternative text are optional only for banners.
select pg_temp.save_banner('95000000-0000-4000-8000-000000000103','95200000-0000-4000-8000-000000000001',:'version_two','','{"alt_enabled":true}');
reset role;
set local role anon;
select 1/case when title='' and link_path is null and payload='{"alt_enabled":true}' then 1 else 0 end as public_image_only_banner from public.home_curations where id='95200000-0000-4000-8000-000000000001';
reset role;
set local role authenticated;
-- The legacy signature executes through its historical owner, with its original
-- request shape and exact-replay behavior retained.
select public.admin_upsert_home_curation('95000000-0000-4000-8000-000000000104','95200000-0000-4000-8000-000000000002','hero',null,'기존 RPC',
 'public-media/catalog/curation/95100000-0000-4000-8000-000000000003.webp','/shop',1,'2026-01-01',null,false,null,null);
select public.admin_upsert_home_curation('95000000-0000-4000-8000-000000000104','95200000-0000-4000-8000-000000000002','hero',null,'기존 RPC',
 'public-media/catalog/curation/95100000-0000-4000-8000-000000000003.webp','/shop',1,'2026-01-01',null,false,null,null);
select pg_temp.expect_banner_error($q$select public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'announcement',null,'',null,'/shop',0,now(),null,true)$q$,'invalid_curation_title');
select pg_temp.expect_banner_error($q$select public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'announcement',null,'공지',null,null,0,now(),null,true)$q$,'invalid_curation_link_path');
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'링크',null,'public-media/catalog/curation/95100000-0000-4000-8000-000000000001.webp','//evil.test') from public.home_curations where id='95200000-0000-4000-8000-000000000001'$q$,'invalid_curation_link_path');
-- Capability loss blocks fresh writes and both exact replay APIs.
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id='95000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_banner_error(format($q$select pg_temp.save_banner('95000000-0000-4000-8000-000000000102','95200000-0000-4000-8000-000000000001',%L,'바뀐 제목','{"alt_enabled":false}')$q$,:'version_one'),'operator_capability_required');
select pg_temp.expect_banner_error($q$select public.admin_upsert_home_curation('95000000-0000-4000-8000-000000000104','95200000-0000-4000-8000-000000000002','hero',null,'기존 RPC','public-media/catalog/curation/95100000-0000-4000-8000-000000000003.webp','/shop',1,'2026-01-01',null,false,null,null)$q$,'operator_capability_required');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id='95000000-0000-4000-8000-000000000001';
set local role authenticated;
-- Fill the remaining slots; no pre-existing banner is changed or deleted.
do $$declare n integer;remaining integer;begin
 select 10-count(*) into remaining from public.home_curations where kind='hero';
 for n in 1..remaining loop
  perform pg_temp.save_banner(('95000000-0000-4000-8200-'||lpad(n::text,12,'0'))::uuid,('95200000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,null,'비노출 '||n,null,
    'public-media/catalog/curation/95100000-0000-4000-8000-'||lpad((n+3)::text,12,'0')||'.webp',null,false);
 end loop;
end$$;
select 1/case when count(*)=10 then 1 else 0 end as inactive_rows_count_toward_cap from public.home_curations where kind='hero';
select pg_temp.expect_banner_error($q$select pg_temp.save_banner(gen_random_uuid(),gen_random_uuid(),null,'11번째',null,'public-media/catalog/curation/95100000-0000-4000-8000-000000000015.webp')$q$,'home_hero_limit');
select pg_temp.save_banner(gen_random_uuid(),'95200000-0000-4000-8000-000000000001',updated_at,'한도에서도 수정 가능',null,
 'public-media/catalog/curation/95100000-0000-4000-8000-000000000001.webp',null,false) from public.home_curations where id='95200000-0000-4000-8000-000000000001';
reset role;
select pg_temp.expect_banner_error($q$insert into public.home_curations(id,kind,title,image_path,link_path,active_from) values(gen_random_uuid(),'hero','직접 추가','public-media/catalog/curation/95100000-0000-4000-8000-000000000015.webp',null,now())$q$,'home_hero_limit');
set local role anon;
select 1/case when count(*)=0 then 1 else 0 end as disabled_banners_are_not_public from public.home_curations where id::text like '95200000-%';
reset role;
rollback;
