-- Only fixed internal destinations can appear in the public store navigation.
create function private.store_navigation_valid(settings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare entry jsonb; ids text[]:='{}'; label text;
begin
  if jsonb_typeof(settings) is distinct from 'array' then return false; end if;
  if jsonb_array_length(settings)<>7 then return false; end if;
  for entry in select value from jsonb_array_elements(settings) loop
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    if not entry ?& array['id','label','visible'] or (select count(*) from jsonb_object_keys(entry))<>3
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or entry->>'id' not in ('new','best','shop','iphub','packs','events','community')
      or jsonb_typeof(entry->'label') is distinct from 'string'
      or jsonb_typeof(entry->'visible') is distinct from 'boolean'
      or entry->>'id'=any(ids) then return false; end if;
    label:=entry->>'label';
    if length(label) not between 1 and 20 or label ~ '[[:cntrl:]]'
      or label<>btrim(label,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or (entry->>'id'='shop' and not (entry->>'visible')::boolean) then return false; end if;
    ids:=array_append(ids,entry->>'id');
  end loop;
  return true;
end $$;
revoke all on function private.store_navigation_valid(jsonb) from public,anon,authenticated,service_role;

alter table public.store_settings add column navigation jsonb not null default
  '[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":true},{"id":"events","label":"이벤트","visible":true},{"id":"community","label":"커뮤니티","visible":true}]'::jsonb
  constraint store_settings_navigation_valid check(private.store_navigation_valid(navigation));

create function public.admin_save_store_navigation(target_operation_id uuid,target_values jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved_stamp timestamptz; existing public.audit_log;
begin
  -- Freeze the active administrator role until the settings mutation commits.
  perform 1 from public.profiles where id=actor and role='admin' and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='admin_required'; end if;
  if target_operation_id is null or not private.store_navigation_valid(target_values) then
    raise invalid_parameter_value using message='invalid_store_navigation';
  end if;
  select * into previous from public.store_settings where singleton for update;
  if not found then raise no_data_found using message='store_settings_missing'; end if;
  select * into existing from public.audit_log where id=target_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.store_settings.updated' and existing.target='store_settings:navigation'
      and existing.diff->'after'=target_values then return (existing.diff->>'savedUpdatedAt')::timestamptz; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
  saved_stamp:=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond');
  update public.store_settings set navigation=target_values,updated_at=saved_stamp where singleton;
  insert into public.audit_log(id,actor_id,action,target,diff) values(target_operation_id,actor,'admin.store_settings.updated','store_settings:navigation',
    jsonb_build_object('before',previous.navigation,'after',target_values,'savedUpdatedAt',saved_stamp));
  return saved_stamp;
end $$;
revoke all on function public.admin_save_store_navigation(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_navigation(uuid,jsonb,timestamptz) to authenticated;

-- Hidden labels and internal revision/audit data never reach the public shell.
-- Domain feature gates are applied by the consumer, after this visibility projection.
create function public.get_storefront_navigation()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_agg(jsonb_build_object('id',entry->>'id','label',entry->>'label') order by ordinal)
  from public.store_settings, jsonb_array_elements(navigation) with ordinality item(entry,ordinal)
  where singleton and (entry->>'visible')::boolean;
$$;
revoke all on function public.get_storefront_navigation() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_navigation() to anon,authenticated;
notify pgrst,'reload schema';
