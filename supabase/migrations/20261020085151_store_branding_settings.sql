-- Brand presentation is separate from legally required business information.
create function private.store_branding_valid(settings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare field text; value text; platform text; social jsonb; host_pattern text;
begin
  if jsonb_typeof(settings) is distinct from 'object' then return false; end if;
  if not settings ?& array['displayName','logoMode','logoPath','mobileLogoPath','introduction','showIntroduction','socials']
    or (select count(*) from jsonb_object_keys(settings))<>7 then return false; end if;
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
  foreach field in array array['logoPath','mobileLogoPath'] loop
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

alter table public.store_settings add column branding jsonb not null default
  '{"displayName":"ICONS","logoMode":"text","logoPath":null,"mobileLogoPath":null,"introduction":"","showIntroduction":false,"socials":{"blog":{"enabled":false,"url":""},"facebook":{"enabled":false,"url":""},"instagram":{"enabled":false,"url":""}}}'::jsonb
  constraint store_settings_branding_valid check(private.store_branding_valid(branding));

create function public.admin_save_store_branding(target_operation_id uuid,target_values jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved_stamp timestamptz; existing public.audit_log; asset_path text;
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='admin_required';
  end if;
  if target_operation_id is null or not private.store_branding_valid(target_values) then
    raise invalid_parameter_value using message='invalid_store_branding';
  end if;
  -- A row lock serializes every settings section; a lost response can replay safely.
  select * into previous from public.store_settings where singleton for update;
  select * into existing from public.audit_log where id=target_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.store_settings.updated' and existing.target='store_settings:branding'
      and existing.diff->'after'=target_values then return (existing.diff->>'savedUpdatedAt')::timestamptz; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if expected_updated_at is distinct from previous.updated_at then raise serialization_failure using message='store_settings_conflict'; end if;
  -- Both slots may reuse one asset; old saved slots are already trusted.
  for asset_path in select distinct value from jsonb_each_text(target_values)
    where key in ('logoPath','mobileLogoPath') and value is not null
      and value is distinct from previous.branding->>'logoPath' and value is distinct from previous.branding->>'mobileLogoPath'
  loop
    update public.admin_artwork_upload_claims as claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=substr(asset_path,length('public-media/')+1) and claim.kind='curation'
        and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null
        and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
  end loop;
  saved_stamp:=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond');
  update public.store_settings set branding=target_values,updated_at=saved_stamp where singleton;
  insert into public.audit_log(id,actor_id,action,target,diff) values(target_operation_id,actor,'admin.store_settings.updated','store_settings:branding',
    jsonb_build_object('before',previous.branding,'after',target_values,'savedUpdatedAt',saved_stamp));
  return saved_stamp;
end $$;
revoke all on function public.admin_save_store_branding(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_branding(uuid,jsonb,timestamptz) to authenticated;

-- Never return hidden introductions, disabled SNS URLs or stored text-mode images.
create function public.get_storefront_branding()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('displayName',branding->>'displayName',
    'logoPath',case when branding->>'logoMode'='image' then branding->'logoPath' else 'null'::jsonb end,
    'mobileLogoPath',case when branding->>'logoMode'='image' then branding->'mobileLogoPath' else 'null'::jsonb end,
    'introduction',case when (branding->>'showIntroduction')::boolean then branding->'introduction' else 'null'::jsonb end,
    'socials',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'url',branding->'socials'->platform->>'url') order by sort)
      from unnest(array['blog','facebook','instagram']) with ordinality p(platform,sort)
      where (branding->'socials'->platform->>'enabled')::boolean),'[]'::jsonb))
  from public.store_settings where singleton;
$$;
revoke all on function public.get_storefront_branding() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_branding() to anon,authenticated;
