-- D-3 ⑥ — 출고 흐름과 라인 카운터 유지 (설계서 v2 §1-3)
--
-- 카운터는 원장(출고)에서 다시 계산한다 — D-1 의 재고 캐시와 같은 규율이다.
-- 두 곳에서 더하고 빼면 언젠가 갈라지고, 갈라진 뒤에는 어느 쪽이 맞는지 알 수 없다.

-- 재고 효과를 라인 단위로 쪼갠다. 주문 전체 효과는 이 함수를 라인마다 부른 것과 같다.
create or replace function private.apply_order_item_stock_effect(
  p_order_item_id uuid,
  p_qty integer,
  p_reason text,
  p_ref_id text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
  v_reserved integer;
  v_settled integer;
  v_delta_on_hand integer;
  v_delta_reserved integer;
begin
  if p_qty is null or p_qty <= 0 then
    return;
  end if;

  select item.id, item.variant_id, item.location_id
  into v_item
  from public.order_items as item
  where item.id = p_order_item_id;
  if not found then
    raise exception 'order_item_not_found' using errcode = 'P0002';
  end if;

  insert into public.variant_stocks (variant_id, location_id, last_source)
  values (v_item.variant_id, v_item.location_id, 'system')
  on conflict (variant_id, location_id) do nothing;

  select stock.reserved_qty into v_reserved
  from public.variant_stocks as stock
  where stock.variant_id = v_item.variant_id and stock.location_id = v_item.location_id
  for update;

  -- 예약이 없는 수량(이관 전 주문)은 예약을 깎지 않고 보유만 움직인다. D-1b 와 같은 규칙이다.
  v_settled := least(p_qty, v_reserved);
  if p_reason = 'order_ship' then
    v_delta_reserved := -v_settled;
    v_delta_on_hand := -v_settled;
  elsif p_reason = 'order_release' then
    v_delta_reserved := -v_settled;
    v_delta_on_hand := p_qty - v_settled;
  elsif p_reason = 'return_restock' then
    v_delta_reserved := 0;
    v_delta_on_hand := p_qty;
  else
    raise check_violation using message = 'invalid_order_stock_reason';
  end if;

  if v_delta_on_hand = 0 and v_delta_reserved = 0 then
    return;
  end if;

  perform private.apply_stock_movement(
    pg_catalog.gen_random_uuid(),
    v_item.variant_id, v_item.location_id, v_delta_on_hand, v_delta_reserved,
    p_reason, case when p_reason = 'return_restock' then 'claim' else 'order' end,
    'order', p_ref_id,
    case when v_settled < p_qty and p_reason <> 'return_restock'
      then '예약 없는 수량 ' || (p_qty - v_settled)::text || '개 포함(이관 전 주문)'
    end,
    null, false
  );
end;
$$;

-- 주문 전체 효과는 라인 효과의 합이다. 구현을 한 곳에 둔다.
create or replace function private.apply_order_stock_effect(p_order_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  for v_item in
    select item.id, item.qty
    from public.order_items as item
    where item.order_id = p_order_id
    order by item.variant_id, item.location_id, item.id
  loop
    perform private.apply_order_item_stock_effect(v_item.id, v_item.qty, p_reason, p_order_id::text);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 카운터 재계산 — 출고 원장이 유일한 근거다.
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_item_counters(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.order_items as item
  set qty_shipped = coalesce(totals.shipped, 0),
      qty_delivered = coalesce(totals.delivered, 0)
  from (
    select line.id,
           sum(shipment_item.qty) filter (where ship.status in ('shipped', 'delivered')) as shipped,
           sum(shipment_item.qty) filter (where ship.status = 'delivered') as delivered
    from public.order_items as line
    left join public.shipment_items as shipment_item on shipment_item.order_item_id = line.id
    left join public.shipments as ship on ship.id = shipment_item.shipment_id
    where line.order_id = p_order_id
    group by line.id
  ) as totals
  where item.id = totals.id
    and (item.qty_shipped, item.qty_delivered)
      is distinct from (coalesce(totals.shipped, 0), coalesce(totals.delivered, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 출고 만들기 · 보내기 · 도착
-- ---------------------------------------------------------------------------
create or replace function private.create_shipment(
  p_order_id uuid,
  p_items jsonb,
  p_carrier text,
  p_tracking text,
  p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shipment uuid;
  v_row record;
  v_available integer;
  v_location text;
begin
  insert into public.shipments (order_id, shipment_no, carrier, tracking_number, created_by)
  values (p_order_id, private.next_shipment_no(p_order_id), nullif(p_carrier, ''), nullif(p_tracking, ''), p_actor)
  returning id into v_shipment;

  for v_row in
    select (entry ->> 'order_item_id')::uuid as order_item_id, (entry ->> 'qty')::integer as qty
    from pg_catalog.jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as entry
  loop
    -- 아직 안 나갔고 취소되지 않은 수량까지만 담을 수 있다. 그 이상은 종이 위에서만 나간 물건이다.
    select item.qty - item.qty_canceled - item.qty_shipped, item.location_id
    into v_available, v_location
    from public.order_items as item
    where item.id = v_row.order_item_id and item.order_id = p_order_id
    for update;
    if not found then
      raise exception 'order_item_not_in_order' using errcode = '22023';
    end if;
    if v_row.qty is null or v_row.qty <= 0 or v_row.qty > v_available then
      raise exception 'qty_exceeds_available' using errcode = '23514';
    end if;

    insert into public.shipment_items (shipment_id, order_item_id, qty)
    values (v_shipment, v_row.order_item_id, v_row.qty);
    update public.shipments set location_id = coalesce(location_id, v_location) where id = v_shipment;
  end loop;

  if not exists (select 1 from public.shipment_items where shipment_id = v_shipment) then
    raise exception 'shipment_needs_items' using errcode = '23514';
  end if;
  return v_shipment;
end;
$$;

create or replace function private.ship_shipment(p_shipment_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ship public.shipments;
  v_row record;
begin
  select * into v_ship from public.shipments as ship where ship.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment_not_found' using errcode = 'P0002';
  end if;
  if v_ship.status <> 'ready' then
    raise exception 'shipment_already_sent' using errcode = 'P0001';
  end if;
  if v_ship.tracking_number is null then
    raise exception 'tracking_required' using errcode = '23514';
  end if;

  update public.shipments set status = 'shipped', shipped_at = pg_catalog.now() where id = p_shipment_id;

  -- 재고는 여기서 빠진다. 물건이 실제로 나가는 순간이 이 한 곳이어야 한다.
  for v_row in
    select shipment_item.order_item_id, shipment_item.qty
    from public.shipment_items as shipment_item
    where shipment_item.shipment_id = p_shipment_id
    order by shipment_item.order_item_id
  loop
    perform private.apply_order_item_stock_effect(
      v_row.order_item_id, v_row.qty, 'order_ship', v_ship.order_id::text
    );
  end loop;

  perform private.sync_order_item_counters(v_ship.order_id);
end;
$$;

create or replace function private.deliver_shipment(p_shipment_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_order uuid;
begin
  update public.shipments
  set status = 'delivered', delivered_at = pg_catalog.now()
  where id = p_shipment_id and status = 'shipped'
  returning order_id into v_order;
  if not found then
    raise exception 'shipment_not_shipped' using errcode = 'P0001';
  end if;
  perform private.sync_order_item_counters(v_order);
end;
$$;

revoke all on function private.apply_order_item_stock_effect(uuid, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function private.sync_order_item_counters(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_shipment(uuid, jsonb, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.ship_shipment(uuid) from public, anon, authenticated, service_role;
revoke all on function private.deliver_shipment(uuid) from public, anon, authenticated, service_role;
