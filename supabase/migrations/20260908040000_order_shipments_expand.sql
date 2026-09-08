-- #428 / ADR-0016: immutable origin/fee snapshots and exactly one shipment per origin.
-- Historical orders retain one shipment, including their existing fee and tracking.
create table public.order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  origin_id uuid not null references public.fulfillment_origins(id) on delete restrict,
  origin_name_snapshot text not null,
  shipping_fee bigint not null check(shipping_fee>=0),
  shipping_fee_snapshot jsonb not null check(jsonb_typeof(shipping_fee_snapshot)='object'),
  status text not null default 'ready' check(status in ('ready','shipping','delivered','canceled')),
  carrier text references public.shipping_carriers(code) on delete restrict,
  tracking_number text check(tracking_number is null or tracking_number ~ '^[A-Z0-9]{8,30}$'),
  shipped_at timestamptz,
  delivered_at timestamptz,
  exported_at timestamptz,
  exported_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,origin_id),
  unique(order_id,id),
  check((carrier is null)=(tracking_number is null))
);
create index order_shipments_dispatch_idx on public.order_shipments(origin_id,status,created_at,id);
create index order_shipments_delivery_idx on public.order_shipments(delivered_at) where status='delivered';
alter table public.order_items add constraint order_items_order_id_id_key unique(order_id,id);
create table public.order_shipment_items (
  order_id uuid not null,
  shipment_id uuid not null,
  order_item_id uuid primary key,
  foreign key(order_id,shipment_id) references public.order_shipments(order_id,id) on delete cascade,
  foreign key(order_id,order_item_id) references public.order_items(order_id,id) on delete cascade
);
create index order_shipment_items_shipment_idx on public.order_shipment_items(shipment_id);
alter table public.order_shipments enable row level security;
alter table public.order_shipment_items enable row level security;
revoke all on public.order_shipments,public.order_shipment_items from public,anon,authenticated,service_role;
grant select on public.order_shipments,public.order_shipment_items to authenticated,service_role;
create policy shipments_owner_staff_read on public.order_shipments for select to authenticated using(
  public.is_staff() or exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid()))
);
create policy shipment_items_owner_staff_read on public.order_shipment_items for select to authenticated using(
  public.is_staff() or exists(select 1 from public.orders o where o.id=order_id and o.user_id=(select auth.uid()))
);

-- No historical order is split or repriced during migration. The pre-existing order
-- record remains byte-for-byte unchanged; this is a projection into the new tables.
insert into public.order_shipments(order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,
  status,carrier,tracking_number,shipped_at,delivered_at,created_at,updated_at)
select o.id,coalesce((o.shipping_fee_breakdown->0->>'originId')::uuid,'00000000-0000-4000-8000-000000042201'),
  coalesce(o.shipping_fee_breakdown->0->>'originName','김포'),o.shipping_fee,
  jsonb_build_object('legacy',true,'totalFee',o.shipping_fee,'originalBreakdown',o.shipping_fee_breakdown),
  case when o.status='shipping' then 'shipping' when o.status in ('delivered','done') then 'delivered'
    when o.status='canceled' then 'canceled' else 'ready' end,
  o.shipping_carrier,o.tracking_number,o.shipped_at,o.delivered_at,o.created_at,o.created_at
from public.orders o;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select item.order_id,shipment.id,item.id from public.order_items item join public.order_shipments shipment on shipment.order_id=item.order_id;

create function private.create_order_shipments(target_order uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare purchase public.orders; fee jsonb; shipment_key uuid; expected_count integer;
begin
  select * into purchase from public.orders where id=target_order for update;
  if not found then raise no_data_found using message='order_not_found'; end if;
  if exists(select 1 from public.order_shipments where order_id=target_order) then return; end if;
  select count(distinct origin_id_snapshot) into expected_count from public.order_items where order_id=target_order;
  if expected_count=0 or expected_count<>jsonb_array_length(purchase.shipping_fee_breakdown)
    or (select coalesce(sum((value->>'totalFee')::bigint),0) from jsonb_array_elements(purchase.shipping_fee_breakdown))<>purchase.shipping_fee then
    raise check_violation using message='invalid_order_shipment_breakdown';
  end if;
  for fee in select value from jsonb_array_elements(purchase.shipping_fee_breakdown) order by value->>'originId' loop
    insert into public.order_shipments(order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
      values(target_order,(fee->>'originId')::uuid,fee->>'originName',(fee->>'totalFee')::bigint,fee)
      returning id into shipment_key;
    insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
      select target_order,shipment_key,id from public.order_items where order_id=target_order and origin_id_snapshot=(fee->>'originId')::uuid;
    if not found then raise check_violation using message='shipment_origin_without_items'; end if;
  end loop;
  if (select count(*) from public.order_shipment_items where order_id=target_order)
    <>(select count(*) from public.order_items where order_id=target_order) then
    raise check_violation using message='shipment_item_missing';
  end if;
end $$;
revoke all on function private.create_order_shipments(uuid) from public,anon,authenticated,service_role;

-- Keep checkout/payment/stock/coupon logic unchanged and atomically add fulfillment
-- after it has stored all item and fee snapshots. Idempotent retries keep shipment IDs.
alter function public.place_order(jsonb,uuid,public.order_payment_method) set schema private;
alter function private.place_order(jsonb,uuid,public.order_payment_method) rename to place_order_before_shipments;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
create function public.place_order(p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare order_key uuid;
begin
  order_key:=private.place_order_before_shipments(p_address,p_checkout_key,p_payment_method);
  perform private.create_order_shipments(order_key);
  return order_key;
end $$;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
grant execute on function public.place_order(jsonb,uuid,public.order_payment_method) to authenticated;

-- Until #446/#447 move writers/readers, existing single-shipment RPCs remain valid.
create function private.sync_legacy_order_shipment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if pg_trigger_depth()>1 then return new; end if;
  if (select count(*) from public.order_shipments where order_id=new.id)=1 then
    update public.order_shipments set
      status=case when new.status='shipping' then 'shipping' when new.status in ('delivered','done') then 'delivered'
        when new.status='canceled' then 'canceled' else 'ready' end,
      carrier=new.shipping_carrier,tracking_number=new.tracking_number,
      shipped_at=new.shipped_at,delivered_at=new.delivered_at,updated_at=now()
      where order_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.sync_legacy_order_shipment() from public,anon,authenticated,service_role;
create trigger orders_legacy_shipment_sync after update of status,shipping_carrier,tracking_number,shipped_at,delivered_at on public.orders
for each row execute function private.sync_legacy_order_shipment();

-- ready + shipped/delivered = shipping; every shipment delivered = delivered.
-- Payment/confirmation/cancellation remain order-level decisions.
create function private.derive_order_shipment_status(target_order uuid)
returns public.order_status language sql stable security invoker set search_path='' as $$
  select case when o.status in ('pending','canceled','done') then o.status
    when not exists(select 1 from public.order_shipments s where s.order_id=o.id) then o.status
    when not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status<>'delivered') then 'delivered'::public.order_status
    when exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status in ('shipping','delivered')) then 'shipping'::public.order_status
    else o.status end from public.orders o where o.id=target_order;
$$;
revoke all on function private.derive_order_shipment_status(uuid) from public,anon,authenticated,service_role;
