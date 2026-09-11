-- #468: an option's warning threshold never reserves or deducts allocated stock.
alter table public.goods_variants add column low_stock_threshold integer
  check (low_stock_threshold >= 0);
comment on column public.goods_variants.low_stock_threshold is
  'Operator warning threshold: null disables the warning; stock_qty <= threshold warns without reserving stock.';

-- #469: the default is a stable option identity, including when every option is
-- stopped. Keep the unique/default-required invariants and all reference guards.
alter table public.goods_variants drop constraint goods_variants_default_active;

create or replace function private.save_goods_options(target_id text, target_rows jsonb, baseline jsonb, is_new boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid(); good public.goods%rowtype; variant public.goods_variants%rowtype;
 item jsonb; option_id uuid; retained uuid[]:='{}'::uuid[]; ordinal integer:=0; expected_qty integer; desired_qty integer;
 current_ids jsonb; before_rows jsonb; seen_attributes jsonb[]:='{}'::jsonb[]; desired_price bigint;
begin
 if actor_id is null then raise exception 'auth_required' using errcode='28000'; end if;
 if not public.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
 if target_rows is null or jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows) not between 1 and 100
   or baseline is null or jsonb_typeof(baseline)<>'array' then raise check_violation using message='invalid_goods_options'; end if;
 select * into good from public.goods where id=target_id for update;
 if not found or good.archived_at is not null then raise check_violation using message='good_unavailable'; end if;
 perform 1 from public.goods_variants where good_id=target_id order by id for update;
 select coalesce(jsonb_agg(id::text order by id),'[]') into current_ids from public.goods_variants where good_id=target_id and archived_at is null;
 if not is_new and current_ids is distinct from (select coalesce(jsonb_agg(value order by value),'[]') from jsonb_array_elements_text(baseline)) then
   raise sqlstate 'PT409' using message='goods_options_changed';
 end if;
 select jsonb_agg(to_jsonb(v) order by v.sort_order,v.id) into before_rows from public.goods_variants v where v.good_id=target_id;
 -- The first submitted row becomes the default. The deferred invariant checks the complete batch.
 update public.goods_variants set is_default=false where good_id=target_id and is_default;
 if is_new then delete from public.goods_variants where good_id=target_id; end if;
 for item in select value from jsonb_array_elements(target_rows) loop
   if jsonb_typeof(item)<>'object' or char_length(btrim(coalesce(item->>'name',''))) not between 1 and 200
     or jsonb_typeof(item->'attributes') is distinct from 'object'
     or exists(select 1 from jsonb_each(item->'attributes') a where char_length(btrim(a.key)) not between 1 and 40
       or jsonb_typeof(a.value)<>'string' or char_length(btrim(a.value#>>'{}')) not between 1 and 80)
     or coalesce(item->>'extraPrice','') !~ '^[0-9]+$' or coalesce(item->>'stockQty','') !~ '^[0-9]+$'
     or char_length(btrim(coalesce(item->>'code','')))>120
     or coalesce(jsonb_typeof(item->'code'),'null') not in ('string','null')
     or item->'attributes'=any(seen_attributes) then raise check_violation using message='invalid_goods_options'; end if;
   if item?'lowStockThreshold' and item->'lowStockThreshold'<>'null'::jsonb and (
     jsonb_typeof(item->'lowStockThreshold')<>'number' or item->>'lowStockThreshold' !~ '^[0-9]+$'
     or (item->>'lowStockThreshold')::numeric>2147483647
   ) then raise check_violation using message='invalid_goods_options'; end if;
   if item?'isActive' and jsonb_typeof(item->'isActive') is distinct from 'boolean' then
     raise check_violation using message='invalid_goods_options'; end if;
   seen_attributes:=array_append(seen_attributes,item->'attributes');
   desired_price:=good.price::bigint+(item->>'extraPrice')::bigint;
   desired_qty:=(item->>'stockQty')::integer;
   if desired_price>2147483647 then raise numeric_value_out_of_range using message='invalid_goods_options'; end if;
   option_id:=nullif(item->>'id','')::uuid;
   if option_id is not null then
     select * into variant from public.goods_variants where id=option_id and good_id=target_id;
     if not found or option_id=any(retained) or coalesce(item->>'expectedStockQty','') !~ '^[0-9]+$' then
       raise check_violation using message='invalid_goods_options'; end if;
     expected_qty:=(item->>'expectedStockQty')::integer;
     -- An untouched quantity is metadata, not an instruction to restore stock sold meanwhile.
     if desired_qty<>expected_qty then
       if variant.stock_qty<>expected_qty then raise sqlstate 'PT409' using message='stock_changed'; end if;
       perform private.change_goods_variant_stock(target_id,option_id,desired_qty::bigint-variant.stock_qty);
     end if;
     update public.goods_variants set name=btrim(item->>'name'),attributes=item->'attributes',price=desired_price::integer,
       low_stock_threshold=case when item?'lowStockThreshold' then (item->>'lowStockThreshold')::integer else variant.low_stock_threshold end,
       archived_at=case when item?'isActive' then case when (item->>'isActive')::boolean then null
         else coalesce(variant.archived_at,clock_timestamp()) end else variant.archived_at end,
       code=coalesce(nullif(item->>'code',''),variant.code),sort_order=ordinal,is_default=(ordinal=0) where id=option_id;
   else
     insert into public.goods_variants(good_id,name,attributes,price,code,sort_order,is_default,low_stock_threshold,archived_at)
       values(target_id,btrim(item->>'name'),item->'attributes',desired_price::integer,nullif(item->>'code',''),ordinal,ordinal=0,
         (item->>'lowStockThreshold')::integer,
         case when coalesce((item->>'isActive')::boolean,true) then null else clock_timestamp() end)
       returning id into option_id;
     if desired_qty<>0 then perform private.change_goods_variant_stock(target_id,option_id,desired_qty); end if;
   end if;
   retained:=array_append(retained,option_id); ordinal:=ordinal+1;
 end loop;
 for variant in select * from public.goods_variants where good_id=target_id and archived_at is null and not(id=any(retained)) order by id loop
   if exists(select 1 from public.order_items where variant_id=variant.id)
     or exists(select 1 from public.cart_items where variant_id=variant.id)
     or exists(select 1 from public.order_claim_reshipment_items where variant_id=variant.id or source_variant_id=variant.id) then
     update public.goods_variants set archived_at=now() where id=variant.id;
   else
     -- Later features may attach immutable history without an order/cart row.
     -- Let their FK be the lifetime boundary instead of naming not-yet-created
     -- tables here. A failed DELETE and all of its cascades roll back together.
     begin
       delete from public.goods_variants where id=variant.id;
     exception when foreign_key_violation then
       update public.goods_variants set archived_at=coalesce(archived_at,clock_timestamp()) where id=variant.id;
     end;
   end if;
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'admin.good.options_saved','goods:'||target_id,
   jsonb_build_object('before',before_rows,'after',(select jsonb_agg(to_jsonb(v) order by v.sort_order,v.id) from public.goods_variants v where v.good_id=target_id)));
end;
$$;
revoke all on function private.save_goods_options(text,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;

-- An explicit stop preserves even an unreferenced option. Removal from the full
-- editor continues to archive referenced rows and delete only unused rows.
create function public.admin_set_goods_variant_active(
  target_good_id text, target_variant_id uuid, target_active boolean,
  target_expected_updated_at timestamptz, target_price integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); good public.goods; variant public.goods_variants;
 before_row jsonb; restored_price integer;
begin
 if actor is null then raise sqlstate '28000' using message='auth_required'; end if;
 if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
 if target_variant_id is null or target_active is null or target_expected_updated_at is null
   or (not target_active and target_price is not null) then
   raise invalid_parameter_value using message='invalid_variant_availability'; end if;
 select * into good from public.goods where id=target_good_id for update;
 if not found then raise no_data_found using message='good_not_found'; end if;
 if good.archived_at is not null then raise check_violation using message='catalog_archived'; end if;
 select * into variant from public.goods_variants where id=target_variant_id and good_id=target_good_id for update;
 if not found then raise no_data_found using message='goods_variant_not_found'; end if;
 if target_active is distinct from (variant.archived_at is null) then
   if variant.updated_at is distinct from target_expected_updated_at then
     raise sqlstate 'PT409' using message='goods_variant_changed'; end if;
   restored_price:=coalesce(target_price,variant.price);
   if target_active then
     if restored_price<good.price then raise check_violation using message='variant_price_below_base'; end if;
     if exists(select 1 from public.goods_variants other where other.good_id=good.id
       and other.id<>variant.id and other.archived_at is null and other.attributes=variant.attributes) then
       raise check_violation using message='goods_variant_combination_exists'; end if;
     if (select count(*) from public.goods_variants other where other.good_id=good.id
       and (other.archived_at is null or other.is_default or other.id=variant.id))>100 then
       raise check_violation using message='goods_options_limit'; end if;
   end if;
   before_row:=to_jsonb(variant);
   update public.goods_variants set
     archived_at=case when target_active then null else clock_timestamp() end,
     price=case when target_active then restored_price else price end
     where id=variant.id returning * into variant;
   insert into public.audit_log(actor_id,action,target,diff) values(actor,
     case when target_active then 'admin.good.option_activated' else 'admin.good.option_stopped' end,
     'goods:'||good.id,jsonb_build_object('variantId',variant.id,'before',before_row,'after',to_jsonb(variant)));
 end if;
 return jsonb_build_object('variantId',variant.id,'isActive',variant.archived_at is null,
   'price',variant.price,'updatedAt',variant.updated_at,'ipId',good.ip_id);
end;
$$;
revoke all on function public.admin_set_goods_variant_active(text,uuid,boolean,timestamptz,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_set_goods_variant_active(text,uuid,boolean,timestamptz,integer) to authenticated;

-- Computed fields retain the existing search relation and PostgREST's exact
-- count/filter/range. The unnamed row argument keeps them off the RPC surface.
create function public.admin_goods_active_stock_qty(public.goods)
returns integer language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='admin_only'; end if;
 return (select coalesce(sum(stock_qty),0)::integer from public.goods_variants
   where good_id=($1).id and archived_at is null);
end;
$$;
create function public.admin_goods_low_stock_option_count(public.goods)
returns integer language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='admin_only'; end if;
 return (select count(*)::integer from public.goods_variants
   where good_id=($1).id and low_stock_threshold is not null and stock_qty<=low_stock_threshold);
end;
$$;
revoke all on function public.admin_goods_active_stock_qty(public.goods),
  public.admin_goods_low_stock_option_count(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_active_stock_qty(public.goods),
  public.admin_goods_low_stock_option_count(public.goods) to authenticated;

create or replace function public.admin_goods_export_candidates(
  search_text text default '', ip_filter text default '', status_filter text default 'active', stock_filter text default 'all'
)
returns table(good_id text,option_rows integer) language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 return query select good.id,greatest(1,(select count(*)::integer from public.goods_variants variant
   where variant.good_id=good.id and (variant.archived_at is null or variant.is_default)))
 from public.admin_search_goods(search_text) good where (ip_filter='' or good.ip_id=ip_filter)
 and case status_filter when 'all' then true when 'archived' then good.archived_at is not null
   when 'draft' then good.archived_at is null and good.published_at is null
   when 'published' then good.archived_at is null and good.published_at is not null else good.archived_at is null end
 and case stock_filter when 'soldout' then good.stock='soldout' or public.admin_goods_active_stock_qty(good)=0
   when 'ok' then good.stock='ok' and public.admin_goods_active_stock_qty(good)>0
   when 'low' then good.stock='low' and public.admin_goods_active_stock_qty(good)>0 else true end
 order by good.id;
end;
$$;
revoke all on function public.admin_goods_export_candidates(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_export_candidates(text,text,text,text) to authenticated;
