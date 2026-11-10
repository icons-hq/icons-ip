-- Draft: buyer-entered option values are a cart-line identity and an immutable
-- order-item snapshot. They never change variant prices, stock ownership or PGs.
alter table public.goods add column custom_inputs_enabled boolean not null default false,
  add column custom_input_fields jsonb not null default '[]',
  add column custom_inputs_revision integer not null default 0 check(custom_inputs_revision>=0);

create function private.normalize_goods_custom_input_fields(p_fields jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]'; field jsonb; field_id uuid; ids uuid[]:='{}'; names text[]:='{}';
begin
  if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields)>5 then
    raise check_violation using message='invalid_goods_custom_input_fields';
  end if;
  for field in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(field)<>'object' or not field ?& array['id','name','active']
      or exists(select 1 from jsonb_object_keys(field) key where key not in ('id','name','active'))
      or jsonb_typeof(field->'id')<>'string' or jsonb_typeof(field->'name')<>'string' or jsonb_typeof(field->'active')<>'boolean'
      or length(field->>'name') not between 1 and 25 or field->>'name'<>btrim(field->>'name') or field->>'name'~'[[:cntrl:]]' then
      raise check_violation using message='invalid_goods_custom_input_fields';
    end if;
    begin field_id:=(field->>'id')::uuid;
    exception when invalid_text_representation then raise check_violation using message='invalid_goods_custom_input_fields'; end;
    if field_id=any(ids) or field->>'name'=any(names) then raise check_violation using message='invalid_goods_custom_input_fields'; end if;
    ids:=array_append(ids,field_id); names:=array_append(names,field->>'name');
    result:=result||jsonb_build_array(jsonb_build_object('id',field_id,'name',field->>'name','active',(field->>'active')::boolean));
  end loop;
  return result;
end $$;
revoke all on function private.normalize_goods_custom_input_fields(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.normalize_goods_custom_input_fields(jsonb) to postgres;

create function private.guard_goods_custom_input_fields() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.custom_input_fields:=private.normalize_goods_custom_input_fields(new.custom_input_fields);
  if new.custom_inputs_enabled and not exists(select 1 from jsonb_array_elements(new.custom_input_fields) field where (field->>'active')::boolean) then
    raise check_violation using message='invalid_goods_custom_input_fields';
  end if;
  if tg_op='INSERT' then
    new.custom_inputs_revision:=case when new.custom_inputs_enabled or new.custom_input_fields<>'[]' then 1 else 0 end;
  elsif (new.custom_inputs_enabled,new.custom_input_fields) is distinct from (old.custom_inputs_enabled,old.custom_input_fields) then
    new.custom_inputs_revision:=old.custom_inputs_revision+1;
  else new.custom_inputs_revision:=old.custom_inputs_revision;
  end if;
  return new;
end $$;
revoke all on function private.guard_goods_custom_input_fields() from public,anon,authenticated,service_role;
create trigger goods_custom_input_fields_guard before insert or update of custom_inputs_enabled,custom_input_fields,custom_inputs_revision
  on public.goods for each row execute function private.guard_goods_custom_input_fields();

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_custom_inputs;
revoke all on function private.admin_save_good_before_custom_inputs(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_custom_inputs(jsonb) to postgres;
create function public.admin_save_good(target_good jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved jsonb; config jsonb; fields jsonb; previous public.goods; expected_revision integer;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  if target_good ? 'custom_inputs' then
    config:=target_good->'custom_inputs';
    if jsonb_typeof(config) is distinct from 'object' or not config ?& array['enabled','fields']
      or exists(select 1 from jsonb_object_keys(config) key where key not in ('enabled','fields'))
      or jsonb_typeof(config->'enabled') is distinct from 'boolean'
      or jsonb_typeof(target_good->'custom_inputs_expected_revision') is distinct from 'number'
      or target_good->>'custom_inputs_expected_revision' !~ '^(0|[1-9][0-9]*)$' then
      raise check_violation using message='invalid_goods_custom_input_fields';
    end if;
    fields:=private.normalize_goods_custom_input_fields(config->'fields');
    expected_revision:=(target_good->>'custom_inputs_expected_revision')::integer;
    perform private.lock_catalog_category_tree();
    select * into previous from public.goods where id=coalesce(nullif(target_good->>'previous_id',''),target_good->>'id') for update;
    if expected_revision<>coalesce(previous.custom_inputs_revision,0) then raise sqlstate 'PT409' using message='goods_custom_inputs_changed'; end if;
  end if;
  saved:=private.admin_save_good_before_custom_inputs(target_good-'custom_inputs'-'custom_inputs_expected_revision');
  if config is not null then
    update public.goods set custom_inputs_enabled=(config->>'enabled')::boolean,custom_input_fields=fields where id=saved->>'id';
    if (coalesce(previous.custom_inputs_enabled,false),coalesce(previous.custom_input_fields,'[]'::jsonb))
      is distinct from ((config->>'enabled')::boolean,fields) then
      insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.custom_inputs_saved','goods:'||(saved->>'id'),
        jsonb_build_object('before',jsonb_build_object('enabled',coalesce(previous.custom_inputs_enabled,false),'fields',coalesce(previous.custom_input_fields,'[]'::jsonb)),
          'after',config,'revision',(select custom_inputs_revision from public.goods where id=saved->>'id')));
    end if;
  end if;
  return saved||jsonb_build_object('customInputsRevision',(select custom_inputs_revision from public.goods where id=saved->>'id'));
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

alter function public.admin_clone_good(uuid,text,text,text,text) set schema private;
alter function private.admin_clone_good(uuid,text,text,text,text) rename to admin_clone_good_before_custom_inputs;
revoke all on function private.admin_clone_good_before_custom_inputs(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_clone_good_before_custom_inputs(uuid,text,text,text,text) to postgres;
create function public.admin_clone_good(target_operation_id uuid,target_source_good_id text,target_new_id text default null,target_new_code text default null,target_new_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; replay boolean;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.goods.clone.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  saved:=private.admin_clone_good_before_custom_inputs(target_operation_id,target_source_good_id,target_new_id,target_new_code,target_new_name);
  if not replay then
    update public.goods copied set custom_inputs_enabled=source.custom_inputs_enabled,custom_input_fields=source.custom_input_fields
      from public.goods source where source.id=saved->>'sourceGoodId' and copied.id=saved->>'id';
  end if;
  return saved;
end $$;
revoke all on function public.admin_clone_good(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_clone_good(uuid,text,text,text,text) to authenticated;

alter function private.goods_import_fingerprint(text) rename to goods_import_fingerprint_before_custom_inputs;
revoke all on function private.goods_import_fingerprint_before_custom_inputs(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint_before_custom_inputs(text) to postgres;
create function private.goods_import_fingerprint(target_id text) returns text
language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object('catalog',private.goods_import_fingerprint_before_custom_inputs(target_id),
    'customInputsRevision',(select custom_inputs_revision from public.goods where id=target_id))::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint(text) to postgres;

-- The server constructs display labels from the locked/current definition.
-- Client labels and client hashes are never accepted as authoritative values.
create function private.resolve_goods_custom_inputs(p_good_id text,p_revision integer,p_values jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare good public.goods; fields jsonb:='[]'; field jsonb; value text; count_fields integer:=0;
begin
  if p_revision is null or p_revision<0 or jsonb_typeof(p_values) is distinct from 'object' then raise check_violation using message='invalid_goods_custom_inputs'; end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  if not good.custom_inputs_enabled then
    if p_revision<>0 or p_values<>'{}' then raise check_violation using message='goods_custom_inputs_changed'; end if;
    return null;
  end if;
  if p_revision<>good.custom_inputs_revision then raise check_violation using message='goods_custom_inputs_changed'; end if;
  for field in select item from jsonb_array_elements(good.custom_input_fields) item where (item->>'active')::boolean loop
    count_fields:=count_fields+1;
    if jsonb_typeof(p_values->(field->>'id')) is distinct from 'string' then raise check_violation using message='invalid_goods_custom_inputs'; end if;
    value:=p_values->>(field->>'id');
    if length(value) not between 1 and 100 or value<>btrim(value) or value~'[[:cntrl:]]' then raise check_violation using message='invalid_goods_custom_inputs'; end if;
    fields:=fields||jsonb_build_array(jsonb_build_object('id',field->>'id','name',field->>'name','value',value));
  end loop;
  if count_fields=0 or count_fields<>(select count(*) from jsonb_object_keys(p_values)) then raise check_violation using message='invalid_goods_custom_inputs'; end if;
  return jsonb_build_object('revision',p_revision,'fields',fields);
end $$;
revoke all on function private.resolve_goods_custom_inputs(text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.resolve_goods_custom_inputs(text,integer,jsonb) to postgres;

alter table public.cart_items add column id uuid not null default gen_random_uuid(),
  add column input_revision integer not null default 0 check(input_revision>=0),
  add column input_values jsonb not null default '{}' check(jsonb_typeof(input_values)='object'),
  add column input_snapshot jsonb,
  add column input_key text generated always as(case when input_revision=0 and input_values='{}' then '' else md5(input_revision::text||':'||input_values::text) end) stored,
  add constraint cart_items_id_key unique(id);
alter table public.cart_items drop constraint cart_items_pkey,add primary key(user_id,variant_id,input_key);

create function private.snapshot_cart_custom_inputs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.input_snapshot:=private.resolve_goods_custom_inputs(new.good_id,new.input_revision,new.input_values);
  return new;
end $$;
revoke all on function private.snapshot_cart_custom_inputs() from public,anon,authenticated,service_role;
create trigger cart_custom_inputs_snapshot before insert or update on public.cart_items for each row execute function private.snapshot_cart_custom_inputs();

create function private.set_cart_quantity_with_inputs(p_good_id text,p_variant_id uuid,p_qty integer,p_input_revision integer,p_input_values jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); available_stock integer; other_qty bigint; key_value text; snapshot jsonb;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_good_id),'') is null or p_variant_id is null or p_qty is null or p_qty<0
    or p_input_revision is null or p_input_revision<0 or jsonb_typeof(p_input_values) is distinct from 'object' then
    raise invalid_parameter_value using message='invalid cart item';
  end if;
  key_value:=case when p_input_revision=0 and p_input_values='{}' then '' else md5(p_input_revision::text||':'||p_input_values::text) end;
  perform pg_advisory_xact_lock(hashtextextended('cart:'||actor::text,0));
  if exists(select 1 from public.cart_items where user_id=actor and variant_id=p_variant_id and input_key=key_value
    and (input_revision,input_values) is distinct from (p_input_revision,p_input_values)) then raise check_violation using message='cart_input_identity_conflict'; end if;
  -- Removing an obsolete definition must remain possible. A legacy call with
  -- empty inputs can only remove the legacy empty-input row, never custom rows.
  if p_qty=0 then
    delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=p_variant_id and input_key=key_value;
    return;
  end if;
  snapshot:=private.resolve_goods_custom_inputs(p_good_id,p_input_revision,p_input_values);
  select supply.available_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where variant.id=p_variant_id and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  select coalesce(sum(qty::bigint),0) into other_qty from public.cart_items where user_id=actor and variant_id=p_variant_id and input_key<>key_value;
  if other_qty+p_qty>available_stock then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty,input_revision,input_values,input_snapshot)
    values(actor,p_good_id,p_variant_id,p_qty,p_input_revision,p_input_values,snapshot)
    on conflict(user_id,variant_id,input_key) do update set qty=excluded.qty;
end $$;
revoke all on function private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb) to postgres;
create function public.set_cart_item_quantity_with_inputs(p_good_id text,p_variant_id uuid,p_qty integer,p_input_revision integer,p_input_values jsonb)
returns void language sql security definer set search_path='' as $$
  select private.set_cart_quantity_with_inputs(p_good_id,p_variant_id,p_qty,p_input_revision,p_input_values);
$$;
revoke all on function public.set_cart_item_quantity_with_inputs(text,uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.set_cart_item_quantity_with_inputs(text,uuid,integer,integer,jsonb) to authenticated;
create or replace function public.set_cart_item_quantity(p_good_id text,p_variant_id uuid,p_qty integer)
returns void language sql security definer set search_path='' as $$
  select private.set_cart_quantity_with_inputs(p_good_id,p_variant_id,p_qty,0,'{}');
$$;
revoke all on function public.set_cart_item_quantity(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_cart_item_quantity(text,uuid,integer) to authenticated;

create or replace function public.merge_cart_items(p_items jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item record; current_qty integer; key_value text;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='cart items must be an array'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cart:'||actor::text,0));
  for item in select good_id,variant_id,qty,coalesce(input_revision,0) input_revision,coalesce(input_values,'{}') input_values
    from jsonb_to_recordset(p_items) as candidate(good_id text,variant_id uuid,qty integer,input_revision integer,input_values jsonb)
    order by good_id,variant_id loop
    if item.qty is null or item.qty<=0 then raise check_violation using message='invalid cart item'; end if;
    key_value:=case when item.input_revision=0 and item.input_values='{}' then '' else md5(item.input_revision::text||':'||item.input_values::text) end;
    select qty into current_qty from public.cart_items where user_id=actor and variant_id=item.variant_id and input_key=key_value;
    perform private.set_cart_quantity_with_inputs(item.good_id,item.variant_id,greatest(item.qty,coalesce(current_qty,0)),item.input_revision,item.input_values);
  end loop;
end $$;
revoke all on function public.merge_cart_items(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.merge_cart_items(jsonb) to authenticated;

create or replace function public.add_cart_selection(p_base_good_id text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item record; actual_qty integer; next_qty bigint; key_value text; seen text[]:='{}';
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_base_good_id),'') is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 51 then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) line where jsonb_typeof(line)<>'object'
    or not line ?& array['good_id','variant_id','qty','expected_qty']
    or exists(select 1 from jsonb_object_keys(line) key where key not in ('good_id','variant_id','qty','expected_qty','input_revision','input_values'))
    or jsonb_typeof(line->'good_id')<>'string' or jsonb_typeof(line->'variant_id')<>'string'
    or jsonb_typeof(line->'qty')<>'number' or jsonb_typeof(line->'expected_qty')<>'number'
    or line->>'qty' !~ '^[1-9][0-9]*$' or line->>'expected_qty' !~ '^(0|[1-9][0-9]*)$') then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  if not exists(select 1 from jsonb_to_recordset(p_items) input(good_id text) where input.good_id=p_base_good_id) then raise invalid_parameter_value using message='invalid cart selection'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cart:'||actor::text,0));
  for item in select good_id,variant_id,qty,expected_qty,coalesce(input_revision,0) input_revision,coalesce(input_values,'{}') input_values
    from jsonb_to_recordset(p_items) input(good_id text,variant_id uuid,qty integer,expected_qty integer,input_revision integer,input_values jsonb)
    order by good_id,variant_id loop
    if nullif(btrim(item.good_id),'') is null or item.variant_id is null or item.qty<1 or item.expected_qty<0 then raise invalid_parameter_value using message='invalid cart selection'; end if;
    key_value:=case when item.input_revision=0 and item.input_values='{}' then '' else md5(item.input_revision::text||':'||item.input_values::text) end;
    if item.variant_id::text||':'||key_value=any(seen) then raise invalid_parameter_value using message='invalid cart selection'; end if;
    seen:=array_append(seen,item.variant_id::text||':'||key_value);
    if item.good_id<>p_base_good_id and not exists(select 1 from private.goods_additional_links where base_good_id=p_base_good_id and target_good_id=item.good_id) then
      raise check_violation using message='additional_good_unavailable';
    end if;
    if not private.goods_additional_available(item.good_id) then raise check_violation using message='additional_good_unavailable'; end if;
    select coalesce((select qty from public.cart_items where user_id=actor and good_id=item.good_id and variant_id=item.variant_id and input_key=key_value),0) into actual_qty;
    if actual_qty<>item.expected_qty then raise sqlstate 'PT409' using message='cart_selection_changed'; end if;
    next_qty:=actual_qty::bigint+item.qty;
    if next_qty>2147483647 then raise check_violation using message='invalid cart selection'; end if;
    perform private.set_cart_quantity_with_inputs(item.good_id,item.variant_id,next_qty::integer,item.input_revision,item.input_values);
  end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)
    ||case when input_snapshot is null then '{}' else jsonb_build_object('customInputs',input_snapshot) end
    order by created_at,good_id,variant_id,input_key),'[]') from public.cart_items where user_id=actor);
end $$;
revoke all on function public.add_cart_selection(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.add_cart_selection(text,jsonb) to authenticated;

alter table public.order_items add column custom_inputs_snapshot jsonb;
create function private.validate_order_custom_inputs_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare snapshot jsonb:=new.custom_inputs_snapshot; canonical jsonb; values_by_id jsonb;
begin
  if snapshot is null then
    perform private.resolve_goods_custom_inputs(new.good_id,0,'{}');
    return new;
  end if;
  if jsonb_typeof(snapshot) is distinct from 'object' or jsonb_typeof(snapshot->'fields') is distinct from 'array'
    or jsonb_typeof(snapshot->'revision') is distinct from 'number' then raise check_violation using message='invalid_goods_custom_inputs'; end if;
  select coalesce(jsonb_object_agg(field->>'id',field->'value'),'{}') into values_by_id from jsonb_array_elements(snapshot->'fields') field;
  canonical:=private.resolve_goods_custom_inputs(new.good_id,(snapshot->>'revision')::integer,values_by_id);
  if canonical is distinct from snapshot then raise check_violation using message='invalid_goods_custom_inputs'; end if;
  return new;
end $$;
revoke all on function private.validate_order_custom_inputs_snapshot() from public,anon,authenticated,service_role;
create trigger order_custom_inputs_snapshot_validate before insert on public.order_items
  for each row execute function private.validate_order_custom_inputs_snapshot();
create function private.guard_order_custom_inputs_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if new.custom_inputs_snapshot is distinct from old.custom_inputs_snapshot then raise check_violation using message='order_custom_inputs_snapshot_immutable'; end if;
  return new;
end $$;
revoke all on function private.guard_order_custom_inputs_snapshot() from public,anon,authenticated,service_role;
create trigger order_custom_inputs_snapshot_immutable before update of custom_inputs_snapshot on public.order_items
  for each row execute function private.guard_order_custom_inputs_snapshot();

-- Preserve the latest checkout core verbatim except cart-row identity and
-- the validated custom-input snapshot. Price, coupon, credit, supply, shipping,
-- member quantity limits and full-order cancellation remain authoritative.
CREATE OR REPLACE FUNCTION private.place_order_before_shipments(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  v_store_credit bigint := 0;
  r record;
  v_variant public.goods_variants;
  v_price record;
  v_price_at timestamptz;
  v_limit_good public.goods;
  v_good_qty bigint;
  v_last_good_id text;
  v_quantity_error text;
  v_supply record;
  v_new_order_item uuid;
  v_custom_inputs_snapshot jsonb;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  if p_payment_method is null then
    raise invalid_parameter_value using message='payment method required';
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  perform private.assert_first_purchase_checkout(v_user,v_order);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||v_user::text,0));
  -- This timestamp is fixed after the member/cart locks. Waiting for a competing
  -- checkout cannot select a stale pre-lock clock value. Each order has one price
  -- boundary, including all its coupon and shipping calculations.
  v_price_at:=clock_timestamp();
  -- Parent goods are locked before their selected options and cache updates.
  for r in
    select
      cart.id as cart_item_id,
      cart.good_id,
      cart.variant_id,
      cart.qty,
      cart.input_revision,
      cart.input_values,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.allow_card_payment,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id, cart.variant_id, cart.id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    select * into v_variant from public.goods_variants where id=r.variant_id and good_id=r.good_id for update;
    if not found or v_variant.archived_at is not null then raise check_violation using message='catalog_item_unavailable'; end if;
    v_item_count := v_item_count + 1;
    v_custom_inputs_snapshot:=private.resolve_goods_custom_inputs(r.good_id,r.input_revision,r.input_values);

    -- A variant may have several buyer-input lines. Check a good before its
    -- first line is consumed, summing every selected line and optional add-on.
    if v_last_good_id is distinct from r.good_id then
      select * into v_limit_good from public.goods where id=r.good_id;
      select sum(qty::bigint) into v_good_qty from public.cart_items where user_id=v_user and good_id=r.good_id;
      v_quantity_error:=private.check_goods_purchase_quantity(v_limit_good,v_user,v_good_qty,true);
      if v_quantity_error is not null then
        raise check_violation using message=v_quantity_error||': '||r.good_id;
      end if;
      v_last_good_id:=r.good_id;
    end if;
    select * into v_price from private.resolve_goods_variant_price(v_variant.id,v_price_at);


    select * into v_supply from private.resolve_goods_variant_supply(v_variant.id,v_price_at);
    if r.stock = 'soldout' then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;
    if v_supply.mode='preorder' then
      if v_supply.state<>'open' then raise check_violation using message='preorder_sale_not_open'; end if;
      if v_supply.available_qty<r.qty then raise check_violation using message='preorder_capacity_exceeded'; end if;
    elsif v_supply.available_qty<r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'card' and not r.allow_card_payment then
      raise check_violation using message=format('card payment blocked: %s',r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    if v_supply.mode='stock' then
      perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);
    end if;

    insert into public.order_items (
      order_id,
      good_id,
      variant_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot,
      regular_unit_price_snapshot,
      price_period_id,
      price_evaluated_at,
      sales_policy_snapshot,
      supply_source,
      preorder_policy_id,
      preorder_expected_ship_date,
      preorder_snapshot,
      custom_inputs_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.variant_id,
      r.qty,
      v_price.effective_price,
      r.name,
      r.type,
      r.ip_id,
      v_price.regular_price,
      v_price.price_period_id,
      v_price_at,
      jsonb_build_object('version',1,'allowCardPayment',r.allow_card_payment,'allowBankTransfer',r.allow_bank_transfer,
        'orderQuantityLimitEnabled',v_limit_good.order_quantity_limit_enabled,
        'minOrderQty',v_limit_good.min_order_qty,'maxOrderQty',v_limit_good.max_order_qty,
        'memberPurchaseLimitEnabled',v_limit_good.member_purchase_limit_enabled,
        'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit),
      v_supply.mode,
      v_supply.policy_id,
      v_supply.expected_ship_date,
      case when v_supply.mode='preorder' then jsonb_build_object('version',1,'policyId',v_supply.policy_id,
        'policyRevision',v_supply.policy_revision,'startsAt',v_supply.starts_at,'endsAt',v_supply.ends_at,
        'expectedShipDate',v_supply.expected_ship_date) end,
      v_custom_inputs_snapshot
    ) returning id into v_new_order_item;
    if v_supply.mode='preorder' then
      perform private.reserve_goods_preorder_item(v_new_order_item,v_price_at);
    end if;

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and id = r.cart_item_id;

    v_subtotal := v_subtotal + (v_price.effective_price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- Shipping uses the period-adjusted item subtotal before coupon/credit deductions.
  -- Its order-item inputs already contain the immutable effective price.
  v_shipping_fee := private.goods_shipping_fee_for(v_order);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_order_user_coupon(v_selected_coupon, v_user, v_order);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    if v_discount<=0 then raise check_violation using message='coupon_no_discount'; end if;
    perform private.reserve_first_purchase_coupon(v_order,v_user,v_coupon_eval.o_coupon_code);

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount, eligible_subtotal, terms_snapshot
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount, v_coupon_eval.o_eligible_subtotal, v_coupon_eval.o_terms_snapshot
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  v_store_credit := private.reserve_order_store_credits(v_order,v_user,v_subtotal,v_discount,v_shipping_fee);

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount - v_store_credit,
      shipping_fee = v_shipping_fee,
      store_credit_total = v_store_credit,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount - v_store_credit, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
grant execute on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) to postgres;

-- Extend authorized read projections without broadening their selected rows.
create function private.with_order_item_custom_inputs(p_items jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry.value||case when item.custom_inputs_snapshot is null then '{}'::jsonb
   else jsonb_build_object('customInputs',item.custom_inputs_snapshot) end order by entry.ordinality),'[]')
 from jsonb_array_elements(p_items) with ordinality entry(value,ordinality)
 left join public.order_items item on item.id=(entry.value->>'id')::uuid;
$$;
revoke all on function private.with_order_item_custom_inputs(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.with_order_item_custom_inputs(jsonb) to postgres;

alter function public.admin_order_detail(uuid) set schema private;
alter function private.admin_order_detail(uuid) rename to admin_order_detail_before_custom_inputs;
revoke all on function private.admin_order_detail_before_custom_inputs(uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_order_detail_before_custom_inputs(uuid) to postgres;
create function public.admin_order_detail(target_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 result:=private.admin_order_detail_before_custom_inputs(target_order_id);
 if result is null then return null; end if;
 return jsonb_set(result,'{items}',private.with_order_item_custom_inputs(result->'items'));
end $$;
revoke all on function public.admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_detail(uuid) to authenticated;

alter function public.admin_order_claim_detail(uuid) set schema private;
alter function private.admin_order_claim_detail(uuid) rename to admin_order_claim_detail_before_custom_inputs;
revoke all on function private.admin_order_claim_detail_before_custom_inputs(uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_order_claim_detail_before_custom_inputs(uuid) to postgres;
create function public.admin_order_claim_detail(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 result:=private.admin_order_claim_detail_before_custom_inputs(p_claim_id);
 if result is null or result->'order' is null or result->'order'='null' then return result; end if;
 return jsonb_set(result,'{order,items}',private.with_order_item_custom_inputs(result#>'{order,items}'));
end $$;
revoke all on function public.admin_order_claim_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;

alter function public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) set schema private;
alter function private.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) rename to admin_search_shipments_console_before_custom_inputs;
revoke all on function private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text) to postgres;
create function public.admin_search_shipments_console(p_tab text,p_origin_id uuid default null,p_query text default null,
 p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0,
 p_field text default 'all',p_date_field text default 'ordered',p_method text default null,p_payment_method text default null,p_sort text default 'oldest')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 result:=private.admin_search_shipments_console_before_custom_inputs(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset,p_field,p_date_field,p_method,p_payment_method,p_sort);
 return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(jsonb_set(entry.value,'{items}',private.with_order_item_custom_inputs(entry.value->'items')) order by entry.ordinality)
   from jsonb_array_elements(result->'rows') with ordinality entry(value,ordinality)),'[]'));
end $$;
revoke all on function public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) to authenticated;

-- Keep warehouse template columns unchanged; the option cell carries the exact
-- buyer-input snapshot for each distinct order item. Existing outer wrappers
-- still enforce preorder readiness and parcel delivery.
-- #429: native warehouse export values come from the order/shipment snapshots.
create or replace function private.admin_shipment_export_before_preorder(target_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare expected_count integer;result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 expected_count:=cardinality(target_ids);
 if expected_count is null or expected_count not between 1 and 1000 or expected_count<>(select count(distinct id) from unnest(target_ids) id) then raise invalid_parameter_value using message='invalid_export_selection';end if;
 if (select count(*) from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=any(target_ids)
   and s.status='ready' and o.status in ('confirmed','shipping'))<>expected_count then raise check_violation using message='shipment_not_ready';end if;
 if exists(select 1 from public.order_cancellation_requests r join public.order_shipments s on s.order_id=r.order_id where s.id=any(target_ids) and r.status in ('requested','processing','needs_review'))
 or exists(select 1 from public.order_cancellation_claims c join public.order_shipments s on s.order_id=c.order_id where s.id=any(target_ids)) then raise check_violation using message='order cancellation in progress';end if;
 if (select count(*) from public.order_shipment_items where shipment_id=any(target_ids))>10000 then raise check_violation using message='export_item_limit';end if;
 select jsonb_build_object('shipments',jsonb_agg(jsonb_build_object('id',s.id,'updatedAt',s.updated_at,'originId',s.origin_id,
  'originName',s.origin_name_snapshot,'shippingFee',s.shipping_fee,'template',origin.export_template,'columns',origin.export_columns,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',o.id,'recipient',coalesce(o.address->>'recipientName',''),
   'phone',coalesce(o.address->>'phone',''),'postalCode',coalesce(o.address->>'postalCode',''),
   'address',concat_ws(' ',o.address->>'address1',nullif(o.address->>'address2','')),'goodCode',coalesce(g.code,i.good_id,''),
   'variantCode',coalesce(i.variant_code_snapshot,''),'goodName',i.good_name_snapshot,'optionName',concat_ws(' / ',nullif(i.variant_name_snapshot,''),(select string_agg((field->>'name')||': '||(field->>'value'),' / ' order by entry.ordinality) from jsonb_array_elements(i.custom_inputs_snapshot->'fields') with ordinality entry(field,ordinality))),'qty',i.qty,'unitPrice',i.unit_price,'deliveryNote',coalesce(o.address->>'deliveryNote',''),'carrier',coalesce(carrier.label,'')) order by i.id)
   from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id left join public.goods g on g.id=i.good_id where link.shipment_id=s.id),'[]')) order by origin.code,s.created_at,s.id)) into result
 from public.order_shipments s join public.orders o on o.id=s.order_id join public.fulfillment_origins origin on origin.id=s.origin_id
 left join public.shipping_carriers carrier on carrier.code=origin.default_carrier where s.id=any(target_ids);
 return result;
end $$;
revoke all on function private.admin_shipment_export_before_preorder(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_shipment_export_before_preorder(uuid[]) to postgres;

notify pgrst,'reload schema';
