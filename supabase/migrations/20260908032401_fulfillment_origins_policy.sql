-- #422. Shipping policy is origin-owned; historical orders retain their charged
-- total and a breakdown snapshot. The later #439 order loop calls the UUID helper.
create table public.fulfillment_origins (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check(code ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check(length(btrim(name)) between 1 and 80),
  default_carrier text references public.shipping_carriers(code) on delete restrict,
  base_fee bigint not null check(base_fee between 0 and 1000000),
  free_threshold bigint check(free_threshold between 0 and 100000000),
  return_address text not null default '' check(length(return_address)<=500),
  cutoff time without time zone,
  export_template text not null default 'standard' check(export_template in ('standard','wms_csv','seowon_xlsx')),
  is_active boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,export_template,is_active) values
 ('00000000-0000-4000-8000-000000042201','gimpo','김포','hanjin',3000,50000,'wms_csv',true),
 -- No carrier/rate contract has been supplied for this origin: activate after configuration.
 ('00000000-0000-4000-8000-000000042202','namyangju','남양주',null,0,null,'seowon_xlsx',false);
alter table public.fulfillment_origins enable row level security;
revoke all on public.fulfillment_origins from public,anon,authenticated,service_role;
grant select on public.fulfillment_origins to authenticated;
create policy fulfillment_origins_staff_read on public.fulfillment_origins for select to authenticated using((select public.is_staff()));

alter table public.goods add column origin_id uuid default '00000000-0000-4000-8000-000000042201'
 references public.fulfillment_origins(id) on delete restrict;
alter table public.goods add column shipping_fee_type text not null default 'policy'
 check(shipping_fee_type in ('policy','free','individual'));
alter table public.goods add column individual_fee bigint not null default 0 check(individual_fee between 0 and 1000000);
create index goods_origin_idx on public.goods(origin_id);

create function private.guard_good_fulfillment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_at is not null then
    if new.origin_id is null then raise check_violation using message='fulfillment_origin_required'; end if;
    if tg_op='INSERT' or new.origin_id is distinct from old.origin_id or old.published_at is null then
      perform id from public.fulfillment_origins where id=new.origin_id and is_active for share;
      if not found then raise check_violation using message='fulfillment_origin_inactive'; end if;
    end if;
  end if;
  if new.shipping_fee_type<>'individual' then new.individual_fee:=0; end if;
  return new;
end $$;
revoke all on function private.guard_good_fulfillment() from public,anon,authenticated,service_role;
create trigger goods_fulfillment_guard before insert or update of origin_id,shipping_fee_type,individual_fee,published_at
 on public.goods for each row execute function private.guard_good_fulfillment();

create function public.admin_save_fulfillment_origin(target_id uuid,target_values jsonb,expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.fulfillment_origins; saved public.fulfillment_origins;
 code_value text; name_value text; carrier_value text; base_value bigint; threshold_value bigint; active_value boolean;
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='admin_required';
  end if;
  if jsonb_typeof(target_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_values) k
    where k not in ('code','name','default_carrier','base_fee','free_threshold','return_address','cutoff','export_template','is_active')) then
    raise invalid_parameter_value using message='invalid_fulfillment_origin';
  end if;
  code_value:=btrim(target_values->>'code'); name_value:=btrim(target_values->>'name');
  carrier_value:=nullif(target_values->>'default_carrier','');
  base_value:=(target_values->>'base_fee')::bigint; threshold_value:=nullif(target_values->>'free_threshold','')::bigint;
  active_value:=(target_values->>'is_active')::boolean;
  if code_value is null or code_value !~ '^[a-z][a-z0-9-]{1,39}$' or name_value is null or length(name_value) not between 1 and 80
    or base_value is null or base_value not between 0 and 1000000 or threshold_value not between 0 and 100000000 or active_value is null
    or coalesce(target_values->>'return_address','') ~ '[[:cntrl:]]'
    or length(coalesce(target_values->>'return_address',''))>500
    or coalesce(target_values->>'export_template','') not in ('standard','wms_csv','seowon_xlsx') then
    raise invalid_parameter_value using message='invalid_fulfillment_origin';
  end if;
  if carrier_value is not null and not exists(select 1 from public.shipping_carriers where code=carrier_value and is_active) then
    raise check_violation using message='shipping_carrier_inactive';
  end if;
  if active_value and carrier_value is null then raise check_violation using message='shipping_carrier_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fulfillment_origin:'||code_value,0));
  if target_id is not null then
    select * into previous from public.fulfillment_origins where id=target_id for update;
    if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
    if previous.updated_at is distinct from expected_updated_at then raise serialization_failure using message='fulfillment_origin_conflict'; end if;
    if previous.code<>code_value then raise check_violation using message='fulfillment_origin_code_locked'; end if;
    update public.fulfillment_origins set name=name_value,default_carrier=carrier_value,base_fee=base_value,free_threshold=threshold_value,
      return_address=btrim(coalesce(target_values->>'return_address','')),cutoff=nullif(target_values->>'cutoff','')::time,
      export_template=target_values->>'export_template',is_active=active_value,
      updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
      where id=target_id returning * into saved;
  else
    if expected_updated_at is not null then raise invalid_parameter_value using message='invalid_fulfillment_origin'; end if;
    insert into public.fulfillment_origins(code,name,default_carrier,base_fee,free_threshold,return_address,cutoff,export_template,is_active)
      values(code_value,name_value,carrier_value,base_value,threshold_value,btrim(coalesce(target_values->>'return_address','')),
        nullif(target_values->>'cutoff','')::time,target_values->>'export_template',active_value) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_origin.saved','fulfillment_origins:'||saved.id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.admin_save_fulfillment_origin(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_fulfillment_origin(uuid,jsonb,timestamptz) to authenticated;

create or replace function private.get_goods_shipping_policy()
returns table(base_fee bigint,free_threshold bigint)
language sql stable security invoker set search_path='' as $$
  select base_fee,free_threshold from public.fulfillment_origins where code='gimpo';
$$;
revoke all on function private.get_goods_shipping_policy() from public,anon,authenticated,service_role;
create or replace function private.goods_shipping_fee_for(target_subtotal bigint)
returns bigint language sql stable security invoker set search_path='' as $$
  select case when target_subtotal>0 and (policy.free_threshold is null or target_subtotal<policy.free_threshold)
    then policy.base_fee else 0::bigint end from private.get_goods_shipping_policy() policy;
$$;
revoke all on function private.goods_shipping_fee_for(bigint) from public,anon,authenticated,service_role;

-- Only trusted callers can supply price/shipping terms. Public quote callers resolve
-- these from catalogue rows first; order finalization resolves immutable line snapshots.
create function private.calculate_goods_shipping(target_lines jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  with lines as (
    select * from jsonb_to_recordset(target_lines) as x(origin_id uuid,good_id text,qty integer,unit_price bigint,fee_type text,individual_fee bigint)
  ), per_good as (
    select origin_id,good_id,sum(unit_price*qty) filter(where fee_type='policy') policy_subtotal,
      max(case when fee_type='individual' then individual_fee else 0 end) individual_fee
    from lines group by origin_id,good_id
  ), per_origin as (
    select origin_id,coalesce(sum(policy_subtotal),0)::bigint policy_subtotal,sum(individual_fee)::bigint individual_fee
    from per_good group by origin_id
  ), fees as (
    select origin.*,p.policy_subtotal,p.individual_fee,
      case when p.policy_subtotal>0 and (origin.free_threshold is null or p.policy_subtotal<origin.free_threshold)
        then origin.base_fee else 0 end policy_fee
    from per_origin p join public.fulfillment_origins origin on origin.id=p.origin_id
  ) select jsonb_build_object('totalFee',coalesce(sum(policy_fee+individual_fee),0),
    'groups',coalesce(jsonb_agg(jsonb_build_object(
      'originId',id,'originCode',code,'originName',name,'policySubtotal',policy_subtotal,
      'baseFee',base_fee,'freeThreshold',free_threshold,'policyFee',policy_fee,'individualFee',individual_fee,
      'totalFee',policy_fee+individual_fee
    ) order by code,id),'[]'::jsonb)) from fees;
$$;
revoke all on function private.calculate_goods_shipping(jsonb) from public,anon,authenticated,service_role;

create function public.quote_goods_shipping(items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare input record; good public.goods; variant public.goods_variants; line_qty integer; variant_key uuid; lines jsonb:='[]';
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_shipping_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input.value) k where k not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'qty') is distinct from 'number' then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    line_qty:=(input.value->>'qty')::integer;
    if line_qty not between 1 and 2147483647 then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      join public.fulfillment_origins origin on origin.id=g.origin_id and origin.is_active
      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='shipping_quote_good_unavailable'; end if;
    variant_key:=nullif(input.value->>'variantId','')::uuid;
    select v.* into variant from public.goods_variants v where v.good_id=good.id and v.archived_at is null
      and (case when variant_key is null then v.is_default else v.id=variant_key end);
    if not found then raise check_violation using message='shipping_quote_variant_unavailable'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',line_qty,
      'unit_price',variant.price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  end loop;
  return private.calculate_goods_shipping(lines);
end $$;
revoke all on function public.quote_goods_shipping(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_shipping(jsonb) to anon,authenticated;

alter table public.order_items add column origin_id_snapshot uuid references public.fulfillment_origins(id) on delete restrict;
alter table public.order_items add column shipping_fee_type_snapshot text;
alter table public.order_items add column individual_fee_snapshot bigint;
update public.order_items item set origin_id_snapshot=coalesce(good.origin_id,'00000000-0000-4000-8000-000000042201'),
  shipping_fee_type_snapshot='policy',individual_fee_snapshot=0 from public.goods good where good.id=item.good_id;
update public.order_items set origin_id_snapshot='00000000-0000-4000-8000-000000042201',shipping_fee_type_snapshot='policy',individual_fee_snapshot=0 where origin_id_snapshot is null;
alter table public.order_items alter column origin_id_snapshot set not null;
alter table public.order_items alter column shipping_fee_type_snapshot set not null;
alter table public.order_items alter column individual_fee_snapshot set not null;
alter table public.order_items add constraint order_item_shipping_type check(shipping_fee_type_snapshot in ('policy','free','individual'));
alter table public.order_items add constraint order_item_individual_fee check(individual_fee_snapshot between 0 and 1000000);
create function private.snapshot_order_item_fulfillment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.good_id is null then
    new.origin_id_snapshot:=coalesce(new.origin_id_snapshot,'00000000-0000-4000-8000-000000042201');
    new.shipping_fee_type_snapshot:=coalesce(new.shipping_fee_type_snapshot,'policy');
    new.individual_fee_snapshot:=coalesce(new.individual_fee_snapshot,0);
  else
    select origin_id,shipping_fee_type,individual_fee into new.origin_id_snapshot,new.shipping_fee_type_snapshot,new.individual_fee_snapshot
      from public.goods where id=new.good_id;
  end if;
  return new;
end $$;
revoke all on function private.snapshot_order_item_fulfillment() from public,anon,authenticated,service_role;
create trigger order_items_fulfillment_snapshot before insert on public.order_items for each row execute function private.snapshot_order_item_fulfillment();
alter table public.orders add column shipping_fee_breakdown jsonb not null default '[]' check(jsonb_typeof(shipping_fee_breakdown)='array');
update public.orders set shipping_fee_breakdown=jsonb_build_array(jsonb_build_object('originId','00000000-0000-4000-8000-000000042201',
  'originCode','gimpo','originName','김포','totalFee',shipping_fee,'legacy',true));

create function private.goods_shipping_fee_for(target_order uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare origin_key uuid; lines jsonb; quote jsonb;
begin
  for origin_key in select origin.id from public.fulfillment_origins origin where origin.id in (
    select item.origin_id_snapshot from public.order_items item where item.order_id=target_order
  ) order by origin.id for share loop
    if not (select is_active from public.fulfillment_origins where id=origin_key) then
      raise check_violation using message='fulfillment_origin_inactive';
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,
    'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)),'[]')
    into lines from public.order_items where order_id=target_order;
  quote:=private.calculate_goods_shipping(lines);
  update public.orders set shipping_fee_breakdown=quote->'groups' where id=target_order;
  return (quote->>'totalFee')::bigint;
end $$;
revoke all on function private.goods_shipping_fee_for(uuid) from public,anon,authenticated,service_role;

create function public.get_good_shipping_policy(target_good_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('originId',origin.id,'originName',origin.name,'baseFee',origin.base_fee,
    'freeThreshold',origin.free_threshold,'feeType',good.shipping_fee_type,'individualFee',good.individual_fee)
  from public.goods good join public.ips ip on ip.id=good.ip_id
    join public.fulfillment_origins origin on origin.id=good.origin_id and origin.is_active
  where good.id=target_good_id and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'
    and ip.archived_at is null and ip.published_at is not null;
$$;
revoke all on function public.get_good_shipping_policy(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_shipping_policy(text) to anon,authenticated;

-- Preserve #421's complete save/publication implementation behind a narrow
-- shipping wrapper. Both writes and their audit records share one transaction.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_fulfillment;
revoke all on function private.admin_save_good_before_fulfillment(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; previous public.goods; updated public.goods; origin_key uuid; fee_type text; fee_value bigint;
begin
  if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if target_good ? 'origin_id' then
    origin_key:=(target_good->>'origin_id')::uuid;
  end if;
  if target_good ? 'shipping_fee_type' then
    fee_type:=target_good->>'shipping_fee_type';
    if fee_type is null or fee_type not in ('policy','free','individual') then raise invalid_parameter_value using message='invalid_good_shipping_type'; end if;
  end if;
  if target_good ? 'individual_fee' then
    fee_value:=(target_good->>'individual_fee')::bigint;
    if fee_value is null or fee_value not between 0 and 1000000 then raise invalid_parameter_value using message='invalid_individual_fee'; end if;
  end if;
  -- Keep publication at its prior state while this transaction sets shipping.
  -- A new draft can fill its origin and publish in the same save.
  saved:=private.admin_save_good_before_fulfillment(case when target_good->>'publish'='true'
    and target_good ?| array['origin_id','shipping_fee_type','individual_fee'] then target_good||'{"publish":null}'::jsonb else target_good end);
  if target_good ?| array['origin_id','shipping_fee_type','individual_fee'] then
    select * into previous from public.goods where id=saved->>'id' for update;
    update public.goods set origin_id=case when target_good ? 'origin_id' then origin_key else origin_id end,shipping_fee_type=coalesce(fee_type,shipping_fee_type),
      individual_fee=coalesce(fee_value,individual_fee) where id=previous.id returning * into updated;
    insert into public.audit_log(actor_id,action,target,diff) values((select auth.uid()),'catalog.good.fulfillment_updated','goods:'||updated.id,
      jsonb_build_object('before',jsonb_build_object('origin_id',previous.origin_id,'shipping_fee_type',previous.shipping_fee_type,'individual_fee',previous.individual_fee),
        'after',jsonb_build_object('origin_id',updated.origin_id,'shipping_fee_type',updated.shipping_fee_type,'individual_fee',updated.individual_fee)));
  end if;
  if target_good->>'publish'='true' then perform public.admin_set_good_published(saved->>'id',true); end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
