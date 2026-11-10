\set ON_ERROR_STOP on
begin;
update public.store_settings set branding=default where singleton;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000026001','authenticated','authenticated','profile-admin@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000026002','authenticated','authenticated','profile-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id in ('00000000-0000-4000-8000-000000026001','00000000-0000-4000-8000-000000026002');
insert into private.operator_memberships(profile_id,manager_role) values ('00000000-0000-4000-8000-000000026001','primary'),('00000000-0000-4000-8000-000000026002','primary');
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,status,expires_at,processing_started_at)
select 'catalog/curation/00000000-0000-4000-8000-'||lpad((26000+i)::text,12,'0')||'.png',
  '00000000-0000-4000-8000-000000026001','curation','image/png',100,'processing',now()+interval '1 hour',now()
from generate_series(1,10) i;
select 1/case when not has_function_privilege('anon','public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)','execute')
 and not has_function_privilege('authenticated','public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)','execute')
 and has_function_privilege('service_role','public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)','execute')
 and not has_table_privilege('authenticated','public.admin_artwork_upload_claims','update') then 1 else 0 end as sealed_dimension_claims;
set local role service_role;
select 1/case when public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026001.png',100,160,160) then 1 else 0 end as verify_square;
select 1/case when public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026002.png',100,159,159) then 1 else 0 end as verify_small;
select 1/case when public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026003.png',100,160,161) then 1 else 0 end as verify_rectangle;
select 1/case when public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026004.png',100) then 1 else 0 end as verify_legacy;
select 1/case when not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026005.png',100,null,160)
 and not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026005.png',100,8193,160)
 and not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026005.png',100,8192,8192)
 and not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026002','catalog/curation/00000000-0000-4000-8000-000000026005.png',100,160,160)
 then 1 else 0 end as invalid_dimensions_or_actor_do_not_verify;
select 1/case when public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026006.png',100,1300,1300)
 and public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026007.png',100,160,160)
 and public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026008.png',100,160,160) then 1 else 0 end as verify_extra;
reset role;
update public.admin_artwork_upload_claims set expires_at=now()-interval '1 second' where path='catalog/curation/00000000-0000-4000-8000-000000026007.png';
update public.admin_artwork_upload_claims set actor_id='00000000-0000-4000-8000-000000026002' where path='catalog/curation/00000000-0000-4000-8000-000000026008.png';
select 1/case when (select final_width=160 and final_height=160 from public.admin_artwork_upload_claims where path='catalog/curation/00000000-0000-4000-8000-000000026001.png')
 and (select final_width is null and final_height is null from public.admin_artwork_upload_claims where path='catalog/curation/00000000-0000-4000-8000-000000026004.png')
 and (select status='processing' and final_width is null from public.admin_artwork_upload_claims where path='catalog/curation/00000000-0000-4000-8000-000000026005.png') then 1 else 0 end as dimension_readback;
-- Simulate a receipt created by the original seven-field function before upgrade.
insert into public.audit_log(id,actor_id,action,target,diff)
select '10000000-0000-4000-8000-000000026000','00000000-0000-4000-8000-000000026001','admin.store_settings.updated','store_settings:branding',
 jsonb_build_object('before',branding,'after',branding,'savedUpdatedAt',updated_at) from public.store_settings where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000026001',true);
do $$ declare initial public.store_settings; payload jsonb; legacy jsonb; saved timestamptz; next_stamp timestamptz; old_stamp timestamptz;
 original_public jsonb; asset text; profile_one text:='public-media/catalog/curation/00000000-0000-4000-8000-000000026001.png';
 profile_two text:='public-media/catalog/curation/00000000-0000-4000-8000-000000026006.png';
begin
 select * into initial from public.store_settings;legacy:=initial.branding;original_public:=public.get_storefront_branding();
 -- Fresh profile binding rejects old metadata, size/shape errors, expiry and ownership.
 foreach asset in array array['026002','026003','026004','026005','026007','026008','026099'] loop
  begin
   perform public.admin_save_store_branding(gen_random_uuid(),legacy||jsonb_build_object('profileImagePath','public-media/catalog/curation/00000000-0000-4000-8000-000000'||asset||'.png'),initial.updated_at);
   raise exception 'invalid profile accepted %',asset;
  exception when check_violation then if sqlerrm<>'invalid_store_profile_image' then raise;end if;end;
 end loop;
 begin
  perform public.admin_save_store_branding(gen_random_uuid(),legacy||'{"profileImagePath":17}',initial.updated_at);raise exception 'invalid profile field accepted';
 exception when invalid_parameter_value then null;end;
 payload:=legacy||jsonb_build_object('profileImagePath',profile_one);
 saved:=public.admin_save_store_branding('10000000-0000-4000-8000-000000026001',payload,initial.updated_at);
 if public.get_storefront_branding()<>original_public then raise exception 'old public shape changed';end if;
 if public.get_storefront_branding_v2()<>original_public||jsonb_build_object('profileImagePath',profile_one) then raise exception 'v2 projection wrong';end if;
 if public.get_storefront_settings() ? 'profileImagePath' then raise exception 'legal data changed';end if;
 -- A seven-field request preserves profile and records its original request separately.
 next_stamp:=public.admin_save_store_branding('10000000-0000-4000-8000-000000026002',legacy,saved);
 if (select branding->>'profileImagePath' from public.store_settings)<>profile_one then raise exception 'legacy caller cleared profile';end if;
 if public.admin_save_store_branding('10000000-0000-4000-8000-000000026002',legacy,saved)<>next_stamp then raise exception 'legacy request replay failed';end if;
 begin
  perform public.admin_save_store_branding('10000000-0000-4000-8000-000000026002',legacy,next_stamp);raise exception 'changed stamp replayed';
 exception when unique_violation then null;end;
 begin
  perform public.admin_save_store_branding('10000000-0000-4000-8000-000000026002',legacy||'{"profileImagePath":null}',saved);raise exception 'changed request replayed';
 exception when unique_violation then null;end;
 begin
  perform public.admin_save_store_branding(gen_random_uuid(),payload,saved);raise exception 'stale row accepted';
 exception when sqlstate 'PT409' then null;end;
 -- One new square claim can be attached to profile and both logos once.
 payload:=legacy||jsonb_build_object('profileImagePath',profile_two,'logoMode','image','logoPath',profile_two,'mobileLogoPath',profile_two);
 next_stamp:=public.admin_save_store_branding(gen_random_uuid(),payload,next_stamp);
 if public.admin_save_store_branding('10000000-0000-4000-8000-000000026001',legacy||jsonb_build_object('profileImagePath',profile_one),initial.updated_at)<>saved then raise exception 'late new receipt replay failed';end if;
 old_stamp:=public.admin_save_store_branding('10000000-0000-4000-8000-000000026000',legacy,initial.updated_at);
 if old_stamp<>initial.updated_at or (select branding->>'profileImagePath' from public.store_settings)<>profile_two then raise exception 'old receipt replay clobbered profile';end if;
 payload:=payload||'{"profileImagePath":null}';
 next_stamp:=public.admin_save_store_branding(gen_random_uuid(),payload,next_stamp);
 if public.get_storefront_branding_v2()->'profileImagePath'<>'null'::jsonb or public.get_storefront_branding()->>'logoPath'<>profile_two then raise exception 'clear changed logo';end if;
 -- Once removed, even a previous profile/logo requires a fresh claim to be selected again.
 begin
  perform public.admin_save_store_branding(gen_random_uuid(),payload||jsonb_build_object('profileImagePath',profile_two),next_stamp);raise exception 'attached logo bypassed fresh profile check';
 exception when check_violation then if sqlerrm<>'invalid_store_profile_image' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000026002',true);
do $$ declare receipt public.audit_log;begin
 select * into receipt from public.audit_log where id='10000000-0000-4000-8000-000000026002';
 perform public.admin_save_store_branding(receipt.id,receipt.diff->'request'->'values',(receipt.diff->'request'->>'expectedUpdatedAt')::timestamptz);
 raise exception 'other actor replayed receipt';
exception when unique_violation then null;end $$;
reset role;
select 1/case when (select count(*)=2 from public.admin_artwork_upload_claims where actor_id='00000000-0000-4000-8000-000000026001' and status='attached') then 1 else 0 end as exactly_two_claims_consumed;
update public.profiles set suspended_at=now(),suspension_reason='test' where id='00000000-0000-4000-8000-000000026001';
set local role service_role;
select 1/case when not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000026001','catalog/curation/00000000-0000-4000-8000-000000026009.png',100,160,160) then 1 else 0 end as suspended_verifier_denied;
reset role;
set local role anon;
select 1/case when public.get_storefront_branding_v2() ? 'profileImagePath' and not public.get_storefront_branding() ? 'profileImagePath' then 1 else 0 end as public_readable_contracts;
rollback;
