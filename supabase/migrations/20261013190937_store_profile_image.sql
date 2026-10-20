-- Reviewed: a store profile image is separate from PC/mobile logos.
-- Width/height describe the decoded, orientation-normalized public object.
alter table public.admin_artwork_upload_claims
  add column final_width integer,
  add column final_height integer,
  add constraint admin_artwork_final_dimensions_valid check (
    (final_width is null and final_height is null) or
    (final_width is not null and final_height is not null
      and final_width between 1 and 8192 and final_height between 1 and 8192
      and final_width::bigint * final_height::bigint <= 40000000)
  );

-- Preserve the three-argument verifier and its capability/role/claim locks.
-- No defaults: PostgREST resolves old and new payloads without ambiguity.
create function public.service_verify_admin_artwork_upload(
  p_actor_id uuid,p_path text,p_final_size integer,p_final_width integer,p_final_height integer
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_final_width is null or p_final_height is null
    or p_final_width not between 1 and 8192 or p_final_height not between 1 and 8192
    or p_final_width::bigint*p_final_height::bigint>40000000 then return false; end if;
  if not public.service_verify_admin_artwork_upload(p_actor_id,p_path,p_final_size) then return false; end if;
  update public.admin_artwork_upload_claims as claim
    set final_width=p_final_width,final_height=p_final_height
    where claim.actor_id=p_actor_id and claim.path=p_path and claim.status='verified';
  if not found then raise check_violation using message='artwork_dimensions_not_recorded'; end if;
  return true;
end $$;
revoke all on function public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer) to service_role;
select private.register_operator_rpc_contract('public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)'::regprocedure,'catalog.manage','service_start',false);

create or replace function private.store_branding_valid(settings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare field text; value text; platform text; social jsonb; host_pattern text;
begin
  if jsonb_typeof(settings) is distinct from 'object' then return false; end if;
  if not settings ?& array['displayName','logoMode','logoPath','mobileLogoPath','introduction','showIntroduction','socials']
    or (select count(*) from jsonb_object_keys(settings))<>(case when settings ? 'profileImagePath' then 8 else 7 end) then return false; end if;
  foreach field in array array['displayName','introduction'] loop
    if jsonb_typeof(settings->field) is distinct from 'string' then return false; end if;
    value:=settings->>field;
    if value<>btrim(value,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or value ~ '[[:cntrl:]]' or length(value)>(case field when 'displayName' then 30 else 50 end)
      or (field='displayName' and value='') then return false; end if;
  end loop;
  if settings->>'logoMode' not in ('text','image') or jsonb_typeof(settings->'logoMode') is distinct from 'string'
    or jsonb_typeof(settings->'showIntroduction') is distinct from 'boolean' then return false; end if;
  if (settings->>'showIntroduction')::boolean and settings->>'introduction'='' then return false; end if;
  foreach field in array array['logoPath','mobileLogoPath','profileImagePath'] loop
    if settings->field<>'null'::jsonb and (jsonb_typeof(settings->field) is distinct from 'string'
      or settings->>field !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$') then return false; end if;
  end loop;
  if settings->>'logoMode'='image' and settings->'logoPath'='null'::jsonb then return false; end if;
  if jsonb_typeof(settings->'socials') is distinct from 'object' then return false; end if;
  if not (settings->'socials') ?& array['blog','facebook','instagram'] or (select count(*) from jsonb_object_keys(settings->'socials'))<>3 then return false; end if;
  foreach platform in array array['blog','facebook','instagram'] loop
    social:=settings->'socials'->platform;
    if jsonb_typeof(social) is distinct from 'object' then return false; end if;
    if not social ?& array['enabled','url'] or (select count(*) from jsonb_object_keys(social))<>2
      or jsonb_typeof(social->'enabled') is distinct from 'boolean' or jsonb_typeof(social->'url') is distinct from 'string' then return false; end if;
    value:=social->>'url';
    if value='' then
      if (social->>'enabled')::boolean then return false; end if;
    else
      host_pattern:=case platform when 'blog' then '(blog\.naver\.com|m\.blog\.naver\.com)' when 'facebook' then '((www\.|m\.)?facebook\.com)' else '((www\.)?instagram\.com)' end;
      if length(value)>2048 or value ~ '[[:space:][:cntrl:]]' or position(chr(92) in value)>0
        or value !~ ('^https://'||host_pattern||'([/?#].*)?$') then return false; end if;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.store_branding_valid(jsonb) from public,anon,authenticated,service_role;

select private.register_operator_internal_contract('private.store_branding_valid(jsonb)'::regprocedure);

create or replace function public.admin_save_store_branding(target_operation_id uuid,target_values jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved_stamp timestamptz;
  existing public.audit_log; asset_path text; effective_values jsonb; request_values jsonb; profile_path text;
begin
  perform private.require_operator_capability('store.manage',true);
  if actor is null or not public.has_operator_capability('store.manage',true)
    or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'store.manage',true)) then
    raise insufficient_privilege using message='admin_required';
  end if;
  if target_operation_id is null or not private.store_branding_valid(target_values) then
    raise invalid_parameter_value using message='invalid_store_branding';
  end if;
  select * into previous from public.store_settings where singleton for update;
  if not found then raise no_data_found using message='store_settings_missing'; end if;
  request_values:=jsonb_build_object('values',target_values,'expectedUpdatedAt',expected_updated_at);
  select * into existing from public.audit_log where id=target_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.store_settings.updated' and existing.target='store_settings:branding'
      and (case when existing.diff ? 'request' then existing.diff->'request'=request_values
        else existing.diff->'after'=target_values end)
      then return (existing.diff->>'savedUpdatedAt')::timestamptz; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
  -- Legacy seven-key callers cannot erase a profile image they do not know about.
  effective_values:=target_values;
  if not target_values ? 'profileImagePath' and previous.branding ? 'profileImagePath' then
    effective_values:=target_values||jsonb_build_object('profileImagePath',previous.branding->'profileImagePath');
  end if;
  profile_path:=effective_values->>'profileImagePath';
  if profile_path is not null and profile_path is distinct from previous.branding->>'profileImagePath' then
    -- Already attached logos and pre-dimension claims must be uploaded again.
    perform 1 from public.admin_artwork_upload_claims as claim
      where claim.actor_id=actor and claim.path=substr(profile_path,length('public-media/')+1) and claim.kind='curation'
        and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null
        and claim.attached_at is null and claim.expires_at>clock_timestamp()
        and claim.final_width>=160 and claim.final_height=claim.final_width
      for update;
    if not found then raise check_violation using message='invalid_store_profile_image'; end if;
  end if;
  -- Attach a shared fresh image once, even when selected for both logo and profile.
  for asset_path in select distinct value from jsonb_each_text(effective_values)
    where key in ('logoPath','mobileLogoPath','profileImagePath') and value is not null
      and value is distinct from previous.branding->>'logoPath'
      and value is distinct from previous.branding->>'mobileLogoPath'
      and value is distinct from previous.branding->>'profileImagePath'
  loop
    update public.admin_artwork_upload_claims as claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=substr(asset_path,length('public-media/')+1) and claim.kind='curation'
        and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null
        and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
  end loop;
  saved_stamp:=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond');
  update public.store_settings set branding=effective_values,updated_at=saved_stamp where singleton;
  insert into public.audit_log(id,actor_id,action,target,diff) values(target_operation_id,actor,'admin.store_settings.updated','store_settings:branding',
    jsonb_build_object('before',previous.branding,'after',effective_values,'request',request_values,'savedUpdatedAt',saved_stamp));
  return saved_stamp;
end $$;
revoke all on function public.admin_save_store_branding(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_branding(uuid,jsonb,timestamptz) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_store_branding(uuid,jsonb,timestamptz)'::regprocedure,'store.manage','write',true);

-- Preserve the original five-key response for older public clients.
create function public.get_storefront_branding_v2()
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_storefront_branding()||jsonb_build_object('profileImagePath',branding->'profileImagePath')
    from public.store_settings where singleton;
$$;
revoke all on function public.get_storefront_branding_v2() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_branding_v2() to anon,authenticated;
select private.register_operator_internal_contract('public.get_storefront_branding_v2()'::regprocedure);

notify pgrst,'reload schema';
