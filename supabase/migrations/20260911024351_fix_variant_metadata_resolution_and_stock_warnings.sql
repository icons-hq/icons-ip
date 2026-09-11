-- PR #499 review 3985428658 / 3985428667.
-- Shared migrations remain immutable. Redefine the current option writer and
-- its ERP/cost wrappers under their final private names, preserving every
-- catalog/publication wrapper above them and every stock/history check within.
-- Option metadata is applied once using saved UUIDs, including explicit stopped
-- rows and new rows initially saved stopped. Low-stock warnings count active
-- options only; the all-option stock cache and retained inventory are unchanged.

CREATE OR REPLACE FUNCTION private.save_goods_options(target_id text, target_rows jsonb, baseline jsonb, is_new boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor_id uuid:=auth.uid(); good public.goods%rowtype; variant public.goods_variants%rowtype;
 item jsonb; option_id uuid; retained uuid[]:='{}'::uuid[]; ordinal integer:=0; expected_qty integer; desired_qty integer;
 current_ids jsonb; before_rows jsonb; saved_rows jsonb; seen_attributes jsonb[]:='{}'::jsonb[]; desired_price bigint;
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
 -- Bind metadata to the exact INSERT/UPDATE results while the full option set
 -- is still locked. Attributes/sort order can also belong to historical rows,
 -- including newly submitted stopped options, so they are not option identity.
 select jsonb_agg(submitted.value || jsonb_build_object('id',retained[submitted.ordinality::integer]) order by submitted.ordinality)
   into saved_rows
   from jsonb_array_elements(target_rows) with ordinality as submitted(value,ordinality);
 perform private.save_goods_variant_external_identities(target_id,saved_rows,actor_id);
 perform private.save_goods_variant_purchase_costs(target_id,saved_rows);
 insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'admin.good.options_saved','goods:'||target_id,
   jsonb_build_object('before',before_rows,'after',(select jsonb_agg(to_jsonb(v) order by v.sort_order,v.id) from public.goods_variants v where v.good_id=target_id)));
end;
$function$;

CREATE OR REPLACE FUNCTION private.admin_save_good_before_sales_policy(target_good jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  saved jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  saved := private.admin_save_good_before_external_identity(target_good);
  -- save_goods_options already applied ERP metadata using its actual saved IDs.
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION private.admin_save_good_before_claim_policy(target_good jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_good->'variants')='array' and exists(
    select 1 from jsonb_array_elements(target_good->'variants') item where item?'purchaseCost'
  ) and not private.can_manage_goods_purchase_costs() then
    raise insufficient_privilege using message='purchase_cost_admin_required';
  end if;
  saved:=private.admin_save_good_before_purchase_cost(target_good);
  -- save_goods_options already applied cost metadata using its actual saved IDs.
  return saved;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_goods_low_stock_option_count(public.goods)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='admin_only'; end if;
 return (select count(*)::integer from public.goods_variants
   where good_id=($1).id and archived_at is null and low_stock_threshold is not null and stock_qty<=low_stock_threshold);
end;
$function$;

revoke all on function private.save_goods_options(text,jsonb,jsonb,boolean),
  private.admin_save_good_before_sales_policy(jsonb),
  private.admin_save_good_before_claim_policy(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.save_goods_options(text,jsonb,jsonb,boolean),
  private.admin_save_good_before_sales_policy(jsonb),
  private.admin_save_good_before_claim_policy(jsonb) to postgres;
revoke all on function public.admin_goods_low_stock_option_count(public.goods)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_low_stock_option_count(public.goods) to authenticated;
notify pgrst,'reload schema';
