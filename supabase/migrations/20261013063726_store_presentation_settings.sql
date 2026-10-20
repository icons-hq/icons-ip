-- Store presentation has its own revision per section; no business/bank data is exposed.
create function private.store_presentation_valid(p_section text,p_values jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_values) is distinct from 'object' then return false;end if;
 if p_section='common' then
  return coalesce((select count(*)=3 from jsonb_object_keys(p_values)) and p_values ?& array['themeColor','headerStyle','showHomeSearch']
   and p_values->>'themeColor'=any(array['#78bb53','#292b2c','#666668','#6b90dc','#654f43','#72d887','#20c5b0','#ff9dc5','#fc5296','#e96061','#ee4a44','#af7de7','#fcdf33','#f79a49','#eae1d8'])
   and p_values->>'headerStyle' in ('basic','color') and jsonb_typeof(p_values->'showHomeSearch')='boolean',false);
 elsif p_section='listing' then
  return coalesce((select count(*)=6 from jsonb_object_keys(p_values)) and p_values ?& array['imageShape','imageMode','showColors','showDescription','showCart','showTags']
   and p_values->>'imageShape' in ('square','portrait') and p_values->>'imageMode' in ('primary','gallery')
   and not exists(select 1 from unnest(array['showColors','showDescription','showCart','showTags'])k where jsonb_typeof(p_values->k) is distinct from 'boolean'),false);
 end if;return false;
end $$;
revoke all on function private.store_presentation_valid(text,jsonb) from public,anon,authenticated,service_role;
create table private.store_presentation_settings (
 section text primary key check(section in ('common','listing')),
 values jsonb not null,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp(),
 check(private.store_presentation_valid(section,values))
);
alter table private.store_presentation_settings enable row level security;
revoke all on private.store_presentation_settings from public,anon,authenticated,service_role;
insert into private.store_presentation_settings(section,values) values
 ('common','{"themeColor":"#78bb53","headerStyle":"basic","showHomeSearch":false}'),
 ('listing','{"imageShape":"square","imageMode":"primary","showColors":false,"showDescription":true,"showCart":false,"showTags":true}');
create function public.get_storefront_presentation()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(section,values) from private.store_presentation_settings;
$$;
revoke all on function public.get_storefront_presentation() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_presentation() to anon,authenticated;
create function public.admin_get_store_presentation()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'store.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('values',jsonb_object_agg(section,values),'revisions',jsonb_object_agg(section,revision)) from private.store_presentation_settings);
end $$;
revoke all on function public.admin_get_store_presentation() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_store_presentation() to authenticated;
create function public.admin_save_store_presentation(p_section text,p_values jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.store_presentation_settings%rowtype; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'store.manage',false);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or private.store_presentation_valid(p_section,p_values) is distinct from true then
  raise invalid_parameter_value using message='invalid_store_presentation';end if;
 request:=jsonb_build_object('section',p_section,'values',p_values,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('store-presentation:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.store_presentation.updated',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.store_presentation_settings where section=p_section for update;
 if not found then raise no_data_found using message='store_presentation_missing';end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='store_presentation_conflict';end if;
 update private.store_presentation_settings set values=p_values,revision=revision+1,updated_at=clock_timestamp() where section=p_section;
 receipt:=jsonb_build_object('section',p_section,'values',p_values,'revision',previous.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.store_presentation.updated','store_presentation:'||p_section,
  jsonb_build_object('request',request,'result',receipt,'before',previous.values));
 return receipt;
end $$;
revoke all on function public.admin_save_store_presentation(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_presentation(text,jsonb,bigint,uuid) to authenticated;

-- Explicit chips only: an option name never becomes a guessed CSS color.
create function private.goods_listing_colors_valid(p_colors jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare chip jsonb; labels text[]:='{}';
begin
 if jsonb_typeof(p_colors) is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_colors)>20 then return false;end if;
 for chip in select value from jsonb_array_elements(p_colors) loop
  if jsonb_typeof(chip) is distinct from 'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(chip))<>2 or not chip ?& array['label','hex']
   or jsonb_typeof(chip->'label') is distinct from 'string' or jsonb_typeof(chip->'hex') is distinct from 'string'
   or char_length(chip->>'label') not between 1 and 30 or chip->>'label' ~ '[[:cntrl:]]'
   or chip->>'label'<>btrim(chip->>'label',E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
   or chip->>'hex' !~ '^#[0-9a-f]{6}$' or chip->>'label'=any(labels) then return false;end if;
  labels:=array_append(labels,chip->>'label');
 end loop;return true;
end $$;
revoke all on function private.goods_listing_colors_valid(jsonb) from public,anon,authenticated,service_role;
create table private.goods_listing_colors (
 good_id text primary key references public.goods(id) on update cascade on delete cascade,
 colors jsonb not null default '[]' check(private.goods_listing_colors_valid(colors)),
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.goods_listing_colors enable row level security;
revoke all on private.goods_listing_colors from public,anon,authenticated,service_role;
create function public.admin_get_goods_listing_colors(p_good_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from public.goods where id=p_good_id) then raise no_data_found using message='good_missing';end if;
 return coalesce((select jsonb_build_object('colors',colors,'revision',revision) from private.goods_listing_colors where good_id=p_good_id),'{"colors":[],"revision":0}');
end $$;
revoke all on function public.admin_get_goods_listing_colors(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_listing_colors(text) to authenticated;
create function public.admin_save_goods_listing_colors(p_good_id text,p_colors jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.goods_listing_colors%rowtype; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage',false);
 if p_operation_id is null or p_good_id is null or p_expected_revision is null or p_expected_revision<0 or private.goods_listing_colors_valid(p_colors) is distinct from true then
  raise invalid_parameter_value using message='invalid_goods_listing_colors';end if;
 request:=jsonb_build_object('goodId',p_good_id,'colors',p_colors,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-listing-colors:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods_listing_colors.updated',request);
 if receipt is not null then return receipt;end if;
 -- Serialize with rename/archive and make the first empty row participate in CAS.
 perform 1 from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_missing';end if;
 insert into private.goods_listing_colors(good_id) values(p_good_id) on conflict do nothing;
 select * into previous from private.goods_listing_colors where good_id=p_good_id for update;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_listing_colors_conflict';end if;
 update private.goods_listing_colors set colors=p_colors,revision=revision+1,updated_at=clock_timestamp() where good_id=p_good_id;
 receipt:=jsonb_build_object('colors',p_colors,'revision',previous.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods_listing_colors.updated','goods:'||p_good_id,
  jsonb_build_object('request',request,'result',receipt,'before',previous.colors));
 return receipt;
end $$;
revoke all on function public.admin_save_goods_listing_colors(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_listing_colors(text,jsonb,bigint,uuid) to authenticated;

-- Bounded listing metadata. Description is plain text, never HTML; only public
-- goods in public IPs are projected even if a caller supplies arbitrary IDs.
create function public.get_goods_listing_appearance(p_good_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_good_ids is null or cardinality(p_good_ids)>1000 or coalesce(array_ndims(p_good_ids),1)<>1 then raise invalid_parameter_value using message='invalid_listing_ids';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'galleryPaths',to_jsonb(coalesce(g.gallery_paths[1:9],'{}'::text[])),
  'description',left(btrim(regexp_replace(case when g.description_format='html' then regexp_replace(regexp_replace(coalesce(g.description,''),'<(script|style)\y[^>]*>.*?</\1\s*>',' ','gis'),'<[^>]*>',' ','g') else coalesce(g.description,'') end,'\s+',' ','g')),240),
  'colors',coalesce(c.colors,'[]'::jsonb)) order by g.id),'[]'::jsonb)
  from public.goods g join public.ips ip on ip.id=g.ip_id left join private.goods_listing_colors c on c.good_id=g.id
  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null);
end $$;
revoke all on function public.get_goods_listing_appearance(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_listing_appearance(text[]) to anon,authenticated;

select private.register_operator_rpc_contract('public.admin_get_store_presentation()','store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_store_presentation(text,jsonb,bigint,uuid)','store.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_get_goods_listing_colors(text)','catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_listing_colors(text,jsonb,bigint,uuid)','catalog.manage','manual',false);
select private.register_operator_internal_contract('private.store_presentation_valid(text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_listing_colors_valid(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_storefront_presentation()'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_listing_appearance(text[])'::regprocedure);
notify pgrst,'reload schema';
