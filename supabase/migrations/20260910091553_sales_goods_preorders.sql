-- #485: an approved future supply is separate from physical option stock.
-- Drafts have no sales effect. Activating a policy explicitly selects preorder
-- supply for its option; expiry/stop never silently falls back to physical stock.
create table private.goods_preorder_policies (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.goods_variants(id) on delete restrict,
  state text not null default 'draft' check(state in ('draft','active','stopped')),
  capacity_qty integer check(capacity_qty>0),
  starts_at timestamptz,
  ends_at timestamptz,
  expected_ship_date date,
  approval_reference text check(approval_reference is null or length(btrim(approval_reference)) between 1 and 2000),
  revision integer not null default 1 check(revision>0),
  created_by uuid not null references public.profiles(id),
  activated_by uuid references public.profiles(id),
  activated_at timestamptz,
  stopped_by uuid references public.profiles(id),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(starts_at is null or ends_at is null or starts_at<ends_at),
  check(state='draft' or (capacity_qty is not null and starts_at is not null and ends_at is not null
    and expected_ship_date is not null and approval_reference is not null and activated_by is not null and activated_at is not null)),
  check(state<>'stopped' or (stopped_by is not null and stopped_at is not null)),
  unique(variant_id,id)
);
create unique index goods_preorder_one_active_policy on private.goods_preorder_policies(variant_id) where state='active';
alter table public.goods_variants add column preorder_policy_id uuid;
alter table public.goods_variants add constraint goods_variant_preorder_policy_owner
  foreign key(id,preorder_policy_id) references private.goods_preorder_policies(variant_id,id) on delete restrict;
revoke all on private.goods_preorder_policies from public,anon,authenticated,service_role;
grant select,insert,update on private.goods_preorder_policies to postgres;

alter table public.order_items
  add column supply_source text not null default 'stock' check(supply_source in ('stock','preorder')),
  add column preorder_policy_id uuid references private.goods_preorder_policies(id) on delete restrict,
  add column preorder_expected_ship_date date,
  add column preorder_snapshot jsonb;
alter table public.order_items add constraint order_item_supply_snapshot_complete check(
  (supply_source='stock' and preorder_policy_id is null and preorder_expected_ship_date is null and preorder_snapshot is null)
  or (supply_source='preorder' and preorder_policy_id is not null and preorder_expected_ship_date is not null
    and preorder_snapshot is not null and jsonb_typeof(preorder_snapshot)='object'
    and preorder_snapshot ?& array['policyId','policyRevision','startsAt','endsAt','expectedShipDate']
    and jsonb_typeof(preorder_snapshot->'policyId')='string' and jsonb_typeof(preorder_snapshot->'expectedShipDate')='string'
    and jsonb_typeof(preorder_snapshot->'policyRevision')='number' and preorder_snapshot->>'policyRevision' ~ '^[1-9][0-9]*$'
    and jsonb_typeof(preorder_snapshot->'startsAt')='string' and jsonb_typeof(preorder_snapshot->'endsAt')='string'
    and preorder_snapshot->>'policyId'=preorder_policy_id::text
    and preorder_snapshot->>'expectedShipDate'=preorder_expected_ship_date::text));

create table private.goods_preorder_reservations (
  order_item_id uuid primary key references public.order_items(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  policy_id uuid not null references private.goods_preorder_policies(id) on delete restrict,
  qty integer not null check(qty>0),
  state text not null default 'reserved' check(state in ('reserved','allocated','released','returned')),
  allocated_at timestamptz,
  allocated_by uuid references public.profiles(id),
  allocation_reference text,
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  release_reason text,
  created_at timestamptz not null default now(),
  check((state in ('allocated','returned'))=(allocated_at is not null)),
  check((allocated_at is null and allocated_by is null and allocation_reference is null)
    or (allocated_at is not null and allocated_by is not null and allocation_reference is not null and length(btrim(allocation_reference)) between 1 and 2000)),
  check((state in ('released','returned'))=(released_at is not null)),
  check(released_at is null or (release_reason is not null and length(btrim(release_reason)) between 1 and 2000))
);
create index goods_preorder_policy_reservations on private.goods_preorder_reservations(policy_id,state);
create index goods_preorder_order_reservations on private.goods_preorder_reservations(order_id);
revoke all on private.goods_preorder_reservations from public,anon,authenticated,service_role;
grant select,insert,update on private.goods_preorder_reservations to postgres;

create function private.guard_preorder_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.id<>old.id or new.variant_id<>old.variant_id or new.created_at<>old.created_at or new.created_by<>old.created_by then
    raise check_violation using message='preorder_policy_identity_immutable';
  end if;
  if old.state<>'draft' and (new.capacity_qty is distinct from old.capacity_qty or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at or new.expected_ship_date is distinct from old.expected_ship_date
    or new.approval_reference is distinct from old.approval_reference or new.activated_at is distinct from old.activated_at
    or new.activated_by is distinct from old.activated_by or (new.state<>old.state and not (old.state='active' and new.state='stopped'))) then
    raise check_violation using message='preorder_policy_immutable';
  end if;
  return new;
end $$;
revoke all on function private.guard_preorder_policy() from public,anon,authenticated,service_role;
create trigger goods_preorder_policy_immutable before update on private.goods_preorder_policies
  for each row execute function private.guard_preorder_policy();

create function private.freeze_order_supply_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.supply_source is distinct from old.supply_source or new.preorder_policy_id is distinct from old.preorder_policy_id
    or new.preorder_expected_ship_date is distinct from old.preorder_expected_ship_date or new.preorder_snapshot is distinct from old.preorder_snapshot then
    raise check_violation using message='order_supply_snapshot_immutable';
  end if;
  return new;
end $$;
revoke all on function private.freeze_order_supply_snapshot() from public,anon,authenticated,service_role;
create trigger order_items_freeze_supply before update of supply_source,preorder_policy_id,preorder_expected_ship_date,preorder_snapshot
  on public.order_items for each row execute function private.freeze_order_supply_snapshot();

create function private.goods_preorder_remaining(p_policy_id uuid) returns integer
language sql stable security invoker set search_path='' as $$
  -- Allocation permanently consumes the approved future supply. A later refund
  -- restores physical stock, so it must not also reopen future-sale capacity.
  select case when policy.capacity_qty is null then null else greatest(0,policy.capacity_qty::bigint-coalesce((select sum(reservation.qty::bigint)
    from private.goods_preorder_reservations reservation where reservation.policy_id=policy.id and reservation.state<>'released'),0))::integer end
  from private.goods_preorder_policies policy where policy.id=p_policy_id;
$$;
revoke all on function private.goods_preorder_remaining(uuid) from public,anon,authenticated,service_role;
grant execute on function private.goods_preorder_remaining(uuid) to postgres;

create function private.resolve_goods_variant_supply(p_variant_id uuid,p_at timestamptz)
returns table(mode text,available_qty integer,policy_id uuid,policy_revision integer,state text,
  starts_at timestamptz,ends_at timestamptz,expected_ship_date date,next_change_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare variant public.goods_variants; policy private.goods_preorder_policies;
begin
  select * into variant from public.goods_variants where id=p_variant_id;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if p_at is null then raise invalid_parameter_value using message='supply_time_required'; end if;
  if variant.preorder_policy_id is null then
    return query select 'stock'::text,case when variant.archived_at is null then variant.stock_qty else 0 end,
      null::uuid,null::integer,'stock'::text,null::timestamptz,null::timestamptz,null::date,null::timestamptz;
    return;
  end if;
  select * into policy from private.goods_preorder_policies where id=variant.preorder_policy_id and variant_id=variant.id;
  if not found or policy.state='draft' then raise check_violation using message='preorder_policy_not_configured'; end if;
  return query select 'preorder'::text,
    case when variant.archived_at is null and policy.state='active' and p_at>=policy.starts_at and p_at<policy.ends_at
      then private.goods_preorder_remaining(policy.id) else 0 end,
    policy.id,policy.revision,
    case when policy.state='stopped' then 'stopped' when p_at<policy.starts_at then 'scheduled'
      when p_at>=policy.ends_at then 'closed' else 'open' end,
    policy.starts_at,policy.ends_at,policy.expected_ship_date,
    case when policy.state<>'active' then null when p_at<policy.starts_at then policy.starts_at
      when p_at<policy.ends_at then policy.ends_at else null end;
end $$;
revoke all on function private.resolve_goods_variant_supply(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.resolve_goods_variant_supply(uuid,timestamptz) to postgres;

create function public.goods_variant_supply(variant public.goods_variants) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('mode',supply.mode,'availableQty',supply.available_qty,'policyId',supply.policy_id,
    'policyRevision',supply.policy_revision,'state',supply.state,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
    'expectedShipDate',supply.expected_ship_date,'calculatedAt',statement_timestamp(),'nextChangeAt',supply.next_change_at)
  from public.goods_variants current_variant join public.goods good on good.id=current_variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(current_variant.id,statement_timestamp()) supply
  where current_variant.id=variant.id and current_variant.archived_at is null and good.published_at is not null and good.archived_at is null
    and good.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
$$;
revoke all on function public.goods_variant_supply(public.goods_variants) from public,anon,authenticated,service_role;
grant execute on function public.goods_variant_supply(public.goods_variants) to anon,authenticated;

create function public.admin_list_goods_preorders(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',policy.id,'variantId',policy.variant_id,'goodId',variant.good_id,
    'state',policy.state,'capacityQty',policy.capacity_qty,'startsAt',policy.starts_at,'endsAt',policy.ends_at,
    'expectedShipDate',policy.expected_ship_date,'approvalReference',policy.approval_reference,'revision',policy.revision,
    'selected',coalesce(variant.preorder_policy_id=policy.id,false),'remainingQty',private.goods_preorder_remaining(policy.id),
    'reservedQty',coalesce((select sum(qty) from private.goods_preorder_reservations where policy_id=policy.id and state='reserved'),0),
    'allocatedQty',coalesce((select sum(qty) from private.goods_preorder_reservations where policy_id=policy.id and state in ('allocated','returned')),0),
    'createdAt',policy.created_at,'activatedAt',policy.activated_at,'stoppedAt',policy.stopped_at)
    order by policy.created_at desc,policy.id),'[]'::jsonb)
    from private.goods_preorder_policies policy join public.goods_variants variant on variant.id=policy.variant_id where variant.good_id=p_good_id);
end $$;
revoke all on function public.admin_list_goods_preorders(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_preorders(text) to authenticated;

create function public.admin_save_goods_preorder(p_good_id text,p_variant_id uuid,p_policy_id uuid,p_values jsonb,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); variant public.goods_variants; previous private.goods_preorder_policies; saved private.goods_preorder_policies;
  state_value text; capacity_value integer; starts_value timestamptz; ends_value timestamptz; date_value date; evidence_value text; is_admin boolean;
begin
  if actor is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  is_admin:=exists(select 1 from public.profiles where id=actor and role='admin');
  if jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','capacityQty','startsAt','endsAt','expectedShipDate','approvalReference')) then
    raise invalid_parameter_value using message='invalid_preorder_policy';
  end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise check_violation using message='invalid_preorder_policy'; end if;
  if state_value='active' and not is_admin then raise insufficient_privilege using message='preorder_admin_required'; end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if p_policy_id is not null then
    select * into previous from private.goods_preorder_policies where id=p_policy_id and variant_id=p_variant_id for update;
    if not found then raise no_data_found using message='preorder_policy_not_found'; end if;
  end if;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  if state_value='stopped' then
    if previous.state is null or previous.state='draft' then raise check_violation using message='preorder_not_active'; end if;
    if previous.state='stopped' then return jsonb_build_object('id',previous.id,'revision',previous.revision,'changed',false); end if;
    update private.goods_preorder_policies set state='stopped',stopped_by=actor,stopped_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  else
    if previous.state is not null and previous.state<>'draft' then raise check_violation using message='preorder_policy_immutable'; end if;
    if p_values->'capacityQty' is not null and p_values->'capacityQty'<>'null'::jsonb then
      if jsonb_typeof(p_values->'capacityQty')<>'number' or p_values->>'capacityQty' !~ '^[1-9][0-9]*$'
        or (p_values->>'capacityQty')::numeric>2147483647 then raise check_violation using message='invalid_preorder_policy'; end if;
      capacity_value:=(p_values->>'capacityQty')::integer;
    end if;
    if nullif(p_values->>'startsAt','') is not null then
      if jsonb_typeof(p_values->'startsAt')<>'string' or p_values->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      starts_value:=(p_values->>'startsAt')::timestamptz;
    end if;
    if nullif(p_values->>'endsAt','') is not null then
      if jsonb_typeof(p_values->'endsAt')<>'string' or p_values->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      ends_value:=(p_values->>'endsAt')::timestamptz;
    end if;
    if nullif(p_values->>'expectedShipDate','') is not null then
      if p_values->>'expectedShipDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise check_violation using message='invalid_preorder_policy'; end if;
      date_value:=(p_values->>'expectedShipDate')::date;
    end if;
    if p_values->'approvalReference' is not null and p_values->'approvalReference'<>'null'::jsonb and jsonb_typeof(p_values->'approvalReference')<>'string' then
      raise check_violation using message='invalid_preorder_policy';
    end if;
    evidence_value:=nullif(btrim(p_values->>'approvalReference'),'');
    if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
      or (starts_value is not null and ends_value is not null and starts_value>=ends_value)
      or length(evidence_value)>2000 then raise check_violation using message='invalid_preorder_policy'; end if;
    if state_value='active' then
      if to_regprocedure('private.preorder_checkout_ready()') is null then raise check_violation using message='preorder_runtime_not_ready'; end if;
      if capacity_value is null or starts_value is null or ends_value is null or date_value is null or evidence_value is null
        or ends_value<=clock_timestamp() or date_value<(ends_value at time zone 'Asia/Seoul')::date then
        raise check_violation using message='preorder_policy_not_configured';
      end if;
      if variant.archived_at is not null then raise check_violation using message='goods_variant_inactive'; end if;
      if exists(select 1 from private.goods_preorder_policies where variant_id=variant.id and state='active' and id is distinct from previous.id) then
        raise check_violation using message='preorder_policy_already_active';
      end if;
    end if;
    if previous.id is null then
      insert into private.goods_preorder_policies(variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
      values(variant.id,state_value,capacity_value,starts_value,ends_value,date_value,evidence_value,actor,
        case when state_value='active' then actor end,case when state_value='active' then clock_timestamp() end) returning * into saved;
    else
      update private.goods_preorder_policies set state=state_value,capacity_qty=capacity_value,starts_at=starts_value,ends_at=ends_value,
        expected_ship_date=date_value,approval_reference=evidence_value,revision=revision+1,updated_at=clock_timestamp(),
        activated_by=case when state_value='active' then actor end,activated_at=case when state_value='active' then clock_timestamp() end
        where id=previous.id returning * into saved;
    end if;
    if saved.state='active' then update public.goods_variants set preorder_policy_id=saved.id where id=variant.id; end if;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorder_saved','goods:'||p_good_id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'changed',true);
end $$;
revoke all on function public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer) to authenticated;

create function public.admin_use_stock_supply(p_good_id text,p_variant_id uuid,p_expected_policy_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); variant public.goods_variants; policy private.goods_preorder_policies;
begin
  if actor is null or not coalesce(public.is_staff(),false) or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='preorder_admin_required';
  end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if variant.preorder_policy_id is null and p_expected_policy_id is null then return jsonb_build_object('changed',false); end if;
  if variant.preorder_policy_id is distinct from p_expected_policy_id then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  select * into policy from private.goods_preorder_policies where id=variant.preorder_policy_id for update;
  if policy.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  if policy.state<>'stopped' then raise check_violation using message='stop_preorder_before_stock_supply'; end if;
  if exists(select 1 from private.goods_preorder_reservations reservation join private.goods_preorder_policies source on source.id=reservation.policy_id
    where source.variant_id=variant.id and reservation.state='reserved') then raise check_violation using message='preorder_allocations_pending'; end if;
  update public.goods_variants set preorder_policy_id=null where id=variant.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.stock_supply_selected','goods:'||p_good_id,
    jsonb_build_object('variantId',variant.id,'previousPolicyId',policy.id));
  return jsonb_build_object('changed',true);
end $$;
revoke all on function public.admin_use_stock_supply(text,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_use_stock_supply(text,uuid,uuid,integer) to authenticated;

-- Called only by the new checkout after it has locked order -> goods -> option
-- and inserted the immutable item snapshot. It never writes physical stock.
create function private.reserve_goods_preorder_item(p_order_item_id uuid,p_at timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.order_items; policy private.goods_preorder_policies; existing private.goods_preorder_reservations;
begin
  select * into item from public.order_items where id=p_order_item_id;
  if not found or item.supply_source<>'preorder' or item.preorder_policy_id is null then
    raise check_violation using message='preorder_item_required';
  end if;
  select * into existing from private.goods_preorder_reservations where order_item_id=item.id;
  if found then
    if existing.order_id<>item.order_id or existing.policy_id<>item.preorder_policy_id or existing.qty<>item.qty then
      raise check_violation using message='preorder_reservation_conflict';
    end if;
    return;
  end if;
  if not exists(select 1 from public.orders where id=item.order_id and status='pending') then
    raise check_violation using message='preorder_order_not_pending';
  end if;
  select * into policy from private.goods_preorder_policies where id=item.preorder_policy_id for update;
  if not found or policy.variant_id<>item.variant_id or policy.expected_ship_date<>item.preorder_expected_ship_date
    or item.preorder_snapshot->>'policyRevision' is distinct from policy.revision::text
    or (item.preorder_snapshot->>'startsAt')::timestamptz is distinct from policy.starts_at
    or (item.preorder_snapshot->>'endsAt')::timestamptz is distinct from policy.ends_at then
    raise check_violation using message='preorder_snapshot_mismatch';
  end if;
  if policy.state<>'active' or p_at is null or p_at<policy.starts_at or p_at>=policy.ends_at
    or not exists(select 1 from public.goods_variants where id=item.variant_id and preorder_policy_id=policy.id and archived_at is null) then
    raise check_violation using message='preorder_sale_not_open';
  end if;
  if private.goods_preorder_remaining(policy.id)<item.qty then raise check_violation using message='preorder_capacity_exceeded'; end if;
  insert into private.goods_preorder_reservations(order_item_id,order_id,policy_id,qty) values(item.id,item.order_id,policy.id,item.qty);
end $$;
revoke all on function private.reserve_goods_preorder_item(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.reserve_goods_preorder_item(uuid,timestamptz) to postgres;

-- A fully canceled order has a single authoritative release path. Unreceived
-- supply returns to its capacity; allocated supply returns only to real stock.
create function private.restore_order_item_supply(p_order_item_id uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.order_items; reservation private.goods_preorder_reservations; stock_variant uuid;
  reason_value text:=coalesce(nullif(btrim(p_reason),''),'주문 전체 취소');
begin
  select * into item from public.order_items where id=p_order_item_id;
  if not found then raise no_data_found using message='order_item_not_found'; end if;
  stock_variant:=private.order_item_stock_variant(item.id);
  perform 1 from public.goods where id=item.good_id for update;
  perform 1 from public.goods_variants where id=stock_variant and good_id=item.good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if item.supply_source='preorder' then
    select * into reservation from private.goods_preorder_reservations where order_item_id=item.id for update;
    if not found then raise check_violation using message='preorder_reservation_missing'; end if;
    if reservation.state in ('released','returned') then return; end if;
    if reservation.state='reserved' then
      update private.goods_preorder_reservations set state='released',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value
        where order_item_id=item.id;
      insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'order.preorder_capacity_released','order:'||item.order_id::text,
        jsonb_build_object('orderItemId',item.id,'goodId',item.good_id,'variantId',item.variant_id,'policyId',reservation.policy_id,
          'qty',item.qty,'physicalStockDelta',0,'reason',reason_value));
      return;
    end if;
  end if;
  perform private.change_goods_variant_stock(item.good_id,stock_variant,item.qty::bigint);
  if item.supply_source='preorder' then
    update private.goods_preorder_reservations set state='returned',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value
      where order_item_id=item.id;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'order.option_stock_restored','order:'||item.order_id::text,
    jsonb_build_object('orderItemId',item.id,'goodId',item.good_id,'variantId',stock_variant,'delta',item.qty,
      'supplySource',item.supply_source,'preorderPolicyId',item.preorder_policy_id,'reason',p_reason));
end $$;
revoke all on function private.restore_order_item_supply(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.restore_order_item_supply(uuid,text) to postgres;

create function public.admin_list_goods_preorder_reservations(p_good_id text,p_state text default 'reserved',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total_count integer; result jsonb;
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if (p_state is not null and p_state not in ('reserved','allocated','released','returned')) or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset<0 then raise invalid_parameter_value using message='invalid_preorder_reservation_query'; end if;
  select count(*) into total_count from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    where item.good_id=p_good_id and (p_state is null or reservation.state=p_state);
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',row.order_item_id,'orderId',row.order_id,'policyId',row.policy_id,
    'variantId',row.variant_id,'variantName',row.variant_name_snapshot,'qty',row.qty,'state',row.state,'createdAt',row.created_at,
    'orderStatus',row.order_status,'expectedShipDate',row.preorder_expected_ship_date,'physicalStockQty',row.physical_stock_qty,
    'allocatedAt',row.allocated_at,'allocationReference',row.allocation_reference,'releasedAt',row.released_at,'releaseReason',row.release_reason)
    order by row.created_at,row.order_item_id),'[]'::jsonb) into result from (
      select reservation.*,item.variant_id,item.variant_name_snapshot,item.preorder_expected_ship_date,variant.stock_qty physical_stock_qty,purchase.status order_status
      from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
      join public.goods_variants variant on variant.id=item.variant_id join public.orders purchase on purchase.id=reservation.order_id
      where item.good_id=p_good_id and (p_state is null or reservation.state=p_state)
      order by reservation.created_at,reservation.order_item_id limit p_limit offset p_offset) row;
  return jsonb_build_object('total',total_count,'items',result,'hasMore',p_offset+jsonb_array_length(result)<total_count);
end $$;
revoke all on function public.admin_list_goods_preorder_reservations(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_preorder_reservations(text,text,integer,integer) to authenticated;

create function public.admin_allocate_goods_preorders(p_good_id text,p_order_item_ids uuid[],p_expected_stock jsonb,p_receipt_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); order_key uuid; variant_row record; reservation_row record; expected_qty numeric; allocated_count integer:=0;
  evidence_value text:=nullif(btrim(p_receipt_reference),'');
begin
  if actor is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if cardinality(p_order_item_ids) is null or cardinality(p_order_item_ids) not between 1 and 100
    or cardinality(p_order_item_ids)<>(select count(distinct id) from unnest(p_order_item_ids) id)
    or jsonb_typeof(p_expected_stock) is distinct from 'object' or evidence_value is null or length(evidence_value)>2000 then
    raise invalid_parameter_value using message='invalid_preorder_allocation';
  end if;
  if (select count(*) from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    where reservation.order_item_id=any(p_order_item_ids) and item.good_id=p_good_id)<>cardinality(p_order_item_ids) then
    raise check_violation using message='preorder_reservation_missing';
  end if;
  -- Existing order-first shipment/cancellation writers and receipt allocation
  -- share this order -> goods -> option -> reservation locking sequence.
  for order_key in select purchase.id from public.orders purchase where exists(select 1 from private.goods_preorder_reservations reservation
    where reservation.order_id=purchase.id and reservation.order_item_id=any(p_order_item_ids)) order by purchase.id for update loop
    if exists(select 1 from private.goods_preorder_reservations reservation where reservation.order_id=order_key
      and reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved') then
      if not exists(select 1 from public.orders where id=order_key and status in ('paid','confirmed','shipping')) then
        raise check_violation using message='preorder_payment_required';
      end if;
      perform private.assert_order_dispatch_allowed(order_key);
    end if;
  end loop;
  if exists(select 1 from private.goods_preorder_reservations where order_item_id=any(p_order_item_ids) and state not in ('reserved','allocated')) then
    raise check_violation using message='preorder_reservation_released';
  end if;
  perform good.id from public.goods good where exists(select 1 from public.order_items item where item.id=any(p_order_item_ids) and item.good_id=good.id)
    order by good.id for update;
  perform variant.id from public.goods_variants variant where exists(select 1 from public.order_items item where item.id=any(p_order_item_ids) and item.variant_id=variant.id)
    order by variant.id for update;
  perform reservation.order_item_id from private.goods_preorder_reservations reservation where reservation.order_item_id=any(p_order_item_ids)
    order by reservation.order_item_id for update;
  for variant_row in select variant.id,variant.good_id,variant.stock_qty,sum(reservation.qty::bigint)::bigint qty
    from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    join public.goods_variants variant on variant.id=item.variant_id
    where reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved' group by variant.id order by variant.good_id,variant.id loop
    if jsonb_typeof(p_expected_stock->variant_row.id::text) is distinct from 'number'
      or p_expected_stock->>variant_row.id::text !~ '^(0|[1-9][0-9]*)$' then raise invalid_parameter_value using message='invalid_preorder_allocation'; end if;
    expected_qty:=(p_expected_stock->>variant_row.id::text)::numeric;
    if expected_qty<>variant_row.stock_qty then raise sqlstate 'PT409' using message='preorder_physical_stock_changed'; end if;
    if variant_row.stock_qty<variant_row.qty then raise check_violation using message='preorder_physical_stock_shortfall'; end if;
    perform private.change_goods_variant_stock(variant_row.good_id,variant_row.id,-variant_row.qty);
  end loop;
  for reservation_row in select reservation.*,item.good_id,item.variant_id from private.goods_preorder_reservations reservation
    join public.order_items item on item.id=reservation.order_item_id where reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved'
    order by reservation.order_item_id loop
    update private.goods_preorder_reservations set state='allocated',allocated_at=clock_timestamp(),allocated_by=actor,allocation_reference=evidence_value
      where order_item_id=reservation_row.order_item_id;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'order.preorder_stock_allocated','order:'||reservation_row.order_id::text,
      jsonb_build_object('orderItemId',reservation_row.order_item_id,'goodId',reservation_row.good_id,'variantId',reservation_row.variant_id,
        'policyId',reservation_row.policy_id,'qty',reservation_row.qty,'physicalStockDelta',-reservation_row.qty,'receiptReference',evidence_value));
    allocated_count:=allocated_count+1;
  end loop;
  if allocated_count>0 then
    update public.order_shipments shipment set updated_at=clock_timestamp() where exists(select 1 from public.order_shipment_items link
      where link.shipment_id=shipment.id and link.order_item_id=any(p_order_item_ids));
  end if;
  return jsonb_build_object('allocatedItems',allocated_count,'alreadyAllocatedItems',cardinality(p_order_item_ids)-allocated_count);
end $$;
revoke all on function public.admin_allocate_goods_preorders(text,uuid[],jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_allocate_goods_preorders(text,uuid[],jsonb,text) to authenticated;

-- Administrative readiness uses sale supply while the stock columns continue
-- to mean real warehouse units. Publication/KC/payment readiness stays with the
-- existing readiness checks; a manual product stop always yields zero here.
create function public.goods_sale_available_qty(good public.goods) returns bigint
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(sum(supply.available_qty::bigint),0)::bigint
    from public.goods actual_good join public.goods_variants variant on variant.good_id=actual_good.id
      cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where actual_good.id=good.id and actual_good.archived_at is null and actual_good.stock<>'soldout' and variant.archived_at is null);
end $$;
revoke all on function public.goods_sale_available_qty(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.goods_sale_available_qty(public.goods) to authenticated,postgres;

notify pgrst,'reload schema';
