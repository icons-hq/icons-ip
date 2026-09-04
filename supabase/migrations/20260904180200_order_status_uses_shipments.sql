-- D-3 ⑦ — 헤더 전이도 출고 원장을 지난다 (설계서 v2 §1-3)
--
-- 「배송중으로 미는」 기존 버튼을 그대로 두되, 그 안에서 출고 하나를 만들어 보낸다.
-- 그래야 전량 출고와 부분 출고가 같은 원장 위에 서고, 재고 차감 지점이 한 곳으로 남는다.

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_shipment uuid;
  v_pending_items jsonb;
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('confirmed', 'shipping', 'delivered') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'confirmed')
    or (v_current_status = 'confirmed' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'delivered')
  ) then
    raise exception using message = 'invalid_order_transition';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 승인된 청약철회는 durable claim으로 남아 finalizer를 기다린다. 그 사이
  -- 주문을 앞으로 미는 것은 환불 대상 주문을 계속 처리하는 것이라 막는다.
  if exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 입력을 생략하면 이미 등록된 운송장을 유지한다. 배송 완료 전이가 송장을
  -- 조용히 지우지 않게 하는 장치다.
  v_carrier := coalesce(v_carrier, v_current_carrier);
  v_tracking := coalesce(v_tracking, v_current_tracking);

  if (v_carrier is null) <> (v_tracking is null) then
    raise check_violation using message = 'invalid_tracking_input';
  end if;

  -- 운송장 없이 배송을 시작하면 고객이 배송을 추적할 수 없다. fail closed한다.
  if p_status = 'shipping' and v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  -- D-3: 모든 출고는 `shipments` 를 지난다. 헤더를 배송중으로 미는 이 경로도 예외가 아니라,
  -- 아직 안 나간 수량을 담은 출고 하나를 만들어 보낸다 — 재고 차감은 그 안에서 일어난다.
  -- 이미 만들어 둔 준비 중 출고가 있으면 새로 만들지 않고 그것을 보낸다(부분 출고 화면과 같은 원장).
  if p_status = 'shipping' then
    select ship.id into v_shipment
    from public.shipments as ship
    where ship.order_id = p_order_id and ship.status = 'ready'
    order by ship.created_at, ship.id
    limit 1;

    if v_shipment is null then
      select jsonb_agg(jsonb_build_object('order_item_id', item.id, 'qty', item.qty - item.qty_canceled - item.qty_shipped))
      into v_pending_items
      from public.order_items as item
      where item.order_id = p_order_id and item.qty - item.qty_canceled - item.qty_shipped > 0;

      -- 담을 것이 없으면 출고를 만들지 않는다. 「재고는 출고로만 빠진다」는 규칙은
      -- 나갈 물건이 없을 때 저절로 지켜지고, 헤더 전이까지 막을 이유는 없다.
      if v_pending_items is not null then
        v_shipment := private.create_shipment(p_order_id, v_pending_items, v_carrier, v_tracking, v_actor);
      end if;
    else
      update public.shipments
      set carrier = coalesce(nullif(v_carrier, ''), carrier),
          tracking_number = coalesce(nullif(v_tracking, ''), tracking_number)
      where id = v_shipment;
    end if;

    if v_shipment is not null then
      perform private.ship_shipment(v_shipment);
    end if;
  end if;

  -- 도착도 마찬가지다. 나간 출고가 전부 도착해야 헤더가 배송완료다.
  if p_status = 'delivered' then
    for v_shipment in
      select ship.id from public.shipments as ship
      where ship.order_id = p_order_id and ship.status = 'shipped'
      order by ship.created_at, ship.id
    loop
      perform private.deliver_shipment(v_shipment);
    end loop;
  end if;

  -- 새로 붙는 택배사만 활성 여부를 본다. 이미 붙어 있던 코드가 그 사이
  -- 비활성화됐다고 배송완료 전이가 막히면 안 된다.
  if v_carrier is not null and v_carrier is distinct from v_current_carrier then
    if not exists (
      select 1
      from public.shipping_carriers as carrier
      where carrier.code = v_carrier
        and carrier.is_active
    ) then
      raise check_violation using message = 'inactive_shipping_carrier';
    end if;
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    shipped_at = case when p_status = 'shipping' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text,
      'carrier', v_carrier,
      'trackingNumber', v_tracking
    )
  );
end;
$function$

;
