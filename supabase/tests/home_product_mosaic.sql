\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000013501','authenticated','authenticated','mosaic-staff@example.test','{}','{}'),
 ('00000000-0000-4000-8000-000000013502','authenticated','authenticated','mosaic-user@example.test','{}','{}');
insert into public.profiles(id,email,nickname,birth_date,consents,onboarded_at,role) values
 ('00000000-0000-4000-8000-000000013501','mosaic-staff@example.test','mosaic_staff','2000-01-01','{"terms":true,"privacy":true}',now(),'staff'),
 ('00000000-0000-4000-8000-000000013502','mosaic-user@example.test','mosaic_user','2000-01-01','{"terms":true,"privacy":true}',now(),'user')
on conflict(id) do update set role=excluded.role;

create function pg_temp.mosaic_payload(image text default null) returns jsonb language sql as $$
 select jsonb_build_object('mosaic_title','추천상품','mosaic_subtitle','이번 주 상품','slots',
  (select jsonb_agg(jsonb_build_object('good_id',case when i in (1,6) then 'g1' else null end,
    'image_path',case when i in (1,6) then image else null end) order by i) from generate_series(1,8) i))
$$;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at) values
 ('catalog/curation/00000000-0000-4000-8000-000000013511.png','00000000-0000-4000-8000-000000013501','curation','image/png',900*1024,900*1024,'verified',now()+interval '1 hour',now(),now()),
 ('catalog/curation/00000000-0000-4000-8000-000000013512.png','00000000-0000-4000-8000-000000013501','curation','image/png',900*1024+1,100,'verified',now()+interval '1 hour',now(),now()),
 ('catalog/curation/00000000-0000-4000-8000-000000013513.png','00000000-0000-4000-8000-000000013501','curation','image/png',100,900*1024+1,'verified',now()+interval '1 hour',now(),now()),
 ('catalog/curation/00000000-0000-4000-8000-000000013514.png','00000000-0000-4000-8000-000000013502','curation','image/png',100,100,'verified',now()+interval '1 hour',now(),now());

select 1/case when not has_function_privilege('anon','public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.guard_home_mosaic_artwork()','execute') then 1 else 0 end as assert_acl;

do $$ declare p jsonb:=pg_temp.mosaic_payload(); candidate jsonb;
begin
 if not private.is_valid_home_mosaic(p) then raise exception 'valid slots rejected'; end if;
 foreach candidate in array array[
   null::jsonb,p||'{"extra":true}',p||'{"mosaic_title":"12345678901"}',p||'{"mosaic_subtitle":"123456789012345678901"}',
   p||'{"slots":[]}',jsonb_set(p,'{slots}',(p->'slots')-0),jsonb_set(p,'{slots}',(p->'slots')||jsonb_build_array(p->'slots'->0)),
   jsonb_set(p,'{slots,0,good_id}','123'),jsonb_set(p,'{slots,0,image_path}','"https://evil.test/image.png"'),
   jsonb_set(p,'{slots,0}','{"good_id":null}'),jsonb_set(p,'{slots,0}','{"good_id":null,"image_path":null,"extra":true}')
 ] loop
   if private.is_valid_home_mosaic(candidate) then raise exception 'invalid mosaic accepted: %',candidate; end if;
 end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013502',true);
do $$ begin
 begin
  perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'구성',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.mosaic_payload());
  raise exception 'buyer writer accepted';
 exception when insufficient_privilege then if sqlerrm not in ('forbidden','operator_capability_required') then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013501',true);

do $$ declare image text; expected text;
begin
 foreach image in array array['00000000-0000-4000-8000-000000013512','00000000-0000-4000-8000-000000013513','00000000-0000-4000-8000-000000013514','00000000-0000-4000-8000-000000013515'] loop
  expected:=case when right(image,2) in ('12','13') then 'mosaic_image_too_large' else 'unverified_artwork' end;
  begin
   perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'거절',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.mosaic_payload('public-media/catalog/curation/'||image||'.png'));
   raise exception 'invalid image accepted';
  exception when check_violation then if sqlerrm<>expected then raise; end if; end;
 end loop;
end $$;

select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013521','00000000-0000-4000-8000-000000013531',
 'product_mosaic',null,'합성 모자이크',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.mosaic_payload('public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png'));
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013521','00000000-0000-4000-8000-000000013531',
 'product_mosaic',null,'합성 모자이크',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.mosaic_payload('public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png'));
-- Two slots sharing one upload consume it once; existing paths can move slots.
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013522','00000000-0000-4000-8000-000000013531',
 'product_mosaic',null,'슬롯 이동',null,'/shop',0,'2020-01-01',null,true,null,
 jsonb_set(jsonb_set(pg_temp.mosaic_payload('public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png'),'{slots,0}',pg_temp.mosaic_payload()->'slots'->1),'{slots,7}',pg_temp.mosaic_payload('public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png')->'slots'->0));

do $$ begin
 begin
  perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'다른 구성',null,'/shop',0,'2020-01-01',null,true,null,pg_temp.mosaic_payload('public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png'));
  raise exception 'attached image reused across curations';
 exception when check_violation then if sqlerrm<>'unverified_artwork' then raise; end if; end;
end $$;
select 1/case when jsonb_array_length(payload->'slots')=8 and payload->'slots'->7->>'image_path'='public-media/catalog/curation/00000000-0000-4000-8000-000000013511.png' then 1 else 0 end as assert_roundtrip from public.home_curations where id='00000000-0000-4000-8000-000000013531';

reset role;
select 1/case when count(*)=2 then 1 else 0 end as assert_audit_once from public.audit_log where target='home_curations:00000000-0000-4000-8000-000000013531';
select 1/case when status='attached' then 1 else 0 end as assert_claim_consumed from public.admin_artwork_upload_claims where path='catalog/curation/00000000-0000-4000-8000-000000013511.png';
select 1/case when bool_and(status='verified') then 1 else 0 end as assert_failed_claim_unchanged from public.admin_artwork_upload_claims where path in ('catalog/curation/00000000-0000-4000-8000-000000013512.png','catalog/curation/00000000-0000-4000-8000-000000013513.png');

set local role authenticated;
do $$ declare i integer;
begin
 for i in 1..4 loop
  perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'빈 구성',null,'/shop',i,'2020-01-01',null,false,null,pg_temp.mosaic_payload());
 end loop;
 begin
  perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'여섯 번째',null,'/shop',5,'2020-01-01',null,false,null,pg_temp.mosaic_payload());
  raise exception 'sixth mosaic accepted';
 exception when check_violation then if sqlerrm<>'home_free_product_limit' then raise; end if; end;
end $$;

select public.admin_save_home_layout(gen_random_uuid(),(select revision from public.home_layout_settings where singleton),
 '[{"key":"mosaic:00000000-0000-4000-8000-000000013531","enabled":true},{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]');
set local role anon;
select 1/case when (public.get_home_layout_order())[1]='mosaic:00000000-0000-4000-8000-000000013531' then 1 else 0 end as assert_public_layout;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='QA suspension' where id='00000000-0000-4000-8000-000000013501';
set local role authenticated;
do $$ begin
 begin
  perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'product_mosaic',null,'정지 거절',null,'/shop',0,'2020-01-01',null,false,null,pg_temp.mosaic_payload());
  raise exception 'suspended staff writer accepted';
 exception when insufficient_privilege then if sqlerrm not in ('forbidden','operator_capability_required') then raise; end if; end;
end $$;
rollback;
