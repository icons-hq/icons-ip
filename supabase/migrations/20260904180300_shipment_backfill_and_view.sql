-- D-3 ⑧ — 기존 송장을 출고 원장으로 옮기고, 이행 상태를 뷰로 파생한다 (설계서 v2 §1-3)

-- 송장이 붙어 있던 주문은 이미 한 번 나간 주문이다. 그 사실을 출고 하나로 옮긴다.
do $$
declare
  v_order record;
  v_shipment uuid;
begin
  for v_order in
    select ord.id, ord.order_no, ord.status, ord.shipping_carrier, ord.tracking_number,
           ord.shipped_at, ord.delivered_at
    from public.orders as ord
    where ord.tracking_number is not null
      and not exists (select 1 from public.shipments as ship where ship.order_id = ord.id)
  loop
    insert into public.shipments (
      order_id, shipment_no, status, carrier, tracking_number, shipped_at, delivered_at, created_at
    )
    values (
      v_order.id, v_order.order_no || '-S01',
      case when v_order.status in ('delivered', 'done') then 'delivered' else 'shipped' end,
      v_order.shipping_carrier, v_order.tracking_number,
      coalesce(v_order.shipped_at, now()),
      case when v_order.status in ('delivered', 'done') then coalesce(v_order.delivered_at, now()) end,
      coalesce(v_order.shipped_at, now())
    )
    returning id into v_shipment;

    insert into public.shipment_items (shipment_id, order_item_id, qty)
    select v_shipment, item.id, item.qty
    from public.order_items as item
    where item.order_id = v_order.id and item.qty > 0;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 이행 상태 — 저장하지 않고 조회 시 파생한다(D-9 의 판매 상태와 같은 규율).
-- ---------------------------------------------------------------------------
create or replace view public.order_fulfillment_view as
select
  ord.id as order_id,
  ord.order_no,
  ord.status as header_status,
  totals.qty_total,
  totals.qty_canceled,
  totals.qty_shipped,
  totals.qty_delivered,
  totals.shipment_count,
  case
    when ord.status = 'canceled' then 'canceled'
    when totals.qty_canceled >= totals.qty_total and totals.qty_total > 0 then 'canceled'
    when totals.qty_canceled > 0 and totals.qty_shipped = 0 then 'partially_canceled'
    when totals.qty_delivered > 0 and totals.qty_delivered >= totals.qty_total - totals.qty_canceled then 'delivered'
    when totals.qty_delivered > 0 then 'partially_delivered'
    when totals.qty_shipped > 0 and totals.qty_shipped >= totals.qty_total - totals.qty_canceled then 'shipped'
    when totals.qty_shipped > 0 then 'partially_shipped'
    -- 송장은 등록됐지만 아직 안 보낸 상태 = 카페24 의 「배송대기」.
    when totals.ready_count > 0 then 'ready'
    else 'unfulfilled'
  end as fulfillment_state
from public.orders as ord
join lateral (
  select
    coalesce(sum(item.qty), 0)::bigint as qty_total,
    coalesce(sum(item.qty_canceled), 0)::bigint as qty_canceled,
    coalesce(sum(item.qty_shipped), 0)::bigint as qty_shipped,
    coalesce(sum(item.qty_delivered), 0)::bigint as qty_delivered,
    (select count(*) from public.shipments as ship where ship.order_id = ord.id)::integer as shipment_count,
    (select count(*) from public.shipments as ship where ship.order_id = ord.id and ship.status = 'ready')::integer as ready_count
  from public.order_items as item
  where item.order_id = ord.id
) as totals on true;

alter view public.order_fulfillment_view set (security_invoker = on);
grant select on public.order_fulfillment_view to authenticated;

-- ---------------------------------------------------------------------------
-- 어드민 RPC
-- ---------------------------------------------------------------------------
create or replace function public.admin_order_shipments(p_order_id uuid)
returns table (
  id uuid, shipment_no text, kind text, status text, carrier text, carrier_label text,
  tracking_number text, location_id text, shipped_at timestamptz, delivered_at timestamptz,
  created_at timestamptz, items jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select ship.id, ship.shipment_no, ship.kind, ship.status, ship.carrier,
         coalesce(carrier.label, ship.carrier), ship.tracking_number, ship.location_id,
         ship.shipped_at, ship.delivered_at, ship.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'orderItemId', shipment_item.order_item_id,
             'itemNo', item.item_no,
             'name', item.good_name_snapshot,
             'qty', shipment_item.qty
           ) order by item.item_no)
           from public.shipment_items as shipment_item
           join public.order_items as item on item.id = shipment_item.order_item_id
           where shipment_item.shipment_id = ship.id
         ), '[]'::jsonb)
  from public.shipments as ship
  left join public.shipping_carriers as carrier on carrier.code = ship.carrier
  where ship.order_id = p_order_id
  order by ship.created_at, ship.id;
end;
$$;

create or replace function public.admin_create_shipment(
  p_order_id uuid,
  p_items jsonb,
  p_carrier text default null,
  p_tracking text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_shipment uuid;
begin
  if not exists (select 1 from public.orders as ord where ord.id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  v_shipment := private.create_shipment(p_order_id, p_items, p_carrier, p_tracking, v_actor);

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.shipment.created', 'order:' || p_order_id::text,
          jsonb_build_object('shipment_id', v_shipment, 'items', p_items));
  return v_shipment;
end;
$$;

create or replace function public.admin_ship_shipment(
  p_shipment_id uuid,
  p_carrier text default null,
  p_tracking text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_order uuid;
begin
  update public.shipments
  set carrier = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), carrier),
      tracking_number = coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), tracking_number)
  where id = p_shipment_id and status = 'ready'
  returning order_id into v_order;
  if not found then
    raise exception 'shipment_not_ready' using errcode = 'P0001';
  end if;

  perform private.ship_shipment(p_shipment_id);

  -- 첫 출고가 나가면 헤더도 배송중이다. 이미 배송중이면 그대로 둔다(부분 출고).
  update public.orders
  set status = 'shipping', shipped_at = coalesce(shipped_at, now()),
      shipping_carrier = coalesce(shipping_carrier, (select carrier from public.shipments where id = p_shipment_id)),
      tracking_number = coalesce(tracking_number, (select tracking_number from public.shipments where id = p_shipment_id))
  where id = v_order and status = 'confirmed';

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.shipment.shipped', 'order:' || v_order::text,
          jsonb_build_object('shipment_id', p_shipment_id));
  return (select fulfillment_state from public.order_fulfillment_view where order_id = v_order);
end;
$$;

create or replace function public.admin_deliver_shipment(p_shipment_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_order uuid;
  v_state text;
begin
  select order_id into v_order from public.shipments where id = p_shipment_id;
  if not found then
    raise exception 'shipment_not_found' using errcode = 'P0002';
  end if;
  perform private.deliver_shipment(p_shipment_id);

  select fulfillment_state into v_state from public.order_fulfillment_view where order_id = v_order;
  -- 전부 도착했을 때만 헤더가 배송완료가 된다. 청약철회 기한의 기산점이라 한 번만 찍혀야 한다.
  if v_state = 'delivered' then
    update public.orders
    set status = 'delivered', delivered_at = coalesce(delivered_at, now())
    where id = v_order and status = 'shipping';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.shipment.delivered', 'order:' || v_order::text,
          jsonb_build_object('shipment_id', p_shipment_id, 'state', v_state));
  return v_state;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_order_shipments(uuid)',
    'public.admin_create_shipment(uuid, jsonb, text, text)',
    'public.admin_ship_shipment(uuid, text, text)',
    'public.admin_deliver_shipment(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;
