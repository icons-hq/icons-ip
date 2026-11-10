-- DRAFT: group identity and explicit per-variant product conversion.
-- Depends on goods_aggregation_families; stock-successor consumers follow this
-- migration. Do not apply to named environments before all modules are verified.

-- A verified video may be retained by several products created by an atomic
-- conversion. Upload/normal attachment still rejects another product's asset;
-- the existing retirement and cleanup routines already count every live binding.
drop index private.goods_media_video_once;
drop index private.goods_media_shortclip_once;
create index goods_media_video_references on private.goods_media_bindings(video_asset_id) where video_asset_id is not null;
create index goods_media_shortclip_references on private.goods_media_bindings(shortclip_asset_id) where shortclip_asset_id is not null;

create function private.goods_group_valid_labels(p_values text[],p_max_length integer)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_values is not null and array_ndims(p_values)=1
  and array_lower(p_values,1)=1 and cardinality(p_values) between 1 and 3
  and not exists(select 1 from unnest(p_values) v
    where v is null or v<>btrim(v,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or v~'[[:cntrl:]]' or char_length(v) not between 1 and p_max_length);
$$;
revoke all on function private.goods_group_valid_labels(text[],integer) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_valid_labels(text[],integer) to postgres;

create table private.goods_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check(private.goods_group_valid_labels(array[name],40)),
 option_names text[] not null check(private.goods_group_valid_labels(option_names,40)),
 common_good_id text not null references public.goods(id) on delete restrict,
 revision bigint not null default 1 check(revision>0),
 archived_at timestamptz,
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.goods_group_members (
 group_id uuid not null references private.goods_groups(id) on delete restrict,
 good_id text primary key references public.goods(id) on delete restrict,
 variant_id uuid not null unique,
 option_values text[] not null check(private.goods_group_valid_labels(option_values,80)),
 sort_order integer not null check(sort_order between 0 and 99),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on delete restrict,
 unique(group_id,option_values) deferrable initially immediate,
 unique(group_id,sort_order) deferrable initially immediate
);
create index goods_group_members_group on private.goods_group_members(group_id,sort_order,good_id);
create table private.goods_group_operations (
 operation_id uuid primary key,
 actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,
 command text not null check(command in ('convert','create','update','common','attach','detach','archive')),
 target_group_id uuid,
 expected_revision bigint check(expected_revision is null or expected_revision>=0),
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 receipt jsonb,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 check((receipt is null and completed_at is null) or
       (receipt is not null and jsonb_typeof(receipt)='object' and completed_at is not null))
);
create table private.goods_group_changes (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references private.goods_groups(id) on delete restrict,
 operation_id uuid not null references private.goods_group_operations(operation_id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 revision bigint not null check(revision>0),
 before_value jsonb,
 after_value jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(group_id,revision)
);
create table private.goods_stock_successors (
 source_variant_id uuid primary key,
 source_good_id text not null,
 target_variant_id uuid not null unique,
 target_good_id text not null,
 operation_id uuid not null references private.goods_group_operations(operation_id) on delete restrict,
 moved_qty integer not null check(moved_qty>=0),
 actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(source_variant_id,source_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(target_variant_id,target_good_id) references public.goods_variants(id,good_id) on delete restrict,
 check(source_variant_id<>target_variant_id and source_good_id<>target_good_id)
);
create table private.goods_group_external_identity_moves (
 source_variant_id uuid primary key references public.goods_variants(id) on delete restrict,
 target_variant_id uuid not null unique references public.goods_variants(id) on delete restrict,
 operation_id uuid not null references private.goods_group_operations(operation_id) on delete restrict,
 before_value jsonb not null check(jsonb_typeof(before_value)='object'),
 actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create table private.goods_group_conversion_previews (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,
 request jsonb not null check(jsonb_typeof(request)='object'),
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 public_plan jsonb not null check(jsonb_typeof(public_plan)='object'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
-- Transaction-local permission is a sealed row, never a client-settable GUC.
create table private.goods_group_write_authorizations (
 transaction_id bigint not null,
 good_id text not null references public.goods(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete restrict,
 primary key(transaction_id,good_id)
);

alter table private.goods_groups enable row level security;
alter table private.goods_group_members enable row level security;
alter table private.goods_group_operations enable row level security;
alter table private.goods_group_changes enable row level security;
alter table private.goods_stock_successors enable row level security;
alter table private.goods_group_external_identity_moves enable row level security;
alter table private.goods_group_conversion_previews enable row level security;
alter table private.goods_group_write_authorizations enable row level security;
revoke all on private.goods_groups,private.goods_group_members,private.goods_group_operations,
 private.goods_group_changes,private.goods_stock_successors,private.goods_group_external_identity_moves,
 private.goods_group_conversion_previews,private.goods_group_write_authorizations from public,anon,authenticated,service_role;
grant all on private.goods_groups,private.goods_group_members,private.goods_group_operations,
 private.goods_group_changes,private.goods_stock_successors,private.goods_group_external_identity_moves,
 private.goods_group_conversion_previews,private.goods_group_write_authorizations to postgres;

create function private.goods_group_immutable_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise check_violation using message='goods_group_history_immutable';end;
$$;
revoke all on function private.goods_group_immutable_history() from public,anon,authenticated,service_role;
grant execute on function private.goods_group_immutable_history() to postgres;
create trigger goods_stock_successors_immutable before update or delete on private.goods_stock_successors
 for each row execute function private.goods_group_immutable_history();
create trigger goods_group_identity_moves_immutable before update or delete on private.goods_group_external_identity_moves
 for each row execute function private.goods_group_immutable_history();
create trigger goods_group_changes_immutable before update or delete on private.goods_group_changes
 for each row execute function private.goods_group_immutable_history();

-- Called only by the atomic converter after moving stock and creating the new
-- sales unit. Returns/reshipments take TRY-SHARED on this same topology key;
-- ordinary checkout and stock adjustment never follow this mapping.
create function private.record_goods_stock_successor(
 p_source_good_id text,p_source_variant_id uuid,p_target_good_id text,p_target_variant_id uuid,
 p_operation_id uuid,p_moved_qty integer,p_actor_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare s public.goods_variants%rowtype;t public.goods_variants%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 if p_moved_qty is null or p_moved_qty<0 or p_source_good_id is not distinct from p_target_good_id
  or p_source_variant_id is not distinct from p_target_variant_id
  or not exists(select 1 from private.goods_group_operations o where o.operation_id=p_operation_id
    and o.actor_id=p_actor_id and o.command='convert' and o.completed_at is null) then
  raise check_violation using message='goods_stock_successor_invalid';
 end if;
 perform 1 from public.goods where id=any(array[p_source_good_id,p_target_good_id]) order by id for update nowait;
 perform 1 from public.goods_variants where id=any(array[p_source_variant_id,p_target_variant_id]) order by id for update nowait;
 select * into s from public.goods_variants where id=p_source_variant_id and good_id=p_source_good_id;
 select * into t from public.goods_variants where id=p_target_variant_id and good_id=p_target_good_id;
 if s.id is null or t.id is null or s.archived_at is null or s.stock_qty<>0
  or t.archived_at is not null or t.stock_qty<>p_moved_qty
  or exists(select 1 from private.goods_stock_successors where source_variant_id=p_source_variant_id
    or source_variant_id=p_target_variant_id or target_variant_id=p_target_variant_id)
  or exists(select 1 from public.order_items where good_id=p_target_good_id)
  or not exists(select 1 from private.goods_group_write_authorizations
    where transaction_id=txid_current() and good_id=p_target_good_id and actor_id=p_actor_id) then
  raise check_violation using message='goods_stock_successor_invalid';
 end if;
 insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id)
 values(p_source_variant_id,p_source_good_id,p_target_variant_id,p_target_good_id,p_operation_id,p_moved_qty,p_actor_id);
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;
revoke all on function private.record_goods_stock_successor(text,uuid,text,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.record_goods_stock_successor(text,uuid,text,uuid,uuid,integer,uuid) to postgres;

-- Dedicated one-option creation. The ordinary clone contract deliberately creates
-- every source option with zero stock and is not a conversion implementation.
create function private.create_goods_group_product(p_source_good_id text,p_source_variant_id uuid,p_name text,p_actor uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare
 source_good public.goods;source_variant public.goods_variants;category_value uuid;
 source_variants jsonb;target_payload jsonb;source_attribute_entries jsonb;clone_attribute_fields jsonb;clone_attribute_revision integer;
 clone_attribute_submission jsonb;clone_attribute_entries jsonb;saved jsonb;saved_id text;actor_id uuid:=p_actor;
 category_ids uuid[];
begin
 select * into source_good from public.goods where id=p_source_good_id;
 select * into source_variant from public.goods_variants where id=p_source_variant_id and good_id=p_source_good_id and archived_at is null;
 if source_good.id is null or source_variant.id is null or p_actor is distinct from auth.uid()
   or p_name is null or char_length(p_name) not between 1 and 200 then
  raise check_violation using message='goods_group_source_invalid';end if;
 category_value:=source_good.category_id;
 if category_value is not null and not exists(select 1 from public.catalog_categories c where c.id=category_value and c.archived_at is null
  and not exists(select 1 from public.catalog_categories child where child.parent_id=c.id and child.archived_at is null)) then
  raise check_violation using message='goods_group_category_review_required';end if;
 source_variants:=jsonb_build_array(jsonb_build_object('name','기본 옵션','attributes','{}'::jsonb,'extraPrice',0,'stockQty',0,
   'isActive',true,'lowStockThreshold',source_variant.low_stock_threshold));
  target_payload := pg_catalog.jsonb_build_object(
    'id', null,
    'code', null,
    'ip_id', source_good.ip_id,
    'name', p_name,
    'name_en', source_good.name_en,
    'type', source_good.type,
    'origin_id', source_good.origin_id,
    'shipping_fee_type', source_good.shipping_fee_type,
    'individual_fee', source_good.individual_fee,
    'allow_card_payment', source_good.allow_card_payment,
    'allow_bank_transfer', source_good.allow_bank_transfer,
    'sale_restriction', source_good.sale_restriction,
    'order_quantity_limit_enabled', source_good.order_quantity_limit_enabled,
    'min_order_qty', source_good.min_order_qty,
    'max_order_qty', source_good.max_order_qty,
    'member_purchase_limit_enabled', source_good.member_purchase_limit_enabled,
    'member_lifetime_qty_limit', source_good.member_lifetime_qty_limit,
    'claim_policy', jsonb_build_object('returnAllowed',source_good.claim_return_allowed,
      'exchangeAllowed',source_good.claim_exchange_allowed,'restrictionReason',source_good.claim_restriction_reason,
      'returnFee',source_good.claim_return_fee,'returnFreeShippingFee',source_good.claim_return_free_shipping_fee,
      'exchangeFee',source_good.claim_exchange_fee),
    'price', source_variant.price,
    'compare_at_price', case when source_good.compare_at_price is null then null else source_good.compare_at_price+(source_variant.price-source_good.price) end,
    'badge', source_good.badge,
    'stock', 'ok',
    'bg', source_good.bg,
    'image_path', null,
    'notice_maker', source_good.notice_maker,
    'notice_origin', source_good.notice_origin,
    'notice_material', source_good.notice_material,
    'notice_size', source_good.notice_size,
    'notice_made_on', source_good.notice_made_on,
    'notice_as_manager', source_good.notice_as_manager,
    'notice_as_contact', source_good.notice_as_contact,
    'description', source_good.description,
    'description_format', source_good.description_format,
    'description_image_paths', '[]'::jsonb,
    'gallery_paths', '[]'::jsonb,
    'detail_image_path', null,
    'search_keywords', coalesce(to_jsonb(source_good.search_keywords), '[]'::jsonb),
    'category_id', category_value,
    'publish', false,
    'variants', source_variants,
    'variant_baseline', '[]'::jsonb
  );

  select entries into source_attribute_entries from public.goods_attribute_values where good_id=source_good.id for share;
  select fields,revision into clone_attribute_fields,clone_attribute_revision
    from public.catalog_category_attribute_schemas where category_id=category_value for share;
  source_attribute_entries:=coalesce(source_attribute_entries,'[]');
  clone_attribute_fields:=coalesce(clone_attribute_fields,'[]');
  clone_attribute_submission:=jsonb_build_object('categoryId',category_value,'schemaRevision',coalesce(clone_attribute_revision,0),
    'expectedRevision',0,'values',coalesce((select jsonb_object_agg(entry#>>'{field,id}',entry->'value')
      from jsonb_array_elements(source_attribute_entries) entry
      where exists(select 1 from jsonb_array_elements(clone_attribute_fields) field where field->>'id'=entry#>>'{field,id}'
        and field->>'kind'=entry#>>'{field,kind}' and field->>'unit'=entry#>>'{field,unit}'
        and private.goods_attribute_value_valid(field,entry->'value'))),'{}'),
    'removeIds','[]'::jsonb);
  clone_attribute_entries:=private.merge_goods_attributes(source_attribute_entries,clone_attribute_fields,clone_attribute_submission->'values','[]');
  target_payload:=target_payload||jsonb_build_object('product_attributes',clone_attribute_submission);
  saved := public.admin_save_good(target_payload);

  saved_id := saved ->> 'id';
  if saved_id is null then
    raise check_violation using message = 'goods_clone_result_missing';
  end if;


  -- Creation remains one transaction/version, including values retained after a
  -- source category change. Publication still exposes only matching definitions.
  update public.goods_attribute_values set entries=clone_attribute_entries
    where good_id=saved_id and entries is distinct from clone_attribute_entries;
  if clone_attribute_entries<>'[]'::jsonb then
    insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'catalog.goods_attributes_cloned','goods:'||saved_id,
      jsonb_build_object('sourceGoodId',source_good.id,'after',clone_attribute_entries,'revision',1));
  end if;

  perform private.clone_goods_benefit_content(source_good.id,saved_id,actor_id);

  perform private.clone_goods_after_sales_content(source_good.id,saved_id,actor_id);

  perform private.clone_goods_size_chart(source_good.id,saved_id,actor_id);
  insert into private.goods_artwork_copy_authorizations(transaction_id,target_good_id,source_good_id,actor_id,allowed_paths)
    values(txid_current(),saved_id,source_good.id,actor_id,
      array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.gallery_paths,'{}')||coalesce(source_good.description_image_paths,'{}'),null));
  update public.goods set image_path=source_good.image_path,gallery_paths=source_good.gallery_paths,
    detail_image_path=source_good.detail_image_path,description_image_paths=source_good.description_image_paths where id=saved_id;
  delete from private.goods_artwork_copy_authorizations where transaction_id=txid_current() and target_good_id=saved_id;

  -- Shipping notice is an immutable snapshot on the source good. Applying the
  -- exact references/snapshot avoids resolving a later template revision.
  update public.goods
  set shipping_notice_template_id = source_good.shipping_notice_template_id,
      shipping_notice_template_version = source_good.shipping_notice_template_version,
      shipping_notice_snapshot = source_good.shipping_notice_snapshot
  where id = saved_id;


 update public.goods copied set custom_inputs_enabled=source_good.custom_inputs_enabled,custom_input_fields=source_good.custom_input_fields,
  show_discount_rate=source_good.show_discount_rate,sale_starts_at=source_good.sale_starts_at,sale_ends_at=source_good.sale_ends_at,
  shipping_settings_template_id=source_good.shipping_settings_template_id,
  shipping_settings_template_revision=source_good.shipping_settings_template_revision,shipping_settings_snapshot=source_good.shipping_settings_snapshot
 where copied.id=saved_id;
 select coalesce(array_agg(m.category_id),'{}'::uuid[]) into category_ids from public.goods_additional_categories m
  join public.catalog_categories c on c.id=m.category_id where m.good_id=p_source_good_id and c.archived_at is null;
 perform private.apply_goods_additional_categories(saved_id,category_ids);
 insert into private.goods_listing_colors(good_id,colors,revision)
  select saved_id,colors,1 from private.goods_listing_colors where good_id=p_source_good_id;
 insert into private.goods_additional_sets(good_id,revision,updated_by)
  select saved_id,1,p_actor from private.goods_additional_sets where good_id=p_source_good_id;
 insert into private.goods_additional_links(base_good_id,target_good_id,sort_order)
  select saved_id,target_good_id,sort_order from private.goods_additional_links where base_good_id=p_source_good_id;
 perform 1 from private.goods_media_assets where id in(select video_asset_id from private.goods_media_bindings where good_id=p_source_good_id
  union select shortclip_asset_id from private.goods_media_bindings where good_id=p_source_good_id) order by id for share;
 if exists(select 1 from private.goods_media_bindings b join private.goods_media_assets a on a.id in(b.video_asset_id,b.shortclip_asset_id)
   where b.good_id=p_source_good_id and a.status<>'attached') then
  raise check_violation using message='goods_group_media_unavailable';end if;
 insert into private.goods_media_bindings(good_id,video_asset_id,video_title,shortclip_asset_id,shortclip_title,revision)
  select saved_id,video_asset_id,video_title,shortclip_asset_id,shortclip_title,1 from private.goods_media_bindings where good_id=p_source_good_id;
 insert into private.goods_group_write_authorizations(transaction_id,good_id,actor_id) values(txid_current(),saved_id,p_actor);
 return saved_id;
end;
$$;
revoke all on function private.create_goods_group_product(text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_goods_group_product(text,uuid,text,uuid) to postgres;

create function private.require_goods_group_identity(p_actor uuid,p_session_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_operator_capability('catalog.manage',false);
 if p_actor is null or p_actor is distinct from auth.uid() or p_session_id is null
  or auth.jwt()->>'session_id' is distinct from p_session_id::text then
  raise insufficient_privilege using message='goods_group_auth_changed';end if;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_actor
  and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='goods_group_auth_changed';end if;
end;
$$;
revoke all on function private.require_goods_group_identity(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.require_goods_group_identity(uuid,uuid) to postgres;

create function private.validate_goods_group_conversion(p_request jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare axes text[];row jsonb;vals text[];
begin
 if jsonb_typeof(p_request) is distinct from 'object'
  or not (p_request ?& array['sourceGoodId','name','optionNames','selections'])
  or (select count(*) from jsonb_object_keys(p_request))<>4
  or jsonb_typeof(p_request->'sourceGoodId') is distinct from 'string'
  or coalesce(p_request->>'sourceGoodId','')!~'^[a-z0-9][a-z0-9-]{0,63}$'
  or jsonb_typeof(p_request->'name') is distinct from 'string'
  or p_request->>'name'<>btrim(p_request->>'name')
  or not private.goods_group_valid_labels(array[p_request->>'name'],40)
  or jsonb_typeof(p_request->'optionNames') is distinct from 'array'
  or jsonb_typeof(p_request->'selections') is distinct from 'array' then
  raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
 if jsonb_array_length(p_request->'optionNames') not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_request->'optionNames') v where jsonb_typeof(v)<>'string')
  or jsonb_array_length(p_request->'selections') not between 2 and 100 then
  raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
 axes:=array(select jsonb_array_elements_text(p_request->'optionNames'));
 if not private.goods_group_valid_labels(axes,40) or (select count(distinct v) from unnest(axes) v)<>cardinality(axes) then
  raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
 for row in select value from jsonb_array_elements(p_request->'selections') loop
  if jsonb_typeof(row) is distinct from 'object' or not (row ?& array['variantId','values'])
   or (select count(*) from jsonb_object_keys(row))<>2
   or jsonb_typeof(row->'variantId') is distinct from 'string'
   or coalesce(row->>'variantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(row->'values') is distinct from 'array' then
   raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
  if jsonb_array_length(row->'values')<>cardinality(axes)
   or exists(select 1 from jsonb_array_elements(row->'values') v where jsonb_typeof(v)<>'string') then
   raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
  vals:=array(select jsonb_array_elements_text(row->'values'));
  if not private.goods_group_valid_labels(vals,80)
   or char_length(p_request->>'name'||' '||array_to_string(vals,' / '))>200 then
   raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
 end loop;
 if (select count(distinct v->>'variantId') from jsonb_array_elements(p_request->'selections') v)<>jsonb_array_length(p_request->'selections')
  or (select count(distinct v->'values') from jsonb_array_elements(p_request->'selections') v)<>jsonb_array_length(p_request->'selections') then
  raise invalid_parameter_value using message='invalid_goods_group_conversion';end if;
end;
$$;
revoke all on function private.validate_goods_group_conversion(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.validate_goods_group_conversion(jsonb) to postgres;

create function private.goods_group_conversion_blockers(p_good_id text) returns text[]
language sql stable security invoker set search_path='' as $$
 select array_remove(array[
  case when not exists(select 1 from public.goods where id=p_good_id and archived_at is null) then 'source_unavailable' end,
  case when exists(select 1 from private.goods_group_members where good_id=p_good_id) then 'already_grouped' end,
  case when exists(select 1 from public.goods_variants where good_id=p_good_id and preorder_policy_id is not null)
   then 'preorder_policy_attached' end,
  case when exists(select 1 from private.goods_subscription_policies where good_id=p_good_id and enabled)
   or exists(select 1 from private.goods_subscription_plans p join private.goods_subscription_terms t on t.id=p.current_terms_id
    where p.state in('awaiting_first_payment','active','paused','needs_confirmation')
     and exists(select 1 from jsonb_array_elements(t.selection) line where line->>'goodId'=p_good_id)) then 'subscription_active' end,
  case when exists(select 1 from private.gift_items item join private.gift_intents gift on gift.id=item.gift_id
    where item.good_id=p_good_id and gift.state in('awaiting_acceptance','accepted') and gift.order_id is null)
   then 'gift_pending' end,
  case when exists(select 1 from public.order_items item join public.orders o on o.id=item.order_id
    where item.good_id=p_good_id and o.status='pending')
   or exists(select 1 from public.order_items item join public.payment_attempts attempt on attempt.ref_id=item.order_id and attempt.purpose='order'
    where item.good_id=p_good_id and attempt.state in('prepared','confirming','unknown','needs_review')) then 'payment_pending' end,
  case when exists(select 1 from public.goods_variants v join private.goods_variant_purchase_costs c on c.variant_id=v.id
    where v.good_id=p_good_id and c.unit_cost_krw is not null) and not private.can_manage_goods_purchase_costs()
   then 'purchase_cost_permission_required' end,
  case when exists(select 1 from public.goods g where g.id=p_good_id and g.category_id is not null
    and not exists(select 1 from public.catalog_categories c where c.id=g.category_id and c.archived_at is null
      and not exists(select 1 from public.catalog_categories child where child.parent_id=c.id and child.archived_at is null)))
   then 'category_review_required' end
 ],null);
$$;
revoke all on function private.goods_group_conversion_blockers(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_conversion_blockers(text) to postgres;

-- All amounts requiring separate authority remain private. The fingerprint uses
-- only a cost revision and never returns purchase cost in a plan or audit row.
create function private.goods_group_source_hash(p_good_id text) returns text
language sql stable security invoker set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object(
  'good',(select to_jsonb(g) from public.goods g where id=p_good_id),
  'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.goods_variants v where good_id=p_good_id),
  'periods',(select jsonb_agg(to_jsonb(p) order by p.id) from private.goods_variant_price_periods p where good_id=p_good_id),
  'external',(select jsonb_agg(to_jsonb(e) order by e.variant_id) from private.goods_variant_external_identity e
    join public.goods_variants v on v.id=e.variant_id where v.good_id=p_good_id),
  'costRevisions',(select jsonb_agg(jsonb_build_array(c.variant_id,c.revision) order by c.variant_id) from private.goods_variant_purchase_costs c
    join public.goods_variants v on v.id=c.variant_id where v.good_id=p_good_id),
  'attributes',(select to_jsonb(a) from public.goods_attribute_values a where good_id=p_good_id),
  'categorySchema',(select to_jsonb(s) from public.catalog_category_attribute_schemas s join public.goods g on g.category_id=s.category_id where g.id=p_good_id),
  'additionalCategories',(select jsonb_agg(category_id order by category_id) from public.goods_additional_categories where good_id=p_good_id),
  'benefit',(select to_jsonb(b) from private.goods_benefit_content b where good_id=p_good_id),
  'afterSales',(select to_jsonb(a) from private.goods_after_sales_content a where good_id=p_good_id),
  'sizeChart',(select to_jsonb(s) from private.goods_size_charts s where good_id=p_good_id),
  'media',(select to_jsonb(m) from private.goods_media_bindings m where good_id=p_good_id),
  'listing',(select to_jsonb(c) from private.goods_listing_colors c where good_id=p_good_id),
  'additional',(select jsonb_agg(to_jsonb(a) order by a.sort_order,a.target_good_id) from private.goods_additional_links a where base_good_id=p_good_id),
  'owner',private.goods_aggregation_owner(p_good_id),
  'sharedPolicy',private.goods_aggregation_shared_policy(p_good_id),
  'transactions',(select to_jsonb(c) from private.goods_transaction_configs c where good_id=private.goods_aggregation_owner(p_good_id)),
  'kc',(select to_jsonb(k) from private.goods_kc_reviews k where good_id=p_good_id),
  'blockers',private.goods_group_conversion_blockers(p_good_id)
 )::text,'sha256'),'hex');
$$;
revoke all on function private.goods_group_source_hash(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_source_hash(text) to postgres;

create function private.goods_group_lock_conversion_source(p_good_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare source_ip text;
begin
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 if not pg_try_advisory_xact_lock(hashtextextended('goods-additional-graph',0)) then
  raise sqlstate 'PT409' using message='goods_group_retry';end if;
 perform private.lock_catalog_category_tree();
 perform 1 from public.goods where id in(p_good_id,private.goods_aggregation_owner(p_good_id)) order by id for update;
 perform 1 from public.goods_variants where good_id=p_good_id order by id for update;
 select ip_id into source_ip from public.goods where id=p_good_id;
 if source_ip is null then raise no_data_found using message='goods_group_source_not_found';end if;
 perform 1 from public.ips where id=source_ip for update nowait;
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;
revoke all on function private.goods_group_lock_conversion_source(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_lock_conversion_source(text) to postgres;

create function public.admin_preview_goods_group_conversion(p_request jsonb,p_expected_actor_id uuid,p_expected_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source_id text;preview private.goods_group_conversion_previews;plan jsonb;blockers text[];
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 perform private.validate_goods_group_conversion(p_request);
 source_id:=p_request->>'sourceGoodId';
 perform private.goods_group_lock_conversion_source(source_id);
 blockers:=private.goods_group_conversion_blockers(source_id);
 if cardinality(blockers)>0 then return jsonb_build_object('state','blocked','blockers',to_jsonb(blockers));end if;
 if exists(select 1 from jsonb_array_elements(p_request->'selections') s
  left join public.goods_variants v on v.id=(s->>'variantId')::uuid and v.good_id=source_id and v.archived_at is null
  where v.id is null) then raise check_violation using message='goods_group_selection_changed';end if;
 plan:=jsonb_build_object('sourceGoodId',source_id,'name',p_request->'name','optionNames',p_request->'optionNames',
  'members',(select jsonb_agg(jsonb_build_object('sourceVariantId',v.id,'sourceVariantName',v.name,'values',s.value->'values',
    'retainsGoodId',s.ordinality=1,'goodId',case when s.ordinality=1 then source_id end,
    'price',v.price,'stockQty',v.stock_qty,'name',p_request->>'name'||' '||array_to_string(array(select jsonb_array_elements_text(s.value->'values')),' / ')) order by s.ordinality)
    from jsonb_array_elements(p_request->'selections') with ordinality s(value,ordinality)
    join public.goods_variants v on v.id=(s.value->>'variantId')::uuid),
  'unselectedOptions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'stockQty',v.stock_qty) order by v.sort_order,v.id)
    from public.goods_variants v where v.good_id=source_id and v.archived_at is null
      and not exists(select 1 from jsonb_array_elements(p_request->'selections') s where s->>'variantId'=v.id::text)),'[]'::jsonb),
  'requiresKcReview',true,'allProductsUnpublished',true,'aggregationPreserved',true,
  'historicalOrdersPreserved',true,'unselectedStockPreserved',true,'activeCartSelectionsRequireReview',true);
 insert into private.goods_group_conversion_previews(actor_id,session_id,request,source_hash,public_plan)
 values(p_expected_actor_id,p_expected_session_id,p_request,private.goods_group_source_hash(source_id),plan) returning * into preview;
 return jsonb_build_object('state','ready','previewId',preview.id,'expiresAt',preview.expires_at,'plan',preview.public_plan);
end;
$$;
revoke all on function public.admin_preview_goods_group_conversion(jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_group_conversion(jsonb,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_goods_group_conversion(jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);

create function private.goods_group_snapshot(p_group_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'optionNames',to_jsonb(g.option_names),'commonGoodId',g.common_good_id,
  'revision',g.revision,'archivedAt',g.archived_at,
  'members',coalesce((select jsonb_agg(jsonb_build_object('goodId',m.good_id,'variantId',m.variant_id,'values',to_jsonb(m.option_values),
   'sortOrder',m.sort_order,'name',good.name,'code',good.code,'price',v.price,'stockQty',v.stock_qty,
   'publishedAt',good.published_at,'archivedAt',good.archived_at) order by m.sort_order,m.good_id)
   from private.goods_group_members m join public.goods good on good.id=m.good_id join public.goods_variants v on v.id=m.variant_id
   where m.group_id=g.id),'[]'::jsonb)) from private.goods_groups g where g.id=p_group_id;
$$;
revoke all on function private.goods_group_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_snapshot(uuid) to postgres;

create function public.admin_confirm_goods_group_conversion(p_preview_id uuid,p_operation_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare preview private.goods_group_conversion_previews;prior private.goods_group_operations;
 source_good public.goods;source_variant public.goods_variants;cost private.goods_variant_purchase_costs;
 external_row private.goods_variant_external_identity;source_id text;first_variant_id uuid;first_price integer;
 group_id uuid:=gen_random_uuid();request_hash text;selection record;target_good_id text;target_variant_id uuid;
 members jsonb:='[]';new_ids text[]:='{}';target_name text;target_values text[];family_id uuid;v_receipt jsonb;before_stock bigint;after_stock bigint;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_preview_id is null or p_operation_id is null then raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 request_hash:=encode(extensions.digest(jsonb_build_array('convert',p_preview_id)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into prior from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id<>p_expected_actor_id or prior.session_id<>p_expected_session_id or prior.command<>'convert'
   or prior.request_hash<>request_hash or prior.receipt is null then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return prior.receipt;
 end if;
 select * into preview from private.goods_group_conversion_previews where id=p_preview_id for update;
 if not found or preview.actor_id<>p_expected_actor_id or preview.session_id<>p_expected_session_id then
  raise insufficient_privilege using message='goods_group_preview_unavailable';end if;
 if preview.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='goods_group_preview_expired';end if;
 source_id:=preview.request->>'sourceGoodId';
 perform private.goods_group_lock_conversion_source(source_id);
 if preview.source_hash is distinct from private.goods_group_source_hash(source_id)
  or cardinality(private.goods_group_conversion_blockers(source_id))>0 then
  raise sqlstate 'PT409' using message='goods_group_source_changed';end if;
 select * into source_good from public.goods where id=source_id;
 select sum(stock_qty::bigint) into before_stock from public.goods_variants where good_id=source_id;
 first_variant_id:=(preview.request#>>'{selections,0,variantId}')::uuid;
 select price into first_price from public.goods_variants where id=first_variant_id and good_id=source_id and archived_at is null;
 if first_price is null then raise sqlstate 'PT409' using message='goods_group_source_changed';end if;
 insert into private.goods_group_operations(operation_id,actor_id,session_id,command,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,'convert',request_hash);
 insert into private.goods_group_write_authorizations(transaction_id,good_id,actor_id) values(txid_current(),source_id,p_expected_actor_id);
 -- Every resulting product is reviewed before publication, including the source
 -- whose name/options changed. Historical public slugs and first-publication dates remain.
 update public.goods set published_at=null where id=source_id;
 perform private.invalidate_goods_kc_review(source_id,'goods_group_converted');
 for selection in select value,ordinality from jsonb_array_elements(preview.request->'selections') with ordinality loop
  select * into source_variant from public.goods_variants where id=(selection.value->>'variantId')::uuid and good_id=source_id and archived_at is null;
  if not found then raise sqlstate 'PT409' using message='goods_group_source_changed';end if;
  target_values:=array(select jsonb_array_elements_text(selection.value->'values'));
  target_name:=preview.request->>'name'||' '||array_to_string(target_values,' / ');
  if selection.ordinality=1 then target_good_id:=source_id;target_variant_id:=first_variant_id;
  else
   target_good_id:=private.create_goods_group_product(source_id,source_variant.id,target_name,p_expected_actor_id);
   select id into target_variant_id from public.goods_variants where good_id=target_good_id and is_default and archived_at is null;
   if target_variant_id is null then raise check_violation using message='goods_group_result_missing';end if;
   new_ids:=array_append(new_ids,target_good_id);
   insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)
    select target_good_id,target_variant_id,state,regular_price,discount_price,starts_at,ends_at,p_expected_actor_id,p_expected_actor_id
    from private.goods_variant_price_periods where variant_id=source_variant.id and state in('active','draft') order by id;
   select * into cost from private.goods_variant_purchase_costs where variant_id=source_variant.id;
   if found and cost.unit_cost_krw is not null then
    perform private.save_goods_variant_purchase_cost(target_good_id,target_variant_id,cost.unit_cost_krw,cost.tax_basis,null);
   end if;
   select * into external_row from private.goods_variant_external_identity where variant_id=source_variant.id for update;
   if found then
    insert into private.goods_group_external_identity_moves(source_variant_id,target_variant_id,operation_id,before_value,actor_id)
    values(source_variant.id,target_variant_id,p_operation_id,to_jsonb(external_row),p_expected_actor_id);
    delete from private.goods_variant_external_identity where variant_id=source_variant.id;
    insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
     values(target_variant_id,external_row.erp_code,external_row.erp_name,external_row.barcode);
   end if;
   if source_variant.stock_qty>0 then
    perform private.change_goods_variant_stock(source_id,source_variant.id,-source_variant.stock_qty::bigint);
    perform private.change_goods_variant_stock(target_good_id,target_variant_id,source_variant.stock_qty::bigint);
   end if;
  end if;
  members:=members||jsonb_build_array(jsonb_build_object('sourceVariantId',source_variant.id,'goodId',target_good_id,'variantId',target_variant_id,
    'values',to_jsonb(target_values),'sortOrder',selection.ordinality-1,'movedQty',case when selection.ordinality=1 then 0 else source_variant.stock_qty end));
 end loop;
 family_id:=private.bind_goods_aggregation(source_id,new_ids,p_operation_id,p_expected_actor_id);
 update private.goods_variant_price_periods set state='disabled',updated_by=p_expected_actor_id,updated_at=clock_timestamp()
  where good_id=source_id and variant_id<>first_variant_id and state='active';
 -- No old option is physically deleted. Even unselected, never-ordered options
 -- retain their quantities and immutable identity for a later explicit decision.
 update public.goods_variants set is_default=false where good_id=source_id and is_default;
 update public.goods_variants set archived_at=coalesce(archived_at,clock_timestamp()) where good_id=source_id and id<>first_variant_id;
 update public.goods_variants set is_default=true,name='기본 옵션',attributes='{}',sort_order=0 where id=first_variant_id;
 update public.goods set name=preview.request->>'name'||' '||array_to_string(array(select jsonb_array_elements_text(preview.request#>'{selections,0,values}')),' / '),
  price=first_price,compare_at_price=case when source_good.compare_at_price is null then null else source_good.compare_at_price+(first_price-source_good.price) end
  where id=source_id;
 for selection in select value from jsonb_array_elements(members) loop
  if selection.value->>'goodId'<>source_id then
   perform private.record_goods_stock_successor(source_id,(selection.value->>'sourceVariantId')::uuid,selection.value->>'goodId',
    (selection.value->>'variantId')::uuid,p_operation_id,(selection.value->>'movedQty')::integer,p_expected_actor_id);
  end if;
 end loop;
 insert into private.goods_groups(id,name,option_names,common_good_id,created_by,updated_by)
 values(group_id,preview.request->>'name',array(select jsonb_array_elements_text(preview.request->'optionNames')),source_id,p_expected_actor_id,p_expected_actor_id);
 insert into private.goods_group_members(group_id,good_id,variant_id,option_values,sort_order)
 select group_id,m->>'goodId',(m->>'variantId')::uuid,array(select jsonb_array_elements_text(m->'values')),(m->>'sortOrder')::integer
 from jsonb_array_elements(members) m;
 select sum(stock_qty::bigint) into after_stock from public.goods_variants where good_id=any(array_append(new_ids,source_id));
 if before_stock is distinct from after_stock then raise check_violation using message='goods_group_stock_conservation_failed';end if;
 v_receipt:=jsonb_build_object('state','completed','operationId',p_operation_id,'group',private.goods_group_snapshot(group_id),'aggregationId',family_id);
 insert into private.goods_group_changes(group_id,operation_id,actor_id,revision,after_value)
 values(group_id,p_operation_id,p_expected_actor_id,1,v_receipt->'group');
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'catalog.goods_group.converted','goods_group:'||group_id::text,
  jsonb_build_object('sourceGoodId',source_id,'previewId',p_preview_id,'members',members,'stockBefore',before_stock,'stockAfter',after_stock,'aggregationId',family_id));
 update private.goods_group_operations set receipt=v_receipt,completed_at=clock_timestamp() where operation_id=p_operation_id;
 delete from private.goods_group_write_authorizations where transaction_id=txid_current() and actor_id=p_expected_actor_id and good_id=any(array_append(new_ids,source_id));
 return v_receipt;
end;
$$;
revoke all on function public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);

create function private.guard_goods_group_operation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or old.completed_at is not null
  or (to_jsonb(new)-'receipt'-'completed_at') is distinct from (to_jsonb(old)-'receipt'-'completed_at')
  or new.receipt is null or new.completed_at is null then
  raise check_violation using message='goods_group_operation_immutable';end if;
 return new;
end;
$$;
revoke all on function private.guard_goods_group_operation() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_group_operation() to postgres;
create trigger goods_group_operation_immutable before update or delete on private.goods_group_operations
 for each row execute function private.guard_goods_group_operation();

create function public.admin_read_goods_group_conversion(p_preview_id uuid,p_operation_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid,p_seal boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.goods_group_operations;expected_hash text;result jsonb;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_preview_id is null or p_operation_id is null or p_seal is null then raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 expected_hash:=encode(extensions.digest(jsonb_build_array('convert',p_preview_id)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into previous from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.command<>'convert'
   or previous.request_hash<>expected_hash then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return previous.receipt;
 end if;
 if not exists(select 1 from private.goods_group_conversion_previews where id=p_preview_id and actor_id=p_expected_actor_id and session_id=p_expected_session_id) then
  raise insufficient_privilege using message='goods_group_preview_unavailable';end if;
 if p_seal then
  result:=jsonb_build_object('state','sealed','operationId',p_operation_id);
  insert into private.goods_group_operations(operation_id,actor_id,session_id,command,request_hash,receipt,completed_at)
  values(p_operation_id,p_expected_actor_id,p_expected_session_id,'convert',expected_hash,result,clock_timestamp());
  return result;
 end if;
 return jsonb_build_object('state','unresolved','operationId',p_operation_id);
end;
$$;
revoke all on function public.admin_read_goods_group_conversion(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_group_conversion(uuid,uuid,uuid,uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_read_goods_group_conversion(uuid,uuid,uuid,uuid,boolean)'::regprocedure,'catalog.manage','write',false);

create function private.guard_goods_stock_successor_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.archived_at is null and exists(select 1 from private.goods_stock_successors where source_variant_id=new.id) then
  raise check_violation using message='goods_group_old_variant_retired';end if;
 return new;
end;
$$;
revoke all on function private.guard_goods_stock_successor_source() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_stock_successor_source() to postgres;
create trigger goods_stock_successor_source_guard before update of archived_at on public.goods_variants
 for each row execute function private.guard_goods_stock_successor_source();

-- Deferred because the existing normal editor briefly clears the default flag
-- while updating its one retained option. The completed transaction must still
-- contain exactly the member's active default unit and no nested sales options.
create function private.check_goods_group_single_variant() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_id text;member private.goods_group_members;
begin
 target_id:=case when tg_op='DELETE' then old.good_id else new.good_id end;
 select * into member from private.goods_group_members where good_id=target_id;
 if not found then return null;end if;
 if (select count(*) from public.goods_variants where good_id=target_id and archived_at is null)<>1
  or not exists(select 1 from public.goods_variants where id=member.variant_id and good_id=target_id
   and archived_at is null and is_default and name='기본 옵션' and attributes='{}'::jsonb)
  or cardinality(member.option_values)<>(select cardinality(option_names) from private.goods_groups where id=member.group_id)
  or not exists(select 1 from public.goods good join private.goods_groups g on g.id=member.group_id where good.id=member.good_id
    and good.name=g.name||' '||array_to_string(member.option_values,' / ')) then
  raise check_violation using message='goods_group_single_variant_required';end if;
 return null;
end;
$$;
revoke all on function private.check_goods_group_single_variant() from public,anon,authenticated,service_role;
grant execute on function private.check_goods_group_single_variant() to postgres;
create constraint trigger goods_group_single_variant after insert or update or delete on public.goods_variants
 deferrable initially deferred for each row execute function private.check_goods_group_single_variant();
create constraint trigger goods_group_member_single_variant after insert or update on private.goods_group_members
 deferrable initially deferred for each row execute function private.check_goods_group_single_variant();

create function private.guard_goods_group_name() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.goods_group_members where good_id=old.id) then
  if new.id is distinct from old.id then raise check_violation using message='goods_group_identity_immutable';end if;
  if new.name is distinct from old.name and not exists(select 1 from private.goods_group_write_authorizations
   where transaction_id=txid_current() and good_id=old.id and actor_id=auth.uid()) then
   raise check_violation using message='goods_group_name_owned_by_group';end if;
 end if;
 return new;
end;
$$;
revoke all on function private.guard_goods_group_name() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_group_name() to postgres;
create trigger goods_group_name_guard before update of id,name on public.goods
 for each row execute function private.guard_goods_group_name();

create function public.admin_get_goods_group(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.goods_group_snapshot(p_group_id);
end;
$$;
revoke all on function public.admin_get_goods_group(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_group(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_goods_group(uuid)'::regprocedure,'catalog.manage','read',false);

create function public.admin_search_goods_groups(p_query text default '',p_page integer default 1,p_page_size integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare query text:=btrim(coalesce(p_query,''));total bigint;rows jsonb;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if char_length(query)>100 or p_page is null or p_page not between 1 and 999999 or p_page_size is null or p_page_size not between 1 and 100 then
  raise invalid_parameter_value using message='invalid_goods_group_page';end if;
 select count(*) into total from private.goods_groups g where query='' or position(lower(query) in lower(g.name))>0
  or exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id
   where m.group_id=g.id and position(lower(query) in lower(good.id||' '||good.code||' '||good.name))>0);
 select coalesce(jsonb_agg(private.goods_group_snapshot(g.id) order by g.updated_at desc,g.id),'[]') into rows
 from(select g.id,g.updated_at from private.goods_groups g where query='' or position(lower(query) in lower(g.name))>0
   or exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id
    where m.group_id=g.id and position(lower(query) in lower(good.id||' '||good.code||' '||good.name))>0)
  order by g.updated_at desc,g.id limit p_page_size offset (p_page::bigint-1)*p_page_size) g;
 return jsonb_build_object('rows',rows,'total',total,'page',p_page,'pageSize',p_page_size);
end;
$$;
revoke all on function public.admin_search_goods_groups(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_groups(text,integer,integer) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_goods_groups(text,integer,integer)'::regprocedure,'catalog.manage','read',false);

create function public.admin_get_goods_group_source(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return(select jsonb_build_object('goodId',g.id,'name',g.name,'code',g.code,
  'groupId',(select group_id from private.goods_group_members where good_id=g.id),'blockers',to_jsonb(private.goods_group_conversion_blockers(g.id)),
  'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'attributes',v.attributes,'price',v.price,'stockQty',v.stock_qty,'code',v.code)
    order by v.is_default desc,v.sort_order,v.id) from public.goods_variants v where v.good_id=g.id and v.archived_at is null),'[]'))
  from public.goods g where g.id=p_good_id and g.archived_at is null);
end;
$$;
revoke all on function public.admin_get_goods_group_source(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_group_source(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_goods_group_source(text)'::regprocedure,'catalog.manage','read',false);

create function private.goods_group_common_identity(p_good_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('goods',(select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(g)) e(k,v)
   where k=any(array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
    'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords'])),
  'attributes',coalesce((select entries from public.goods_attribute_values where good_id=g.id),'[]'),
  'additionalCategories',coalesce((select jsonb_agg(category_id order by category_id) from public.goods_additional_categories where good_id=g.id),'[]'),
  'afterSales',(select jsonb_build_array(phone,guide,seller_special_notes) from private.goods_after_sales_content where good_id=g.id),
  'sizeChart',(select jsonb_build_array(enabled,chart) from private.goods_size_charts where good_id=g.id))
 from public.goods g where g.id=p_good_id;
$$;
revoke all on function private.goods_group_common_identity(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_common_identity(text) to postgres;

create function private.validate_goods_group_structure(p_values jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare axes text[];member jsonb;vals text[];
begin
 if jsonb_typeof(p_values) is distinct from 'object' or not (p_values ?& array['name','optionNames','members'])
  or (select count(*) from jsonb_object_keys(p_values))<>3
  or jsonb_typeof(p_values->'name') is distinct from 'string' or p_values->>'name'<>btrim(p_values->>'name')
  or not private.goods_group_valid_labels(array[p_values->>'name'],40)
  or jsonb_typeof(p_values->'optionNames') is distinct from 'array' or jsonb_typeof(p_values->'members') is distinct from 'array' then
  raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
 if jsonb_array_length(p_values->'optionNames') not between 1 and 3
  or exists(select 1 from jsonb_array_elements(p_values->'optionNames') v where jsonb_typeof(v)<>'string')
  or jsonb_array_length(p_values->'members') not between 1 and 100 then
  raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
 axes:=array(select jsonb_array_elements_text(p_values->'optionNames'));
 if not private.goods_group_valid_labels(axes,40) or (select count(distinct a) from unnest(axes) a)<>cardinality(axes) then
  raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
 for member in select value from jsonb_array_elements(p_values->'members') loop
  if jsonb_typeof(member) is distinct from 'object' or not (member ?& array['goodId','values'])
   or (select count(*) from jsonb_object_keys(member))<>2
   or jsonb_typeof(member->'goodId') is distinct from 'string' or coalesce(member->>'goodId','')!~'^[a-z0-9][a-z0-9-]{0,63}$'
   or jsonb_typeof(member->'values') is distinct from 'array' then
   raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
  if jsonb_array_length(member->'values')<>cardinality(axes)
   or exists(select 1 from jsonb_array_elements(member->'values') v where jsonb_typeof(v)<>'string') then
   raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
  vals:=array(select jsonb_array_elements_text(member->'values'));
  if not private.goods_group_valid_labels(vals,80) or char_length(p_values->>'name'||' '||array_to_string(vals,' / '))>200 then
   raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
 end loop;
 if (select count(distinct m->>'goodId') from jsonb_array_elements(p_values->'members') m)<>jsonb_array_length(p_values->'members')
  or (select count(distinct m->'values') from jsonb_array_elements(p_values->'members') m)<>jsonb_array_length(p_values->'members') then
  raise invalid_parameter_value using message='invalid_goods_group_structure';end if;
end;
$$;
revoke all on function private.validate_goods_group_structure(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.validate_goods_group_structure(jsonb) to postgres;

create function public.admin_save_goods_group(p_group_id uuid,p_expected_revision bigint,p_values jsonb,p_operation_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.goods_group_operations;existing private.goods_groups;expected_hash text;target_ids text[];lock_ids text[];
 common_id text;common_data jsonb;source_ip text;row record;unit_id uuid;before_value jsonb;result jsonb;current_command text;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 perform private.validate_goods_group_structure(p_values);
 if p_group_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then
  raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 current_command:=case when p_expected_revision=0 then 'create' else 'update' end;
 expected_hash:=encode(extensions.digest(jsonb_build_array(current_command,p_group_id,p_expected_revision,p_values)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into prior from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id<>p_expected_actor_id or prior.session_id<>p_expected_session_id or prior.command<>current_command
   or prior.target_group_id is distinct from p_group_id or prior.expected_revision is distinct from p_expected_revision
   or prior.receipt is null then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  if prior.receipt->>'state'='sealed' then return prior.receipt;end if;
  if prior.request_hash<>expected_hash then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return prior.receipt;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 perform private.lock_catalog_category_tree();
 select * into existing from private.goods_groups where id=p_group_id for update;
 if (existing.id is null and p_expected_revision<>0) or (existing.id is not null and existing.revision<>p_expected_revision)
  or existing.archived_at is not null then raise sqlstate 'PT409' using message='goods_group_changed';end if;
 if existing.id is null and jsonb_array_length(p_values->'members')<2 then
  raise check_violation using message='goods_group_members_required';end if;
 before_value:=private.goods_group_snapshot(p_group_id);
 target_ids:=array(select m->>'goodId' from jsonb_array_elements(p_values->'members') m);
 lock_ids:=array(select distinct id from(
  select unnest(target_ids) id union select good_id from private.goods_group_members where group_id=p_group_id
  union select private.goods_aggregation_owner(unnest(target_ids))) all_ids order by id);
 perform 1 from public.goods where id=any(lock_ids) order by id for update;
 perform 1 from public.goods_variants where good_id=any(lock_ids) order by good_id,id for update;
 for source_ip in select distinct ip_id from public.goods where id=any(target_ids) order by ip_id loop
  begin perform 1 from public.ips where id=source_ip for update nowait;
  exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';end;
 end loop;
 if (select count(*) from public.goods where id=any(target_ids) and archived_at is null)<>cardinality(target_ids)
  or exists(select 1 from private.goods_group_members where good_id=any(target_ids) and group_id<>p_group_id) then
  raise check_violation using message='goods_group_member_unavailable';end if;
 common_id:=case when existing.common_good_id=any(target_ids) then existing.common_good_id else target_ids[1] end;
 common_data:=private.goods_group_common_identity(common_id);
 if exists(select 1 from unnest(target_ids) id where private.goods_group_common_identity(id) is distinct from common_data) then
  raise check_violation using message='goods_group_common_information_differs';end if;
 if exists(select 1 from unnest(target_ids) target(id) where (select count(*) from public.goods_variants v where v.good_id=target.id and v.archived_at is null)<>1
  or not exists(select 1 from public.goods_variants v where v.good_id=target.id and v.archived_at is null and v.is_default)) then
  raise check_violation using message='goods_group_single_variant_required';end if;
 insert into private.goods_group_operations(operation_id,actor_id,session_id,command,target_group_id,expected_revision,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,current_command,p_group_id,p_expected_revision,expected_hash);
 insert into private.goods_group_write_authorizations(transaction_id,good_id,actor_id)
 select txid_current(),id,p_expected_actor_id from unnest(target_ids) id;
 if existing.id is null then
  insert into private.goods_groups(id,name,option_names,common_good_id,created_by,updated_by)
  values(p_group_id,p_values->>'name',array(select jsonb_array_elements_text(p_values->'optionNames')),common_id,p_expected_actor_id,p_expected_actor_id);
 else
  update private.goods_groups set name=p_values->>'name',option_names=array(select jsonb_array_elements_text(p_values->'optionNames')),
   common_good_id=common_id,revision=revision+1,updated_by=p_expected_actor_id,updated_at=clock_timestamp() where id=p_group_id;
 end if;
 delete from private.goods_group_members where group_id=p_group_id;
 for row in select value,ordinality from jsonb_array_elements(p_values->'members') with ordinality loop
  select id into unit_id from public.goods_variants where good_id=row.value->>'goodId' and archived_at is null and is_default;
  update public.goods set published_at=null,name=p_values->>'name'||' '||array_to_string(array(select jsonb_array_elements_text(row.value->'values')),' / ')
   where id=row.value->>'goodId';
  perform private.invalidate_goods_kc_review(row.value->>'goodId','goods_group_updated');
  update public.goods_variants set name='기본 옵션',attributes='{}' where id=unit_id;
  insert into private.goods_group_members(group_id,good_id,variant_id,option_values,sort_order)
  values(p_group_id,row.value->>'goodId',unit_id,array(select jsonb_array_elements_text(row.value->'values')),row.ordinality-1);
 end loop;
 result:=jsonb_build_object('state','completed','operationId',p_operation_id,'group',private.goods_group_snapshot(p_group_id));
 insert into private.goods_group_changes(group_id,operation_id,actor_id,revision,before_value,after_value)
 values(p_group_id,p_operation_id,p_expected_actor_id,(result#>>'{group,revision}')::bigint,before_value,result->'group');
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'catalog.goods_group.'||current_command,'goods_group:'||p_group_id::text,
  jsonb_build_object('before',before_value,'after',result->'group','aggregationRelationshipsPreserved',true));
 update private.goods_group_operations set receipt=result,completed_at=clock_timestamp() where operation_id=p_operation_id;
 delete from private.goods_group_write_authorizations where transaction_id=txid_current() and actor_id=p_expected_actor_id and good_id=any(target_ids);
 return result;
end;
$$;
revoke all on function public.admin_save_goods_group(uuid,bigint,jsonb,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_group(uuid,bigint,jsonb,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_goods_group(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);

create function public.admin_archive_goods_group(p_group_id uuid,p_expected_revision bigint,p_operation_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.goods_group_operations;current_group private.goods_groups;expected_hash text;before_value jsonb;result jsonb;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_group_id is null or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then
  raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 expected_hash:=encode(extensions.digest(jsonb_build_array('archive',p_group_id,p_expected_revision)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into prior from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id<>p_expected_actor_id or prior.session_id<>p_expected_session_id or prior.command<>'archive'
   or prior.target_group_id is distinct from p_group_id or prior.expected_revision is distinct from p_expected_revision
   or prior.receipt is null then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  if prior.receipt->>'state'='sealed' then return prior.receipt;end if;
  if prior.request_hash<>expected_hash then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return prior.receipt;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 select * into current_group from private.goods_groups where id=p_group_id for update;
 if not found or current_group.revision<>p_expected_revision or current_group.archived_at is not null then
  raise sqlstate 'PT409' using message='goods_group_changed';end if;
 before_value:=private.goods_group_snapshot(p_group_id);
 insert into private.goods_group_operations(operation_id,actor_id,session_id,command,target_group_id,expected_revision,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,'archive',p_group_id,p_expected_revision,expected_hash);
 delete from private.goods_group_members where group_id=p_group_id;
 update private.goods_groups set revision=revision+1,archived_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=p_expected_actor_id where id=p_group_id;
 result:=jsonb_build_object('state','completed','operationId',p_operation_id,'group',private.goods_group_snapshot(p_group_id));
 insert into private.goods_group_changes(group_id,operation_id,actor_id,revision,before_value,after_value)
 values(p_group_id,p_operation_id,p_expected_actor_id,current_group.revision+1,before_value,result->'group');
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'catalog.goods_group.archived','goods_group:'||p_group_id::text,
  jsonb_build_object('before',before_value,'after',result->'group','aggregationRelationshipsPreserved',true));
 update private.goods_group_operations set receipt=result,completed_at=clock_timestamp() where operation_id=p_operation_id;
 return result;
end;
$$;
revoke all on function public.admin_archive_goods_group(uuid,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_goods_group(uuid,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_archive_goods_group(uuid,bigint,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);

create function public.admin_read_goods_group_change(p_group_id uuid,p_expected_revision bigint,p_command text,p_operation_id uuid,
 p_expected_actor_id uuid,p_expected_session_id uuid,p_seal boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.goods_group_operations;result jsonb;expected_hash text;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_group_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_seal is null
  or p_command is null or p_command not in('create','update','common','archive')
  or (p_expected_revision=0) is distinct from (p_command='create') then
  raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into prior from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id<>p_expected_actor_id or prior.session_id<>p_expected_session_id or prior.command<>p_command
   or prior.target_group_id is distinct from p_group_id or prior.expected_revision is distinct from p_expected_revision
   or prior.receipt is null then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return prior.receipt;
 end if;
 if p_seal then
  expected_hash:=encode(extensions.digest(jsonb_build_array('sealed',p_command,p_group_id,p_expected_revision)::text,'sha256'),'hex');
  result:=jsonb_build_object('state','sealed','operationId',p_operation_id);
  insert into private.goods_group_operations(operation_id,actor_id,session_id,command,target_group_id,expected_revision,request_hash,receipt,completed_at)
  values(p_operation_id,p_expected_actor_id,p_expected_session_id,p_command,p_group_id,p_expected_revision,expected_hash,result,clock_timestamp());
  return result;
 end if;
 return jsonb_build_object('state','unresolved','operationId',p_operation_id);
end;
$$;
revoke all on function public.admin_read_goods_group_change(uuid,bigint,text,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_group_change(uuid,bigint,text,uuid,uuid,uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_read_goods_group_change(uuid,bigint,text,uuid,uuid,uuid,boolean)'::regprocedure,'catalog.manage','write',false);

create function private.goods_group_public_good(p_good_id text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_good_id
  and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
  and ip.archived_at is null and ip.published_at is not null);
$$;
revoke all on function private.goods_group_public_good(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_public_good(text) to postgres;

create function public.get_good_group(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'optionNames',to_jsonb(g.option_names),'currentGoodId',p_good_id,
  'members',(select jsonb_agg(jsonb_build_object('goodId',m.good_id,'values',to_jsonb(m.option_values),'sortOrder',m.sort_order)
   order by m.sort_order,m.good_id) from private.goods_group_members m
   where m.group_id=g.id and private.goods_group_public_good(m.good_id)))
 from private.goods_group_members current_member join private.goods_groups g on g.id=current_member.group_id
 where current_member.good_id=p_good_id and g.archived_at is null and private.goods_group_public_good(p_good_id);
$$;
revoke all on function public.get_good_group(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_group(text) to anon,authenticated;

create function private.goods_group_review_good_ids(p_good_id text) returns text[]
language sql stable security invoker set search_path='' as $$
 select case when not private.goods_group_public_good(p_good_id) then '{}'::text[] else
  coalesce((select array_agg(m.good_id order by m.sort_order,m.good_id)
   from private.goods_group_members current_member join private.goods_groups g on g.id=current_member.group_id and g.archived_at is null
   join private.goods_group_members m on m.group_id=g.id
   where current_member.good_id=p_good_id and private.goods_group_public_good(m.good_id)),array[p_good_id]) end;
$$;
revoke all on function private.goods_group_review_good_ids(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_group_review_good_ids(text) to postgres;

-- A single bounded read owns group review scope, full-set summary, filtering and
-- pagination. Original review/order/good identity and moderation stay intact.
create function public.get_good_group_reviews(p_good_id text,p_sort text default 'recent',p_photo_only boolean default false,
 p_limit integer default 10,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids text[];result jsonb;
begin
 if p_sort is null or p_sort not in('recent','rating_desc','rating_asc') or p_photo_only is null
  or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then
  raise invalid_parameter_value using message='invalid_goods_group_review_page';end if;
 ids:=private.goods_group_review_good_ids(p_good_id);
 with visible as materialized (
  select r.id,r.good_id,r.order_id,r.rating,r.body,r.image_paths,r.user_id,r.created_at,r.edited_at,r.admin_reply,r.admin_reply_at,
   coalesce(nullif(btrim(author.nickname),''),'fan_'||left(r.user_id::text,6)) author_name,
   coalesce((select item.good_name_snapshot from public.order_items item where item.order_id=r.order_id and item.good_id=r.good_id order by item.id limit 1),g.name) good_name,
   coalesce((select array_agg(distinct item.variant_name_snapshot order by item.variant_name_snapshot) from public.order_items item
    where item.order_id=r.order_id and item.good_id=r.good_id and item.variant_name_snapshot is not null),'{}'::text[]) variant_names
  from public.reviews r join public.profiles author on author.id=r.user_id join public.goods g on g.id=r.good_id
  where r.good_id=any(ids) and r.status='visible'
 ), filtered as materialized (
  select * from visible where not p_photo_only or cardinality(image_paths)>0
 ), page as (
  select * from filtered order by case when p_sort='rating_desc' then rating end desc nulls last,
    case when p_sort='rating_asc' then rating end asc nulls last,created_at desc,id desc limit p_limit offset p_offset
 ) select jsonb_build_object('grouped',exists(select 1 from private.goods_group_members where good_id=p_good_id) and cardinality(ids)>0,
  'summary',(select jsonb_build_object('count',count(*),'average',coalesce(round(avg(rating),2),0),
   'distribution',jsonb_build_array(count(*) filter(where rating=1),count(*) filter(where rating=2),count(*) filter(where rating=3),count(*) filter(where rating=4),count(*) filter(where rating=5)),
   'photoCount',count(*) filter(where cardinality(image_paths)>0)) from visible),
  'total',(select count(*) from filtered),
  'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',id,'goodId',good_id,'goodName',good_name,'variantNames',to_jsonb(variant_names),
   'rating',rating,'body',body,'imagePaths',to_jsonb(coalesce(image_paths,'{}'::text[])),'authorName',author_name,
   'isMine',auth.uid() is not null and user_id=auth.uid(),'createdAt',created_at,'editedAt',edited_at,'adminReply',admin_reply,'adminReplyAt',admin_reply_at)
   order by case when p_sort='rating_desc' then rating end desc nulls last,
    case when p_sort='rating_asc' then rating end asc nulls last,created_at desc,id desc) from page),'[]'::jsonb)) into result;
 return result;
end;
$$;
revoke all on function public.get_good_group_reviews(text,text,boolean,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_good_group_reviews(text,text,boolean,integer,integer) to anon,authenticated;

-- Fulfillment presentation reads the same financial owner as checkout. Customer
-- service/claim notices remain the actual selected product's content.
do $patch$ declare definition text;anchor text;begin
 definition:=pg_get_functiondef('public.get_good_shipping_policy(text)'::regprocedure);
 foreach anchor in array array['''feeType'', good.shipping_fee_type','''individualFee'', good.individual_fee',
  'join public.fulfillment_origins origin on origin.id = good.origin_id and origin.is_active'] loop
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'goods_group_shipping_reader_anchor_changed';end if;
 end loop;
 definition:=replace(definition,'''feeType'', good.shipping_fee_type','''feeType'', policy_good.shipping_fee_type');
 definition:=replace(definition,'''individualFee'', good.individual_fee','''individualFee'', policy_good.individual_fee');
 definition:=replace(definition,'join public.fulfillment_origins origin on origin.id = good.origin_id and origin.is_active',
  E'join public.goods policy_good on policy_good.id = private.goods_aggregation_owner(good.id)\n  join public.fulfillment_origins origin on origin.id = policy_good.origin_id and origin.is_active');
 execute definition;
 perform private.register_operator_internal_contract('public.get_good_shipping_policy(text)'::regprocedure);
end $patch$;

do $$declare entry regprocedure;begin
 for entry in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='private' and (p.proname like '%goods_group%' or p.proname in('record_goods_stock_successor','guard_goods_stock_successor_source')))
   or (n.nspname='public' and p.proname like 'admin_%goods_group%')
 loop perform private.register_operator_internal_contract(entry);end loop;
end$$;
