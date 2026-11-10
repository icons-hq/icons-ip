\set ON_ERROR_STOP on
begin;
-- This test also runs against an owned QA DB with existing browser fixtures.
update public.store_settings set branding=default where singleton;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000016001','authenticated','authenticated','brand-admin@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000016002','authenticated','authenticated','brand-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000016003','authenticated','authenticated','brand-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000016001';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000016002';
-- Explicit authority makes this fixture valid after operator membership rollout.
insert into private.operator_memberships(profile_id,manager_role) values ('00000000-0000-4000-8000-000000016001','primary'),('00000000-0000-4000-8000-000000016002','logistics');
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at) values
('catalog/curation/00000000-0000-4000-8000-000000016001.png','00000000-0000-4000-8000-000000016001','curation','image/png',100,100,'verified',now()+interval '1 hour',now(),now()),
('catalog/curation/00000000-0000-4000-8000-000000016002.png','00000000-0000-4000-8000-000000016002','curation','image/png',100,100,'verified',now()+interval '1 hour',now(),now()),
('catalog/curation/00000000-0000-4000-8000-000000016003.png','00000000-0000-4000-8000-000000016001','curation','image/png',100,100,'verified',now()-interval '1 second',now(),now());
select 1 / case when not has_function_privilege('anon','public.admin_save_store_branding(uuid,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_store_branding(uuid,jsonb,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.store_branding_valid(jsonb)','execute')
  and not has_table_privilege('authenticated','public.store_settings','update') then 1 else 0 end as assert_sealed_writes;
set local role anon;
select 1 / case when public.get_storefront_branding()='{ "displayName":"ICONS","logoPath":null,"mobileLogoPath":null,"introduction":null,"socials":[] }'::jsonb then 1 else 0 end as assert_public_default;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000016002',true);
select 1 / case when not exists(select 1 from public.store_settings) then 1 else 0 end as assert_logistics_no_private_settings;
do $$ begin
  perform public.admin_save_store_branding(gen_random_uuid(),'{}',null); raise exception 'staff write accepted';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000016003',true);
select 1 / case when not exists(select 1 from public.store_settings) then 1 else 0 end as assert_buyer_no_settings;
do $$ begin
  perform public.admin_save_store_branding(gen_random_uuid(),'{}',null); raise exception 'buyer write accepted';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000016001',true);
do $$ declare initial public.store_settings; payload jsonb; invalid jsonb; saved timestamptz; repeat_stamp timestamptz; asset text;
begin
  select * into initial from public.store_settings;
  payload:=initial.branding || '{"displayName":"합성 브랜드","introduction":"공개 소개","showIntroduction":true}'::jsonb;
  payload:=jsonb_set(payload,'{socials,instagram}','{"enabled":true,"url":"https://www.instagram.com/synthetic/"}');
  payload:=jsonb_set(payload,'{socials,facebook}','{"enabled":false,"url":"https://www.facebook.com/hidden/"}');
  foreach invalid in array array[
    '{}'::jsonb, payload-'logoPath',payload||'{"business":"leak"}',jsonb_set(payload,'{showIntroduction}','"true"'),
    jsonb_set(payload,'{displayName}','" "'),jsonb_set(payload,'{displayName}',to_jsonb(repeat('가',31))),
    jsonb_set(payload,'{introduction}',to_jsonb(repeat('가',51))),jsonb_set(payload,'{introduction}',to_jsonb(E'hello\nworld'::text)),
    jsonb_set(payload,'{introduction}',to_jsonb(U&'\00A0'::text)),jsonb_set(payload,'{introduction}','""'),
    jsonb_set(payload,'{logoMode}','"image"'),jsonb_set(payload,'{logoPath}','"https://attacker.example.test/a.png"'),
    jsonb_set(payload,'{socials,instagram,url}','"javascript:alert(1)"'),jsonb_set(payload,'{socials,instagram,url}','"https://instagram.com.evil.test/"'),
    jsonb_set(payload,'{socials,instagram,url}','"https://instagram.com@evil.test/"'),jsonb_set(payload,'{socials,instagram,url}','"https://evil.test/"'),
    jsonb_set(payload,'{socials,instagram,url}','""'),jsonb_set(payload,'{socials,instagram,url}','"http://instagram.com/"'),
    jsonb_set(payload,'{socials,instagram,url}','"https://instagram.com:9999/"'),jsonb_set(payload,'{socials,instagram,enabled}','"true"'),
    jsonb_set(payload,'{socials,instagram,secret}','true'),jsonb_set(payload,'{socials}',(payload->'socials')-'blog')
  ] loop
    begin
      perform public.admin_save_store_branding(gen_random_uuid(),invalid,initial.updated_at); raise exception 'invalid settings accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  saved:=public.admin_save_store_branding('10000000-0000-4000-8000-000000016001',payload,initial.updated_at);
  repeat_stamp:=public.admin_save_store_branding('10000000-0000-4000-8000-000000016001',payload,initial.updated_at);
  if saved<>repeat_stamp then raise exception 'replay changed stamp'; end if;
  if (select count(*) from public.admin_store_settings_history(50) where target='store_settings:branding' and diff->'after'=payload)<>1 then raise exception 'duplicate/missing audit'; end if;
  if public.get_storefront_settings() ? 'branding' then raise exception 'legal contract changed'; end if;
  if public.get_storefront_branding() <> '{"displayName":"합성 브랜드","logoPath":null,"mobileLogoPath":null,"introduction":"공개 소개","socials":[{"platform":"instagram","url":"https://www.instagram.com/synthetic/"}]}'::jsonb then raise exception 'public projection mismatch'; end if;
  begin
    perform public.admin_save_store_branding('10000000-0000-4000-8000-000000016001',payload||'{"displayName":"changed"}',saved); raise exception 'operation reused';
  exception when unique_violation then null; end;
  begin
    perform public.admin_save_store_branding(gen_random_uuid(),payload,initial.updated_at); raise exception 'stale settings accepted';
  exception when sqlstate 'PT409' then null; end;
  -- Claim ownership, expiry and rollback are checked before saving the row.
  foreach asset in array array['00000000-0000-4000-8000-000000016002','00000000-0000-4000-8000-000000016003','00000000-0000-4000-8000-000000016004'] loop
    begin
      perform public.admin_save_store_branding(gen_random_uuid(),payload||jsonb_build_object('logoMode','image','logoPath','public-media/catalog/curation/'||asset||'.png'),saved);
      raise exception 'unverified image accepted';
    exception when check_violation then null; end;
  end loop;
  payload:=payload||'{"logoMode":"image","logoPath":"public-media/catalog/curation/00000000-0000-4000-8000-000000016001.png","mobileLogoPath":"public-media/catalog/curation/00000000-0000-4000-8000-000000016001.png"}'::jsonb;
  saved:=public.admin_save_store_branding('10000000-0000-4000-8000-000000016002',payload,saved);
  if public.get_storefront_branding()->>'mobileLogoPath'<>payload->>'logoPath' then raise exception 'mobile logo lost'; end if;
  -- An already saved asset remains trusted when moving between the two slots.
  payload:=payload||'{"mobileLogoPath":null,"showIntroduction":false}'::jsonb;
  saved:=public.admin_save_store_branding(gen_random_uuid(),payload,saved);
  if public.get_storefront_branding()->'introduction'<>'null'::jsonb then raise exception 'hidden introduction leaked'; end if;
  payload:=payload||'{"logoMode":"text"}'::jsonb;
  perform public.admin_save_store_branding(gen_random_uuid(),payload,saved);
  if public.get_storefront_branding()->'logoPath'<>'null'::jsonb then raise exception 'hidden image leaked'; end if;
end $$;
reset role;
select 1 / case when (select status='attached' and attached_at is not null from public.admin_artwork_upload_claims where path='catalog/curation/00000000-0000-4000-8000-000000016001.png') then 1 else 0 end as assert_claim_consumed_once;
update public.profiles set suspended_at=now(),suspension_reason='test' where id='00000000-0000-4000-8000-000000016001';
set local role authenticated;
do $$ begin
  perform public.admin_save_store_branding(gen_random_uuid(),'{}',null); raise exception 'suspended admin accepted';
exception when insufficient_privilege then null; end $$;
rollback;
