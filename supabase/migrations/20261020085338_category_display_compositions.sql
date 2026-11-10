-- Category-specific editorial composition; existing taxonomy and ERP stay intact.
-- Reviewed for disposable CANON 310 / OWN clone validation before named apply.

create table private.category_display_compositions (
 category_id uuid primary key references public.catalog_categories(id) on delete restrict,
 enabled boolean not null default false,
 mode text not null default 'categories' check(mode in('categories','manual')),
 banner jsonb not null,
 video_enabled boolean not null default false,
 video_good_id text references public.goods(id) on update cascade on delete set null,
 recommendations jsonb not null,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.category_display_sources (
 category_id uuid not null references private.category_display_compositions(category_id) on delete cascade,
 source_category_id uuid not null references public.catalog_categories(id) on delete restrict,
 position integer not null check(position between 0 and 9),
 primary key(category_id,source_category_id),unique(category_id,position)
);
create table private.category_display_goods (
 category_id uuid not null references private.category_display_compositions(category_id) on delete cascade,
 slot text not null check(slot in('main','recommend')),
 good_id text not null references public.goods(id) on update cascade on delete cascade,
 position integer not null check(position>=0 and position<1000),
 primary key(category_id,slot,good_id),unique(category_id,slot,position),
 check(slot<>'recommend' or position<100)
);
create index category_display_goods_target on private.category_display_goods(good_id);
alter table private.category_display_compositions enable row level security;
alter table private.category_display_sources enable row level security;
alter table private.category_display_goods enable row level security;
revoke all on private.category_display_compositions,private.category_display_sources,private.category_display_goods from public,anon,authenticated,service_role;

-- No taxonomy/ERP writer is called. This read predicate matches public category
-- activation and excludes a category if any ancestor is archived.
create function private.category_display_category(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with recursive lineage as (
  select c.id,c.parent_id,c.archived_at,1 as hops from public.catalog_categories c where c.id=p_id
  union all select p.id,p.parent_id,p.archived_at,l.hops+1 from public.catalog_categories p join lineage l on p.id=l.parent_id where l.hops<4
 ) select jsonb_build_object('id',c.id,'name',c.name,'parentId',c.parent_id,'depth',c.depth,'sortOrder',c.sort_order,
  'publicEnabled',coalesce((select customer_enabled from public.category_activation_control where id='catalog'),false)
    and not exists(select 1 from lineage where archived_at is not null)
    and exists(select 1 from lineage where parent_id is null))
 from public.catalog_categories c where c.id=p_id and c.archived_at is null;
$$;
revoke all on function private.category_display_category(uuid) from public,anon,authenticated,service_role;

create function private.category_display_defaults(p_id uuid) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',false,'mode','categories','categoryIds',jsonb_build_array(p_id),'goodIds','[]'::jsonb,
  'banner',jsonb_build_object('enabled',false,'imagePath',null,'mobileImagePath',null,'title','','content','','altEnabled',false,'altTitle','','altContent','','linkPath',null,'imageDim','none','textColor','white'),
  'video',jsonb_build_object('enabled',false,'goodId',null),'recommendations',jsonb_build_object('enabled',false,'title','추천상품','itemCount',3,'goodIds','[]'::jsonb));
$$;
revoke all on function private.category_display_defaults(uuid) from public,anon,authenticated,service_role;

create function private.category_display_values(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce((select jsonb_build_object('enabled',c.enabled,'mode',c.mode,
  'categoryIds',coalesce((select jsonb_agg(s.source_category_id order by s.position) from private.category_display_sources s where s.category_id=c.category_id),'[]'::jsonb),
  'goodIds',coalesce((select jsonb_agg(g.good_id order by g.position) from private.category_display_goods g where g.category_id=c.category_id and g.slot='main'),'[]'::jsonb),
  'banner',c.banner,'video',jsonb_build_object('enabled',c.video_enabled,'goodId',c.video_good_id),
  'recommendations',c.recommendations||jsonb_build_object('goodIds',coalesce((select jsonb_agg(g.good_id order by g.position) from private.category_display_goods g where g.category_id=c.category_id and g.slot='recommend'),'[]'::jsonb)))
  from private.category_display_compositions c where c.category_id=p_id),private.category_display_defaults(p_id));
$$;
revoke all on function private.category_display_values(uuid) from public,anon,authenticated,service_role;

create function private.category_display_valid(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare b jsonb;v jsonb;r jsonb;arr jsonb;item jsonb;k text;path text;
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>7
  or not p ?& array['enabled','mode','categoryIds','goodIds','banner','video','recommendations']
  or jsonb_typeof(p->'enabled') is distinct from 'boolean' or p->>'mode' not in('categories','manual')
  or jsonb_typeof(p->'mode') is distinct from 'string' then return false;end if;
 b:=p->'banner';v:=p->'video';r:=p->'recommendations';
 if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>11
  or not b ?& array['enabled','imagePath','mobileImagePath','title','content','altEnabled','altTitle','altContent','linkPath','imageDim','textColor'] then return false;end if;
 -- The object above has eleven explicitly enumerated fields; no arbitrary HTML.
 if jsonb_typeof(b->'enabled') is distinct from 'boolean' or jsonb_typeof(b->'altEnabled') is distinct from 'boolean'
  or jsonb_typeof(b->'imageDim') is distinct from 'string' or jsonb_typeof(b->'textColor') is distinct from 'string'
  or b->>'imageDim' not in('none','white','black') or b->>'textColor' not in('white','black') then return false;end if;
 foreach k in array array['title','content','altTitle','altContent'] loop
  if jsonb_typeof(b->k) is distinct from 'string' or char_length(b->>k)>(case when k in('title','altTitle') then 40 else 150 end)
   or b->>k ~ '[\x00-\x08\x0b-\x1f\x7f]'
   or array_length(string_to_array(b->>k,E'\n'),1)>(case when k in('title','altTitle') then 1 else 3 end) then return false;end if;
 end loop;
 foreach k in array array['imagePath','mobileImagePath'] loop
  if jsonb_typeof(b->k) not in('string','null') then return false;end if;
  path:=b->>k;
  if path is not null and path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$' then return false;end if;
 end loop;
 if (b->>'enabled')::boolean and b->>'imagePath' is null
  or jsonb_typeof(b->'linkPath') not in('string','null')
  or b->>'linkPath' is not null and not private.is_safe_home_curation_link(b->>'linkPath') then return false;end if;
 if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>2 or not v ?& array['enabled','goodId']
  or jsonb_typeof(v->'enabled') is distinct from 'boolean' or jsonb_typeof(v->'goodId') not in('string','null')
  or v->>'goodId' is not null and v->>'goodId' !~ '^[a-z0-9][a-z0-9-]{0,199}$'
  or (v->>'enabled')::boolean and v->>'goodId' is null then return false;end if;
 if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>4 or not r ?& array['enabled','title','itemCount','goodIds']
  or jsonb_typeof(r->'enabled') is distinct from 'boolean' or jsonb_typeof(r->'title') is distinct from 'string'
  or char_length(r->>'title')>15 or r->>'title' ~ '[\x00-\x1f\x7f]'
  or (r->>'enabled')::boolean and btrim(r->>'title')=''
  or jsonb_typeof(r->'itemCount') is distinct from 'number' or (r->>'itemCount') !~ '^(3|4|5|6|7|8|9|10|11|12)$' then return false;end if;
 foreach k in array array['categoryIds','goodIds','recommendations'] loop
  arr:=case when k='recommendations' then r->'goodIds' else p->k end;
  if jsonb_typeof(arr) is distinct from 'array' then return false;end if;
  if jsonb_array_length(arr)>(case k when 'categoryIds' then 10 when 'goodIds' then 1000 else 100 end)
   or (select count(distinct x) from jsonb_array_elements(arr) x)<>jsonb_array_length(arr) then return false;end if;
  for item in select value from jsonb_array_elements(arr) loop
   if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~ (case when k='categoryIds' then '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' else '^[a-z0-9][a-z0-9-]{0,199}$' end) then return false;end if;
  end loop;
 end loop;
 return not ((p->>'enabled')::boolean and p->>'mode'='categories' and jsonb_array_length(p->'categoryIds')=0);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function private.category_display_valid(jsonb) from public,anon,authenticated,service_role;

create function private.category_display_reference_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='category_display_compositions' then
  -- FK cascades change only the reference. The authorized whole-document save
  -- deliberately advances updated_at and sets its one final CAS revision.
  if new.video_good_id is distinct from old.video_good_id and new.revision=old.revision and new.updated_at is not distinct from old.updated_at
   then new.revision:=old.revision+1;new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');end if;
  return new;
 end if;
 update private.category_display_compositions set revision=revision+1,updated_at=clock_timestamp() where category_id=old.category_id;
 return null;
end $$;
revoke all on function private.category_display_reference_changed() from public,anon,authenticated,service_role;
create trigger category_display_video_reference before update of video_good_id on private.category_display_compositions for each row execute function private.category_display_reference_changed();
create trigger category_display_goods_reference after delete or update of good_id on private.category_display_goods for each row execute function private.category_display_reference_changed();

create function public.admin_get_category_display(p_category_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare category jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 category:=private.category_display_category(p_category_id);if category is null then return null;end if;
 return jsonb_build_object('category',category,'values',private.category_display_values(p_category_id),
  'revision',coalesce((select revision from private.category_display_compositions where category_id=p_category_id),0),'checkedAt',statement_timestamp());
end $$;
revoke all on function public.admin_get_category_display(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_category_display(uuid) to authenticated;

create function public.admin_list_category_displays() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 return jsonb_build_object('checkedAt',statement_timestamp(),'categories',coalesce((select jsonb_agg(private.category_display_category(c.id) order by c.depth,c.sort_order,c.code)
  from public.catalog_categories c where c.archived_at is null),'[]'::jsonb));
end $$;
revoke all on function public.admin_list_category_displays() from public,anon,authenticated,service_role;
grant execute on function public.admin_list_category_displays() to authenticated;

create function public.admin_save_category_display(p_category_id uuid,p_values jsonb,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;previous private.category_display_compositions;before_values jsonb;request jsonb;receipt public.audit_log;result jsonb;artwork_path text;category jsonb;
begin
 actor:=private.require_operator_capability('store.manage',false);
 if p_category_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or not private.category_display_valid(p_values)
 then raise invalid_parameter_value using message='invalid_category_display';end if;
 request:=jsonb_build_object('categoryId',p_category_id,'values',p_values,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('category-display-operation:'||p_operation_id::text,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id=actor and receipt.action='admin.category_display.saved' and receipt.target='category-display:'||p_category_id::text and receipt.diff->'request'=request then return receipt.diff->'result';end if;
  raise unique_violation using message='operation_conflict';
 end if;
 -- Same existing tree lock as category/assignment writers, before product rows.
 perform pg_advisory_xact_lock(hashtextextended('catalog_category_tree',0));
 category:=private.category_display_category(p_category_id);if category is null then raise no_data_found using message='category_not_found';end if;
 perform 1 from public.catalog_categories c where c.id=p_category_id or c.id in(select value::uuid from jsonb_array_elements_text(p_values->'categoryIds')) order by c.id for share;
 if exists(select 1 from jsonb_array_elements_text(p_values->'categoryIds') id where private.category_display_category(id::uuid) is null) then raise check_violation using message='category_source_missing';end if;
 perform 1 from public.goods g where g.id in(
  select value from jsonb_array_elements_text(p_values->'goodIds') union select value from jsonb_array_elements_text(p_values#>'{recommendations,goodIds}')
  union select p_values#>>'{video,goodId}' union select good_id from private.category_display_goods where category_id=p_category_id
  union select video_good_id from private.category_display_compositions where category_id=p_category_id
 ) order by g.id for share;
 if exists(select 1 from (select value id from jsonb_array_elements_text(p_values->'goodIds') union select value from jsonb_array_elements_text(p_values#>'{recommendations,goodIds}') union select p_values#>>'{video,goodId}') selected
  where selected.id is not null and not exists(select 1 from public.goods g where g.id=selected.id)) then raise check_violation using message='category_display_good_missing';end if;
 insert into private.category_display_compositions(category_id,banner,recommendations)
 values(p_category_id,private.category_display_defaults(p_category_id)->'banner',(private.category_display_defaults(p_category_id)->'recommendations')-'goodIds') on conflict(category_id) do nothing;
 select * into previous from private.category_display_compositions where category_id=p_category_id for update;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='category_display_conflict';end if;
 before_values:=private.category_display_values(p_category_id);
 for artwork_path in select distinct value from jsonb_each_text(p_values->'banner') where key in('imagePath','mobileImagePath') and value is not null
  and value is distinct from previous.banner->>'imagePath' and value is distinct from previous.banner->>'mobileImagePath' order by value
 loop
  update public.admin_artwork_upload_claims as claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
  where claim.actor_id=actor and claim.path=substr(artwork_path,length('public-media/')+1) and claim.kind='curation'
   and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end loop;
 delete from private.category_display_sources where category_id=p_category_id;
 insert into private.category_display_sources(category_id,source_category_id,position)
 select p_category_id,value::uuid,ordinality-1 from jsonb_array_elements_text(p_values->'categoryIds') with ordinality;
 delete from private.category_display_goods where category_id=p_category_id;
 insert into private.category_display_goods(category_id,slot,good_id,position)
 select p_category_id,'main',value,ordinality-1 from jsonb_array_elements_text(p_values->'goodIds') with ordinality
 union all select p_category_id,'recommend',value,ordinality-1 from jsonb_array_elements_text(p_values#>'{recommendations,goodIds}') with ordinality;
 update private.category_display_compositions set enabled=(p_values->>'enabled')::boolean,mode=p_values->>'mode',banner=p_values->'banner',
  video_enabled=(p_values#>>'{video,enabled}')::boolean,video_good_id=p_values#>>'{video,goodId}',recommendations=(p_values->'recommendations')-'goodIds',
  revision=previous.revision+1,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where category_id=p_category_id;
 result:=jsonb_build_object('category',category,'revision',previous.revision+1,'values',private.category_display_values(p_category_id),'checkedAt',clock_timestamp());
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.category_display.saved','category-display:'||p_category_id::text,jsonb_build_object('request',request,'before',before_values,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_category_display(uuid,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_category_display(uuid,jsonb,bigint,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_get_category_display(uuid)'::regprocedure,'store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_list_category_displays()'::regprocedure,'store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_category_display(uuid,jsonb,bigint,uuid)'::regprocedure,'store.manage','write',false);
select private.register_operator_internal_contract('private.category_display_category(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_defaults(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_values(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_valid(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_reference_changed()'::regprocedure);

-- Normalized key for the existing ASCII lowercase/digit/hyphen product IDs.
-- Numeric runs compare numerically; raw ID is the stable tie-break for zeroes.
create function private.category_display_natural_key(p_id text) returns text
language plpgsql immutable strict security invoker set search_path='' as $$
declare part text[];v text;result text:='';
begin
 for part in select regexp_matches(p_id,'([0-9]+|[^0-9]+)','g') loop
  v:=part[1];if v~'^[0-9]+$' then v:=coalesce(nullif(ltrim(v,'0'),''),'0');result:=result||'0'||lpad(length(v)::text,3,'0')||v;else result:=result||v;end if;
 end loop;return result;
end $$;
revoke all on function private.category_display_natural_key(text) from public,anon,authenticated,service_role;

create function private.category_display_matching_goods(p_values jsonb) returns table(id text,ordinal_position bigint)
language sql stable security invoker set search_path='' as $$
 with recursive selected_categories as (
  select c.id from public.catalog_categories c where c.id in(select value::uuid from jsonb_array_elements_text(p_values->'categoryIds'))
   and coalesce((private.category_display_category(c.id)->>'publicEnabled')::boolean,false)
  union select c.id from public.catalog_categories c join selected_categories p on c.parent_id=p.id where c.archived_at is null
 ), manual as (select value id,ordinality-1 ordinal_position from jsonb_array_elements_text(p_values->'goodIds') with ordinality)
 select g.id,m.ordinal_position from public.goods g join public.ips ip on ip.id=g.ip_id left join manual m on m.id=g.id
 where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
  and case when p_values->>'mode'='manual' then m.id is not null else
   g.category_id in(select id from selected_categories) or exists(select 1 from public.goods_additional_categories extra where extra.good_id=g.id and extra.category_id in(select id from selected_categories)) end;
$$;
revoke all on function private.category_display_matching_goods(jsonb) from public,anon,authenticated,service_role;

create function private.category_display_public_good(p_good public.goods,p_variants jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_good.id,'ip_id',p_good.ip_id,'ip_name',(select title from public.ips where id=p_good.ip_id),'name',p_good.name,'type',p_good.type,'price',p_good.price,
  'compare_at_price',p_good.compare_at_price,'show_discount_rate',p_good.show_discount_rate,'display_order',p_good.display_order,'category_id',p_good.category_id,
  'created_at',p_good.created_at,'badge',p_good.badge,'stock',p_good.stock,'stock_qty',p_good.stock_qty,'bg',p_good.bg,'image_path',p_good.image_path,
  'allow_bank_transfer',p_good.allow_bank_transfer,'allow_card_payment',p_good.allow_card_payment,'sale_restriction','none',
  'order_quantity_limit_enabled',p_good.order_quantity_limit_enabled,'min_order_qty',p_good.min_order_qty,'max_order_qty',p_good.max_order_qty,
  'member_purchase_limit_enabled',p_good.member_purchase_limit_enabled,'member_lifetime_qty_limit',p_good.member_lifetime_qty_limit,
  'origin_id',p_good.origin_id,'custom_inputs_enabled',p_good.custom_inputs_enabled,'custom_inputs_revision',p_good.custom_inputs_revision,
  'custom_input_fields',p_good.custom_input_fields,'additional_good_ids',public.goods_additional_ids(p_good),
  'sale_period',public.goods_sale_period(p_good),'goods_variants',p_variants);
$$;
revoke all on function private.category_display_public_good(public.goods,jsonb) from public,anon,authenticated,service_role;

create function private.category_display_public_variants(p_good_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'price',v.price,'stock_qty',v.stock_qty,
  'is_default',v.is_default,'attributes',v.attributes,'archived_at',v.archived_at,'sort_order',v.sort_order,
  'pricing',public.goods_variant_pricing(v),'supply',public.goods_variant_supply(v)) order by v.sort_order,v.id),'[]'::jsonb)
 from public.goods_variants v where v.good_id=p_good_id and v.archived_at is null;
$$;
revoke all on function private.category_display_public_variants(text) from public,anon,authenticated,service_role;

create function private.category_display_page(p_category_id uuid,p_values jsonb,p_query jsonb,p_offset integer,p_token text,p_revision bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare category jsonb;result jsonb;fingerprint text;b jsonb;r jsonb;video jsonb;recommendations jsonb;keys text[]:=array['ips','types','min','max','sort'];
begin
 category:=private.category_display_category(p_category_id);
 if category is null or not (category->>'publicEnabled')::boolean then return null;end if;
 if p_offset is null or p_offset<0 or p_offset>10000000 or p_offset%20<>0 or p_offset>0 and (p_token is null or p_token !~ '^[0-9a-f]{32}$')
  or jsonb_typeof(p_query) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_query))<>5 or not p_query ?& keys
  or jsonb_typeof(p_query->'ips') is distinct from 'array' or jsonb_typeof(p_query->'types') is distinct from 'array'
  or jsonb_typeof(p_query->'sort') is distinct from 'string' or p_query->>'sort' not in('recommended','newest','price_asc','price_desc')
  or jsonb_typeof(p_query->'min') not in('null','number') or jsonb_typeof(p_query->'max') not in('null','number') then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 if jsonb_array_length(p_query->'ips')>100 or jsonb_array_length(p_query->'types')>8
  or exists(select 1 from jsonb_array_elements(p_query->'ips') value where jsonb_typeof(value)<>'string' or value#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$')
  or exists(select 1 from jsonb_array_elements(p_query->'types') value where jsonb_typeof(value)<>'string' or value#>>'{}' not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트'))
  or exists(select 1 from jsonb_each_text(p_query) e where e.key in('min','max') and e.value is not null and (e.value !~ '^[0-9]{1,9}$' or e.value::numeric>100000000))
  or (p_query->>'min')::numeric>(p_query->>'max')::numeric then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 -- Materialize the complete option quote once per candidate. A flattenable
 -- lateral SELECT would run the price/supply helper separately for each of the
 -- JSON projection, minimum price and available-stock expressions.
 with quoted as materialized (
  select g as good,g.id,g.ip_id,g.type,g.created_at,g.updated_at,g.display_order,m.ordinal_position,ip.title ip_name,
   private.category_display_public_variants(g.id) variants
  from private.category_display_matching_goods(p_values) m join public.goods g on g.id=m.id join public.ips ip on ip.id=g.ip_id
 ), base as materialized (
  select quoted.*,
   coalesce((select min((v#>>'{pricing,effectivePrice}')::numeric) from jsonb_array_elements(variants) v),(good).price) current_price,
   coalesce((select sum((v#>>'{supply,availableQty}')::bigint) from jsonb_array_elements(variants) v),0) available
  from quoted
 ), filtered as materialized (
  select * from base where (jsonb_array_length(p_query->'ips')=0 or ip_id in(select value from jsonb_array_elements_text(p_query->'ips')))
   and (jsonb_array_length(p_query->'types')=0 or type in(select value from jsonb_array_elements_text(p_query->'types')))
   and (p_query->>'min' is null or current_price>=(p_query->>'min')::numeric) and (p_query->>'max' is null or current_price<=(p_query->>'max')::numeric)
 ), ranked as materialized (
  select *,row_number() over(order by
   case when p_query->>'sort'='price_asc' then current_price end asc,
   case when p_query->>'sort'='price_desc' then current_price end desc,
   case when p_query->>'sort'='newest' then created_at end desc nulls last,
   case when p_values->>'mode'='manual' then ordinal_position end asc nulls last,
   case when p_values->>'mode'='categories' then display_order end asc nulls last,
   case when p_values->>'mode'='categories' then private.category_display_natural_key(id) end collate "C" asc,
   id collate "C") rank from filtered
 ), page as (select * from ranked order by rank limit 20 offset p_offset)
 select jsonb_build_object('category',jsonb_build_object('id',category->'id','name',category->'name'),'checkedAt',statement_timestamp(),
  'total',(select count(*) from base),'filteredTotal',(select count(*) from filtered),'priceCeil',coalesce((select max(current_price) from base),0),
  'token',md5(jsonb_build_array(p_category_id,p_revision,category,p_query,coalesce((select string_agg(id||':'||current_price||':'||available||':'||updated_at,',' order by rank) from ranked),'') )::text),
  'offset',p_offset,'nextOffset',case when (select count(*) from filtered)>p_offset+20 then p_offset+20 else null end,
  'ipFacets',coalesce((select jsonb_agg(jsonb_build_object('value',ip_id,'label',ip_name,'count',n) order by ip_name,ip_id) from (select ip_id,ip_name,count(*) n from base group by ip_id,ip_name) f),'[]'::jsonb),
  'typeFacets',coalesce((select jsonb_agg(jsonb_build_object('value',type,'label',type,'count',n) order by array_position(array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트'],type)) from (select type,count(*) n from base group by type) f),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(private.category_display_public_good(good,variants) order by rank) from page),'[]'::jsonb)) into result;
 fingerprint:=result->>'token';if p_token is not null and p_token is distinct from fingerprint then raise sqlstate 'PT409' using message='category_display_page_changed';end if;
 if (result->>'total')::bigint=0 then return result||jsonb_build_object('banner',null,'video',null,'recommendations',null);end if;
 b:=p_values->'banner';r:=p_values->'recommendations';
 if not (b->>'enabled')::boolean then b:=null;else
  b:=jsonb_build_object('title',b->'title','content',b->'content','imagePath',b->'imagePath','mobileImagePath',b->'mobileImagePath',
   'linkPath',b->'linkPath','imageDim',b->'imageDim','textColor',b->'textColor','altText',case when (b->>'altEnabled')::boolean then concat_ws(' · ',nullif(btrim(b->>'altTitle'),''),nullif(btrim(b->>'altContent'),'')) else '' end);
 end if;
 if (p_values#>>'{video,enabled}')::boolean then
  video:=public.get_good_media(p_values#>>'{video,goodId}')->'video';
  if video='null'::jsonb then video:=null;end if;
  if video is not null then video:=jsonb_build_object('asset',video,'poster',(select image_path from public.goods where id=p_values#>>'{video,goodId}'));end if;
 end if;
 if (r->>'enabled')::boolean then
  select jsonb_build_object('title',r->'title','rows',coalesce(jsonb_agg(private.category_display_public_good(good,variants) order by position),'[]'::jsonb)) into recommendations
  from (select g as good,ordinality position,private.category_display_public_variants(g.id) variants
   from jsonb_array_elements_text(r->'goodIds') with ordinality ids join public.goods g on g.id=ids.value join public.ips ip on ip.id=g.ip_id
   where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
   order by ordinality limit (r->>'itemCount')::integer) selected;
 end if;
 return result||jsonb_build_object('banner',b,'video',video,'recommendations',recommendations);
end $$;
revoke all on function private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint) from public,anon,authenticated,service_role;

create function public.get_category_display_page(p_category_id uuid,p_query jsonb,p_offset integer default 0,p_token text default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.category_display_page(p_category_id,private.category_display_values(p_category_id),p_query,p_offset,p_token,c.revision)
 from private.category_display_compositions c where c.category_id=p_category_id and c.enabled;
$$;
revoke all on function public.get_category_display_page(uuid,jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_category_display_page(uuid,jsonb,integer,text) to anon,authenticated;

create function public.get_category_display_navigation() returns jsonb
language sql stable security definer set search_path='' as $$
 with recursive category_tree as (
  select c.id,array[lpad(c.sort_order::text,10,'0')||':'||c.code] path from public.catalog_categories c where c.parent_id is null and c.archived_at is null
  union all select c.id,p.path||(lpad(c.sort_order::text,10,'0')||':'||c.code) from public.catalog_categories c join category_tree p on c.parent_id=p.id where c.archived_at is null
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'depth',c.depth) order by t.path),'[]'::jsonb)
 from private.category_display_compositions d join public.catalog_categories c on c.id=d.category_id join category_tree t on t.id=c.id
 where d.enabled and coalesce((private.category_display_category(c.id)->>'publicEnabled')::boolean,false)
  and exists(select 1 from private.category_display_matching_goods(private.category_display_values(c.id)) limit 1);
$$;
revoke all on function public.get_category_display_navigation() from public,anon,authenticated,service_role;
grant execute on function public.get_category_display_navigation() to anon,authenticated;

create function public.admin_preview_category_display(p_category_id uuid,p_values jsonb,p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if not private.category_display_valid(p_values) then raise invalid_parameter_value using message='invalid_category_display';end if;
 return private.category_display_page(p_category_id,p_values,p_query,0,null,0);
end $$;
revoke all on function public.admin_preview_category_display(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_category_display(uuid,jsonb,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_category_display(uuid,jsonb,jsonb)'::regprocedure,'store.manage','read',false);
select private.register_operator_internal_contract('private.category_display_natural_key(text)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_matching_goods(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_public_good(public.goods,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_public_variants(text)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
select private.register_operator_internal_contract('public.get_category_display_page(uuid,jsonb,integer,text)'::regprocedure);
select private.register_operator_internal_contract('public.get_category_display_navigation()'::regprocedure);
