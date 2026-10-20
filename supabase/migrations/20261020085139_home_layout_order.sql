-- Home layout is independent of the content inside each curation. NULL preserves
-- the previous order until an operator explicitly configures the whole layout.
create function private.is_valid_home_layout_blocks(candidate jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare entry jsonb; block_key text; seen text[] := '{}';
begin
  if candidate is null then return true; end if;
  if pg_catalog.jsonb_typeof(candidate) <> 'array'
    or pg_catalog.jsonb_array_length(candidate) not between 5 and 1000 then return false; end if;
  for entry in select value from pg_catalog.jsonb_array_elements(candidate)
  loop
    if pg_catalog.jsonb_typeof(entry) <> 'object'
      or pg_catalog.jsonb_typeof(entry->'key') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry->'enabled') is distinct from 'boolean'
      or exists(select 1 from pg_catalog.jsonb_object_keys(entry) field where field not in ('key','enabled'))
    then return false; end if;
    block_key := entry->>'key';
    if block_key = any(seen) then return false; end if;
    if block_key not in ('hero','editor_picks','category_best','popular','benefits')
      and block_key !~ '^band:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
    seen := pg_catalog.array_append(seen, block_key);
  end loop;
  return array['hero','editor_picks','category_best','popular','benefits']::text[] <@ seen;
end;
$$;
revoke all on function private.is_valid_home_layout_blocks(jsonb) from public, anon, authenticated, service_role;

create table public.home_layout_settings (
  singleton boolean primary key default true check(singleton),
  blocks jsonb check(private.is_valid_home_layout_blocks(blocks)),
  revision bigint not null default 0 check(revision >= 0),
  updated_at timestamptz not null default now()
);
insert into public.home_layout_settings(singleton) values(true);
alter table public.home_layout_settings enable row level security;
revoke all on public.home_layout_settings from public, anon, authenticated, service_role;
grant select on public.home_layout_settings to authenticated;
create policy home_layout_staff_read on public.home_layout_settings
  for select to authenticated using((select public.is_staff()));

-- Only currently eligible render keys are public. Hidden entries, revision,
-- timestamps and audit data never cross this read boundary.
create function public.get_home_layout_order()
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare configured jsonb; result text[];
begin
  select blocks into configured from public.home_layout_settings where singleton;
  if configured is null then return null; end if;
  with requested as (
    select item->>'key' as key, item->'enabled'='true'::jsonb as enabled, position
    from pg_catalog.jsonb_array_elements(configured) with ordinality entries(item,position)
  ), active_bands as (
    select 'band:'||id::text as key, display_order, active_from, id
    from public.home_curations
    where kind='band_banner' and enabled and active_from<=now()
      and (active_to is null or active_to>now())
  ), ordered as (
    select requested.key, requested.position
    from requested
    where requested.enabled and (
      requested.key in ('hero','editor_picks','category_best','popular','benefits')
      or exists(select 1 from active_bands where active_bands.key=requested.key)
    )
    union all
    select active_bands.key,
      pg_catalog.jsonb_array_length(configured)+row_number() over(order by display_order,active_from,id)
    from active_bands where not exists(select 1 from requested where requested.key=active_bands.key)
  )
  select coalesce(pg_catalog.array_agg(key order by position),'{}'::text[]) into result from ordered;
  return result;
end;
$$;
revoke all on function public.get_home_layout_order() from public, anon, authenticated, service_role;
grant execute on function public.get_home_layout_order() to anon, authenticated;

create function public.admin_save_home_layout(target_operation_id uuid, expected_revision bigint, target_blocks jsonb)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid()); previous public.home_layout_settings; saved public.home_layout_settings;
  audit_entry public.audit_log; request_payload jsonb; band_id uuid; band_exists boolean;
begin
  if actor is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if target_operation_id is null or expected_revision is null or expected_revision<0
    or target_blocks is null or not private.is_valid_home_layout_blocks(target_blocks)
  then raise invalid_parameter_value using message='invalid_home_layout'; end if;
  request_payload := pg_catalog.jsonb_build_object('expected_revision',expected_revision,'blocks',target_blocks);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_home_layout_operation:'||target_operation_id::text,0));
  select * into audit_entry from public.audit_log where id=target_operation_id;
  if found then
    if audit_entry.actor_id=actor and audit_entry.action='admin.home_layout.saved'
      and audit_entry.target='home_layout_settings' and audit_entry.diff->'request'=request_payload
    then return (audit_entry.diff->'after'->>'revision')::bigint; end if;
    raise unique_violation using message='operation_conflict';
  end if;

  select * into previous from public.home_layout_settings where singleton for update;
  if not found or previous.revision<>expected_revision then
    raise serialization_failure using message='home_layout_conflict';
  end if;
  for band_id in
    select pg_catalog.substring(entry->>'key',6)::uuid
    from pg_catalog.jsonb_array_elements(target_blocks) entry
    where entry->>'key' like 'band:%' order by entry->>'key'
  loop
    select true into band_exists from public.home_curations where id=band_id and kind='band_banner' for share;
    if not found then raise no_data_found using message='home_layout_block_not_found'; end if;
  end loop;

  update public.home_layout_settings set blocks=target_blocks,revision=revision+1,updated_at=clock_timestamp()
  where singleton returning * into saved;
  insert into public.audit_log(id,actor_id,action,target,diff)
  values(target_operation_id,actor,'admin.home_layout.saved','home_layout_settings',pg_catalog.jsonb_build_object(
    'request',request_payload,
    'before',pg_catalog.jsonb_build_object('blocks',previous.blocks,'revision',previous.revision),
    'after',pg_catalog.jsonb_build_object('blocks',saved.blocks,'revision',saved.revision)
  ));
  return saved.revision;
end;
$$;
revoke all on function public.admin_save_home_layout(uuid,bigint,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_home_layout(uuid,bigint,jsonb) to authenticated;
