-- Add the independently managed story surface to navigation and home ordering.
-- Existing labels/order/hidden flags are retained; the new destination appends.
alter table public.store_settings drop constraint store_settings_navigation_valid;
create or replace function private.store_navigation_valid(settings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare entry jsonb; ids text[]:='{}'; label text;
begin
  if jsonb_typeof(settings) is distinct from 'array' then return false; end if;
  if jsonb_array_length(settings)<>8 then return false; end if;
  for entry in select value from jsonb_array_elements(settings) loop
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    if not entry ?& array['id','label','visible'] or (select count(*) from jsonb_object_keys(entry))<>3
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or entry->>'id' not in ('new','best','shop','iphub','packs','events','community','stories')
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

update public.store_settings set
 navigation=navigation || '[{"id":"stories","label":"쇼핑스토리","visible":true}]'::jsonb,
 updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
where not exists(select 1 from jsonb_array_elements(navigation) entry where entry->>'id'='stories');
alter table public.store_settings alter column navigation set default '[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":true},{"id":"events","label":"이벤트","visible":true},{"id":"community","label":"커뮤니티","visible":true},{"id":"stories","label":"쇼핑스토리","visible":true}]'::jsonb;
alter table public.store_settings add constraint store_settings_navigation_valid check(private.store_navigation_valid(navigation));

-- The original five blocks remain valid for saved layouts. A missing story key
-- appends by default; an explicit disabled story key remains hidden.
create or replace function private.is_valid_home_layout_blocks(candidate jsonb)
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
    if block_key not in ('hero','editor_picks','category_best','popular','benefits','stories')
      and block_key !~ '^(band|sales|reviews|mosaic):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
    seen := pg_catalog.array_append(seen, block_key);
  end loop;
  return array['hero','editor_picks','category_best','popular','benefits']::text[] <@ seen;
end;
$$;
revoke all on function private.is_valid_home_layout_blocks(jsonb) from public, anon, authenticated, service_role;

create or replace function public.get_home_layout_order()
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare configured jsonb; result text[];
begin
  select blocks into configured from public.home_layout_settings where singleton;
  if configured is null then return null; end if;
  with requested as (
    select item->>'key' as key, item->'enabled'='true'::jsonb as enabled, position
    from pg_catalog.jsonb_array_elements(configured) with ordinality entries(item,position)
  ), active_bands as (
    select (case kind when 'band_banner' then 'band:' when 'sales_best' then 'sales:' when 'review_best' then 'reviews:' else 'mosaic:' end)||id::text as key,
      case kind when 'band_banner' then 0 when 'sales_best' then 1 when 'review_best' then 2 else 3 end as kind_order,display_order, active_from, id
    from public.home_curations
    where kind in ('band_banner','sales_best','review_best','product_mosaic') and enabled and active_from<=now()
      and (active_to is null or active_to>now())
  ), ordered as (
    select requested.key, requested.position
    from requested
    where requested.enabled and (
      requested.key in ('hero','editor_picks','category_best','popular','benefits','stories')
      or exists(select 1 from active_bands where active_bands.key=requested.key)
    )
    union all
    select active_bands.key,
      pg_catalog.jsonb_array_length(configured)+row_number() over(order by kind_order,display_order,active_from,id)
    from active_bands where not exists(select 1 from requested where requested.key=active_bands.key)
    union all
    select 'stories',pg_catalog.jsonb_array_length(configured)+(select count(*) from active_bands)+1
    where not exists(select 1 from requested where key='stories')
  )
  select coalesce(pg_catalog.array_agg(key order by position),'{}'::text[]) into result from ordered;
  return result;
end;
$$;
revoke all on function public.get_home_layout_order() from public, anon, authenticated, service_role;
grant execute on function public.get_home_layout_order() to anon, authenticated;


select private.register_operator_internal_contract('private.store_navigation_valid(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.is_valid_home_layout_blocks(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_home_layout_order()'::regprocedure);
notify pgrst,'reload schema';
