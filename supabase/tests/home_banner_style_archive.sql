\set ON_ERROR_STOP on
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_banner_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected banner error: %',expected;end $$;
create function pg_temp.save_banner(op uuid,id uuid,version timestamptz,title text,payload jsonb,
 image text default 'public-media/catalog/curation/96100000-0000-4000-8000-000000000001.webp',link text default null,enabled boolean default true)
returns uuid language sql as $$select public.admin_save_home_curation(op,id,'hero',null,title,image,link,0,'2026-01-01',null,enabled,null,payload,version)$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','banner-archive-synthetic-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '96000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('96000000-0000-4000-8000-000000000001','primary'),('96000000-0000-4000-8000-000000000002','deputy'),('96000000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/curation/96100000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','96000000-0000-4000-8000-000000000001','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,15)n;
select 1/case when has_function_privilege('authenticated','public.admin_set_home_banner_archived(uuid,uuid,timestamptz,boolean)','execute')
 and not has_function_privilege('anon','public.admin_set_home_banner_archived(uuid,uuid,timestamptz,boolean)','execute')
 and not has_function_privilege('service_role','public.admin_set_home_banner_archived(uuid,uuid,timestamptz,boolean)','execute')
 and not has_function_privilege('authenticated','private.is_valid_home_hero_style(jsonb)','execute') then 1 else 0 end as sealed_archive_acl;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- Missing keys keep their old request shape, and each explicit enum roundtrips.
select pg_temp.save_banner('96000000-0000-4000-8000-000000000101','96200000-0000-4000-8000-000000000001',null,'기존 배너',
 '{"subtitle":"기존 부제","mobile_image_path":"public-media/catalog/curation/96100000-0000-4000-8000-000000000002.webp"}');
select updated_at as original_version from public.home_curations where id='96200000-0000-4000-8000-000000000001' \gset
do $$declare dim text;color text;begin
 foreach dim in array array['none','white','black'] loop foreach color in array array['white','black'] loop
 perform pg_temp.save_banner(gen_random_uuid(),'96200000-0000-4000-8000-000000000001',updated_at,'기존 배너',jsonb_build_object('image_dim',dim,'text_color',color))
 from public.home_curations where id='96200000-0000-4000-8000-000000000001';
 if not exists(select 1 from public.home_curations where id='96200000-0000-4000-8000-000000000001' and payload=jsonb_build_object('image_dim',dim,'text_color',color)) then raise exception 'style roundtrip';end if;
 end loop;end loop;
 foreach dim in array array['{"image_dim":"gray"}','{"image_dim":null}','{"image_dim":false}','{"text_color":42}','{"text_color":"red"}'] loop
 perform pg_temp.expect_banner_error(format('select pg_temp.save_banner(gen_random_uuid(),%L,updated_at,%L,%L::jsonb) from public.home_curations where id=%L',
 '96200000-0000-4000-8000-000000000001','기존 배너',dim,'96200000-0000-4000-8000-000000000001'),'invalid_hero_style');
 end loop;
end$$;
select pg_temp.expect_banner_error($q$select public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'announcement',null,'잘못된 타입',null,'/shop',0,now(),null,true,null,'{"image_dim":"white"}')$q$,'invalid_curation_payload');
-- Preserve the current payload and both attached claims throughout archive/restore.
select pg_temp.save_banner('96000000-0000-4000-8000-000000000102','96200000-0000-4000-8000-000000000001',updated_at,'보관할 배너',
 '{"image_dim":"white","text_color":"black","mobile_image_path":"public-media/catalog/curation/96100000-0000-4000-8000-000000000003.webp"}')
 from public.home_curations where id='96200000-0000-4000-8000-000000000001';
select updated_at as saved_version from public.home_curations where id='96200000-0000-4000-8000-000000000001' \gset
reset role;
create temp table layout_before as select to_jsonb(l) as content from public.home_layout_settings l;
create temp table banner_before as select to_jsonb(c)-array['enabled','archived_at','updated_at'] as content from public.home_curations c where id='96200000-0000-4000-8000-000000000001';
create temp table claims_before as select path,to_jsonb(c) as content from public.admin_artwork_upload_claims c where actor_id='96000000-0000-4000-8000-000000000001';
create temp table receipts_before as select id,to_jsonb(a) as content from public.audit_log a where id::text like '96000000-%';
set local role authenticated;
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000201','96200000-0000-4000-8000-000000000001',:'saved_version',true);
select updated_at as archived_version from public.home_curations where id='96200000-0000-4000-8000-000000000001' \gset
select 1/case when archived_at is not null and not enabled and updated_at>:'saved_version' then 1 else 0 end as archived_and_versioned from public.home_curations where id='96200000-0000-4000-8000-000000000001';
-- The exact pre-archive receipt succeeds without recreating or changing the row.
select pg_temp.save_banner('96000000-0000-4000-8000-000000000101','96200000-0000-4000-8000-000000000001',null,'기존 배너',
 '{"subtitle":"기존 부제","mobile_image_path":"public-media/catalog/curation/96100000-0000-4000-8000-000000000002.webp"}');
select pg_temp.expect_banner_error(format($q$select pg_temp.save_banner(gen_random_uuid(),'96200000-0000-4000-8000-000000000001',%L,'금지',null)$q$,:'archived_version'),'curation_archived');
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000201','96200000-0000-4000-8000-000000000001',:'saved_version',true);
select pg_temp.expect_banner_error(format($q$select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000201','96200000-0000-4000-8000-000000000001',%L,false)$q$,:'saved_version'),'operation_conflict');
reset role;
select 1/case when private.goods_photo_references('public-media/catalog/curation/96100000-0000-4000-8000-000000000001.webp') @> '[{"id":"96200000-0000-4000-8000-000000000001","kind":"curation"}]' and private.goods_photo_references('public-media/catalog/curation/96100000-0000-4000-8000-000000000003.webp') @> '[{"id":"96200000-0000-4000-8000-000000000001","kind":"curation"}]' then 1 else 0 end as archived_pc_and_mobile_references_retained;
set local role anon;
select 1/case when count(*)=0 then 1 else 0 end as archive_not_public from public.home_curations where id='96200000-0000-4000-8000-000000000001';
reset role;
-- Revocation precedes receipt lookup.
update private.operator_memberships set manager_role='logistics' where profile_id='96000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_banner_error(format($q$select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000201','96200000-0000-4000-8000-000000000001',%L,true)$q$,:'saved_version'),'operator_capability_required');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id='96000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_banner_error(format($q$select public.admin_set_home_banner_archived(gen_random_uuid(),'96200000-0000-4000-8000-000000000001',%L,false)$q$,:'saved_version'),'curation_conflict');
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000202','96200000-0000-4000-8000-000000000001',:'archived_version',false);
select updated_at as restored_version from public.home_curations where id='96200000-0000-4000-8000-000000000001' \gset
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000201','96200000-0000-4000-8000-000000000001',:'saved_version',true);
select 1/case when archived_at is null and not enabled and updated_at=:'restored_version' then 1 else 0 end as old_archive_receipt_does_not_rearchive from public.home_curations where id='96200000-0000-4000-8000-000000000001';
reset role;
select 1/case when (to_jsonb(c)-array['enabled','archived_at','updated_at'])=b.content then 1 else 0 end as preserved_banner_content from public.home_curations c cross join banner_before b where c.id='96200000-0000-4000-8000-000000000001';
select 1/case when bool_and(to_jsonb(c)=b.content) then 1 else 0 end as preserved_artwork_claims from public.admin_artwork_upload_claims c join claims_before b using(path);
select 1/case when bool_and(to_jsonb(a)=b.content) then 1 else 0 end as preserved_old_receipts from public.audit_log a join receipts_before b using(id);
set local role authenticated;
-- Only live registration slots count; restoring at ten fails atomically.
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000203','96200000-0000-4000-8000-000000000001',:'restored_version',true);
select updated_at as archived_again_version from public.home_curations where id='96200000-0000-4000-8000-000000000001' \gset
do $$declare n integer;remaining integer;begin
 select 10-count(*) into remaining from public.home_curations where kind='hero' and archived_at is null;
 for n in 1..remaining loop
 perform pg_temp.save_banner(gen_random_uuid(),('96200000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,null,'비노출 '||n,null,
 'public-media/catalog/curation/96100000-0000-4000-8000-'||lpad((n+3)::text,12,'0')||'.webp',null,false);
 end loop;
end$$;
select pg_temp.expect_banner_error(format($q$select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000204','96200000-0000-4000-8000-000000000001',%L,false)$q$,:'archived_again_version'),'home_hero_limit');
select 1/case when archived_at is not null and not enabled and updated_at=:'archived_again_version' then 1 else 0 end as cap_failure_keeps_archive from public.home_curations where id='96200000-0000-4000-8000-000000000001';
select public.admin_set_home_banner_archived(gen_random_uuid(),id,updated_at,true) from public.home_curations where id='96200000-0000-4000-8100-000000000001';
select public.admin_set_home_banner_archived('96000000-0000-4000-8000-000000000204','96200000-0000-4000-8000-000000000001',:'archived_again_version',false);
select 1/case when count(*)=10 then 1 else 0 end as restore_reuses_freed_slot from public.home_curations where kind='hero' and archived_at is null;
reset role;
select 1/case when count(*)=1 then 1 else 0 end as cap_retry_one_receipt from public.audit_log where id='96000000-0000-4000-8000-000000000204';
select 1/case when (select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.home_layout_settings l)=(select coalesce(jsonb_agg(content),'[]') from layout_before) then 1 else 0 end as layout_order_unchanged;
rollback;
